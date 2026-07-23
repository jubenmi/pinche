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
    path === ALBUM_SHARE_TIMELINE_FALLBACK ||
    /^(wxfile:\/\/|file:\/\/|\/tmp\/|\/private\/|\/var\/)/.test(path)
  ) {
    return path;
  }
  return "";
}

export function albumShareCoverRecipe(response = {}) {
  const recipe = response?.cover_recipe;
  return recipe && typeof recipe === "object" && !Array.isArray(recipe) ? recipe : null;
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
