import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { link, mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";

import { badRequest } from "../../http/errors.js";
import { putCosObject } from "../../storage/cos.js";
import {
  MAX_ALBUM_VIDEO_BYTES,
  validateMultipartAlbumVideoMetadata
} from "./media.js";

export const ALBUM_VIDEO_MULTIPART_HEADER_MAX_BYTES = 64 * 1024;
export const ALBUM_VIDEO_MULTIPART_OVERHEAD_MAX_BYTES = 256 * 1024;

function multipartBoundary(contentType) {
  const text = String(contentType || "");
  if (!/^multipart\/form-data(?:\s*;|$)/i.test(text.trim())) {
    throw badRequest("album video upload must be multipart/form-data");
  }
  const boundary = text.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i)?.slice(1).find(Boolean) || "";
  if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary)) {
    throw badRequest("multipart boundary is required");
  }
  return boundary;
}

function parseVideoPartHeaders(bytes, boundary) {
  const expectedPrefix = `--${boundary}\r\n`;
  const text = bytes.toString("utf8");
  if (!text.startsWith(expectedPrefix)) {
    throw badRequest("album video multipart body must contain one video part");
  }
  const headerText = text.slice(expectedPrefix.length);
  const lines = headerText ? headerText.split("\r\n") : [];
  const headers = {};
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator <= 0) throw badRequest("album video multipart header is invalid");
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!name || Object.hasOwn(headers, name)) {
      throw badRequest("album video multipart header is invalid");
    }
    headers[name] = value;
  }

  const disposition = headers["content-disposition"] || "";
  if (!/^form-data(?:;|$)/i.test(disposition)) {
    throw badRequest("album video multipart disposition is invalid");
  }
  const name = disposition.match(/(?:^|;)\s*name="([^"]*)"/i)?.[1];
  const filenameMatch = disposition.match(/(?:^|;)\s*filename="([^"]*)"/i);
  if (name !== "video" || !filenameMatch) {
    throw badRequest("album video upload accepts exactly one video file part");
  }
  const allowedHeaders = new Set(["content-disposition", "content-type"]);
  for (const headerName of Object.keys(headers)) {
    if (!allowedHeaders.has(headerName)) {
      throw badRequest("album video multipart contains an unsupported part header");
    }
  }
  return {
    filename: filenameMatch[1],
    contentType: headers["content-type"] || ""
  };
}

async function unlinkIfPresent(filePath, unlinkFile = unlink) {
  try {
    await unlinkFile(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function writeAll(fileHandle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await fileHandle.write(bytes, offset, bytes.length - offset, null);
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) {
      throw new Error("album video temporary file write made no progress");
    }
    offset += bytesWritten;
  }
}

function boundaryMatch(buffer, delimiter) {
  let offset = 0;
  while (offset <= buffer.length - delimiter.length) {
    const index = buffer.indexOf(delimiter, offset);
    if (index === -1) return null;
    const suffixOffset = index + delimiter.length;
    if (buffer.length < suffixOffset + 2) {
      return { incomplete: true, index };
    }
    const first = buffer[suffixOffset];
    const second = buffer[suffixOffset + 1];
    if ((first === 45 && second === 45) || (first === 13 && second === 10)) {
      return {
        incomplete: false,
        index,
        closing: first === 45,
        afterOffset: suffixOffset + 2
      };
    }
    offset = index + 1;
  }
  return null;
}

export async function parseMultipartAlbumVideoStream({
  request,
  contentType,
  tempDir,
  maxFileBytes = MAX_ALBUM_VIDEO_BYTES,
  maxRequestBytes = maxFileBytes + ALBUM_VIDEO_MULTIPART_OVERHEAD_MAX_BYTES,
  maxHeaderBytes = ALBUM_VIDEO_MULTIPART_HEADER_MAX_BYTES,
  openFile = open,
  unlinkFile = unlink,
  randomBytes = crypto.randomBytes,
  onProgress
} = {}) {
  if (!request || typeof request[Symbol.asyncIterator] !== "function") {
    throw new TypeError("multipart request must be an async iterable");
  }
  if (!tempDir) throw new TypeError("multipart tempDir is required");
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) {
    throw new TypeError("invalid multipart file byte limit");
  }
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes <= maxFileBytes) {
    throw new TypeError("invalid multipart request byte limit");
  }

  const boundary = multipartBoundary(contentType);
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  const headerSeparator = Buffer.from("\r\n\r\n");
  await mkdir(tempDir, { recursive: true });
  const tempPath = path.join(
    tempDir,
    `.album-video-${Date.now()}-${randomBytes(12).toString("hex")}.tmp`
  );
  let fileHandle;
  let tempCreated = false;
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    if (tempCreated) await unlinkIfPresent(tempPath, unlinkFile);
  };

  try {
    fileHandle = await openFile(tempPath, "wx");
    tempCreated = true;
    let state = "headers";
    let headerBuffer = Buffer.alloc(0);
    let tail = Buffer.alloc(0);
    let trailing = Buffer.alloc(0);
    let totalBytes = 0;
    let fileBytes = 0;
    let firstBytes = Buffer.alloc(0);
    let partMetadata = null;

    const writePayload = async (bytes) => {
      if (bytes.length === 0) return;
      if (fileBytes + bytes.length > maxFileBytes) {
        throw badRequest(`album video file is too large (maximum ${maxFileBytes} bytes)`);
      }
      if (firstBytes.length < 12) {
        const needed = 12 - firstBytes.length;
        firstBytes = Buffer.concat([firstBytes, bytes.subarray(0, needed)]);
      }
      await writeAll(fileHandle, bytes);
      fileBytes += bytes.length;
    };

    const consumeFileBytes = async (bytes) => {
      const combined = tail.length === 0 ? bytes : Buffer.concat([tail, bytes]);
      const match = boundaryMatch(combined, delimiter);
      if (match && !match.incomplete) {
        await writePayload(combined.subarray(0, match.index));
        if (!match.closing) {
          throw badRequest("album video upload accepts exactly one video file part");
        }
        state = "closed";
        trailing = combined.subarray(match.afterOffset);
        if (
          trailing.length > 2 ||
          (trailing.length >= 1 && trailing[0] !== 13) ||
          (trailing.length === 2 && trailing[1] !== 10)
        ) {
          throw badRequest("album video multipart closing boundary is invalid");
        }
        tail = Buffer.alloc(0);
        return;
      }

      const retainBytes = match?.incomplete
        ? combined.length - match.index
        : Math.min(combined.length, delimiter.length + 1);
      const writeEnd = combined.length - retainBytes;
      await writePayload(combined.subarray(0, writeEnd));
      tail = combined.subarray(writeEnd);
      onProgress?.({ pendingBytes: tail.length, fileBytes, totalBytes });
    };

    for await (const rawChunk of request) {
      const chunk = Buffer.from(rawChunk);
      totalBytes += chunk.length;
      if (totalBytes > maxRequestBytes) {
        throw badRequest("album video multipart request is too large");
      }

      if (state === "closed") {
        trailing = Buffer.concat([trailing, chunk]);
        if (trailing.length > 2 || !Buffer.from("\r\n").subarray(0, trailing.length).equals(trailing)) {
          throw badRequest("album video multipart contains data after the closing boundary");
        }
        continue;
      }

      if (state === "headers") {
        headerBuffer = Buffer.concat([headerBuffer, chunk]);
        const separatorIndex = headerBuffer.indexOf(headerSeparator);
        if (separatorIndex === -1) {
          if (headerBuffer.length > maxHeaderBytes) {
            throw badRequest("album video multipart headers are too large");
          }
          continue;
        }
        if (separatorIndex > maxHeaderBytes) {
          throw badRequest("album video multipart headers are too large");
        }
        partMetadata = parseVideoPartHeaders(headerBuffer.subarray(0, separatorIndex), boundary);
        const fileStart = separatorIndex + headerSeparator.length;
        const initialFileBytes = headerBuffer.subarray(fileStart);
        headerBuffer = Buffer.alloc(0);
        state = "file";
        await consumeFileBytes(initialFileBytes);
        continue;
      }

      await consumeFileBytes(chunk);
    }

    if (state !== "closed" || (trailing.length !== 0 && trailing.toString("binary") !== "\r\n")) {
      throw badRequest("album video multipart body is truncated");
    }
    await fileHandle.close();
    fileHandle = null;
    const validated = validateMultipartAlbumVideoMetadata({
      byteSize: fileBytes,
      contentType: partMetadata?.contentType,
      filename: partMetadata?.filename,
      headerBytes: firstBytes
    });
    return {
      tempPath,
      byteSize: validated.byteSize,
      contentType: validated.contentType,
      filename: partMetadata.filename,
      headerBytes: firstBytes,
      cleanup
    };
  } catch (error) {
    if (fileHandle) await fileHandle.close().catch(() => {});
    await cleanup().catch(() => {});
    throw error;
  }
}

export async function finalizeLocalAlbumVideoUpload({
  tempPath,
  destinationPath,
  linkFile = link,
  unlinkFile = unlink
} = {}) {
  try {
    await linkFile(tempPath, destinationPath);
    return destinationPath;
  } finally {
    await unlinkIfPresent(tempPath, unlinkFile);
  }
}

export async function uploadTempAlbumVideoToCos({
  tempPath,
  key,
  byteSize,
  contentType,
  config,
  putObject = putCosObject,
  createStream = createReadStream,
  unlinkFile = unlink
} = {}) {
  const body = createStream(tempPath);
  try {
    return await putObject({
      key,
      body,
      contentLength: byteSize,
      contentType,
      forbidOverwrite: true,
      config
    });
  } finally {
    body.destroy?.();
    await unlinkIfPresent(tempPath, unlinkFile);
  }
}
