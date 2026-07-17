import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(file, text, label = text) {
  const content = read(file);
  assert(content.includes(text), `${file} should include ${label}`);
}

function assertNotIncludes(file, text, label = text) {
  const content = read(file);
  assert(!content.includes(text), `${file} should not include ${label}`);
}

function assertMatches(file, pattern, label = pattern.source) {
  const content = read(file);
  assert(pattern.test(content), `${file} should match ${label}`);
}

assert(
  exists("apps/api/migrations/0021_session_album_video.sql"),
  "D32 migration 0021_session_album_video.sql should exist"
);

const migration = read("apps/api/migrations/0021_session_album_video.sql");
for (const token of [
  "MODIFY COLUMN photo_url VARCHAR(512) NULL",
  "media_type VARCHAR(16) NOT NULL DEFAULT 'image'",
  "processing_status VARCHAR(32) NOT NULL DEFAULT 'ready'",
  "source_url VARCHAR(512)",
  "display_url VARCHAR(512)",
  "cover_url VARCHAR(512)",
  "duration_seconds INT UNSIGNED",
  "video_width INT UNSIGNED",
  "video_height INT UNSIGNED",
  "video_byte_size BIGINT UNSIGNED",
  "video_content_type VARCHAR(64)",
  "ci_job_id VARCHAR(128)",
  "processing_error VARCHAR(255)",
  "idx_session_album_media_type_status"
]) {
  assert(migration.includes(token), `D32 migration should include ${token}`);
}

assertIncludes("apps/api/src/modules/core/service.js", "ALBUM_VIDEO_MAX_DURATION_SECONDS");
assertIncludes("apps/api/src/modules/core/service.js", "createSessionAlbumVideo");
assertIncludes("apps/api/src/modules/core/service.js", "updateSessionAlbumVideoProcessingResult");
assertIncludes("apps/api/src/modules/core/service.js", "getVisibleSessionAlbumVideoForPlayback");
assertIncludes("apps/api/src/modules/core/service.js", "processing_status");
assertIncludes("apps/api/src/modules/core/service.js", "media_type");
assertIncludes("apps/api/src/modules/core/service.js", "media: photos");
assertIncludes("apps/api/src/modules/core/service.js", "durationSeconds must be at most 60 seconds");

assertIncludes("apps/api/src/server.js", "adminSessionAlbumVideo");
assertIncludes("apps/api/src/server.js", "handleSessionAlbumVideoProcessingCallback");
assertIncludes("apps/api/src/server.js", "parseSessionAlbumVideoProcessingCallback");
assertIncludes("apps/api/src/server.js", "/api/cos/ci/session-album-video-callback");
assertIncludes("apps/api/src/server.js", "^\\/api\\/admin\\/sessions\\/(\\d+)\\/album\\/videos$");
assertIncludes("apps/api/src/server.js", "^\\/api\\/session-album\\/media\\/(\\d+)\\/video-url$");
assertIncludes("apps/api/src/server.js", "signedAlbumVideoUrl");
assertIncludes("apps/api/src/server.js", "signedAlbumVideoSnapshotUrl");
assertIncludes("apps/api/src/server.js", "ci-process");
assertIncludes("apps/api/src/server.js", "snapshot");
assertIncludes("apps/api/src/server.js", "SESSION_ALBUM_VIDEO_UPLOAD_MAX_BYTES");
assertIncludes("apps/api/src/server.js", "uploads/session-album/videos/source/");
assertIncludes("apps/api/src/server.js", "readyOnCreate: true");
assertNotIncludes(
  "apps/api/src/server.js",
  "localFallbackReady: !isCosUploadStorageEnabled()",
  "COS-enabled videos waiting for cloud transcode"
);
assertIncludes("apps/api/src/modules/core/service.js", "readyOnCreate");
assertIncludes("apps/api/src/modules/core/service.js", "readyOnCreate ? sourceUrl : null");

const server = read("apps/api/src/server.js");
const videoRouteStart = server.indexOf("const sessionAlbumMediaVideoFileId");
const videoRouteEnd = server.indexOf("if (request.method === \"POST\" && url.pathname === \"/api/users/me/avatar\")", videoRouteStart);
const videoRouteSnippet = server.slice(videoRouteStart, videoRouteEnd);
assert(videoRouteSnippet.includes("signedAlbumVideoUrl"), "video route should sign a playback URL");
assert(
  server.includes("return sessionAlbumVideoFilePath(media, userId);"),
  "video playback URL should use the backend token route so mini-program video HEAD probes do not hit a GET-only COS signature"
);
assert(
  /request\.method === "GET"\s*\|\|\s*request\.method === "HEAD"/.test(videoRouteSnippet),
  "video file route should accept HEAD for mini-program media probes"
);
assert(
  /serveUploadedSessionAlbumVideoFile\(media, response, \{[\s\S]*method: request\.method,[\s\S]*range: request\.headers\.range/.test(
    videoRouteSnippet
  ),
  "video file route should pass the request method and Range header to the video file responder"
);
const videoFileResponderStart = server.indexOf("export async function serveUploadedSessionAlbumVideoFile");
const videoFileResponderEnd = server.indexOf(
  "async function getSessionAlbumDisplayMetadata",
  videoFileResponderStart
);
const videoFileResponder = server.slice(videoFileResponderStart, videoFileResponderEnd);
assert(
  /if \(method === "HEAD"\) \{[\s\S]*?headCosObject[\s\S]*?response\.writeHead\(200, \{[\s\S]*?return;\s*\}[\s\S]*?response\.writeHead\(302, \{[\s\S]*?location: signedCosAlbumVideoUrl\(media, method\)/.test(
    videoFileResponder
  ),
  "COS-backed video HEAD must stay on the authenticated API URL while GET redirects to a fresh signed COS URL without proxying video bytes"
);
assert(!videoRouteSnippet.includes("getCosObject"), "video route must not proxy COS video bytes");

assertIncludes("apps/api/src/storage/cos.js", "uploads\\/session-album\\/videos\\/(source|display|cover)");
assertIncludes("apps/api/src/storage/cos.js", "urlParams");
assertIncludes("apps/api/src/storage/cos.js", "q-url-param-list=${urlParamList}");

assertIncludes("apps/api/src/config/env.js", "COS_CI_CALLBACK_TOKEN");
assertIncludes(".env.example", "COS_CI_CALLBACK_TOKEN=");
assertIncludes(".env.production.example", "COS_CI_CALLBACK_TOKEN=");

assertIncludes("apps/miniprogram/src/utils/api.js", "uploadSessionAlbumVideo");
assertIncludes("apps/miniprogram/src/utils/api.js", "adminSessionAlbumVideo");

assertIncludes("apps/miniprogram/src/pages/session/album.vue", "MAX_ALBUM_VIDEO_DURATION_SECONDS");
assertIncludes("apps/miniprogram/src/pages/session/album.vue", "wx.chooseMedia");
assertIncludes("apps/miniprogram/src/pages/session/album.vue", "wx.compressVideo");
assertIncludes("apps/miniprogram/src/pages/session/album.vue", "chooseAlbumMedia");
assertIncludes("apps/miniprogram/src/pages/session/album.vue", "classifyAlbumMediaSelection");
assertNotIncludes("apps/miniprogram/src/pages/session/album.vue", "@tap=\"chooseVideo\"");
assertIncludes("apps/miniprogram/src/pages/session/album.vue", "media_type === \"video\"");
assertIncludes("apps/miniprogram/src/pages/session/album.vue", "media_type === \"image\"");
assertNotIncludes("apps/miniprogram/src/pages/session/album.vue", "openVideoPlayer");
assertNotIncludes("apps/miniprogram/src/pages/session/album.vue", "video-player-popup");
assertIncludes("apps/miniprogram/src/pages/session/album.vue", "@need-video=\"handlePreviewVideoRequest\"");
assertIncludes("apps/miniprogram/src/pages/session/album.vue", "loadPreviewVideoUrl");
assertIncludes("apps/miniprogram/src/pages/session/album.vue", "video_display_url");
assertIncludes("apps/miniprogram/src/pages/session/album.vue", "video_load_failed");
assertIncludes("apps/miniprogram/src/components/AlbumImageViewer.vue", "<video");
assertIncludes("apps/miniprogram/src/components/AlbumImageViewer.vue", "need-video");
assertIncludes("apps/miniprogram/src/components/AlbumImageViewer.vue", "pauseAllVideos");
assertIncludes("apps/miniprogram/src/pages/session/album.vue", "打开小程序查看视频");

assertIncludes("apps/admin-web/src/api.js", "uploadSessionAlbumVideo");
assertIncludes("apps/admin-web/src/api.js", "createSessionAlbumVideo");
assertIncludes("apps/admin-web/src/api.js", "getSessionAlbumVideoUrl");
assertIncludes("apps/admin-web/src/components/SessionAlbumWorkspace.vue", "media_type === \"video\"");
assertIncludes("apps/admin-web/src/components/SessionAlbumWorkspace.vue", "previewVideo");
assertIncludes("apps/admin-web/src/components/SessionAlbumWorkspace.vue", "video-card");

assertIncludes("scripts/check-miniprogram.js", "D32 admin album video");
assertIncludes("scripts/check-miniprogram.js", "wx.chooseMedia");
assertIncludes("scripts/check-miniprogram.js", "wx.compressVideo");
assertIncludes("scripts/check-miniprogram.js", "MAX_ALBUM_VIDEO_DURATION_SECONDS");
assertIncludes("scripts/check-miniprogram.js", "media_type === \"image\"");

assertIncludes("package.json", "node scripts/d32-admin-album-video-check.js");
assertIncludes("package.json", "node --check scripts/d32-admin-album-video-smoke.js");
assertIncludes("package.json", "\"d32:smoke\": \"node scripts/d32-admin-album-video-smoke.js\"");

console.log("D32 admin album video checks passed");
