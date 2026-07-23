import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const paths = Object.freeze({
  service: "apps/api/src/modules/core/service.js",
  server: "apps/api/src/server.js",
  selection: "apps/api/src/modules/album-share-cover/selection.js",
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
const selection = read(paths.selection);
const albumPage = read(paths.albumPage);
const helper = read(paths.paginationHelper);
const apiTest = read(paths.apiTest);
const miniTest = read(paths.miniTest);
const packageJson = JSON.parse(read(paths.packageJson));

assert(
  service.includes("export const PUBLIC_SHARE_PAGE_SIZE = 30;"),
  "D54 public album pages must remain bounded to 30 items"
);
assert(
  service.includes("export const PUBLIC_SHARE_COVER_CANDIDATE_LIMIT = 30;"),
  "D54 must keep a bounded 30-item visual-analysis candidate pool"
);
assert(
  /return candidates\s*\.slice\(0, PUBLIC_SHARE_COVER_CANDIDATE_LIMIT\)/.test(service),
  "D54 must snapshot the bounded visual candidate pool after safety ranking"
);
assert(
  /coverMediaIds:\s*normalizePublicShareSnapshotIds\(coverMediaIds,[\s\S]{0,160}?max:\s*PUBLIC_SHARE_COVER_CANDIDATE_LIMIT/.test(service),
  "D54 snapshot digests must bind the full visual candidate pool"
);
assert(
  /label:\s*"cover_media_ids",[\s\S]{0,160}?max:\s*PUBLIC_SHARE_COVER_CANDIDATE_LIMIT/.test(service),
  "D54 persisted cover candidates must retain their safety bound"
);
assert(
  selection.includes("export const ALBUM_SHARE_MAX_IMAGES = 9;"),
  "D54 must keep the final cover output at nine images"
);
const selectionFunction = between(
  selection,
  "export function selectAlbumShareImages(candidates)",
  "export function cropLoss",
  "cover selection"
);
assert(
  !selectionFunction.includes(".slice(0, ALBUM_SHARE_MAX_IMAGES)\n    .map(({ image }) => image)"),
  "D54 must not truncate visual candidates before quality and duplicate analysis"
);
assert(
  /return deduped[\s\S]{0,260}?\.slice\(0, ALBUM_SHARE_MAX_IMAGES\)/.test(selectionFunction),
  "D54 must apply the nine-image cap only after visual analysis"
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
  packageJson.scripts.postcheck === "npm run d54:unit && npm run d54:check",
  "D54 checks must run after the root check lifecycle"
);

console.log("D54 public album full-share pagination checks passed");
