import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`D50 required file is missing: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function methodBlock(source, name, nextName) {
  const findMethodStart = (methodName, fromIndex = 0) => {
    const expression = new RegExp(`^\\s{2,}(?:async\\s+)?${methodName}\\(`, "m");
    const match = source.slice(fromIndex).match(expression);
    return match?.index === undefined ? -1 : fromIndex + match.index;
  };
  const start = findMethodStart(name);
  assert(start >= 0, `D50 source method is missing: ${name}`);
  const end = nextName ? findMethodStart(nextName, start + name.length) : -1;
  assert(end > start, `D50 source method boundary is missing after: ${name}`);
  return source.slice(start, end);
}

function assertOrdered(source, tokens, label) {
  let cursor = -1;
  for (const token of tokens) {
    const index = source.indexOf(token, cursor + 1);
    assert(index >= 0, `${label} is missing or out of order: ${token}`);
    cursor = index;
  }
}

const requirements = read("specs/d50-album-single-media-sharing/requirements.md");
const design = read("specs/d50-album-single-media-sharing/design.md");
const tasks = read("specs/d50-album-single-media-sharing/tasks.md");
const spec = `${requirements}\n${design}`;

for (const token of ["最多 30", "最多 3", "Range", "查看完整相册"]) {
  assert(spec.includes(token), `D50 spec must define: ${token}`);
}

for (const nonGoal of [
  "不新增数据库表或新的小程序页面路由。",
  "不直接分享原始图片/视频文件，不开放公开下载。",
  "不新增评论、点赞、收藏、报名、角色认领或公开广场。",
  "不新增分享奖励、诱导分享、传播排名或新的 analytics 管线。",
  "不改变现有整册好友/群分享与朋友圈分享语义。",
  "不新增视频转码、播放器或额外自动重试。",
  "不重构无关相册布局、上传、标注、瀑布流或 viewer windowing。"
]) {
  assert(requirements.includes(nonGoal), `D50 requirements must retain non-goal: ${nonGoal}`);
}

assert(tasks.includes("D50.2"), "D50 tasks must retain the red-light contract phase");

const service = read("apps/api/src/modules/core/service.js");
assert(
  service.includes("ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE"),
  "D50 service must reject an unavailable focused media item with ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE"
);

const server = read("apps/api/src/server.js");
for (const token of [
  "focusMediaId",
  "focus_media_id",
  "/api/session-album/public-share/media/${mediaId}/video-url",
  "/api/session-album/public-share/media/${mediaId}/video-file",
  "session-album-public-video-file"
]) {
  assert(server.includes(token), `D50 server contract is missing: ${token}`);
}

const albumPage = read("apps/miniprogram/src/pages/session/album.vue");
const shareHelper = read("apps/miniprogram/src/utils/albumSingleMediaShare.js");
const shareEntryHelper = read("apps/miniprogram/src/utils/albumShareEntry.js");
for (const helperName of [
  "singleMediaShareRouteState",
  "focusedPublicSnapshotProjection",
  "singleMediaShareCardImage",
  "singleMediaShareReadyPayload",
  "createFocusedPublicVideoRequestContext",
  "isFocusedPublicVideoRequestCurrent"
]) {
  assert(shareHelper.includes(`export function ${helperName}`), `D50 helper must export: ${helperName}`);
}
assert(
  shareHelper.includes('source === "single_media_share"'),
  'D50 route helper must enable focused public mode only for source === "single_media_share"'
);
assert(
  albumPage.includes("focusedPublicMode ? '查看完整相册' : ''"),
  "D50 album page must pass the focused-mode 查看完整相册 primary action"
);

const senderPreparation = methodBlock(albumPage, "prepareSingleMediaShare", "showFullPublicAlbum");
assertOrdered(
  senderPreparation,
  [
    "const mediaId = normalizeFocusedMediaId(photo?.id);",
    "const cachedEntry = this.singleMediaShareAuthority.entryFor(mediaId);",
    "const shareRequest = this.singleMediaShareAuthority.begin(mediaId);",
    "url: `/api/sessions/${this.sessionId}/album/share-token`,",
    'method: "POST",',
    "focusMediaId: mediaId,",
    "includeOwnedUntaggedImages: true",
    "normalizeFocusedMediaId(data.focus_media_id) !== mediaId",
    "singleMediaSharePath({",
    "this.singleMediaShareAuthority.resolve(shareRequest,",
    "this.singleMediaShareAuthority.reject(shareRequest, error)"
  ],
  "D50 sender must request and resolve an exact focused-media snapshot"
);
assert(
  senderPreparation.includes("!this.isSingleMediaShareEligible(photo)"),
  "D50 sender must fail closed before requesting an ineligible media item"
);
assertOrdered(
  senderPreparation,
  [
    "const imageUrl = this.isImageMedia(photo)",
    '? ""',
    ": await this.prepareSingleMediaShareCardImage(photo);",
    "...(imageUrl ? { imageUrl } : {})"
  ],
  "D50 photos must skip explicit cover preparation while videos retain their cover"
);
assert(
  !senderPreparation.includes("force") &&
    !senderPreparation.includes("showModal("),
  "D50 disabled non-ready share states must not expose a click-driven retry path"
);

const shareCallback = methodBlock(albumPage, "onShareAppMessage", "onShareTimeline");
assertOrdered(
  shareEntryHelper,
  [
    'const isButton = options?.from === "button";',
    "const dataset = options?.target?.dataset || {};",
    "if (isButton && dataset.albumShare === ALBUM_SHARE_INTENT.RECRUIT)",
    "if (isButton && dataset.albumShare === ALBUM_SHARE_INTENT.ACTIVE)",
    "const mediaId = isButton ? normalizePositiveInteger(dataset.mediaId) : null;",
    "return { kind: ALBUM_SHARE_INTENT.SINGLE, mediaId };",
    "if (isButton) return { kind: ALBUM_SHARE_INTENT.UNKNOWN };"
  ],
  "D50 native button source routing must preserve recruit/active priority, then resolve only an exact media dataset"
);
assertOrdered(
  shareCallback,
  [
    "const intent = albumShareAppMessageIntent(options,",
    "if (intent.kind === ALBUM_SHARE_INTENT.SINGLE)",
    "this.singleMediaShareAuthority.entryFor(intent.mediaId)",
    "singleMediaShareReadyPayload(entry, this.albumShareTitle())",
    "if (payload)",
    "return payload"
  ],
  "D50 native single-media share must read the exact routed dataset entry and build a media-aware payload"
);
assert(
  !shareCallback.includes("previewCurrentIndex"),
  "D50 native button share must not derive its entry from the live preview index"
);
assert(
  shareCallback.includes("return singleMediaShareFailClosedPayload();"),
  "D50 stale or invalid button datasets must return a credential-free fail-closed payload"
);
const pageShareStart = shareCallback.indexOf("if (intent.kind === ALBUM_SHARE_INTENT.DEFAULT_ALL)");
assert(pageShareStart > 0, "D50 page-menu sharing boundary must follow native button handling");
const buttonShareCallback = shareCallback.slice(0, pageShareStart);
assert(
  !buttonShareCallback.includes("return {}") && !buttonShareCallback.includes("albumShareToken"),
  "D50 invalid button sharing must not fall back to page sharing or expose a snapshot token"
);
assert(
  buttonShareCallback.includes("singleMediaShareReadyPayload") &&
    !buttonShareCallback.includes("entry.imageUrl"),
  "D50 button sharing must delegate photo omission and video cover preservation to the payload helper"
);

const publicLoad = methodBlock(albumPage, "loadPublicAlbum", "normalizeAlbumMediaUrl");
assertOrdered(
  publicLoad,
  [
    "this.singleMediaShareRequested",
    "this.publicAlbumSnapshotLoaded = false;",
    "this.photos = (data.photos || []).map((photo) => this.normalizePhotoMedia(photo));",
    "const focusedSnapshot = focusedPublicSnapshotProjection(this.photos, this.focusMediaId);",
    "this.previewPhotos = focusedSnapshot.photos.map((photo) => this.viewerPhotoWithCachedMedia(photo));",
    "this.previewCurrentIndex = 0;",
    "this.previewInitialIndex = 0;",
    "this.previewOverlayVisible = true;"
  ],
  "D50 focused public mode must commit the snapshot then open exactly the focused item"
);
assert(
  publicLoad.includes("this.focusedPublicMediaUnavailable = this.singleMediaShareRequested;") &&
    publicLoad.includes('? "该内容已不可查看"'),
  "D50 tokenless focused routes must close without loading a public or member snapshot"
);
const onLoad = methodBlock(albumPage, "onLoad", "onShow");
assertOrdered(
  onLoad,
  [
    "const routeState = singleMediaShareRouteState(options);",
    "this.timelineMode = routeState.timelineMode;",
    "if (this.timelineMode)",
    "await this.loadPublicAlbum();",
    "return;",
    "ensureLoggedIn"
  ],
  "D50 tokenless single-media routes must stay public and never enter member authentication"
);
assert(
  publicLoad.includes('this.statusText = "该内容已不可查看";') &&
    publicLoad.includes("this.focusedPublicMediaUnavailable = true;"),
  "D50 missing focused media must close without selecting another snapshot item"
);
assert(
  albumPage.includes('v-else-if="!focusedPublicMediaUnavailable"') &&
    albumPage.includes('v-if="focusedPublicMediaUnavailable && publicAlbumSnapshotLoaded"'),
  "D50 unavailable focus must hide the snapshot waterfall until the explicit full-album CTA"
);
const closePreview = methodBlock(albumPage, "closePhotoPreview", "resetPreviewVideoViewerState");
assertOrdered(
  closePreview,
  ["if (this.focusedPublicMode)", "this.showFullPublicAlbum();", "return;"],
  "D50 focused viewer close must explicitly reveal the already-loaded full snapshot"
);
const showFullAlbum = methodBlock(albumPage, "showFullPublicAlbum", "albumTimelineQuery");
assert(
  !showFullAlbum.includes("request(") && !showFullAlbum.includes("ensureLoggedIn"),
  "D50 full-album CTA must reveal the loaded snapshot without request or authentication"
);
assertOrdered(
  showFullAlbum,
  ["this.focusedPublicMode = false;", "this.previewVideoUrlRequests = {};", "this.refreshWaterfall();"],
  "D50 full-album CTA must deactivate focused state and clear the video request projection"
);

const shareCardPreparation = methodBlock(albumPage, "prepareSingleMediaShareCardImage", "prepareSingleMediaShare");
assert(
  shareCardPreparation.includes("singleMediaShareCardImage(await this.prepareShareCoverUrl(source))"),
  "D50 share cards must use the same-media image or the explicit safe fallback"
);

const publicVideo = methodBlock(albumPage, "loadPreviewVideoUrl", "handlePreviewDownload");
assertOrdered(
  publicVideo,
  [
    "this.focusedPublicMode",
    "createFocusedPublicVideoRequestContext({",
    "isFocusedPublicVideoRequestCurrent(focusedPublicVideoRequest",
    "/api/session-album/public-share/media/${photo.id}/video-url",
    "token: this.albumShareToken",
    "!focusedPublicVideoRequestIsCurrent()"
  ],
  "D50 focused public video must use the public capability endpoint and same token"
);

const viewer = read("apps/miniprogram/src/components/AlbumImageViewer.vue");
assert(
  viewer.includes('open-type="share"'),
  "D50 album viewer must render a native open-type=share button"
);
assert(
  (viewer.match(/src="\/static\/icons\/share-light\.svg"/g) || []).length === 2 &&
    viewer.includes("album-image-viewer__share-icon") &&
    viewer.includes('class="album-image-viewer__icon-button album-image-viewer__icon-button--disabled"') &&
    viewer.includes('aria-disabled="true"') &&
    !viewer.includes("share-status-tap") &&
    !viewer.includes('"准备中"') &&
    !viewer.includes('"不可分享"') &&
    !viewer.includes('"重试分享"'),
  "D50 non-ready viewer share states must use one gray glyph without any interaction"
);
assertOrdered(
  viewer,
  [
    "shareStatus:",
    'default: "hidden"',
    "showCounter:",
    "primaryActionLabel:"
  ],
  "D50 viewer must expose presentational share and focused-mode props"
);
assertOrdered(
  viewer,
  [
    'v-if="showCounter"',
    'v-if="shareStatus === \'ready\' && currentPhoto"',
    'open-type="share"',
    ':data-media-id="currentPhoto.id"',
    'v-else-if="shareStatus !== \'hidden\' && currentPhoto"',
    'v-if="primaryActionLabel"',
    'primary-action'
  ],
  "D50 viewer must keep native sharing exclusive to an exact ready item and emit non-native status/CTA events"
);
assert(
  !viewer.includes("share-token") && !viewer.includes("albumShareToken"),
  "D50 viewer must remain presentational and must not own share tokens"
);
const previewShareStatusStart = albumPage.indexOf("previewShareStatus()");
const previewShareStatusBlock = albumPage.slice(
  previewShareStatusStart,
  albumPage.indexOf("previewMediaProgress()", previewShareStatusStart)
);
assert(
  previewShareStatusStart >= 0 &&
    previewShareStatusBlock.includes('if (!this.isSingleMediaShareEligible(this.previewCurrentPhoto))') &&
    previewShareStatusBlock.includes('return "blocked";') &&
    previewShareStatusBlock.includes("?.status ||") &&
    previewShareStatusBlock.includes('"loading"'),
  "D50 member previews must project ineligible media as blocked and pending eligible media as loading"
);
assert(
  !albumPage.includes('@share-status-tap="handleSingleMediaShareStatusTap"') &&
    !albumPage.includes("handleSingleMediaShareStatusTap(event)"),
  "D50 album page must not retain a click handler for disabled share states"
);
assert(
  viewer.includes(`:class="{ 'album-image-viewer__slide--with-primary-action': primaryActionLabel }"`) &&
    viewer.includes(".album-image-viewer__slide--with-primary-action .album-image-viewer__video-shell") &&
    viewer.includes("z-index: 8;") &&
    viewer.includes("bottom: calc(24rpx + env(safe-area-inset-bottom));"),
  "D50 focused CTA must reserve video controls space and layer above the viewer using safe-area spacing"
);

console.log("D50 album single-media sharing checks passed");
