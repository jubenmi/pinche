const ACTIONS = Object.freeze([
  "update_nickname",
  "create_private_store",
  "create_private_script",
  "create_session",
  "update_session",
  "create_session_npc_role",
  "update_session_npc_role",
  "upsert_session_review",
  "create_session_message",
  "update_session_pinned_message"
]);

export const AUTHOR_PRIVATE_TEXT_ACTIONS = ACTIONS;
const AUTHOR_PRIVATE_TEXT_ACTION_SET = new Set(ACTIONS);

const INPUT_FIELDS = new Set([
  "draftId",
  "action",
  "moderationStatus",
  "publishedId",
  "content",
  "visibility"
]);
const MODERATION_MESSAGES = Object.freeze({
  pending: "仅自己可见 · 审核中",
  processing: "仅自己可见 · 审核中",
  error: "仅自己可见 · 审核中",
  review: "仅自己可见 · 进一步审核",
  rejected: "仅自己可见 · 未通过"
});
const FORBIDDEN_CONTENT_KEYS = new Set([
  "openid",
  "phonenumber",
  "phone",
  "context",
  "baseversion",
  "idempotencykey",
  "provider",
  "providerresult",
  "label",
  "sublabel",
  "score",
  "normalizedpayloadjson",
  "responsesummaryjson",
  "payloaddigest",
  "moderationjobid",
  "dataid",
  "policyid",
  "objectkey",
  "secretid",
  "secretkey",
  "accesstoken"
]);

function invalidAuthorDto(reason) {
  const error = new TypeError(`invalid author-private DTO: ${reason}`);
  error.code = "CONTENT_MODERATION_AUTHOR_DTO_INVALID";
  return error;
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function positiveSafeInteger(value, field) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^[1-9]\d*$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw invalidAuthorDto(field);
  return parsed;
}

function normalizedKey(key) {
  return String(key).replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function cloneSafeContent(value, path = "content") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidAuthorDto(path);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => cloneSafeContent(entry, `${path}[${index}]`));
  }
  if (!isPlainRecord(value)) throw invalidAuthorDto(path);

  const cloned = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    if (
      !normalized ||
      ["__proto__", "constructor", "prototype"].includes(key) ||
      FORBIDDEN_CONTENT_KEYS.has(normalized)
    ) {
      throw invalidAuthorDto(`${path}.${key}`);
    }
    cloned[key] = cloneSafeContent(entry, `${path}.${key}`);
  }
  return cloned;
}

function assertVisibility(visibility, moderationStatus) {
  if (
    !isPlainRecord(visibility) ||
    visibility.scope !== "author_only" ||
    visibility.canPreview !== true ||
    visibility.canDelete !== true ||
    typeof visibility.canEdit !== "boolean" ||
    typeof visibility.canResubmit !== "boolean"
  ) {
    throw invalidAuthorDto("visibility");
  }
  const rejected = moderationStatus === "rejected";
  if (
    visibility.canEdit !== rejected ||
    visibility.canResubmit !== rejected
  ) {
    throw invalidAuthorDto("visibility capabilities");
  }
}

export function createAuthorPrivateTextDto(input = {}) {
  if (!isPlainRecord(input)) throw invalidAuthorDto("input");
  for (const key of Object.keys(input)) {
    if (!INPUT_FIELDS.has(key)) throw invalidAuthorDto(key);
  }
  if (!AUTHOR_PRIVATE_TEXT_ACTION_SET.has(input.action)) {
    throw invalidAuthorDto("action");
  }
  const moderationMessage = MODERATION_MESSAGES[input.moderationStatus];
  if (!moderationMessage) throw invalidAuthorDto("moderationStatus");

  const draftId = positiveSafeInteger(input.draftId, "draftId");
  const publishedId = input.publishedId === null || input.publishedId === undefined
    ? null
    : positiveSafeInteger(input.publishedId, "publishedId");
  assertVisibility(input.visibility, input.moderationStatus);

  return {
    draft_id: draftId,
    content_ref: `text-proposal:${draftId}`,
    publication_state: "author_only",
    moderation_status: input.moderationStatus,
    moderation_message: moderationMessage,
    published_id: publishedId,
    content: cloneSafeContent(input.content),
    can_edit: input.visibility.canEdit,
    can_delete: input.visibility.canDelete,
    can_resubmit: input.visibility.canResubmit
  };
}
