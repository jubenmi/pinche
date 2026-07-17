const AUTHOR_PRIVATE_STATES = new Set(["pending", "processing", "error", "review", "rejected"]);

function positiveId(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function isAuthorPrivateProjection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draftId = positiveId(value.draft_id);
  return Boolean(
    draftId &&
    value.content_ref === `text-proposal:${draftId}` &&
    value.publication_state === "author_only" &&
    AUTHOR_PRIVATE_STATES.has(String(value.moderation_status || "")) &&
    typeof value.moderation_message === "string" &&
    value.content && typeof value.content === "object" && !Array.isArray(value.content) &&
    typeof value.can_edit === "boolean" &&
    value.can_delete === true &&
    typeof value.can_resubmit === "boolean"
  );
}

export function authorPrivateMessageView(projection, userId) {
  if (
    !isAuthorPrivateProjection(projection) ||
    projection.published_id !== null ||
    projection.content.is_draft !== true
  ) return null;
  return {
    id: null,
    draft_id: projection.draft_id,
    sender_user_id: Number(userId),
    sender_label: "我",
    message_type: "author_private",
    content: projection.content.content,
    moderation_message: projection.moderation_message,
    publication_state: "author_only",
    author_private: projection
  };
}

export function authorPrivatePinnedView(current, projection) {
  if (!isAuthorPrivateProjection(projection)) return current || null;
  return {
    ...(current && typeof current === "object" ? current : { id: null }),
    content: projection.content.pinnedMessageText,
    author_private: projection
  };
}

export function publicChatMessages(messages = []) {
  return messages.filter((message) => !isAuthorPrivateProjection(message?.author_private));
}

function replacementData(data, replacesDraftId) {
  const draftId = positiveId(replacesDraftId);
  return draftId ? { ...data, replaces_draft_id: draftId } : data;
}

export function chatApi({ dataOf, request }) {
  return {
    async loadChat(sessionId) {
      const response = await request({ url: `/api/sessions/${sessionId}/chat` });
      return dataOf(response) || {};
    },
    async sendMessage(sessionId, content, replacesDraftId = null) {
      const response = await request({
        url: `/api/sessions/${sessionId}/messages`,
        method: "POST",
        data: replacementData({ content }, replacesDraftId)
      });
      return dataOf(response);
    },
    async updatePinnedMessage(sessionId, pinnedMessageText, replacesDraftId = null) {
      const response = await request({
        url: `/api/sessions/${sessionId}/chat/pin`,
        method: "PATCH",
        data: replacementData({ pinnedMessageText }, replacesDraftId)
      });
      return dataOf(response) || {};
    },
    async cancelDraft(draftId) {
      const id = positiveId(draftId);
      if (!id) throw new TypeError("valid draftId is required");
      const response = await request({
        url: `/api/content-moderation/author-drafts/${id}`,
        method: "DELETE"
      });
      return dataOf(response) || {};
    }
  };
}
