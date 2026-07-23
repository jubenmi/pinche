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
    ["openRecruitment", "招募", "album-recruit.svg"]
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

test("active album sharing is request-guarded and prepares independent dual covers", () => {
  const prepareBlock = sourceBlock(
    "async prepareAlbumShareSnapshot(payload) {",
    "openBulkTagSheet() {"
  );
  assert.match(prepareBlock, /beginAlbumShareSnapshotRequest\(\)/);
  assert.match(prepareBlock, /isCurrentAlbumShareSnapshotRequest\(shareRequest\)/);
  assert.match(prepareBlock, /installActiveAlbumShareSnapshot/);
  assert.match(prepareBlock, /cancelSelectionMode\(\{ force: true, preserveActiveShare: true \}\)/);
  assert.match(prepareBlock, /startAlbumShareCoverPreparation\(\{/);
  assert.match(prepareBlock, /applyActiveAlbumShareCover\(kind, imageUrl\)/);
  assert.match(prepareBlock, /await Promise\.all\(coverTasks\)/);

  assert.match(albumPageSource, /activeAlbumShareFriendCoverUrl/);
  assert.match(albumPageSource, /activeAlbumShareTimelineCoverUrl/);
  assert.match(albumPageSource, /activeAlbumShareFriendCoverPrepared/);
  assert.match(albumPageSource, /activeAlbumShareTimelineCoverPrepared/);
  assert.match(albumPageSource, /albumFriendShareImage\(\)/);
  assert.match(albumPageSource, /albumTimelineShareImage\(\)/);
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
  assert.match(shareAppMessageBlock, /dataset\?\.albumShare === "active"/);
  assert.match(shareAppMessageBlock, /activeAlbumSharePayload\(\)/);

  const shareMenuBlock = sourceBlock(
    "showShareMenus() {",
    "async prepareShareCoverUrl"
  );
  assert.match(shareMenuBlock, /this\.timelineMode\s*\?\s*this\.albumShareToken\s*:\s*this\.activeAlbumShareToken/);
  assert.match(shareMenuBlock, /this\.shareFriendCoverPrepared\s*:\s*this\.activeAlbumShareFriendCoverPrepared/);
  assert.match(shareMenuBlock, /this\.shareTimelineCoverPrepared\s*:\s*this\.activeAlbumShareTimelineCoverPrepared/);
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
