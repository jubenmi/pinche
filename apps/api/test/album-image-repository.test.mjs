import assert from "node:assert/strict";
import test from "node:test";

import {
  bindLegacyIntentByteSize,
  findAlbumImageIntent,
  findAlbumImageIntentByObjectKey,
  insertAlbumImageIntent,
  markAlbumImageIntentState,
  recordAlbumImageAuthorization
} from "../src/modules/album-image/repository.js";

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
