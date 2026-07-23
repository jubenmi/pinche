function positiveSessionId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function nonEmptyText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function validMedia(photo) {
  const id = Number(photo?.id);
  return Number.isSafeInteger(id) && id > 0;
}

export function publicAlbumSharePageUrl({ sessionId, token, cursor } = {}) {
  const id = positiveSessionId(sessionId);
  const normalizedToken = nonEmptyText(token);
  const normalizedCursor = nonEmptyText(cursor);
  if (!id || !normalizedToken || !normalizedCursor) return "";
  return `/api/sessions/${id}/album/public-share?token=${encodeURIComponent(normalizedToken)}&cursor=${encodeURIComponent(normalizedCursor)}`;
}

export function mergePublicAlbumSharePages(current = [], incoming = [], page = {}) {
  const photos = [];
  const seen = new Set();
  for (const photo of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!validMedia(photo) || seen.has(Number(photo.id))) continue;
    seen.add(Number(photo.id));
    photos.push(photo);
  }
  const nextCursor = page?.has_more === true ? nonEmptyText(page?.next_cursor) : null;
  return {
    photos,
    nextCursor,
    hasMore: Boolean(nextCursor)
  };
}
