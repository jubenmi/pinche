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
  const appendedPhotos = [];
  const seen = new Set();
  const append = (photo, incomingPhoto) => {
    if (!validMedia(photo) || seen.has(Number(photo.id))) return;
    seen.add(Number(photo.id));
    photos.push(photo);
    if (incomingPhoto) appendedPhotos.push(photo);
  };
  for (const photo of Array.isArray(current) ? current : []) append(photo, false);
  for (const photo of Array.isArray(incoming) ? incoming : []) append(photo, true);
  const nextCursor = page?.has_more === true
    ? nonEmptyText(page?.next_cursor)
    : null;
  return { photos, appendedPhotos, nextCursor, hasMore: Boolean(nextCursor) };
}
