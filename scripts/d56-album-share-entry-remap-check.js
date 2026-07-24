import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`D56 required source is missing: ${relativePath}`);
  return fs.readFileSync(file, "utf8");
}

function check(condition, message) {
  if (!condition) throw new Error(`D56 album share entry check failed: ${message}`);
}

function between(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  check(start >= 0, `${label} is missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  check(end >= 0, `${label} is missing ${endMarker}`);
  return source.slice(start, end);
}

const album = read("apps/miniprogram/src/pages/session/album.vue");
const entry = read("apps/miniprogram/src/utils/albumShareEntry.js");
const cover = read("apps/miniprogram/src/utils/albumShareCover.js");

for (const state of [
  "defaultAlbumShareToken",
  "defaultAlbumShareTimelineCoverUrl",
  "defaultAlbumShareTimelineCoverPrepared",
  "activeAlbumShareToken",
  "activeAlbumShareTimelineCoverUrl",
  "activeAlbumShareTimelineCoverPrepared",
  "shareTimelineCoverUrl",
  "shareTimelineCoverPrepared"
]) {
  check(album.includes(`${state}:`), `data() must keep isolated ${state} state`);
}
for (const removed of [
  "defaultAlbumShareFriendCoverUrl",
  "activeAlbumShareFriendCoverUrl",
  "shareFriendCoverUrl",
  "albumShareCanvas"
]) {
  check(!album.includes(removed), `${removed} must be removed`);
}

const appMessage = between(
  album,
  "onShareAppMessage(options) {",
  "onShareTimeline() {",
  "app-message handler"
);
for (const intent of [
  "ALBUM_SHARE_INTENT.RECRUIT",
  "ALBUM_SHARE_INTENT.ACTIVE",
  "ALBUM_SHARE_INTENT.SINGLE",
  "ALBUM_SHARE_INTENT.DEFAULT_ALL",
  "ALBUM_SHARE_INTENT.PUBLIC"
]) {
  check(appMessage.includes(intent), `app-message handler must preserve ${intent}`);
}
check(
  !between(
    cover,
    "export function albumShareFriendPayload(",
    "export function albumShareTimelinePayload(",
    "friend payload"
  ).includes("imageUrl"),
  "full-album friend/group cards must use native current-page screenshots"
);

const timeline = between(album, "onShareTimeline() {", "watch: {", "timeline handler");
check(
  timeline.includes("publicAlbumShareTimelinePayload()") &&
    timeline.includes("albumShareReadyVisible") &&
    timeline.includes("activeAlbumShareTimelinePayload()") &&
    timeline.includes("defaultAlbumShareTimelinePayload()"),
  "timeline handler must prioritize active state and isolate public/default state"
);
for (const payload of [
  "publicAlbumShareTimelinePayload() {",
  "activeAlbumShareTimelinePayload() {",
  "defaultAlbumShareTimelinePayload() {"
]) {
  const start = album.indexOf(payload);
  check(start >= 0, `${payload} must exist`);
  const block = album.slice(start, album.indexOf("\n    },", start) + 7);
  check(
    block.includes("return null") && block.includes("albumShareTimelinePayload({"),
    `${payload} must fail closed without its own representative image`
  );
}

const showMenus = between(
  album,
  "showShareMenus() {",
  "async prepareShareCoverUrl",
  "share menu"
);
check(
  showMenus.includes("memberDefaultAlbumShareState") &&
    showMenus.includes("albumShareReadyVisible") &&
    showMenus.includes("activeAlbumShareToken") &&
    showMenus.includes("activeAlbumShareTimelineCoverPrepared"),
  "share menu must switch between active and default member state"
);

const defaultPreparation = between(
  album,
  "prepareDefaultAlbumShare() {",
  "handleRecruitShareTap() {",
  "default entry"
);
check(
  defaultPreparation.includes('data: { scope: "all" }') &&
    defaultPreparation.includes("selectAlbumShareTimelineImage(data)") &&
    defaultPreparation.includes("applyDefaultAlbumShareTimelineImage"),
  "default entry must create an all-media token and install its representative image"
);
const activePreparation = between(
  album,
  "async prepareAlbumShareSnapshot(payload) {",
  "openBulkTagSheet() {",
  "active entry"
);
check(
  activePreparation.includes("data: payload") &&
    activePreparation.includes("isCurrentAlbumShareSnapshotRequest") &&
    activePreparation.includes("selectAlbumShareTimelineImage(data)") &&
    activePreparation.includes("applyActiveAlbumShareTimelineImage"),
  "active entry must remain request-guarded and install its own representative image"
);

check(
  entry.includes("export function memberDefaultAlbumShareState") &&
    entry.includes("friendReady: Boolean(token)"),
  "valid default token must make friend/group sharing immediately ready"
);
check(
  !album.includes("<canvas") &&
    !album.includes("canvasToTempFilePath") &&
    !album.includes("<snapshot"),
  "album entry remap must not introduce Canvas or Skyline"
);

console.log("D56 album share entry remap checks passed");
