import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { albumShareLocalImagePath } from "../src/utils/albumShareCover.js";

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

function executablePrepareAlbumShareTimelineImage() {
  const block = sourceBlock(
    "async prepareAlbumShareTimelineImage(data) {",
    "resetAlbumShareCovers("
  );
  const bodyStart = block.indexOf("{") + 1;
  const bodyEnd = block.lastIndexOf("}");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const method = new AsyncFunction(
    "albumShareLocalImagePath",
    "data",
    block.slice(bodyStart, bodyEnd)
  );
  return function prepareAlbumShareTimelineImage(data) {
    return method.call(this, albumShareLocalImagePath, data);
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("member page exposes the four compact actions and removes the preview step", () => {
  for (const [handler, label, icon] of [
    ["openShareSelectionMode", "分享", "album-share.svg"],
    ["openDownloadSelectionMode", "下载", "album-download.svg"],
    ["openTagSelectionMode", "标注", "album-tag-white.svg"],
    ["openClaimShare", "邀请认领", "album-recruit.svg"]
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

test("active album sharing is request-guarded and selects its own timeline image", () => {
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
  assert.match(prepareBlock, /this\.selectAlbumShareTimelineImage\(data\)/);
  assert.match(prepareBlock, /this\.applyActiveAlbumShareTimelineImage\(/);
  assert.doesNotMatch(prepareBlock, /Canvas|canvas|startAlbumShareCoverPreparation/);
  assert.doesNotMatch(prepareBlock, /ALBUM_PUBLIC_SHARE_COVER_UNAVAILABLE/);
  assert.doesNotMatch(prepareBlock, /remoteUrl|cover_url|timeline_cover_url|friend_cover_url/);
  assert.match(installSnapshotBlock, /this\.albumShareReadyVisible\s*=\s*true/);

  assert.match(albumPageSource, /activeAlbumShareTimelineCoverUrl/);
  assert.match(albumPageSource, /activeAlbumShareTimelineCoverPrepared/);
});

test("member and public sharing use one representative image without Canvas or Skyline", () => {
  assert.match(albumPageSource, /selectAlbumShareTimelineImage/);
  assert.match(albumPageSource, /albumShareLocalImagePath/);
  assert.doesNotMatch(albumPageSource, /<canvas|canvasToTempFilePath|albumShareCanvas/);
  assert.doesNotMatch(albumPageSource, /<snapshot|renderer:\s*["']skyline/);
});

test("public timeline sharing selects a representative image from the current response", () => {
  const prepareBlock = sourceBlock(
    "async prepareAlbumShareTimelineImage(data) {",
    "resetAlbumShareCovers("
  );
  assert.match(
    prepareBlock,
    /const publicRequest = \{[\s\S]*generation:\s*this\.publicAlbumRead\.generation[\s\S]*sessionId:\s*this\.sessionId[\s\S]*token:\s*this\.albumShareToken/
  );
  assert.ok(
    prepareBlock.match(/this\.isCurrentPublicAlbumRequest\(publicRequest\)/g)?.length >= 2
  );
  assert.match(prepareBlock, /this\.selectAlbumShareTimelineImage\(data\)/);
  assert.match(
    prepareBlock,
    /const preparedUrl = await this\.prepareShareCoverUrl\(imageUrl\)/
  );
  assert.match(
    prepareBlock,
    /const localCoverUrl = albumShareLocalImagePath\(preparedUrl\)/
  );
  assert.match(prepareBlock, /this\.applyAlbumShareTimelineImage\(localCoverUrl\)/);
  assert.doesNotMatch(prepareBlock, /applyAlbumShareTimelineImage\(imageUrl\)/);
  assert.doesNotMatch(prepareBlock, /localCoverUrl\s*=.*\|\|\s*imageUrl/);
  assert.doesNotMatch(prepareBlock, /Canvas|canvas|static\/art/);

  const loadBlock = sourceBlock("async loadPublicAlbum() {", "async loadMorePublicAlbum() {");
  assert.match(
    loadBlock,
    /const shareTimelineCoverPromise = this\.prepareAlbumShareTimelineImage\(data\)/
  );
  assert.match(loadBlock, /await shareTimelineCoverPromise/);
  assert.ok(
    loadBlock.indexOf("await shareTimelineCoverPromise") <
      loadBlock.lastIndexOf("if (this.singleMediaShareRequested)")
  );
  assert.match(
    loadBlock.slice(loadBlock.indexOf("await shareTimelineCoverPromise")),
    /this\.isCurrentPublicAlbumRequest\(publicRequest\)/
  );

  const moreBlock = sourceBlock("async loadMorePublicAlbum() {", "normalizeAlbumMediaUrl(path)");
  assert.doesNotMatch(moreBlock, /resetAlbumShareCovers|prepareAlbumShareTimelineImage/);
});

test("public timeline cover failure never marks an expiring online URL ready", () => {
  const prepareBlock = sourceBlock(
    "async prepareAlbumShareTimelineImage(data) {",
    "resetAlbumShareCovers("
  );
  const payloadBlock = sourceBlock(
    "publicAlbumShareTimelinePayload() {",
    "activeAlbumShareTimelinePayload() {"
  );

  assert.match(prepareBlock, /await this\.prepareShareCoverUrl\(imageUrl\)/);
  assert.match(prepareBlock, /albumShareLocalImagePath\(preparedUrl\)/);
  assert.match(prepareBlock, /this\.applyAlbumShareTimelineImage\(localCoverUrl\)/);
  assert.doesNotMatch(prepareBlock, /preparedUrl\s*\|\||imageUrl\s*\|\|/);
  assert.match(
    payloadBlock,
    /const localCoverUrl = albumShareLocalImagePath\(this\.shareTimelineCoverUrl\)/
  );
  assert.match(payloadBlock, /!localCoverUrl/);
  assert.match(payloadBlock, /imageUrl:\s*localCoverUrl/);
  assert.doesNotMatch(payloadBlock, /imageUrl:\s*this\.shareTimelineCoverUrl/);
});

test("late public cover downloads cannot apply after generation or token invalidation", async () => {
  const prepareTimelineImage = executablePrepareAlbumShareTimelineImage();

  for (const invalidate of [
    (page) => { page.publicAlbumRead = { generation: 8 }; },
    (page) => { page.albumShareToken = "replacement-token"; }
  ]) {
    const download = deferred();
    const applied = [];
    const page = {
      publicAlbumRead: { generation: 7 },
      sessionId: 10,
      albumShareToken: "public-token",
      isCurrentPublicAlbumRequest(request) {
        return (
          request.generation === this.publicAlbumRead.generation &&
          String(request.sessionId) === String(this.sessionId) &&
          request.token === this.albumShareToken
        );
      },
      selectAlbumShareTimelineImage: () => "https://api.test/expiring-cover.jpg",
      prepareShareCoverUrl: () => download.promise,
      applyAlbumShareTimelineImage: (value) => applied.push(value),
      showShareMenus: () => assert.fail("stale cover must not reopen share menus")
    };

    const preparation = prepareTimelineImage.call(page, {});
    invalidate(page);
    download.resolve("wxfile://tmp/public-cover.jpg");

    assert.equal(await preparation, "");
    assert.deepEqual(applied, []);
  }
});

test("failed public cover download stays not ready without the online fallback", async () => {
  const prepareTimelineImage = executablePrepareAlbumShareTimelineImage();
  const page = {
    publicAlbumRead: { generation: 7 },
    sessionId: 10,
    albumShareToken: "public-token",
    shareTimelineCoverUrl: "",
    shareTimelineCoverPrepared: false,
    isCurrentPublicAlbumRequest(request) {
      return (
        request.generation === this.publicAlbumRead.generation &&
        String(request.sessionId) === String(this.sessionId) &&
        request.token === this.albumShareToken
      );
    },
    selectAlbumShareTimelineImage: () => "https://api.test/expiring-cover.jpg",
    prepareShareCoverUrl: async () => {
      throw new Error("download failed");
    },
    applyAlbumShareTimelineImage(value) {
      this.shareTimelineCoverUrl = value;
      this.shareTimelineCoverPrepared = Boolean(value);
    },
    showShareMenus() {}
  };

  assert.equal(await prepareTimelineImage.call(page, {}), "");
  assert.equal(page.shareTimelineCoverUrl, "");
  assert.equal(page.shareTimelineCoverPrepared, false);
});

test("representative image state follows share lifecycle without temporary render cleanup", () => {
  const clearActiveBlock = sourceBlock(
    "clearActiveAlbumShareState({ hideMenus = true, invalidateRequest = true } = {}) {",
    "closeAlbumShareReady() {"
  );
  assert.doesNotMatch(clearActiveBlock, /Canvas|canvas/);

  const onHideBlock = sourceBlock("onHide() {", "onUnload() {");
  const onUnloadBlock = sourceBlock("onUnload() {", "onPageScroll(event) {");
  assert.match(onUnloadBlock, /resetAlbumShareCovers/);
  assert.doesNotMatch(onUnloadBlock, /Canvas|canvas/);
  const publicHideTail = onHideBlock.slice(onHideBlock.indexOf("this.cancelSelectionMode"));
  assert.doesNotMatch(publicHideTail, /resetAlbumShareCovers/);
  assert.match(onHideBlock, /if \(!this\.timelineMode\)[\s\S]*resetAlbumShareCovers/);
  assert.doesNotMatch(onHideBlock, /Canvas|canvas/);

  const refreshBlock = sourceBlock(
    "initializeAlbumMediaRefreshController() {",
    "async loadAlbum() {"
  );
  assert.doesNotMatch(refreshBlock, /resetAlbumShareCovers\(\)/);
  assert.doesNotMatch(refreshBlock, /prepareAlbumShareTimelineImage|publicRefresh/);
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
  assert.match(shareMenuBlock, /activeAlbumShareToken/);
  assert.match(shareMenuBlock, /:\s*memberDefaultState/);
  assert.match(shareMenuBlock, /:\s*memberState\.token/);
  assert.doesNotMatch(shareMenuBlock, /friendReady|FriendCoverPrepared/);
  assert.match(shareMenuBlock, /:\s*memberState\.timelineReady/);
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
      timelineBlock.indexOf("await this.publicAlbumMediaStateRefresh?.refresh()")
  );
  assert.doesNotMatch(timelineBlock, /albumMediaRefresh/);
});

test("timeline hide and show preserve the prepared public share payload", () => {
  const onHideBlock = sourceBlock("onHide() {", "onUnload() {");
  const onShowBlock = sourceBlock("async onShow()", "onHide()");
  const payloadBlock = sourceBlock(
    "publicAlbumShareTimelinePayload() {",
    "activeAlbumShareTimelinePayload() {"
  );

  assert.doesNotMatch(
    onHideBlock.slice(onHideBlock.indexOf("this.cancelSelectionMode")),
    /resetAlbumShareCovers|shareTimelineCoverUrl\s*=|shareTimelineCoverPrepared\s*=/
  );
  assert.doesNotMatch(onShowBlock, /resetAlbumShareCovers/);
  assert.match(payloadBlock, /this\.shareTimelineCoverPrepared/);
  assert.match(payloadBlock, /albumShareLocalImagePath\(this\.shareTimelineCoverUrl\)/);
  assert.match(payloadBlock, /imageUrl:\s*localCoverUrl/);
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
  assert.match(loadMoreBlock, /type:\s*"NEXT_PAGE",\s*status:\s*"start"/);
  assert.match(loadMoreBlock, /type:\s*"NEXT_PAGE",\s*status:\s*"success"/);
  assert.match(loadMoreBlock, /type:\s*"NEXT_PAGE",\s*status:\s*"failure"/);
  assert.match(loadMoreBlock, /mergePublicAlbumSharePages\(/);
});

test("public invalid access clears credentials and mounted capabilities before leaving", () => {
  const invalidationBlock = sourceBlock(
    "invalidatePublicAlbumAccess() {",
    "redirectUnavailablePublicAlbumHome() {"
  );
  const loadBlock = sourceBlock("async loadPublicAlbum() {", "async loadMorePublicAlbum() {");
  const moreBlock = sourceBlock(
    "async loadMorePublicAlbum() {",
    "async refreshLoadedPublicAlbumMedia() {"
  );
  const mediaStateBlock = sourceBlock(
    "async refreshLoadedPublicAlbumMedia() {",
    "retryAlbumLoad() {"
  );

  assert.match(invalidationBlock, /this\.albumShareToken\s*=\s*""/);
  assert.match(invalidationBlock, /type:\s*"UNLOAD"/);
  assert.match(invalidationBlock, /this\.albumSession\s*=\s*null/);
  assert.match(invalidationBlock, /this\.shareSubject\s*=\s*null/);
  assert.match(invalidationBlock, /this\.shareOwner\s*=\s*null/);
  assert.match(invalidationBlock, /this\.resetAlbumShareCovers\(\)/);
  assert.match(invalidationBlock, /this\.showShareMenus\(\)/);
  assert.match(invalidationBlock, /this\.applyPublicAlbumMediaPatchToWaterfall\(\[\], unavailableIds\)/);
  assert.match(invalidationBlock, /this\.publicAlbumMediaStateRefresh\?\.dispose\(\)/);
  for (const requestBlock of [loadBlock, moreBlock, mediaStateBlock]) {
    assert.match(requestBlock, /isUnavailablePublicAlbumError\(error\)/);
    assert.match(requestBlock, /this\.invalidatePublicAlbumAccess\(\)/);
  }
});

test("single-image sharing explicitly allows an owned untagged image and explains exposure", () => {
  const singleShareBlock = sourceBlock(
    "async prepareSingleMediaShare(photo",
    "showFullPublicAlbum() {"
  );
  assert.match(singleShareBlock, /includeOwnedUntaggedImages: true/);
  assert.match(albumPageSource, /未标注，仅在你主动分享后公开/);
  assert.match(albumPageSource, /previewShowsOwnedUntaggedShareNote/);
});

test("showing the full public album keeps the mounted waterfall and scroll position", () => {
  const showFullBlock = sourceBlock(
    "showFullPublicAlbum() {",
    "albumTimelineQuery("
  );

  assert.match(showFullBlock, /this\.focusedPublicMode\s*=\s*false/);
  assert.match(showFullBlock, /this\.previewOverlayVisible\s*=\s*false/);
  assert.doesNotMatch(showFullBlock, /refreshWaterfall|\.clear\s*\(/);
  assert.doesNotMatch(
    showFullBlock,
    /waterfallPhotos|waterfallList1|waterfallList2|albumScrollTop|pageScrollTo/
  );
});
