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
  "other:session",
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
  "album_membership_role",
  "hasOnlyAlbumMemberPublicTags",
  "isAlbumMemberPublicTag"
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
assert(
  /isAlbumPhotoVisibleToUser[\s\S]{0,900}hasOnlyAlbumMemberPublicTags\(tags,\s*privacyByUser\)/.test(service),
  "album member visibility must allow member-public special tags"
);
const albumPeopleSource = service.slice(
  service.indexOf("async function sessionAlbumPeople"),
  service.indexOf("function normalizeAlbumTagKeys")
);
for (const token of [
  'const roleLabel = seat.role_name || seat.name || "车友"',
  "const accountName = seat.confirmed_user_id",
  "label: roleLabel",
  "note: accountName",
  "role_name: seat.role_name",
  "account_name: accountName"
]) {
  assert(albumPeopleSource.includes(token), `album people should separate role labels from account names: ${token}`);
}

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
  !server.includes('request.method === "GET" && url.pathname.startsWith("/uploads/session-album/")'),
  "album photos must not be exposed as public static uploads"
);
assert(
  server.includes("cleanupUploadedSessionAlbumPhotoObject") &&
    server.includes("console.warn(\"session album COS cleanup failed\"") &&
    /deleteSessionAlbumPhoto\(user, sessionAlbumPhotoId\)[\s\S]{0,220}cleanupUploadedSessionAlbumPhotoObject\(deletedPhoto\.photo_url\)/.test(server),
  "album photo deletion must not fail the user request when COS object cleanup is denied"
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
  "vue-waterfall-plugin-next",
  "AuthorizedLazyImage",
  "fetchAuthorizedMediaObjectUrl",
  "display_url",
  "thumbnail_url",
  "preview_url",
  "photo.can_tag",
  "photo.is_mine",
  "隐私设置",
  "allowUploadedVisible",
  "allowTaggedVisible",
  "我上传的",
  "有我",
  "待标注",
  "selectedPeople",
  "defineProps",
  "sessionId",
  "getSession",
  "albumRequestOptions"
]) {
  assert(adminAlbumWorkspace.includes(token), `admin album workspace must include ${token}`);
}
assert(
  !adminAlbumWorkspace.includes('scope: "album"') &&
    !adminAlbumWorkspace.includes("listMySessions"),
  "admin album workspace must match mini-program single-session album logic"
);

const pagesJson = read("apps/miniprogram/src/pages.json");
assert(pagesJson.includes("pages/session/album"), "pages.json must register album page");
assert(pagesJson.includes("pages/session/albumPrivacy"), "pages.json must register album privacy page");

const albumPage = read("apps/miniprogram/src/pages/session/album.vue");
for (const token of [
  "uv-waterfall",
  "thumbnail_url",
  "preview_url",
  "visiblePhotoMedia",
  "onPhotoVisible",
  "我的照片",
  "其他车友照片不会展示",
  "getToken",
  "downloadAlbumImage",
  "display_url",
  'v-if="canUpload"',
  "uploadSessionAlbumPhoto",
  "标注",
  "tagKeys",
  "mediaUrlForPhoto(photo, variant",
  "photo.thumbnail_url",
  "photo.preview_url"
]) {
  assert(albumPage.includes(token), `album page must include ${token}`);
}
for (const token of [
  "albumSession",
  "albumDisplayTitle",
  "currentAlbumRoleName",
  "albumRoleNameFromMineTags",
  "applyAlbumSessionFallback",
  "applyAlbumNavigationTitle",
  "setNavigationBarTitle",
  "script_name_snapshot"
]) {
  assert(albumPage.includes(token), `album title must use role and script metadata: ${token}`);
}
assert(
  /albumDisplayTitle\(\)[\s\S]{0,500}\[\$\{this\.currentAlbumRoleName\}·\$\{this\.albumScriptName\}\] 相册/.test(albumPage),
  "album page title must render as '[<role>·<script>] 相册'"
);
assert(
  /currentAlbumRoleName\(\)[\s\S]{0,900}this\.albumRoleNameFromMineTags\(\)/.test(albumPage),
  "album title must fall back to the current uploader's tagged role when the user is not bound to a seat"
);
assert(
  /albumRoleNameFromMineTags\(\)[\s\S]{0,1600}photo\.is_mine[\s\S]{0,1600}tag\.tag_type === "seat"/.test(albumPage),
  "album title fallback must infer role names from the current user's own seat-tagged photos"
);
assert(
  /loadSessionPeopleFallback\(\)[\s\S]{0,600}this\.applyAlbumSessionFallback\(session\)/.test(albumPage),
  "album page must fall back to session detail metadata when album API lacks script name"
);
assert(
  /applyAlbumSessionFallback\(session\)[\s\S]{0,900}this\.albumScriptName[\s\S]{0,900}this\.albumSessionSummary\(session\)/.test(albumPage),
  "album page session fallback must populate missing script metadata without overwriting loaded album metadata"
);
assert(
  /export async function listSessionAlbum[\s\S]*?^}/m.test(service) &&
    /export async function listSessionAlbum[\s\S]*?script_name_snapshot:\s*session\.script_name_snapshot[\s\S]*?^}/m.test(service),
  "album API must expose session script name for the member album title"
);

for (const token of [
  "SESSION_ALBUM_THUMBNAIL_RULE",
  "thumbnail_url",
  "mediaVariant",
  "variant === \"thumbnail\"",
  "getCosObject({",
  "ciProcess"
]) {
  assert(server.includes(token), `album media thumbnails must include ${token}`);
}

const privacyPage = read("apps/miniprogram/src/pages/session/albumPrivacy.vue");
for (const token of [
  "相册分享隐私设置",
  "允许我上传的照片出现在分享展示里",
  "允许包含我的照片出现在分享展示里",
  "完整相册会展示你上传、标注了你或标为 NPC/其他的照片",
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
  "other confirmed seat should not see another role's tagged photo",
  "other confirmed seat should stay blocked when tagged player blocks visibility",
  "other-tagged photo should be visible to unrelated same-session members",
  "other-tagged same-session member should open media",
  "npc-only photo should be visible to unrelated same-session members",
  "npc-only same-session member should open media",
  "legacy NPC-only photo should be visible to unrelated same-session members",
  "bound NPC role privacy should hide npc-only photo from unrelated same-session members",
  "unbound legacy NPC-only photo should stay visible to unrelated same-session members",
  "bound NPC role user should see their NPC-only photo",
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
