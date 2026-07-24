import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function absolute(relativePath) {
  return path.join(root, relativePath);
}

function read(relativePath) {
  const file = absolute(relativePath);
  if (!fs.existsSync(file)) {
    throw new Error(`D55 required source is missing: ${relativePath}`);
  }
  return fs.readFileSync(file, "utf8");
}

function check(condition, message) {
  if (!condition) throw new Error(`D55 representative-image check failed: ${message}`);
}

function between(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  check(start >= 0, `${label} is missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  check(end >= 0, `${label} is missing ${endMarker}`);
  return source.slice(start, end);
}

const canvasSourcePath = "apps/miniprogram/src/utils/albumShareCanvas.js";
const canvasTestPath = "apps/miniprogram/test/albumShareCanvas.test.mjs";
check(!fs.existsSync(absolute(canvasSourcePath)), `${canvasSourcePath} must be deleted`);
check(!fs.existsSync(absolute(canvasTestPath)), `${canvasTestPath} must be deleted`);

const pages = JSON.parse(read("apps/miniprogram/src/pages.json"));
for (const page of pages.pages || []) {
  check(page?.style?.renderer !== "skyline", `${page.path} must remain WebView`);
  check(
    page?.style?.componentFramework !== "glass-easel",
    `${page.path} must not opt into GlassEasel`
  );
}

const cover = read("apps/miniprogram/src/utils/albumShareCover.js");
for (const token of [
  "export function albumShareLocalImagePath(",
  "export function albumShareCoverRecipe(",
  "export function selectAlbumShareTimelineImage(",
  "export function albumShareMenus(",
  "export function albumShareFriendPayload(",
  "export function albumShareTimelinePayload("
]) {
  check(cover.includes(token), `cover helper must include ${token}`);
}
const selector = between(
  cover,
  "export function selectAlbumShareTimelineImage(",
  "export function albumShareMenus(",
  "representative selector"
);
check(
  selector.indexOf("localPreview(localPreviewByMediaId, image)") <
    selector.indexOf("image?.thumbnail_url"),
  "selector must prefer the candidate's local preview before its online thumbnail"
);
check(
  selector.includes("/^https?:\\/\\//i.test(online)") &&
    selector.includes('return ""'),
  "selector must accept only HTTP(S) online thumbnails and fail closed"
);
check(
  !cover.includes("ALBUM_SHARE_FRIEND_FALLBACK") &&
    !cover.includes("ALBUM_SHARE_TIMELINE_FALLBACK") &&
    !cover.includes("./albumShareCanvas"),
  "cover helper must not retain Canvas or static full-album fallbacks"
);
const friendPayload = between(
  cover,
  "export function albumShareFriendPayload(",
  "export function albumShareTimelinePayload(",
  "friend payload"
);
check(!friendPayload.includes("imageUrl"), "friend payload must omit imageUrl");
const timelinePayload = cover.slice(cover.indexOf("export function albumShareTimelinePayload("));
check(
  timelinePayload.includes("if (!normalizedImageUrl) return null") &&
    timelinePayload.includes("imageUrl: normalizedImageUrl"),
  "timeline payload must require a real representative image"
);

const album = read("apps/miniprogram/src/pages/session/album.vue");
for (const token of [
  "selectAlbumShareTimelineImage",
  "albumShareLocalPreviewByMediaId",
  "prepareAlbumShareTimelineImage",
  "applyAlbumShareTimelineImage",
  "applyDefaultAlbumShareTimelineImage",
  "applyActiveAlbumShareTimelineImage",
  "publicAlbumShareTimelinePayload",
  "activeAlbumShareTimelinePayload",
  "defaultAlbumShareTimelinePayload"
]) {
  check(album.includes(token), `album page must include ${token}`);
}
for (const forbidden of [
  "<canvas",
  "canvasToTempFilePath",
  "albumShareCanvas",
  "<snapshot",
  "ticket-landscape.jpg"
]) {
  check(!album.includes(forbidden), `album full-share path must not include ${forbidden}`);
}
const onTimeline = between(album, "onShareTimeline() {", "watch: {", "timeline handler");
check(
  onTimeline.includes("publicAlbumShareTimelinePayload()") &&
    onTimeline.includes("albumShareReadyVisible") &&
    onTimeline.includes("activeAlbumShareTimelinePayload()") &&
    onTimeline.includes("defaultAlbumShareTimelinePayload()"),
  "timeline handler must isolate public, active, and default full-album state"
);
const defaultPreparation = between(
  album,
  "prepareDefaultAlbumShare() {",
  "handleRecruitShareTap() {",
  "default preparation"
);
const activePreparation = between(
  album,
  "async prepareAlbumShareSnapshot(payload) {",
  "openBulkTagSheet() {",
  "active preparation"
);
check(
  defaultPreparation.includes("this.selectAlbumShareTimelineImage(data)") &&
    defaultPreparation.includes("this.applyDefaultAlbumShareTimelineImage("),
  "default token must install its own representative image"
);
check(
  activePreparation.includes("this.selectAlbumShareTimelineImage(data)") &&
    activePreparation.includes("this.applyActiveAlbumShareTimelineImage("),
  "active token must install its own representative image"
);
check(
  (album.match(/this\.prepareAlbumShareTimelineImage\(data\)/g) || []).length >= 2,
  "public initial load and refresh must install their current representative image"
);

const coverTest = read("apps/miniprogram/test/albumShareCover.test.mjs");
for (const testName of [
  "prefers the first candidate local preview",
  "falls back to the same candidate online thumbnail",
  "skips a fully unusable first candidate",
  "returns empty when no candidate is usable",
  "friend payload omits imageUrl"
]) {
  check(coverTest.includes(testName), `focused tests must cover: ${testName}`);
}

const api = read("apps/api/src/server.js");
check(api.includes("cover_recipe"), "server must retain the public-safe cover recipe");

const packageJson = JSON.parse(read("package.json"));
const d55Unit = packageJson.scripts?.["d55:unit"] || "";
check(
  d55Unit.includes("albumShareCover.test.mjs") &&
    d55Unit.includes("albumShareWebView.test.mjs") &&
    !d55Unit.includes("albumShareCanvas.test.mjs"),
  "d55:unit must run representative-image/WebView tests and omit Canvas tests"
);

console.log("D55 representative album share image checks passed");
