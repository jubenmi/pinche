import {
  albumShareCanvasRecipeDigest,
  albumShareLocalImagePath as canvasLocalImagePath
} from "./albumShareCanvas.js";

export const ALBUM_SHARE_FRIEND_FALLBACK = "/static/art/album-share-friend.jpg";
export const ALBUM_SHARE_TIMELINE_FALLBACK = "/static/art/album-share-timeline.jpg";

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
  return canvasLocalImagePath(path);
}

export function albumShareLocalImagePath(value) {
  const path = trimmedString(value);
  if (/^http:\/\/tmp(?:\/|$)/i.test(path)) return path;
  return /^(?:wxfile:\/\/|file:\/\/|\/tmp\/|\/private\/|\/var\/)/.test(path)
    ? path
    : "";
}

export function albumShareCoverRecipe(response = {}) {
  const recipe = response?.cover_recipe;
  return recipe && typeof recipe === "object" && !Array.isArray(recipe) ? recipe : null;
}

function localPreview(localPreviewByMediaId, image) {
  const key = String(image?.id || "");
  let value = "";
  try {
    if (typeof localPreviewByMediaId === "function") {
      value = localPreviewByMediaId(key, image);
    } else if (localPreviewByMediaId instanceof Map) {
      value = localPreviewByMediaId.get(key) || localPreviewByMediaId.get(Number(key));
    } else if (localPreviewByMediaId && typeof localPreviewByMediaId === "object") {
      value = localPreviewByMediaId[key];
    }
  } catch {
    value = "";
  }
  return albumShareLocalImagePath(value);
}

export function selectAlbumShareTimelineImage({
  response,
  localPreviewByMediaId,
  thumbnailUrlResolver = (url) => url
} = {}) {
  const images = albumShareCoverRecipe(response)?.images;
  if (!Array.isArray(images)) return "";
  for (const image of images) {
    const local = localPreview(localPreviewByMediaId, image);
    if (local) return local;
    const thumbnail = trimmedString(image?.thumbnail_url);
    if (!thumbnail) continue;
    let online = "";
    try {
      online = trimmedString(thumbnailUrlResolver(thumbnail, image));
    } catch {
      online = "";
    }
    if (/^https?:\/\//i.test(online)) return online;
  }
  return "";
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

export function albumShareMenus({ token, timelineReady } = {}) {
  if (!trimmedString(token)) return [];
  const menus = ["shareAppMessage"];
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
  if (typeof requestAuthority?.isCoverRequestCurrent !== "function") {
    return false;
  }
  if (!canvasPreparation && !canvasRequest) {
    return requestAuthority.isCoverRequestCurrent(coverRequest, token) === true;
  }
  if (typeof canvasPreparation?.isCurrent !== "function") return false;
  return requestAuthority.isCoverRequestCurrent(coverRequest, token) === true &&
    canvasPreparation.isCurrent(canvasRequest) === true;
}

export function startAlbumShareCoverPreparation({
  response,
  kinds = ["friend", "timeline"],
  prepare,
  isCurrent = () => true,
  onPrepared = () => {}
} = {}) {
  if (typeof prepare !== "function") {
    throw new TypeError("album share cover preparation requires prepare");
  }
  const recipe = albumShareCoverRecipe(response);
  return kinds.map((kind) => Promise.resolve()
    .then(() => prepare(kind, recipe))
    .catch(() => null)
    .then((result) => {
      if (isCurrent() !== true) return false;
      onPrepared(kind, albumShareImage(kind, result?.ok === true ? result.path : result));
      return true;
    })
  );
}

export function albumShareFriendPayload({ title, path } = {}) {
  return {
    title: trimmedString(title),
    path: trimmedString(path)
  };
}

export function albumShareTimelinePayload({ title, query, imageUrl } = {}) {
  const normalizedImageUrl =
    albumShareLocalImagePath(imageUrl) ||
    (/^https?:\/\//i.test(trimmedString(imageUrl)) ? trimmedString(imageUrl) : "");
  if (!normalizedImageUrl) return null;
  return {
    title: trimmedString(title),
    query: trimmedString(query),
    imageUrl: normalizedImageUrl
  };
}
