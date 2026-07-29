import { badRequest } from "../../http/errors.js";
import { beijingDateKey, isModerationPublished } from "@pinche/shared";
import { resolveAuthorVisibility } from "../content-moderation/author-visibility.js";

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

function isReadySessionReviewAlbumImage(row, prefix = "") {
  const field = (name) => row?.[`${prefix}${name}`];
  return Boolean(
    String(field("status") || "") === "active" &&
    String(field("media_type") || "image") === "image" &&
    String(field("processing_status") || "ready") === "ready"
  );
}

export function isAuthorPrivateSessionReviewAlbumPhoto(photo, viewerUserId) {
  if (!isReadySessionReviewAlbumImage(photo)) return false;
  return resolveAuthorVisibility({
    viewerUserId,
    authorUserId: photo?.uploader_user_id,
    moderationStatus: photo?.moderation_status,
    authorVisibilityVersion: photo?.author_visibility_version,
    recordStatus: photo?.status,
    contentKind: "image"
  }).scope === "author_only";
}

export function isAssociableSessionReviewAlbumPhoto(photo, viewerUserId, visibleToViewer) {
  if (!isReadySessionReviewAlbumImage(photo)) return false;
  if (isModerationPublished(photo?.moderation_status)) return visibleToViewer === true;
  return isAuthorPrivateSessionReviewAlbumPhoto(photo, viewerUserId);
}

export function projectSessionReviewPhotoRows(rows = [], options = {}) {
  const ownerUserId = Number(options.ownerUserId || 0);
  const photosByReview = new Map();
  for (const row of rows) {
    const reviewId = Number(row.review_id);
    const state = photosByReview.get(reviewId) || { photos: [], albumPhotoIds: [] };
    const albumPhotoId = Number(row.album_photo_id || 0);
    if (albumPhotoId > 0) {
      const photo = {
        id: albumPhotoId,
        status: row.album_photo_status,
        moderation_status: row.album_photo_moderation_status,
        media_type: row.album_photo_media_type,
        processing_status: row.album_photo_processing_status,
        uploader_user_id: row.album_photo_uploader_user_id,
        author_visibility_version: row.album_photo_author_visibility_version
      };
      if (isReadySessionReviewAlbumImage(photo) &&
          isModerationPublished(photo.moderation_status)) {
        state.photos.push(`/api/session-reviews/${reviewId}/photos/${albumPhotoId}/image`);
        state.albumPhotoIds.push(albumPhotoId);
      } else if (ownerUserId > 0 &&
          isAuthorPrivateSessionReviewAlbumPhoto(photo, ownerUserId)) {
        state.albumPhotoIds.push(albumPhotoId);
      }
    } else if (
      row.photo_url &&
      String(row.image_asset_status || "") === "active" &&
      isModerationPublished(row.image_asset_moderation_status)
    ) {
      state.photos.push(row.photo_url);
    }
    photosByReview.set(reviewId, state);
  }
  return photosByReview;
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
