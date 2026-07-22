import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  albumSharePreviewNotice,
  albumSharePreviewRoute,
  albumSharePreviewRouteState,
  normalizeAlbumShareSelection
} from "../src/utils/albumSharePreview.js";

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
  assert.match(shareMenuBlock, /!this\.albumShareToken/);
  assert.match(shareMenuBlock, /!this\.shareCoverPrepared/);
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
