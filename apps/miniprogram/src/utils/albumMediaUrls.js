import {
  createSingleFlight,
  isModerationPublished,
  mergeAlbumMediaUrls,
  shouldRefreshAlbumMedia
} from "@pinche/shared";

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
