import assert from "node:assert/strict";
import test from "node:test";

import {
  albumSharePreviewNotice,
  albumSharePreviewRoute,
  albumSharePreviewRouteState,
  normalizeAlbumShareSelection
} from "../src/utils/albumSharePreview.js";

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
