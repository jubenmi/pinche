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

function isDispositionTokenCharacter(char) {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]$/.test(char);
}

function skipDispositionWhitespace(text, index) {
  let cursor = index;
  while (cursor < text.length && /[ \t]/.test(text[cursor])) cursor += 1;
  return cursor;
}

function parseQuotedDispositionValue(text, index) {
  if (text[index] !== '"') return null;
  let cursor = index + 1;
  let value = "";
  while (cursor < text.length) {
    const char = text[cursor];
    cursor += 1;
    if (char === '"') return { value, index: cursor };
    if (char === "\\") {
      if (cursor >= text.length || /[\r\n]/.test(text[cursor])) return null;
      value += text[cursor];
      cursor += 1;
      continue;
    }
    if (/[\r\n]/.test(char)) return null;
    value += char;
  }
  return null;
}

function parseVideoContentDisposition(value) {
  const text = String(value || "");
  let cursor = skipDispositionWhitespace(text, 0);
  const typeStart = cursor;
  while (cursor < text.length && isDispositionTokenCharacter(text[cursor])) cursor += 1;
  if (text.slice(typeStart, cursor).toLowerCase() !== "form-data") {
    throw badRequest("album video multipart disposition is invalid");
  }

  const parameters = new Map();
  while (true) {
    cursor = skipDispositionWhitespace(text, cursor);
    if (cursor === text.length) break;
    if (text[cursor] !== ";") {
      throw badRequest("album video multipart disposition is invalid");
    }
    cursor = skipDispositionWhitespace(text, cursor + 1);
    const nameStart = cursor;
    while (cursor < text.length && isDispositionTokenCharacter(text[cursor])) cursor += 1;
    const name = text.slice(nameStart, cursor).toLowerCase();
    if (!name) throw badRequest("album video multipart disposition is invalid");
    cursor = skipDispositionWhitespace(text, cursor);
    if (text[cursor] !== "=") {
      throw badRequest("album video multipart disposition is invalid");
    }
    cursor = skipDispositionWhitespace(text, cursor + 1);
    const parsedValue = parseQuotedDispositionValue(text, cursor);
    if (!parsedValue) {
      throw badRequest("album video multipart disposition parameters must be quoted");
    }
    cursor = skipDispositionWhitespace(text, parsedValue.index);
    if (cursor < text.length && text[cursor] !== ";") {
      throw badRequest("album video multipart disposition is invalid");
    }
    if (parameters.has(name)) {
      throw badRequest("album video multipart disposition has duplicate parameters");
    }
    if (name !== "name" && name !== "filename") {
      throw badRequest("album video multipart disposition has unsupported parameters");
    }
    parameters.set(name, parsedValue.value);
  }

  const partName = parameters.get("name");
  const filename = parameters.get("filename");
  if (partName !== "video" || !filename) {
    throw badRequest("album video upload accepts exactly one video file part");
  }
  return { filename };
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

  const disposition = parseVideoContentDisposition(headers["content-disposition"]);
  const allowedHeaders = new Set(["content-disposition", "content-type"]);
  for (const headerName of Object.keys(headers)) {
    if (!allowedHeaders.has(headerName)) {
      throw badRequest("album video multipart contains an unsupported part header");
    }
  }
  return {
    filename: disposition.filename,
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
    if (tempCreated) await unlinkIfPresent(tempPath, unlinkFile);
    cleaned = true;
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
        const trailingLength = combined.length - match.afterOffset;
        if (
          trailingLength > 2 ||
          (trailingLength >= 1 && combined[match.afterOffset] !== 13) ||
          (trailingLength === 2 && combined[match.afterOffset + 1] !== 10)
        ) {
          throw badRequest("album video multipart closing boundary is invalid");
        }
        state = "closed";
        trailing = Buffer.from(combined.subarray(match.afterOffset, match.afterOffset + trailingLength));
        tail = Buffer.alloc(0);
        return;
      }

      const retainBytes = match?.incomplete
        ? combined.length - match.index
        : Math.min(combined.length, delimiter.length + 1);
      const writeEnd = combined.length - retainBytes;
      await writePayload(combined.subarray(0, writeEnd));
      // Do not keep a view onto a potentially multi-megabyte request chunk just
      // to retain the small suffix that may be the next boundary.
      tail = Buffer.from(combined.subarray(writeEnd));
      onProgress?.({ pendingBytes: tail.length, fileBytes, totalBytes });
    };

    for await (const rawChunk of request) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      totalBytes += chunk.length;
      if (totalBytes > maxRequestBytes) {
        throw badRequest("album video multipart request is too large");
      }

      if (state === "closed") {
        if (trailing.length + chunk.length > 2) {
          throw badRequest("album video multipart contains data after the closing boundary");
        }
        trailing = Buffer.concat([trailing, chunk]);
        if (!Buffer.from("\r\n").subarray(0, trailing.length).equals(trailing)) {
          throw badRequest("album video multipart contains data after the closing boundary");
        }
        continue;
      }

      if (state === "headers") {
        // Probe only enough bytes to establish whether the header separator
        // occurs within the configured header limit. The rest of a large first
        // chunk is file payload, not header state, and must be passed through.
        const headerCapacity = maxHeaderBytes + headerSeparator.length;
        const probeLength = Math.max(0, headerCapacity - headerBuffer.length);
        const probe = chunk.subarray(0, probeLength);
        const candidate = headerBuffer.length === 0
          ? probe
          : Buffer.concat([headerBuffer, probe]);
        const separatorIndex = candidate.indexOf(headerSeparator);
        if (separatorIndex === -1) {
          if (candidate.length >= headerCapacity) {
            throw badRequest("album video multipart headers are too large");
          }
          // Copy the bounded prefix rather than retaining a view of the full
          // incoming chunk in headerBuffer.
          headerBuffer = Buffer.from(candidate);
          continue;
        }
        if (separatorIndex > maxHeaderBytes) {
          throw badRequest("album video multipart headers are too large");
        }
        partMetadata = parseVideoPartHeaders(candidate.subarray(0, separatorIndex), boundary);
        const fileStartInChunk = separatorIndex + headerSeparator.length - headerBuffer.length;
        if (fileStartInChunk < 0 || fileStartInChunk > chunk.length) {
          throw badRequest("album video multipart header boundary is invalid");
        }
        headerBuffer = Buffer.alloc(0);
        state = "file";
        await consumeFileBytes(chunk.subarray(fileStartInChunk));
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
    try {
      await cleanup();
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
    }
    throw error;
  }
}

export async function finalizeLocalAlbumVideoUpload({
  tempPath,
  destinationPath,
  linkFile = link,
  unlinkFile = unlink
} = {}) {
  let primaryError;
  try {
    await linkFile(tempPath, destinationPath);
    return destinationPath;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await unlinkIfPresent(tempPath, unlinkFile);
    } catch (cleanupError) {
      if (primaryError) primaryError.cleanupError = cleanupError;
      else throw cleanupError;
    }
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
  let primaryError;
  try {
    return await putObject({
      key,
      body,
      contentLength: byteSize,
      contentType,
      forbidOverwrite: true,
      config
    });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    body.destroy?.();
    try {
      await unlinkIfPresent(tempPath, unlinkFile);
    } catch (cleanupError) {
      if (primaryError) primaryError.cleanupError = cleanupError;
      else throw cleanupError;
    }
  }
}
