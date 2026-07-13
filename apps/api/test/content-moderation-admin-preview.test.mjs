import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_MODERATION_PREVIEW_RESPONSE_CACHE_CONTROL,
  ADMIN_MODERATION_PREVIEW_SECONDS,
  createAdminModerationPreviewBuilder
} from "../src/modules/content-moderation/admin-preview.js";

const cosConfig = {
  enabled: true,
  secretId: "secret-id",
  secretKey: "secret-key",
  bucket: "private-bucket",
  region: "ap-shanghai"
};

function imageRow(overrides = {}) {
  return {
    provider: "wechat_sec_check",
    subject_type: "album_image",
    subject_id: "91",
    subject_version: "etag-image-91",
    status: "review",
    media_id: 91,
    media_record_status: "active",
    media_type: "image",
    moderation_object_version: "etag-image-91",
    object_key: "uploads/session-album/display/album-8-7-1.jpg",
    ...overrides
  };
}

function videoRow(overrides = {}) {
  return {
    provider: "tencent_ci_video",
    subject_type: "album_video",
    subject_id: "92",
    subject_version: "etag-video-92",
    status: "error",
    media_id: 92,
    media_record_status: "active",
    media_type: "video",
    moderation_object_version: "etag-video-92",
    display_url: "/uploads/session-album/videos/display/album-8-7-2.mp4",
    ...overrides
  };
}

function previewHarness(options = {}) {
  const calls = { image: [], video: [] };
  const build = createAdminModerationPreviewBuilder({
    cosConfig: options.cosConfig ?? cosConfig,
    now: () => new Date("2026-07-12T12:00:00.000Z"),
    buildImageUrl: (input) => {
      calls.image.push(input);
      return `https://cos.example/image?expires=${input.expiresInSeconds}`;
    },
    buildVideoUrl: (input) => {
      calls.video.push(input);
      return `https://cos.example/video?expires=${input.expiresInSeconds}`;
    }
  });
  return { build, calls };
}

test("administrator image preview signs only its current private object for 60 seconds", () => {
  const { build, calls } = previewHarness();

  const preview = build(imageRow());

  assert.deepEqual(calls.image, [{
    objectKey: "uploads/session-album/display/album-8-7-1.jpg",
    nowSeconds: 1783857600,
    expiresInSeconds: ADMIN_MODERATION_PREVIEW_SECONDS,
    queryEntries: [{
      name: "response-cache-control",
      value: ADMIN_MODERATION_PREVIEW_RESPONSE_CACHE_CONTROL
    }]
  }]);
  assert.deepEqual(calls.video, []);
  assert.deepEqual(preview, {
    previewUrl: "https://cos.example/image?expires=60",
    previewExpiresAt: "2026-07-12T12:01:00.000Z"
  });
});

test("administrator video preview signs only a controlled display/source path for 60 seconds", () => {
  const { build, calls } = previewHarness();

  const preview = build(videoRow());

  assert.deepEqual(calls.image, []);
  assert.deepEqual(calls.video, [{
    uploadPath: "/uploads/session-album/videos/display/album-8-7-2.mp4",
    expiresInSeconds: ADMIN_MODERATION_PREVIEW_SECONDS,
    queryEntries: [{
      name: "response-cache-control",
      value: ADMIN_MODERATION_PREVIEW_RESPONSE_CACHE_CONTROL
    }]
  }]);
  assert.deepEqual(preview, {
    previewUrl: "https://cos.example/video?expires=60",
    previewExpiresAt: "2026-07-12T12:01:00.000Z"
  });
});

test("administrator preview fails closed for stale, unowned, and untrusted media paths", () => {
  const invalidRows = [
    imageRow({ status: "pending" }),
    imageRow({ media_id: 92 }),
    imageRow({ media_record_status: "deleted" }),
    imageRow({ moderation_object_version: "etag-other" }),
    imageRow({ provider: "tencent_ci_video" }),
    imageRow({ object_key: "uploads/session-album/display/../videos/source/unowned.mp4" }),
    imageRow({ object_key: "uploads/private.jpg" }),
    videoRow({ display_url: "https://cos.example/private.mp4?signature=long-lived" }),
    videoRow({ display_url: "/uploads/session-album/videos/display/../source/unowned.mp4" })
  ];

  for (const row of invalidRows) {
    const { build, calls } = previewHarness();
    assert.deepEqual(build(row), {});
    assert.deepEqual(calls.image, []);
    assert.deepEqual(calls.video, []);
  }
});

test("administrator preview does not sign when private COS is unavailable", () => {
  const { build, calls } = previewHarness({ cosConfig: { enabled: false } });

  assert.deepEqual(build(imageRow()), {});
  assert.deepEqual(calls.image, []);
  assert.deepEqual(calls.video, []);
});
