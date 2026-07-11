import {
  createSingleFlight,
  mergeAlbumMediaUrls,
  shouldRefreshAlbumMedia
} from "@pinche/shared";

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
