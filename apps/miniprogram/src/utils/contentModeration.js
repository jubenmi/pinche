const STATUS_TEXT = Object.freeze({
  pending: "内容正在审核",
  processing: "内容正在审核",
  error: "内容正在审核",
  review: "内容需要进一步审核",
  rejected: "内容未通过安全审核，如有疑问请联系客服"
});

const ERROR_STATUS = Object.freeze({
  CONTENT_MODERATION_UNAVAILABLE: "error",
  WECHAT_CONTENT_SECURITY_RESPONSE_INVALID: "error",
  CONTENT_MODERATION_REVIEW_PENDING: "review",
  CONTENT_MODERATION_REJECTED: "rejected"
});

// This is intentionally a closed whitelist. User-facing copy must never
// inherit a provider name, score, label, or hit word from an API response.
export function contentModerationStatusText(status) {
  return STATUS_TEXT[String(status || "").trim().toLowerCase()] || "";
}

export function contentModerationErrorText(error = {}) {
  return contentModerationStatusText(ERROR_STATUS[String(error?.code || "").trim()]);
}
