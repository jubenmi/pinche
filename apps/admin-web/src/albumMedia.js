import { albumMediaError, executeAlbumCosUpload } from "@pinche/shared";

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
