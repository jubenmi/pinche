const RECRUITMENT_SHARE_IMAGE = "/static/art/ticket-landscape.jpg";

export const ALBUM_SHARE_INTENT = Object.freeze({
  RECRUIT: "recruit",
  ACTIVE: "active",
  SINGLE: "single",
  DEFAULT_ALL: "default_all",
  PUBLIC: "public",
  UNKNOWN: "unknown"
});

function trimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  const normalized = trimmedString(value);
  if (!/^[0-9]+$/.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function authorityKey({ sessionId, userId, mediaVersion } = {}) {
  const normalizedSessionId = normalizePositiveInteger(sessionId);
  const normalizedUserId = normalizePositiveInteger(userId);
  const normalizedMediaVersion = normalizePositiveInteger(mediaVersion);
  if (
    normalizedSessionId === null ||
    normalizedUserId === null ||
    normalizedMediaVersion === null
  ) {
    return "";
  }
  return `${normalizedSessionId}:${normalizedUserId}:${normalizedMediaVersion}`;
}

function shareTimestamp(now) {
  const candidate = now === undefined ? Date.now() : now;
  return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : Date.now();
}

export function albumShareAppMessageIntent(
  options = {},
  { timelineMode = false } = {}
) {
  const isButton = options?.from === "button";
  const dataset = options?.target?.dataset || {};

  if (isButton && dataset.albumShare === ALBUM_SHARE_INTENT.RECRUIT) {
    return { kind: ALBUM_SHARE_INTENT.RECRUIT };
  }
  if (isButton && dataset.albumShare === ALBUM_SHARE_INTENT.ACTIVE) {
    return { kind: ALBUM_SHARE_INTENT.ACTIVE };
  }

  const mediaId = isButton ? normalizePositiveInteger(dataset.mediaId) : null;
  if (mediaId !== null) {
    return { kind: ALBUM_SHARE_INTENT.SINGLE, mediaId };
  }
  if (isButton) return { kind: ALBUM_SHARE_INTENT.UNKNOWN };

  return {
    kind: timelineMode
      ? ALBUM_SHARE_INTENT.PUBLIC
      : ALBUM_SHARE_INTENT.DEFAULT_ALL
  };
}

export function recruitmentSharePayload({
  sessionId,
  inviteToken,
  title,
  now
} = {}) {
  const normalizedSessionId = normalizePositiveInteger(sessionId);
  const normalizedInviteToken = trimmedString(inviteToken);
  const normalizedTitle = trimmedString(title);
  if (
    normalizedSessionId === null ||
    !normalizedInviteToken ||
    !normalizedTitle
  ) {
    return null;
  }

  const timestamp = shareTimestamp(now);
  const shareCode = `s${normalizedSessionId}-${timestamp}`;
  return {
    title: normalizedTitle,
    path: [
      "/pages/session/share?id=" + encodeURIComponent(normalizedSessionId),
      `shareCode=${encodeURIComponent(shareCode)}`,
      `inviteToken=${encodeURIComponent(normalizedInviteToken)}`,
      "source=wechat_share"
    ].join("&"),
    imageUrl: RECRUITMENT_SHARE_IMAGE
  };
}

export function createAlbumShareEntryAuthority() {
  let serial = 0;
  let currentKey = "";
  let currentRequest = null;

  return {
    begin(identity) {
      const key = authorityKey(identity);
      if (!key) return null;
      if (currentRequest && currentKey === key) return currentRequest;

      currentKey = key;
      currentRequest = Object.freeze({ key, serial: ++serial });
      return currentRequest;
    },
    isCurrent(request) {
      return (
        Number.isSafeInteger(request?.serial) &&
        request.serial === serial &&
        request.key === currentKey
      );
    },
    invalidate() {
      serial += 1;
      currentKey = "";
      currentRequest = null;
    }
  };
}

export function createAlbumShareEntryCoordinator() {
  let tail = Promise.resolve();
  let generation = 0;

  function enqueue(renderer) {
    if (typeof renderer !== "function") {
      throw new TypeError("album share renderer must be a function");
    }

    const rendererGeneration = generation;
    const context = Object.freeze({
      generation: rendererGeneration,
      isCurrent: () => rendererGeneration === generation
    });
    const result = tail.then(() => {
      if (!context.isCurrent()) return undefined;
      return renderer(context);
    });
    tail = result.catch(() => undefined);
    return result;
  }

  return Object.freeze({
    enqueue,
    run: enqueue,
    whenIdle: () => tail,
    invalidate: () => {
      generation += 1;
    }
  });
}
