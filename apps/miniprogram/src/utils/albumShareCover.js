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

export function albumShareCoverResponse(response = {}) {
  return {
    friend: trimmedString(response?.friend_cover_url) || trimmedString(response?.cover_url),
    timeline: trimmedString(response?.timeline_cover_url)
  };
}

export function albumShareMenus({ token, friendReady, timelineReady } = {}) {
  if (!trimmedString(token)) return [];
  const menus = [];
  if (friendReady === true) menus.push("shareAppMessage");
  if (timelineReady === true) menus.push("shareTimeline");
  return menus;
}

export function albumShareImage(kind, imageUrl) {
  return trimmedString(imageUrl) || fallbackFor(kind);
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
