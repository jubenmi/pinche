import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pagination = await import("../src/utils/albumPublicSharePagination.js").catch(() => null);
const albumSource = await readFile(
  new URL("../src/pages/session/album.vue", import.meta.url),
  "utf8"
);

function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, start);
  assert.notEqual(endIndex, -1, end);
  return source.slice(startIndex, endIndex);
}

test("public-share pagination builds a token-bound continuation URL", () => {
  assert.equal(typeof pagination?.publicAlbumSharePageUrl, "function");
  assert.equal(
    pagination.publicAlbumSharePageUrl({ sessionId: 10, token: "token +/?", cursor: "next /?" }),
    "/api/sessions/10/album/public-share?token=token%20%2B%2F%3F&cursor=next%20%2F%3F"
  );
  assert.equal(pagination.publicAlbumSharePageUrl({ sessionId: 10, token: "", cursor: "next" }), "");
});

test("public-share pagination appends unique media and only retains a valid continuation cursor", () => {
  assert.equal(typeof pagination?.mergePublicAlbumSharePages, "function");
  const merged = pagination.mergePublicAlbumSharePages(
    [{ id: 1 }, { id: 2 }],
    [{ id: 2 }, { id: 3 }],
    { next_cursor: "next", has_more: true }
  );
  assert.deepEqual(merged.photos.map(({ id }) => id), [1, 2, 3]);
  assert.deepEqual(merged.appendedPhotos.map(({ id }) => id), [3]);
  assert.equal(merged.nextCursor, "next");
  assert.equal(merged.hasMore, true);
  assert.deepEqual(
    pagination.mergePublicAlbumSharePages(
      [{ id: 1 }],
      [{ id: 1 }, { id: 0 }, {}],
      { next_cursor: "next", has_more: false }
    ),
    { photos: [{ id: 1 }], appendedPhotos: [], nextCursor: null, hasMore: false }
  );
});

test("album page declares guarded public-share continuation loading", () => {
  assert.match(albumSource, /onReachBottom\(\)/);
  assert.match(albumSource, /async loadMorePublicAlbum\(\)/);
  assert.match(albumSource, /publicShareLoadingMore/);
  assert.match(albumSource, /publicShareLoadMoreError/);
});

test("public-share continuation appends without rebuilding mounted cards", () => {
  const loadPublicAlbum = sourceBlock(
    albumSource,
    "async loadPublicAlbum() {",
    "resetPublicSharePagination() {"
  );
  const resetPublicSharePagination = sourceBlock(
    albumSource,
    "resetPublicSharePagination() {",
    "async loadMorePublicAlbum() {"
  );
  const loadMorePublicAlbum = sourceBlock(
    albumSource,
    "async loadMorePublicAlbum() {",
    "retryAlbumLoad() {"
  );

  assert.match(albumSource, /publicShareLoadedPageCount: 0/);
  assert.match(loadPublicAlbum, /this\.publicShareLoadedPageCount = 1/);
  assert.match(resetPublicSharePagination, /this\.publicShareLoadedPageCount = 0/);
  assert.match(loadMorePublicAlbum, /this\.appendPublicAlbumWaterfallPhotos\(merged\.appendedPhotos\)/);
  assert.match(loadMorePublicAlbum, /this\.publicShareLoadedPageCount \+= 1/);
  assert.match(loadMorePublicAlbum, /this\.albumMediaRefresh\?\.schedule\(\)/);
  for (const forbidden of [
    "this.refreshWaterfall()",
    ".clear()",
    "waterfallPhotos = []",
    "pageScrollTo"
  ]) {
    assert.equal(loadMorePublicAlbum.includes(forbidden), false, forbidden);
  }
});
