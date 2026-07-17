const STATUS_TEXT = Object.freeze({
  pending: "内容正在安全审核",
  processing: "内容正在安全审核",
  error: "内容正在安全审核",
  review: "内容正在安全审核",
  rejected: "内容未通过安全审核"
});

const AUTHOR_PRIVATE_STATUS_TEXT = Object.freeze({
  pending: "仅自己可见 · 审核中",
  processing: "仅自己可见 · 审核中",
  error: "仅自己可见 · 审核中",
  review: "仅自己可见 · 进一步审核",
  rejected: "仅自己可见 · 未通过"
});

const ERROR_STATUS = Object.freeze({
  CONTENT_MODERATION_UNAVAILABLE: "error",
  WECHAT_CONTENT_SECURITY_RESPONSE_INVALID: "error",
  CONTENT_MODERATION_REVIEW_PENDING: "review",
  CONTENT_MODERATION_REJECTED: "rejected"
});

const ERROR_TEXT = Object.freeze({
  CONTENT_MODERATION_INTAKE_CLOSED: "内容安全服务暂未就绪，暂时无法发布，请稍后再试"
});

export function contentModerationStatusText(status) {
  return STATUS_TEXT[String(status || "").trim().toLowerCase()] || "";
}

export function isContentModerationError(error = {}) {
  const code = String(error?.code || "").trim();
  return code.startsWith("CONTENT_MODERATION_") || code.startsWith("WECHAT_CONTENT_SECURITY_");
}

export function authorPrivateContentModerationStatusText(status) {
  return AUTHOR_PRIVATE_STATUS_TEXT[String(status || "").trim().toLowerCase()] || "";
}

export function contentModerationErrorText(error = {}) {
  const code = String(error?.code || "").trim();
  const knownText = ERROR_TEXT[code] || contentModerationStatusText(ERROR_STATUS[code]);
  if (knownText) return knownText;
  return isContentModerationError(error) ? STATUS_TEXT.error : "";
}
