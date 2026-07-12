import crypto from "node:crypto";

import { normalizeProviderResult } from "./normalize.js";

export const TENCENT_VIDEO_CALLBACK_MAX_BYTES = 1024 * 1024;
const VIDEO_SOURCE_OBJECT_KEY = /^uploads\/session-album\/videos\/source\/[A-Za-z0-9._-]+\.mp4$/;
const DETAIL_DECISION_BY_RESULT = Object.freeze({
  0: "pass",
  1: "block",
  2: "review"
});

function invalidCallback(message) {
  const error = new Error(message);
  error.code = "CONTENT_MODERATION_INVALID_CALLBACK";
  error.statusCode = 400;
  return error;
}
export function authenticateTencentCallback(providedToken, expectedTokens) {
  const provided = Buffer.from(String(providedToken || ""), "utf8");
  const candidates = Array.isArray(expectedTokens) ? expectedTokens : [expectedTokens];
  let matched = false;
  for (const candidate of candidates) {
    const expected = Buffer.from(String(candidate || ""), "utf8");
    if (provided.length > 0 && provided.length === expected.length) {
      matched = crypto.timingSafeEqual(provided, expected) || matched;
    }
  }
  return matched;
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
      State: xmlTag(detail, "State"),
      Result: xmlTag(detail, "Result"),
      Label: xmlTag(detail, "Label"),
      SubLabel: xmlTag(detail, "SubLabel"),
      Score: xmlTag(detail, "Score")
    };
  }
  throw invalidCallback("callback body format is unsupported");
}

function normalizeTencentVideoCallbackResult(detail) {
  const normalized = normalizeProviderResult(detail);
  const state = String(detail?.State ?? detail?.state ?? "").trim().toLowerCase();
  const resultCode = String(detail?.Result ?? detail?.result ?? "").trim();
  const decision = state === "success" ? DETAIL_DECISION_BY_RESULT[resultCode] : "";
  if (!decision) return { ...normalized, decision: "error", suggestion: "" };
  return { ...normalized, decision, suggestion: decision };
}

export function parseTencentCallbackPayload(rawBody) {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
  if (!body || Buffer.byteLength(body, "utf8") > TENCENT_VIDEO_CALLBACK_MAX_BYTES) {
    throw invalidCallback("callback body size is invalid");
  }
  const detail = parseBody(body);
  const result = normalizeTencentVideoCallbackResult(detail);
  const providerJobId = String(detail.JobId || "").trim();
  const dataId = String(detail.DataId || "").trim();
  const objectKey = String(detail.Object || "").replace(/^\//, "").trim();
  if (
    !providerJobId || !dataId ||
    !VIDEO_SOURCE_OBJECT_KEY.test(objectKey)
  ) {
    throw invalidCallback("callback identifiers or object are invalid");
  }
  return { providerJobId, dataId, objectKey, result };
}

export async function resolveTencentVideoCallback({
  callback,
  withDatabaseConnection,
  repository
} = {}) {
  if (!callback?.providerJobId || !callback?.dataId ||
      typeof withDatabaseConnection !== "function" || !repository) {
    throw new TypeError("valid Tencent video callback dependencies are required");
  }
  const resolved = await withDatabaseConnection(async (connection) => {
    const job = await repository.findModerationJobByDataId(connection, callback.dataId);
    if (!job) return { retryable: false, stale: true, job: null };
    const attempt = await repository.findModerationAttemptByProviderJobId(
      connection,
      "tencent_ci_video",
      callback.providerJobId
    );
    if (attempt && Number(attempt.moderation_job_id) === Number(job.id)) {
      return { retryable: false, stale: false, job };
    }
    if (attempt) return { retryable: false, stale: true, job: null };
    const awaitingAttempt =
      String(job.provider) === "tencent_ci_video" &&
      String(job.subject_type) === "album_video" &&
      ["pending", "error"].includes(String(job.status)) &&
      (job.decided_by_admin_user_id === null || job.decided_by_admin_user_id === undefined);
    return {
      retryable: awaitingAttempt,
      stale: !awaitingAttempt,
      job: null
    };
  });
  return resolved;
}
