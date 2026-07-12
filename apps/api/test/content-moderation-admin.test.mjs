import assert from "node:assert/strict";
import test from "node:test";

import { createContentModerationService } from "../src/modules/content-moderation/service.js";

function harness({ subjectType = "album_image", status = "review" } = {}) {
  const state = { jobStatus: status, media: [], audits: [], proposals: [], applied: [] };
  const job = {
    id: 7,
    subject_type: subjectType,
    subject_id: "91",
    subject_version: "v1",
    status,
    decided_by_admin_user_id: null
  };
  const repository = {
    findModerationJobById: async () => ({ ...job, status: state.jobStatus }),
    findModerationMedia: async () => ({
      id: 91, status: "active", moderation_status: state.jobStatus,
      media_type: "image", object_key: "a.jpg", session_id: 8
    }),
    findTextProposalByJobId: async () => ({
      moderation_job_id: 7,
      status: state.jobStatus,
      base_version: "v1",
      normalized_payload_json: JSON.stringify({ body: { nickname: "Alice" } })
    }),
    transitionModerationJob: async (_connection, input) => {
      state.jobStatus = input.toStatus;
      return true;
    },
    transitionMediaModeration: async (_connection, input) => {
      state.media.push(input);
      return true;
    },
    enqueueRejectedMediaCleanup: async () => 99,
    markTextProposalStatus: async (_connection, input) => {
      state.proposals.push(input);
      return true;
    },
    createAuditLog: async (_connection, input) => state.audits.push(input),
    requeueModerationJob: async () => true
  };
  const service = createContentModerationService({
    config: {}, client: {}, repository,
    transaction: async (run) => run({}),
    withDatabaseConnection: async (run) => run({}),
    emit: () => {}
  });
  return { service, state };
}

test("ordinary users cannot perform administrator moderation decisions", async () => {
  const { service } = harness();
  await assert.rejects(service.decideAsAdmin({
    admin: { user: { id: 1 }, roles: [] }, jobId: 7, action: "approve"
  }), (error) => error.statusCode === 403);
});
test("administrator approval publishes media and records an audit", async () => {
  const { service, state } = harness();
  const result = await service.decideAsAdmin({
    admin: { user: { id: 2 }, roles: ["system_admin"] }, jobId: 7, action: "approve"
  });
  assert.equal(result.status, "approved");
  assert.equal(state.media[0].toStatus, "approved");
  assert.equal(state.audits[0].action, "approve");
});

test("administrator rejection requires a reason and schedules media cleanup", async () => {
  const { service } = harness();
  const admin = { user: { id: 2 }, roles: ["system_admin"] };
  await assert.rejects(service.decideAsAdmin({ admin, jobId: 7, action: "reject" }), {
    code: "BAD_REQUEST"
  });
  assert.equal((await service.decideAsAdmin({
    admin, jobId: 7, action: "reject", reason: "违规内容"
  })).status, "rejected");
});

test("text approval invokes the atomic proposal applicator and marks proposal approved", async () => {
  const { service, state } = harness({ subjectType: "user_nickname" });
  await service.decideAsAdmin({
    admin: { user: { id: 2 }, roles: ["system_admin"] },
    jobId: 7,
    action: "approve",
    applyTextProposal: async (_connection, input) => state.applied.push(input.job.subject_type)
  });
  assert.deepEqual(state.applied, ["user_nickname"]);
  assert.equal(state.proposals[0].toStatus, "approved");
});

test("retry leaves content hidden and requeues only error jobs", async () => {
  const { service } = harness({ status: "error" });
  const result = await service.decideAsAdmin({
    admin: { user: { id: 2 }, roles: ["system_admin"] }, jobId: 7, action: "retry"
  });
  assert.equal(result.status, "pending");
});
