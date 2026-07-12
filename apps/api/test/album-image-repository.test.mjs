import assert from "node:assert/strict";
import test from "node:test";

import {
  bindLegacyIntentByteSize,
  completeMediaCleanup,
  findAlbumImageIntent,
  findAlbumImageIntentByObjectKey,
  insertAlbumImageIntent,
  markAlbumImageIntentState,
  recordAlbumImageAuthorization
} from "../src/modules/album-image/repository.js";
import { enqueueRejectedMediaCleanup } from "../src/modules/content-moderation/repository.js";

function recordingConnection(results = []) {
  const calls = [];
  let index = 0;
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql: String(sql), values });
      return [results[index++] ?? []];
    }
  };
}

test("intent lookup can lock by uploadId or exact user plus object key", async () => {
  const connection = recordingConnection([[{ id: "upload-1" }], [{ id: "upload-1" }]]);
  await findAlbumImageIntent(connection, "upload-1", { forUpdate: true });
  await findAlbumImageIntentByObjectKey(connection, {
    userId: 9,
    objectKey: "uploads/session-album/display/a.jpg"
  }, { forUpdate: true });
  assert.match(connection.calls[0].sql, /WHERE id = \?[\s\S]*FOR UPDATE/);
  assert.match(connection.calls[1].sql, /user_id = \?[\s\S]*object_key = \?[\s\S]*FOR UPDATE/);
  assert.deepEqual(connection.calls[1].values, [9, "uploads/session-album/display/a.jpg"]);
});

test("legacy Content-Length binds once and cannot change", async () => {
  const connection = recordingConnection([{ affectedRows: 1 }]);
  assert.equal(await bindLegacyIntentByteSize(connection, {
    uploadId: "upload-1",
    byteSize: 1024
  }), true);
  assert.match(connection.calls[0].sql, /source_byte_size = COALESCE\(source_byte_size, \?\)/);
  assert.match(connection.calls[0].sql, /source_byte_size IS NULL OR source_byte_size = \?/);
  assert.deepEqual(connection.calls[0].values, [1024, "upload-1", 1024]);
});

test("insert, authorization, and state transitions stay parameterized", async () => {
  const intent = {
    id: "u1", userId: 2, sessionId: 3, kind: "sessionAlbumPhoto",
    objectKey: "uploads/session-album/display/u1.jpg", sourceContentType: "image/png",
    sourceByteSize: 100, maxSourceByteSize: 200, uploadExpiresAt: "upload",
    finalizeDeadlineAt: "finalize", cleanupNotBefore: "cleanup"
  };
  const connection = recordingConnection([
    { affectedRows: 1 }, [{ id: "u1" }], { affectedRows: 1 }, { affectedRows: 1 }
  ]);
  assert.equal((await insertAlbumImageIntent(connection, intent)).id, "u1");
  assert.equal(await recordAlbumImageAuthorization(connection, {
    uploadId: "u1", authorizationExpiresAt: "auth", cleanupNotBefore: "cleanup2"
  }), true);
  assert.equal(await markAlbumImageIntentState(connection, {
    uploadId: "u1", fromStatuses: ["pending", "processing"], toStatus: "rejected",
    errorCode: "INVALID"
  }), true);
  assert.match(connection.calls[0].sql, /INSERT INTO session_album_upload_intents/);
  assert.match(connection.calls[2].sql, /last_authorization_expires_at = GREATEST/);
  assert.match(connection.calls[3].sql, /status IN \(\?, \?\)/);
  assert.deepEqual(connection.calls[3].values, ["rejected", "INVALID", "u1", "pending", "processing"]);
});

test("a stale media cleanup worker locks media before its job and cannot complete after lease replacement", async () => {
  const connection = recordingConnection([
    [{ id: 95, status: "deleting" }],
    []
  ]);

  assert.equal(await completeMediaCleanup(connection, {
    jobId: 11,
    mediaId: 95,
    leaseToken: "stale-lease"
  }), false);

  assert.match(connection.calls[0].sql, /SELECT \* FROM session_album_photos WHERE id = \? LIMIT 1 FOR UPDATE/);
  assert.match(connection.calls[1].sql, /session_album_object_cleanup_jobs[\s\S]*status = 'leased'[\s\S]*lease_token = \?/);
  assert.equal(connection.calls.some((call) => /DELETE FROM session_album_photos/.test(call.sql)), false);
  assert.equal(connection.calls.some((call) => /UPDATE session_album_object_cleanup_jobs/.test(call.sql)), false);
});

test("a late cover invalidates an old cleanup snapshot while retaining all three objects", async () => {
  const cleanupJob = {
    id: 12,
    media_id: 97,
    storage_kind: "multi",
    object_urls_json: JSON.stringify([
      { storageKind: "cos", objectKey: "uploads/session-album/videos/source/video.mp4" },
      { storageKind: "cos", objectKey: "uploads/session-album/videos/display/video.mp4" }
    ]),
    status: "leased",
    lease_token: "old-lease",
    attempts: 4
  };
  const media = { id: 97, status: "deleting" };
  const calls = [];
  const connection = {
    async query(sql, values) {
      calls.push({ sql: String(sql), values });
      if (/session_album_object_cleanup_jobs[\s\S]*WHERE media_id = \?/.test(sql)) {
        return [[cleanupJob]];
      }
      if (/^\s*UPDATE session_album_object_cleanup_jobs/.test(sql)) {
        cleanupJob.object_urls_json = values[0];
        cleanupJob.storage_kind = "multi";
        cleanupJob.status = "pending";
        cleanupJob.lease_token = null;
        return [{ affectedRows: 1 }];
      }
      if (/SELECT \* FROM session_album_photos WHERE id = \? LIMIT 1 FOR UPDATE/.test(sql)) {
        return [[media]];
      }
      if (/session_album_object_cleanup_jobs[\s\S]*WHERE id = \? AND status = 'leased'/.test(sql)) {
        return cleanupJob.status === "leased" && cleanupJob.lease_token === values[1]
          ? [[cleanupJob]]
          : [[]];
      }
      if (/DELETE FROM session_album_photos/.test(sql)) {
        throw new Error("old cleanup lease must not delete media");
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  await enqueueRejectedMediaCleanup(connection, {
    id: 97,
    session_id: 8,
    media_type: "video",
    moderation_object_version: "etag-video-97",
    source_url: "/uploads/session-album/videos/source/video.mp4",
    display_url: "/uploads/session-album/videos/display/video.mp4",
    cover_url: "/uploads/session-album/videos/cover/video.jpg"
  });

  assert.equal(cleanupJob.status, "pending");
  assert.equal(cleanupJob.lease_token, null);
  assert.equal(cleanupJob.attempts, 4);
  assert.deepEqual(JSON.parse(cleanupJob.object_urls_json), [
    { storageKind: "cos", objectKey: "uploads/session-album/videos/source/video.mp4" },
    { storageKind: "cos", objectKey: "uploads/session-album/videos/display/video.mp4" },
    { storageKind: "cos", objectKey: "uploads/session-album/videos/cover/video.jpg" }
  ]);
  assert.equal(await completeMediaCleanup(connection, {
    jobId: 12,
    mediaId: 97,
    leaseToken: "old-lease"
  }), false);
  const completionCalls = calls.slice(calls.findIndex((call) => /SELECT \* FROM session_album_photos/.test(call.sql)));
  assert.match(completionCalls[0].sql, /session_album_photos/);
  assert.match(completionCalls[1].sql, /session_album_object_cleanup_jobs/);
});
