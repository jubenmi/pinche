export const AUTHOR_VISIBILITY_SCOPES = Object.freeze({
  public: "public",
  authorOnly: "author_only",
  hidden: "hidden"
});

const PUBLIC_MODERATION_STATUSES = new Set(["approved", "approved_legacy"]);
const AUTHOR_PRIVATE_MODERATION_STATUSES = new Set([
  "pending",
  "processing",
  "review",
  "rejected",
  "error"
]);
const CONTENT_KINDS = new Set(["text", "image", "video"]);
const HIDDEN = Object.freeze({
  scope: AUTHOR_VISIBILITY_SCOPES.hidden,
  canPreview: false,
  canEdit: false,
  canDelete: false,
  canResubmit: false
});
const PUBLIC = Object.freeze({
  scope: AUTHOR_VISIBILITY_SCOPES.public,
  canPreview: true,
  canEdit: false,
  canDelete: false,
  canResubmit: false
});

function positiveSafeInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function resolveAuthorVisibility({
  viewerUserId,
  authorUserId,
  moderationStatus,
  authorVisibilityVersion,
  recordStatus,
  contentKind = "text"
} = {}) {
  if (recordStatus !== "active") return { ...HIDDEN };

  const normalizedStatus = typeof moderationStatus === "string" ? moderationStatus : "";
  if (PUBLIC_MODERATION_STATUSES.has(normalizedStatus)) return { ...PUBLIC };
  if (
    authorVisibilityVersion !== 1 ||
    !AUTHOR_PRIVATE_MODERATION_STATUSES.has(normalizedStatus) ||
    !CONTENT_KINDS.has(contentKind)
  ) {
    return { ...HIDDEN };
  }

  const viewerId = positiveSafeInteger(viewerUserId);
  const authorId = positiveSafeInteger(authorUserId);
  if (viewerId === null || authorId === null || viewerId !== authorId) {
    return { ...HIDDEN };
  }

  const rejectedText = normalizedStatus === "rejected" && contentKind === "text";
  return {
    scope: AUTHOR_VISIBILITY_SCOPES.authorOnly,
    canPreview: true,
    canEdit: rejectedText,
    canDelete: true,
    canResubmit: rejectedText
  };
}
