import { resolveAuthorVisibility } from "./author-visibility.js";

export const AUTHOR_MEDIA_PREVIEW_MAX_SECONDS = 60;
export const AUTHOR_MEDIA_PREVIEW_CACHE_CONTROL = "private, no-store";

const AUTHOR_MEDIA_PREVIEW_RECORD = Symbol("D46 author media preview record");

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function controlledImageKey(value) {
  const key = String(value || "");
  return /^uploads\/session-album\/display\/[A-Za-z0-9._-]+\.jpg$/i.test(key) &&
    !key.includes("..");
}

function controlledVideoPath(value, kind) {
  const path = String(value || "");
  return new RegExp(
    `^/uploads/session-album/videos/${kind}/[A-Za-z0-9._-]+\\.mp4$`,
    "i"
  ).test(path) && !path.includes("..");
}

function moderationMessage(status) {
  if (status === "review") return "仅自己可见 · 进一步审核";
  if (status === "rejected") return "仅自己可见 · 未通过";
  return "仅自己可见 · 审核中";
}

function previewRecord(media, options = {}) {
  const mediaId = positiveInteger(media?.id);
  const userId = positiveInteger(options.viewerUserId);
  const uploaderUserId = positiveInteger(media?.uploader_user_id);
  const mediaType = String(media?.media_type || "");
  const enabled = mediaType === "image"
    ? options.imageEnabled === true
    : mediaType === "video"
      ? options.videoEnabled === true
      : false;
  if (!enabled || mediaId === null || userId === null || uploaderUserId === null) return null;

  const visibility = resolveAuthorVisibility({
    viewerUserId: userId,
    authorUserId: uploaderUserId,
    moderationStatus: String(media?.moderation_status || ""),
    authorVisibilityVersion: Number(media?.author_visibility_version),
    recordStatus: String(media?.status || ""),
    contentKind: mediaType
  });
  if (visibility.scope !== "author_only" || visibility.canPreview !== true) return null;

  const objectVersion = String(media?.moderation_object_version || "");
  if (!objectVersion) return null;
  if (mediaType === "image") {
    const imageObjectKey = String(media?.object_key || "");
    const objectEtag = String(media?.object_etag || "");
    if (
      !controlledImageKey(imageObjectKey) ||
      String(media?.photo_url || "") !== `/${imageObjectKey}` ||
      !objectEtag || objectEtag !== objectVersion
    ) return null;
    return Object.freeze({
      mediaId,
      userId,
      mediaType,
      imageObjectKey,
      previewPath: `/${imageObjectKey}`,
      objectVersion
    });
  }

  const displayPath = controlledVideoPath(media?.display_url, "display")
    ? String(media.display_url)
    : "";
  const sourcePath = controlledVideoPath(media?.source_url, "source")
    ? String(media.source_url)
    : "";
  const previewPath = displayPath || sourcePath;
  if (!previewPath) return null;
  return Object.freeze({
    mediaId,
    userId,
    mediaType,
    previewPath,
    objectVersion
  });
}

function safeMediaView(media, visibility) {
  const mediaType = String(media.media_type);
  const view = {
    id: Number(media.id),
    session_id: Number(media.session_id),
    media_type: mediaType,
    processing_status: mediaType === "video"
      ? String(media.processing_status || "processing")
      : "ready",
    moderation_status: String(media.moderation_status || ""),
    moderation_message: moderationMessage(String(media.moderation_status || "")),
    publication_state: "author_only",
    uploader_user_id: Number(media.uploader_user_id),
    is_mine: true,
    can_preview: true,
    can_edit: visibility.canEdit === true,
    can_delete: visibility.canDelete === true,
    can_resubmit: visibility.canResubmit === true,
    can_tag: false,
    tags: [],
    has_cover: false,
    created_at: media.created_at
  };
  if (mediaType === "image") {
    return {
      ...view,
      image_width: media.image_width ? Number(media.image_width) : null,
      image_height: media.image_height ? Number(media.image_height) : null,
      image_byte_size: media.image_byte_size ? Number(media.image_byte_size) : null,
      image_content_type: media.image_content_type || "image/jpeg"
    };
  }
  return {
    ...view,
    duration_seconds: media.duration_seconds ? Number(media.duration_seconds) : null,
    video_width: media.video_width ? Number(media.video_width) : null,
    video_height: media.video_height ? Number(media.video_height) : null,
    video_byte_size: media.video_byte_size ? Number(media.video_byte_size) : null,
    video_content_type: media.video_content_type || "video/mp4",
    processing_error: null
  };
}

export function createAuthorPrivateMediaView(media, options = {}) {
  const record = previewRecord(media, options);
  if (!record) return null;
  const visibility = resolveAuthorVisibility({
    viewerUserId: record.userId,
    authorUserId: media.uploader_user_id,
    moderationStatus: String(media.moderation_status || ""),
    authorVisibilityVersion: Number(media.author_visibility_version),
    recordStatus: String(media.status || ""),
    contentKind: record.mediaType
  });
  const view = safeMediaView(media, visibility);
  Object.defineProperty(view, AUTHOR_MEDIA_PREVIEW_RECORD, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: record
  });
  return view;
}

export function getAuthorMediaPreviewRecord(value) {
  return value && typeof value === "object"
    ? value[AUTHOR_MEDIA_PREVIEW_RECORD] || null
    : null;
}

function previewTtlSeconds(value) {
  const ttl = Number(value);
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > AUTHOR_MEDIA_PREVIEW_MAX_SECONDS) {
    throw new TypeError("author media preview TTL must be between 1 and 60 seconds");
  }
  return ttl;
}

function capabilityClaims(record, variant, options) {
  const nowSeconds = Number(options.nowSeconds);
  const ttlSeconds = previewTtlSeconds(options.ttlSeconds);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new TypeError("author media preview clock is invalid");
  }
  if (typeof options.fingerprint !== "function") {
    throw new TypeError("author media preview fingerprint is required");
  }
  const versionFingerprint = String(options.fingerprint(record) || "");
  if (!versionFingerprint) throw new TypeError("author media preview fingerprint is invalid");
  return {
    mediaId: record.mediaId,
    userId: record.userId,
    mediaType: record.mediaType,
    variant,
    versionFingerprint,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds
  };
}

export function buildAuthorImageCapabilityUrls(view, options = {}) {
  const record = getAuthorMediaPreviewRecord(view);
  if (!record || record.mediaType !== "image") return {};
  if (typeof options.signToken !== "function") {
    throw new TypeError("author image preview token signer is required");
  }
  const previewClaims = capabilityClaims(record, "preview", options);
  const thumbnailClaims = capabilityClaims(record, "thumbnail", options);
  const previewToken = String(options.signToken(previewClaims) || "");
  const thumbnailToken = String(options.signToken(thumbnailClaims) || "");
  if (!previewToken || !thumbnailToken) {
    throw new TypeError("author image preview token is invalid");
  }
  const base = `/api/content-moderation/author-media/images/${record.mediaId}/preview`;
  const previewUrl = `${base}?token=${encodeURIComponent(previewToken)}`;
  const thumbnailUrl = `${base}?token=${encodeURIComponent(thumbnailToken)}`;
  return {
    image_url: previewUrl,
    preview_url: previewUrl,
    thumbnail_url: thumbnailUrl,
    preview_load_url: previewUrl,
    thumbnail_load_url: thumbnailUrl,
    preview_display_url: previewUrl,
    thumbnail_display_url: thumbnailUrl,
    download_url: null,
    media_url_expires_at: new Date(previewClaims.exp * 1000).toISOString()
  };
}

export function validateAuthorImageCapabilityClaims(media, claims, options = {}) {
  const ttlSeconds = previewTtlSeconds(options.ttlSeconds);
  const nowSeconds = Number(options.nowSeconds);
  if (
    !claims || typeof claims !== "object" ||
    !["preview", "thumbnail"].includes(String(claims.variant || "")) ||
    !Number.isSafeInteger(nowSeconds) || nowSeconds < 0 ||
    !Number.isSafeInteger(Number(claims.iat)) ||
    !Number.isSafeInteger(Number(claims.exp)) ||
    Number(claims.exp) - Number(claims.iat) < 1 ||
    Number(claims.exp) - Number(claims.iat) > ttlSeconds ||
    nowSeconds < Number(claims.iat) || nowSeconds > Number(claims.exp) ||
    String(claims.mediaType || "") !== "image" ||
    Number(claims.mediaId) !== Number(media?.id)
  ) return null;
  const record = previewRecord(media, {
    viewerUserId: claims.userId,
    imageEnabled: true,
    videoEnabled: false
  });
  if (!record || typeof options.fingerprint !== "function") return null;
  const expected = String(options.fingerprint(record) || "");
  return expected && expected === String(claims.versionFingerprint || "") ? record : null;
}

export function getAuthorMediaPreviewRecordForRow(media, options = {}) {
  return previewRecord(media, options);
}
