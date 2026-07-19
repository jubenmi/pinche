import { badRequest } from "../../http/errors.js";

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

