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
      {
        id: 1,
        media_type: "image",
        moderation_status: "approved",
        storage_object_key: "uploads/session-album/display/a.jpg",
        storage_object_etag: "e"
      },
      {
        id: 2,
        media_type: "video",
        moderation_status: "approved",
        processing_status: "ready",
        video_url: "/api/session-album/media/2/video-url"
      }
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
    photos: [{
      id: 3,
      media_type: "image",
      moderation_status: "approved_legacy",
      storage_object_key: null,
      storage_object_etag: null
    }]
  }, 9, { directMediaUrls: true, nowSeconds: 1000, cosConfig, emit: () => {} });
  assert.match(result.photos[0].preview_display_url, /^\/api\/session-album\/photos\/3\/image/);
  assert.match(result.photos[0].thumbnail_display_url, /^\/api\/session-album\/photos\/3\/image/);
  assert.equal(result.photos[0].media_url_expires_at, null);
  assert.equal("storage_object_key" in result.photos[0], false);
});

test("disabled direct reads still expose all new fields through legacy URLs", () => {
  const result = attachSessionAlbumMediaUrls({
    session_id: 8,
    photos: [{
      id: 4,
      media_type: "image",
      moderation_status: "approved",
      storage_object_key: "uploads/session-album/display/a.jpg"
    }]
  }, 9, { directMediaUrls: false, nowSeconds: 1000, cosConfig, emit: () => {} });
  assert.match(result.photos[0].download_url, /^\/api\/session-album\/photos\/4\/image/);
  assert.equal(result.photos[0].media_url_expires_at, null);
});

test("pending image is a metadata-only placeholder without legacy or signed URLs", () => {
  const result = attachSessionAlbumMediaUrls({
    session_id: 8,
    photos: [{
      id: 5,
      media_type: "image",
      moderation_status: "pending",
      photo_url: "/uploads/session-album/display/private.jpg",
      storage_object_key: "uploads/session-album/display/private.jpg",
      storage_object_etag: "private-etag"
    }]
  }, 9, { directMediaUrls: true, nowSeconds: 1000, cosConfig, emit: () => {} });

  assert.equal(result.photos[0].moderation_status, "pending");
  for (const field of [
    "image_url", "preview_url", "thumbnail_url", "preview_load_url",
    "thumbnail_load_url", "preview_display_url", "thumbnail_display_url", "download_url"
  ]) {
    assert.equal(result.photos[0][field], null);
  }
  assert.equal("storage_object_key" in result.photos[0], false);
  assert.equal("storage_object_etag" in result.photos[0], false);
  assert.equal("photo_url" in result.photos[0], false);
});

test("pending video never receives playback or cover URLs even when processing is ready", () => {
  const result = attachSessionAlbumMediaUrls({
    session_id: 8,
    photos: [{
      id: 6,
      media_type: "video",
      processing_status: "ready",
      moderation_status: "pending",
      has_cover: true,
      video_cover_source_url: "/uploads/session-album/videos/cover/private.jpg",
      source_url: "/uploads/session-album/videos/source/private.mp4",
      display_url: "/uploads/session-album/videos/display/private.mp4",
      cover_url: "/uploads/session-album/videos/cover/private.jpg"
    }]
  }, 9, { emit: () => {} });
  assert.equal(result.photos[0].video_url, "");
  assert.equal(result.photos[0].cover_url, "");
  assert.equal("video_cover_source_url" in result.photos[0], false);
  assert.equal("source_url" in result.photos[0], false);
  assert.equal("display_url" in result.photos[0], false);
});
