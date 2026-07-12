import crypto from "node:crypto";

import { normalizeProviderResult } from "./normalize.js";

const MAX_CALLBACK_BYTES = 256 * 1024;

function invalidCallback(message) {
  const error = new Error(message);
  error.code = "CONTENT_MODERATION_INVALID_CALLBACK";
  error.statusCode = 400;
  return error;
}
export function authenticateTencentCallback(providedToken, expectedToken) {
  const provided = Buffer.from(String(providedToken || ""), "utf8");
  const expected = Buffer.from(String(expectedToken || ""), "utf8");
  return provided.length > 0 && provided.length === expected.length &&
    crypto.timingSafeEqual(provided, expected);
}

function xmlTag(source, name) {
  const match = String(source).match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match?.[1]
    ?.replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&") || "";
}

function parseBody(body) {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      return parsed.JobsDetail || parsed.Response?.JobsDetail || parsed;
    } catch {
      throw invalidCallback("callback JSON is invalid");
    }
  }
  if (trimmed.startsWith("<")) {
    const detail = xmlTag(trimmed, "JobsDetail") || trimmed;
    return {
      JobId: xmlTag(detail, "JobId"),
      DataId: xmlTag(detail, "DataId"),
      Object: xmlTag(detail, "Object"),
      Suggestion: xmlTag(detail, "Suggestion"),
      Label: xmlTag(detail, "Label"),
      SubLabel: xmlTag(detail, "SubLabel"),
      Score: xmlTag(detail, "Score")
    };
  }
  throw invalidCallback("callback body format is unsupported");
}

export function parseTencentCallbackPayload(rawBody) {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
  if (!body || Buffer.byteLength(body, "utf8") > MAX_CALLBACK_BYTES) {
    throw invalidCallback("callback body size is invalid");
  }
  const detail = parseBody(body);
  const result = normalizeProviderResult(detail);
  const providerJobId = String(detail.JobId || detail.jobId || result.providerJobId || "").trim();
  const dataId = String(detail.DataId || detail.dataId || result.dataId || "").trim();
  const objectKey = String(
    detail.Object || detail.object || detail.Input?.Object || detail.input?.object || ""
  ).replace(/^\//, "").trim();
  if (
    !providerJobId || !dataId ||
    !/^uploads\/session-album\/(display|videos\/source)\/[A-Za-z0-9._-]+$/.test(objectKey) ||
    result.decision === "error"
  ) {
    throw invalidCallback("callback identifiers or decision are invalid");
  }
  return { providerJobId, dataId, objectKey, result };
}
