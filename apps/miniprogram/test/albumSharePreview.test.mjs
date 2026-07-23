import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  albumSharePreviewNotice,
  albumSharePreviewRoute,
  albumSharePreviewRouteState,
  normalizeAlbumShareSelection
} from "../src/utils/albumSharePreview.js";
import { albumShareMenus } from "../src/utils/albumShareCover.js";

const albumPageSource = await readFile(
  new URL("../src/pages/session/album.vue", import.meta.url),
  "utf8"
);

test("builds an encoded share-preview route only from valid required fields", () => {
  assert.equal(
    albumSharePreviewRoute({
      sessionId: 10,
      token: "token +/=?",
      total: 3,
      untagged: 1
    }),
    "/pages/session/album?id=10&source=share_preview&albumShareToken=token%20%2B%2F%3D%3F&shareTotal=3&shareUntagged=1"
  );
  for (const input of [
    { sessionId: 0, token: "token", total: 1, untagged: 0 },
    { sessionId: 10, token: "", total: 1, untagged: 0 }
  ]) {
    assert.equal(albumSharePreviewRoute(input), "");
  }
});

test("parses preview state safely and fails closed without a token", () => {
  assert.deepEqual(albumSharePreviewRouteState({
    source: "share_preview",
    albumShareToken: " snapshot-token ",
    shareTotal: "3",
    shareUntagged: "1"
  }), {
    token: "snapshot-token",
    sharePreviewRequested: true,
    sharePreviewMode: true,
    total: 3,
    untagged: 1
  });
  assert.deepEqual(albumSharePreviewRouteState({
    source: "share_preview",
    shareTotal: "invalid",
    shareUntagged: "99"
  }), {
    token: "",
    sharePreviewRequested: true,
    sharePreviewMode: false,
    total: 0,
    untagged: 0
  });
});

test("generates an accurate privacy reminder", () => {
  assert.equal(
    albumSharePreviewNotice({ total: 3, untagged: 1 }),
    "共 3 项，其中 1 张未标注图片。请确认不含不适合公开的人物或内容。"
  );
  assert.equal(
    albumSharePreviewNotice({ total: 2, untagged: 0 }),
    "共 2 项。请确认不含不适合公开的人物或内容。"
  );
});

test("normalizes exact selection without mutation and enforces 30 media and 3 videos", () => {
  const photos = [
    { id: 1, media_type: "image" },
    { id: 2, media_type: "video" },
    { id: 3, media_type: "image" }
  ];
  const selectedIds = [3, "1", 3];
  assert.deepEqual(normalizeAlbumShareSelection(photos, selectedIds), {
    ok: true,
    ids: [3, 1],
    error: ""
  });
  assert.deepEqual(selectedIds, [3, "1", 3]);

  assert.equal(normalizeAlbumShareSelection(photos, []).ok, false);
  assert.equal(normalizeAlbumShareSelection(photos, [999]).ok, false);
  assert.equal(normalizeAlbumShareSelection(
    Array.from({ length: 31 }, (_, index) => ({ id: index + 1, media_type: "image" })),
    Array.from({ length: 31 }, (_, index) => index + 1)
  ).ok, false);
  assert.equal(normalizeAlbumShareSelection(
    Array.from({ length: 4 }, (_, index) => ({ id: index + 1, media_type: "video" })),
    [1, 2, 3, 4]
  ).ok, false);
});

test("preview helper results are immutable", () => {
  assert.equal(Object.isFrozen(albumSharePreviewRouteState({})), true);
  const selection = normalizeAlbumShareSelection([{ id: 1, media_type: "image" }], [1]);
  assert.equal(Object.isFrozen(selection), true);
  assert.equal(Object.isFrozen(selection.ids), true);
});

test("member page prepares a preview explicitly instead of creating an album token on load", () => {
  assert.match(albumPageSource, />预览并分享</);
  assert.match(albumPageSource, /@tap="prepareAlbumSharePreview"/);
  assert.match(albumPageSource, /async prepareAlbumSharePreview\(\)/);
  assert.match(albumPageSource, /includeOwnedUntaggedImages: true/);
  assert.match(albumPageSource, /albumSharePreviewRoute\(\{/);

  const onLoadBlock = albumPageSource.slice(
    albumPageSource.indexOf("async onLoad(options)"),
    albumPageSource.indexOf("async onShow()")
  );
  const onShowBlock = albumPageSource.slice(
    albumPageSource.indexOf("async onShow()"),
    albumPageSource.indexOf("onHide()")
  );
  assert.equal(onLoadBlock.includes("ensureAlbumShareToken"), false);
  assert.equal(onShowBlock.includes("ensureAlbumShareToken"), false);
});

test("share preview uses safe state, accurate notice and native share gating", () => {
  assert.match(albumPageSource, /albumSharePreviewRouteState\(options\)/);
  assert.match(albumPageSource, /albumSharePreviewNotice\(\{/);
  assert.match(albumPageSource, /v-if="sharePreviewMode"/);
  assert.match(albumPageSource, /open-type="share"/);
  const shareMenuBlock = albumPageSource.slice(
    albumPageSource.indexOf("showShareMenus() {"),
    albumPageSource.indexOf("async prepareShareCoverUrl")
  );
  assert.match(shareMenuBlock, /!this\.timelineMode/);
  assert.match(shareMenuBlock, /this\.selectionMode/);
  assert.match(shareMenuBlock, /albumShareMenus\(\{/);
  assert.match(shareMenuBlock, /token:\s*this\.albumShareToken/);
  assert.match(shareMenuBlock, /friendReady:\s*this\.shareFriendCoverPrepared/);
  assert.match(shareMenuBlock, /timelineReady:\s*this\.shareTimelineCoverPrepared/);
});

test("friend share button is gated only by the independently prepared friend cover", () => {
  const shareOpenTypeIndex = albumPageSource.indexOf('open-type="share"');
  const buttonStart = albumPageSource.lastIndexOf("<t-button", shareOpenTypeIndex);
  const buttonEnd = albumPageSource.indexOf("</t-button>", shareOpenTypeIndex);
  const friendShareButton = albumPageSource.slice(buttonStart, buttonEnd);
  assert.match(friendShareButton, /!shareFriendCoverPrepared/);
  assert.equal(friendShareButton.includes("shareCoverPrepared"), false);
  assert.equal(friendShareButton.includes("shareTimelineCoverPrepared"), false);

  assert.deepEqual(albumShareMenus({
    token: "t",
    friendReady: true,
    timelineReady: false
  }), ["shareAppMessage"]);
  assert.deepEqual(albumShareMenus({
    token: "t",
    friendReady: false,
    timelineReady: true
  }), ["shareTimeline"]);
});

test("public share prepares separate local Canvas covers and never forwards server composite URLs", () => {
  assert.match(albumPageSource, /<canvas[\s\S]*id="album-share-friend-canvas"[\s\S]*type="2d"/);
  assert.match(albumPageSource, /<canvas[\s\S]*id="album-share-timeline-canvas"[\s\S]*type="2d"/);
  assert.match(albumPageSource, /createAlbumShareCanvasPreparation/);
  assert.match(albumPageSource, /createAlbumShareCanvasRuntime/);
  assert.match(albumPageSource, /uni\.canvasToTempFilePath/);
  assert.match(albumPageSource, /canvas:\s*canvasHandle\.canvas/);
  assert.match(albumPageSource, /canUseAlbumShareCanvasIdExport\(\)/);
  assert.match(albumPageSource, /canvasId:\s*canvasHandle\.canvasId/);

  const coverPreparationBlock = albumPageSource.slice(
    albumPageSource.indexOf("prepareAlbumShareCovers(data"),
    albumPageSource.indexOf("resetAlbumShareCovers({", albumPageSource.indexOf("prepareAlbumShareCovers(data"))
  );
  assert.match(coverPreparationBlock, /cover_recipe/);
  assert.match(coverPreparationBlock, /localPreviewByMediaId/);
  assert.match(coverPreparationBlock, /thumbnailUrlResolver:\s*this\.normalizeAlbumMediaUrl/);
  assert.equal(coverPreparationBlock.includes("cover_url"), false);
  assert.equal(coverPreparationBlock.includes("timeline_cover_url"), false);
  assert.equal(coverPreparationBlock.includes("friend_cover_url"), false);

  const publicLoadBlock = albumPageSource.slice(
    albumPageSource.indexOf("async loadPublicAlbum()"),
    albumPageSource.indexOf("async loadMorePublicAlbum()", albumPageSource.indexOf("async loadPublicAlbum()"))
  );
  assert.ok(publicLoadBlock.indexOf("this.photos =") < publicLoadBlock.indexOf("this.prepareAlbumShareCovers(data"));
  assert.ok(publicLoadBlock.indexOf("this.prepareAlbumShareCovers(data") < publicLoadBlock.indexOf("this.refreshWaterfall()"));
});

test("share cover local-preview map only reuses downloaded local media, never original image URLs", () => {
  const localPreviewBlock = albumPageSource.slice(
    albumPageSource.indexOf("albumShareLocalPreviewByMediaId()"),
    albumPageSource.indexOf("prepareAlbumShareCovers(data", albumPageSource.indexOf("albumShareLocalPreviewByMediaId()"))
  );
  assert.match(localPreviewBlock, /visiblePhotoMedia/);
  assert.match(localPreviewBlock, /thumbnail/);
  assert.match(localPreviewBlock, /preview/);
  assert.equal(localPreviewBlock.includes("image_url"), false);
  assert.equal(localPreviewBlock.includes("preview_url"), false);
  assert.equal(localPreviewBlock.includes("display_url"), false);
});

test("public body pagination is not part of share-cover currentness", () => {
  const preparationStart = albumPageSource.indexOf("prepareAlbumShareCovers(data");
  const coverPreparationBlock = albumPageSource.slice(
    preparationStart,
    albumPageSource.indexOf("resetAlbumShareCovers", preparationStart)
  );
  assert.equal(coverPreparationBlock.includes("isCurrent ="), false);
  assert.equal(coverPreparationBlock.includes("isCurrent()"), false);
  assert.equal(coverPreparationBlock.includes("isCurrentAlbumListRequest"), false);

  const publicLoadStart = albumPageSource.indexOf("async loadPublicAlbum()");
  const publicLoadBlock = albumPageSource.slice(
    publicLoadStart,
    albumPageSource.indexOf("async loadMorePublicAlbum()", publicLoadStart)
  );
  const prepareCallStart = publicLoadBlock.indexOf("this.prepareAlbumShareCovers(data");
  const prepareCall = publicLoadBlock.slice(
    prepareCallStart,
    publicLoadBlock.indexOf("this.statusText", prepareCallStart)
  );
  assert.equal(prepareCall.includes("isCurrentAlbumListRequest"), false);
});

test("ordinary public media URL refresh keeps an unchanged share-cover context alive", () => {
  const refreshStart = albumPageSource.indexOf("initializeAlbumMediaRefreshController() {");
  const refreshBlock = albumPageSource.slice(
    refreshStart,
    albumPageSource.indexOf("async loadAlbum()", refreshStart)
  );
  assert.equal(refreshBlock.includes("this.resetAlbumShareCovers()"), false);
  assert.match(refreshBlock, /this\.prepareAlbumShareCovers\(data\)/);

  const preparationStart = albumPageSource.indexOf("prepareAlbumShareCovers(data)");
  const preparationBlock = albumPageSource.slice(
    preparationStart,
    albumPageSource.indexOf("resetAlbumShareCovers({", preparationStart)
  );
  assert.match(preparationBlock, /albumShareCoverContextKey/);
  assert.match(preparationBlock, /this\.albumShareCoverContextKey/);
});

test("share preview initial load is not invalidated by the first onShow refresh", () => {
  const onShowBlock = albumPageSource.slice(
    albumPageSource.indexOf("async onShow()"),
    albumPageSource.indexOf("onHide()")
  );
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

test("preview adjustment keeps an independent exact share selection", () => {
  assert.match(albumPageSource, />调整分享内容</);
  assert.match(albumPageSource, /<root-portal :enable="selectionMode && !tagSheetPhoto">/);
  assert.match(albumPageSource, /selectionModePurpose === 'share'/);
  assert.match(albumPageSource, /openShareSelectionMode/);
  assert.match(albumPageSource, /!this\.sharePreviewMode \|\|/);
  assert.match(albumPageSource, /this\.timelineMode && !this\.sharePreviewMode/);
  assert.match(albumPageSource, /this\.timelineMode && this\.selectionModePurpose !== "share"/);
  assert.match(albumPageSource, /normalizeAlbumShareSelection\(/);
  assert.match(albumPageSource, /async saveShareSelection\(\)/);
  assert.match(albumPageSource, /selectedMediaIds: selection\.ids/);
});

test("single-image sharing explicitly allows an owned untagged image and explains exposure", () => {
  const start = albumPageSource.indexOf("async prepareSingleMediaShare(photo");
  const singleShareBlock = albumPageSource.slice(
    start,
    albumPageSource.indexOf("handleSingleMediaShareStatusTap", start)
  );
  assert.match(singleShareBlock, /includeOwnedUntaggedImages: true/);
  assert.match(albumPageSource, /未标注，仅在你主动分享后公开/);
  assert.match(albumPageSource, /previewShowsOwnedUntaggedShareNote/);
});
