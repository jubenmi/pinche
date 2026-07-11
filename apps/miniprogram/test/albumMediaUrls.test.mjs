import assert from "node:assert/strict";
import test from "node:test";

import {
  createAlbumMediaRefreshController,
  normalizeAlbumImageUrls
} from "../src/utils/albumMediaUrls.js";

test("signed fields win while old and local paths remain compatible", () => {
  assert.deepEqual(normalizeAlbumImageUrls({
    id: 1,
    thumbnail_display_url: "cos-thumb",
    preview_display_url: "cos-preview",
    download_url: "cos-download",
    thumbnail_load_url: "api-thumb",
    preview_load_url: "api-preview"
  }), {
    thumbnailUrl: "cos-thumb",
    previewUrl: "cos-preview",
    downloadUrl: "cos-download",
    expiresAt: ""
  });
  assert.deepEqual(normalizeAlbumImageUrls({
    image_url: "legacy", thumbnail_load_url: "api-thumb", preview_load_url: "api-preview"
  }), {
    thumbnailUrl: "api-thumb",
    previewUrl: "api-preview",
    downloadUrl: "api-preview",
    expiresAt: ""
  });
});

test("concurrent refreshes cause one full-album reload and preserve page state", async () => {
  let loads = 0;
  let album = {
    photos: [{ id: 1, preview_display_url: "old", local_preview_path: "wxfile://one" }],
    activeFilter: "mine",
    selectedPhotoIds: [1],
    scrollTop: 123,
    previewCurrentIndex: 4
  };
  const controller = createAlbumMediaRefreshController({
    readAlbum: () => album,
    writeAlbum: (next) => { album = next; },
    reloadAlbum: async () => {
      loads += 1;
      return { photos: [{ id: 1, preview_display_url: "new" }] };
    },
    setTimer: () => 1,
    clearTimer: () => {},
    now: () => Date.parse("2026-07-11T01:04:40.000Z")
  });
  await Promise.all([controller.refresh(), controller.refresh(), controller.refresh()]);
  assert.equal(loads, 1);
  assert.equal(album.photos[0].preview_display_url, "new");
  assert.equal(album.photos[0].local_preview_path, "wxfile://one");
  assert.equal(album.activeFilter, "mine");
  assert.deepEqual(album.selectedPhotoIds, [1]);
  assert.equal(album.scrollTop, 123);
  assert.equal(album.previewCurrentIndex, 4);
});

test("timer schedules 30 seconds early, onShow checks suspended expiry, and dispose clears", async () => {
  const nowMs = Date.parse("2026-07-11T01:00:00.000Z");
  let album = {
    photos: [{ id: 1, media_url_expires_at: "2026-07-11T01:05:00.000Z" }]
  };
  const delays = [];
  const cleared = [];
  let loads = 0;
  let currentNow = nowMs;
  const controller = createAlbumMediaRefreshController({
    readAlbum: () => album,
    writeAlbum: (next) => { album = next; },
    reloadAlbum: async () => {
      loads += 1;
      return { photos: [{ id: 1, media_url_expires_at: "2026-07-11T01:10:00.000Z" }] };
    },
    setTimer: (_callback, delay) => { delays.push(delay); return 17; },
    clearTimer: (timer) => cleared.push(timer),
    now: () => currentNow
  });
  controller.schedule();
  assert.equal(delays[0], 270_000);
  currentNow = Date.parse("2026-07-11T01:04:40.000Z");
  await controller.checkNow();
  assert.equal(loads, 1);
  controller.dispose();
  assert.equal(cleared.includes(17), true);
});

test("public-share reload is supplied as a closure and remains single-flight", async () => {
  const calls = [];
  let album = { photos: [] };
  const controller = createAlbumMediaRefreshController({
    readAlbum: () => album,
    writeAlbum: (next) => { album = next; },
    reloadAlbum: async () => { calls.push("public-share-token"); return { photos: [] }; },
    setTimer: () => 1,
    clearTimer: () => {}
  });
  await Promise.all([controller.refresh(), controller.refresh()]);
  assert.deepEqual(calls, ["public-share-token"]);
});

test("album page uses one-step finalize, one auth retry, signed download, and lifecycle disposal", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/pages/session/album.vue", import.meta.url), "utf8")
  );
  const uploadStart = source.indexOf("async uploadChosenPhotos");
  const uploadEnd = source.indexOf("deletePhoto(photo)", uploadStart);
  const uploadBlock = source.slice(uploadStart, uploadEnd);
  assert.match(uploadBlock, /uploadAlbumPhoto\(\{/);
  assert.doesNotMatch(uploadBlock, /data:\s*\{\s*photoUrl/);
  assert.match(source, /mediaRefreshAttempts/);
  assert.match(source, /MEDIA_URL_EXPIRED/);
  assert.match(source, /photo\.download_url/);
  assert.match(source, /albumMediaRefresh\?\.dispose\(\)/);
  assert.match(source, /shouldAttachApiAuthorization\(imageUrl, getApiBaseUrl\(\)\)/);
});
