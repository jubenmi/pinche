export const MODERATION_DECISIONS = Object.freeze(["pass", "review", "block", "error"]);

export const MODERATION_JOB_STATUSES = Object.freeze([
  "pending",
  "processing",
  "approved",
  "review",
  "rejected",
  "error",
  "cancelled"
]);

export const MODERATION_PROVIDERS = Object.freeze(["wechat_sec_check", "tencent_ci_video"]);

// A WeChat retry can include two bounded token refreshes and two bounded
// content-security requests after a token-invalid response. Keep every worker
// lease above that chain so an older worker cannot submit concurrently after a
// newer worker reclaims its job.
export const MODERATION_RETRY_LEASE_MIN_MS = 90_000;

// The retry worker must dispatch only these exact provider / subject-type
// pairs. Keeping the pairs explicit prevents a provider-wide SQL filter from
// accidentally claiming an unsupported combination (for example WeChat video
// or Tencent text) while a handler is added or changed.
export const MODERATION_RETRY_ROUTES = Object.freeze([
  "user_nickname",
  "private_store",
  "private_script",
  "session_create",
  "session_update",
  "session_npc_role",
  "session_review",
  "session_message",
  "session_pinned_message"
].map((subjectType) => Object.freeze({
  provider: "wechat_sec_check",
  subjectType
})).concat(Object.freeze([
  Object.freeze({ provider: "wechat_sec_check", subjectType: "album_image" }),
  Object.freeze({ provider: "wechat_sec_check", subjectType: "avatar_image" }),
  Object.freeze({ provider: "wechat_sec_check", subjectType: "review_image" }),
  Object.freeze({ provider: "tencent_ci_video", subjectType: "album_video" })
])));

export const MODERATION_IMAGE_SUBJECT_TYPES = Object.freeze([
  "album_image",
  "avatar_image",
  "review_image"
]);

export const MODERATION_MEDIA_VISIBLE_STATUSES = Object.freeze([
  "approved",
  "approved_legacy"
]);

export const MODERATION_ERROR_CODES = Object.freeze({
  rejected: "CONTENT_MODERATION_REJECTED",
  reviewPending: "CONTENT_MODERATION_REVIEW_PENDING",
  unavailable: "CONTENT_MODERATION_UNAVAILABLE",
  configuration: "CONTENT_MODERATION_CONFIGURATION_ERROR",
  openidRequired: "CONTENT_MODERATION_OPENID_REQUIRED",
  callbackUnauthorized: "CONTENT_MODERATION_CALLBACK_UNAUTHORIZED",
  callbackStale: "CONTENT_MODERATION_CALLBACK_STALE",
  proposalStale: "CONTENT_MODERATION_PROPOSAL_STALE",
  invalidTransition: "CONTENT_MODERATION_INVALID_TRANSITION"
});
