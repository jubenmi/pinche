import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
let contractCount = 0;

function read(relativePath) {
  const target = path.join(root, relativePath);
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
}

function contract(label, condition) {
  contractCount += 1;
  if (condition) {
    console.log(`PASS ${label}`);
  } else {
    failures.push(label);
    console.error(`FAIL ${label}`);
  }
}

export function canAllowD42Red(moduleExists) {
  return !moduleExists.apiMedia && !moduleExists.miniAlbumVideo && !moduleExists.adminAlbumMedia;
}

function verifyAllowRedPolicy() {
  const absent = { apiMedia: false, miniAlbumVideo: false, adminAlbumMedia: false };
  if (!canAllowD42Red(absent)) throw new Error("D42 --allow-red must work while all future modules are absent");
  for (const moduleName of Object.keys(absent)) {
    if (canAllowD42Red({ ...absent, [moduleName]: true })) {
      throw new Error(`D42 --allow-red must stop once ${moduleName} exists`);
    }
  }
}

verifyAllowRedPolicy();

function block(source, start, end) {
  const from = source.indexOf(start);
  if (from < 0) return "";
  const to = end ? source.indexOf(end, from + start.length) : -1;
  return source.slice(from, to < 0 ? source.length : to);
}

const server = read("apps/api/src/server.js");
const apiMedia = read("apps/api/src/modules/album-video/media.js");
const albumPage = read("apps/miniprogram/src/pages/session/album.vue");
const viewer = read("apps/miniprogram/src/components/AlbumImageViewer.vue");
const adminApi = read("apps/admin-web/src/api.js");
const adminMedia = read("apps/admin-web/src/albumMedia.js");
const adminWorkspace = read("apps/admin-web/src/components/SessionAlbumWorkspace.vue");
const adminLazyImage = read("apps/admin-web/src/components/AuthorizedLazyImage.vue");
const futureModules = {
  apiMedia: fs.existsSync(path.join(root, "apps/api/src/modules/album-video/media.js")),
  miniAlbumVideo: fs.existsSync(path.join(root, "apps/miniprogram/src/utils/albumVideo.js")),
  adminAlbumMedia: fs.existsSync(path.join(root, "apps/admin-web/src/albumMedia.js"))
};

contract(
  "viewer explicitly disables autoplay",
  viewer.includes(':autoplay="false"')
);

const viewerVideoTemplate = block(viewer, '<view v-if="isVideo(photo)"', "</swiper-item>");
const viewerVideoErrorHandler = block(viewer, "handleVideoError(photo) {", "showVideoLoading(photo) {");
const viewerVideoRetryHandler =
  block(viewer, "retryVideo(photo) {", "requestCurrentVideoIfNeeded() {") ||
  block(viewer, "handleVideoRetry(photo) {", "requestCurrentVideoIfNeeded() {");
const viewerBinding = block(albumPage, "<AlbumImageViewer", "/>");
const pageVideoErrorHandler = block(albumPage, "handlePreviewVideoError(event) {", "handlePreviewVideoRequest(event) {");
contract(
  "viewer emits video-error and the album page owns refresh/retry",
  /\$emit\(\s*["']video-error["']/.test(viewerVideoErrorHandler) &&
    /@video-error\s*=\s*["']handlePreviewVideoError["']/.test(viewerBinding) &&
    /video_display_url|videoUrl/.test(pageVideoErrorHandler) &&
    /loadPreviewVideoUrl|handlePreviewVideoRequest/.test(pageVideoErrorHandler) &&
    /@tap(?:\.stop)?\s*=\s*["'](?:retryVideo|handleVideoRetry)\(photo\)["']/.test(viewerVideoTemplate) &&
    /\$emit\(\s*["']need-video["']/.test(viewerVideoRetryHandler)
);

const timelinePreview = block(albumPage, "canOpenPhotoPreview(photo) {", "async loadVisiblePhotoMedia");
contract(
  "timeline preview guard denies video before opening the viewer",
  /timelineMode/.test(timelinePreview) &&
    /media_type\s*===\s*["']video["']/.test(timelinePreview) &&
    /false/.test(timelinePreview) &&
    /打开小程序查看视频/.test(albumPage)
);

const videoRoute = block(server, "const adminSessionAlbumVideosId", "const sessionAlbumPhotoId");
const inspectMatch = videoRoute.match(/inspect(?:Session)?AlbumVideoObject/);
const createIndex = videoRoute.search(/const video\s*=\s*await createSessionAlbumVideo/);
contract(
  "server inspects the uploaded object before creating a video record",
  Boolean(inspectMatch) && inspectMatch.index < createIndex
);

const localResponder = block(server, "async function serveUploadedSessionAlbumVideoFile", "async function getSessionAlbumDisplayMetadata");
contract(
  "local video responder has explicit Range 206 and 416 paths",
  /createLocalAlbumVideoResponse/.test(localResponder) &&
    /range/.test(localResponder) &&
    /statusCode:\s*206/.test(apiMedia) &&
    /statusCode:\s*416/.test(apiMedia) &&
    /content-range/i.test(apiMedia)
);

const snapshotFunctions = block(server, "function signedAlbumVideoSnapshotUrl", "function stripAlbumVideoInternalFields");
contract(
  "local mode does not use a snapshot query as a video cover",
  Boolean(snapshotFunctions) &&
    (snapshotFunctions.match(/if \(!isCosUploadStorageEnabled\(\)\)\s*\{\s*return "";/g) || [])
      .length === 2 &&
    !/sessionAlbum(?:Public)?Video(?:Cover|File)Path/.test(snapshotFunctions)
);

const previewVideo = block(adminWorkspace, "async function previewVideo(photo)", "async function previewPhoto(photo)");
const previewPhoto = block(adminWorkspace, "async function previewPhoto(photo)", "function resetBulkSelection");
const openTagDrawer = block(adminWorkspace, "async function openTagDrawer(photo)", "function toggleBulkSelectionMode");
const uploadFiles = block(adminWorkspace, "async function uploadFiles(files)", "function previewMedia(photo)");
const saveTags = block(adminWorkspace, "async function saveTags()", "async function openPrivacyDrawer()");
const openPrivacyDrawer = block(adminWorkspace, "async function openPrivacyDrawer()", "function closePrivacyDrawer()");
const savePrivacy = block(adminWorkspace, "async function savePrivacy()", "async function deletePhoto(photo)");
const deletePhoto = block(adminWorkspace, "async function deletePhoto(photo)", "function albumCommandStickyTop()");
const loadSelectedSession = block(adminWorkspace, "async function loadSelectedSession()", "async function loadAlbum(options = {})");
const loadAlbum = block(adminWorkspace, "async function loadAlbum(options = {})", "function revokeAlbumMedia()");
const closeTagDrawer = block(adminWorkspace, "function closeTagDrawer()", "function toggleTag(key)");
const unmountHandler = block(adminWorkspace, "onBeforeUnmount(() => {", "});\n</script>");
const refreshAlbumMedia = block(
  adminWorkspace,
  "async function refreshAlbumMedia(photo, failedUrl)",
  "async function fetchAdminMediaWithRetry(photo, url)"
);
const mediaRetry = block(adminWorkspace, "async function fetchAdminMediaWithRetry(photo, url)", "async function handleVideoCoverError");
const coverFailure = block(adminWorkspace, "async function handleVideoCoverError(photo, event)", "function rerenderAlbumWaterfall()");
contract(
  "single-media preview and tag failures stay out of albumError",
  Boolean(previewVideo && previewPhoto && openTagDrawer) &&
    !/albumError\.value/.test(previewVideo) &&
    !/albumError\.value/.test(previewPhoto) &&
    !/albumError\.value/.test(openTagDrawer)
);

contract(
  "admin media authorization is selected by exact origin",
  /shouldAttachAdminAuthorization|adminAlbumMediaRequestHeaders/.test(adminMedia) &&
    /fetchAuthorizedMediaObjectUrl/.test(adminApi)
);

contract(
  "tag preview uses a request serial and rejects stale responses",
  (() => {
    const awaitIndex = openTagDrawer.indexOf("await ensurePreviewMedia(photo)");
    const taggingIndex = openTagDrawer.indexOf("taggingPhoto.value", awaitIndex);
    const beforeAwait = awaitIndex >= 0 ? openTagDrawer.slice(0, awaitIndex) : "";
    const afterAwaitBeforeCommit =
      awaitIndex >= 0 && taggingIndex > awaitIndex
        ? openTagDrawer.slice(awaitIndex, taggingIndex)
        : "";
    return /\.next\(\)/.test(beforeAwait) && /\.isCurrent\(/.test(afterAwaitBeforeCommit);
  })()
);

contract(
  "admin cover errors report status and refresh one fresh media URL",
  /defineEmits\(\["loaded", "error"\]\)/.test(adminLazyImage) &&
    /emit\(\s*["']error["']\s*,\s*\{\s*status:/.test(adminLazyImage) &&
    /@error="handleVideoCoverError\(photo, \$event\)"/.test(adminWorkspace) &&
    /\[401, 403\]/.test(coverFailure) &&
    /refreshAlbumMedia\(photo,/.test(coverFailure) &&
    /(?:getSessionAlbum\(|albumRefreshController\?\.refresh\(\))/.test(refreshAlbumMedia) &&
    /mediaRefreshAttempts/.test(refreshAlbumMedia) &&
    /fetchAuthorizedMediaObjectUrl\(url\)/.test(mediaRetry) &&
    /fetchAuthorizedMediaObjectUrl\(refreshedUrl\)/.test(mediaRetry) &&
    !/for\s*\(/.test(mediaRetry)
);

contract(
  "tag request serial is invalidated on close, reload, session switch, and unmount",
  /tagPreviewSerial\.invalidate\(\)/.test(closeTagDrawer) &&
    /tagPreviewSerial\.invalidate\(\)/.test(loadSelectedSession) &&
    /tagPreviewSerial\.invalidate\(\)/.test(loadAlbum) &&
    /tagPreviewSerial\.invalidate\(\)/.test(unmountHandler)
);

contract(
  "operation failures remain local while only the main album load uses albumError",
  [uploadFiles, saveTags, openPrivacyDrawer, savePrivacy, deletePhoto].every(
    (source) => Boolean(source) && !/albumError\.value/.test(source)
  ) &&
    /fatal/.test(loadAlbum) &&
    /loadAlbum\(\{ fatal: false \}\)/.test(uploadFiles) &&
    /loadAlbum\(\{ fatal: false \}\)/.test(savePrivacy) &&
    /loadAlbum\(\{ fatal: false \}\)/.test(deletePhoto)
);

if (failures.length > 0) {
  console.error(`D42 static RED checks failed: ${failures.length}/${contractCount}`);
  if (process.argv.includes("--allow-red") && canAllowD42Red(futureModules)) {
    console.log("D42 static RED is allowed during the implementation phase");
  } else {
    if (process.argv.includes("--allow-red") && !canAllowD42Red(futureModules)) {
      console.error("D42 --allow-red is disabled once any future implementation module exists");
    }
    process.exitCode = 1;
  }
} else {
  console.log(`D42 static checks passed: ${contractCount}/${contractCount}`);
}
