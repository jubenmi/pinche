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

export function samePublicAlbumMediaSequence(current = [], refreshed = []) {
  if (!Array.isArray(current) || !Array.isArray(refreshed)) return false;
  if (current.length !== refreshed.length) return false;
  return current.every((photo, index) => (
    validMedia(photo)
    && validMedia(refreshed[index])
    && Number(photo.id) === Number(refreshed[index].id)
  ));
}

export function replacePublicAlbumMediaRows(rows = [], photos = []) {
  const refreshedById = new Map(
    (Array.isArray(photos) ? photos : [])
      .filter(validMedia)
      .map((photo) => [Number(photo.id), photo])
  );
  return (Array.isArray(rows) ? rows : []).map(
    (row) => refreshedById.get(Number(row?.id)) || row
  );
}

export async function reloadPublicAlbumSharePrefix({
  pageCount = 1,
  loadPage
} = {}) {
  if (typeof loadPage !== "function") {
    throw new TypeError("loadPage must be a function");
  }
  const requestedPageCount = Number(pageCount);
  const targetPageCount =
    Number.isSafeInteger(requestedPageCount) && requestedPageCount > 0
      ? requestedPageCount
      : 1;
  let firstPage = null;
  let photos = [];
  let nextCursor = null;
  let hasMore = true;
  let loadedPageCount = 0;

  while (
    loadedPageCount < targetPageCount
    && (loadedPageCount === 0 || hasMore)
  ) {
    const page = await loadPage({
      pageIndex: loadedPageCount,
      cursor: loadedPageCount === 0 ? null : nextCursor
    });
    if (page === null) return null;
    if (!page || typeof page !== "object" || Array.isArray(page)) {
      throw new Error("Invalid public album refresh page");
    }
    if (firstPage === null) firstPage = page;
    const merged = mergePublicAlbumSharePages(photos, page.photos, page);
    photos = merged.photos;
    nextCursor = merged.nextCursor;
    hasMore = merged.hasMore;
    loadedPageCount += 1;
  }

  return { firstPage, photos, nextCursor, hasMore, loadedPageCount };
}
