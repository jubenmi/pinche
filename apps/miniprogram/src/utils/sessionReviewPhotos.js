import { isModerationPublished } from "@pinche/shared";
import { isAuthorPrivateAlbumMedia } from "./albumMediaUrls.js";

export const MAX_SESSION_REVIEW_PHOTOS = 9;

export function isSelectableSessionReviewAlbumPhoto(photo, viewerUserId) {
  return Boolean(
    photo &&
    Number(photo.id) > 0 &&
    photo.media_type !== "video" &&
    String(photo.status || "active") === "active" &&
    String(photo.processing_status || "ready") === "ready" &&
    (
      isModerationPublished(photo.moderation_status) ||
      isAuthorPrivateAlbumMedia(photo, viewerUserId)
    )
  );
}

function photoIds(value) {
  const ids = (Array.isArray(value) ? value : []).map((entry) => Number(entry));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new TypeError("album photo id must be a positive integer");
  }
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length > MAX_SESSION_REVIEW_PHOTOS) {
    throw new RangeError(`review photos cannot contain more than ${MAX_SESSION_REVIEW_PHOTOS} photos`);
  }
  return uniqueIds;
}

export function createSessionReviewPhotoState({
  albumPhotoIds = [],
  legacyPhotoUrls = []
} = {}) {
  const selectedAlbumPhotoIds = photoIds(albumPhotoIds);
  return {
    source: selectedAlbumPhotoIds.length ? "album" : "",
    selectedAlbumPhotoIds,
    legacyPhotoUrls: selectedAlbumPhotoIds.length
      ? []
      : [...new Set((Array.isArray(legacyPhotoUrls) ? legacyPhotoUrls : []).filter(Boolean))]
        .slice(0, MAX_SESSION_REVIEW_PHOTOS),
    photosTouched: false
  };
}

export function switchSessionReviewPhotoSource(state, source) {
  if (!['album', 'upload'].includes(source)) {
    throw new TypeError("review photo source must be album or upload");
  }
  if (state.source === source) return state;
  return {
    source,
    selectedAlbumPhotoIds: [],
    legacyPhotoUrls: [],
    photosTouched: true
  };
}

export function toggleSessionReviewAlbumPhoto(state, albumPhotoId) {
  const id = photoIds([albumPhotoId])[0];
  const selected = photoIds(state.selectedAlbumPhotoIds);
  const next = selected.includes(id)
    ? selected.filter((entry) => entry !== id)
    : [...selected, id];
  if (next.length > MAX_SESSION_REVIEW_PHOTOS) {
    throw new RangeError(`review photos cannot contain more than ${MAX_SESSION_REVIEW_PHOTOS} photos`);
  }
  return {
    ...state,
    selectedAlbumPhotoIds: next,
    legacyPhotoUrls: [],
    photosTouched: true
  };
}

export function buildSessionReviewPhotoRequest(state) {
  if (!state.photosTouched) return {};
  return {
    albumPhotoIds: photoIds(state.selectedAlbumPhotoIds)
  };
}
