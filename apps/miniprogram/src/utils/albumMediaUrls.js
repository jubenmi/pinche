import {
  createSingleFlight,
  isModerationPublished,
  mergeAlbumMediaUrls,
  shouldRefreshAlbumMedia
} from "@pinche/shared";

const AUTHOR_PRIVATE_MEDIA_STATUSES = new Set([
  "pending",
  "processing",
  "error",
  "review",
  "rejected"
]);

function samePositiveUserId(left, right) {
  const leftId = Number(left);
  const rightId = Number(right);
  return (
    Number.isSafeInteger(leftId) && leftId > 0 &&
    Number.isSafeInteger(rightId) && rightId > 0 &&
    leftId === rightId
  );
}

export function isAuthorPrivateAlbumMedia(photo = {}, viewerUserId) {
  return (
    photo?.publication_state === "author_only" &&
    photo?.is_mine === true &&
    photo?.can_preview === true &&
    !isModerationPublished(photo?.moderation_status) &&
    AUTHOR_PRIVATE_MEDIA_STATUSES.has(String(photo?.moderation_status || "")) &&
    samePositiveUserId(photo?.uploader_user_id, viewerUserId)
  );
}

export function isPreviewableAlbumMedia(photo = {}, options = {}) {
  if (isModerationPublished(photo?.moderation_status)) return true;
  return (
    options.timelineMode !== true &&
    isAuthorPrivateAlbumMedia(photo, options.viewerUserId)
  );
}

export function isCurrentPreviewableAlbumMedia(
  photos = [],
  requestedPhoto = {},
  options = {}
) {
  if (!isPreviewableAlbumMedia(requestedPhoto, options)) return false;
  return (photos || []).some((photo) => (
    String(photo?.id) === String(requestedPhoto?.id) &&
    isPreviewableAlbumMedia(photo, options) &&
    (
      isModerationPublished(photo?.moderation_status) ||
      String(photo?.moderation_status) === String(requestedPhoto?.moderation_status)
    )
  ));
}

export function pruneAlbumMediaPreviewCache(cache = {}, photos = [], options = {}) {
  const previewableIds = new Set(
    (photos || [])
      .filter((photo) => isPreviewableAlbumMedia(photo, options))
      .map((photo) => String(photo.id))
  );
  return Object.fromEntries(
    Object.entries(cache || {}).filter(([photoId]) => previewableIds.has(String(photoId)))
  );
}

export function pruneUnpublishedAlbumMediaCache(cache = {}, photos = []) {
  const publishedIds = new Set(
    (photos || [])
      .filter((photo) => isModerationPublished(photo?.moderation_status))
      .map((photo) => String(photo.id))
  );
  return Object.fromEntries(
    Object.entries(cache || {}).filter(([photoId]) => publishedIds.has(String(photoId)))
  );
}

export function isCurrentPublishedAlbumMedia(photos = [], requestedPhoto = {}) {
  if (!isModerationPublished(requestedPhoto?.moderation_status)) {
    return false;
  }
  return (photos || []).some(
    (photo) =>
      String(photo?.id) === String(requestedPhoto?.id) &&
      isModerationPublished(photo?.moderation_status)
  );
}

export function createAlbumListRequestAuthority() {
  let currentRequest = null;
  return {
    begin() {
      const request = Symbol("album-list-request");
      currentRequest = request;
      return request;
    },
    isCurrent(request) {
      return request === currentRequest;
    }
  };
}

export function createAlbumWaterfallRenderAuthority() {
  let currentRender = null;
  return {
    begin() {
      const render = Symbol("album-waterfall-render");
      currentRender = render;
      return render;
    },
    isCurrent(render) {
      return render === currentRender;
    }
  };
}

export function findCurrentAlbumMediaRow(photos = [], candidate = {}) {
  if (candidate?.id === undefined || candidate?.id === null) return null;
  return (photos || []).find(
    (photo) => String(photo?.id) === String(candidate.id)
  ) || null;
}

export function clearAlbumMediaRequestIfCurrent(requests = {}, requestKey, request) {
  const next = { ...(requests || {}) };
  if (next[requestKey] === request) delete next[requestKey];
  return next;
}

export function normalizeAlbumImageUrls(photo = {}) {
  return {
    thumbnailUrl:
      photo.thumbnail_display_url ||
      photo.thumbnail_load_url ||
      photo.thumbnail_url ||
      photo.image_url ||
      "",
    previewUrl:
      photo.preview_display_url ||
      photo.preview_load_url ||
      photo.preview_url ||
      photo.image_url ||
      "",
    downloadUrl:
      photo.download_url ||
      photo.preview_display_url ||
      photo.preview_load_url ||
      photo.preview_url ||
      photo.image_url ||
      "",
    expiresAt: photo.media_url_expires_at || ""
  };
}

export function normalizeAuthorPrivateAlbumImageUrls(photo = {}, viewerUserId) {
  if (!isAuthorPrivateAlbumMedia(photo, viewerUserId) || photo?.media_type !== "image") {
    return { thumbnailUrl: "", previewUrl: "", downloadUrl: "", expiresAt: "" };
  }
  return {
    thumbnailUrl:
      photo.thumbnail_display_url ||
      photo.thumbnail_load_url ||
      photo.thumbnail_url ||
      "",
    previewUrl:
      photo.preview_display_url ||
      photo.preview_load_url ||
      photo.preview_url ||
      photo.image_url ||
      "",
    downloadUrl: "",
    expiresAt: photo.media_url_expires_at || ""
  };
}

export function createAlbumMediaRefreshController({
  readAlbum,
  writeAlbum,
  reloadAlbum,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now
}) {
  const flight = createSingleFlight();
  let timer = null;
  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const schedule = () => {
    cancelTimer();
    const expiries = (readAlbum()?.photos || [])
      .map((photo) => Date.parse(photo.media_url_expires_at || ""))
      .filter(Number.isFinite);
    if (expiries.length === 0) return;
    const delay = Math.max(0, Math.min(...expiries) - now() - 30_000);
    timer = setTimer(() => { void refresh(); }, delay);
  };
  const refresh = () => flight.run(async () => {
    const refreshed = await reloadAlbum();
    if (
      refreshed === null ||
      (typeof refreshed?.isCurrent === "function" && !refreshed.isCurrent())
    ) {
      schedule();
      return readAlbum();
    }
    writeAlbum(mergeAlbumMediaUrls(readAlbum(), refreshed));
    schedule();
    return readAlbum();
  });
  const checkNow = () => {
    const expiredSoon = (readAlbum()?.photos || []).some((photo) =>
      shouldRefreshAlbumMedia(photo.media_url_expires_at, { nowMs: now() })
    );
    return expiredSoon ? refresh() : (schedule(), Promise.resolve(readAlbum()));
  };
  return { refresh, schedule, checkNow, dispose: cancelTimer };
}
