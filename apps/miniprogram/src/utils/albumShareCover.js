function trimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
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

export function albumShareMenus({ token, timelineReady } = {}) {
  if (!trimmedString(token)) return [];
  const menus = ["shareAppMessage"];
  if (timelineReady === true) menus.push("shareTimeline");
  return menus;
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
