import assert from "node:assert/strict";
import test from "node:test";

import {
  assertModerationTransition,
  assertTextProposalTransition,
  moderationStatusForDecision
} from "../src/modules/content-moderation/state-machine.js";
import { MODERATION_ERROR_CODES } from "../src/modules/content-moderation/constants.js";
import {
  createModerationAttempt,
  createAuditLog,
  createModerationJob,
  createTextProposal,
  enqueueRejectedMediaCleanup,
  findCurrentModerationAttempt,
  findModerationAttemptByProviderJobId,
  findModerationJobByDataId,
  findModerationJobById,
  findModerationJobByProviderJobId,
  markTextProposalStatus,
  markTextProposalStale,
  recordModerationSubmission,
  retireCurrentModerationAttempt,
  transitionModerationJob
} from "../src/modules/content-moderation/repository.js";

test("decision mapping uses only approved, review, rejected, or error", () => {
  assert.equal(moderationStatusForDecision("pass"), "approved");
  assert.equal(moderationStatusForDecision("review"), "review");
  assert.equal(moderationStatusForDecision("block"), "rejected");
  assert.equal(moderationStatusForDecision("error"), "error");
  assert.throws(() => moderationStatusForDecision("allow"), /decision/i);
});

test("state machine allows spec transitions and rejects terminal reversal", () => {
  assert.doesNotThrow(() => assertModerationTransition("pending", "processing"));
  assert.doesNotThrow(() => assertModerationTransition("processing", "approved"));
  assert.doesNotThrow(() => assertModerationTransition("review", "rejected", { source: "admin" }));
  assert.doesNotThrow(() => assertModerationTransition("error", "pending", { source: "admin" }));
  assert.doesNotThrow(() => assertModerationTransition("approved", "approved"));
  assert.throws(() => assertModerationTransition("approved", "rejected"), {
    code: "CONTENT_MODERATION_INVALID_TRANSITION"
  });
  assert.throws(() => assertModerationTransition("review", "approved", { source: "provider" }), {
    code: "CONTENT_MODERATION_INVALID_TRANSITION"
  });
});

test("administrator decision prevents later provider transition", () => {
  assert.throws(() => assertModerationTransition("review", "rejected", {
    source: "provider", decidedByAdminUserId: 9
  }), { code: "CONTENT_MODERATION_INVALID_TRANSITION" });
  assert.doesNotThrow(() => assertModerationTransition("review", "approved", {
    source: "admin", decidedByAdminUserId: null
  }));
});

test("text proposals allow a terminal stale transition without adding stale to job statuses", () => {
  assert.doesNotThrow(() => assertTextProposalTransition("pending", "stale"));
  assert.throws(() => assertTextProposalTransition("stale", "approved"), {
    code: "CONTENT_MODERATION_INVALID_PROPOSAL_TRANSITION"
  });
});

test("proposal stale has a stable moderation error code without expanding job statuses", () => {
  assert.equal(MODERATION_ERROR_CODES.proposalStale, "CONTENT_MODERATION_PROPOSAL_STALE");
});

function recordingConnection(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/^\s*SELECT/i.test(sql)) return [[rows.shift() || null].filter(Boolean)];
      return [{ insertId: 41, affectedRows: 1 }];
    }
  };
}

test("job creation is idempotent on immutable subject version", async () => {
  const connection = recordingConnection([{ id: 41, status: "pending" }]);
  const job = await createModerationJob(connection, {
    subjectType: "album_image",
    subjectId: "7",
    subjectVersion: "etag-1",
    provider: "tencent_ci_video",
    dataId: "data-1",
    policyId: "policy-1"
  });

  assert.equal(job.id, 41);
  assert.match(connection.calls[0].sql, /ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID\(id\)/i);
  assert.deepEqual(connection.calls[0].params.slice(0, 3), ["album_image", "7", "etag-1"]);
  assert.equal(connection.calls[0].params[3], "tencent_ci_video");
});

test("job lookup methods can lock exact identifiers", async () => {
  const connection = recordingConnection([
    { id: 1 }, { id: 2 }, { id: 3 }
  ]);
  await findModerationJobById(connection, 1, { forUpdate: true });
  await findModerationJobByDataId(connection, "data", { forUpdate: true });
  await findModerationJobByProviderJobId(connection, "tencent_ci_video", "job", { forUpdate: true });
  assert.equal(connection.calls.every(({ sql }) => /FOR UPDATE/.test(sql)), true);
  assert.deepEqual(connection.calls.map(({ params }) => params), [[1], ["data"], ["tencent_ci_video", "job"]]);
});

test("provider attempts retain every provider job while exposing exactly one current attempt", async () => {
  const connection = recordingConnection([{ id: 7 }, { id: 8 }]);

  await retireCurrentModerationAttempt(connection, { jobId: 41 });
  const attempt = await createModerationAttempt(connection, {
    jobId: 41,
    provider: "tencent_ci_video",
    providerJobId: "video-job-2",
    attemptNo: 2,
    responseSummary: { state: "Submitted" }
  });
  await findModerationAttemptByProviderJobId(
    connection,
    "tencent_ci_video",
    "video-job-2",
    { forUpdate: true }
  );
  await findCurrentModerationAttempt(connection, 41, { forUpdate: true });

  assert.equal(attempt.id, 41);
  assert.match(connection.calls[0].sql, /SET is_current = 0/);
  assert.match(connection.calls[0].sql, /is_current = 1/);
  assert.match(connection.calls[1].sql, /content_moderation_provider_attempts/);
  assert.match(connection.calls[1].sql, /attempt_no/);
  assert.deepEqual(connection.calls[1].params.slice(0, 4), [41, "tencent_ci_video", "video-job-2", 2]);
  assert.match(connection.calls[2].sql, /provider_job_id = \?/);
  assert.match(connection.calls[2].sql, /FOR UPDATE/);
  assert.match(connection.calls[3].sql, /is_current = 1/);
  assert.match(connection.calls[3].sql, /FOR UPDATE/);
});

test("provider-scoped attempts preserve WeChat trace IDs and Tencent video JobIds", async () => {
  const connection = recordingConnection();

  await createModerationAttempt(connection, {
    jobId: 51,
    provider: "wechat_sec_check",
    providerJobId: "wechat-trace-51",
    attemptNo: 1
  });
  await createModerationAttempt(connection, {
    jobId: 52,
    provider: "tencent_ci_video",
    providerJobId: "ci-job-52",
    attemptNo: 1
  });

  assert.deepEqual(connection.calls[0].params.slice(0, 4), [
    51, "wechat_sec_check", "wechat-trace-51", 1
  ]);
  assert.deepEqual(connection.calls[1].params.slice(0, 4), [
    52, "tencent_ci_video", "ci-job-52", 1
  ]);
});

test("submission rolls over a current provider attempt before moving the job to processing", async () => {
  const connection = recordingConnection([{
    id: 41,
    provider: "tencent_ci_video",
    status: "error",
    attempt_count: 1,
    decided_by_admin_user_id: null,
    lease_token: "lease-1"
  }]);

  const changed = await recordModerationSubmission(connection, {
    jobId: 41,
    provider: "tencent_ci_video",
    providerJobId: "video-job-2",
    fromStatus: "error",
    leaseToken: "lease-1",
    responseSummary: { state: "Submitted" }
  });

  assert.equal(changed, true);
  assert.match(connection.calls[0].sql, /FROM content_moderation_jobs/);
  assert.match(connection.calls[1].sql, /SET is_current = 0/);
  assert.match(connection.calls[2].sql, /INSERT INTO content_moderation_provider_attempts/);
  assert.match(connection.calls[3].sql, /SET status = 'processing'/);
  assert.match(connection.calls[3].sql, /lease_token = \?/);
  assert.deepEqual(connection.calls[3].params.slice(-4), [41, "error", "lease-1", "lease-1"]);
});

test("provider transitions are conditional and do not overwrite admin decisions", async () => {
  const connection = recordingConnection();
  const changed = await transitionModerationJob(connection, {
    jobId: 4,
    fromStatus: "processing",
    toStatus: "approved",
    source: "provider",
    result: { suggestion: "Pass", label: "Normal", subLabel: "", score: 1 }
  });
  assert.equal(changed, true);
  assert.match(connection.calls[0].sql, /decided_by_admin_user_id IS NULL/i);
  assert.match(connection.calls[0].sql, /WHERE id = \? AND status = \?/i);
});

test("text proposal and audit inserts preserve base version and decision trail", async () => {
  const connection = recordingConnection();
  await createTextProposal(connection, {
    jobId: 4,
    subjectType: "user_nickname",
    subjectId: "8",
    baseVersion: "v1",
    action: "update_nickname",
    idempotencyKey: "request-8-1",
    normalizedPayload: { nickname: "Alice" },
    payloadDigest: "a".repeat(64),
    userId: 8
  });
  await createAuditLog(connection, {
    jobId: 4,
    adminUserId: 2,
    action: "reject",
    previousStatus: "review",
    nextStatus: "rejected",
    reason: "违规"
  });
  const proposalInsert = connection.calls.find(({ sql }) => /INSERT INTO content_moderation_text_proposals/.test(sql));
  const auditInsert = connection.calls.find(({ sql }) => /content_moderation_audit_logs/.test(sql));
  assert.match(proposalInsert.sql, /content_moderation_text_proposals/);
  assert.equal(proposalInsert.params.includes("v1"), true);
  assert.equal(proposalInsert.params.includes("update_nickname"), true);
  assert.equal(proposalInsert.params.includes("request-8-1"), true);
  assert.match(auditInsert.sql, /content_moderation_audit_logs/);
  assert.equal(auditInsert.params.at(-1), "违规");
});

function proposalLookupConnection(existingProposal) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (/created_by_user_id = \? AND action = \? AND idempotency_key = \?/s.test(sql)) {
        return [[existingProposal].filter(Boolean)];
      }
      if (/moderation_job_id = \?/s.test(sql)) return [[]];
      if (/INSERT INTO content_moderation_text_proposals/s.test(sql)) {
        throw new Error("new proposal must not be inserted after an idempotency collision");
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };
}

test("text proposal reuses only the same job and payload under an idempotency key", async () => {
  const connection = proposalLookupConnection({
    id: 51,
    moderation_job_id: 4,
    payload_digest: "a".repeat(64),
    action: "update_nickname",
    idempotency_key: "request-8-1"
  });

  const proposalId = await createTextProposal(connection, {
    jobId: 4,
    subjectType: "user_nickname",
    subjectId: "8",
    baseVersion: "v1",
    action: "update_nickname",
    idempotencyKey: "request-8-1",
    normalizedPayload: { nickname: "Alice" },
    payloadDigest: "a".repeat(64),
    userId: 8
  });

  assert.equal(proposalId, 51);
  assert.equal(connection.calls.some(({ sql }) => /INSERT INTO/.test(sql)), false);
});

test("text proposal rejects an idempotency key owned by a different moderation job", async () => {
  const connection = proposalLookupConnection({
    id: 51,
    moderation_job_id: 4,
    payload_digest: "a".repeat(64),
    action: "update_nickname",
    idempotency_key: "request-8-1"
  });

  await assert.rejects(createTextProposal(connection, {
    jobId: 99,
    subjectType: "user_nickname",
    subjectId: "8",
    baseVersion: "v1",
    action: "update_nickname",
    idempotencyKey: "request-8-1",
    normalizedPayload: { nickname: "Alice" },
    payloadDigest: "a".repeat(64),
    userId: 8
  }), { code: "CONTENT_MODERATION_IDEMPOTENCY_CONFLICT" });

  assert.equal(connection.calls.some(({ sql }) => /INSERT INTO/.test(sql)), false);
});

test("text proposal rejects a changed payload under the same job and idempotency key", async () => {
  const connection = proposalLookupConnection({
    id: 51,
    moderation_job_id: 4,
    payload_digest: "a".repeat(64),
    action: "update_nickname",
    idempotency_key: "request-8-1"
  });

  await assert.rejects(createTextProposal(connection, {
    jobId: 4,
    subjectType: "user_nickname",
    subjectId: "8",
    baseVersion: "v1",
    action: "update_nickname",
    idempotencyKey: "request-8-1",
    normalizedPayload: { nickname: "Bob" },
    payloadDigest: "b".repeat(64),
    userId: 8
  }), { code: "CONTENT_MODERATION_IDEMPOTENCY_CONFLICT" });

  assert.equal(connection.calls.some(({ sql }) => /INSERT INTO/.test(sql)), false);
});

test("a stale proposal permits only an explicit idempotency retry to return its stale result", async () => {
  const connection = proposalLookupConnection({
    id: 51,
    moderation_job_id: 4,
    payload_digest: "a".repeat(64),
    action: "update_nickname",
    idempotency_key: "request-8-1",
    status: "stale"
  });

  const proposalId = await createTextProposal(connection, {
    jobId: 4,
    subjectType: "user_nickname",
    subjectId: "8",
    baseVersion: "v2",
    action: "update_nickname",
    idempotencyKey: "request-8-1",
    allowStaleIdempotencyReplay: true,
    normalizedPayload: { nickname: "Alice" },
    payloadDigest: "b".repeat(64),
    userId: 8
  });

  assert.equal(proposalId, 51);
  assert.equal(connection.calls.some(({ sql }) => /INSERT INTO/.test(sql)), false);
});

test("text proposal resolves a concurrent duplicate insert only when it matches the same request", async () => {
  const calls = [];
  let idempotencyLookups = 0;
  const connection = {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (/created_by_user_id = \? AND action = \? AND idempotency_key = \?/s.test(sql)) {
        idempotencyLookups += 1;
        return idempotencyLookups === 1 ? [[]] : [[{
          id: 52,
          moderation_job_id: 4,
          payload_digest: "a".repeat(64),
          action: "update_nickname",
          idempotency_key: "request-8-1"
        }]];
      }
      if (/moderation_job_id = \?/s.test(sql)) return [[]];
      if (/INSERT INTO content_moderation_text_proposals/s.test(sql)) {
        throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY", errno: 1062 });
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  const proposalId = await createTextProposal(connection, {
    jobId: 4,
    subjectType: "user_nickname",
    subjectId: "8",
    baseVersion: "v1",
    action: "update_nickname",
    idempotencyKey: "request-8-1",
    normalizedPayload: { nickname: "Alice" },
    payloadDigest: "a".repeat(64),
    userId: 8
  });

  assert.equal(proposalId, 52);
  assert.equal(idempotencyLookups, 2);
});

test("text proposal can become terminal stale without adding a global moderation-job status", async () => {
  const connection = recordingConnection();
  const changed = await markTextProposalStale(connection, {
    jobId: 41,
    fromStatus: "pending"
  });

  assert.equal(changed, true);
  assert.match(connection.calls[0].sql, /SET status = 'stale'/);
  assert.match(connection.calls[0].sql, /status = \?/);
  assert.deepEqual(connection.calls[0].params, [41, "pending"]);
});

test("approved text proposals persist only the safe application result needed for idempotent replay", async () => {
  const connection = recordingConnection();

  const changed = await markTextProposalStatus(connection, {
    jobId: 41,
    fromStatus: "pending",
    toStatus: "approved",
    appliedResult: { id: 88, kind: "session" }
  });

  assert.equal(changed, true);
  assert.match(connection.calls[0].sql, /applied_result_json = IF\(\? = 'approved', \?, applied_result_json\)/);
  assert.equal(connection.calls[0].params.includes(JSON.stringify({ id: 88, kind: "session" })), true);
});

test("approved proposal replay data strips content and URLs", async () => {
  const connection = recordingConnection();

  await markTextProposalStatus(connection, {
    jobId: 41,
    fromStatus: "pending",
    toStatus: "approved",
    appliedResult: {
      id: 88,
      kind: "session_message",
      content: "private text",
      photo_url: "https://private.example.com/signature"
    }
  });

  const stored = connection.calls[0].params.find((value) => typeof value === "string" && value.startsWith("{"));
  assert.deepEqual(JSON.parse(stored), { id: 88, kind: "session_message" });
});

test("rejected local video cleanup keeps source, display, and cover as local paths", async () => {
  const connection = recordingConnection();
  await enqueueRejectedMediaCleanup(connection, {
    id: 71,
    session_id: 8,
    media_type: "video",
    moderation_object_version: "local:/uploads/session-album/videos/source/a.mp4:1200",
    source_url: "/uploads/session-album/videos/source/a.mp4",
    display_url: "/uploads/session-album/videos/display/a.mp4",
    cover_url: "/uploads/session-album/videos/cover/a.jpg"
  });

  const insert = connection.calls.find((call) => /INSERT INTO session_album_object_cleanup_jobs/.test(call.sql));
  assert.equal(insert.params[2], "multi");
  assert.deepEqual(JSON.parse(insert.params[5]), [
    { storageKind: "local", localPath: "/uploads/session-album/videos/source/a.mp4" },
    { storageKind: "local", localPath: "/uploads/session-album/videos/display/a.mp4" },
    { storageKind: "local", localPath: "/uploads/session-album/videos/cover/a.jpg" }
  ]);
});

test("rejected COS video cleanup keeps every owned source, display, and cover key", async () => {
  const connection = recordingConnection();
  await enqueueRejectedMediaCleanup(connection, {
    id: 72,
    session_id: 8,
    media_type: "video",
    moderation_object_version: "etag-video-72",
    source_url: "/uploads/session-album/videos/source/a.mp4",
    display_url: "/uploads/session-album/videos/display/a.mp4",
    cover_url: "/uploads/session-album/videos/cover/a.jpg"
  });

  const insert = connection.calls.find((call) => /INSERT INTO session_album_object_cleanup_jobs/.test(call.sql));
  assert.deepEqual(JSON.parse(insert.params[5]), [
    { storageKind: "cos", objectKey: "uploads/session-album/videos/source/a.mp4" },
    { storageKind: "cos", objectKey: "uploads/session-album/videos/display/a.mp4" },
    { storageKind: "cos", objectKey: "uploads/session-album/videos/cover/a.jpg" }
  ]);
});

test("duplicate rejected video cleanup merges a late cover into the same COS job", async () => {
  const existing = {
    id: 73,
    media_id: 73,
    storage_kind: "multi",
    object_urls_json: JSON.stringify([
      { storageKind: "cos", objectKey: "uploads/session-album/videos/source/a.mp4" },
      { storageKind: "cos", objectKey: "uploads/session-album/videos/display/a.mp4" }
    ]),
    status: "leased"
  };
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT \* FROM session_album_object_cleanup_jobs/.test(sql)) return [[existing]];
      return [{ insertId: 73, affectedRows: 1 }];
    }
  };

  await enqueueRejectedMediaCleanup(connection, {
    id: 73,
    session_id: 8,
    media_type: "video",
    moderation_object_version: "etag-video-73",
    source_url: "/uploads/session-album/videos/source/a.mp4",
    display_url: "/uploads/session-album/videos/display/a.mp4",
    cover_url: "/uploads/session-album/videos/cover/a.jpg"
  });

  const update = calls.find((call) => /UPDATE session_album_object_cleanup_jobs/.test(call.sql));
  assert.ok(update, "late output must update the existing cleanup job rather than be discarded");
  assert.match(calls[0].sql, /WHERE media_id = \? LIMIT 1 FOR UPDATE/);
  assert.match(update.sql, /status = 'pending'/);
  assert.match(update.sql, /lease_token = NULL/);
  assert.doesNotMatch(update.sql, /\battempts\s*=/);
  assert.deepEqual(JSON.parse(update.params[0]), [
    { storageKind: "cos", objectKey: "uploads/session-album/videos/source/a.mp4" },
    { storageKind: "cos", objectKey: "uploads/session-album/videos/display/a.mp4" },
    { storageKind: "cos", objectKey: "uploads/session-album/videos/cover/a.jpg" }
  ]);
});

test("duplicate insert re-reads and merges a late cover even when affectedRows reports one", async () => {
  const existing = {
    id: 75,
    media_id: 75,
    storage_kind: "multi",
    object_urls_json: JSON.stringify([
      { storageKind: "cos", objectKey: "uploads/session-album/videos/source/a.mp4" },
      { storageKind: "cos", objectKey: "uploads/session-album/videos/display/a.mp4" }
    ]),
    status: "pending"
  };
  const calls = [];
  let cleanupReads = 0;
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT \* FROM session_album_object_cleanup_jobs/.test(sql)) {
        cleanupReads += 1;
        return cleanupReads === 1 ? [[]] : [[existing]];
      }
      if (/INSERT INTO session_album_object_cleanup_jobs/.test(sql)) {
        return [{ insertId: 75, affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    }
  };

  await enqueueRejectedMediaCleanup(connection, {
    id: 75,
    session_id: 8,
    media_type: "video",
    moderation_object_version: "etag-video-75",
    source_url: "/uploads/session-album/videos/source/a.mp4",
    display_url: "/uploads/session-album/videos/display/a.mp4",
    cover_url: "/uploads/session-album/videos/cover/a.jpg"
  });

  assert.equal(cleanupReads, 2);
  const update = calls.find((call) => /UPDATE session_album_object_cleanup_jobs/.test(call.sql));
  assert.ok(update);
  assert.deepEqual(JSON.parse(update.params[0]), [
    { storageKind: "cos", objectKey: "uploads/session-album/videos/source/a.mp4" },
    { storageKind: "cos", objectKey: "uploads/session-album/videos/display/a.mp4" },
    { storageKind: "cos", objectKey: "uploads/session-album/videos/cover/a.jpg" }
  ]);
});

for (const status of ["cleaned", "leased"]) {
  test(`late same-key video output requeues a ${status} cleanup job`, async () => {
    const expectedEntries = [
      { storageKind: "cos", objectKey: "uploads/session-album/videos/source/a.mp4" },
      { storageKind: "cos", objectKey: "uploads/session-album/videos/display/a.mp4" },
      { storageKind: "cos", objectKey: "uploads/session-album/videos/cover/a.jpg" }
    ];
    const existing = {
      id: status === "cleaned" ? 76 : 77,
      media_id: status === "cleaned" ? 76 : 77,
      storage_kind: "multi",
      object_urls_json: JSON.stringify(expectedEntries),
      status,
      lease_token: status === "leased" ? "old-lease" : null,
      attempts: 5
    };
    const calls = [];
    const connection = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (/SELECT \* FROM session_album_object_cleanup_jobs/.test(sql)) return [[existing]];
        return [{ affectedRows: 1 }];
      }
    };

    await enqueueRejectedMediaCleanup(connection, {
      id: existing.id,
      session_id: 8,
      media_type: "video",
      moderation_object_version: `etag-video-${existing.id}`,
      source_url: "/uploads/session-album/videos/source/a.mp4",
      display_url: "/uploads/session-album/videos/display/a.mp4",
      cover_url: "/uploads/session-album/videos/cover/a.jpg"
    }, { lateOutputEvent: true });

    const update = calls.find((call) => /UPDATE session_album_object_cleanup_jobs/.test(call.sql));
    assert.ok(update, "a validated late output must requeue even when its object key is unchanged");
    assert.match(update.sql, /status = 'pending'/);
    assert.match(update.sql, /lease_token = NULL/);
    assert.match(update.sql, /completed_at = NULL/);
    assert.doesNotMatch(update.sql, /\battempts\s*=/);
    assert.deepEqual(JSON.parse(update.params[0]), expectedEntries);
  });
}

test("ordinary duplicate rejected video cleanup does not requeue a cleaned job", async () => {
  const existing = {
    id: 78,
    media_id: 78,
    storage_kind: "multi",
    object_urls_json: JSON.stringify([
      { storageKind: "cos", objectKey: "uploads/session-album/videos/source/a.mp4" },
      { storageKind: "cos", objectKey: "uploads/session-album/videos/display/a.mp4" },
      { storageKind: "cos", objectKey: "uploads/session-album/videos/cover/a.jpg" }
    ]),
    status: "cleaned",
    attempts: 5
  };
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT \* FROM session_album_object_cleanup_jobs/.test(sql)) return [[existing]];
      return [{ affectedRows: 1 }];
    }
  };

  await enqueueRejectedMediaCleanup(connection, {
    id: 78,
    session_id: 8,
    media_type: "video",
    moderation_object_version: "etag-video-78",
    source_url: "/uploads/session-album/videos/source/a.mp4",
    display_url: "/uploads/session-album/videos/display/a.mp4",
    cover_url: "/uploads/session-album/videos/cover/a.jpg"
  });

  assert.equal(calls.some((call) => /UPDATE session_album_object_cleanup_jobs/.test(call.sql)), false);
});

test("duplicate rejected video cleanup preserves local ownership while merging a late cover", async () => {
  const existing = {
    id: 74,
    media_id: 74,
    storage_kind: "multi",
    object_urls_json: JSON.stringify([
      { storageKind: "local", localPath: "/uploads/session-album/videos/source/a.mp4" },
      { storageKind: "local", localPath: "/uploads/session-album/videos/display/a.mp4" }
    ]),
    status: "pending"
  };
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT \* FROM session_album_object_cleanup_jobs/.test(sql)) return [[existing]];
      return [{ insertId: 74, affectedRows: 1 }];
    }
  };

  await enqueueRejectedMediaCleanup(connection, {
    id: 74,
    session_id: 8,
    media_type: "video",
    moderation_object_version: "local:/uploads/session-album/videos/source/a.mp4:1200",
    source_url: "/uploads/session-album/videos/source/a.mp4",
    display_url: "/uploads/session-album/videos/display/a.mp4",
    cover_url: "/uploads/session-album/videos/cover/a.jpg"
  });

  const update = calls.find((call) => /UPDATE session_album_object_cleanup_jobs/.test(call.sql));
  assert.ok(update);
  assert.deepEqual(JSON.parse(update.params[0]), [
    { storageKind: "local", localPath: "/uploads/session-album/videos/source/a.mp4" },
    { storageKind: "local", localPath: "/uploads/session-album/videos/display/a.mp4" },
    { storageKind: "local", localPath: "/uploads/session-album/videos/cover/a.jpg" }
  ]);
});
