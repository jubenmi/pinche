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

const uploadCosObject = block(api, "async function uploadCosObject", "async function uploadCosBackedFile");
assert.match(uploadCosObject, /Headers:\s*upload\.headers\s*\|\|\s*\{\}/);
assert.doesNotMatch(uploadCosObject, /Authorization|Bearer/);

const uploadCosBackedFile = block(api, "async function uploadCosBackedFile", "function uploadBackendFile");
assert.match(uploadCosBackedFile, /getLocalFileSize\(filePath\)/);
assert.match(uploadCosBackedFile, /localFileSize\s*>\s*maxBytes/);
assert.match(uploadCosBackedFile, /if\s*\(!localFileSize\)[\s\S]*fallbackUpload\(filePath\)/);
assert.ok(
  uploadCosBackedFile.indexOf("requestCosUploadIntent") < uploadCosBackedFile.indexOf("getLocalFileSize(filePath)"),
  "the direct-upload size must be re-read after the server returns its intent"
);
assert.ok(
  uploadCosBackedFile.indexOf("localFileSize > 0") < uploadCosBackedFile.indexOf("uploadCosObject"),
  "the direct PUT must happen only after the authoritative size gate"
);

const compressVideo = block(album, "async compressVideoBeforeUpload", "shouldCompressVideoBeforeUpload");
assert.match(compressVideo, /compressVideoSizeBytes\(result\.size\)/);
assert.match(album, /if\s*\(!uploadSize\)[\s\S]*无法确认视频大小/);
assert.doesNotMatch(block(album, "async uploadChosenVideo", "async uploadChosenPhotos"), /Math\.max\(1,/);

assert.equal((album.match(/@tap="chooseAlbumMedia"/g) || []).length, 2);
assert.doesNotMatch(album, /@tap="chooseVideo"|album-video-upload-action|album-primary-actions\.has-video/);
const chooseAlbumMedia = block(album, "chooseAlbumMedia() {", "choosePhotos() {");
assert.match(chooseAlbumMedia, /this\.canUploadVideo/);
assert.match(chooseAlbumMedia, /mediaType:\s*\["image",\s*"video"\]/);
assert.match(chooseAlbumMedia, /classifyAlbumMediaSelection/);
assert.match(chooseAlbumMedia, /this\.uploadChosenPhotos\(selection\.paths\)/);
assert.match(chooseAlbumMedia, /this\.uploadChosenVideo\(selection\.file\)/);

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

console.log("D42 mini-program integration checks passed: upload, viewer, timeline, and auth boundaries");
