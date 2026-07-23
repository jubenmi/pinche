import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const EXPECTED_ARTWORK = new Map([
  ["apps/miniprogram/src/static/art/album-share-friend.jpg", [1000, 800]],
  ["apps/miniprogram/src/static/art/album-share-timeline.jpg", [1000, 1000]]
]);
const paths = Object.freeze({
  apiServer: "apps/api/src/server.js",
  cache: "apps/api/src/modules/album-share-cover/cache.js",
  selection: "apps/api/src/modules/album-share-cover/selection.js",
  renderer: "apps/api/src/modules/album-share-cover/renderer.js",
  service: "apps/api/src/modules/core/service.js",
  dockerfile: "apps/api/Dockerfile",
  routeTest: "apps/api/test/album-share-cover-route.test.mjs",
  albumPage: "apps/miniprogram/src/pages/session/album.vue",
  helper: "apps/miniprogram/src/utils/albumShareCover.js",
  publicShareMigration: "apps/api/migrations/0032_session_album_public_shares.sql"
});
const fallbackNames = Array.from(EXPECTED_ARTWORK.keys()).map((file) => path.basename(file));
const assetOnly = process.argv.includes("--assets-only");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function absolute(relativePath) {
  return path.join(root, relativePath);
}

function readSource(relativePath) {
  const file = absolute(relativePath);
  assert(fs.existsSync(file), `D52 required source is missing: ${relativePath}`);
  return fs.readFileSync(file, "utf8");
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const location = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(location) : [location];
  });
}

function sourceBetween(source, startMarker, endMarker, description) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert(start !== -1 && end !== -1, `D52 ${description} must remain explicit`);
  return source.slice(start, end);
}

function publicCoverRouteSource(serverSource) {
  return sourceBetween(
    serverSource,
    "const publicSessionAlbumShareCoverId = idMatch(",
    "const publicSessionAlbumMediaPhotoId = idMatch(",
    "public album cover route"
  );
}

function publicCoverPathSource(serverSource) {
  return sourceBetween(
    serverSource,
    "function sessionAlbumPublicShareCoverPath(",
    "function verifySessionAlbumPublicCoverQuery(",
    "public album cover URL builder"
  );
}

function publicAlbumDtoSource(serverSource) {
  return sourceBetween(
    serverSource,
    "export function attachPublicSessionAlbumMediaUrls(",
    "async function sessionAlbumThumbnailBuffer(",
    "public album response DTO"
  );
}

function shareTokenRouteSource(serverSource) {
  return sourceBetween(
    serverSource,
    "const sessionAlbumShareTokenId = idMatch(",
    "const sessionAlbumPublicSharesId = idMatch(",
    "album share-token route"
  );
}

async function verifyFallbackArtwork() {
  for (const [relativePath, [width, height]] of EXPECTED_ARTWORK) {
    const file = absolute(relativePath);
    assert(fs.existsSync(file), `D52 fallback artwork is missing: ${relativePath}`);

    const metadata = await sharp(file).metadata();
    assert(metadata.format === "jpeg", `D52 fallback artwork must be JPEG: ${relativePath}`);
    assert(
      metadata.width === width && metadata.height === height,
      `D52 fallback artwork must be ${width}×${height}: ${relativePath} is ${metadata.width}×${metadata.height}`
    );
    await sharp(file, { failOn: "error" }).raw().toBuffer();
  }
}

function verifyNoLegacyGrid() {
  const productionFiles = sourceFiles(absolute("apps/api/src"));
  const legacyFiles = productionFiles.filter((file) => (
    /\.(?:js|mjs|cjs)$/.test(file) && fs.readFileSync(file, "utf8").includes("publicShareCoverGridLayout")
  ));
  assert(
    legacyFiles.length === 0,
    `D52 legacy publicShareCoverGridLayout must not remain in production code: ${legacyFiles.join(", ")}`
  );
}

function verifyApiContract() {
  const server = readSource(paths.apiServer);
  const route = publicCoverRouteSource(server);
  const coverPath = publicCoverPathSource(server);
  const publicAlbumDto = publicAlbumDtoSource(server);
  const shareTokenRoute = shareTokenRouteSource(server);
  const cache = readSource(paths.cache);
  const routeTest = readSource(paths.routeTest);

  for (const required of [
    'const variant = url.searchParams.has("variant")',
    ': "friend";',
    'variant !== "friend" && variant !== "timeline"',
  ]) {
    assert(route.includes(required), `D52 cover route must expose friend and timeline variants: ${required}`);
  }
  for (const required of [
    'function sessionAlbumPublicShareCoverPath(share, variant = "friend")',
    "const query = new URLSearchParams({ token, variant });"
  ]) {
    assert(coverPath.includes(required), `D52 cover URL builder must retain its friend default: ${required}`);
  }
  for (const required of [
    'cover_url: sessionAlbumPublicShareCoverPath({',
    'timeline_cover_url: sessionAlbumPublicShareCoverPath({',
    '}, "friend")',
    '}, "timeline")'
  ]) {
    assert(publicAlbumDto.includes(required), `D52 public album DTO must expose both cover URLs: ${required}`);
  }
  for (const required of [
    'cover_url: sessionAlbumPublicShareCoverPath(share, "friend")',
    'timeline_cover_url: sessionAlbumPublicShareCoverPath(share, "timeline")'
  ]) {
    assert(shareTokenRoute.includes(required), `D52 share-token DTO must expose both cover URLs: ${required}`);
  }
  for (const required of [
    "shareId: coverClaims.shareId",
    "coverDigest: coverClaims.coverMediaIdsDigest",
    "variant,",
    "layoutVersion: ALBUM_SHARE_COVER_LAYOUT_VERSION"
  ]) {
    assert(route.includes(required), `D52 cover cache key must include ${required}`);
  }
  for (const required of [
    "cacheKeyComponent(shareId, \"shareId\")",
    "cacheKeyComponent(coverDigest, \"coverDigest\")",
    "cacheKeyComponent(variant, \"variant\")",
    "cacheKeyComponent(layoutVersion, \"layoutVersion\")"
  ]) {
    assert(cache.includes(required), `D52 cache key implementation is missing ${required}`);
  }
  const verifyQuery = route.indexOf("publicShareCover.verifyQuery(");
  const loadAuthorizedMedia = route.indexOf("await publicShareCover.load(");
  const firstCacheRead = route.search(/publicShareCover\.cache\.get\s*\(/);
  assert(verifyQuery !== -1, "D52 cover route must verify its signed query before cache access");
  assert(loadAuthorizedMedia !== -1, "D52 cover route must reload authorization before cache access");
  assert(firstCacheRead !== -1, "D52 cover route must read its cover cache");
  assert(
    firstCacheRead > verifyQuery && firstCacheRead > loadAuthorizedMedia,
    "D52 first cover cache read must occur after signed-query verification and authorization reload"
  );
  for (const dynamicGuarantee of [
    "a cache hit repeats verification and authorization but skips reads, analysis, and render",
    "a revoked second authorization returns 403 without leaking cached bytes",
    "friend and timeline use separate cache entries"
  ]) {
    assert(
      routeTest.includes(dynamicGuarantee),
      `D52 route test must dynamically guard cache authorization: ${dynamicGuarantee}`
    );
  }
}

function verifyRendererContract() {
  const renderer = readSource(paths.renderer);
  const dockerfile = readSource(paths.dockerfile);
  assert(
    renderer.includes('"Noto Sans CJK SC", "PingFang SC", sans-serif'),
    "D52 renderer must explicitly prefer Noto Sans CJK SC"
  );
  assert(
    dockerfile.includes("apk add --no-cache font-noto-cjk"),
    "D52 API Docker image must install font-noto-cjk"
  );
}

function verifyMiniProgramContract() {
  const albumPage = readSource(paths.albumPage);
  const helperPath = absolute(paths.helper);
  assert(fs.existsSync(helperPath), `D52 album share helper is missing: ${paths.helper}`);
  const helper = fs.readFileSync(helperPath, "utf8");
  for (const fallbackName of fallbackNames) {
    assert(helper.includes(fallbackName), `D52 album share helper must reference ${fallbackName}`);
  }
  assert(
    !helper.includes("ticket-landscape.jpg"),
    "D52 album share helper must not use the single-media ticket fallback"
  );
  assert(
    /onShareAppMessage\([^)]*\)\s*\{[\s\S]{0,1800}?this\.albumFriendShareImage\(\)/.test(albumPage),
    "D52 onShareAppMessage must use the friend share-cover getter"
  );
  assert(
    /onShareTimeline\([^)]*\)\s*\{[\s\S]{0,700}?this\.albumTimelineShareImage\(\)/.test(albumPage),
    "D52 onShareTimeline must use the timeline share-cover getter"
  );
  for (const required of [
    "albumFriendShareImage()",
    "albumTimelineShareImage()",
    "shareFriendCoverUrl",
    "shareTimelineCoverUrl",
    "shareFriendCoverPrepared",
    "shareTimelineCoverPrepared"
  ]) {
    assert(albumPage.includes(required), `D52 mini-program must retain per-channel cover state: ${required}`);
  }
}

function verifySnapshotBoundary() {
  const service = readSource(paths.service);
  const selection = readSource(paths.selection);
  const migration = readSource(paths.publicShareMigration);
  assert(
    service.includes("export const PUBLIC_SHARE_COVER_CANDIDATE_LIMIT = 30;"),
    "D52/D54 cover analysis must retain the explicit 30-item safety bound"
  );
  assert(
    /coverMediaIds:\s*normalizePublicShareSnapshotIds\(coverMediaIds,\s*\{[\s\S]{0,140}?max:\s*PUBLIC_SHARE_COVER_CANDIDATE_LIMIT/.test(service),
    "D52/D54 cover candidate snapshots must use the bounded analysis limit"
  );
  assert(
    /label:\s*"cover_media_ids",[\s\S]{0,140}?max:\s*PUBLIC_SHARE_COVER_CANDIDATE_LIMIT/.test(service),
    "D52/D54 persisted cover candidates must use the bounded analysis limit"
  );
  assert(
    selection.includes("export const ALBUM_SHARE_MAX_IMAGES = 9;"),
    "D52 final cover composition must remain capped at nine images"
  );
  const selectionFunction = sourceBetween(
    selection,
    "export function selectAlbumShareImages(candidates)",
    "export function cropLoss",
    "cover selection"
  );
  assert(
    !selectionFunction.includes(".slice(0, ALBUM_SHARE_MAX_IMAGES)\n    .map(({ image }) => image)"),
    "D52/D54 must not truncate cover candidates before quality and duplicate analysis"
  );
  assert(
    /return deduped[\s\S]{0,260}?\.slice\(0, ALBUM_SHARE_MAX_IMAGES\)/.test(selectionFunction),
    "D52/D54 must cap the final rendered cover after analysis"
  );
  assert(
    migration.includes("cover_media_ids JSON NOT NULL"),
    "D52 must continue using the existing public-share snapshot column"
  );
  const coverSchemaMigrations = fs.readdirSync(absolute("apps/api/migrations"))
    .filter((name) => /album.*share.*cover/i.test(name));
  assert(
    coverSchemaMigrations.length === 0,
    `D52 must not introduce a separate album-share-cover migration: ${coverSchemaMigrations.join(", ")}`
  );
}

function verifyPackageScripts() {
  const packageJson = JSON.parse(readSource("package.json"));
  const expectedUnit = [
    "node --test",
    "apps/api/test/album-share-cover-layouts.test.mjs",
    "apps/api/test/album-share-cover-selection.test.mjs",
    "apps/api/test/album-share-cover-renderer.test.mjs",
    "apps/api/test/album-share-cover-route.test.mjs",
    "apps/miniprogram/test/albumShareCover.test.mjs"
  ];
  const unit = packageJson?.scripts?.["d52:unit"];
  assert(typeof unit === "string", "D52 package script d52:unit is required");
  for (const required of expectedUnit) {
    assert(unit.includes(required), `D52 package script d52:unit is missing ${required}`);
  }
  assert(
    packageJson?.scripts?.["d52:check"] === "node scripts/d52-adaptive-album-share-cover-check.js",
    "D52 package script d52:check must run the strict static contract"
  );
  assert(
    packageJson?.scripts?.["d52:assets:check"] ===
      "node scripts/d52-adaptive-album-share-cover-check.js --assets-only",
    "D52 package script d52:assets:check must identify itself as asset-only"
  );
  assert(
    packageJson?.scripts?.check?.includes("npm run d52:check"),
    "D52 root npm check must invoke the strict static contract"
  );
}

await verifyFallbackArtwork();
if (assetOnly) {
  console.log("D52 fallback artwork checks passed");
  process.exit(0);
}
verifyNoLegacyGrid();
verifyApiContract();
verifyRendererContract();
verifyMiniProgramContract();
verifySnapshotBoundary();
verifyPackageScripts();
console.log("D52 adaptive album share cover checks passed");
