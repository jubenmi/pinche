import assert from "node:assert/strict";
import test from "node:test";

import {
  claimOrphanScanState,
  completeOrphanScanState,
  findContentModerationObjectReferences,
  getModerationQueueStats,
  listMediaModerationJobsForReconciliation,
  listModerationMediaForReconciliation,
  releaseOrphanScanState,
  renewOrphanScanState
} from "../src/modules/content-moderation/repository.js";

test("queue stats aggregate open moderation work by provider, subject type, and status", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return [[{
        provider: "wechat_sec_check",
        subject_type: "album_image",
        status: "pending",
        queue_depth: 2,
        oldest_age_seconds: 901
      }]];
    }
  };

  const rows = await getModerationQueueStats(connection, {
    now: new Date("2026-07-12T08:00:00.000Z")
  });

  assert.equal(rows.length, 1);
  assert.match(calls[0].sql, /status IN \('pending', 'processing', 'review', 'error'\)/);
  assert.match(calls[0].sql, /COUNT\(\*\) AS queue_depth/);
  assert.match(calls[0].sql, /TIMESTAMPDIFF\(SECOND, MIN\(created_at\), \?\)/);
  assert.match(calls[0].sql, /GROUP BY provider, subject_type, status/);
  assert.deepEqual(calls[0].params, [new Date("2026-07-12T08:00:00.000Z")]);
});

test("orphan scan state is leased, completed, and released using its opaque token", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (/SELECT scan_name, cursor_value/.test(sql)) {
        return [[{ scan_name: "cos_session_album", cursor_value: "uploads/session-album/display/a.jpg", lease_expires_at: null }]];
      }
      return [{ affectedRows: 1 }];
    }
  };
  const now = new Date("2026-07-12T08:00:00.000Z");
  const leaseExpiresAt = new Date("2026-07-12T08:05:00.000Z");

  const state = await claimOrphanScanState(connection, {
    scanName: "cos_session_album",
    leaseToken: "lease-token",
    now,
    leaseExpiresAt
  });
  assert.equal(state.cursor_value, "uploads/session-album/display/a.jpg");
  assert.equal(calls.some((call) => /INSERT INTO content_moderation_orphan_scan_state/.test(call.sql)), true);
  assert.equal(calls.some((call) => /FOR UPDATE/.test(call.sql)), true);
  assert.equal(calls.some((call) => /lease_token = \?, lease_expires_at = \?/.test(call.sql)), true);

  assert.equal(await renewOrphanScanState(connection, {
    scanName: "cos_session_album",
    leaseToken: "lease-token",
    now,
    leaseExpiresAt
  }), true);

  assert.equal(await completeOrphanScanState(connection, {
    scanName: "cos_session_album",
    leaseToken: "lease-token",
    cursorValue: null,
    now
  }), true);
  assert.equal(await releaseOrphanScanState(connection, {
    scanName: "cos_session_album",
    leaseToken: "lease-token"
  }), true);
  assert.equal(calls.some((call) => /SET cursor_value = \?, lease_token = NULL/.test(call.sql)), true);
  assert.equal(calls.some((call) => /SET lease_expires_at = \?[\s\S]*lease_expires_at > \?/.test(call.sql)), true);
  assert.equal(calls.some((call) => /lease_token = \? AND lease_expires_at > \?/.test(call.sql)), true);
  assert.equal(calls.some((call) => /SET lease_token = NULL, lease_expires_at = NULL/.test(call.sql)), true);
});

test("object reference lookup protects active media, upload intents, and multi-object cleanup jobs", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return [[
        { object_key: "uploads/session-album/display/a.jpg" },
        { object_key: "uploads/session-album/videos/cover/a.jpg" }
      ]];
    }
  };

  const keys = await findContentModerationObjectReferences(connection, {
    objectKeys: [
      "uploads/session-album/display/a.jpg",
      "uploads/session-album/videos/cover/a.jpg"
    ]
  });

  assert.deepEqual(keys, [
    "uploads/session-album/display/a.jpg",
    "uploads/session-album/videos/cover/a.jpg"
  ]);
  assert.match(calls[0].sql, /session_album_photos/);
  assert.match(calls[0].sql, /session_album_upload_intents/);
  assert.match(calls[0].sql, /session_album_object_cleanup_jobs/);
  assert.match(calls[0].sql, /JSON_TABLE/);
  assert.doesNotMatch(calls[0].sql, /SELECT \*/);
});

test("object reference lookup protects active legacy image photo_url paths before COS cleanup", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return [[{ object_key: "/uploads/session-album/display/legacy.jpg" }]];
    }
  };

  const keys = await findContentModerationObjectReferences(connection, {
    objectKeys: ["uploads/session-album/display/legacy.jpg"]
  });

  assert.deepEqual(keys, ["uploads/session-album/display/legacy.jpg"]);
  assert.match(calls[0].sql, /TRIM\(LEADING '\/' FROM photo_url\) AS object_key/);
  assert.equal(calls[0].params.length, 8);
  assert.deepEqual(calls[0].params[1], "uploads/session-album/display/legacy.jpg");
});

test("bounded reconciliation reads media and active media jobs without scanning private payloads", async () => {
  const mediaCalls = [];
  const mediaConnection = {
    async query(sql, params) {
      mediaCalls.push({ sql: String(sql), params });
      if (/FROM session_album_photos/.test(sql)) return [[{
        id: 71,
        media_type: "image",
        status: "active",
        moderation_status: "pending",
        moderation_object_version: "etag-71",
        object_key: "uploads/session-album/display/a.jpg"
      }]];
      return [[{
        id: 91,
        provider: "wechat_sec_check",
        subject_type: "album_image",
        subject_id: "71",
        subject_version: "etag-71"
      }]];
    }
  };
  const media = await listModerationMediaForReconciliation(mediaConnection, { afterId: 0, limit: 10 });
  assert.equal(media.length, 1);
  assert.equal(media[0].moderation_jobs[0].id, 91);
  assert.match(mediaCalls[0].sql, /ORDER BY id LIMIT \?/);
  assert.match(mediaCalls[1].sql, /CAST\(subject_id AS UNSIGNED\) IN/);
  assert.doesNotMatch(mediaCalls[0].sql, /photo_url|normalized_payload_json|response_summary_json/);

  const jobCalls = [];
  const jobConnection = {
    async query(sql, params) {
      jobCalls.push({ sql: String(sql), params });
      return [[{ id: 91 }]];
    }
  };
  await listMediaModerationJobsForReconciliation(jobConnection, { afterId: 0, limit: 10 });
  assert.match(jobCalls[0].sql, /job\.status IN \('pending', 'processing', 'review', 'error'\)/);
  assert.match(jobCalls[0].sql, /attempt\.is_current = 1/);
  assert.match(jobCalls[0].sql, /ORDER BY job\.id LIMIT \?/);
  assert.doesNotMatch(jobCalls[0].sql, /normalized_payload_json|response_summary_json|provider_job_id|data_id/);
});
