export const ALBUM_IMAGE_KINDS = Object.freeze([
  "sessionAlbumPhoto",
  "adminSessionAlbumPhoto"
]);
export const ALBUM_IMAGE_MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export const ALBUM_IMAGE_UPLOAD_WINDOW_SECONDS = 600;
export const ALBUM_IMAGE_AUTH_SECONDS = 300;
export const ALBUM_IMAGE_FINALIZE_GRACE_SECONDS = 900;
export const ALBUM_IMAGE_CLEANUP_GRACE_SECONDS = 600;
export const ALBUM_IMAGE_URL_SECONDS = 300;
export const WECHAT_IMAGE_MODERATION_URL_SECONDS = 60;
export const ALBUM_IMAGE_DISPLAY_PROCESS =
  "imageMogr2/auto-orient/thumbnail/2048x2048>/format/jpg/quality/85/strip";
export const ALBUM_IMAGE_THUMBNAIL_PROCESS =
  "imageMogr2/auto-orient/thumbnail/640x640>/format/jpg/quality/75/strip";
export const ALBUM_IMAGE_INTENT_STATUSES = Object.freeze([
  "pending",
  "processing",
  "finalized",
  "expired",
  "rejected",
  "cleanup_pending",
  "cleanup_failed",
  "cleaned"
]);

export function isAlbumImageKind(kind) {
  return ALBUM_IMAGE_KINDS.includes(String(kind || ""));
}
