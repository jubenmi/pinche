import { albumMediaError, executeAlbumCosUpload } from "@pinche/shared";
import * as defaultApi from "./api.js";

function extensionForFile(path, contentType) {
  if (contentType === "image/png") return ".png";
  if (contentType === "image/jpeg") return ".jpg";
  const match = String(path || "").match(/\.(jpe?g|png)$/i);
  return match ? `.${match[1].toLowerCase()}`.replace(".jpeg", ".jpg") : ".jpg";
}

export async function uploadAlbumPhoto({
  sessionId,
  filePath,
  fileSize,
  contentType,
  adminOwner = false,
  api = defaultApi,
  execute = executeAlbumCosUpload,
  onPhase = () => {}
}) {
  onPhase({ phase: "preparing", retry: 0 });
  const upload = await api.createSessionAlbumPhotoUploadIntent(sessionId, {
    extension: extensionForFile(filePath, contentType),
    contentType,
    byteSize: Number(fileSize),
    adminOwner
  });
  if (
    upload.uploadMode === "api-local" &&
    upload.direct === false &&
    upload.fallbackAllowed === true
  ) {
    const photoUrl = await api.uploadSessionAlbumPhotoLocal(sessionId, filePath, {
      adminOwner
    });
    return api.createSessionAlbumPhotoLegacy(sessionId, photoUrl, { adminOwner });
  }
  if (
    upload.uploadMode !== "cos-direct-v2" ||
    upload.direct !== true ||
    upload.fallbackAllowed !== false
  ) {
    throw albumMediaError("DIRECT_UPLOAD_REQUIRED", "相册图片必须直传 COS");
  }
  const phaseReporter = (phase) => {
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
      putObject: () => api.putSessionAlbumPhotoToCos(upload, filePath),
      getStatus: () => api.getSessionAlbumPhotoUploadStatus(upload.uploadId),
      finalize: () => api.finalizeSessionAlbumPhotoUpload(upload.uploadId),
      refreshAuthorization: () => api.clearSessionAlbumPhotoAuthorization(upload.key),
      onPhase: phaseReporter
    });
  } catch (error) {
    api.reportAlbumMediaEvent?.("upload_failure", {
      sessionId,
      errorCode: error?.code || "COS_UPLOAD_FAILED"
    });
    throw error;
  }
}
