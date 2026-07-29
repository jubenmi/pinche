import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAlbumCosError,
  createSingleFlight,
  executeAlbumCosUpload,
  isAuthorPrivateAlbumMediaProjection,
  mergeAlbumMediaUrls,
  shouldRefreshAlbumMedia
} from "../src/albumMedia.js";
import * as albumMediaModule from "../src/albumMedia.js";

test("author-private album media projection requires the complete bounded DTO", () => {
  const projection = {
    media_type: "image",
    moderation_status: "pending",
    publication_state: "author_only",
    is_mine: true,
    can_preview: true,
    uploader_user_id: 7
  };

  assert.equal(isAuthorPrivateAlbumMediaProjection(projection), true);
  for (const moderationStatus of ["pending", "processing", "error", "review", "rejected"]) {
    assert.equal(
      isAuthorPrivateAlbumMediaProjection({
        ...projection,
        media_type: "video",
        moderation_status: moderationStatus
      }),
      true
    );
  }
  for (const invalidProjection of [
    { ...projection, publication_state: "public" },
    { ...projection, is_mine: false },
    { ...projection, can_preview: false },
    { ...projection, uploader_user_id: null },
    { ...projection, moderation_status: "approved" },
    { ...projection, media_type: "audio" }
  ]) {
    assert.equal(isAuthorPrivateAlbumMediaProjection(invalidProjection), false);
  }
});

test("publication and image-download gates require an explicit approved state", () => {
  assert.equal(typeof albumMediaModule.isModerationPublished, "function");
  assert.equal(typeof albumMediaModule.isApprovedAlbumImageDownloadCandidate, "function");

  const { isModerationPublished, isApprovedAlbumImageDownloadCandidate } = albumMediaModule;
  assert.equal(isModerationPublished("approved"), true);
  assert.equal(isModerationPublished("approved_legacy"), true);
  for (const status of [undefined, "", "pending", "processing", "review", "rejected", "error"]) {
    assert.equal(isModerationPublished(status), false);
  }

  assert.equal(
    isApprovedAlbumImageDownloadCandidate(
      { media_type: "image", moderation_status: "approved" },
      "https://media.example/approved.jpg"
    ),
    true
  );
  assert.equal(
    isApprovedAlbumImageDownloadCandidate(
      { media_type: "image", moderation_status: "approved_legacy" },
      "https://media.example/legacy.jpg"
    ),
    true
  );
  for (const photo of [
    { media_type: "image", moderation_status: "pending" },
    { media_type: "video", moderation_status: "approved" },
    { media_type: "image" }
  ]) {
    assert.equal(
      isApprovedAlbumImageDownloadCandidate(photo, "https://media.example/old-cache.jpg"),
      false
    );
  }
});

test("network and 5xx retry, overwrite conflicts reconcile, ordinary 4xx fail", () => {
  assert.equal(classifyAlbumCosError({ code: "COS_NETWORK_ERROR" }).action, "retry-put");
  assert.equal(classifyAlbumCosError({ statusCode: 503 }).action, "retry-put");
  assert.equal(classifyAlbumCosError({ statusCode: 412 }).action, "reconcile");
  assert.equal(classifyAlbumCosError({ code: "PreconditionFailed" }).action, "reconcile");
  assert.equal(classifyAlbumCosError({ statusCode: 400 }).action, "fail");
  assert.equal(
    classifyAlbumCosError({ statusCode: 0, code: "COS_DOMAIN_NOT_ALLOWED" }).action,
    "fail"
  );
});

test("ambiguous failure checks status before doing one of two retries", async () => {
  const calls = [];
  let puts = 0;
  const result = await executeAlbumCosUpload({
    putObject: async () => {
      calls.push("put");
      puts += 1;
      if (puts === 1) {
        throw Object.assign(new Error("reset"), { code: "COS_NETWORK_ERROR" });
      }
    },
    getStatus: async () => {
      calls.push("status");
      return puts === 1
        ? { validationState: "missing", canFinalize: false }
        : { validationState: "ready", canFinalize: true };
    },
    finalize: async () => ({ photo: { id: 17 } }),
    refreshAuthorization: async () => {},
    sleep: async () => calls.push("sleep"),
    random: () => 0,
    maxStatusPolls: 2,
    onPhase: () => {}
  });
  assert.deepEqual(calls, ["put", "status", "sleep", "put", "status"]);
  assert.equal(result.photo.id, 17);
});

test("overwrite conflict never issues a second PUT and unresolved conflict is stable", async () => {
  let puts = 0;
  await assert.rejects(
    executeAlbumCosUpload({
      putObject: async () => {
        puts += 1;
        throw Object.assign(new Error("exists"), { statusCode: 412 });
      },
      getStatus: async () => ({ validationState: "missing", canFinalize: false }),
      finalize: async () => ({ photo: { id: 1 } }),
      refreshAuthorization: async () => {},
      sleep: async () => {},
      random: () => 0,
      maxStatusPolls: 2,
      onPhase: () => {}
    }),
    (error) => error.code === "COS_UPLOAD_CONFLICT_UNRESOLVED"
  );
  assert.equal(puts, 1);
});

test("signature authorization refreshes once without exceeding three PUT requests", async () => {
  let puts = 0;
  let refreshes = 0;
  const result = await executeAlbumCosUpload({
    putObject: async () => {
      puts += 1;
      if (puts === 1) {
        throw Object.assign(new Error("expired"), { code: "SignatureDoesNotMatch" });
      }
      if (puts === 2) {
        throw Object.assign(new Error("timeout"), { code: "COS_REQUEST_TIMEOUT" });
      }
    },
    getStatus: async () =>
      puts < 3
        ? { validationState: "missing", canFinalize: false }
        : { validationState: "ready", canFinalize: true },
    finalize: async () => ({ photo: { id: 18 } }),
    refreshAuthorization: async () => {
      refreshes += 1;
    },
    sleep: async () => {},
    random: () => 0,
    maxStatusPolls: 2,
    onPhase: () => {}
  });
  assert.equal(result.photo.id, 18);
  assert.equal(puts, 3);
  assert.equal(refreshes, 1);
});

test("retryable failures stop after exactly three PUT requests", async () => {
  let puts = 0;
  await assert.rejects(
    executeAlbumCosUpload({
      putObject: async () => {
        puts += 1;
        throw Object.assign(new Error("unavailable"), { statusCode: 503 });
      },
      getStatus: async () => ({ validationState: "missing", canFinalize: false }),
      finalize: async () => ({ photo: { id: 19 } }),
      refreshAuthorization: async () => {},
      sleep: async () => {},
      random: () => 0,
      onPhase: () => {}
    }),
    (error) => error.statusCode === 503
  );
  assert.equal(puts, 3);
});

test("expiry, authoritative URL merge, and single flight preserve page state", async () => {
  assert.equal(
    shouldRefreshAlbumMedia("2026-07-11T01:05:00.000Z", {
      nowMs: Date.parse("2026-07-11T01:04:30.000Z")
    }),
    true
  );
  const current = {
    photos: [
      {
        id: 1,
        moderation_status: "approved",
        preview_display_url: "old",
        local_preview_path: "wxfile://cached"
      },
      { id: 2, moderation_status: "approved", preview_display_url: "now-hidden" }
    ],
    selected_ids: [1]
  };
  const refreshed = {
    photos: [
      {
        id: 1,
        moderation_status: "approved",
        preview_display_url: "new",
        media_url_expires_at: "2026-07-11T01:10:00.000Z"
      },
      { id: 3, moderation_status: "approved", preview_display_url: "new-photo" }
    ]
  };
  assert.deepEqual(mergeAlbumMediaUrls(current, refreshed), {
    photos: [
      {
        id: 1,
        moderation_status: "approved",
        preview_display_url: "new",
        local_preview_path: "wxfile://cached",
        media_url_expires_at: "2026-07-11T01:10:00.000Z"
      },
      { id: 3, moderation_status: "approved", preview_display_url: "new-photo" }
    ],
    selected_ids: [1]
  });

  let runs = 0;
  const flight = createSingleFlight();
  const first = flight.run(async () => {
    runs += 1;
    return 9;
  });
  const second = flight.run(async () => {
    runs += 1;
    return 10;
  });
  assert.equal(await first, 9);
  assert.equal(await second, 9);
  assert.equal(runs, 1);
});

test("authoritative refresh drops stale media fields when publication is revoked", () => {
  const merged = mergeAlbumMediaUrls(
    {
      photos: [{
        id: 1,
        moderation_status: "approved",
        image_url: "https://old.example/image.jpg",
        preview_display_url: "https://old.example/preview.jpg",
        display_url: "wxfile://old-preview",
        video_display_url: "https://old.example/video.mp4",
        local_preview_path: "wxfile://local"
      }]
    },
    {
      photos: [{ id: 1, moderation_status: "rejected", tags: [] }]
    }
  );

  assert.deepEqual(merged.photos, [{
    id: 1,
    moderation_status: "rejected",
    tags: []
  }]);
});

test("author-private refresh renews preview URLs while preserving page-memory preview state", () => {
  const merged = mergeAlbumMediaUrls(
    {
      photos: [{
        id: 41,
        media_type: "image",
        moderation_status: "pending",
        publication_state: "author_only",
        is_mine: true,
        can_preview: true,
        uploader_user_id: 7,
        preview_display_url: "https://old.example/preview.jpg",
        thumbnail_display_url: "https://old.example/thumbnail.jpg",
        media_url_expires_at: "2026-07-29T08:00:00.000Z",
        local_preview_path: "wxfile://page-memory-preview",
        download_url: "https://old.example/original.jpg"
      }]
    },
    {
      photos: [{
        id: 41,
        media_type: "image",
        moderation_status: "processing",
        publication_state: "author_only",
        is_mine: true,
        can_preview: true,
        uploader_user_id: 7,
        preview_display_url: "https://renewed.example/preview.jpg",
        thumbnail_display_url: "https://renewed.example/thumbnail.jpg",
        media_url_expires_at: "2026-07-29T08:01:00.000Z",
        download_url: "https://must-strip.example/original.jpg"
      }]
    }
  );

  assert.deepEqual(merged.photos, [{
    id: 41,
    media_type: "image",
    moderation_status: "processing",
    publication_state: "author_only",
    is_mine: true,
    can_preview: true,
    uploader_user_id: 7,
    preview_display_url: "https://renewed.example/preview.jpg",
    thumbnail_display_url: "https://renewed.example/thumbnail.jpg",
    media_url_expires_at: "2026-07-29T08:01:00.000Z",
    local_preview_path: "wxfile://page-memory-preview"
  }]);
});

test("ordinary unpublished refresh strips URL and local fields for existing and new rows", () => {
  const mediaFields = {
    thumbnail_display_url: "https://private.example/thumbnail-display",
    preview_display_url: "https://private.example/preview-display",
    download_url: "https://private.example/download",
    media_url_expires_at: "2026-07-29T08:01:00.000Z",
    thumbnail_url: "https://private.example/thumbnail",
    preview_url: "https://private.example/preview",
    image_url: "https://private.example/image",
    thumbnail_load_url: "https://private.example/thumbnail-load",
    preview_load_url: "https://private.example/preview-load",
    cover_url: "https://private.example/cover",
    video_url: "https://private.example/video",
    display_url: "wxfile://display",
    video_display_url: "wxfile://video-display",
    video_url_expires_at: "2026-07-29T08:01:00.000Z",
    video_load_failed: true,
    local_preview_path: "wxfile://local-preview"
  };
  const merged = mergeAlbumMediaUrls(
    {
      photos: [{ id: 1, moderation_status: "approved", ...mediaFields }]
    },
    {
      photos: [
        {
          id: 1,
          media_type: "image",
          moderation_status: "pending",
          publication_state: "public",
          tags: [],
          ...mediaFields
        },
        {
          id: 2,
          media_type: "video",
          moderation_status: "rejected",
          publication_state: "public",
          tags: [],
          ...mediaFields
        }
      ]
    }
  );

  assert.deepEqual(merged.photos, [
    {
      id: 1,
      media_type: "image",
      moderation_status: "pending",
      publication_state: "public",
      tags: []
    },
    {
      id: 2,
      media_type: "video",
      moderation_status: "rejected",
      publication_state: "public",
      tags: []
    }
  ]);
});
