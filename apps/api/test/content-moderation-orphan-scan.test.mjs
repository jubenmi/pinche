import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CONTENT_MODERATION_ORPHAN_SCAN_NAMES,
  isRetainedAuthorPrivateMediaRecord,
  runContentModerationOrphanScanBatch
} from "../src/modules/content-moderation/orphan-scan.js";
import { createContentModerationOrphanScanWorker } from "../src/jobs/content-moderation-orphan-scan.js";

function createRepository({ references = [], media = [], jobs = [] } = {}) {
  const cursors = new Map();
  const calls = [];
  return {
    calls,
    async claimOrphanScanState(_connection, input) {
      calls.push({ kind: "claim", input });
      return { cursor_value: cursors.get(input.scanName) || null };
    },
    async completeOrphanScanState(_connection, input) {
      calls.push({ kind: "complete", input });
      cursors.set(input.scanName, input.cursorValue || null);
      return true;
    },
    async renewOrphanScanState(_connection, input) {
      calls.push({ kind: "renew", input });
      return true;
    },
    async releaseOrphanScanState(_connection, input) {
      calls.push({ kind: "release", input });
      return true;
    },
    async findContentModerationObjectReferences(_connection, { objectKeys }) {
      calls.push({ kind: "references", objectKeys });
      return references.filter((key) => objectKeys.includes(key));
    },
    async listModerationMediaForReconciliation(_connection, input) {
      calls.push({ kind: "media", input });
      return media;
    },
    async listMediaModerationJobsForReconciliation(_connection, input) {
      calls.push({ kind: "jobs", input });
      return jobs;
    }
  };
}

function createStorage({ objects, missingKeys = [], deleteError = null } = {}) {
  const deletes = [];
  return {
    deletes,
    async list(input) {
      assert.equal(input.prefix, "uploads/session-album/");
      return { objects, nextMarker: null };
    },
    async head(key) {
      if (missingKeys.includes(key)) {
        throw Object.assign(new Error("missing"), { code: "COS_OBJECT_NOT_FOUND" });
      }
      return { statusCode: 200 };
    },
    async delete(key) {
      deletes.push(key);
      if (deleteError) throw deleteError;
      return { statusCode: 204 };
    }
  };
}

test("D46 active rejected media remains a protected reference, never an orphan candidate", async () => {
  const key = "uploads/session-album/display/retained.jpg";
  const media = {
    id: 72,
    media_type: "image",
    status: "active",
    moderation_status: "rejected",
    moderation_object_version: "etag-72",
    author_visibility_version: 1,
    object_key: key,
    moderation_jobs: [{
      provider: "wechat_sec_check",
      subject_type: "album_image",
      subject_version: "etag-72",
      status: "rejected"
    }]
  };
  assert.equal(isRetainedAuthorPrivateMediaRecord(media), true);
  const repository = createRepository({ references: [key], media: [media] });
  const storage = createStorage({
    objects: [{ key, lastModified: "2026-07-01T08:00:00.000Z" }]
  });
  const result = await runContentModerationOrphanScanBatch({
    repository,
    storage,
    withTransaction: async (run) => run({}),
    now: () => Date.parse("2026-07-15T08:00:00.000Z"),
    randomUUID: () => "retained-scan-lease",
    limit: 10,
    retentionMs: 48 * 60 * 60 * 1000,
    cleanupEnabled: true
  });
  assert.equal(result.cos.candidates, 0);
  assert.deepEqual(storage.deletes, []);
});

test("orphan scan reports only aggregate candidates across COS, media, and moderation jobs", async () => {
  const old = "2026-07-09T08:00:00.000Z";
  const repository = createRepository({
    references: ["uploads/session-album/display/referenced.jpg"],
    media: [{
      id: 71,
      media_type: "image",
      status: "active",
      moderation_status: "pending",
      moderation_object_version: "etag-71",
      object_key: "uploads/session-album/display/missing.jpg",
      moderation_jobs: []
    }],
    jobs: [{
      id: 91,
      provider: "tencent_ci_video",
      subject_type: "album_video",
      subject_id: "81",
      subject_version: "etag-81",
      status: "processing",
      media_id: 81,
      media_type: "video",
      media_status: "active",
      media_moderation_object_version: "etag-81",
      current_attempt_id: null
    }]
  });
  const storage = createStorage({
    objects: [
      { key: "uploads/session-album/display/referenced.jpg", lastModified: old },
      { key: "uploads/session-album/display/orphan.jpg", lastModified: old },
      { key: "uploads/session-album/display/new.jpg", lastModified: "2026-07-12T07:00:00.000Z" }
    ],
    missingKeys: ["uploads/session-album/display/missing.jpg"]
  });
  const events = [];

  const result = await runContentModerationOrphanScanBatch({
    repository,
    storage,
    withTransaction: async (run) => run({}),
    emit: (event, fields) => events.push({ event, fields }),
    now: () => Date.parse("2026-07-12T08:00:00.000Z"),
    randomUUID: () => "scan-lease",
    limit: 10,
    retentionMs: 48 * 60 * 60 * 1000
  });

  assert.deepEqual(result, {
    cos: { scanned: 3, candidates: 1, deleted: 0 },
    media: { scanned: 1, inconsistencies: 2 },
    jobs: { scanned: 1, inconsistencies: 1 }
  });
  assert.deepEqual(events, [
    {
      event: "moderation_orphan_detected",
      fields: {
        outcome: "cos_unreferenced",
        orphanCount: 1,
        priority: "high"
      }
    },
    {
      event: "moderation_orphan_detected",
      fields: {
        provider: "wechat_sec_check",
        subjectType: "album_image",
        outcome: "media_object_missing",
        orphanCount: 1,
        priority: "high"
      }
    },
    {
      event: "moderation_orphan_detected",
      fields: {
        provider: "wechat_sec_check",
        subjectType: "album_image",
        outcome: "media_without_job",
        orphanCount: 1,
        priority: "high"
      }
    },
    {
      event: "moderation_orphan_detected",
      fields: {
        provider: "tencent_ci_video",
        subjectType: "album_video",
        outcome: "job_missing_current_attempt",
        orphanCount: 1,
        priority: "high"
      }
    }
  ]);
  const serialized = JSON.stringify({ events, result });
  for (const secret of ["orphan.jpg", "referenced.jpg", "missing.jpg", "etag-71", "scan-lease"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.equal(repository.calls.filter((call) => call.kind === "complete").length, 3);
  assert.deepEqual([...CONTENT_MODERATION_ORPHAN_SCAN_NAMES], [
    "cos_session_album",
    "media_session_album",
    "job_session_album"
  ]);
});

test("explicit cleanup rechecks an old unreferenced object before deleting it", async () => {
  const old = "2026-07-09T08:00:00.000Z";
  const repository = createRepository();
  const storage = createStorage({
    objects: [{ key: "uploads/session-album/display/orphan.jpg", lastModified: old }]
  });
  const events = [];

  const result = await runContentModerationOrphanScanBatch({
    repository,
    storage,
    withTransaction: async (run) => run({}),
    emit: (event, fields) => events.push({ event, fields }),
    now: () => Date.parse("2026-07-12T08:00:00.000Z"),
    randomUUID: () => "scan-lease",
    limit: 10,
    retentionMs: 48 * 60 * 60 * 1000,
    cleanupEnabled: true
  });

  assert.equal(result.cos.deleted, 1);
  assert.deepEqual(storage.deletes, ["uploads/session-album/display/orphan.jpg"]);
  assert.deepEqual(events.at(1), {
    event: "moderation_orphan_cleaned",
    fields: { outcome: "cos_unreferenced", orphanCount: 1 }
  });
});

test("orphan cleanup aborts before deletion when its scan lease can no longer be renewed", async () => {
  const repository = createRepository();
  let renewals = 0;
  repository.renewOrphanScanState = async (_connection, input) => {
    repository.calls.push({ kind: "renew", input });
    renewals += 1;
    return renewals < 4;
  };
  const storage = createStorage({
    objects: [{ key: "uploads/session-album/display/orphan.jpg", lastModified: "2026-07-09T08:00:00.000Z" }]
  });

  await assert.rejects(runContentModerationOrphanScanBatch({
    repository,
    storage,
    withTransaction: async (run) => run({}),
    now: () => Date.parse("2026-07-12T08:00:00.000Z"),
    randomUUID: () => "scan-lease",
    retentionMs: 48 * 60 * 60 * 1000,
    cleanupEnabled: true
  }), { code: "CONTENT_MODERATION_ORPHAN_SCAN_LEASE_LOST" });

  assert.deepEqual(storage.deletes, []);
  assert.equal(repository.calls.some((call) => call.kind === "complete"), false);
  assert.equal(repository.calls.some((call) => call.kind === "release"), true);
});

test("orphan scan does not report a successful batch after it loses its completion lease", async () => {
  const repository = createRepository();
  repository.completeOrphanScanState = async (_connection, input) => {
    repository.calls.push({ kind: "complete", input });
    return false;
  };

  await assert.rejects(runContentModerationOrphanScanBatch({
    repository,
    storage: createStorage({ objects: [] }),
    withTransaction: async (run) => run({}),
    now: () => Date.parse("2026-07-12T08:00:00.000Z"),
    randomUUID: () => "scan-lease",
    retentionMs: 48 * 60 * 60 * 1000
  }), { code: "CONTENT_MODERATION_ORPHAN_SCAN_LEASE_LOST" });
  assert.equal(repository.calls.some((call) => call.kind === "release"), true);
});

test("scanner rejects unsafe retention and does not inspect outside the session-album prefix", async () => {
  await assert.rejects(runContentModerationOrphanScanBatch({
    repository: createRepository(),
    storage: createStorage({ objects: [] }),
    withTransaction: async (run) => run({}),
    retentionMs: 60 * 60 * 1000
  }), /retention/);

  const repository = createRepository();
  const storage = createStorage({
    objects: [{ key: "uploads/avatars/not-session-album.jpg", lastModified: "2026-07-09T08:00:00.000Z" }]
  });
  const events = [];
  await runContentModerationOrphanScanBatch({
    repository,
    storage,
    withTransaction: async (run) => run({}),
    emit: (event, fields) => events.push({ event, fields }),
    now: () => Date.parse("2026-07-12T08:00:00.000Z"),
    randomUUID: () => "scan-lease",
    retentionMs: 48 * 60 * 60 * 1000
  });
  assert.deepEqual(events, []);
});

test("orphan scan worker stays disabled until the explicit scan gate is enabled", async () => {
  let listed = 0;
  const worker = createContentModerationOrphanScanWorker({
    repositoryModule: createRepository(),
    withTransactionFn: async (run) => run({}),
    storage: {
      async list() { listed += 1; return { objects: [], nextMarker: null }; },
      async head() { return { statusCode: 200 }; },
      async delete() { return { statusCode: 204 }; }
    },
    moderationConfig: {
      orphanScanEnabled: false,
      orphanCleanupEnabled: false,
      orphanScanBatchSize: 10,
      orphanRetentionHours: 48
    }
  });

  assert.deepEqual(await worker.runOnce(), {
    disabled: true,
    cos: { scanned: 0, candidates: 0, deleted: 0 },
    media: { scanned: 0, inconsistencies: 0 },
    jobs: { scanned: 0, inconsistencies: 0 }
  });
  assert.equal(listed, 0);
});

test("production worker wiring keeps orphan scans separately gated from destructive cleanup", async () => {
  const [compose, packageJson, envExample] = await Promise.all([
    readFile(new URL("../../../docker-compose.prod.example.yml", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../../.env.production.example", import.meta.url), "utf8")
  ]);
  assert.match(compose, /content-moderation-orphan-scan:[\s\S]*?job:content-moderation-orphan-scan/);
  assert.equal(JSON.parse(packageJson).scripts["job:content-moderation-orphan-scan"], "node src/jobs/content-moderation-orphan-scan.js");
  assert.match(envExample, /CONTENT_MODERATION_ORPHAN_SCAN_ENABLED=false/);
  assert.match(envExample, /CONTENT_MODERATION_ORPHAN_CLEANUP_ENABLED=false/);
});
