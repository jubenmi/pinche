import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createContentModerationService } from "../src/modules/content-moderation/service.js";

function harness({
  subjectType = "album_image",
  status = "review",
  mediaStatus = status,
  mediaActive = true,
  mediaType = subjectType === "album_video" ? "video" : "image",
  mediaObjectVersion = "v1",
  authorVisibilityVersion = 0,
  mediaTransitionResult,
  requeueResult = true,
  applyTextProposal
} = {}) {
  const state = {
    jobStatus: status,
    mediaStatus,
    cleanupCalls: 0,
    retiredAttempts: 0,
    currentAttempt: {
      id: 19,
      moderation_job_id: 7,
      provider: subjectType === "album_video" ? "tencent_ci_video" : "wechat_sec_check",
      provider_job_id: "old-attempt",
      is_current: 1
    },
    decidedByAdminUserId: null,
    proposalStatus: "pending",
    proposalAppliedResult: null,
    media: [],
    audits: [],
    proposals: [],
    applied: [],
    transitions: []
  };
  const job = {
    id: 7,
    subject_type: subjectType,
    subject_id: "91",
    subject_version: "v1",
    provider: subjectType === "album_video" ? "tencent_ci_video" : "wechat_sec_check",
    status,
    decided_by_admin_user_id: null
  };
  const proposal = {
    id: 71,
    moderation_job_id: 7,
    status: "pending",
    action: subjectType === "private_store" ? "create_private_store" : "update_nickname",
    created_by_user_id: 7,
    base_version: subjectType === "private_store" ? "create:7" : "v1",
    normalized_payload_json: JSON.stringify({ body: { nickname: "Alice", name: "门店", city: "上海" } }),
    applied_result_json: null
  };
  const repository = {
    findModerationJobById: async () => ({
      ...job,
      status: state.jobStatus,
      decided_by_admin_user_id: state.decidedByAdminUserId
    }),
    findModerationMedia: async () => ({
      id: 91,
      status: mediaActive ? "active" : "deleted",
      moderation_status: state.mediaStatus,
      moderation_object_version: mediaObjectVersion,
      author_visibility_version: authorVisibilityVersion,
      media_type: mediaType,
      object_key: "uploads/session-album/display/a.jpg",
      session_id: 8
    }),
    findTextProposalByJobId: async () => ({
      ...proposal,
      status: state.proposalStatus,
      applied_result_json: state.proposalAppliedResult
    }),
    createModerationJob: async () => ({
      ...job,
      status: state.jobStatus,
      decided_by_admin_user_id: state.decidedByAdminUserId
    }),
    claimInitialModerationLease: async () => {
      return state.jobStatus === "pending";
    },
    renewModerationLease: async () => state.jobStatus === "pending",
    createTextProposal: async () => proposal.id,
    transitionModerationJob: async (_connection, input) => {
      state.transitions.push(input);
      state.jobStatus = input.toStatus;
      if (input.source === "admin") {
        state.decidedByAdminUserId = input.adminUserId;
      }
      return true;
    },
    transitionMediaModeration: async (_connection, input) => {
      state.media.push(input);
      const changed = mediaTransitionResult === undefined
        ? input.fromStatuses.includes(state.mediaStatus)
        : mediaTransitionResult;
      if (changed) state.mediaStatus = input.toStatus;
      return changed;
    },
    enqueueRejectedMediaCleanup: async () => {
      state.cleanupCalls += 1;
      return 99;
    },
    markTextProposalStatus: async (_connection, input) => {
      state.proposals.push(input);
      state.proposalStatus = input.toStatus;
      state.proposalAppliedResult = input.appliedResult ? JSON.stringify(input.appliedResult) : null;
      return true;
    },
    markTextProposalStale: async (_connection, input) => {
      state.proposals.push({ ...input, toStatus: "stale" });
      return true;
    },
    createAuditLog: async (_connection, input) => state.audits.push(input),
    requeueModerationJob: async () => {
      if (!requeueResult) return false;
      state.jobStatus = "pending";
      return true;
    },
    retireCurrentModerationAttempt: async () => {
      state.retiredAttempts += 1;
      state.currentAttempt = state.currentAttempt
        ? { ...state.currentAttempt, is_current: 0 }
        : null;
      return 1;
    }
  };
  repository.findModerationAttemptByProviderJobId = async (_connection, provider, providerJobId) => (
    state.currentAttempt &&
    state.currentAttempt.provider === provider &&
    state.currentAttempt.provider_job_id === providerJobId
      ? { ...state.currentAttempt }
      : null
  );
  repository.findCurrentModerationAttempt = async () => (
    state.currentAttempt?.is_current === 1 ? { ...state.currentAttempt } : null
  );
  const service = createContentModerationService({
    config: { enabled: true, wechatTextEnabled: true },
    client: { checkText: async () => ({ suggestion: "pass" }) },
    repository,
    transaction: async (run) => run({}),
    withDatabaseConnection: async (run) => run({}),
    applyTextProposal,
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

test("administrator approval promotes a pending medium after its initial submission failed", async () => {
  const { service, state } = harness({ status: "error", mediaStatus: "pending" });

  const result = await service.decideAsAdmin({
    admin: { user: { id: 2 }, roles: ["system_admin"] }, jobId: 7, action: "approve"
  });

  assert.equal(result.status, "approved");
  assert.deepEqual(state.media[0].fromStatuses, ["pending", "error"]);
  assert.equal(state.mediaStatus, "approved");
  assert.equal(state.jobStatus, "approved");
});

test("administrator media decision rejects an obsolete immutable media version before changing the job", async () => {
  const { service, state } = harness({ mediaObjectVersion: "v2" });

  await assert.rejects(service.decideAsAdmin({
    admin: { user: { id: 2 }, roles: ["system_admin"] }, jobId: 7, action: "approve"
  }), { code: "CONTENT_MODERATION_CALLBACK_STALE" });

  assert.deepEqual(state.media, []);
  assert.deepEqual(state.transitions, []);
  assert.deepEqual(state.audits, []);
});

test("administrator media decision requires an active medium of the matching subject type", async () => {
  for (const options of [{ mediaActive: false }, { mediaType: "video" }]) {
    const { service, state } = harness(options);

    await assert.rejects(service.decideAsAdmin({
      admin: { user: { id: 2 }, roles: ["system_admin"] }, jobId: 7, action: "approve"
    }), { code: "CONTENT_MODERATION_CALLBACK_STALE" });

    assert.deepEqual(state.media, []);
    assert.deepEqual(state.transitions, []);
  }
});

test("administrator rejection does not finalize its job or enqueue cleanup when the media transition changes zero rows", async () => {
  const { service, state } = harness({ mediaTransitionResult: false });

  await assert.rejects(service.decideAsAdmin({
    admin: { user: { id: 2 }, roles: ["system_admin"] },
    jobId: 7,
    action: "reject",
    reason: "违规内容"
  }), { code: "CONTENT_MODERATION_CALLBACK_STALE" });

  assert.equal(state.media.length, 1);
  assert.deepEqual(state.transitions, []);
  assert.equal(state.cleanupCalls, 0);
  assert.deepEqual(state.audits, []);
});

test("administrator rejection requires a reason and schedules media cleanup", async () => {
  const { service, state } = harness();
  const admin = { user: { id: 2 }, roles: ["system_admin"] };
  await assert.rejects(service.decideAsAdmin({ admin, jobId: 7, action: "reject" }), {
    code: "BAD_REQUEST"
  });
  assert.equal((await service.decideAsAdmin({
    admin, jobId: 7, action: "reject", reason: "违规内容"
  })).status, "rejected");
  assert.equal(state.cleanupCalls, 1);
});

test("D46 administrator rejection retains policy-version-one media", async () => {
  const { service, state } = harness({ authorVisibilityVersion: 1 });
  const result = await service.decideAsAdmin({
    admin: { user: { id: 2 }, roles: ["system_admin"] },
    jobId: 7,
    action: "reject",
    reason: "违规内容"
  });
  assert.equal(result.status, "rejected");
  assert.equal(state.mediaStatus, "rejected");
  assert.equal(state.cleanupCalls, 0);
});

test("text approval invokes the atomic proposal applicator and marks proposal approved", async () => {
  const { service, state } = harness({ subjectType: "user_nickname" });
  await service.decideAsAdmin({
    admin: { user: { id: 2 }, roles: ["system_admin"] },
    jobId: 7,
    action: "approve",
    applyTextProposal: async (_connection, input) => {
      state.applied.push(input.job.subject_type);
      return { id: 7, kind: "user_profile" };
    }
  });
  assert.deepEqual(state.applied, ["user_nickname"]);
  assert.equal(state.proposals[0].toStatus, "approved");
  assert.equal(state.proposals[0].fromStatus, "pending");
});

test("administrator approval without a safe replay identity fails closed before any status change", async () => {
  for (const result of [null, {}, { content: "unsafe result" }, "not-an-object"]) {
    const { service, state } = harness({ subjectType: "private_store" });

    await assert.rejects(service.decideAsAdmin({
      admin: { user: { id: 2 }, roles: ["system_admin"] },
      jobId: 7,
      action: "approve",
      applyTextProposal: async () => result
    }), {
      code: "CONTENT_MODERATION_CONFIGURATION_ERROR"
    });
    assert.equal(state.proposals.length, 0);
    assert.equal(state.transitions.length, 0);
    assert.equal(state.audits.length, 0);
  }
});

test("admin-approved creation persists its safe result so a retry replays without a second write", async () => {
  const { service, state } = harness({ subjectType: "private_store" });
  let applications = 0;
  const appliedResult = { id: 91, kind: "create_private_store" };

  await service.decideAsAdmin({
    admin: { user: { id: 2 }, roles: ["system_admin"] },
    jobId: 7,
    action: "approve",
    applyTextProposal: async () => {
      applications += 1;
      return appliedResult;
    }
  });
  assert.deepEqual(state.proposals.at(-1).appliedResult, appliedResult);

  const replayInput = {
    subjectType: "private_store",
    subjectId: "draft:create_private_store:7:request",
    actorUserId: 7,
    openid: "openid-7",
    action: "create_private_store",
    baseVersion: "create:7",
    idempotencyKey: "request",
    fields: { name: "门店", city: "上海" },
    payload: { body: { name: "门店", city: "上海" } }
  };
  const replay = await service.moderateTextMutation(replayInput);
  const repeatedReplay = await service.moderateTextMutation(replayInput);

  assert.deepEqual(replay, appliedResult);
  assert.deepEqual(repeatedReplay, appliedResult);
  assert.equal(state.decidedByAdminUserId, 2);
  assert.equal(applications, 1);
});

test("an admin retry applies a creation once and later idempotent requests replay its saved result", async () => {
  let applications = 0;
  const result = { id: 92, kind: "create_private_store" };
  const { service } = harness({
    subjectType: "private_store",
    status: "error",
    applyTextProposal: async () => {
      applications += 1;
      return result;
    }
  });
  const admin = { user: { id: 2 }, roles: ["system_admin"] };
  await service.decideAsAdmin({ admin, jobId: 7, action: "retry" });

  const input = {
    subjectType: "private_store",
    subjectId: "draft:create_private_store:7:retry",
    actorUserId: 7,
    openid: "openid-7",
    action: "create_private_store",
    baseVersion: "v1:create",
    idempotencyKey: "retry",
    fields: { name: "门店", city: "上海" },
    payload: { body: { name: "门店", city: "上海" } }
  };
  assert.deepEqual(await service.moderateTextMutation(input), result);
  assert.deepEqual(await service.moderateTextMutation(input), result);
  assert.equal(applications, 1);
});

test("a stale text proposal is terminal and closes its job without adding a stale job status", async () => {
  const { service, state } = harness({ subjectType: "user_nickname" });
  const stale = Object.assign(new Error("base version changed"), {
    code: "CONTENT_MODERATION_PROPOSAL_STALE"
  });

  const result = await service.decideAsAdmin({
    admin: { user: { id: 2 }, roles: ["system_admin"] },
    jobId: 7,
    action: "approve",
    applyTextProposal: async () => { throw stale; }
  });

  assert.deepEqual(result, { id: 7, status: "rejected", stale: true });
  assert.deepEqual(state.proposals[0], {
    jobId: 7,
    fromStatus: "pending",
    toStatus: "stale"
  });
  assert.equal(state.transitions[0].toStatus, "rejected");
  assert.equal(state.transitions[0].errorCode, "CONTENT_MODERATION_PROPOSAL_STALE");
  assert.equal(state.audits[0].action, "stale");
});

test("retry retires the old provider attempt so delayed callbacks stay stale", async () => {
  for (const decision of ["pass", "review", "block"]) {
    const { service, state } = harness({ status: "error", mediaStatus: "error" });
    const result = await service.decideAsAdmin({
      admin: { user: { id: 2 }, roles: ["system_admin"] }, jobId: 7, action: "retry"
    });

    assert.equal(result.status, "pending");
    assert.equal(state.retiredAttempts, 1);

    const delayed = await service.applyMediaResult({
      jobId: 7,
      provider: "wechat_sec_check",
      providerJobId: "old-attempt",
      subjectVersion: "v1",
      result: { decision, suggestion: decision }
    });

    assert.equal(delayed.stale, true, decision);
    assert.equal(state.jobStatus, "pending", decision);
    assert.equal(state.media.length, 0, decision);
  }
});

test("retry does not retire an attempt or audit when its conditional requeue loses a race", async () => {
  const { service, state } = harness({ status: "error", requeueResult: false });

  await assert.rejects(service.decideAsAdmin({
    admin: { user: { id: 2 }, roles: ["system_admin"] }, jobId: 7, action: "retry"
  }), { code: "CONTENT_MODERATION_CALLBACK_STALE" });

  assert.equal(state.retiredAttempts, 0);
  assert.deepEqual(state.audits, []);
  assert.equal(state.jobStatus, "error");
});

test("server injects provider attempts and stale proposal transition into the moderation service", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const serviceStart = source.indexOf("const contentModeration = createContentModerationService({");
  const serviceEnd = source.indexOf("async function applyApprovedTextProposal", serviceStart);
  const serviceDefinition = source.slice(serviceStart, serviceEnd);

  for (const name of [
    "claimInitialModerationLease",
    "failModerationJob",
    "renewModerationLease",
    "findModerationAttemptByProviderJobId",
    "findCurrentModerationAttempt",
    "retireCurrentModerationAttempt",
    "markTextProposalStale"
  ]) {
    assert.match(source, new RegExp(`${name},`));
    assert.match(serviceDefinition, new RegExp(`${name},`));
  }
});
