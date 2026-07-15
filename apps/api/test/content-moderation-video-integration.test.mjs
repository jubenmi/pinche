import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createSessionAlbumVideo,
  updateSessionAlbumVideoProcessingResult
} from "../src/modules/core/service.js";

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

test("video intake is closed before object inspection and media insertion", async () => {
  const [service, server] = await Promise.all([
    readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8"),
    readFile(new URL("../src/server.js", import.meta.url), "utf8")
  ]);
  const createVideo = service.slice(
    service.indexOf("export async function createSessionAlbumVideo"),
    service.indexOf("export async function updateSessionAlbumVideoProcessingResult")
  );
  assert.match(createVideo, /const assertVideoIntake = options\.assertVideoIntake/);
  const gate = createVideo.indexOf("assertVideoIntake?.()");
  const inspect = createVideo.indexOf("await inspectObject(sourceUrl)");
  assert.ok(gate >= 0 && gate < inspect, "video gate must run before object inspection");

  const directIntent = server.slice(
    server.indexOf("async function createCosDirectUploadIntent"),
    server.indexOf("function normalizeCosHeaders")
  );
  const authorization = server.slice(
    server.indexOf("async function authorizeCosDirectUpload"),
    server.indexOf("async function saveUploadedObject")
  );
  assert.match(directIntent, /assertContentModerationIntake\(config\.contentModeration, "video"\)/);
  assert.match(authorization, /assertContentModerationIntake\(config\.contentModeration, "video"\)/);
});

test("a closed video intake performs no object inspection or media write", async () => {
  let inspections = 0;
  let transactions = 0;
  await assert.rejects(createSessionAlbumVideo(
    { user: { id: 3 }, roles: ["system_admin"] },
    8,
    {
      sourceUrl: "/uploads/session-album/videos/source/admin-video-8-3-1-0123456789abcdef.mp4",
      durationSeconds: 1
    },
    {
      withDatabaseConnection: async (run) => run({}),
      withTransaction: async (run) => {
        transactions += 1;
        return run({});
      },
      authorizeSessionAlbumVideoCreate: async () => {},
      assertVideoIntake: () => {
        throw Object.assign(new Error("closed"), {
          code: "CONTENT_MODERATION_INTAKE_CLOSED",
          statusCode: 503
        });
      },
      inspectObject: async () => {
        inspections += 1;
        return { byteSize: 1, contentType: "video/mp4", etag: "unexpected" };
      }
    }
  ), { code: "CONTENT_MODERATION_INTAKE_CLOSED", statusCode: 503 });
  assert.equal(inspections, 0);
  assert.equal(transactions, 0);
});

test("video creation response is a metadata-only pending placeholder", async () => {
  const service = await readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8");
  const response = service.slice(
    service.indexOf("function sessionAlbumVideoCreateResponse"),
    service.indexOf("export async function createSessionAlbumVideo")
  );
  assert.match(response, /moderation_status/);
  assert.match(response, /can_tag:\s*false/);
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

test("a late callback retains validated outputs for an active D46 rejected video", async () => {
  const media = {
    id: 74,
    session_id: 8,
    status: "active",
    media_type: "video",
    author_visibility_version: 1,
    moderation_status: "rejected",
    processing_status: "processing",
    source_url: "/uploads/session-album/videos/source/b.mp4",
    display_url: null,
    cover_url: null,
    ci_job_id: null
  };
  const updates = [];
  let cleanupCalls = 0;
  const connection = {
    async query(sql, params) {
      if (/SELECT \* FROM session_album_photos WHERE id = \? FOR UPDATE/.test(sql)) {
        return [[media]];
      }
      if (/UPDATE session_album_photos/.test(sql)) {
        updates.push({ sql, params });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  const result = await updateSessionAlbumVideoProcessingResult({
    mediaId: 74,
    status: "ready",
    sourceUrl: "/uploads/session-album/videos/source/b.mp4",
    displayUrl: "/uploads/session-album/videos/display/b.mp4",
    coverUrl: "/uploads/session-album/videos/cover/b.jpg"
  }, {
    withTransaction: async (run) => run(connection),
    enqueueRejectedMediaCleanup: async () => {
      cleanupCalls += 1;
    }
  });

  assert.equal(cleanupCalls, 0);
  assert.equal(updates.length, 1);
  assert.match(updates[0].sql, /author_visibility_version = 1/);
  assert.deepEqual(updates[0].params.slice(0, 2), [
    "/uploads/session-album/videos/display/b.mp4",
    "/uploads/session-album/videos/cover/b.jpg"
  ]);
  assert.equal(result.ignored, "moderation_rejected_retained");
  assert.equal(result.processing_status, "ready");
});

test("a callback media id cannot attach another video's source and outputs", async () => {
  const media = {
    id: 74,
    session_id: 8,
    status: "active",
    media_type: "video",
    author_visibility_version: 1,
    moderation_status: "rejected",
    processing_status: "processing",
    source_url: "/uploads/session-album/videos/source/a.mp4",
    display_url: null,
    cover_url: null,
    ci_job_id: "job-a"
  };
  let writes = 0;
  const connection = {
    async query(sql) {
      if (/SELECT \* FROM session_album_photos WHERE id = \? FOR UPDATE/.test(sql)) {
        return [[media]];
      }
      if (/UPDATE session_album_photos/.test(sql)) writes += 1;
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  await assert.rejects(updateSessionAlbumVideoProcessingResult({
    mediaId: 74,
    ciJobId: "job-b",
    status: "ready",
    sourceUrl: "/uploads/session-album/videos/source/b.mp4",
    displayUrl: "/uploads/session-album/videos/display/b.mp4",
    coverUrl: "/uploads/session-album/videos/cover/b.jpg"
  }, {
    withTransaction: async (run) => run(connection)
  }), { statusCode: 404 });
  assert.equal(writes, 0);
});

test("a callback output path must retain the immutable source object identity", async () => {
  const media = {
    id: 74,
    session_id: 8,
    status: "active",
    media_type: "video",
    author_visibility_version: 1,
    moderation_status: "rejected",
    processing_status: "processing",
    source_url: "/uploads/session-album/videos/source/a.mp4",
    display_url: null,
    cover_url: null,
    ci_job_id: "job-a"
  };
  const connection = {
    async query(sql) {
      if (/SELECT \* FROM session_album_photos WHERE id = \? FOR UPDATE/.test(sql)) {
        return [[media]];
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  await assert.rejects(updateSessionAlbumVideoProcessingResult({
    mediaId: 74,
    ciJobId: "job-a",
    status: "ready",
    sourceUrl: "/uploads/session-album/videos/source/a.mp4",
    displayUrl: "/uploads/session-album/videos/display/other.mp4"
  }, {
    withTransaction: async (run) => run(connection)
  }), { code: "BAD_REQUEST" });
});

test("a late callback for a deleting D46 rejected video only extends cleanup", async () => {
  const media = {
    id: 75,
    session_id: 8,
    status: "deleting",
    media_type: "video",
    author_visibility_version: 1,
    moderation_status: "rejected",
    processing_status: "processing",
    source_url: "/uploads/session-album/videos/source/c.mp4",
    display_url: null,
    cover_url: null
  };
  let cleanupOptions = null;
  const connection = {
    async query(sql) {
      if (/SELECT \* FROM session_album_photos WHERE id = \? FOR UPDATE/.test(sql)) {
        return [[media]];
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };
  const result = await updateSessionAlbumVideoProcessingResult({
    mediaId: 75,
    status: "ready",
    sourceUrl: "/uploads/session-album/videos/source/c.mp4",
    displayUrl: "/uploads/session-album/videos/display/c.mp4"
  }, {
    withTransaction: async (run) => run(connection),
    enqueueRejectedMediaCleanup: async (_connection, _received, options) => {
      cleanupOptions = options;
    }
  });
  assert.deepEqual(cleanupOptions, { lateOutputEvent: true });
  assert.equal(result.ignored, "moderation_rejected");
});
