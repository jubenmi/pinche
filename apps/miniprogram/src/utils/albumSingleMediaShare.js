const SHARE_ENTRY_STATUSES = new Set(["loading", "ready", "blocked", "failed"]);

function normalizedPositiveSafeInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const normalized = Number(trimmed);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function createState(entries = {}, serial = 0, latestSerialByMediaId = {}) {
  return Object.freeze({
    entries: Object.freeze(entries),
    serial,
    latestSerialByMediaId: Object.freeze(latestSerialByMediaId)
  });
}

function normalizedStateSerial(state) {
  return Number.isSafeInteger(state?.serial) && state.serial >= 0 ? state.serial : 0;
}

function requestIsCurrent(state, request) {
  const mediaId = normalizeFocusedMediaId(request?.mediaId);
  return (
    mediaId !== null &&
    Number.isSafeInteger(request?.serial) &&
    request.serial > 0 &&
    state?.latestSerialByMediaId?.[mediaId] === request.serial
  );
}

function replaceEntry(state, mediaId, entry) {
  return createState(
    {
      ...(state?.entries || {}),
      [mediaId]: Object.freeze(entry)
    },
    normalizedStateSerial(state),
    state?.latestSerialByMediaId || {}
  );
}

function safeShareError(error) {
  const safeError = {};
  if (typeof error?.code === "string" && error.code) safeError.code = error.code;
  if (Number.isFinite(error?.status)) safeError.status = error.status;
  if (Number.isFinite(error?.statusCode)) safeError.statusCode = error.statusCode;
  if (typeof error?.userMessage === "string" && error.userMessage) {
    safeError.userMessage = error.userMessage;
  }
  return Object.freeze(safeError);
}

export function normalizeFocusedMediaId(value) {
  return normalizedPositiveSafeInteger(value);
}

export function createSingleMediaShareState() {
  return createState();
}

export function resetSingleMediaShareState(state) {
  return createState({}, normalizedStateSerial(state));
}

export function beginSingleMediaShareRequest(state, mediaId) {
  const normalizedMediaId = normalizeFocusedMediaId(mediaId);
  if (!normalizedMediaId) return Object.freeze({ state, request: null });
  const serial = normalizedStateSerial(state) + 1;
  const request = Object.freeze({ mediaId: normalizedMediaId, serial });
  const nextState = createState(
    {
      ...(state?.entries || {}),
      [normalizedMediaId]: Object.freeze({
        mediaId: normalizedMediaId,
        serial,
        status: "loading"
      })
    },
    serial,
    {
      ...(state?.latestSerialByMediaId || {}),
      [normalizedMediaId]: serial
    }
  );
  return Object.freeze({ state: nextState, request });
}

export function resolveSingleMediaShareRequest(state, request, entry = {}) {
  if (!requestIsCurrent(state, request)) return state;
  const { mediaId: _mediaId, serial: _serial, status: _status, error: _error, ...details } = entry || {};
  return replaceEntry(state, request.mediaId, {
    ...details,
    mediaId: request.mediaId,
    serial: request.serial,
    status: "ready"
  });
}

export function rejectSingleMediaShareRequest(state, request, error) {
  if (!requestIsCurrent(state, request)) return state;
  const normalizedError = safeShareError(error);
  return replaceEntry(state, request.mediaId, {
    mediaId: request.mediaId,
    serial: request.serial,
    status: normalizedError.code === "ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE" ? "blocked" : "failed",
    error: normalizedError
  });
}

export function singleMediaShareEntryFor(state, mediaId) {
  const normalizedMediaId = normalizeFocusedMediaId(mediaId);
  const entry = normalizedMediaId ? state?.entries?.[normalizedMediaId] : null;
  return normalizeFocusedMediaId(entry?.mediaId) === normalizedMediaId ? entry : null;
}

export function focusedPublicMedia(photos = [], focusMediaId) {
  const normalizedFocusMediaId = normalizeFocusedMediaId(focusMediaId);
  if (!normalizedFocusMediaId || !Array.isArray(photos)) return null;
  return photos.find(
    (photo) => normalizeFocusedMediaId(photo?.id) === normalizedFocusMediaId
  ) || null;
}

export function createSingleMediaShareAuthority() {
  let state = createSingleMediaShareState();

  return {
    begin(mediaId) {
      const started = beginSingleMediaShareRequest(state, mediaId);
      state = started.state;
      return started.request;
    },
    resolve(request, entry = {}) {
      const nextState = resolveSingleMediaShareRequest(state, request, entry);
      const changed = nextState !== state;
      state = nextState;
      return changed ? singleMediaShareEntryFor(state, request?.mediaId) : null;
    },
    reject(request, error) {
      const nextState = rejectSingleMediaShareRequest(state, request, error);
      const changed = nextState !== state;
      state = nextState;
      return changed ? singleMediaShareEntryFor(state, request?.mediaId) : null;
    },
    entryFor(mediaId) {
      return singleMediaShareEntryFor(state, mediaId);
    },
    currentEntry(mediaId) {
      const entry = singleMediaShareEntryFor(state, mediaId);
      return SHARE_ENTRY_STATUSES.has(entry?.status) ? entry : null;
    },
    snapshot() {
      return state;
    },
    reset() {
      state = resetSingleMediaShareState(state);
      return state;
    }
  };
}

export function singleMediaSharePath({ sessionId, token, mediaId } = {}) {
  const normalizedSessionId = normalizedPositiveSafeInteger(sessionId);
  const normalizedMediaId = normalizeFocusedMediaId(mediaId);
  if (!normalizedSessionId || !normalizedMediaId || typeof token !== "string" || !token.trim()) {
    return "";
  }
  return "/pages/session/album?" + [
    ["id", normalizedSessionId],
    ["source", "single_media_share"],
    ["albumShareToken", token],
    ["focusMediaId", normalizedMediaId]
  ].map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
}
