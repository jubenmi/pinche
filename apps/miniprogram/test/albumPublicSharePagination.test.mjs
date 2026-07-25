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

test("public-share refresh reloads the currently loaded prefix and keeps the last cursor", async () => {
  assert.equal(typeof pagination?.reloadPublicAlbumSharePrefix, "function");
  const pages = new Map([
    [null, {
      photos: [{ id: 1 }, { id: 2 }],
      next_cursor: "cursor-2",
      has_more: true,
      visible_count: 5
    }],
    ["cursor-2", {
      photos: [{ id: 3 }, { id: 4 }],
      next_cursor: "cursor-3",
      has_more: true
    }]
  ]);
  const cursors = [];

  const refreshed = await pagination.reloadPublicAlbumSharePrefix({
    pageCount: 2,
    loadPage: async ({ cursor }) => {
      cursors.push(cursor);
      return pages.get(cursor);
    }
  });

  assert.deepEqual(cursors, [null, "cursor-2"]);
  assert.equal(refreshed.firstPage.visible_count, 5);
  assert.deepEqual(refreshed.photos.map(({ id }) => id), [1, 2, 3, 4]);
  assert.equal(refreshed.nextCursor, "cursor-3");
  assert.equal(refreshed.hasMore, true);
  assert.equal(refreshed.loadedPageCount, 2);
});

test("public-share refresh discards a stale partial prefix", async () => {
  assert.equal(typeof pagination?.reloadPublicAlbumSharePrefix, "function");
  const refreshed = await pagination.reloadPublicAlbumSharePrefix({
    pageCount: 2,
    loadPage: async ({ pageIndex }) => (
      pageIndex === 0
        ? {
          photos: [{ id: 1 }, { id: 2 }],
          next_cursor: "cursor-2",
          has_more: true
        }
        : null
    )
  });

  assert.equal(refreshed, null);
});

test("public-share refresh distinguishes field updates from media-set changes", () => {
  assert.equal(typeof pagination?.samePublicAlbumMediaSequence, "function");
  assert.equal(typeof pagination?.replacePublicAlbumMediaRows, "function");
  const refreshedPhotos = [
    { id: 1, preview_display_url: "new-1" },
    { id: 2, preview_display_url: "new-2" }
  ];

  assert.equal(
    pagination.samePublicAlbumMediaSequence(
      [{ id: 1 }, { id: 2 }],
      [{ id: "1" }, { id: 2, preview_display_url: "new" }]
    ),
    true
  );
  assert.equal(
    pagination.samePublicAlbumMediaSequence([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }]),
    false
  );
  assert.equal(
    pagination.samePublicAlbumMediaSequence([{ id: 1 }, { id: 2 }], [{ id: 1 }]),
    false
  );
  assert.deepEqual(
    pagination.replacePublicAlbumMediaRows(
      [{ id: 2, preview_display_url: "old" }],
      refreshedPhotos
    ),
    [refreshedPhotos[1]]
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
  const appendPublicAlbumWaterfallPhotos = sourceBlock(
    albumSource,
    "appendPublicAlbumWaterfallPhotos(photos = []) {",
    "refreshWaterfall() {"
  );

  assert.match(albumSource, /publicShareLoadedPageCount: 0/);
  assert.match(loadPublicAlbum, /this\.publicShareLoadedPageCount = 1/);
  assert.match(resetPublicSharePagination, /this\.publicShareLoadedPageCount = 0/);
  assert.match(
    loadMorePublicAlbum,
    /this\.appendPublicAlbumWaterfallPhotos\s*\(\s*merged\.appendedPhotos\s*\)/
  );
  assert.match(loadMorePublicAlbum, /this\.publicShareLoadedPageCount \+= 1/);
  assert.match(loadMorePublicAlbum, /this\.albumMediaRefresh\?\.schedule\(\)/);
  assert.match(
    appendPublicAlbumWaterfallPhotos,
    /this\.waterfallPhotos\s*=\s*\[\s*\.\.\.this\.waterfallPhotos\s*,\s*\.\.\.appended\s*\]/
  );
  const forbiddenOperations = [
    ["refreshWaterfall call", /this\.refreshWaterfall\s*\(/],
    ["waterfall clear call", /\.clear\s*\(/],
    ["empty waterfall model assignment", /waterfallPhotos\s*=\s*\[\s*\]/],
    ["page scroll call", /pageScrollTo\s*\(/]
  ];
  for (const [blockName, block] of [
    ["continuation loading", loadMorePublicAlbum],
    ["waterfall append helper", appendPublicAlbumWaterfallPhotos]
  ]) {
    for (const [operationName, pattern] of forbiddenOperations) {
      assert.doesNotMatch(block, pattern, `${blockName}: ${operationName}`);
    }
  }
});
