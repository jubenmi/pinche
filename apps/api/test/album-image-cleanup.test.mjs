import assert from "node:assert/strict";
import test from "node:test";

import { runAlbumImageCleanupBatch } from "../src/modules/album-image/cleanup.js";
import {
  claimExpiredAlbumImageIntents,
  claimAlbumObjectCleanupJobs
} from "../src/modules/album-image/repository.js";

test("claim SQL locks due work, skips locked rows, and records a 60-second lease", async () => {
  const calls = [];
  const connection = {
    async query(sql, values) {
      calls.push({ sql: String(sql), values });
      if (/^\s*SELECT/.test(sql)) return [[{ id: calls.length }]];
      return [{ affectedRows: 1 }];
    }
  };
  const input = {
    leaseToken: "lease", now: new Date(0), leaseExpiresAt: new Date(60_000), limit: 10
  };
  await claimExpiredAlbumImageIntents(connection, input);
  await claimAlbumObjectCleanupJobs(connection, input);
  assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(calls[1].sql, /lease_token = \?[\s\S]*lease_expires_at = \?/);
  assert.match(calls[2].sql, /FOR UPDATE SKIP LOCKED/);
  assert.deepEqual(calls[1].values.slice(0, 2), ["lease", new Date(60_000)]);
});

function cleanupHarness(items) {
  const state = { expired: 0, cleaned: [], failed: [], completedMedia: [] };
  const repository = {
    expireOverdueAlbumImageIntents: async () => { state.expired += 1; },
    claimAllCleanup: async () => items,
    completeIntentCleanup: async (_c, input) => state.cleaned.push(input),
    failIntentCleanup: async (_c, input) => state.failed.push(input),
    completeMediaCleanup: async (_c, input) => state.completedMedia.push(input),
    failMediaCleanup: async (_c, input) => state.failed.push(input)
  };
  return { state, repository };
}

test("orphan 404 is cleaned and retryable failure keeps its anchor", async () => {
  const missing = cleanupHarness([{ type: "intent", row: { id: "i1", object_key: "a.jpg" } }]);
  await runAlbumImageCleanupBatch({
    repository: missing.repository,
    storage: {
      head: async () => { throw Object.assign(new Error("missing"), { code: "COS_OBJECT_NOT_FOUND" }); },
      delete: async () => assert.fail("missing object must not be deleted")
    },
    withTransaction: async (run) => run({}), now: () => 1000, randomUUID: () => "lease"
  });
  assert.equal(missing.state.expired, 1);
  assert.equal(missing.state.cleaned.length, 1);

  const retry = cleanupHarness([{ type: "intent", row: { id: "i2", object_key: "b.jpg", cleanup_attempts: 0 } }]);
  await runAlbumImageCleanupBatch({
    repository: retry.repository,
    storage: {
      head: async () => ({ etag: "e" }),
      delete: async () => { throw Object.assign(new Error("upstream"), { code: "COS_UPSTREAM_ERROR" }); }
    },
    withTransaction: async (run) => run({}), now: () => 1000, randomUUID: () => "lease"
  });
  assert.equal(retry.state.cleaned.length, 0);
  assert.equal(retry.state.failed.length, 1);
  assert.equal(retry.state.failed[0].attempts, 1);
  assert.equal(retry.state.failed[0].nextRetryAt.getTime(), 61_000);
});

test("business deletion removes bytes before completing media transaction", async () => {
  const calls = [];
  const harness = cleanupHarness([{
    type: "media",
    row: { id: 7, media_id: 91, storage_kind: "cos", object_key: "photo.jpg", attempts: 0 }
  }]);
  harness.repository.completeMediaCleanup = async (_c, input) => calls.push(["db", input.mediaId]);
  await runAlbumImageCleanupBatch({
    repository: harness.repository,
    storage: { delete: async () => calls.push(["delete", "photo.jpg"]) },
    withTransaction: async (run) => run({}), now: () => 1000, randomUUID: () => "lease"
  });
  assert.deepEqual(calls, [["delete", "photo.jpg"], ["db", 91]]);
});

test("local deletion treats an already-unlinked file as idempotent", async () => {
  const harness = cleanupHarness([{
    type: "media",
    row: { id: 8, media_id: 92, storage_kind: "local", local_path: "/uploads/session-album/display/a.jpg" }
  }]);
  await runAlbumImageCleanupBatch({
    repository: harness.repository,
    storage: {},
    unlinkFile: async () => { throw Object.assign(new Error("gone"), { code: "ENOENT" }); },
    withTransaction: async (run) => run({}), now: () => 1000, randomUUID: () => "lease",
    emit: () => {}
  });
  assert.equal(harness.state.completedMedia.length, 1);
  assert.equal(harness.state.failed.length, 0);
});

test("rejected video cleanup deletes every deduplicated owned object before completing", async () => {
  const calls = [];
  const harness = cleanupHarness([{
    type: "media",
    row: {
      id: 9,
      media_id: 93,
      storage_kind: "multi",
      object_urls_json: JSON.stringify([
        { storageKind: "cos", objectKey: "source.mp4" },
        { storageKind: "cos", objectKey: "display.mp4" },
        { storageKind: "cos", objectKey: "source.mp4" }
      ])
    }
  }]);
  harness.repository.completeMediaCleanup = async (_c, input) => calls.push(["db", input.mediaId]);
  await runAlbumImageCleanupBatch({
    repository: harness.repository,
    storage: { delete: async (key) => calls.push(["delete", key]) },
    withTransaction: async (run) => run({}), now: () => 1000, randomUUID: () => "lease",
    emit: () => {}
  });
  assert.deepEqual(calls, [
    ["delete", "source.mp4"],
    ["delete", "display.mp4"],
    ["db", 93]
  ]);
});
