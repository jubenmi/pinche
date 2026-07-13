import { open } from "node:fs/promises";

import { AppError, badRequest, notFound } from "../../http/errors.js";

export const MAX_ALBUM_VIDEO_BYTES = 100 * 1024 * 1024;

function payloadTooLarge(message) {
  return new AppError(413, "PAYLOAD_TOO_LARGE", message);
}

function rangeNotSatisfiable(message = "Requested byte range is not satisfiable") {
  return new AppError(416, "RANGE_NOT_SATISFIABLE", message);
}

function normalizeByteSize(value, { required = true } = {}) {
  if (!required && (value === undefined || value === null || value === "")) {
    return undefined;
  }

  const normalized = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw badRequest("album video byte size must be a positive integer");
  }
  if (normalized > MAX_ALBUM_VIDEO_BYTES) {
    throw payloadTooLarge(`album video must not exceed ${MAX_ALBUM_VIDEO_BYTES} bytes`);
  }
  return normalized;
}

function normalizeContentType(value, { required = true, sourceUrl = "" } = {}) {
  const missing = value === undefined || value === null || String(value).trim() === "";
  if (missing) {
    if (!required) return undefined;
    const sourcePath = String(sourceUrl || "").split(/[?#]/, 1)[0];
    if (/\.mp4$/i.test(sourcePath)) return "video/mp4";
    throw badRequest("album video content type is required");
  }

  const normalized = String(value).split(";", 1)[0].trim().toLowerCase();
  if (normalized !== "video/mp4") {
    throw badRequest("album video content type must be video/mp4");
  }
  return normalized;
}

export function isMp4FileHeader(bytes) {
  return Boolean(
    bytes &&
      typeof bytes.length === "number" &&
      bytes.length >= 8 &&
      bytes[4] === 0x66 &&
      bytes[5] === 0x74 &&
      bytes[6] === 0x79 &&
      bytes[7] === 0x70
  );
}

export function parseSingleByteRange(value, size) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(size) || size < 0) {
    throw rangeNotSatisfiable();
  }

  const text = String(value).trim();
  const match = /^bytes=(\d*)-(\d*)$/i.exec(text);
  if (!match || (!match[1] && !match[2]) || text.includes(",") || size === 0) {
    throw rangeNotSatisfiable();
  }

  const parseRangeInteger = (raw) => {
    if (!/^\d+$/.test(raw)) throw rangeNotSatisfiable();
    const number = Number(raw);
    if (!Number.isSafeInteger(number)) throw rangeNotSatisfiable();
    return number;
  };

  if (!match[1]) {
    const suffixLength = parseRangeInteger(match[2]);
    if (suffixLength <= 0) throw rangeNotSatisfiable();
    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1
    };
  }

  const start = parseRangeInteger(match[1]);
  if (start >= size) throw rangeNotSatisfiable();

  if (!match[2]) {
    return { start, end: size - 1 };
  }

  const requestedEnd = parseRangeInteger(match[2]);
  if (requestedEnd < start) throw rangeNotSatisfiable();
  return { start, end: Math.min(requestedEnd, size - 1) };
}

export function validateAlbumVideoObject({
  byteSize,
  contentType,
  sourceUrl,
  headerBytes
} = {}) {
  const { byteSize: normalizedByteSize, contentType: normalizedContentType } =
    validateAlbumVideoMetadata({ byteSize, contentType, sourceUrl });
  if (!isMp4FileHeader(headerBytes)) {
    throw badRequest("album video must contain an MP4 ftyp header");
  }
  return {
    byteSize: normalizedByteSize,
    contentType: normalizedContentType
  };
}

function validateAlbumVideoMetadata({ byteSize, contentType, sourceUrl } = {}) {
  return {
    byteSize: normalizeByteSize(byteSize),
    contentType: normalizeContentType(contentType, { sourceUrl })
  };
}

export async function inspectSessionAlbumVideoObject({
  sourceUrl,
  storageAdapter,
  suppliedByteSize,
  suppliedContentType
} = {}) {
  void suppliedByteSize;
  void suppliedContentType;
  if (typeof storageAdapter?.inspectObject === "function") {
    return storageAdapter.inspectObject(sourceUrl);
  }
  const metadata = await storageAdapter.getMetadata(sourceUrl);
  const authoritativeMetadata = validateAlbumVideoMetadata({
    byteSize: metadata?.byteSize,
    contentType: metadata?.contentType,
    sourceUrl
  });
  const headerBytes = await storageAdapter.readRange(sourceUrl, 0, 11);
  if (!isMp4FileHeader(headerBytes)) {
    throw badRequest("album video must contain an MP4 ftyp header");
  }
  return metadata?.etag
    ? { ...authoritativeMetadata, etag: metadata.etag }
    : authoritativeMetadata;
}

function localFileNotFound(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

async function openLocalAlbumVideo(filePath, openFile) {
  let fileHandle;
  try {
    fileHandle = await openFile(filePath, "r");
    const fileStats = await fileHandle.stat();
    if (!fileStats.isFile()) {
      await fileHandle.close();
      throw notFound("Album video file not found");
    }
    return { fileHandle, fileStats };
  } catch (error) {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
    }
    if (localFileNotFound(error)) {
      throw notFound("Album video file not found");
    }
    throw error;
  }
}

export async function inspectLocalAlbumVideoObject({
  filePath,
  sourceUrl,
  contentType,
  openFile = open
} = {}) {
  const { fileHandle, fileStats } = await openLocalAlbumVideo(filePath, openFile);
  try {
    const headerBytes = Buffer.alloc(12);
    const { bytesRead } = await fileHandle.read(headerBytes, 0, headerBytes.length, 0);
    return validateAlbumVideoObject({
      byteSize: fileStats.size,
      contentType,
      sourceUrl,
      headerBytes: headerBytes.subarray(0, bytesRead)
    });
  } finally {
    await fileHandle.close();
  }
}

export async function createLocalAlbumVideoResponse({
  filePath,
  method = "GET",
  range,
  openFile = open
} = {}) {
  const { fileHandle, fileStats } = await openLocalAlbumVideo(filePath, openFile);

  const size = fileStats.size;
  const baseHeaders = {
    "content-type": "video/mp4",
    "accept-ranges": "bytes"
  };
  if (String(method).toUpperCase() === "HEAD") {
    await fileHandle.close();
    return {
      statusCode: 200,
      headers: { ...baseHeaders, "content-length": size },
      body: null
    };
  }

  if (range !== undefined && range !== null) {
    let parsedRange;
    try {
      parsedRange = parseSingleByteRange(range, size);
    } catch (error) {
      if (Number(error?.statusCode) !== 416) {
        await fileHandle.close();
        throw error;
      }
      await fileHandle.close();
      return {
        statusCode: 416,
        headers: {
          ...baseHeaders,
          "content-range": `bytes */${size}`,
          "content-length": 0
        },
        body: null
      };
    }
    const contentLength = parsedRange.end - parsedRange.start + 1;
    try {
      return {
        statusCode: 206,
        headers: {
          ...baseHeaders,
          "content-range": `bytes ${parsedRange.start}-${parsedRange.end}/${size}`,
          "content-length": contentLength
        },
        body: fileHandle.createReadStream({ ...parsedRange, autoClose: true })
      };
    } catch (error) {
      await fileHandle.close();
      throw error;
    }
  }

  try {
    return {
      statusCode: 200,
      headers: { ...baseHeaders, "content-length": size },
      body: fileHandle.createReadStream({ autoClose: true })
    };
  } catch (error) {
    await fileHandle.close();
    throw error;
  }
}

export function validateMultipartAlbumVideo({ bytes, byteSize, contentType, filename } = {}) {
  const actualByteSize = bytes && Number.isSafeInteger(bytes.length) ? bytes.length : 0;
  const normalizedByteSize = normalizeByteSize(byteSize);
  normalizeByteSize(actualByteSize);
  if (actualByteSize !== normalizedByteSize) {
    throw badRequest("album video byte size does not match uploaded bytes");
  }
  return validateMultipartAlbumVideoMetadata({
    byteSize: normalizedByteSize,
    contentType,
    filename,
    headerBytes: bytes
  });
}

export function validateMultipartAlbumVideoMetadata({
  byteSize,
  contentType,
  filename,
  headerBytes
} = {}) {
  const normalizedByteSize = normalizeByteSize(byteSize);
  if (!isMp4FileHeader(headerBytes)) {
    throw badRequest("album video must contain an MP4 ftyp header");
  }

  const normalizedContentType = normalizeContentType(contentType, { required: false });
  if (filename !== undefined && filename !== null && String(filename).trim() !== "") {
    if (!/\.mp4$/i.test(String(filename).trim())) {
      throw badRequest("album video filename must use the .mp4 extension");
    }
  }

  return {
    byteSize: normalizedByteSize,
    contentType: normalizedContentType || "video/mp4"
  };
}

export function validateCosAlbumVideoHeaders({ contentLength, contentType } = {}) {
  const result = {};
  const normalizedByteSize = normalizeByteSize(contentLength, { required: false });
  if (normalizedByteSize !== undefined) result.byteSize = normalizedByteSize;
  const normalizedContentType = normalizeContentType(contentType, { required: false });
  if (normalizedContentType !== undefined) result.contentType = normalizedContentType;
  return result;
}
