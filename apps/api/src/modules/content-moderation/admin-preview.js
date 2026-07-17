import { cosStorageEnabled } from "../../storage/cos.js";

export const ADMIN_MODERATION_PREVIEW_SECONDS = 60;
export const ADMIN_MODERATION_PREVIEW_RESPONSE_CACHE_CONTROL = "no-store, private, max-age=0";

function previewQueryEntries() {
  return [{
    name: "response-cache-control",
    value: ADMIN_MODERATION_PREVIEW_RESPONSE_CACHE_CONTROL
  }];
}

function isCurrentMedia(row, { provider, mediaType }) {
  const subjectVersion = String(row?.subject_version || "");
  return (
    String(row?.provider || "") === provider &&
    String(row?.subject_type || "") === `album_${mediaType}` &&
    ["review", "error"].includes(String(row?.status || "")) &&
    String(row?.media_id || "") === String(row?.subject_id || "") &&
    String(row?.media_record_status || "") === "active" &&
    String(row?.media_type || "") === mediaType &&
    Boolean(subjectVersion) &&
    String(row?.moderation_object_version || "") === subjectVersion
  );
}

function isControlledImageKey(value) {
  const key = String(value || "");
  return (
    /^uploads\/session-album\/display\/[A-Za-z0-9._-]+\.jpg$/.test(key) &&
    !key.includes("..")
  );
}

function isControlledVideoPath(value) {
  const uploadPath = String(value || "");
  return (
    /^\/uploads\/session-album\/videos\/(?:display|source)\/[A-Za-z0-9._-]+\.mp4$/.test(uploadPath) &&
    !uploadPath.includes("..")
  );
}

function timestampMilliseconds(now) {
  const value = typeof now === "function" ? now() : Date.now();
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : null;
}

function previewResult(previewUrl, previewExpiresAt) {
  return typeof previewUrl === "string" && previewUrl.trim()
    ? { previewUrl: previewUrl.trim(), previewExpiresAt }
    : {};
}

// This boundary deliberately receives signing functions rather than COS keys.
// It validates the database row first, then gives a signer only an owned media
// key/path and the fixed short expiry. No raw storage reference is returned.
export function createAdminModerationPreviewBuilder({
  cosConfig,
  now = () => Date.now(),
  buildImageUrl,
  buildVideoUrl
} = {}) {
  if (typeof buildImageUrl !== "function" || typeof buildVideoUrl !== "function") {
    throw new TypeError("administrator moderation preview signers are required");
  }

  return function buildAdminModerationPreview(row = {}) {
    if (!cosStorageEnabled(cosConfig)) return {};
    const nowMs = timestampMilliseconds(now);
    if (nowMs === null) return {};
    const nowSeconds = Math.floor(nowMs / 1000);
    const previewExpiresAt = new Date(
      (nowSeconds + ADMIN_MODERATION_PREVIEW_SECONDS) * 1000
    ).toISOString();

    if (
      String(row.subject_type || "") === "album_image" &&
      isCurrentMedia(row, { provider: "wechat_sec_check", mediaType: "image" }) &&
      isControlledImageKey(row.object_key)
    ) {
      return previewResult(buildImageUrl({
        objectKey: String(row.object_key),
        nowSeconds,
        expiresInSeconds: ADMIN_MODERATION_PREVIEW_SECONDS,
        queryEntries: previewQueryEntries()
      }), previewExpiresAt);
    }

    const videoPath = row.display_url || row.source_url;
    if (
      String(row.subject_type || "") === "album_video" &&
      isCurrentMedia(row, { provider: "tencent_ci_video", mediaType: "video" }) &&
      isControlledVideoPath(videoPath)
    ) {
      return previewResult(buildVideoUrl({
        uploadPath: String(videoPath),
        expiresInSeconds: ADMIN_MODERATION_PREVIEW_SECONDS,
        queryEntries: previewQueryEntries()
      }), previewExpiresAt);
    }

    return {};
  };
}
