import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const migration = read("apps/api/migrations/0013_session_album_privacy.sql");
for (const token of [
  "CREATE TABLE IF NOT EXISTS session_album_privacy",
  "CREATE TABLE IF NOT EXISTS session_album_photos",
  "CREATE TABLE IF NOT EXISTS session_album_photo_tags",
  "allow_uploaded_visible",
  "allow_tagged_visible",
  "uploader_user_id",
  "tag_type"
]) {
  assert(migration.includes(token), `album migration must include ${token}`);
}

const service = read("apps/api/src/modules/core/service.js");
for (const token of [
  "requireSessionAlbumOpen",
  "requireSessionAlbumMember",
  "isAlbumPhotoVisibleToUser",
  "allow_uploaded_visible",
  "allow_tagged_visible",
  "getVisibleSessionAlbumPhotoForMedia",
  "Only the photo uploader can tag this photo",
  "tags.length === 0"
]) {
  assert(service.includes(token), `service must include ${token}`);
}
assert(
  !/isAlbumPhotoVisibleToUser[\s\S]{0,600}isAdmin/.test(service),
  "album photo visibility must not grant system_admin bypass"
);

const server = read("apps/api/src/server.js");
for (const token of [
  "sessionAlbumMediaSignature",
  "verifySessionAlbumMediaQuery",
  "serveUploadedSessionAlbumPhoto",
  "sessionAlbumPhoto",
  "/api/session-album/photos/",
  "sessionAlbumPrivacyId",
  "sessionAlbumPeopleId",
  "sessionAlbumPhotosId",
  "assertSessionAlbumUploadAllowed"
]) {
  assert(server.includes(token), `server must include ${token}`);
}
assert(
  !server.includes('url.pathname.startsWith("/uploads/session-album/")'),
  "album photos must not be exposed as public static uploads"
);

const cosStorage = read("apps/api/src/storage/cos.js");
assert(cosStorage.includes("session-album"), "COS storage key whitelist must allow album objects");

const api = read("apps/miniprogram/src/utils/api.js");
for (const token of [
  "apiUrl",
  "uploadSessionAlbumPhoto",
  'kind: "sessionAlbumPhoto"',
  "sessionId",
  "/album/uploads"
]) {
  assert(api.includes(token), `miniprogram API must include ${token}`);
}

const pagesJson = read("apps/miniprogram/src/pages.json");
assert(pagesJson.includes("pages/session/album"), "pages.json must register album page");
assert(pagesJson.includes("pages/session/albumPrivacy"), "pages.json must register album privacy page");

const albumPage = read("apps/miniprogram/src/pages/session/album.vue");
for (const token of [
  "可见照片可保存",
  "隐私照片不会展示",
  "uploadSessionAlbumPhoto",
  "标注",
  "tagKeys",
  "apiUrl(photo.image_url)"
]) {
  assert(albumPage.includes(token), `album page must include ${token}`);
}

const privacyPage = read("apps/miniprogram/src/pages/session/albumPrivacy.vue");
for (const token of [
  "别人可以查看我上传的照片",
  "别人可以查看包含我的照片",
  "车头也不能越权查看原图",
  "allowUploadedVisible",
  "allowTaggedVisible"
]) {
  assert(privacyPage.includes(token), `privacy page must include ${token}`);
}

const detailPage = read("apps/miniprogram/src/pages/session/detail.vue");
assert(detailPage.includes("goAlbum"), "session detail must expose album navigation");
assert(detailPage.includes("相册会在发车后开放"), "session detail must explain pre-start album gate");

const smoke = read("scripts/d18-session-album-privacy-smoke.js");
for (const token of [
  "untagged photo should be hidden from non-uploader",
  "tagged player should see photo containing them",
  "outsider should not see when tagged player blocks visibility",
  "admin must not bypass tagged player privacy",
  "future.session.id"
]) {
  assert(smoke.includes(token), `album smoke must cover ${token}`);
}

const packageJson = JSON.parse(read("package.json"));
assert(
  packageJson.scripts.check.includes("scripts/d18-session-album-privacy-check.js"),
  "root check should run d18 session album privacy check"
);
assert(
  packageJson.scripts.check.includes("node --check scripts/d18-session-album-privacy-smoke.js"),
  "root check should syntax-check d18 album smoke"
);
assert(
  packageJson.scripts["d18:smoke"] === "node scripts/d18-session-album-privacy-smoke.js",
  "root scripts should expose d18 album smoke"
);

console.log("D18 session album privacy check passed");
