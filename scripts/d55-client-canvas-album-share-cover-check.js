import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`D55 required source is missing: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function between(source, startToken, endToken, label) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  check(start >= 0 && end > start, `D55 source block is missing: ${label}`);
  return start >= 0 && end > start ? source.slice(start, end) : "";
}

function walk(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  const entries = fs.readdirSync(absolutePath, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const child = path.join(relativePath, entry.name);
    return entry.isDirectory() ? walk(child) : [child.replaceAll(path.sep, "/")];
  });
}

function numericConstant(source, name) {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*(\\d+)\\s*;`));
  return match ? Number(match[1]) : null;
}

function includesAll(source, tokens, label) {
  for (const token of tokens) {
    check(source.includes(token), `D55 ${label} is missing: ${token}`);
  }
}

const paths = Object.freeze({
  service: "apps/api/src/modules/core/service.js",
  server: "apps/api/src/server.js",
  apiPackage: "apps/api/package.json",
  apiDockerfile: "apps/api/Dockerfile",
  canvas: "apps/miniprogram/src/utils/albumShareCanvas.js",
  cover: "apps/miniprogram/src/utils/albumShareCover.js",
  albumPage: "apps/miniprogram/src/pages/session/album.vue",
  apiRecipeTest: "apps/api/test/album-public-share-cover-recipe.test.mjs",
  miniCanvasTest: "apps/miniprogram/test/albumShareCanvas.test.mjs",
  miniCoverTest: "apps/miniprogram/test/albumShareCover.test.mjs",
  miniPreviewTest: "apps/miniprogram/test/albumSharePreview.test.mjs",
  miniprogramCheck: "scripts/check-miniprogram.js",
  d23Check: "scripts/d23-album-share-join-policy-check.js",
  d48Check: "scripts/d48-album-sharing-role-claim-separation-check.js",
  d48Smoke: "scripts/d48-album-sharing-role-claim-separation-smoke.js",
  d54Check: "scripts/d54-public-album-full-share-pagination-check.js",
  packageJson: "package.json"
});

const service = read(paths.service);
const server = read(paths.server);
const apiPackage = JSON.parse(read(paths.apiPackage));
const apiDockerfile = read(paths.apiDockerfile);
const canvas = read(paths.canvas);
const cover = read(paths.cover);
const albumPage = read(paths.albumPage);
const apiRecipeTest = read(paths.apiRecipeTest);
const miniCanvasTest = read(paths.miniCanvasTest);
const miniCoverTest = read(paths.miniCoverTest);
const miniPreviewTest = read(paths.miniPreviewTest);
const miniprogramCheck = read(paths.miniprogramCheck);
const d23Check = read(paths.d23Check);
const d48Check = read(paths.d48Check);
const d48Smoke = read(paths.d48Smoke);
const d54Check = read(paths.d54Check);
const packageJson = JSON.parse(read(paths.packageJson));

const d54UnitTests = [
  "apps/api/test/album-public-share-pagination.test.mjs",
  "apps/api/test/album-single-media-share.test.mjs",
  "apps/miniprogram/test/albumPublicSharePagination.test.mjs",
  "apps/miniprogram/test/albumSharePreview.test.mjs"
];
const d55UnitTests = [
  "apps/api/test/album-public-share-cover-recipe.test.mjs",
  "apps/miniprogram/test/albumShareCanvas.test.mjs",
  "apps/miniprogram/test/albumShareCover.test.mjs"
];
const d54Unit = packageJson.scripts?.["d54:unit"] || "";
const d55Unit = packageJson.scripts?.["d55:unit"] || "";
const d55Check = packageJson.scripts?.["d55:check"] || "";
const unitTestFiles = (script) => script.match(/\S+\.test\.mjs/g) || [];
const d54UnitFiles = unitTestFiles(d54Unit);
const d55UnitFiles = unitTestFiles(d55Unit);
check(
  JSON.stringify(d54UnitFiles) === JSON.stringify(d54UnitTests),
  `D54 unit gate must own exactly its four regression suites: ${d54UnitTests.join(", ")}`
);
check(d55Unit.startsWith("node --test "), "D55 package wiring must define d55:unit");
check(
  JSON.stringify(d55UnitFiles) === JSON.stringify(d55UnitTests),
  `D55 unit gate must own exactly its three unique suites: ${d55UnitTests.join(", ")}`
);
const duplicatedUnitFiles = d55UnitFiles.filter((file) => d54UnitFiles.includes(file));
check(
  duplicatedUnitFiles.length === 0,
  `D54 and D55 unit gates must not duplicate suites: ${duplicatedUnitFiles.join(", ")}`
);
check(
  d55Check === "node scripts/d55-client-canvas-album-share-cover-check.js",
  "D55 package wiring must define the focused d55:check command"
);
check(
  packageJson.scripts?.postcheck ===
    "npm run d54:unit && npm run d54:check && npm run d55:unit && npm run d55:check",
  "Root postcheck must run valid D54 gates followed by D55 unit and static gates"
);

const rootCheck = packageJson.scripts?.check || "";
const miniprogramBuildCommand = "npm run build:mp-weixin";
const miniprogramSizeCheckCommand = "node scripts/check-miniprogram.js";
check(
  rootCheck.startsWith(`${miniprogramBuildCommand} && `),
  "Root check must begin with a fresh production mini-program build after precheck"
);
check(
  rootCheck.indexOf(miniprogramBuildCommand) <
    rootCheck.indexOf(miniprogramSizeCheckCommand),
  "Root check must build the mini-program before invoking its package-size checker"
);
const missingBuildGuard = between(
  miniprogramCheck,
  "if (!fs.existsSync(miniprogramBuildRoot)) {",
  "}",
  "missing production mini-program build guard"
);
includesAll(
  missingBuildGuard,
  ["throw new Error(", "Built mini-program output is missing", "npm run build:mp-weixin"],
  "missing production mini-program build failure"
);
check(
  miniprogramCheck.includes(
    "const mainPackageLimitBytes = Math.floor(1.5 * 1024 * 1024);"
  ),
  "The clean-build main-package gate must retain the 1.5 MiB threshold"
);
check(
  miniprogramCheck.includes(
    "const mainPackageSize = builtMainPackageSize(miniprogramBuildRoot);"
  ) &&
    miniprogramCheck.includes("if (mainPackageSize > mainPackageLimitBytes)") &&
    !/if\s*\(\s*fs\.existsSync\(miniprogramBuildRoot\)\s*\)\s*\{[\s\S]{0,160}const mainPackageSize/
      .test(miniprogramCheck),
  "The 1.5 MiB production package-size gate must run unconditionally after the missing-build guard"
);

check(
  numericConstant(service, "PUBLIC_SHARE_COVER_CANDIDATE_LIMIT") === 3,
  "New public-share cover selection must be capped at three images"
);
check(
  numericConstant(service, "PUBLIC_SHARE_LEGACY_COVER_CANDIDATE_LIMIT") === 30,
  "Legacy public-share cover snapshots must continue accepting up to 30 candidates"
);
const coverSelection = between(
  service,
  "export function selectPublicShareCoverMedia(",
  "function publicShareCoverRecipeFocus(",
  "public-share cover selection"
);
check(
  /\.slice\(\s*0\s*,\s*PUBLIC_SHARE_COVER_CANDIDATE_LIMIT\s*\)/.test(coverSelection),
  "Safe cover selection must apply the three-image limit after ranking"
);
const snapshotDigest = between(
  service,
  "export function publicShareSnapshotDigest(",
  "function normalizeSessionAlbumPublicShareRow(",
  "public-share snapshot digest"
);
const snapshotRow = between(
  service,
  "function normalizeSessionAlbumPublicShareRow(",
  "function implicitUntaggedByMediaIdForShare(",
  "public-share snapshot row normalization"
);
for (const [source, label] of [
  [snapshotDigest, "snapshot digest"],
  [snapshotRow, "persisted snapshot parsing"]
]) {
  check(
    source.includes("PUBLIC_SHARE_LEGACY_COVER_CANDIDATE_LIMIT"),
    `D55 ${label} must retain the legacy 30-candidate bound`
  );
}
const coverRecipeMedia = between(
  service,
  "function publicShareCoverRecipeMedia(",
  "export function normalizePublicShareSnapshotIds(",
  "safe cover recipe media projection"
);
includesAll(
  coverRecipeMedia,
  ["id:", "image_width:", "image_height:", "focus_x:", "focus_y:"],
  "safe cover recipe projection"
);
check(
  !/(object_key|source_url|display_url|preview_url|uploader|tags?\\s*:)/i.test(coverRecipeMedia),
  "Cover recipe service projection must not expose storage, uploader, or tag details"
);
const coverRead = between(
  service,
  "const readCoverMedia = async () => {",
  "let photos;",
  "privacy-safe cover recipe read"
);
includesAll(
  coverRead,
  [
    "status = 'active'",
    "moderation_status IN ('approved', 'approved_legacy')",
    "albumTagsForPhotos",
    "albumPrivacyMap",
    "publicShareCoverPriority",
    "publicShareCoverRecipeMedia",
    "PUBLIC_SHARE_COVER_CANDIDATE_LIMIT"
  ],
  "privacy-safe cover recipe read"
);
const createShare = between(
  service,
  "export async function createOrReuseSessionAlbumPublicShare(",
  "export async function listSessionAlbum(",
  "member share-token creation"
);
includesAll(
  createShare,
  [
    "selectedMediaById",
    "for (const mediaId of share.cover_media_ids)",
    "publicShareCoverPriority",
    "publicShareCoverRecipeMedia",
    "PUBLIC_SHARE_COVER_CANDIDATE_LIMIT",
    "cover_media: coverMedia"
  ],
  "privacy-safe persisted cover projection for share-token creation"
);
check(
  !/(getObject|readUploadedSessionAlbumPhotoObject|sharp\s*\()/.test(createShare),
  "Share-token cover projection must not read or analyze image objects"
);

const apiSourceFiles = walk("apps/api/src");
const retiredServerCoverDirectoryFiles = apiSourceFiles.filter((file) =>
  /(?:^|\/)album-share-cover\//i.test(file)
);
check(
  retiredServerCoverDirectoryFiles.length === 0,
  `Deleted server album-share-cover directory still contains files: ${retiredServerCoverDirectoryFiles.join(", ")}`
);
const obsoleteServerTestFiles = walk("apps/api/test").filter((file) =>
  /apps\/api\/test\/album-share-cover-(?:layouts?|renderer|route|selection).*\.test\.mjs$/i.test(file)
);
check(
  obsoleteServerTestFiles.length === 0,
  `Obsolete server composite-cover tests remain: ${obsoleteServerTestFiles.join(", ")}`
);

const apiProductionSources = apiSourceFiles
  .filter((file) => /\.(?:[cm]?[jt]s|[jt]sx|vue)$/i.test(file))
  .map((file) => ({ file, source: read(file) }));
const retiredServerCoverIdentifierPattern =
  /\b(?:renderAlbumShareCover|renderPublicSessionAlbumShareCover|signSessionAlbumPublicCoverToken|signSessionAlbumPublicShareCover|verifySessionAlbumPublicCoverQuery|verifySessionAlbumPublicShareCover|getPublicSessionAlbumShareCoverMedia|readUploadedSessionAlbumPhotoObject|publicShareCoverMediaIdsDigest|analyzeAlbumShareCoverCandidate|analyzeAlbumShareCoverMedia|albumShareCoverDHash|albumShareCoverFocus|albumShareCoverCacheKey|albumShareCoverLayout|albumShareCoverClamp01|albumShareCoverLuminance|albumShareCoverOrientedDimensions|albumShareCover(?:Cache|Layout)Version|permanentMissingAlbumShareCoverSource|transientAlbumShareCoverSourceError|AlbumShareCoverCache|AlbumShareCoverGenerationCoordinator|PermanentAlbumShareCoverCandidateError|publicShareCoverDependencies|publicShareCoverCoordinator|sessionAlbumPublicShareCoverPath|publicSessionAlbumShareCoverId|testOnlyAllowPublicShareCoverAuthorizationOverrides|ALBUM_SHARE_COVER_(?:CACHE|LAYOUT)_[A-Z0-9_]+|ALBUM_SHARE_COVER_NETWORK_ERROR_CODES|ALBUM_SHARE_COVER_UNAVAILABLE|SESSION_ALBUM_PUBLIC_COVER_TOKEN_SECONDS)\b/g;
const retiredServerCoverIdentifierMatches = apiProductionSources.flatMap(({ file, source }) =>
  [...new Set(source.match(retiredServerCoverIdentifierPattern) || [])]
    .map((identifier) => `${file}:${identifier}`)
);
check(
  retiredServerCoverIdentifierMatches.length === 0,
  `Retired server album-share-cover identifiers remain: ${retiredServerCoverIdentifierMatches.join(", ")}`
);

const retiredServerCoverContractPatterns = [
  ["plural public /cover route", /\/(?:api\/)?session-album\/public-shares\/[^\n]{0,160}\/cover(?:\b|[?'"`/$])/],
  ["public cover capability", /session-album-public(?:-share)?-cover/],
  ["public cover usage claim", /usage\s*:\s*["']cover["']/],
  ["server cover layout version", /album-share-cover-v\d+\b/],
  ["server cover module import", /from\s+["'][^"']*album-share-cover\//]
];
const retiredServerCoverContractMatches = apiProductionSources.flatMap(({ file, source }) => {
  const normalizedSource = source.replaceAll("\\/", "/");
  return retiredServerCoverContractPatterns
    .filter(([, pattern]) => pattern.test(normalizedSource))
    .map(([label]) => `${file}:${label}`);
});
check(
  retiredServerCoverContractMatches.length === 0,
  `Retired server album-share-cover routes, capabilities, or versions remain: ${retiredServerCoverContractMatches.join(", ")}`
);

const contextualCoverReadMatches = apiProductionSources
  .filter(({ source }) => {
    let index = source.indexOf("readUploadedSessionAlbumPhotoObject");
    while (index >= 0) {
      const nearbySource = source
        .slice(Math.max(0, index - 800), index + 800)
        .replaceAll("\\/", "/");
      if (
        /(?:album-share-cover|album share cover|session-album-public-cover|publicShareCoverDependencies|AlbumShareCover|SessionAlbumPublicCover|public-shares\/[^\n]{0,160}\/cover)/i
          .test(nearbySource)
      ) {
        return true;
      }
      index = source.indexOf("readUploadedSessionAlbumPhotoObject", index + 1);
    }
    return false;
  })
  .map(({ file }) => file);
check(
  contextualCoverReadMatches.length === 0,
  `Uploaded album photo object reads must not be wired into server cover composition: ${contextualCoverReadMatches.join(", ")}`
);

const attachPublicMedia = between(
  server,
  "export function attachPublicSessionAlbumMediaUrls(",
  "async function sessionAlbumThumbnailBuffer(",
  "public album URL projection"
);
const coverRecipeSerializer = between(
  server,
  "export function sessionAlbumPublicCoverRecipe(",
  "export function sessionAlbumShareTokenResponse(",
  "shared public cover recipe serializer"
);
includesAll(
  coverRecipeSerializer,
  [
    'version: "client-canvas-v1"',
    "images",
    "thumbnail_url:",
    "sessionAlbumPublicMediaPath(",
    '"thumbnail"',
    "width:",
    "height:",
    "focus_x:",
    "focus_y:",
    "if (images.length === 3) break"
  ],
  "shared versioned cover recipe serializer"
);
const shareTokenResponse = between(
  server,
  "export function sessionAlbumShareTokenResponse(",
  "export function attachPublicSessionAlbumMediaUrls(",
  "share-token response serializer"
);
includesAll(
  shareTokenResponse,
  [
    "cover_recipe: sessionAlbumPublicCoverRecipe(",
    "share.cover_media",
    "albumShareToken",
    "token: albumShareToken"
  ],
  "share-token recipe response"
);
check(
  !/\b(?:cover_media|cover_media_ids|cover_url|timeline_cover_url|photo_url|storage_object_key|uploader_user_id|tags)\s*:/
    .test(shareTokenResponse),
  "Share-token DTO serializer must not expose cover candidates, old URLs, or storage internals"
);
const publicRecipeResult = between(
  attachPublicMedia,
  "const result = {",
  "return assertPublicResponseSafe(",
  "public cover recipe DTO"
);
includesAll(
  publicRecipeResult,
  [
    "cover_recipe:",
    "sessionAlbumPublicCoverRecipe(coverMedia, claims, albumShareToken)"
  ],
  "public DTO shared cover recipe wiring"
);
check(
  !/\b(?:cover_url|timeline_cover_url)\s*:/.test(publicRecipeResult),
  "Public album top-level DTO must not expose old server-composite cover URLs"
);
const shareTokenRoute = between(
  server,
  "const sessionAlbumShareTokenId = idMatch(",
  "const sessionAlbumPublicSharesId = idMatch(",
  "public album share-token DTO"
);
check(
  !/\b(?:cover_url|timeline_cover_url)\s*:/.test(shareTokenRoute),
  "Public share-token DTO must not expose old server-composite cover URLs"
);
includesAll(
  shareTokenRoute,
  [
    "const albumShareToken = signSessionAlbumShareToken(claims)",
    "data: sessionAlbumShareTokenResponse(share, claims, albumShareToken)"
  ],
  "public share-token DTO recipe serialization"
);
includesAll(
  apiRecipeTest,
  [
    "legacyCoverMediaIds",
    "share-token response returns the same minimal signed Canvas recipe contract",
    'version, "client-canvas-v1"',
    'url.searchParams.get("variant"), "thumbnail"',
    '"cover_media_ids"',
    '"storage_object_key"',
    '"cover_url"',
    '"timeline_cover_url"'
  ],
  "API cover recipe regression tests"
);

check(
  numericConstant(canvas, "MAX_COVER_IMAGES") === 3,
  "Client Canvas normalization must be capped at three images"
);
const normalizeRecipe = between(
  canvas,
  "export function normalizeAlbumShareCoverRecipe(",
  "export function albumShareCanvasLayout(",
  "client recipe normalization"
);
includesAll(
  normalizeRecipe,
  ["ALBUM_SHARE_CANVAS_RECIPE_VERSION", "normalizedImages", "images.length === 0"],
  "client recipe normalization"
);
const canvasLayout = between(
  canvas,
  "export function albumShareCanvasLayout(",
  "export function albumShareCanvasPlan(",
  "client Canvas layouts"
);
includesAll(
  canvasLayout,
  ["MAX_COVER_IMAGES", 'kind === "friend"', "normalizedCount === 1", "normalizedCount === 2", "normalizedCount === 3"],
  "one/two/three-image Canvas layouts"
);
const canvasSource = between(
  canvas,
  "export function resolveAlbumShareCanvasSource(",
  "export async function renderAlbumShareCanvasCover(",
  "client Canvas source resolution"
);
includesAll(
  canvasSource,
  ["localPreviewFor", "if (localPreview) return localPreview", "thumbnail_url", "thumbnailUrlResolver"],
  "local-preview-first Canvas source resolution"
);
check(
  canvasSource.indexOf("if (localPreview) return localPreview") <
    canvasSource.indexOf("thumbnail_url"),
  "Canvas source resolution must prefer local preview before remote thumbnail"
);
const canvasRender = between(
  canvas,
  "export async function renderAlbumShareCanvasCover(",
  "export function albumShareCanvasRecipeDigest(",
  "client Canvas renderer"
);
includesAll(
  canvasRender,
  [
    "albumShareCanvasPlan",
    "resolveAlbumShareCanvasSource",
    "loadImage",
    "drawImage",
    "exportCanvas",
    'fileType: "jpg"',
    "localTemporaryPath"
  ],
  "client Canvas renderer"
);
const canvasPreparationStart = canvas.indexOf(
  "export function createAlbumShareCanvasPreparation("
);
check(canvasPreparationStart >= 0, "D55 source block is missing: client Canvas preparation cache");
const canvasPreparation = canvasPreparationStart >= 0
  ? canvas.slice(canvasPreparationStart)
  : "";
includesAll(
  canvasPreparation,
  [
    "cachedPaths",
    "inFlight",
    "beginRequest",
    "invalidate",
    "clear",
    "dispose: clear",
    "cacheKey",
    "stale_request"
  ],
  "client Canvas cache and stale-request lifecycle"
);
includesAll(
  miniCanvasTest,
  [
    "九图配方只加载并绘制前面三个本地预览",
    "本地相册预览优先于远程缩略图",
    "缓存键区分分享、配方摘要和分享渠道",
    "clear 与 dispose 使在途封面过期"
  ],
  "Canvas behavioral regression tests"
);

includesAll(
  cover,
  [
    "ALBUM_SHARE_FRIEND_FALLBACK",
    "ALBUM_SHARE_TIMELINE_FALLBACK",
    "albumShareLocalImagePath",
    '["friend", "timeline"]',
    "albumShareFriendPayload",
    "albumShareTimelinePayload"
  ],
  "channel-local share-cover helper"
);
const localPreviewHandoff = between(
  cover,
  "export const ALBUM_SHARE_LOCAL_PREVIEW_HANDOFF_TTL_MS",
  "export function albumShareCoverRecipe(",
  "bounded local preview handoff"
);
includesAll(
  localPreviewHandoff,
  [
    "2 * 60 * 1000",
    "ALBUM_SHARE_LOCAL_PREVIEW_HANDOFF_LIMIT = 4",
    "albumShareCanvasRecipeDigest",
    "normalizeAlbumShareCoverRecipe",
    "albumShareLocalImagePath",
    "expiresAt",
    "pruneAlbumShareLocalPreviewHandoffs",
    "rememberAlbumShareLocalPreviewHandoff",
    "takeAlbumShareLocalPreviewHandoff",
    "forgetAlbumShareLocalPreviewHandoff",
    "albumShareLocalPreviewHandoffs.delete(identity)"
  ],
  "bounded TTL local preview handoff"
);
check(
  !/(?:localStorage|sessionStorage|setStorage|setStorageSync|console\.)/.test(localPreviewHandoff),
  "Local preview handoff must remain memory-only and must not log token-bound state"
);
check(
  !/(https?:\/\/|thumbnail_url|cover_url|timeline_cover_url)/.test(
    between(cover, "export function albumShareImage(", "export function createAlbumShareRequestAuthority(", "safe share image")
  ),
  "Share image selection must return only a local/temp path or static channel fallback"
);
includesAll(
  albumPage,
  [
    'id="album-share-friend-canvas"',
    'id="album-share-timeline-canvas"',
    'type="2d"',
    "createSelectorQuery",
    ".fields({ node: true, size: true }",
    "createAlbumShareCanvasRuntime",
    "createAlbumShareCanvasPreparation",
    "uni.canvasToTempFilePath",
    "const localPreviewByMediaId = this.albumShareLocalPreviewByMediaId(recipe)",
    "localPreviewByMediaId,",
    "rememberAlbumShareLocalPreviewHandoff",
    "takeAlbumShareLocalPreviewHandoff",
    "forgetAlbumShareLocalPreviewHandoff",
    "thumbnailUrlResolver: this.normalizeAlbumMediaUrl",
    "albumShareCoverPreparationIsCurrent",
    "onHide()",
    "this.resetAlbumShareCovers();",
    "onUnload()",
    "this.disposeAlbumShareCanvasPreparation();",
    "albumShareFriendPayload",
    "albumShareTimelinePayload"
  ],
  "album page Canvas node, preparation, sharing, and lifecycle wiring"
);
includesAll(
  miniCoverTest,
  [
    "远程 URL 永远不能作为分享 imageUrl",
    "一个渠道 Canvas 失败会使用该渠道静态图",
    "不阻塞另一个渠道",
    "鉴权变更会阻止旧分享 token",
    "只保存配方前三项可信路径并且只消费一次",
    "拒绝 token 或语义配方不匹配",
    "交接过期、远程路径与显式清理",
    "最多保留四个分享并淘汰最旧条目",
    "失效 token 可一次清理"
  ],
  "share-cover isolation regression tests"
);
includesAll(
  miniPreviewTest,
  [
    "public share prepares separate local Canvas covers",
    "share cover local-preview map only reuses recipe-selected local media",
    "direct token response snapshots local recipe previews",
    "preview navigation remembers selected local previews",
    "public preview clears every pending local handoff",
    "public body pagination is not part of share-cover currentness"
  ],
  "album-page Canvas integration regression tests"
);

const obsoleteD52GateFiles = walk("scripts").filter((file) => (
  /^scripts\/d52-/i.test(file) &&
  /(adaptive|album).*(share|cover)|(share|cover).*(album|adaptive)/i.test(path.basename(file))
));
check(
  obsoleteD52GateFiles.length === 0,
  `Obsolete D52 album-share-cover gate files remain: ${obsoleteD52GateFiles.join(", ")}`
);
check(
  !/d52-adaptive-album-share-cover|d52:[^"]*(?:album-share-cover|adaptive-cover)/i.test(
    JSON.stringify(packageJson.scripts)
  ),
  "Obsolete D52 album-share-cover package commands must be absent"
);

includesAll(
  server,
  [
    "SESSION_ALBUM_THUMBNAIL_RULE",
    "sessionAlbumThumbnailBuffer",
    "publicSessionAlbumMediaPhotoId",
    "getPublicSessionAlbumPhotoForMedia",
    "publicSessionAlbumVideoCoverId",
    "getPublicSessionAlbumVideoCoverForMedia",
    "publicSessionAlbumVideoUrlId",
    "publicSessionAlbumVideoFileId",
    "createPublicAlbumVideoResponse"
  ],
  "generic public thumbnail and video behavior"
);
check(
  typeof apiPackage.dependencies?.sharp === "string",
  "Generic Sharp image/thumbnail tooling must remain installed"
);
check(
  !/font-noto-cjk/i.test(apiDockerfile),
  "API Docker image must not retain the font used only by deleted server cover composition"
);

check(
  !/PUBLIC_SHARE_(?:COVER|LEGACY_COVER)_CANDIDATE_LIMIT/.test(d54Check),
  "D54 static gate must stay focused on pagination rather than D55 cover selection internals"
);
check(
  d54Check.includes("npm run d55:unit") && d54Check.includes("npm run d55:check"),
  "D54 lifecycle assertion must allow the D55 gates that follow it"
);
includesAll(
  d48Check,
  ["cover_recipe", "prepareAlbumShareCovers", "createAlbumShareCanvasPreparation"],
  "updated D48 public-share contract gate"
);
check(
  !d48Check.includes('"/cover"') && !d48Check.includes('"getImageInfo"'),
  "D48 static gate must not require the deleted server cover route or old cover preflight"
);
check(
  !/album-share-cover\/(?:layouts?|selection)/.test(d48Smoke) &&
    d48Smoke.includes("bounded to three client Canvas inputs"),
  "D48 privacy smoke must use the service-level three-image selection without deleted modules"
);
check(
  !miniprogramCheck.includes("friend_cover_url") &&
    !miniprogramCheck.includes("albumShareCoverResponse") &&
    miniprogramCheck.includes("albumShareCoverPreparationIsCurrent") &&
    miniprogramCheck.includes("albumShareLocalImagePath"),
  "The generic mini-program gate must assert the client Canvas contract instead of legacy cover URLs"
);
check(
  !d23Check.includes('"/api/session-album/public-shares/"') &&
    d23Check.includes('"/api/session-album/public-share/photos/"'),
  "The D23 compatibility gate must retain public media authorization without the deleted composite route"
);

if (failures.length > 0) {
  throw new Error(`D55 client Canvas album share cover check failed:\n- ${failures.join("\n- ")}`);
}

console.log("D55 client Canvas album share cover checks passed");
