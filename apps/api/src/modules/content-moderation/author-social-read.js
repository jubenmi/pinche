import { isAuthorPrivateTextDto } from "./author-dto.js";

export function mergeAuthorReviewState(state, projection) {
  if (!isAuthorPrivateTextDto(projection)) return state;
  const source = state && typeof state === "object" ? state : {};
  const review = source.review && typeof source.review === "object" ? source.review : { id: null };
  return {
    ...source,
    review: {
      ...review,
      rating: projection.content.rating,
      content: projection.content.content,
      photos: Array.isArray(projection.content.photoUrls)
        ? [...projection.content.photoUrls]
        : Array.isArray(review.photos) ? [...review.photos] : [],
      ...(Array.isArray(projection.content.albumPhotoIds)
        ? { album_photo_ids: [...projection.content.albumPhotoIds] }
        : Array.isArray(review.album_photo_ids)
          ? { album_photo_ids: [...review.album_photo_ids] }
          : {}),
      author_private: projection
    }
  };
}

function authorMessage(projection, userId) {
  if (
    !isAuthorPrivateTextDto(projection) ||
    projection.published_id !== null ||
    projection.content?.is_draft !== true
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

function authorPinnedMessage(current, projection) {
  if (!isAuthorPrivateTextDto(projection)) return current;
  return {
    ...(current && typeof current === "object" ? current : { id: null }),
    content: projection.content.pinnedMessageText,
    author_private: projection
  };
}

export function mergeAuthorChatView(chat, {
  userId,
  messageProjection,
  pinProjection
} = {}) {
  const source = chat && typeof chat === "object" ? chat : {};
  const messages = Array.isArray(source.messages)
    ? source.messages.filter((message) => (
        Number(message?.draft_id || 0) !== Number(messageProjection?.draft_id || -1)
      ))
    : [];
  const temporaryMessage = authorMessage(messageProjection, userId);
  return {
    ...source,
    pinnedMessage: authorPinnedMessage(source.pinnedMessage || null, pinProjection),
    messages: temporaryMessage ? [...messages, temporaryMessage] : messages
  };
}
