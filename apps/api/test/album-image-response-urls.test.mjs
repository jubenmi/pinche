import assert from "node:assert/strict";
import test from "node:test";

import { attachSessionAlbumMediaUrls } from "../src/server.js";

const cosConfig = {
  enabled: true, secretId: "id", secretKey: "secret",
  bucket: "pinche-app-1251022382", region: "ap-nanjing"
};

test("direct mode signs filtered image rows, strips storage facts, and preserves video", () => {
  const album = {
    session_id: 8,
    photos: [
      { id: 1, media_type: "image", storage_object_key: "uploads/session-album/display/a.jpg", storage_object_etag: "e" },
      { id: 2, media_type: "video", processing_status: "ready", video_url: "/api/session-album/media/2/video-url" }
    ]
  };
  const result = attachSessionAlbumMediaUrls(album, 9, {
    directMediaUrls: true,
    nowSeconds: 1000,
    cosConfig,
    emit: () => {}
  });
  assert.match(result.photos[0].thumbnail_display_url, /^https:\/\/.*\.myqcloud\.com\//);
  assert.equal(result.photos[0].media_url_expires_at, "1970-01-01T00:21:40.000Z");
  assert.equal("storage_object_key" in result.photos[0], false);
  assert.equal("storage_object_etag" in result.photos[0], false);
  assert.equal(result.photos[1].video_url, "/api/session-album/media/2/video-url");
  assert.deepEqual(result.media, result.photos);
});

test("local or unbackfilled image uses legacy API fields and no expiry", () => {
  const result = attachSessionAlbumMediaUrls({
    session_id: 8,
    photos: [{ id: 3, media_type: "image", storage_object_key: null, storage_object_etag: null }]
  }, 9, { directMediaUrls: true, nowSeconds: 1000, cosConfig, emit: () => {} });
  assert.match(result.photos[0].preview_display_url, /^\/api\/session-album\/photos\/3\/image/);
  assert.match(result.photos[0].thumbnail_display_url, /^\/api\/session-album\/photos\/3\/image/);
  assert.equal(result.photos[0].media_url_expires_at, null);
  assert.equal("storage_object_key" in result.photos[0], false);
});

test("disabled direct reads still expose all new fields through legacy URLs", () => {
  const result = attachSessionAlbumMediaUrls({
    session_id: 8,
    photos: [{ id: 4, media_type: "image", storage_object_key: "uploads/session-album/display/a.jpg" }]
  }, 9, { directMediaUrls: false, nowSeconds: 1000, cosConfig, emit: () => {} });
  assert.match(result.photos[0].download_url, /^\/api\/session-album\/photos\/4\/image/);
  assert.equal(result.photos[0].media_url_expires_at, null);
});
