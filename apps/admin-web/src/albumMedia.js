import {
  albumMediaError,
  createSingleFlight,
  executeAlbumCosUpload,
  mergeAlbumMediaUrls,
  shouldRefreshAlbumMedia
} from "@pinche/shared";

export function normalizeAdminAlbumImage(photo = {}) {
  const preview = photo.preview_display_url || photo.preview_url || photo.image_url || "";
  return {
    ...photo,
    image_url: preview,
    preview_url: preview,
    thumbnail_url: photo.thumbnail_display_url || photo.thumbnail_url || preview,
    download_url: photo.download_url || preview,
    display_url: photo.display_url || ""
  };
}

export function createAdminAlbumRefreshController(options) {
  const flight = createSingleFlight();
  let timer = null;
  const clear = () => {
    if (timer !== null) options.clearTimer(timer);
    timer = null;
  };
  const schedule = () => {
    clear();
    const expiries = (options.readAlbum()?.photos || [])
      .map((photo) => Date.parse(photo.media_url_expires_at || ""))
      .filter(Number.isFinite);
    if (expiries.length === 0) return;
    timer = options.setTimer(
      () => { void refresh(); },
      Math.max(0, Math.min(...expiries) - options.now() - 30_000)
    );
  };
  const refresh = () => flight.run(async () => {
    const next = await options.reloadAlbum();
    options.writeAlbum(mergeAlbumMediaUrls(options.readAlbum(), next));
    schedule();
    return options.readAlbum();
  });
  const checkNow = () => {
    const expiring = (options.readAlbum()?.photos || []).some((photo) =>
      shouldRefreshAlbumMedia(photo.media_url_expires_at, { nowMs: options.now() })
    );
    return expiring ? refresh() : (schedule(), Promise.resolve(options.readAlbum()));
  };
  return { refresh, schedule, checkNow, dispose: clear };
}

export function shouldReloadAuthorizedImage({ mediaKeyChanged, hasObjectUrl, failed }) {
  return mediaKeyChanged || !hasObjectUrl || failed;
}

export async function uploadAdminAlbumPhoto({
  sessionId,
  file,
  adminOwner,
  api,
  execute = executeAlbumCosUpload,
  onPhase = () => {}
}) {
  if (!api) throw new TypeError("admin album photo API adapter is required");
  const upload = await api.requestAlbumPhotoUploadIntent(sessionId, file, { adminOwner });
  if (
    upload.uploadMode === "api-local" &&
    upload.direct === false &&
    upload.fallbackAllowed === true
  ) {
    const photoUrl = await api.uploadSessionAlbumPhotoLocal(sessionId, file, { adminOwner });
    const photo = await api.createSessionAlbumPhoto(sessionId, photoUrl, { adminOwner });
    return { photo };
  }
  if (
    upload.uploadMode !== "cos-direct-v2" ||
    upload.direct !== true ||
    upload.fallbackAllowed !== false
  ) {
    throw albumMediaError("DIRECT_UPLOAD_REQUIRED", "相册图片必须直传 COS");
  }
  const reportPhase = (phase) => {
    onPhase(phase);
    if (phase.phase === "uploading" && phase.retry > 0) {
      api.reportAlbumMediaEvent?.("upload_retry", {
        sessionId,
        retryCount: phase.retry
      });
    }
  };
  try {
    return await execute({
      putObject: () => api.putAlbumPhotoToCos(upload, file),
      getStatus: () => api.getAlbumPhotoUploadStatus(upload.uploadId),
      finalize: () => api.finalizeAlbumPhotoUpload(upload.uploadId),
      refreshAuthorization: () => api.clearAlbumPhotoAuthorization(upload.key),
      onPhase: reportPhase
    });
  } catch (error) {
    api.reportAlbumMediaEvent?.("upload_failure", {
      sessionId,
      errorCode: error?.code || "COS_UPLOAD_FAILED"
    });
    throw error;
  }
}

export function shouldAttachAdminAuthorization(url, apiBase = "") {
  if (!url) return false;
  try {
    const base = apiBase || (typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const parsed = new URL(url, base);
    const origin = typeof window !== "undefined" ? window.location.origin : base;
    return parsed.origin === origin;
  } catch (error) {
    return false;
  }
}

export class RequestSerial {
  constructor() { this.value = 0; }
  next() { this.value += 1; return this.value; }
  invalidate() { this.value += 1; return this.value; }
  isCurrent(value) { return Number(value) === this.value; }
}
