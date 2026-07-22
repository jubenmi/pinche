import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const album = read("apps/miniprogram/src/pages/session/album.vue");
const viewer = read("apps/miniprogram/src/components/AlbumImageViewer.vue");
const api = read("apps/miniprogram/src/utils/api.js");

function block(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing block start: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing block end: ${end}`);
  return source.slice(from, to);
}

function assertOrdered(source, tokens, label) {
  let cursor = -1;
  for (const token of tokens) {
    const index = source.indexOf(token, cursor + 1);
    assert.notEqual(index, -1, `${label} missing or out of order: ${token}`);
    cursor = index;
  }
}

function assertAlbumMediaEntryContract(source) {
  assert.equal((source.match(/@tap="chooseAlbumMedia"/g) || []).length, 2);
  assert.doesNotMatch(source, /@tap="chooseVideo"|album-video-upload-action|album-primary-actions\.has-video/);

  const canUploadVideo = block(source, "canUploadVideo() {", "downloadablePhotos() {");
  assert.match(
    canUploadVideo,
    /return\s+!this\.timelineMode\s*&&\s*this\.canUpload\s*&&\s*this\.isSystemAdmin\s*;/
  );

  const chooseAlbumMedia = block(source, "chooseAlbumMedia() {", "choosePhotos() {");
  const firstGuardStart = "if (this.timelineMode || !this.canUpload || this.albumBusy) {";
  assert.equal(
    chooseAlbumMedia.search(/\bif\s*\(/),
    chooseAlbumMedia.indexOf(firstGuardStart),
    "chooseAlbumMedia must begin with the upload availability guard"
  );
  const firstGuard = block(chooseAlbumMedia, firstGuardStart, "if (!this.canUploadVideo) {");
  assertOrdered(firstGuard, [firstGuardStart, "showToast(", "return;"], "chooseAlbumMedia availability guard");

  const imageFallback = block(
    chooseAlbumMedia,
    "if (!this.canUploadVideo) {",
    'if (typeof wx === "undefined" || typeof wx.chooseMedia !== "function") {'
  );
  assertOrdered(
    imageFallback,
    ["if (!this.canUploadVideo) {", "this.choosePhotos();", "return;"],
    "chooseAlbumMedia image-only fallback"
  );

  const wxFallbackStart = 'if (typeof wx === "undefined" || typeof wx.chooseMedia !== "function") {';
  const wxFallback = block(chooseAlbumMedia, wxFallbackStart, "wx.chooseMedia({");
  assertOrdered(
    wxFallback,
    [wxFallbackStart, "当前微信版本仅支持选择图片", "this.choosePhotos();", "return;"],
    "chooseAlbumMedia wx fallback"
  );

  const chooseMediaOptions = block(chooseAlbumMedia, "wx.chooseMedia({", "success: async (result) => {");
  assertOrdered(
    chooseMediaOptions,
    [
      "wx.chooseMedia({",
      "count: 9,",
      'mediaType: ["image", "video"],',
      'sourceType: ["album", "camera"],',
      'sizeType: ["original"],',
      "maxDuration: MAX_ALBUM_VIDEO_RECORDING_DURATION_SECONDS,"
    ],
    "chooseAlbumMedia chooseMedia options"
  );

  const chooseMediaSuccess = block(
    chooseAlbumMedia,
    "success: async (result) => {",
    "\n        }\n      });"
  );
  const invalidSelection = block(
    chooseMediaSuccess,
    'if (selection.kind === "invalid") {',
    'if (selection.kind === "video") {'
  );
  assertOrdered(
    invalidSelection,
    [
      'if (selection.kind === "invalid") {',
      'showToast({ title: selection.message, icon: "none" });',
      "return;"
    ],
    "chooseAlbumMedia invalid selection branch"
  );
  const videoSelection = block(
    chooseMediaSuccess,
    'if (selection.kind === "video") {',
    "await this.uploadChosenPhotos(selection.paths);"
  );
  assertOrdered(
    videoSelection,
    [
      'if (selection.kind === "video") {',
      "await this.uploadChosenVideo(selection.file);",
      "return;"
    ],
    "chooseAlbumMedia video selection branch"
  );
  assertOrdered(
    chooseMediaSuccess,
    [
      "const selection = classifyAlbumMediaSelection(result);",
      'if (selection.kind === "invalid") {',
      'if (selection.kind === "video") {',
      "await this.uploadChosenPhotos(selection.paths);"
    ],
    "chooseAlbumMedia selection routing"
  );
}

const uploadCosObject = block(api, "async function uploadCosObject", "function normalizeAlbumCosError");
assert.match(uploadCosObject, /Headers:\s*upload\.headers\s*\|\|\s*\{\}/);
assert.doesNotMatch(uploadCosObject, /Authorization|Bearer/);

const uploadCosBackedFile = block(api, "async function uploadCosBackedFile", "function uploadBackendFile");
assert.match(uploadCosBackedFile, /getLocalFileSize\(filePath\)/);
assert.match(uploadCosBackedFile, /localFileSize\s*>\s*maxBytes/);
assert.match(uploadCosBackedFile, /if\s*\(!localFileSize\)[\s\S]*fallbackUpload\(filePath,\s*recovery\)/);
assert.ok(
  uploadCosBackedFile.indexOf("requestCosUploadIntent") < uploadCosBackedFile.indexOf("getLocalFileSize(filePath)"),
  "the direct-upload size must be re-read after the server returns its intent"
);
assert.ok(
  uploadCosBackedFile.indexOf("localFileSize > 0") < uploadCosBackedFile.indexOf("uploadCosObject"),
  "the direct PUT must happen only after the authoritative size gate"
);

assert.match(album, /MAX_ALBUM_VIDEO_RECORDING_DURATION_SECONDS = 60/);
const compressVideo = block(
  album,
  "async compressVideoBeforeUpload",
  "isSuspiciousCompressedVideo"
);
assert.match(compressVideo, /compressVideoSizeBytes\(result\.size\)/);
assert.match(compressVideo, /fail:\s*\(\)\s*=>\s*resolve\(null\)/);
assert.doesNotMatch(compressVideo, /return \{ filePath, \.\.\.originalInfo \}/);
assert.match(album, /if\s*\(!uploadSize\)[\s\S]*无法确认视频大小/);
const uploadChosenVideo = block(album, "async uploadChosenVideo(file) {", "async uploadChosenPhotos(paths) {");
assert.doesNotMatch(uploadChosenVideo, /Math\.max\(1,/);
assert.doesNotMatch(uploadChosenVideo, /durationSeconds > /);
assert.doesNotMatch(uploadChosenVideo, /uploadSize > /);
assert.doesNotMatch(album, /shouldCompressVideoBeforeUpload/);
assertOrdered(
  uploadChosenVideo,
  [
    "await this.compressVideoBeforeUpload(originalPath, uploadInfo)",
    "isUsableRequiredVideoCompression",
    "await uploadSessionAlbumVideo(this.sessionId, uploadPath)"
  ],
  "mandatory video compression before upload"
);
assert.match(
  album,
  /import\s*\{\s*runExclusiveAlbumMediaTask\s*\}\s*from\s*["']\.\.\/\.\.\/utils\/albumMediaOperation["'];/
);
const exclusiveVideoTask = block(
  uploadChosenVideo,
  "await runExclusiveAlbumMediaTask({",
  "\n        });\n      } catch (error) {"
);
assert.equal(
  uploadChosenVideo.indexOf("await "),
  uploadChosenVideo.indexOf("await runExclusiveAlbumMediaTask({"),
  "video upload must acquire the exclusive lock before its first await"
);
assert.match(exclusiveVideoTask, /isBusy:\s*\(\)\s*=>\s*this\.albumBusy/);
assert.match(
  exclusiveVideoTask,
  /setBusy:\s*\(?value\)?\s*=>\s*\{\s*this\.uploading\s*=\s*value;\s*\}/
);
const exclusiveTaskStart = exclusiveVideoTask.indexOf("task: async () => {");
const firstExclusiveTaskAwait = exclusiveVideoTask.indexOf("await ", exclusiveTaskStart);
assert.notEqual(exclusiveTaskStart, -1, "video upload must provide an exclusive async task");
assert.equal(
  firstExclusiveTaskAwait,
  exclusiveVideoTask.indexOf("await this.getVideoFileInfo(originalPath)", exclusiveTaskStart),
  "video metadata preprocessing must be the first await inside the exclusive task"
);
assertOrdered(
  exclusiveVideoTask,
  [
    "await runExclusiveAlbumMediaTask({",
    "isBusy: () => this.albumBusy",
    "setBusy:",
    "task: async () => {",
    'this.statusText = "正在处理视频...";',
    "await this.getVideoFileInfo(originalPath)"
  ],
  "exclusive album video preparation"
);
assert.doesNotMatch(uploadChosenVideo, /!confirmed\s*\|\|\s*this\.albumBusy/);
assert.doesNotMatch(uploadChosenVideo, /this\.uploading\s*=\s*(?:true|false)/);
assert.match(uploadChosenVideo, /if\s*\(!confirmed\)\s*\{/);
assert.match(
  uploadChosenVideo,
  /catch\s*\(error\)\s*\{[\s\S]*error\?\.userMessage\s*\|\|\s*"相册视频上传失败，请稍后重试。"/
);

assertAlbumMediaEntryContract(album);

assert.match(viewer, /:autoplay="false"/);
assert.match(viewer, /\$emit\(\s*["']video-error["']/);
assert.match(viewer, /视频加载失败，点击重试/);
assert.match(viewer, /retry:\s*true/);
assert.match(album, /@video-error="handlePreviewVideoError"/);

const previewGuard = block(album, "canOpenPhotoPreview(photo) {", "async loadVisiblePhotoMedia");
assert.match(previewGuard, /canOpenAlbumMediaPreview/);
const previewOpen = block(album, "openPhotoPreview(photo) {", "closePhotoPreview() {");
assert.match(
  previewOpen,
  /!this\.timelineMode\s*\|\|\s*item\.media_type\s*(?:===\s*["']image["']|!==\s*["']video["'])/
);
assert.equal((album.match(/!timelineMode\s*&&\s*videoReady\(photo\)/g) || []).length, 2);
assert.match(block(album, "previewPhoto(photo) {", "viewerPhotoWithCachedMedia"), /打开小程序查看视频/);

const videoUrlRequest = block(album, "loadPreviewVideoUrl(photo", "handlePreviewDownload(event) {");
assert.match(videoUrlRequest, /canReuseVideoUrl/);
assert.match(videoUrlRequest, /videoUrlExpiresAt\(data\.expiresInSeconds/);
assert.doesNotMatch(videoUrlRequest, /this\.photos\s*=/);

const mediaContext = block(album, "albumMediaDownloadContext(photo", "writeAlbumMediaFile");
assert.match(mediaContext, /shouldAttachApiAuthorization\(imageUrl,\s*getApiBaseUrl\(\)\)/);

assert.match(
  viewer,
  /v-if="isActiveVideo\(logicalIndexForWindowIndex\(windowIndex\)\) && videoUrl\(photo\)"/
);
assert.match(
  viewer,
  /:id="videoDomId\(photo,\s*logicalIndexForWindowIndex\(windowIndex\)\)"/
);

console.log("D42 mini-program integration checks passed: upload, viewer, timeline, and auth boundaries");
