export const MODERATION_DECISIONS = Object.freeze(["pass", "review", "block", "error"]);

export const MODERATION_JOB_STATUSES = Object.freeze([
  "pending",
  "processing",
  "approved",
  "review",
  "rejected",
  "error"
]);

export const MODERATION_PROVIDERS = Object.freeze(["tencent_ci", "tencent_tms"]);

export const MODERATION_MEDIA_VISIBLE_STATUSES = Object.freeze([
  "approved",
  "approved_legacy"
]);

export const MODERATION_ERROR_CODES = Object.freeze({
  rejected: "CONTENT_MODERATION_REJECTED",
  reviewPending: "CONTENT_MODERATION_REVIEW_PENDING",
  unavailable: "CONTENT_MODERATION_UNAVAILABLE",
  configuration: "CONTENT_MODERATION_CONFIGURATION_ERROR",
  callbackUnauthorized: "CONTENT_MODERATION_CALLBACK_UNAUTHORIZED",
  callbackStale: "CONTENT_MODERATION_CALLBACK_STALE",
  invalidTransition: "CONTENT_MODERATION_INVALID_TRANSITION"
});

