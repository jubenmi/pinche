import {
  albumShareCanvasRecipeDigest,
  albumShareLocalImagePath,
  normalizeAlbumShareCoverRecipe
} from "./albumShareCanvas.js";

export const ALBUM_SHARE_FRIEND_FALLBACK = "/static/art/album-share-friend.jpg";
export const ALBUM_SHARE_TIMELINE_FALLBACK = "/static/art/album-share-timeline.jpg";
export const ALBUM_SHARE_LOCAL_PREVIEW_HANDOFF_TTL_MS = 2 * 60 * 1000;

const ALBUM_SHARE_LOCAL_PREVIEW_HANDOFF_LIMIT = 4;
const albumShareLocalPreviewHandoffs = new Map();

function trimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function fallbackFor(kind) {
  if (kind === "friend") return ALBUM_SHARE_FRIEND_FALLBACK;
  if (kind === "timeline") return ALBUM_SHARE_TIMELINE_FALLBACK;
  throw new TypeError("album share cover kind must be friend or timeline");
}

function localShareImagePath(value) {
  const path = trimmedString(value);
  if (!path) return "";
  if (
    path === ALBUM_SHARE_FRIEND_FALLBACK ||
    path === ALBUM_SHARE_TIMELINE_FALLBACK
  ) {
    return path;
  }
  return albumShareLocalImagePath(path);
}

function handoffNow(options = {}) {
  const value = Number(options?.now);
  return Number.isFinite(value) && value >= 0 ? value : Date.now();
}

function albumShareLocalPreviewHandoffIdentity({ token, recipe } = {}) {
  const normalizedToken = trimmedString(token);
  const recipeDigest = albumShareCanvasRecipeDigest(recipe);
  if (!normalizedToken || !recipeDigest) return "";
  return JSON.stringify([normalizedToken, recipeDigest]);
}

function pruneAlbumShareLocalPreviewHandoffs(now) {
  for (const [identity, entry] of albumShareLocalPreviewHandoffs) {
    if (!entry || Number(entry.expiresAt) <= now) {
      albumShareLocalPreviewHandoffs.delete(identity);
    }
  }
}

function albumShareHandoffLocalPath(localPreviewByMediaId, image) {
  try {
    if (typeof localPreviewByMediaId === "function") {
      return albumShareLocalImagePath(localPreviewByMediaId(image.id, image));
    }
    if (localPreviewByMediaId instanceof Map) {
      return albumShareLocalImagePath(
        localPreviewByMediaId.get(image.id) ||
          localPreviewByMediaId.get(String(image.id))
      );
    }
    if (localPreviewByMediaId && typeof localPreviewByMediaId === "object") {
      return albumShareLocalImagePath(localPreviewByMediaId[image.id]);
    }
  } catch {
    return "";
  }
  return "";
}

export function rememberAlbumShareLocalPreviewHandoff(
  { token, recipe, localPreviewByMediaId } = {},
  options = {}
) {
  const identity = albumShareLocalPreviewHandoffIdentity({ token, recipe });
  const normalizedRecipe = normalizeAlbumShareCoverRecipe(recipe);
  if (!identity || !normalizedRecipe) return false;

  const localPaths = new Map();
  for (const image of normalizedRecipe.images) {
    const localPath = albumShareHandoffLocalPath(localPreviewByMediaId, image);
    if (localPath) localPaths.set(String(image.id), localPath);
  }
  if (localPaths.size === 0) {
    albumShareLocalPreviewHandoffs.delete(identity);
    return false;
  }

  const now = handoffNow(options);
  pruneAlbumShareLocalPreviewHandoffs(now);
  albumShareLocalPreviewHandoffs.delete(identity);
  while (albumShareLocalPreviewHandoffs.size >= ALBUM_SHARE_LOCAL_PREVIEW_HANDOFF_LIMIT) {
    const oldestIdentity = albumShareLocalPreviewHandoffs.keys().next().value;
    albumShareLocalPreviewHandoffs.delete(oldestIdentity);
  }
  albumShareLocalPreviewHandoffs.set(identity, {
    expiresAt: now + ALBUM_SHARE_LOCAL_PREVIEW_HANDOFF_TTL_MS,
    localPaths
  });
  return true;
}

export function takeAlbumShareLocalPreviewHandoff(
  { token, recipe } = {},
  options = {}
) {
  const now = handoffNow(options);
  pruneAlbumShareLocalPreviewHandoffs(now);
  const identity = albumShareLocalPreviewHandoffIdentity({ token, recipe });
  if (!identity) return new Map();
  const entry = albumShareLocalPreviewHandoffs.get(identity);
  if (!entry) return new Map();
  albumShareLocalPreviewHandoffs.delete(identity);
  return new Map(entry.localPaths);
}

export function forgetAlbumShareLocalPreviewHandoff({ token, recipe } = {}) {
  const normalizedToken = trimmedString(token);
  if (!normalizedToken) return false;
  const identity = albumShareLocalPreviewHandoffIdentity({ token: normalizedToken, recipe });
  if (identity) return albumShareLocalPreviewHandoffs.delete(identity);

  let deleted = false;
  for (const candidateIdentity of albumShareLocalPreviewHandoffs.keys()) {
    let candidateToken = "";
    try {
      const parsed = JSON.parse(candidateIdentity);
      candidateToken = Array.isArray(parsed) ? trimmedString(parsed[0]) : "";
    } catch {
      candidateToken = "";
    }
    if (candidateToken === normalizedToken) {
      albumShareLocalPreviewHandoffs.delete(candidateIdentity);
      deleted = true;
    }
  }
  return deleted;
}

export function albumShareCoverRecipe(response = {}) {
  const recipe = response?.cover_recipe;
  return recipe && typeof recipe === "object" && !Array.isArray(recipe) ? recipe : null;
}

export function albumShareCoverContextKey({ token, recipe, title } = {}) {
  const normalizedToken = trimmedString(token);
  if (!normalizedToken) return "";
  return [
    encodeURIComponent(normalizedToken),
    albumShareCanvasRecipeDigest(recipe),
    encodeURIComponent(trimmedString(title).slice(0, 48))
  ].join(":");
}

export function albumShareMenus({ token, friendReady, timelineReady } = {}) {
  if (!trimmedString(token)) return [];
  const menus = [];
  if (friendReady === true) menus.push("shareAppMessage");
  if (timelineReady === true) menus.push("shareTimeline");
  return menus;
}

export function albumShareImage(kind, imageUrl) {
  return localShareImagePath(imageUrl) || fallbackFor(kind);
}

export function createAlbumShareRequestAuthority() {
  let tokenSerial = 0;
  let coverSerial = 0;

  return {
    beginTokenRequest() {
      return Object.freeze({ serial: ++tokenSerial });
    },
    isTokenRequestCurrent(request) {
      return Number.isSafeInteger(request?.serial) && request.serial === tokenSerial;
    },
    beginCoverRequest(token) {
      return Object.freeze({ serial: ++coverSerial, token: trimmedString(token) });
    },
    isCoverRequestCurrent(request, token) {
      return (
        Number.isSafeInteger(request?.serial) &&
        request.serial === coverSerial &&
        request.token === trimmedString(token)
      );
    },
    invalidateCoverRequests() {
      coverSerial += 1;
    },
    invalidate() {
      tokenSerial += 1;
      coverSerial += 1;
    }
  };
}

export function albumShareCoverPreparationIsCurrent({
  requestAuthority,
  coverRequest,
  token,
  canvasPreparation,
  canvasRequest
} = {}) {
  if (
    typeof requestAuthority?.isCoverRequestCurrent !== "function" ||
    typeof canvasPreparation?.isCurrent !== "function"
  ) {
    return false;
  }
  return (
    requestAuthority.isCoverRequestCurrent(coverRequest, token) === true &&
    canvasPreparation.isCurrent(canvasRequest) === true
  );
}

export function startAlbumShareCoverPreparation({
  response,
  prepare,
  isCurrent = () => true,
  onPrepared = () => {}
} = {}) {
  if (typeof prepare !== "function") {
    throw new TypeError("album share cover preparation requires prepare");
  }
  const recipe = albumShareCoverRecipe(response);
  return ["friend", "timeline"].map((kind) => Promise.resolve()
    .then(() => prepare(kind, recipe))
    .catch(() => null)
    .then((result) => {
      if (isCurrent() !== true) return false;
      onPrepared(kind, albumShareImage(kind, result?.ok === true ? result.path : result));
      return true;
    })
  );
}

export function albumShareFriendPayload({ title, path, imageUrl } = {}) {
  return {
    title: trimmedString(title),
    path: trimmedString(path),
    imageUrl: albumShareImage("friend", imageUrl)
  };
}

export function albumShareTimelinePayload({ title, query, imageUrl } = {}) {
  return {
    title: trimmedString(title),
    query: trimmedString(query),
    imageUrl: albumShareImage("timeline", imageUrl)
  };
}
