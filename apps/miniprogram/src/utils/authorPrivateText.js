const AUTHOR_PRIVATE_STATES = new Set(["pending", "processing", "error", "review", "rejected"]);

function positiveId(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function plainRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isAuthorPrivateText(value) {
  if (!plainRecord(value)) return false;
  const draftId = positiveId(value.draft_id);
  return Boolean(
    draftId !== null &&
    value.content_ref === `text-proposal:${draftId}` &&
    value.publication_state === "author_only" &&
    AUTHOR_PRIVATE_STATES.has(String(value.moderation_status || "")) &&
    typeof value.moderation_message === "string" &&
    plainRecord(value.content) &&
    typeof value.can_edit === "boolean" &&
    value.can_delete === true &&
    typeof value.can_resubmit === "boolean"
  );
}

export function authorPrivateStatusText(value) {
  return isAuthorPrivateText(value) ? value.moderation_message : "";
}

export function authorPrivateProfileUser(user, projection) {
  if (!isAuthorPrivateText(projection)) return user;
  return {
    ...(plainRecord(user) ? user : {}),
    ...projection.content,
    author_private: projection
  };
}

function catalogContent(content, type) {
  if (type === "store") {
    return {
      name: content.name,
      city: content.city,
      district: content.district,
      address: content.address,
      latitude: content.latitude,
      longitude: content.longitude,
      contact_note: content.contactNote
    };
  }
  if (type === "script") {
    return {
      name: content.name,
      player_count: content.playerCount,
      type_tags: Array.isArray(content.typeTags) ? [...content.typeTags] : [],
      summary_no_spoiler: content.summaryNoSpoiler,
      default_seat_template: Array.isArray(content.defaultSeatTemplate)
        ? content.defaultSeatTemplate.map((role) => ({ ...role }))
        : undefined
    };
  }
  return null;
}

export function authorPrivateCatalogItem(projection, type) {
  if (!isAuthorPrivateText(projection)) return null;
  const projected = catalogContent(projection.content, type);
  if (!projected) return null;
  return Object.fromEntries(Object.entries({
    id: null,
    draft_id: projection.draft_id,
    type,
    ...projected,
    review_status: projection.moderation_status,
    moderation_message: projection.moderation_message,
    publication_state: "author_only",
    is_draft: true,
    author_private: projection
  }).filter(([, value]) => value !== undefined));
}

export function isFormalBusinessEntity(value) {
  return positiveId(value?.id) !== null && value?.author_private?.content?.is_draft !== true;
}

function definedEntries(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export function authorPrivateSessionItem(projection) {
  if (!isAuthorPrivateText(projection) || projection.content?.is_draft !== true) return null;
  const content = projection.content;
  return definedEntries({
    id: null,
    draft_id: projection.draft_id,
    start_at: content.startAt,
    note: content.note,
    pinned_message_text: content.pinnedMessageText,
    script_name_snapshot: "待审车局",
    store_name_snapshot: "仅自己可见",
    status: "author_private",
    moderation_message: projection.moderation_message,
    publication_state: "author_only",
    is_draft: true,
    author_private: projection
  });
}

function authorPrivateNpcRole(projection) {
  if (!isAuthorPrivateText(projection) || projection.content?.is_draft !== true) return null;
  const content = projection.content;
  return definedEntries({
    id: null,
    draft_id: projection.draft_id,
    name: content.name,
    description: content.description,
    role_gender: content.roleGender,
    source: content.source,
    bound_user_id: content.boundUserId,
    sort_order: content.sortOrder,
    status: "author_private",
    moderation_message: projection.moderation_message,
    publication_state: "author_only",
    is_draft: true,
    author_private: projection
  });
}

export function normalizeAuthorPrivateSession(session) {
  if (isAuthorPrivateText(session)) return authorPrivateSessionItem(session);
  if (!plainRecord(session)) return session;
  return {
    ...session,
    session_npc_roles: Array.isArray(session.session_npc_roles)
      ? session.session_npc_roles.map((role) =>
          isAuthorPrivateText(role) ? authorPrivateNpcRole(role) : role
        ).filter(Boolean)
      : session.session_npc_roles
  };
}
