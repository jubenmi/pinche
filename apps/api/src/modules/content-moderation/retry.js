import crypto from "node:crypto";

import { MODERATION_RETRY_LEASE_MIN_MS, MODERATION_RETRY_ROUTES } from "./constants.js";
import { emitModerationSubmissionFailure } from "./telemetry.js";

export { MODERATION_RETRY_ROUTES } from "./constants.js";

const OPERATIONAL_CODES = new Set([
  "WECHAT_CONTENT_SECURITY_TOKEN_INVALID",
  "WECHAT_CONTENT_SECURITY_PERMISSION_DENIED",
  "WECHAT_CONTENT_SECURITY_QUOTA_EXHAUSTED",
  "CONTENT_MODERATION_OPENID_REQUIRED",
  "CONTENT_MODERATION_RETRY_FACTS_INVALID",
  "AuthFailure",
  "UnauthorizedOperation",
  "InvalidParameter.BizType",
  "LimitExceeded",
  "ResourceUnavailable",
  "FailedOperation.BalanceNotEnough"
]);
const TRANSIENT_CODES = new Set([
  "WECHAT_CONTENT_SECURITY_NETWORK_ERROR",
  "WECHAT_CONTENT_SECURITY_TIMEOUT",
  "WECHAT_CONTENT_SECURITY_RATE_LIMITED",
  "WECHAT_CONTENT_SECURITY_UPSTREAM_5XX",
  "TENCENT_CI_VIDEO_NETWORK_ERROR",
  "TENCENT_CI_VIDEO_TIMEOUT",
  "TENCENT_CI_VIDEO_RATE_LIMITED",
  "TENCENT_CI_VIDEO_UPSTREAM_5XX",
  // Keep the older COS codes retryable while historical video jobs drain.
  "COS_NETWORK_ERROR",
  "COS_REQUEST_TIMEOUT",
  "RequestLimitExceeded",
  "InternalError"
]);
const ALERTING_TRANSIENT_CODES = new Set([
  "WECHAT_CONTENT_SECURITY_TOKEN_UNAVAILABLE",
  "TENCENT_CI_VIDEO_RATE_LIMITED",
  "RequestLimitExceeded"
]);

function safeErrorCode(error) {
  const code = String(error?.code || "").trim();
  if (!code) return "CONTENT_MODERATION_UNAVAILABLE";
  return /^[A-Za-z0-9_.-]{1,128}$/.test(code)
    ? code
    : "CONTENT_MODERATION_UNKNOWN_ERROR";
}

function nowMilliseconds(now) {
  const value = now();
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(milliseconds) ? milliseconds : Date.now();
}

export function classifyModerationError(error) {
  const rawCode = safeErrorCode(error);
  if (ALERTING_TRANSIENT_CODES.has(rawCode)) return { retryable: true, alert: true, code: rawCode };
  if (OPERATIONAL_CODES.has(rawCode)) return { retryable: false, alert: true, code: rawCode };
  if (TRANSIENT_CODES.has(rawCode) || rawCode === "CONTENT_MODERATION_UNAVAILABLE") {
    return { retryable: true, alert: false, code: rawCode };
  }
  return { retryable: false, alert: true, code: "CONTENT_MODERATION_UNKNOWN_ERROR" };
}
export function moderationRetryAt(nowMs, attempts, random = Math.random) {
  const base = Math.min(6 * 60 * 60 * 1000, 30_000 * (2 ** Math.max(0, attempts - 1)));
  const jittered = Math.min(6 * 60 * 60 * 1000, Math.round(base * (1 + 0.25 * random())));
  return new Date(nowMs + jittered);
}

export async function runContentModerationRetryBatch({
  repository,
  withTransaction,
  processJob,
  routes = MODERATION_RETRY_ROUTES,
  now = () => Date.now(),
  randomUUID = () => crypto.randomUUID(),
  random = Math.random,
  retryLimit = 8,
  limit = 25,
  leaseMs = MODERATION_RETRY_LEASE_MIN_MS,
  signal,
  isStopping = () => false,
  emit = () => {}
}) {
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new TypeError("at least one strict moderation retry route is required");
  }
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError("limit must be a positive integer");
  if (typeof isStopping !== "function") throw new TypeError("isStopping must be a function");
  if (!Number.isFinite(leaseMs) || leaseMs < MODERATION_RETRY_LEASE_MIN_MS) {
    throw new TypeError(`leaseMs must be at least ${MODERATION_RETRY_LEASE_MIN_MS} milliseconds`);
  }
  const shouldStop = () => Boolean(signal?.aborted) || isStopping();
  let claimed = 0;
  let failed = 0;
  while (claimed < limit && !shouldStop()) {
    const leaseToken = randomUUID();
    const claimedAt = nowMilliseconds(now);
    const jobs = await withTransaction((connection) => repository.claimModerationRetryJobs(
      connection,
      {
        routes,
        leaseToken,
        now: new Date(claimedAt),
        leaseExpiresAt: new Date(claimedAt + leaseMs),
        retryLimit,
        limit: 1
      }
    ));
    const job = jobs[0];
    if (!job) break;
    if (shouldStop()) break;
    claimed += 1;
    try {
      await processJob(job);
    } catch (error) {
      failed += 1;
      const attempts = Number(job.attempt_count || 0) + 1;
      const classification = classifyModerationError(error);
      const exhausted = attempts >= retryLimit || !classification.retryable;
      const persisted = await withTransaction((connection) => repository.failModerationJob(connection, {
        jobId: job.id,
        leaseToken: job.lease_token,
        attempts,
        nextRetryAt: exhausted ? null : moderationRetryAt(nowMilliseconds(now), attempts, random),
        errorCode: classification.code,
        exhausted
      }));
      if (!persisted) continue;
      emitModerationSubmissionFailure({
        emit,
        provider: job.provider,
        subjectType: job.subject_type,
        errorCode: classification.code,
        attempt: attempts,
        retryScheduled: !exhausted,
        retryExhausted: exhausted && classification.retryable,
        alert: classification.alert
      });
    }
    if (shouldStop()) break;
  }
  return { claimed, failed };
}
