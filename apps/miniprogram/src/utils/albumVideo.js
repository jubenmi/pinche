const VIDEO_URL_EXPIRY_SKEW_MS = 30 * 1000;

export function compressVideoSizeBytes(sizeKilobytes) {
  const size = Number(sizeKilobytes);
  if (!Number.isFinite(size) || size <= 0) {
    return 0;
  }
  return Math.round(size * 1024);
}

export function isUsableRequiredVideoCompression({
  originalPath,
  compressedPath,
  compressedSize,
  suspicious = false
} = {}) {
  const source = String(originalPath || "");
  const output = String(compressedPath || "");
  const size = Number(compressedSize);
  return Boolean(
    source &&
      output &&
      output !== source &&
      Number.isSafeInteger(size) &&
      size > 0 &&
      suspicious !== true
  );
}

export function shouldAttachApiAuthorization(url, apiBase) {
  const rawUrl = String(url || "").trim();
  const rawApiBase = String(apiBase || "").trim();
  if (!rawUrl || !rawApiBase) {
    return false;
  }
  try {
    const apiUrl = new URL(rawApiBase);
    if (apiUrl.protocol !== "http:" && apiUrl.protocol !== "https:") {
      return false;
    }
    const targetUrl = new URL(rawUrl, apiUrl);
    return targetUrl.origin === apiUrl.origin;
  } catch (error) {
    return false;
  }
}

export function canOpenAlbumMediaPreview({ timelineMode, mediaType, processingStatus } = {}) {
  if (mediaType === "video") {
    return !timelineMode && processingStatus === "ready";
  }
  return mediaType === "image" && processingStatus === "ready";
}

export function videoUrlExpiresAt(expiresInSeconds, receivedAtMs = Date.now()) {
  const seconds = Number(expiresInSeconds);
  const receivedAt = Number(receivedAtMs);
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(receivedAt)) {
    return null;
  }
  return receivedAt + seconds * 1000;
}

export function canReuseVideoUrl(url, expiresAt, nowMs = Date.now()) {
  const expiry = Number(expiresAt);
  const now = Number(nowMs);
  return Boolean(
    String(url || "") &&
      Number.isFinite(expiry) &&
      Number.isFinite(now) &&
      expiry - now > VIDEO_URL_EXPIRY_SKEW_MS
  );
}

export function transitionAlbumVideoViewerFailure(state = {}, event) {
  if (event === "retry") {
    return {
      videoUrl: "",
      autoRefreshUsed: false,
      videoLoadFailed: false,
      requestVideoUrl: true,
      persistPhotosMutation: false
    };
  }
  if (event === "video-error" && !state.autoRefreshUsed) {
    return {
      videoUrl: "",
      autoRefreshUsed: true,
      videoLoadFailed: false,
      requestVideoUrl: true,
      persistPhotosMutation: false
    };
  }
  return {
    videoUrl: "",
    autoRefreshUsed: true,
    videoLoadFailed: true,
    requestVideoUrl: false,
    persistPhotosMutation: false
  };
}
