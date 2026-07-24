import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const albumPageSource = await readFile(
  new URL("../src/pages/session/album.vue", import.meta.url),
  "utf8"
);

function sourceBlock(startMarker, endMarker) {
  const start = albumPageSource.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = albumPageSource.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return albumPageSource.slice(start, end);
}

test("member page exposes the four compact actions and removes the preview step", () => {
  for (const [handler, label, icon] of [
    ["openShareSelectionMode", "分享", "album-share.svg"],
    ["openDownloadSelectionMode", "下载", "album-download.svg"],
    ["openTagSelectionMode", "标注", "album-tag-white.svg"],
    ["handleRecruitShareTap", "招募", "album-recruit.svg"]
  ]) {
    assert.match(albumPageSource, new RegExp(`@tap="${handler}"`));
    assert.match(albumPageSource, new RegExp(`>${label}<`));
    assert.match(albumPageSource, new RegExp(icon.replace(".", "\\.")));
  }

  assert.doesNotMatch(albumPageSource, /预览并分享/);
  assert.doesNotMatch(albumPageSource, /prepareAlbumSharePreview/);
  assert.doesNotMatch(albumPageSource, /sharePreviewMode/);
  assert.doesNotMatch(albumPageSource, /normalizeAlbumShareSelection/);
});

test("share enters an empty batch selection and offers all or selected", () => {
  const openShareBlock = sourceBlock(
    "openShareSelectionMode() {",
    "openTagSelectionMode() {"
  );
  assert.match(openShareBlock, /this\.selectionMode = true/);
  assert.match(openShareBlock, /this\.selectionModePurpose = "share"/);
  assert.match(openShareBlock, /this\.selectedPhotoIds = \[\]/);

  assert.match(albumPageSource, /selectionModePurpose === 'share'/);
  assert.match(albumPageSource, /@tap="shareAllAlbumMedia"/);
  assert.match(albumPageSource, /分享全部（\{\{ shareSelectableMedia\.length \}\}）/);
  assert.match(albumPageSource, /@tap="shareSelectedAlbumMedia"/);
  assert.match(albumPageSource, /分享选中（\{\{ selectedPhotoCount \}\}）/);

  const shareAllBlock = sourceBlock(
    "async shareAllAlbumMedia() {",
    "async shareSelectedAlbumMedia() {"
  );
  assert.match(shareAllBlock, /prepareAlbumShareSnapshot\(\{ scope: "all" \}\)/);

  const shareSelectedBlock = sourceBlock(
    "async shareSelectedAlbumMedia() {",
    "async prepareAlbumShareSnapshot(payload) {"
  );
  assert.match(shareSelectedBlock, /const mediaIds = \[\.\.\.this\.selectedPhotoIds\]/);
  assert.match(shareSelectedBlock, /prepareAlbumShareSnapshot\(\{ mediaIds \}\)/);
  assert.doesNotMatch(shareSelectedBlock, /30|3\s*(?:个|项|条|部|videos?)/i);
});

test("download uses the same empty batch-selection pattern with two actions", () => {
  const openDownloadBlock = sourceBlock(
    "openDownloadSelectionMode() {",
    "openShareSelectionMode() {"
  );
  assert.match(openDownloadBlock, /this\.selectionMode = true/);
  assert.match(openDownloadBlock, /this\.selectionModePurpose = "download"/);
  assert.match(openDownloadBlock, /this\.selectedPhotoIds = \[\]/);

  assert.match(albumPageSource, /selectionModePurpose === 'download'/);
  assert.match(albumPageSource, /@tap="downloadAllPhotos"/);
  assert.match(albumPageSource, /下载全部（\{\{ downloadablePhotos\.length \}\}）/);
  assert.match(albumPageSource, /@tap="downloadSelectedPhotos"/);
  assert.match(albumPageSource, /下载选中（\{\{ selectedPhotoCount \}\}）/);
});

test("active album sharing is request-guarded and only prepares its timeline cover", () => {
  const prepareBlock = sourceBlock(
    "async prepareAlbumShareSnapshot(payload) {",
    "openBulkTagSheet() {"
  );
  const installSnapshotBlock = sourceBlock(
    "installActiveAlbumShareSnapshot(data, { token, scope }) {",
    "installDefaultAlbumShareSnapshot(data, token) {"
  );
  assert.match(prepareBlock, /beginAlbumShareSnapshotRequest\(\)/);
  assert.match(prepareBlock, /isCurrentAlbumShareSnapshotRequest\(shareRequest\)/);
  assert.match(prepareBlock, /installActiveAlbumShareSnapshot/);
  assert.match(prepareBlock, /cancelSelectionMode\(\{ force: true, preserveActiveShare: true \}\)/);
  assert.match(prepareBlock, /startAlbumShareCoverPreparation\(\{/);
  assert.match(prepareBlock, /kinds:\s*\[\s*"timeline"\s*\]/);
  assert.match(prepareBlock, /albumShareLocalPreviewByRecipe\(data\.cover_recipe\)/);
  assert.match(
    prepareBlock,
    /prepareAlbumShareCanvasCover\(\{\s*kind,\s*token,\s*data,\s*localPreviewByMediaId/
  );
  assert.match(prepareBlock, /applyActiveAlbumShareCover\(kind, imageUrl\)/);
  assert.match(prepareBlock, /await Promise\.all\(coverTasks\)/);
  assert.doesNotMatch(prepareBlock, /ALBUM_PUBLIC_SHARE_COVER_UNAVAILABLE/);
  assert.doesNotMatch(prepareBlock, /remoteUrl|cover_url|timeline_cover_url|friend_cover_url/);
  assert.match(installSnapshotBlock, /this\.albumShareReadyVisible\s*=\s*true/);

  const localMapIndex = prepareBlock.indexOf(
    "const localPreviewByMediaId = this.albumShareLocalPreviewByRecipe(data.cover_recipe)"
  );
  const coverTasksIndex = prepareBlock.indexOf("startAlbumShareCoverPreparation({");
  assert.ok(localMapIndex >= 0 && localMapIndex < coverTasksIndex);

  assert.match(albumPageSource, /activeAlbumShareFriendCoverUrl/);
  assert.match(albumPageSource, /activeAlbumShareTimelineCoverUrl/);
  assert.match(albumPageSource, /activeAlbumShareFriendCoverPrepared/);
  assert.match(albumPageSource, /activeAlbumShareTimelineCoverPrepared/);
  assert.match(albumPageSource, /albumFriendShareImage\(\)/);
  assert.match(albumPageSource, /albumTimelineShareImage\(\)/);
});

test("member and public sharing use two hidden renderable 2d Canvas nodes", () => {
  assert.match(
    albumPageSource,
    /<canvas[\s\S]*id="album-share-friend-canvas"[\s\S]*type="2d"/
  );
  assert.match(
    albumPageSource,
    /<canvas[\s\S]*id="album-share-timeline-canvas"[\s\S]*type="2d"/
  );
  assert.match(albumPageSource, /createAlbumShareCanvasPreparation/);
  assert.match(albumPageSource, /createAlbumShareCanvasRuntime/);
  assert.match(albumPageSource, /releaseAlbumShareCanvasTempPath/);
  assert.match(albumPageSource, /albumShareLocalImagePath/);
  assert.match(albumPageSource, /class="album-share-canvas album-share-friend-canvas"/);
  assert.match(albumPageSource, /class="album-share-canvas album-share-timeline-canvas"/);
  assert.doesNotMatch(albumPageSource, /v-if="[^"]*"[^>]*album-share-(?:friend|timeline)-canvas/);
  assert.doesNotMatch(albumPageSource, /v-show="[^"]*"[^>]*album-share-(?:friend|timeline)-canvas/);
});

test("public timeline sharing prepares local Canvas covers from the current token and recipe", () => {
  const prepareBlock = sourceBlock(
    "prepareAlbumShareCovers(data) {",
    "resetAlbumShareCovers({"
  );
  assert.match(prepareBlock, /albumShareCoverContextKey/);
  assert.match(prepareBlock, /this\.albumShareToken/);
  assert.match(prepareBlock, /prepareAlbumShareCanvasCover\(\{/);
  assert.match(prepareBlock, /kinds:\s*\[\s*"timeline"\s*\]/);
  assert.match(prepareBlock, /isCurrentAlbumShareCanvasCoverPreparation\(context\)/);
  assert.match(albumPageSource, /albumShareCoverPreparationIsCurrent\(\{/);
  assert.doesNotMatch(
    prepareBlock,
    /isCurrentAlbumListRequest|remoteUrl|cover_url|timeline_cover_url|friend_cover_url/
  );

  const loadBlock = sourceBlock("async loadPublicAlbum() {", "resetPublicSharePagination() {");
  assert.match(loadBlock, /this\.prepareAlbumShareCovers\(data\)/);
  assert.doesNotMatch(loadBlock, /prepareAlbumShareCovers\(data,\s*\{\s*isCurrent/);

  const moreBlock = sourceBlock("async loadMorePublicAlbum() {", "normalizeAlbumMediaUrl(path)");
  assert.doesNotMatch(moreBlock, /resetAlbumShareCovers|prepareAlbumShareCovers/);
});

test("Canvas currentness follows share lifecycle and stale temp paths are disposed", () => {
  const clearActiveBlock = sourceBlock(
    "clearActiveAlbumShareState({ hideMenus = true, invalidateRequest = true } = {}) {",
    "closeAlbumShareReady() {"
  );
  assert.doesNotMatch(clearActiveBlock, /disposeAlbumShareCanvasPreparation\(\)/);

  const onHideBlock = sourceBlock("onHide() {", "onUnload() {");
  const onUnloadBlock = sourceBlock("onUnload() {", "onPageScroll(event) {");
  for (const lifecycleBlock of [onHideBlock, onUnloadBlock]) {
    assert.match(lifecycleBlock, /disposeAlbumShareCanvasPreparation\(\)/);
    assert.match(lifecycleBlock, /resetAlbumShareCovers/);
  }

  const refreshBlock = sourceBlock(
    "initializeAlbumMediaRefreshController() {",
    "async loadAlbum() {"
  );
  assert.doesNotMatch(refreshBlock, /resetAlbumShareCovers\(\)/);
  assert.match(refreshBlock, /this\.prepareAlbumShareCovers\(data\)/);
});

test("native share CTA appears only after the active snapshot is ready", () => {
  assert.match(albumPageSource, /v-if="!timelineMode && albumShareReadyVisible"/);
  assert.match(albumPageSource, /class="album-share-ready-button"/);
  assert.match(albumPageSource, /open-type="share"/);
  assert.match(albumPageSource, /data-album-share="active"/);

  const shareAppMessageBlock = sourceBlock(
    "onShareAppMessage(options) {",
    "onShareTimeline() {"
  );
  assert.match(shareAppMessageBlock, /intent\.kind === ALBUM_SHARE_INTENT\.ACTIVE/);
  assert.match(shareAppMessageBlock, /activeAlbumSharePayload\(\)/);

  const shareMenuBlock = sourceBlock(
    "showShareMenus() {",
    "async prepareShareCoverUrl"
  );
  assert.match(shareMenuBlock, /memberDefaultAlbumShareState\(\{/);
  assert.match(shareMenuBlock, /defaultAlbumShareToken:\s*this\.defaultAlbumShareToken/);
  assert.match(shareMenuBlock, /:\s*memberDefaultState\.token/);
  assert.doesNotMatch(shareMenuBlock, /friendReady|FriendCoverPrepared/);
  assert.match(shareMenuBlock, /:\s*memberDefaultState\.timelineReady/);
});

test("public album initial load is not invalidated by the first onShow refresh", () => {
  const onShowBlock = sourceBlock("async onShow()", "onHide()");
  const timelineBlock = onShowBlock.slice(
    onShowBlock.indexOf("if (this.timelineMode)"),
    onShowBlock.indexOf("const auth = getCurrentUser()")
  );

  assert.match(timelineBlock, /if \(this\.loadingAlbum\) \{\s*return;\s*\}/);
  assert.ok(
    timelineBlock.indexOf("if (this.loadingAlbum)") <
      timelineBlock.indexOf("await this.albumMediaRefresh?.refresh()")
  );
});

test("public shared albums keep cursor pagination, retry state, and bottom loading", () => {
  assert.match(albumPageSource, /publicShareNextCursor/);
  assert.match(albumPageSource, /publicShareLoadingMore/);
  assert.match(albumPageSource, /publicShareLoadMoreError/);
  assert.match(albumPageSource, /@tap="loadMorePublicAlbum">重试/);

  const reachBottomBlock = sourceBlock("onReachBottom() {", "onShareAppMessage(options) {");
  assert.match(reachBottomBlock, /if \(this\.timelineMode\)/);
  assert.match(reachBottomBlock, /this\.loadMorePublicAlbum\(\)/);

  const loadMoreBlock = sourceBlock(
    "async loadMorePublicAlbum() {",
    "normalizeAlbumMediaUrl(path)"
  );
  assert.match(loadMoreBlock, /publicAlbumSharePageUrl\(\{/);
  assert.match(loadMoreBlock, /mergePublicAlbumSharePages\(/);
  assert.match(loadMoreBlock, /this\.publicShareNextCursor = merged\.nextCursor/);
  assert.match(loadMoreBlock, /this\.publicShareHasMore = merged\.hasMore/);
  assert.match(loadMoreBlock, /this\.publicShareLoadMoreError = "继续加载失败，可重试。"/);
});

test("single-image sharing explicitly allows an owned untagged image and explains exposure", () => {
  const singleShareBlock = sourceBlock(
    "async prepareSingleMediaShare(photo",
    "handleSingleMediaShareStatusTap"
  );
  assert.match(singleShareBlock, /includeOwnedUntaggedImages: true/);
  assert.match(albumPageSource, /未标注，仅在你主动分享后公开/);
  assert.match(albumPageSource, /previewShowsOwnedUntaggedShareNote/);
});
