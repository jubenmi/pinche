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
  renderer: "apps/api/src/modules/album-share-cover/renderer.js",
  service: "apps/api/src/modules/core/service.js",
  dockerfile: "apps/api/Dockerfile",
  routeTest: "apps/api/test/album-share-cover-route.test.mjs",
  albumPage: "apps/miniprogram/src/pages/session/album.vue",
  helper: "apps/miniprogram/src/utils/albumShareCover.js",
  publicShareMigration: "apps/api/migrations/0032_session_album_public_shares.sql"
});
const fallbackNames = Array.from(EXPECTED_ARTWORK.keys()).map((file) => path.basename(file));
const allowMissingTask7Helper = process.argv.includes("--allow-missing-task7-helper");

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

function requireInOrder(source, values, message) {
  let previous = -1;
  for (const value of values) {
    const index = source.indexOf(value, previous + 1);
    assert(index !== -1, `${message}: missing ${value}`);
    assert(index > previous, `${message}: ${value} is out of order`);
    previous = index;
  }
}

function publicCoverRouteSource(serverSource) {
  const start = serverSource.indexOf("const publicSessionAlbumShareCoverId = idMatch(");
  const end = serverSource.indexOf("const publicSessionAlbumMediaPhotoId = idMatch(", start);
  assert(start !== -1 && end !== -1, "D52 public album cover route must remain explicit");
  return serverSource.slice(start, end);
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
  const cache = readSource(paths.cache);
  const routeTest = readSource(paths.routeTest);

  for (const required of [
    'variant !== "friend" && variant !== "timeline"',
    'cover_url: sessionAlbumPublicShareCoverPath(share, "friend")',
    'timeline_cover_url: sessionAlbumPublicShareCoverPath(share, "timeline")',
    'cover_url: sessionAlbumPublicShareCoverPath({',
    '}, "friend")',
    '}, "timeline")'
  ]) {
    assert(server.includes(required), `D52 API must expose friend and timeline cover URLs: ${required}`);
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
  requireInOrder(
    route,
    [
      "publicShareCover.verifyQuery(",
      "await publicShareCover.load(",
      "publicShareCover.cache.get(cacheKey)"
    ],
    "D52 must verify and reload authorization before serving a cached cover"
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
  if (!fs.existsSync(helperPath)) {
    if (allowMissingTask7Helper) return;
    throw new Error(`D52 album share helper is missing: ${paths.helper}`);
  }
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
  const migration = readSource(paths.publicShareMigration);
  assert(
    /coverMediaIds:\s*normalizePublicShareSnapshotIds\(coverMediaIds,\s*\{[\s\S]{0,100}?max:\s*9/.test(service),
    "D52 cover_media_ids must remain constrained to at most nine IDs when hashing a snapshot"
  );
  assert(
    /label:\s*"cover_media_ids",[\s\S]{0,100}?max:\s*9/.test(service),
    "D52 persisted cover_media_ids must remain constrained to at most nine IDs"
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
}

await verifyFallbackArtwork();
verifyNoLegacyGrid();
verifyApiContract();
verifyRendererContract();
verifyMiniProgramContract();
verifySnapshotBoundary();
verifyPackageScripts();
console.log("D52 adaptive album share cover checks passed");
