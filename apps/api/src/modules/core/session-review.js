import { badRequest } from "../../http/errors.js";
import { beijingDateKey, isModerationPublished } from "@pinche/shared";

export const MAX_SESSION_REVIEW_PHOTOS = 9;

export function normalizeSessionReviewAlbumPhotoIds(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw badRequest("albumPhotoIds must be an array");
  }
  if (value.length > MAX_SESSION_REVIEW_PHOTOS) {
    throw badRequest(`albumPhotoIds cannot contain more than ${MAX_SESSION_REVIEW_PHOTOS} photos`);
  }
  const ids = value.map((entry) => {
    const id = Number(entry);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw badRequest("albumPhotoIds must contain positive integer ids");
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) {
    throw badRequest("albumPhotoIds must contain unique ids");
  }
  return ids;
}

export function serializePublicSessionReview(row, photos = []) {
  return {
    id: Number(row.id),
    rating: Number(row.rating),
    content: String(row.content || ""),
    photos: Array.isArray(photos) ? [...photos] : [],
    author: {
      nickname: String(row.user_nickname || "车友"),
      avatar_url: String(row.user_avatar_url || "")
    },
    role_name: String(row.seat_role_name || row.seat_name || "车友"),
    script_name: String(row.script_name_snapshot || "剧本"),
    store_name: String(row.store_name_snapshot || ""),
    played_on: beijingDateKey(row.start_at)
  };
}

export function isPublishableSessionReviewAlbumPhoto(row, reviewId, albumPhotoId) {
  return Boolean(
    row &&
    Number(row.review_id) === Number(reviewId) &&
    String(row.review_status || "") === "active" &&
    Number(row.album_photo_id) === Number(albumPhotoId) &&
    String(row.album_photo_status || "") === "active" &&
    isModerationPublished(row.moderation_status) &&
    String(row.media_type || "image") === "image" &&
    String(row.processing_status || "ready") === "ready"
  );
}
