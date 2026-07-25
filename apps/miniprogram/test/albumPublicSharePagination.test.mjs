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

test("public paging utility has no prefix-reload or row-replacement authority", () => {
  assert.equal(pagination?.reloadPublicAlbumSharePrefix, undefined);
  assert.equal(pagination?.samePublicAlbumMediaSequence, undefined);
  assert.equal(pagination?.replacePublicAlbumMediaRows, undefined);
});

test("public media refresh is independent from the member full-album controller", () => {
  const controller = sourceBlock(
    albumSource,
    "initializeAlbumMediaRefreshController() {",
    "async loadAlbum() {"
  );

  assert.match(controller, /if \(this\.timelineMode\)/);
  assert.match(controller, /createPublicAlbumMediaStateController\(\{/);
  assert.match(controller, /refreshCards:\s*\(\)\s*=>\s*this\.refreshLoadedPublicAlbumMedia\(\)/);
  assert.match(controller, /createAlbumMediaRefreshController\(\{/);
  assert.doesNotMatch(controller, /reloadLoadedPublicAlbumPrefix|reloadPublicAlbumSharePrefix/);
  assert.doesNotMatch(controller, /samePublicAlbumMediaSequence|publicShareLoadedPageCount/);
  assert.doesNotMatch(controller, /this\.timelineMode\s*\?/);
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
    "async loadMorePublicAlbum() {"
  );
  const loadMorePublicAlbum = sourceBlock(
    albumSource,
    "async loadMorePublicAlbum() {",
    "async refreshLoadedPublicAlbumMedia() {"
  );
  const appendPublicAlbumWaterfallPhotos = sourceBlock(
    albumSource,
    "appendPublicAlbumWaterfallPhotos(photos = []) {",
    "applyPublicAlbumMediaPatchToWaterfall(cards = [], unavailableIds = []) {"
  );

  assert.match(loadPublicAlbum, /type:\s*"INITIAL_PAGE"/);
  assert.match(loadPublicAlbum, /this\.refreshWaterfall\(\)/);
  assert.match(loadMorePublicAlbum, /type:\s*"NEXT_PAGE",\s*status:\s*"start"/);
  assert.match(loadMorePublicAlbum, /type:\s*"NEXT_PAGE",\s*status:\s*"success"/);
  assert.match(loadMorePublicAlbum, /type:\s*"NEXT_PAGE",\s*status:\s*"failure"/);
  assert.match(loadMorePublicAlbum, /mergePublicAlbumSharePages\(/);
  assert.match(
    loadMorePublicAlbum,
    /this\.appendPublicAlbumWaterfallPhotos\s*\(\s*merged\.appendedPhotos\s*\)/
  );
  assert.match(loadMorePublicAlbum, /this\.publicAlbumMediaStateRefresh\?\.schedule\(\)/);
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

test("public media-state batches commit atomically and patch mounted rows once", () => {
  const refresh = sourceBlock(
    albumSource,
    "async refreshLoadedPublicAlbumMedia() {",
    "retryAlbumLoad() {"
  );
  const patch = sourceBlock(
    albumSource,
    "applyPublicAlbumMediaPatchToWaterfall(cards = [], unavailableIds = []) {",
    "refreshWaterfall() {"
  );

  assert.match(refresh, /publicAlbumMediaStateBatches\(/);
  assert.match(refresh, /await Promise\.all\(/);
  assert.match(refresh, /method:\s*"POST"/);
  assert.match(refresh, /\/album\/public-share\/media-state/);
  assert.match(refresh, /data:\s*\{\s*media_ids:\s*batch\s*\}/);
  assert.match(refresh, /isCurrentPublicAlbumGeneration\(/);
  assert.match(refresh, /type:\s*"MEDIA_PATCH"/);
  assert.equal((refresh.match(/type:\s*"MEDIA_PATCH"/g) || []).length, 1);
  assert.match(refresh, /this\.applyPublicAlbumMediaPatchToWaterfall\(/);

  for (const rows of ["waterfallPhotos", "waterfallList1", "waterfallList2"]) {
    assert.match(patch, new RegExp(`this\\.${rows}\\s*=\\s*patchRows\\(this\\.${rows}\\)`));
  }
  assert.match(patch, /\.filter\(\(row\)\s*=>\s*!unavailable\.has\(Number\(row\.id\)\)\)/);
  assert.match(patch, /byId\.get\(Number\(row\.id\)\) \|\| row/);
  assert.doesNotMatch(patch, /refreshWaterfall|\.clear\s*\(|waterfallPhotos\s*=\s*\[\s*\]/);
});

test("D57 public production source has no prefix reload or scroll compensation", () => {
  for (const forbidden of [
    "reloadLoadedPublicAlbumPrefix",
    "reloadPublicAlbumSharePrefix",
    "publicShareLoadedPageCount",
    "samePublicAlbumMediaSequence",
    "pageScrollTo"
  ]) {
    assert.doesNotMatch(albumSource, new RegExp(forbidden));
  }
});
