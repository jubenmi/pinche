import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const paths = Object.freeze({
  service: "apps/api/src/modules/core/service.js",
  server: "apps/api/src/legacy-app.js",
  albumPage: "apps/miniprogram/src/pages/session/album.vue",
  paginationHelper: "apps/miniprogram/src/utils/albumPublicSharePagination.js",
  apiTest: "apps/api/test/album-public-share-pagination.test.mjs",
  miniTest: "apps/miniprogram/test/albumPublicSharePagination.test.mjs",
  packageJson: "package.json"
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(relativePath) {
  const file = path.join(root, relativePath);
  assert(fs.existsSync(file), `D54 required source is missing: ${relativePath}`);
  return fs.readFileSync(file, "utf8");
}

function between(source, start, end, name) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert(startIndex !== -1 && endIndex !== -1, `D54 ${name} must remain explicit`);
  return source.slice(startIndex, endIndex);
}

const service = read(paths.service);
const server = read(paths.server);
const albumPage = read(paths.albumPage);
const helper = read(paths.paginationHelper);
const apiTest = read(paths.apiTest);
const miniTest = read(paths.miniTest);
const packageJson = JSON.parse(read(paths.packageJson));

assert(
  service.includes("export const PUBLIC_SHARE_PAGE_SIZE = 30;"),
  "D54 public album pages must remain bounded to 30 items"
);
const publicShareRoute = between(
  server,
  "const publicSessionAlbumShareId = idMatch(",
  "const albumUploadStatusId = stringMatch(",
  "public share route"
);
assert(
  publicShareRoute.includes('cursor: url.searchParams.get("cursor")')
    && publicShareRoute.includes('limit: url.searchParams.get("limit")'),
  "D54 public-share route must forward continuation parameters"
);
for (const required of [
  "publicAlbumSharePageUrl",
  "mergePublicAlbumSharePages",
  "onReachBottom()",
  "loadMorePublicAlbum()",
  "publicShareNextCursor",
  "publicShareHasMore",
  "publicShareLoadingMore",
  "继续加载失败，可重试"
]) {
  assert(albumPage.includes(required), `D54 mini-program pagination is missing ${required}`);
}
assert(
  helper.includes("export function publicAlbumSharePageUrl")
    && helper.includes("export function mergePublicAlbumSharePages"),
  "D54 pagination helper must remain independently testable"
);
const loadMorePublicAlbum = between(
  albumPage,
  "async loadMorePublicAlbum() {",
  "retryAlbumLoad() {",
  "public pagination append path"
);
const appendPublicAlbumWaterfallPhotos = between(
  albumPage,
  "appendPublicAlbumWaterfallPhotos(photos = []) {",
  "refreshWaterfall() {",
  "public waterfall append helper"
);
assert(
  helper.includes("appendedPhotos")
    && /this\.appendPublicAlbumWaterfallPhotos\s*\(\s*merged\.appendedPhotos\s*\)/s.test(
      loadMorePublicAlbum
    ),
  "D54 continuation loading must append only newly merged media"
);
assert(
  /this\.waterfallPhotos\s*=\s*\[\s*\.\.\.this\.waterfallPhotos\s*,\s*\.\.\.appended\s*\]/s.test(
    appendPublicAlbumWaterfallPhotos
  ),
  "D54 public waterfall append helper must grow the existing model tail"
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
    assert(
      !pattern.test(block),
      `D54 ${blockName} must not use destructive scroll recovery: ${operationName}`
    );
  }
}
assert(
  apiTest.includes("100") && apiTest.includes("next_cursor") && apiTest.includes("Invalid album share cursor"),
  "D54 API pagination tests must keep long-snapshot and cursor coverage"
);
assert(
  miniTest.includes("appends unique media") && miniTest.includes("guarded public-share continuation loading"),
  "D54 mini-program tests must retain merge and page-state coverage"
);
assert(
  typeof packageJson.scripts?.["d54:unit"] === "string"
    && typeof packageJson.scripts?.["d54:check"] === "string",
  "D54 package scripts are required"
);
assert(
  packageJson.scripts.postcheck.startsWith(
    "npm run d54:unit && npm run d54:check && npm run d55:unit && npm run d55:check && npm run d56:unit && npm run d56:check"
  ),
  "D54 checks must run before D55 and D56 checks in the root check lifecycle"
);

console.log("D54 public album full-share pagination checks passed");
