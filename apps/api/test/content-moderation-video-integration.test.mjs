import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { updateSessionAlbumVideoProcessingResult } from "../src/modules/core/service.js";

test("video inspection preserves COS ETag as the immutable moderation version", async () => {
  const [media, server] = await Promise.all([
    readFile(new URL("../src/modules/album-video/media.js", import.meta.url), "utf8"),
    readFile(new URL("../src/server.js", import.meta.url), "utf8")
  ]);
  assert.match(media, /etag:\s*metadata\.etag/);
  assert.match(server, /return \{ \.\.\.metadata, etag \}/);
});

test("video insert atomically creates and then submits a moderation job", async () => {
  const service = await readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8");
  const createVideo = service.slice(
    service.indexOf("export async function createSessionAlbumVideo"),
    service.indexOf("export async function updateSessionAlbumVideoProcessingResult")
  );
  assert.match(createVideo, /createVideoModerationJob/);
  assert.match(createVideo, /submitVideoModeration/);
  assert.match(createVideo, /moderation_status/);
  assert.match(createVideo, /subjectVersion:\s*videoObjectVersion/);
});

test("video creation response is a metadata-only pending placeholder", async () => {
  const service = await readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8");
  const response = service.slice(
    service.indexOf("function sessionAlbumVideoCreateResponse"),
    service.indexOf("export async function createSessionAlbumVideo")
  );
  assert.match(response, /moderation_status/);
  assert.doesNotMatch(response, /source_url:/);
  assert.doesNotMatch(response, /display_url:/);
  assert.doesNotMatch(response, /cover_url:/);
});

test("a late transcoding callback cannot restore display or cover after video moderation rejection", async () => {
  const service = await readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8");
  const update = service.slice(
    service.indexOf("export async function updateSessionAlbumVideoProcessingResult"),
    service.indexOf("export async function updateSessionAlbumPhotoTags")
  );
  const rejectionGuard = update.indexOf('moderation_status === "rejected"');
  const updateStatement = update.indexOf("UPDATE session_album_photos");
  assert.ok(rejectionGuard >= 0 && rejectionGuard < updateStatement);
  assert.match(update, /ignored:\s*"moderation_rejected"/);
});

test("a late rejected callback merges validated video outputs into cleanup without restoring media", async () => {
  const rejectedMedia = {
    id: 73,
    session_id: 8,
    status: "active",
    media_type: "video",
    moderation_status: "rejected",
    processing_status: "processing",
    source_url: "/uploads/session-album/videos/source/a.mp4",
    display_url: null,
    cover_url: null
  };
  const queries = [];
  const connection = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/SELECT \* FROM session_album_photos WHERE id = \? FOR UPDATE/.test(sql)) {
        return [[rejectedMedia]];
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };
  let cleanupPayload = null;
  let cleanupOptions = null;

  const result = await updateSessionAlbumVideoProcessingResult({
    mediaId: 73,
    status: "ready",
    sourceUrl: "/uploads/session-album/videos/source/a.mp4",
    displayUrl: "/uploads/session-album/videos/display/a.mp4",
    coverUrl: "/uploads/session-album/videos/cover/a.jpg"
  }, {
    withTransaction: async (run) => run(connection),
    enqueueRejectedMediaCleanup: async (receivedConnection, media, options) => {
      assert.equal(receivedConnection, connection);
      cleanupPayload = media;
      cleanupOptions = options;
      return 73;
    }
  });

  assert.deepEqual({
    source_url: cleanupPayload.source_url,
    display_url: cleanupPayload.display_url,
    cover_url: cleanupPayload.cover_url
  }, {
    source_url: "/uploads/session-album/videos/source/a.mp4",
    display_url: "/uploads/session-album/videos/display/a.mp4",
    cover_url: "/uploads/session-album/videos/cover/a.jpg"
  });
  assert.equal(rejectedMedia.moderation_status, "rejected");
  assert.equal(rejectedMedia.display_url, null);
  assert.equal(rejectedMedia.cover_url, null);
  assert.deepEqual(cleanupOptions, { lateOutputEvent: true });
  assert.equal(queries.some((query) => /UPDATE session_album_photos/.test(query.sql)), false);
  assert.deepEqual(result, {
    id: 73,
    session_id: 8,
    media_type: "video",
    processing_status: "processing",
    ignored: "moderation_rejected"
  });
});
