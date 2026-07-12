import assert from "node:assert/strict";
import test from "node:test";

import {
  assertModerationTransition,
  moderationStatusForDecision
} from "../src/modules/content-moderation/state-machine.js";
import {
  createAuditLog,
  createModerationJob,
  createTextProposal,
  findModerationJobByDataId,
  findModerationJobById,
  findModerationJobByProviderJobId,
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
    provider: "tencent_ci",
    dataId: "data-1",
    policyId: "policy-1"
  });

  assert.equal(job.id, 41);
  assert.match(connection.calls[0].sql, /ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID\(id\)/i);
  assert.deepEqual(connection.calls[0].params.slice(0, 3), ["album_image", "7", "etag-1"]);
});

test("job lookup methods can lock exact identifiers", async () => {
  const connection = recordingConnection([
    { id: 1 }, { id: 2 }, { id: 3 }
  ]);
  await findModerationJobById(connection, 1, { forUpdate: true });
  await findModerationJobByDataId(connection, "data", { forUpdate: true });
  await findModerationJobByProviderJobId(connection, "tencent_ci", "job", { forUpdate: true });
  assert.equal(connection.calls.every(({ sql }) => /FOR UPDATE/.test(sql)), true);
  assert.deepEqual(connection.calls.map(({ params }) => params), [[1], ["data"], ["tencent_ci", "job"]]);
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
  assert.match(connection.calls[0].sql, /content_moderation_text_proposals/);
  assert.equal(connection.calls[0].params.includes("v1"), true);
  assert.match(connection.calls[1].sql, /content_moderation_audit_logs/);
  assert.equal(connection.calls[1].params.at(-1), "违规");
});

