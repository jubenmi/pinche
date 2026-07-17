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

test("every video business transaction locks settings before authorization and business rows", async () => {
  const service = await readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8");
  const createVideo = service.slice(
    service.indexOf("export async function createSessionAlbumVideo"),
    service.indexOf("export async function updateSessionAlbumVideoProcessingResult")
  );
  for (const [startMarker, endMarker, businessMarker] of [
    ["findExisting:", "insert:", "findActiveSessionAlbumVideoBySource"],
    ["insert:", "findAfterDuplicateOnFreshConnection:", "INSERT INTO session_album_photos"],
    ["findAfterDuplicateOnFreshConnection:", "});\n\n  if (moderationJob", "findActiveSessionAlbumVideoBySource"]
  ]) {
    const start = createVideo.indexOf(startMarker);
    const end = createVideo.indexOf(endMarker, start + startMarker.length);
    const branch = createVideo.slice(start, end);
    assert.ok(branch.indexOf("assertVideoIntake?.(connection)") >= 0, startMarker);
    assert.ok(
      branch.indexOf("assertVideoIntake?.(connection)") < branch.indexOf("await authorize(connection"),
      `${startMarker} must lock settings before authorization`
    );
    assert.ok(
      branch.indexOf("await authorize(connection") < branch.indexOf(businessMarker),
      `${startMarker} must authorize before business rows`
    );
  }
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
  const gate = createVideo.indexOf("assertVideoIntake?.(");
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
  assert.match(directIntent, /await resolveContentSecurityIntake\("video"\)/);
  assert.match(authorization, /await resolveContentSecurityIntake\("video"\)/);
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

test("an asynchronous video intake decision settles before object inspection", async () => {
  let releaseIntake;
  let inspections = 0;
  const pending = createSessionAlbumVideo(
    { user: { id: 3 }, roles: ["system_admin"] },
    8,
    {
      sourceUrl: "/uploads/session-album/videos/source/admin-video-8-3-1-0123456789abcdef.mp4",
      durationSeconds: 1
    },
    {
      withDatabaseConnection: async (run) => run({}),
      authorizeSessionAlbumVideoCreate: async () => {},
      assertVideoIntake: () => new Promise((resolve) => { releaseIntake = resolve; }),
      inspectObject: async () => {
        inspections += 1;
        throw new Error("stop after inspection");
      }
    }
  );
  pending.catch(() => {});

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(inspections, 0);
  releaseIntake();
  await assert.rejects(pending, /stop after inspection/);
  assert.equal(inspections, 1);
});

test("direct video fallback writes approved legacy and creates no moderation job", async () => {
  let insertValues = null;
  let moderationJobs = 0;
  const intakeConnections = [];
  const timeline = [];
  const media = {
    id: 91,
    session_id: 8,
    uploader_user_id: 3,
    media_type: "video",
    processing_status: "ready",
    moderation_status: "approved_legacy",
    status: "active"
  };
  const connection = {
    async query(sql, values = []) {
      if (String(sql).includes("WHERE photo.session_id")) {
        timeline.push("find_business");
        return [[]];
      }
      if (String(sql).includes("INSERT INTO session_album_photos")) {
        timeline.push("insert_business");
        insertValues = values;
        return [{ insertId: media.id }];
      }
      if (String(sql).includes("SELECT * FROM session_album_photos WHERE id")) {
        return [[media]];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }
  };
  const readConnection = {};

  const result = await createSessionAlbumVideo(
    { user: { id: 3 }, roles: ["system_admin"] },
    8,
    {
      sourceUrl: "/uploads/session-album/videos/source/admin-video-8-3-1-0123456789abcdef.mp4",
      durationSeconds: 1
    },
    {
      withDatabaseConnection: async (run) => run(readConnection),
      withTransaction: async (run) => {
        timeline.push("transaction_begin");
        const value = await run(connection);
        timeline.push("transaction_commit");
        return value;
      },
      authorizeSessionAlbumVideoCreate: async (currentConnection) => {
        timeline.push(currentConnection === connection ? "authorize" : "preflight_authorize");
      },
      assertVideoIntake: async (currentConnection) => {
        intakeConnections.push(currentConnection);
        timeline.push(currentConnection === connection ? "final_intake" : "preflight_intake");
        return { moderationRequired: false };
      },
      inspectObject: async () => ({ byteSize: 1, contentType: "video/mp4", etag: "etag-1" }),
      createVideoModerationJob: async () => {
        moderationJobs += 1;
        return { id: 51 };
      }
    }
  );

  assert.equal(insertValues.includes("approved_legacy"), true);
  assert.equal(result.moderation_status, "approved_legacy");
  assert.equal(result.moderation_message, null);
  assert.equal(result.can_tag, true);
  assert.equal(moderationJobs, 0);
  assert.equal(intakeConnections[0], undefined);
  assert.ok(intakeConnections.slice(1).every((value) => value === connection));
  assert.deepEqual(timeline, [
    "preflight_authorize",
    "preflight_intake",
    "transaction_begin",
    "final_intake",
    "authorize",
    "find_business",
    "transaction_commit",
    "transaction_begin",
    "final_intake",
    "authorize",
    "insert_business",
    "transaction_commit"
  ]);
});

test("missing lower-level video intake wiring defaults to approved legacy", async () => {
  let insertValues = null;
  const media = {
    id: 92, session_id: 8, uploader_user_id: 3, media_type: "video",
    processing_status: "ready", moderation_status: "approved_legacy", status: "active"
  };
  const connection = {
    async query(sql, values = []) {
      if (String(sql).includes("WHERE photo.session_id")) return [[]];
      if (String(sql).includes("INSERT INTO session_album_photos")) {
        insertValues = values;
        return [{ insertId: media.id }];
      }
      if (String(sql).includes("SELECT * FROM session_album_photos WHERE id")) return [[media]];
      throw new Error(`unexpected SQL: ${sql}`);
    }
  };
  const result = await createSessionAlbumVideo(
    { user: { id: 3 }, roles: ["system_admin"] }, 8,
    { sourceUrl: "/uploads/session-album/videos/source/admin-video-8-3-1-0123456789abcdef.mp4", durationSeconds: 1 },
    {
      withDatabaseConnection: async (run) => run(connection),
      withTransaction: async (run) => run(connection),
      authorizeSessionAlbumVideoCreate: async () => {},
      inspectObject: async () => ({ byteSize: 1, contentType: "video/mp4", etag: "etag-2" }),
      readyOnCreate: true
    }
  );
  assert.equal(insertValues.includes("approved_legacy"), true);
  assert.equal(result.moderation_status, "approved_legacy");
});

test("required video moderation without a job hook fails before INSERT", async () => {
  let inserts = 0;
  const connection = {
    async query(sql) {
      if (String(sql).includes("WHERE photo.session_id")) return [[]];
      if (String(sql).includes("INSERT INTO session_album_photos")) inserts += 1;
      throw new Error(`unexpected SQL: ${sql}`);
    }
  };
  await assert.rejects(createSessionAlbumVideo(
    { user: { id: 3 }, roles: ["system_admin"] }, 8,
    { sourceUrl: "/uploads/session-album/videos/source/admin-video-8-3-1-0123456789abcdef.mp4", durationSeconds: 1 },
    {
      withDatabaseConnection: async (run) => run(connection),
      withTransaction: async (run) => run(connection),
      authorizeSessionAlbumVideoCreate: async () => {},
      assertVideoIntake: async () => ({ moderationRequired: true }),
      inspectObject: async () => ({ byteSize: 1, contentType: "video/mp4", etag: "etag-3" })
    }
  ), { code: "CONTENT_MODERATION_CONFIGURATION_ERROR", statusCode: 500 });
  assert.equal(inserts, 0);
});

test("video creation response is metadata-only and tags only a published fallback", async () => {
  const service = await readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8");
  const response = service.slice(
    service.indexOf("function sessionAlbumVideoCreateResponse"),
    service.indexOf("export async function createSessionAlbumVideo")
  );
  assert.match(response, /moderation_status/);
  assert.match(response, /const published = isModerationPublished\(moderationStatus\)/);
  assert.match(response, /can_tag:\s*published/);
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
