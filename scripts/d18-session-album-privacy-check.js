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

const displayMigration = read("apps/api/migrations/0014_session_album_display_metadata.sql");
for (const token of [
  "image_width",
  "image_height",
  "image_byte_size",
  "image_content_type"
]) {
  assert(displayMigration.includes(token), `album display migration must include ${token}`);
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
  "tags.length === 0",
  "session-album",
  "display",
  "image_width",
  "image_height",
  "image_byte_size",
  "requiredPositiveInteger",
  "await requireSessionAlbumMember(connection, session, user);",
  "Only session members can view the session album",
  "listMyAlbumSessions",
  'filters.scope === "album"',
  "album_membership_role"
]) {
  assert(service.includes(token), `service must include ${token}`);
}
assert(
  /export async function listSessionAlbum[\s\S]{0,500}await requireSessionAlbumMember\(connection, session, user\);/.test(service),
  "album list must require same-session membership"
);
assert(
  /export async function getVisibleSessionAlbumPhotoForMedia[\s\S]{0,700}isSessionAlbumMember\(connection, session, currentUserId\)/.test(service),
  "album media visibility must require same-session membership"
);
assert(
  !/isAlbumPhotoVisibleToUser[\s\S]{0,600}isAdmin/.test(service),
  "album photo visibility must not grant system_admin bypass"
);

const server = read("apps/api/src/server.js");
for (const token of [
  "SESSION_ALBUM_DISPLAY_JPG_RULE",
  "imageMogr2/auto-orient/thumbnail/2048x2048>/format/jpg/quality/85/strip",
  "sessionAlbumDisplayJpgPicOperations",
  "processSessionAlbumDisplayJpg",
  "getSessionAlbumDisplayMetadata",
  "album display photo must be a processed JPEG",
  "album display photo exceeds the 2048px size limit",
  "sessionAlbumMediaSignature",
  "verifySessionAlbumMediaQuery",
  "private, no-store",
  "serveUploadedSessionAlbumPhoto",
  "sessionAlbumPhoto",
  "/api/session-album/photos/",
  "sessionAlbumPrivacyId",
  "sessionAlbumPeopleId",
  "sessionAlbumPhotosId",
  "adminSessionAlbumPhotosId",
  "adminSessionAlbumUploadId",
  "adminSessionAlbumPhoto",
  "assertAdminOwnSessionAlbumAllowed",
  "assertSessionAlbumUploadAllowed",
  "/uploads/session-album/display/"
]) {
  assert(server.includes(token), `server must include ${token}`);
}
assert(
  /sessionAlbumMediaPhotoId[\s\S]{0,500}const user = await getAuthUser\(request\);[\s\S]{0,500}getVisibleSessionAlbumPhotoForMedia\(\s*user\.user\.id/.test(server),
  "album media route must bind image access to the logged-in user"
);
assert(
  !server.includes('query.get("userId")'),
  "album media route must not trust userId from the URL query"
);
assert(
  !server.includes('url.pathname.startsWith("/uploads/session-album/")'),
  "album photos must not be exposed as public static uploads"
);

const cosStorage = read("apps/api/src/storage/cos.js");
assert(cosStorage.includes("session-album"), "COS storage key whitelist must allow album objects");
assert(
  cosStorage.includes("session-album") && cosStorage.includes("display"),
  "COS storage key whitelist must allow album display objects"
);

const api = read("apps/miniprogram/src/utils/api.js");
for (const token of [
  "apiUrl",
  "uploadSessionAlbumPhoto",
  'kind: "sessionAlbumPhoto"',
  "sessionId",
  "/album/uploads",
  "PicOperations: upload.picOperations"
]) {
  assert(api.includes(token), `miniprogram API must include ${token}`);
}

const adminWebPackage = read("apps/admin-web/package.json");
assert(adminWebPackage.includes("cos-js-sdk-v5"), "admin web must depend on the COS web SDK");

const adminWebApi = read("apps/admin-web/src/api.js");
for (const token of [
  'import("cos-js-sdk-v5")',
  "PicOperations: upload.picOperations",
  "adminSessionAlbumPhoto",
  "/api/admin/sessions/",
  "sessionAlbumBasePath",
  "sessionAlbumPhoto",
  "fallbackUploadSessionAlbumPhoto",
  "getMySessionAlbumPrivacy",
  "updateMySessionAlbumPrivacy",
  "return data.photoUrl"
]) {
  assert(adminWebApi.includes(token), `admin web album upload must include ${token}`);
}

const adminAlbumWorkspace = read("apps/admin-web/src/components/SessionAlbumWorkspace.vue");
for (const token of [
  "fetchAuthorizedMediaObjectUrl",
  "display_url",
  "photo.can_tag",
  "photo.is_mine",
  "隐私设置",
  "allowUploadedVisible",
  "allowTaggedVisible",
  "我上传的",
  "有我",
  "待标注",
  "selectedPeople",
  'scope: "album"',
  "albumRequestOptions"
]) {
  assert(adminAlbumWorkspace.includes(token), `admin album workspace must include ${token}`);
}

const pagesJson = read("apps/miniprogram/src/pages.json");
assert(pagesJson.includes("pages/session/album"), "pages.json must register album page");
assert(pagesJson.includes("pages/session/albumPrivacy"), "pages.json must register album privacy page");

const albumPage = read("apps/miniprogram/src/pages/session/album.vue");
for (const token of [
  "同车成员可保存",
  "隐私照片不会展示",
  "getToken",
  "downloadAlbumImage",
  "display_url",
  'v-if="canUpload"',
  "uploadSessionAlbumPhoto",
  "标注",
  "tagKeys",
  "apiUrl(photo.image_url)"
]) {
  assert(albumPage.includes(token), `album page must include ${token}`);
}

const privacyPage = read("apps/miniprogram/src/pages/session/albumPrivacy.vue");
for (const token of [
  "其他同车成员可以查看我上传的照片",
  "其他同车成员可以查看包含我的照片",
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
  "non-member should not list member-only album",
  "album media should require login",
  "same-session member without photo visibility should not open media",
  "visible same-session member should open media",
  "untagged photo should be hidden from non-uploader",
  "tagged player should see photo containing them",
  "other member should not see when tagged player blocks visibility",
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
