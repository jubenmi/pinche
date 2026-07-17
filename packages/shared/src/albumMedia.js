export const ALBUM_MEDIA_ERROR_CODES = Object.freeze({
  network: "COS_NETWORK_ERROR",
  conflictUnresolved: "COS_UPLOAD_CONFLICT_UNRESOLVED",
  signatureExpired: "UPLOAD_SIGNATURE_EXPIRED",
  mediaExpired: "MEDIA_URL_EXPIRED",
  processing: "MEDIA_PROCESSING_PENDING",
  forbidden: "ALBUM_UPLOAD_FORBIDDEN",
  intentExpired: "UPLOAD_INTENT_EXPIRED",
  directRequired: "DIRECT_UPLOAD_REQUIRED",
  configuration: "COS_CONFIGURATION_ERROR",
  domain: "COS_DOMAIN_NOT_ALLOWED"
});

const RETRYABLE_CODES = new Set([
  "COS_NETWORK_ERROR",
  "COS_REQUEST_TIMEOUT",
  "REQUESTTIMEOUT",
  "INTERNALERROR",
  "SERVICEUNAVAILABLE",
  "SLOWDOWN"
]);

const CONFLICT_CODES = new Set([
  "OBJECTALREADYEXISTS",
  "PRECONDITIONFAILED",
  "COS_PRECONDITION_FAILED"
]);

const SIGNATURE_CODES = new Set([
  "REQUESTTIMETOOSKEWED",
  "SIGNATUREDOESNOTMATCH",
  "UPLOAD_SIGNATURE_EXPIRED"
]);

const URL_FIELDS = Object.freeze([
  "thumbnail_display_url",
  "preview_display_url",
  "download_url",
  "media_url_expires_at",
  "thumbnail_url",
  "preview_url",
  "image_url",
  "thumbnail_load_url",
  "preview_load_url",
  "cover_url",
  "video_url"
]);

const LOCAL_MEDIA_FIELDS = Object.freeze([
  "display_url",
  "video_display_url",
  "video_url_expires_at",
  "video_load_failed",
  "local_preview_path"
]);

export function isModerationPublished(status) {
  return status === "approved" || status === "approved_legacy";
}

export function isApprovedAlbumImageDownloadCandidate(photo = {}, normalizedDownloadUrl = "") {
  return (
    photo?.media_type === "image" &&
    isModerationPublished(photo.moderation_status) &&
    Boolean(String(normalizedDownloadUrl || "").trim())
  );
}

function normalizedCode(error) {
  return String(
    error?.code || error?.error?.Code || error?.originalError?.error?.Code || ""
  )
    .replace(/[^A-Za-z0-9_]/g, "")
    .toUpperCase();
}

export function classifyAlbumCosError(error) {
  const status = Number(error?.statusCode || error?.status || error?.httpStatus || 0);
  const code = normalizedCode(error);
  if (status === 409 || status === 412 || CONFLICT_CODES.has(code)) {
    return { action: "reconcile", code: code || "COS_PRECONDITION_FAILED" };
  }
  if (SIGNATURE_CODES.has(code)) {
    return {
      action: "refresh-authorization",
      code: ALBUM_MEDIA_ERROR_CODES.signatureExpired
    };
  }
  if (status >= 500 || RETRYABLE_CODES.has(code) || (status === 0 && !code)) {
    return { action: "retry-put", code: code || ALBUM_MEDIA_ERROR_CODES.network };
  }
  return { action: "fail", code: code || "COS_UPLOAD_REJECTED" };
}

export function albumMediaError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) {
    error.cause = cause;
  }
  return error;
}

async function reconcileUpload({
  conflict,
  getStatus,
  finalize,
  sleep,
  maxStatusPolls,
  onPhase
}) {
  onPhase({ phase: "validating", retry: 0 });
  for (let poll = 0; poll < maxStatusPolls; poll += 1) {
    const status = await getStatus();
    if (status?.canFinalize && status.validationState === "ready") {
      const result = await finalize();
      onPhase({ phase: "complete", retry: 0 });
      return result;
    }
    if (status?.validationState === "invalid") {
      throw albumMediaError(
        status.errorCode || "COS_IMAGE_INVALID",
        status.message || "COS image validation failed"
      );
    }
    if (poll + 1 < maxStatusPolls) {
      await sleep(Math.min(4000, 500 * 2 ** poll));
    }
  }
  const code = conflict
    ? ALBUM_MEDIA_ERROR_CODES.conflictUnresolved
    : ALBUM_MEDIA_ERROR_CODES.processing;
  throw albumMediaError(
    code,
    conflict
      ? "COS upload conflict could not be reconciled"
      : "COS image is still processing"
  );
}

export async function executeAlbumCosUpload({
  putObject,
  getStatus,
  finalize,
  refreshAuthorization,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  random = Math.random,
  maxStatusPolls = 8,
  onPhase = () => {}
}) {
  let putAttempts = 0;
  let signatureRefreshes = 0;
  onPhase({ phase: "preparing", retry: 0 });
  while (putAttempts < 3) {
    onPhase({ phase: "uploading", retry: putAttempts });
    putAttempts += 1;
    try {
      await putObject();
      return reconcileUpload({
        conflict: false,
        getStatus,
        finalize,
        sleep,
        maxStatusPolls,
        onPhase
      });
    } catch (error) {
      const decision = classifyAlbumCosError(error);
      if (decision.action === "reconcile") {
        return reconcileUpload({
          conflict: true,
          getStatus,
          finalize,
          sleep,
          maxStatusPolls,
          onPhase
        });
      }
      if (
        decision.action === "refresh-authorization" &&
        signatureRefreshes === 0 &&
        putAttempts < 3
      ) {
        signatureRefreshes += 1;
        await refreshAuthorization();
        continue;
      }
      if (decision.action !== "retry-put" || putAttempts >= 3) {
        throw error;
      }
      const status = await getStatus();
      if (["ready", "processing"].includes(status?.validationState)) {
        return reconcileUpload({
          conflict: false,
          getStatus,
          finalize,
          sleep,
          maxStatusPolls,
          onPhase
        });
      }
      const delay = 500 * 2 ** (putAttempts - 1) + Math.floor(random() * 250);
      await sleep(delay);
    }
  }
  throw albumMediaError(
    ALBUM_MEDIA_ERROR_CODES.network,
    "COS upload failed after three attempts"
  );
}

export function shouldRefreshAlbumMedia(
  expiresAt,
  { nowMs = Date.now(), skewMs = 30_000 } = {}
) {
  const expiresMs = Date.parse(String(expiresAt || ""));
  return Number.isFinite(expiresMs) && expiresMs - nowMs <= skewMs;
}

function mergeMediaCollection(currentItems = [], refreshedItems = []) {
  const currentById = new Map(currentItems.map((item) => [Number(item.id), item]));
  return refreshedItems.map((refreshed) => {
    const current = currentById.get(Number(refreshed.id));
    if (!current) {
      return refreshed;
    }
    const next = { ...current, ...refreshed };
    if (!isModerationPublished(refreshed.moderation_status)) {
      for (const field of [...URL_FIELDS, ...LOCAL_MEDIA_FIELDS]) {
        delete next[field];
      }
    }
    return next;
  });
}

export function mergeAlbumMediaUrls(currentAlbum = {}, refreshedAlbum = {}) {
  const next = { ...currentAlbum };
  if (Array.isArray(currentAlbum.photos)) {
    next.photos = mergeMediaCollection(currentAlbum.photos, refreshedAlbum.photos || []);
  }
  if (Array.isArray(currentAlbum.media)) {
    next.media = mergeMediaCollection(
      currentAlbum.media,
      refreshedAlbum.media || refreshedAlbum.photos || []
    );
  }
  return next;
}

export function createSingleFlight() {
  let active = null;
  return {
    run(work) {
      if (active) {
        return active;
      }
      active = Promise.resolve()
        .then(work)
        .finally(() => {
          active = null;
        });
      return active;
    },
    get active() {
      return Boolean(active);
    }
  };
}
