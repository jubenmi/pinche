import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createAuthorDraftService } from "../src/modules/content-moderation/author-drafts.js";
import {
  cancelModerationJobByUser,
  cancelTextProposalByAuthor,
  createTextProposal,
  findAuthorTextDraftById,
  findLatestAuthorTextProposal,
  supersedeRejectedTextProposal
} from "../src/modules/content-moderation/repository.js";

function queryRecorder(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (/^\s*SELECT/i.test(sql)) return [rows.shift() || []];
      return [{ insertId: 51, affectedRows: 1 }];
    }
  };
}

test("D46 proposal creation persists an exact target and immutable policy version", async () => {
  const connection = queryRecorder([[], []]);
  const proposalId = await createTextProposal(connection, {
    jobId: 4,
    subjectType: "user_nickname",
    subjectId: "operation-4",
    targetSubjectId: "7",
    baseVersion: "v1",
    action: "update_nickname",
    idempotencyKey: "request-7-1",
    normalizedPayload: { body: { nickname: "Alice" } },
    payloadDigest: "a".repeat(64),
    userId: 7,
    authorVisibilityVersion: 1
  });

  assert.equal(proposalId, 51);
  const insert = connection.calls.find(({ sql }) => /INSERT INTO content_moderation_text_proposals/.test(sql));
  assert.match(insert.sql, /target_subject_id/);
  assert.match(insert.sql, /author_visibility_version/);
  assert.deepEqual(insert.params, [
    4,
    "user_nickname",
    "operation-4",
    "7",
    "v1",
    "update_nickname",
    JSON.stringify({ body: { nickname: "Alice" } }),
    "a".repeat(64),
    "request-7-1",
    7,
    1
  ]);
});

test("D46 version-one proposal creation rejects a missing or oversized target before SQL", async () => {
  for (const targetSubjectId of ["", "x".repeat(129)]) {
    const connection = queryRecorder();
    await assert.rejects(createTextProposal(connection, {
      jobId: 4,
      subjectType: "user_nickname",
      subjectId: "operation-4",
      targetSubjectId,
      baseVersion: "v1",
      action: "update_nickname",
      idempotencyKey: "request-7-1",
      normalizedPayload: {},
      payloadDigest: "a".repeat(64),
      userId: 7,
      authorVisibilityVersion: 1
    }), TypeError);
    assert.equal(connection.calls.length, 0);
  }
});

test("D46 latest projection lookup is exact, versioned, bounded, and lockable", async () => {
  const connection = queryRecorder([[{ id: 51 }]]);
  const row = await findLatestAuthorTextProposal(connection, {
    userId: 7,
    action: "update_nickname",
    targetSubjectId: "7",
    forUpdate: true
  });

  assert.deepEqual(row, { id: 51 });
  assert.match(connection.calls[0].sql, /created_by_user_id = \?/);
  assert.match(connection.calls[0].sql, /action = \?/);
  assert.match(connection.calls[0].sql, /target_subject_id = \?/);
  assert.match(connection.calls[0].sql, /author_visibility_version = 1/);
  assert.match(connection.calls[0].sql, /proposal\.status IN \('pending', 'rejected'\)/);
  assert.match(connection.calls[0].sql, /ORDER BY proposal\.updated_at DESC, proposal\.id DESC/);
  assert.match(connection.calls[0].sql, /LIMIT 1 FOR UPDATE$/);
  assert.deepEqual(connection.calls[0].params, [7, "update_nickname", "7"]);
});

test("D46 repository cancellation and replacement use conditional author-owned updates", async () => {
  const connection = queryRecorder();
  assert.equal(await cancelTextProposalByAuthor(connection, {
    proposalId: 51,
    userId: 7,
    fromStatus: "pending"
  }), true);
  assert.equal(await cancelModerationJobByUser(connection, {
    jobId: 4,
    fromStatus: "processing"
  }), true);
  assert.equal(await supersedeRejectedTextProposal(connection, {
    proposalId: 51,
    newProposalId: 52,
    userId: 7,
    action: "update_nickname",
    targetSubjectId: "7"
  }), true);

  const [proposalCancel, jobCancel, supersede] = connection.calls;
  assert.match(proposalCancel.sql, /SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP/);
  assert.match(proposalCancel.sql, /created_by_user_id = \?/);
  assert.deepEqual(proposalCancel.params, [51, 7, "pending"]);
  assert.match(jobCancel.sql, /status = 'cancelled'/);
  assert.match(jobCancel.sql, /lease_token = NULL, lease_expires_at = NULL/);
  assert.match(jobCancel.sql, /next_retry_at = NULL/);
  assert.deepEqual(jobCancel.params, [4, "processing"]);
  assert.match(supersede.sql, /status = 'superseded'/);
  assert.match(supersede.sql, /superseded_by_proposal_id = \?/);
  assert.match(supersede.sql, /author_visibility_version = 1/);
  assert.deepEqual(supersede.params, [52, 51, 7, "update_nickname", "7"]);
});

function serviceHarness({ draftOverrides = {}, replacementOverrides = {}, updateResults = {} } = {}) {
  const state = {
    transactionCalls: 0,
    lookups: [],
    proposalCancels: [],
    jobCancels: [],
    attemptRetirements: [],
    supersedes: []
  };
  const draft = {
    id: 51,
    moderation_job_id: 4,
    created_by_user_id: 7,
    action: "update_nickname",
    target_subject_id: "7",
    author_visibility_version: 1,
    proposal_status: "pending",
    job_status: "processing",
    ...draftOverrides
  };
  const replacement = {
    ...draft,
    id: 52,
    moderation_job_id: 5,
    proposal_status: "pending",
    job_status: "pending",
    ...replacementOverrides
  };
  const repository = {
    findAuthorTextDraftById: async (_connection, input) => {
      state.lookups.push(input);
      if (Number(input.userId) !== Number(draft.created_by_user_id)) return null;
      return Number(input.draftId) === Number(draft.id)
        ? { ...draft }
        : { ...replacement, id: Number(input.draftId) };
    },
    cancelTextProposalByAuthor: async (_connection, input) => {
      state.proposalCancels.push(input);
      return updateResults.proposal !== false;
    },
    cancelModerationJobByUser: async (_connection, input) => {
      state.jobCancels.push(input);
      return updateResults.job !== false;
    },
    retireCurrentModerationAttempt: async (_connection, input) => {
      state.attemptRetirements.push(input);
      return 1;
    },
    supersedeRejectedTextProposal: async (_connection, input) => {
      state.supersedes.push(input);
      return updateResults.supersede !== false;
    }
  };
  const service = createAuthorDraftService({
    transaction: async (run) => {
      state.transactionCalls += 1;
      return run({ transaction: state.transactionCalls });
    },
    repository
  });
  return { service, state };
}

test("D46 author cancels a pending draft, job, lease, and current provider attempt atomically", async () => {
  const { service, state } = serviceHarness();
  const result = await service.cancel({ user: { user: { id: 7 }, roles: [] }, draftId: 51 });

  assert.deepEqual(result, { draft_id: 51, status: "cancelled" });
  assert.equal(state.transactionCalls, 1);
  assert.deepEqual(state.lookups, [{ draftId: 51, userId: 7, forUpdate: true }]);
  assert.deepEqual(state.proposalCancels, [{ proposalId: 51, userId: 7, fromStatus: "pending" }]);
  assert.deepEqual(state.jobCancels, [{ jobId: 4, fromStatus: "processing" }]);
  assert.deepEqual(state.attemptRetirements, [{ jobId: 4 }]);
});

test("D46 cancellation is idempotent only for the same author and already-cancelled pair", async () => {
  const { service, state } = serviceHarness({
    draftOverrides: { proposal_status: "cancelled", job_status: "cancelled" }
  });
  assert.deepEqual(
    await service.cancel({ user: { user: { id: 7 }, roles: [] }, draftId: "51" }),
    { draft_id: 51, status: "cancelled" }
  );
  assert.deepEqual(state.proposalCancels, []);
  assert.deepEqual(state.jobCancels, []);
  assert.deepEqual(state.attemptRetirements, []);

  await assert.rejects(
    service.cancel({ user: { user: { id: 8 }, roles: ["system_admin"] }, draftId: 51 }),
    (error) => error.statusCode === 404
  );
});

test("D46 cancellation fails closed for legacy, approved, superseded, or raced drafts", async () => {
  for (const draftOverrides of [
    { author_visibility_version: 0 },
    { proposal_status: "approved", job_status: "approved" },
    { proposal_status: "superseded", job_status: "rejected" }
  ]) {
    const { service } = serviceHarness({ draftOverrides });
    await assert.rejects(
      service.cancel({ user: { user: { id: 7 }, roles: [] }, draftId: 51 }),
      (error) => [404, 409].includes(error.statusCode)
    );
  }

  const { service } = serviceHarness({ updateResults: { job: false } });
  await assert.rejects(
    service.cancel({ user: { user: { id: 7 }, roles: [] }, draftId: 51 }),
    (error) => error.statusCode === 409
  );
});

test("D46 rejected replacement validates author, action, target, and new proposal before superseding", async () => {
  const { service, state } = serviceHarness({
    draftOverrides: { proposal_status: "rejected", job_status: "rejected" }
  });
  const result = await service.supersedeRejected({}, {
    userId: 7,
    draftId: 51,
    newProposalId: 52,
    action: "update_nickname",
    targetSubjectId: "7"
  });
  assert.deepEqual(result, { draft_id: 51, status: "superseded", superseded_by_draft_id: 52 });
  assert.deepEqual(state.supersedes, [{
    proposalId: 51,
    newProposalId: 52,
    userId: 7,
    action: "update_nickname",
    targetSubjectId: "7"
  }]);

  for (const input of [
    { action: "update_session", targetSubjectId: "7" },
    { action: "update_nickname", targetSubjectId: "8" }
  ]) {
    await assert.rejects(service.supersedeRejected({}, {
      userId: 7,
      draftId: 51,
      newProposalId: 53,
      ...input
    }), (error) => error.statusCode === 409);
  }
});

test("D46 replacement replay is idempotent for the same new proposal", async () => {
  for (const [proposalStatus, jobStatus] of [
    ["pending", "pending"],
    ["pending", "processing"],
    ["pending", "review"],
    ["pending", "error"],
    ["rejected", "rejected"],
    ["approved", "approved"]
  ]) {
    const { service, state } = serviceHarness({
      draftOverrides: {
        proposal_status: "superseded",
        job_status: "rejected",
        superseded_by_proposal_id: 52
      },
      replacementOverrides: {
        proposal_status: proposalStatus,
        job_status: jobStatus
      }
    });

    assert.deepEqual(await service.supersedeRejected({}, {
      userId: 7,
      draftId: 51,
      newProposalId: 52,
      action: "update_nickname",
      targetSubjectId: "7"
    }), {
      draft_id: 51,
      status: "superseded",
      superseded_by_draft_id: 52
    });
    assert.deepEqual(state.supersedes, []);
  }
});

test("D46 replacement replay fails closed after cancellation or stale revalidation", async () => {
  for (const replacementOverrides of [
    { proposal_status: "cancelled", job_status: "cancelled" },
    { proposal_status: "stale", job_status: "rejected" }
  ]) {
    const { service } = serviceHarness({
      draftOverrides: {
        proposal_status: "superseded",
        job_status: "rejected",
        superseded_by_proposal_id: 52
      },
      replacementOverrides
    });
    await assert.rejects(service.supersedeRejected({}, {
      userId: 7,
      draftId: 51,
      newProposalId: 52,
      action: "update_nickname",
      targetSubjectId: "7"
    }), (error) => error.statusCode === 409);
  }
});

test("D46 draft lookup joins the exact author-owned proposal and job under one row lock", async () => {
  const connection = queryRecorder([[{ id: 51 }]]);
  assert.deepEqual(await findAuthorTextDraftById(connection, {
    draftId: 51,
    userId: 7,
    forUpdate: true
  }), { id: 51 });
  assert.match(connection.calls[0].sql, /JOIN content_moderation_jobs AS job/);
  assert.match(connection.calls[0].sql, /proposal\.id = \?/);
  assert.match(connection.calls[0].sql, /proposal\.created_by_user_id = \?/);
  assert.match(connection.calls[0].sql, /LIMIT 1 FOR UPDATE$/);
  assert.deepEqual(connection.calls[0].params, [51, 7]);
});

test("D46 server exposes only exact authenticated DELETE cancellation before business routes", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const route = server.indexOf("author-drafts", server.indexOf("async function route"));
  const business = server.indexOf('url.pathname === "/api/uploads/cos-intent"');
  assert.notEqual(route, -1);
  assert.equal(route < business, true);
  const window = server.slice(route - 600, route + 1600);
  assert.match(window, /request\.method === "DELETE"/);
  assert.match(window, /await getAuthUser\(request\)/);
  assert.match(window, /authorDrafts\.cancel/);
  assert.match(window, /"cache-control": "private, no-store"/);
  assert.doesNotMatch(server, /author-drafts[^\n]*(?:execute|action)/i);
});
