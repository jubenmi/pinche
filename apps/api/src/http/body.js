import { badRequest, invalidJson, payloadTooLarge } from "./errors.js";

export const DEFAULT_JSON_BODY_MAX_BYTES = 1024 * 1024;

function normalizedMaxBytes(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError("body policy maxBytes must be a non-negative safe integer");
  }
  return parsed;
}

function declaredContentLength(request) {
  const value = request.headers?.["content-length"];
  if (value === undefined) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  if (!/^\d+$/.test(String(raw || ""))) {
    throw badRequest("Content-Length must be a non-negative integer");
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw badRequest("Content-Length is outside the supported range");
  }
  return parsed;
}

export async function readBoundedBody(request, maxBytes) {
  const limit = normalizedMaxBytes(maxBytes, DEFAULT_JSON_BODY_MAX_BYTES);
  const declared = declaredContentLength(request);
  if (declared !== null && declared > limit) {
    throw payloadTooLarge();
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    totalBytes += chunk.length;
    if (totalBytes > limit) {
      throw payloadTooLarge();
    }
    chunks.push(chunk);
  }
  return chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks, totalBytes);
}

export async function readBody(request, policy = { kind: "none" }) {
  const kind = policy?.kind || "none";
  if (kind === "none") return undefined;
  if (kind === "stream") return request;

  const maxBytes = normalizedMaxBytes(
    policy?.maxBytes,
    kind === "json" ? DEFAULT_JSON_BODY_MAX_BYTES : 0
  );
  const raw = await readBoundedBody(request, maxBytes);
  if (kind === "raw") return raw;
  if (kind !== "json") throw new TypeError(`unsupported body policy: ${kind}`);
  if (raw.length === 0 || !raw.toString("utf8").trim()) return {};

  try {
    return JSON.parse(raw.toString("utf8"));
  } catch (error) {
    if (error?.code === "PAYLOAD_TOO_LARGE") throw error;
    throw invalidJson();
  }
}
