import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import {
  assertDirectCosIntakeBranches,
  assertDirectCosIntentIntakeBranches,
  assertOnlyApprovedMiniProgramModerationCopy,
  sourceSection
} from "./d46-content-moderation-check-lib.js";

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function assertRouteIsGuarded(server, marker, type) {
  const start = server.indexOf(marker);
  assert.notEqual(start, -1, `missing write route: ${marker}`);
  const end = server.indexOf("\n    return;", start);
  assert.notEqual(end, -1, `missing route terminator: ${marker}`);
  assert.match(
    server.slice(start, end),
    new RegExp(`resolveContentSecurityIntake\\("${type}"\\)`),
    `write route must resolve ${type} publication policy: ${marker}`
  );
}

function assertPublishedReadGate(source, exportedName) {
  const start = source.indexOf(`export async function ${exportedName}`);
  assert.notEqual(start, -1, `missing published read gate: ${exportedName}`);
  const next = source.indexOf("\nexport async function ", start + 1);
  assert.match(
    source.slice(start, next === -1 ? undefined : next),
    /isModerationPublished\(/,
    `${exportedName} must reject non-published media`
  );
}

async function miniProgramSourcePaths(directory = "apps/miniprogram/src") {
  const entries = await readdir(new URL(`../${directory}/`, import.meta.url), {
    withFileTypes: true
  });
  const paths = [];
  for (const entry of entries) {
    if (entry.name === "wxcomponents") continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      paths.push(...await miniProgramSourcePaths(path));
    } else if (/\.(?:js|vue)$/.test(entry.name)) {
      paths.push(path);
    }
  }
  return paths;
}

const [
  packageRaw,
  server,
  coreService,
  albumImageUploadService,
  userImageService,
  userImageRepository,
  moderationService,
  callback,
  wechatCallback,
  stateMachine,
  retry,
  retryDispatch,
  retryRoutes,
  talkRoutes,
  miniModeration,
  miniApi,
  albumPage,
  reviewPage,
  migration30,
  migration31
] = await Promise.all([
  text("package.json"),
  text("apps/api/src/server.js"),
  text("apps/api/src/modules/core/service.js"),
  text("apps/api/src/modules/album-image/upload-service.js"),
  text("apps/api/src/modules/user-image-assets/service.js"),
  text("apps/api/src/modules/user-image-assets/repository.js"),
  text("apps/api/src/modules/content-moderation/service.js"),
  text("apps/api/src/modules/content-moderation/callback.js"),
  text("apps/api/src/modules/content-moderation/wechat-callback.js"),
  text("apps/api/src/modules/content-moderation/state-machine.js"),
  text("apps/api/src/modules/content-moderation/retry.js"),
  text("apps/api/src/modules/content-moderation/retry-dispatch.js"),
  text("apps/api/src/modules/content-moderation/constants.js"),
  text("packages/talk/api/routes.js"),
  text("apps/miniprogram/src/utils/contentModeration.js"),
  text("apps/miniprogram/src/utils/api.js"),
  text("apps/miniprogram/src/pages/session/album.vue"),
  text("apps/miniprogram/src/pages/session/review.vue"),
  text("apps/api/migrations/0030_content_security_settings.sql"),
  text("apps/api/migrations/0031_user_image_assets.sql")
]);
const miniSources = await Promise.all((await miniProgramSourcePaths()).map(async (path) => [
  path,
  await text(path)
]));

const packageJson = JSON.parse(packageRaw);
assert.equal(
  packageJson.scripts["d46:check"],
  "node --test scripts/d46-content-moderation-check.test.mjs && node scripts/d46-content-moderation-check.js"
);
assert.match(packageJson.scripts.precheck, /npm run d46:check/);
assert.match(migration30, /content_security_settings/);
assert.match(migration31, /user_image_assets/);

for (const type of ["text", "image", "video"]) {
  assert.match(server, new RegExp(`resolveContentSecurityIntake\\("${type}"\\)`));
}

for (const marker of [
  'url.pathname === "/api/users/me/avatar"',
  'url.pathname === "/api/session-reviews/photos"',
  'if (request.method === "POST" && sessionAlbumUploadId)',
  'if (request.method === "POST" && adminSessionAlbumUploadId)',
  'if (request.method === "POST" && sessionAlbumPhotosId)',
  'if (request.method === "POST" && adminSessionAlbumPhotosId)'
]) {
  assertRouteIsGuarded(server, marker, "image");
}
for (const marker of [
  'if (request.method === "POST" && adminSessionAlbumVideoUploadId)',
  'if (request.method === "POST" && adminSessionAlbumVideosId)'
]) {
  assertRouteIsGuarded(server, marker, "video");
}
const directCosIntent = sourceSection(
  server,
  "async function createCosDirectUploadIntent({ kind, extension, user, userId, sessionId })",
  "\nfunction normalizeCosHeaders"
);
assertDirectCosIntentIntakeBranches(directCosIntent);
assert.match(server, /async function moderateCoveredText\([\s\S]*?resolveContentSecurityIntake\("text"\)/);
for (const action of [
  "update_nickname",
  "create_private_store",
  "create_private_script",
  "create_session",
  "update_session",
  "create_session_npc_role",
  "update_session_npc_role",
  "upsert_session_review",
  "create_session_message",
  "update_session_pinned_message"
]) {
  assert.match(server, new RegExp(`action: "${action}"`), `missing moderated text action: ${action}`);
}

const userImageWiring = sourceSection(
  server,
  "const userImageAssetUploads = createUserImageAssetUploadService({",
  "function normalizedObjectVersion"
);
assert.match(userImageWiring, /assertImageIntake: \(connection\) => resolveContentSecurityIntake\("image", \{ connection \}\)/);
assert.match(userImageWiring, /contentModeration\.createWechatImageModerationJob/);
assert.match(userImageWiring, /contentModeration\.submitWechatImageModeration/);
const userImageFinalize = sourceSection(
  server,
  "async function finalizeUploadedUserImage({",
  "async function createUserImageCleanupAnchor"
);
assert.match(userImageFinalize, /userImageAssetUploads\.finalizeUploadedImage\(/);
const userImageFinalizeService = sourceSection(
  userImageService,
  "async finalizeUploadedImage(input)",
  "\n  };\n}"
);
assert.match(userImageFinalizeService, /await deps\.assertImageIntake\(connection\)/);
assert.match(userImageFinalizeService, /deps\.createWechatImageModerationJob\(connection/);
const userImageFinalizeRoute = sourceSection(
  server,
  'if (request.method === "POST" && url.pathname === "/api/uploads/user-image/finalize")',
  "\n  const userImageUploadOperationMatch"
);
assert.match(userImageFinalizeRoute, /finalizeUploadedUserImage\(/);

const albumImageWiring = sourceSection(
  server,
  "const albumImageUploads = createAlbumImageUploadService({",
  "\nasync function isPersistedAlbumImageAuthorization"
);
assert.match(albumImageWiring, /assertImageIntake: \(connection\) => resolveContentSecurityIntake\(/);
assert.match(albumImageWiring, /contentModeration\.createWechatImageModerationJob/);
assert.match(albumImageWiring, /contentModeration\.submitWechatImageModeration/);
for (const marker of ["async function createIntent", "async function authorize", "async function finalize"]) {
  const endMarker = marker === "async function createIntent"
    ? "\nasync function authorize"
    : marker === "async function authorize"
      ? "\nfunction uploadNotFound"
      : "\nasync function finalizeLegacy";
  assert.match(sourceSection(albumImageUploadService, marker, endMarker), /await assertImageIntake\(deps/);
}
const cosIntentRoute = sourceSection(
  server,
  'if (request.method === "POST" && url.pathname === "/api/uploads/cos-intent")',
  'if (request.method === "POST" && url.pathname === "/api/uploads/cos-authorization")'
);
assert.match(cosIntentRoute, /albumImageUploads\.createIntent/);
const cosAuthorizationRoute = sourceSection(
  server,
  'if (request.method === "POST" && url.pathname === "/api/uploads/cos-authorization")',
  'if (request.method === "POST" && url.pathname === "/api/telemetry/album-media")'
);
assert.match(cosAuthorizationRoute, /albumImageUploads\.authorize/);
assert.match(cosAuthorizationRoute, /authorizeCosDirectUpload\(\{ body, user \}\)/);
const directCosAuthorization = sourceSection(
  server,
  "async function authorizeCosDirectUpload({ body, user })",
  "\nasync function saveUploadedObject"
);
assert.match(directCosAuthorization, /directUpload\.kind === "avatar" \|\| directUpload\.kind === "sessionReviewPhoto"/);
assert.match(
  directCosAuthorization,
  /directUpload\.kind === "avatar" \|\| directUpload\.kind === "sessionReviewPhoto"\) \{\s*await resolveContentSecurityIntake\("image"\)/
);
assertDirectCosIntakeBranches(directCosAuthorization);
const albumV2FinalizeRoute = sourceSection(
  server,
  "const albumUploadFinalizeId = stringMatch(",
  "\n  const sessionAlbumId"
);
assert.match(albumV2FinalizeRoute, /if \(request\.method === "POST" && albumUploadFinalizeId\)/);
assert.match(albumV2FinalizeRoute, /albumImageUploads\.finalize\(/);

assert.match(talkRoutes, /typeof moderateCoveredText !== "function"/);
assert.match(talkRoutes, /return moderateCoveredText\(input\)/);
assert.match(talkRoutes, /await moderateTalkText\(\{[\s\S]*?action: "update_session_pinned_message"/);
assert.match(talkRoutes, /await moderateTalkText\(\{[\s\S]*?action: "create_session_message"/);
assert.match(server, /await routeExtensions\(\{[\s\S]*?moderateCoveredText/);

for (const getter of [
  "getVisibleSessionAlbumPhotoForMedia",
  "getPublicSessionAlbumPhotoForMedia",
  "getVisibleSessionAlbumVideoForPlayback",
  "getPublicSessionAlbumVideoCoverForMedia"
]) {
  assertPublishedReadGate(coreService, getter);
}
assert.match(coreService, /JOIN user_image_assets AS asset[\s\S]*?asset\.moderation_status IN \('approved', 'approved_legacy'\)/);
assert.match(coreService, /findOwnedPublishedUserImageAsset/);
assert.match(userImageRepository, /findUserImageAssetReadStateByPath[\s\S]*?moderation_status IN/);
assert.match(userImageService, /String\(asset\.status\) === "active" && isModerationPublished/);
assert.match(server, /async function assertPublishedUserImagePath[\s\S]*?if \(state\.published\) return;/);
assert.match(server, /async function serveUploadedAvatar[\s\S]*?assertPublishedUserImagePath/);
assert.match(server, /async function serveUploadedSessionReviewPhoto[\s\S]*?assertPublishedUserImagePath/);
for (const getter of ["listSessionAlbum(", "listPublicSessionAlbumShare("]) {
  assert.match(
    sourceSection(coreService, `export async function ${getter}`, "\nexport async function"),
    /moderation_status IN \('approved', 'approved_legacy'\)|isModerationPublished\(/
  );
}
for (const [builder, endMarker] of [
  ["attachSessionAlbumMediaUrls", "\nfunction signedPayloadSignature"],
  ["attachPublicSessionAlbumMediaUrls", "\nasync function sessionAlbumThumbnailBuffer"]
]) {
  assert.match(
    sourceSection(server, `export function ${builder}`, endMarker),
    /isModerationPublished\(photo\.moderation_status\)/
  );
}
for (const [marker, endMarker, gate] of [
  ["const publicSessionAlbumMediaPhotoId", "  const publicSessionAlbumVideoCoverId", "getPublicSessionAlbumPhotoForMedia"],
  ["const publicSessionAlbumVideoCoverId", "  const sessionAlbumMediaPhotoId", "getPublicSessionAlbumVideoCoverForMedia"],
  ["const sessionAlbumMediaPhotoId", "  const sessionAlbumMediaVideoCoverId", "getVisibleSessionAlbumPhotoForMedia"],
  ["const sessionAlbumMediaVideoCoverId", "  const sessionAlbumMediaVideoFileId", "getVisibleSessionAlbumVideoForPlayback"],
  ["const sessionAlbumMediaVideoFileId", "  const sessionAlbumMediaVideoUrlId", "getVisibleSessionAlbumVideoForPlayback"],
  ["const sessionAlbumMediaVideoUrlId", "\n\n  if (request.method === \"POST\" && url.pathname === \"/api/users/me/avatar\")", "getVisibleSessionAlbumVideoForPlayback"]
]) {
  assert.match(sourceSection(server, marker, endMarker), new RegExp(gate));
}

const tencentCallbackRoute = sourceSection(
  server,
  'url.pathname === "/api/internal/content-moderation/tencent-video/callback"',
  'if (request.method === "POST" && url.pathname === "/api/cos/ci/session-album-video-callback")'
);
assert.match(tencentCallbackRoute, /authenticateTencentCallback\(/);
assert.match(tencentCallbackRoute, /resolveTencentVideoCallback\(/);
assert.match(tencentCallbackRoute, /contentModeration\.applyMediaResult\(/);
const wechatCallbackRoute = sourceSection(
  server,
  'url.pathname === "/api/internal/content-moderation\/wechat-image\/callback"',
  "\n  const body = await bodyFor(request);"
);
assert.match(wechatCallbackRoute, /verifyWechatCallbackUrl\(/);
assert.match(wechatCallbackRoute, /parseWechatSecureImageEvent\(/);
assert.match(wechatCallbackRoute, /dispatchWechatImageModerationEvent\(/);
assert.match(wechatCallbackRoute, /applyMediaResult: \(input\) => contentModeration\.applyMediaResult\(input\)/);
assert.match(callback, /crypto\.timingSafeEqual/);
assert.match(wechatCallback, /verifyWechatCallbackSignature/);
assert.match(stateMachine, /PROVIDER_TRANSITIONS/);
assert.match(stateMachine, /assertModerationTransition/);
const applyMediaResult = sourceSection(moderationService, "async function applyMediaResult(input)", "\n  async function moderateTextMutation");
assert.match(applyMediaResult, /findModerationAttemptByProviderJobId/);
assert.match(applyMediaResult, /findCurrentModerationAttempt/);
assert.match(applyMediaResult, /String\(job\.subject_version\) !== String\(input\.subjectVersion\)/);
assert.match(applyMediaResult, /String\(media\.moderation_object_version \|\| ""\)/);
for (const route of ["avatar_image", "review_image", "album_image", "album_video"]) {
  assert.match(retryRoutes, new RegExp(`subjectType: "${route}"`));
}
assert.match(retry, /claimModerationRetryJobs/);
assert.match(retry, /failModerationJob/);
assert.match(retryDispatch, /repository\.rehydrateModerationRetryJob/);
assert.match(retryDispatch, /submitWechatImageModeration/);
assert.match(retryDispatch, /submitVideoJob/);

for (const copy of [
  "内容正在安全审核",
  "内容未通过安全审核",
  "内容安全服务暂未就绪，暂时无法发布，请稍后再试"
]) {
  assert.match(miniModeration, new RegExp(copy));
}
assert.doesNotMatch(miniModeration, /Tencent|微信|腾讯|score|label|hit[_ ]?word/i);
assert.match(miniModeration, /code\.startsWith\("CONTENT_MODERATION_"\)/);
assert.match(miniApi, /const moderationMessage = contentModerationErrorText\(error\);/);
assert.match(miniApi, /error\.userMessage = moderationMessage;/);
assert.match(miniApi, /if \(!moderationMessage && !isContentModerationError\(error\)\)/);
assert.doesNotMatch(miniApi, /error\.userMessage = moderationMessage \|\| error\.message/);
assert.doesNotMatch(albumPage, /moderation_message|provider_job_id|hit_words|photo\.(?:provider|score|suggestion)/);
assert.match(reviewPage, /const moderationMessage = contentModerationErrorText\(error\);/);
for (const [path, source] of miniSources) {
  assertOnlyApprovedMiniProgramModerationCopy(path, source);
}

console.log("D46 content moderation static checks passed");
