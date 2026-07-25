const PUBLIC_ALBUM_MEDIA_STATE_BATCH_LIMIT = 100;
const PUBLIC_ALBUM_MEDIA_REFRESH_EARLY_MS = 30_000;
const DEFAULT_PUBLIC_ALBUM_MEDIA_RETRY_DELAY_MS = 30_000;
const MIN_PUBLIC_ALBUM_MEDIA_RETRY_DELAY_MS = 1_000;
const MAX_PUBLIC_ALBUM_MEDIA_RETRY_DELAY_MS = 2_147_483_647;

function validMediaId(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validCard(value) {
  return value !== null && typeof value === "object" && validMediaId(value.id);
}

function uniqueCards(values) {
  const cards = [];
  const seen = new Set();
  for (const card of values) {
    if (!validCard(card) || seen.has(card.id)) continue;
    seen.add(card.id);
    cards.push(card);
  }
  return cards;
}

function normalizedCursor(value) {
  if (typeof value !== "string") return null;
  const cursor = value.trim();
  return cursor || null;
}

function nextGeneration(value) {
  return Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER
    ? value + 1
    : 0;
}

export function createPublicAlbumReadState(generation = 0) {
  return {
    cards: [],
    nextCursor: null,
    pageLoading: false,
    pageError: "",
    generation: Number.isSafeInteger(generation) && generation >= 0 ? generation : 0,
  };
}

export function publicAlbumMediaStateBatches(mediaIds, limit = 100) {
  if (!Array.isArray(mediaIds)) {
    throw new TypeError("mediaIds must be an array");
  }
  if (
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > PUBLIC_ALBUM_MEDIA_STATE_BATCH_LIMIT
  ) {
    throw new RangeError(
      `limit must be a positive integer no greater than ${PUBLIC_ALBUM_MEDIA_STATE_BATCH_LIMIT}`,
    );
  }
  const ids = [];
  const seen = new Set();
  for (const id of mediaIds) {
    if (!validMediaId(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  const batches = [];
  for (let index = 0; index < ids.length; index += limit) {
    batches.push(ids.slice(index, index + limit));
  }
  return batches;
}

export function reducePublicAlbumReadState(state, event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return state;

  if (event.type === "UNLOAD") {
    return createPublicAlbumReadState(nextGeneration(state?.generation));
  }

  if (event.type === "INITIAL_PAGE") {
    if (!Array.isArray(event.cards)) return state;
    return {
      ...state,
      cards: uniqueCards(event.cards),
      nextCursor: normalizedCursor(event.nextCursor),
      pageLoading: false,
      pageError: "",
    };
  }

  if (event.type === "NEXT_PAGE") {
    if (event.status === "start") {
      return { ...state, pageLoading: true, pageError: "" };
    }
    if (event.status === "failure") {
      return {
        ...state,
        pageLoading: false,
        pageError: "继续加载失败，可重试。",
      };
    }
    if (event.status !== undefined && event.status !== "success") return state;
    if (!Array.isArray(event.cards)) return state;
    return {
      ...state,
      cards: uniqueCards([
        ...(Array.isArray(state?.cards) ? state.cards : []),
        ...event.cards,
      ]),
      nextCursor: normalizedCursor(event.nextCursor),
      pageLoading: false,
      pageError: "",
    };
  }

  if (event.type === "MEDIA_PATCH") {
    const hasPatches = Array.isArray(event.patches);
    const hasUnavailableIds = Array.isArray(event.unavailableIds);
    if (!hasPatches && !hasUnavailableIds) return state;
    const unavailable = new Set(
      (hasUnavailableIds ? event.unavailableIds : []).filter(validMediaId),
    );
    const patches = new Map();
    for (const patch of hasPatches ? event.patches : []) {
      if (!validCard(patch)) continue;
      patches.set(patch.id, patch);
    }
    return {
      ...state,
      cards: (Array.isArray(state?.cards) ? state.cards : [])
        .filter((card) => !unavailable.has(card.id))
        .map((card) => {
          const patch = patches.get(card.id);
          return patch ? { ...card, ...patch } : card;
        }),
    };
  }

  return state;
}

export function isCurrentPublicAlbumGeneration(state, generation) {
  return state?.generation === generation;
}

function normalizedRetryDelay(retryDelayMs) {
  if (typeof retryDelayMs !== "number" || !Number.isFinite(retryDelayMs)) {
    return DEFAULT_PUBLIC_ALBUM_MEDIA_RETRY_DELAY_MS;
  }
  return Math.min(
    MAX_PUBLIC_ALBUM_MEDIA_RETRY_DELAY_MS,
    Math.max(MIN_PUBLIC_ALBUM_MEDIA_RETRY_DELAY_MS, retryDelayMs),
  );
}

export function createPublicAlbumMediaStateController({
  readCards,
  refreshCards,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
  retryDelayMs = DEFAULT_PUBLIC_ALBUM_MEDIA_RETRY_DELAY_MS,
} = {}) {
  if (typeof readCards !== "function") {
    throw new TypeError("readCards must be a function");
  }
  if (typeof refreshCards !== "function") {
    throw new TypeError("refreshCards must be a function");
  }
  if (typeof setTimer !== "function" || typeof clearTimer !== "function") {
    throw new TypeError("timer functions must be functions");
  }
  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }

  const retryDelay = normalizedRetryDelay(retryDelayMs);
  let disposed = false;
  let timer = null;
  let timerVersion = 0;
  let flight = null;

  const cancel = () => {
    timerVersion += 1;
    const activeTimer = timer;
    timer = null;
    if (activeTimer !== null) clearTimer(activeTimer);
  };

  const installTimer = (delay) => {
    cancel();
    const version = timerVersion;
    timer = setTimer(() => {
      if (disposed || version !== timerVersion) return;
      timer = null;
      void refresh().catch(() => {});
    }, delay);
  };

  const schedule = () => {
    if (disposed) return;
    cancel();
    const cards = readCards();
    const expiries = (Array.isArray(cards) ? cards : [])
      .map((card) => (
        typeof card?.media_url_expires_at === "string"
          ? Date.parse(card.media_url_expires_at)
          : Number.NaN
      ))
      .filter(Number.isFinite);
    if (expiries.length === 0) return;
    const delay = Math.max(
      0,
      Math.min(...expiries) - now() - PUBLIC_ALBUM_MEDIA_REFRESH_EARLY_MS,
    );
    installTimer(delay);
  };

  const scheduleRetry = () => {
    if (disposed) return;
    installTimer(retryDelay);
  };

  const refresh = () => {
    if (disposed) return Promise.resolve(null);
    if (flight) return flight;
    const currentFlight = Promise.resolve()
      .then(() => refreshCards())
      .then((result) => {
        if (!disposed) schedule();
        return result;
      })
      .catch((error) => {
        if (!disposed) scheduleRetry();
        throw error;
      })
      .finally(() => {
        if (flight === currentFlight) flight = null;
      });
    flight = currentFlight;
    return currentFlight;
  };

  const dispose = () => {
    disposed = true;
    cancel();
  };

  return { refresh, schedule, dispose };
}
