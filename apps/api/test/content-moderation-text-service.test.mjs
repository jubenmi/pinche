import assert from "node:assert/strict";
import test from "node:test";

import { forbidden } from "../src/http/errors.js";
import { createTextBaseline } from "../src/modules/content-moderation/text-baseline.js";
import { normalizeTextFields } from "../src/modules/content-moderation/normalize.js";
import {
  profilePatchFromProposalBody,
  profileTextSnapshot
} from "../src/modules/content-moderation/text-profile-patch.js";
import { createContentModerationService } from "../src/modules/content-moderation/service.js";
import { textProposalPayloadDigest } from "../src/modules/content-moderation/text-proposal-digest.js";
import { textMutationSubjectVersion } from "../src/modules/content-moderation/text-request-identity.js";

function textHarness({
  suggestion = "pass",
  clientError = null,
  applyError = null,
  applyTextProposal = null,
  jobStatus = "pending",
  proposalStatus = "pending",
  appliedResultJson = null,
  jobOverrides = {},
  proposalOverrides = {},
  afterCheck = null,
  retryLimit = 8,
  now = () => 1_000,
  random = () => 0
} = {}) {
  const state = {
    checked: [],
    jobs: [],
    proposals: [],
    transitions: [],
    proposalTransitions: [],
    applied: [],
    jobLookups: [],
    leaseValid: true,
    initialClaims: [],
    renewals: [],
    failures: [],
    events: []
  };
  const job = {
    id: 41,
    subject_type: "session_update",
    subject_id: "12",
    subject_version: "",
    provider: "wechat_sec_check",
    status: jobStatus,
    decided_by_admin_user_id: null,
    lease_token: "lease-text",
    ...jobOverrides
  };
  const proposal = {
    id: 51,
    moderation_job_id: 41,
    status: proposalStatus,
    action: "update_session",
    subject_type: "session_update",
    subject_id: "12",
    base_version: "session-v1",
    idempotency_key: "session-update-12-request-1",
    payload_digest: "payload-51",
    created_by_user_id: 7,
    normalized_payload_json: JSON.stringify({ body: { note: "周末拼车" } }),
    applied_result_json: appliedResultJson,
    ...proposalOverrides
  };
  state.job = job;
  state.proposal = proposal;
  const repository = {
    createModerationJob: async (_connection, input) => {
      state.jobs.push(input);
      Object.assign(job, {
        subject_type: input.subjectType,
        subject_id: input.subjectId,
        subject_version: input.subjectVersion,
        provider: input.provider
      });
      if (job.status === "pending") {
        job.attempt_count = 0;
        job.lease_token = null;
      }
      return { ...job };
    },
    createTextProposal: async (_connection, input) => {
      state.proposals.push(input);
      proposal.normalized_payload_json = JSON.stringify(input.normalizedPayload);
      proposal.action = input.action;
      proposal.base_version = input.baseVersion;
      return proposal.id;
    },
    findModerationJobById: async (_connection, _id, options = {}) => {
      state.jobLookups.push(options);
      if (
        options.leaseToken &&
        (!state.leaseValid || String(options.leaseToken) !== String(job.lease_token || ""))
      ) return null;
      return { ...job };
    },
    claimInitialModerationLease: async (_connection, input) => {
      state.initialClaims.push(input);
      if (job.status !== "pending" || job.lease_token !== null) return false;
      job.lease_token = input.leaseToken;
      return true;
    },
    renewModerationLease: async (_connection, input) => {
      state.renewals.push(input);
      return (
        state.leaseValid &&
        String(input.leaseToken) === String(job.lease_token || "") &&
        String(input.fromStatus) === String(job.status) &&
        job.decided_by_admin_user_id === null
      );
    },
    failModerationJob: async (_connection, input) => {
      state.failures.push(input);
      if (!state.leaseValid || String(input.leaseToken) !== String(job.lease_token || "")) return false;
      job.status = "error";
      job.lease_token = null;
      return true;
    },
    findTextProposalByJobId: async () => ({ ...proposal }),
    transitionModerationJob: async (_connection, input) => {
      state.transitions.push(input);
      job.status = input.toStatus;
      return true;
    },
    markTextProposalStatus: async (_connection, input) => {
      state.proposalTransitions.push(input);
      proposal.status = input.toStatus;
      proposal.applied_result_json = input.appliedResult ? JSON.stringify(input.appliedResult) : null;
      return true;
    },
    markTextProposalStale: async (_connection, input) => {
      state.proposalTransitions.push({ ...input, toStatus: "stale" });
      proposal.status = "stale";
      return true;
    }
  };
  const service = createContentModerationService({
    config: { enabled: true, wechatTextEnabled: true, retryLimit },
    client: {
      checkText: async (input) => {
        state.checked.push(input);
        if (typeof afterCheck === "function") afterCheck(state);
        if (clientError) throw clientError;
        return { suggestion, label: "100", score: 1 };
      }
    },
    repository,
    transaction: async (run) => run({}),
    withDatabaseConnection: async (run) => run({}),
    randomUUID: () => "00000000-0000-4000-8000-000000000045",
    now,
    random,
    applyTextProposal: async (_connection, input) => {
      if (typeof applyTextProposal === "function") return applyTextProposal(input, state);
      if (applyError) throw applyError;
      state.applied.push(input);
      return { id: 99, note: "周末拼车" };
    },
    emit: (event, fields) => state.events.push({ event, fields })
  });
  return { service, state };
}

function mutationInput(overrides = {}) {
  return {
    subjectType: "session_update",
    subjectId: "12",
    actorUserId: 7,
    openid: "openid-7",
    action: "update_session",
    baseVersion: "session-v1",
    idempotencyKey: "session-update-12-request-1",
    fields: { note: "  周末拼车  ", dm_name: "阿青" },
    payload: { body: { note: "周末拼车" }, sessionId: 12 },
    ...overrides
  };
}

function profileMutationInput(overrides = {}) {
  const body = {
    nickname: "新昵称",
    avatarUrl: "/uploads/avatars/new.png",
    gender: "female"
  };
  return mutationInput({
    subjectType: "user_nickname",
    subjectId: "7",
    action: "update_nickname",
    baseVersion: "profile-v1",
    idempotencyKey: "profile-request-1",
    fields: { nickname: body.nickname },
    payload: { body },
    ...overrides
  });
}

function statefulTextReplayHarness() {
  const state = {
    applies: 0,
    checks: 0,
    jobs: new Map(),
    proposals: new Map(),
    transitions: []
  };
  let nextJobId = 1;
  let nextProposalId = 1;
  const jobKey = (input) => [
    input.subjectType,
    input.subjectId,
    input.subjectVersion,
    input.provider
  ].join(":");
  const repository = {
    createModerationJob: async (_connection, input) => {
      const key = jobKey(input);
      let job = state.jobs.get(key);
      if (!job) {
        job = {
          id: nextJobId++,
          subject_type: input.subjectType,
          subject_id: input.subjectId,
          subject_version: input.subjectVersion,
          provider: input.provider,
          status: "pending",
          decided_by_admin_user_id: null
        };
        state.jobs.set(key, job);
      }
      return { ...job };
    },
    createTextProposal: async (_connection, input) => {
      const existing = state.proposals.get(Number(input.jobId));
      if (existing) {
        if (existing.payload_digest !== input.payloadDigest) {
          if (input.allowStaleIdempotencyReplay === true && existing.status === "stale") {
            return existing.id;
          }
          throw Object.assign(new Error("idempotency conflict"), {
            code: "CONTENT_MODERATION_IDEMPOTENCY_CONFLICT"
          });
        }
        return existing.id;
      }
      const proposal = {
        id: nextProposalId++,
        moderation_job_id: Number(input.jobId),
        status: "pending",
        action: input.action,
        base_version: input.baseVersion,
        payload_digest: input.payloadDigest,
        normalized_payload_json: JSON.stringify(input.normalizedPayload),
        applied_result_json: null
      };
      state.proposals.set(Number(input.jobId), proposal);
      return proposal.id;
    },
    findModerationJobById: async (_connection, id, options = {}) => {
      for (const job of state.jobs.values()) {
        if (Number(job.id) === Number(id)) {
          if (options.leaseToken && String(options.leaseToken) !== String(job.lease_token || "")) return null;
          return { ...job };
        }
      }
      return null;
    },
    claimInitialModerationLease: async (_connection, input) => {
      const job = await repository.findModerationJobById(null, input.jobId);
      if (!job || job.status !== "pending" || job.lease_token) return false;
      for (const current of state.jobs.values()) {
        if (Number(current.id) === Number(input.jobId)) current.lease_token = input.leaseToken;
      }
      return true;
    },
    renewModerationLease: async (_connection, input) => {
      const job = await repository.findModerationJobById(null, input.jobId, {
        leaseToken: input.leaseToken
      });
      return Boolean(
        job &&
        ["pending", "error"].includes(String(input.fromStatus)) &&
        String(job.status) === String(input.fromStatus) &&
        job.decided_by_admin_user_id === null
      );
    },
    failModerationJob: async (_connection, input) => {
      const job = await repository.findModerationJobById(null, input.jobId, {
        leaseToken: input.leaseToken
      });
      if (!job) return false;
      for (const current of state.jobs.values()) {
        if (Number(current.id) === Number(input.jobId)) {
          current.status = "error";
          current.lease_token = null;
        }
      }
      return true;
    },
    findTextProposalByJobId: async (_connection, id) => {
      const proposal = state.proposals.get(Number(id));
      return proposal ? { ...proposal } : null;
    },
    markTextProposalStale: async (_connection, input) => {
      const proposal = state.proposals.get(Number(input.jobId));
      if (!proposal || proposal.status !== input.fromStatus) return false;
      proposal.status = "stale";
      return true;
    },
    markTextProposalStatus: async (_connection, input) => {
      const proposal = state.proposals.get(Number(input.jobId));
      if (!proposal || proposal.status !== input.fromStatus) return false;
      proposal.status = input.toStatus;
      proposal.applied_result_json = input.appliedResult ? JSON.stringify(input.appliedResult) : null;
      return true;
    },
    transitionModerationJob: async (_connection, input) => {
      const job = await repository.findModerationJobById(null, input.jobId);
      if (!job || job.status !== input.fromStatus) return false;
      for (const current of state.jobs.values()) {
        if (Number(current.id) === Number(input.jobId)) {
          current.status = input.toStatus;
          current.lease_token = null;
        }
      }
      state.transitions.push(input);
      return true;
    }
  };
  const service = createContentModerationService({
    config: { enabled: true, wechatTextEnabled: true },
    client: {
      checkText: async () => {
        state.checks += 1;
        return { suggestion: "pass" };
      }
    },
    repository,
    transaction: async (run) => run({}),
    withDatabaseConnection: async (run) => run({}),
    randomUUID: () => "stateful-text-replay",
    applyTextProposal: async (_connection, input) => {
      if (input.proposal.base_version === "v1") {
        throw Object.assign(new Error("base changed"), {
          code: "CONTENT_MODERATION_PROPOSAL_STALE"
        });
      }
      state.applies += 1;
      return { id: 501, kind: "session_update" };
    },
    emit: () => {}
  });
  return { service, state };
}

test("text pass uses the fixed scene, persists a proposal, and applies it atomically", async () => {
  const { service, state } = textHarness({ suggestion: "pass" });

  const result = await service.moderateTextMutation(mutationInput());

  assert.deepEqual(result, { id: 99, note: "周末拼车" });
  assert.deepEqual(state.checked, [{
    content: "[dm_name]阿青\n[note]周末拼车",
    openid: "openid-7",
    scene: 4,
    subjectType: "session_update"
  }]);
  assert.equal(state.jobs[0].provider, "wechat_sec_check");
  assert.equal(state.jobs[0].subjectType, "session_update");
  assert.equal(state.proposals[0].action, "update_session");
  assert.equal(state.proposals[0].idempotencyKey, "session-update-12-request-1");
  assert.equal(state.applied.length, 1);
  assert.equal(state.proposalTransitions[0].toStatus, "approved");
  assert.equal(state.transitions.at(-1).toStatus, "approved");
  assert.equal(state.transitions.at(-1).leaseToken, state.initialClaims[0].leaseToken);
  assert.deepEqual(state.renewals, [{
    jobId: 41,
    leaseToken: state.initialClaims[0].leaseToken,
    fromStatus: "pending",
    leaseDurationMs: 90_000
  }]);
});

test("a mixed profile patch applies only after nickname text passes moderation", async () => {
  const profile = {
    id: 7,
    nickname: "旧昵称",
    avatarUrl: "/uploads/avatars/old.png",
    gender: "male"
  };
  const { service } = textHarness({
    applyTextProposal: async (input) => {
      Object.assign(profile, profilePatchFromProposalBody(
        JSON.parse(input.proposal.normalized_payload_json).body
      ));
      return { id: profile.id, kind: "user_profile" };
    }
  });

  assert.deepEqual(await service.moderateTextMutation(profileMutationInput()), {
    id: 7,
    kind: "user_profile"
  });
  assert.deepEqual(profile, {
    id: 7,
    nickname: "新昵称",
    avatarUrl: "/uploads/avatars/new.png",
    gender: "female"
  });
});

test("review and block profile proposals leave every profile field unchanged", async () => {
  for (const [suggestion, code] of [["review", "CONTENT_MODERATION_REVIEW_PENDING"], ["risky", "CONTENT_MODERATION_REJECTED"]]) {
    const profile = {
      id: 7,
      nickname: "旧昵称",
      avatarUrl: "/uploads/avatars/old.png",
      gender: "male"
    };
    const { service } = textHarness({
      suggestion,
      applyTextProposal: async () => {
        throw new Error("profile patch must remain hidden");
      }
    });

    await assert.rejects(service.moderateTextMutation(profileMutationInput()), { code });
    assert.deepEqual(profile, {
      id: 7,
      nickname: "旧昵称",
      avatarUrl: "/uploads/avatars/old.png",
      gender: "male"
    });
  }
});

test("a profile avatar change while nickname is under review makes approval stale", async () => {
  const originalProfile = {
    id: 7,
    nickname: "旧昵称",
    avatarUrl: "/uploads/avatars/old.png",
    gender: "male"
  };
  const currentProfile = {
    ...originalProfile,
    avatarUrl: "/uploads/avatars/changed-during-review.png"
  };
  const capturedBase = createTextBaseline({
    kind: "user_profile",
    profile: profileTextSnapshot(originalProfile)
  });
  const { service } = textHarness({
    applyTextProposal: async (input) => {
      const actualBase = createTextBaseline({
        kind: "user_profile",
        profile: profileTextSnapshot(currentProfile)
      });
      if (input.proposal.base_version !== actualBase) {
        throw Object.assign(new Error("profile changed"), {
          code: "CONTENT_MODERATION_PROPOSAL_STALE"
        });
      }
      Object.assign(currentProfile, profilePatchFromProposalBody(
        JSON.parse(input.proposal.normalized_payload_json).body
      ));
      return { id: 7, kind: "user_profile" };
    }
  });

  await assert.rejects(service.moderateTextMutation(profileMutationInput({
    baseVersion: capturedBase
  })), { code: "CONTENT_MODERATION_PROPOSAL_STALE" });
  assert.deepEqual(currentProfile, {
    id: 7,
    nickname: "旧昵称",
    avatarUrl: "/uploads/avatars/changed-during-review.png",
    gender: "male"
  });
});

test("review persists a hidden proposal and does not apply the business mutation", async () => {
  const { service, state } = textHarness({ suggestion: "review" });

  await assert.rejects(service.moderateTextMutation(mutationInput()), {
    code: "CONTENT_MODERATION_REVIEW_PENDING"
  });

  assert.equal(state.applied.length, 0);
  assert.equal(state.transitions.at(-1).toStatus, "review");
  assert.equal(state.proposalTransitions.length, 0);
});

test("risky text is rejected without changing the business entity", async () => {
  const { service, state } = textHarness({ suggestion: "risky" });

  await assert.rejects(service.moderateTextMutation(mutationInput()), {
    code: "CONTENT_MODERATION_REJECTED"
  });

  assert.equal(state.applied.length, 0);
  assert.equal(state.transitions.at(-1).toStatus, "rejected");
  assert.equal(state.proposalTransitions.at(-1).toStatus, "rejected");
});

test("an unavailable or unknown WeChat result remains hidden for retry", async () => {
  const { service, state } = textHarness({ suggestion: "unknown" });

  await assert.rejects(service.moderateTextMutation(mutationInput()), {
    code: "CONTENT_MODERATION_UNAVAILABLE"
  });

  assert.equal(state.applied.length, 0);
  assert.equal(state.failures.at(-1).exhausted, true);
  assert.equal(state.proposalTransitions.length, 0);
});

test("initial text provider failure preserves its safe code for delayed retry without exposing it to callers", async () => {
  const providerFailure = Object.assign(new Error("private upstream diagnostic"), {
    code: "WECHAT_CONTENT_SECURITY_TOKEN_UNAVAILABLE"
  });
  const { service, state } = textHarness({ clientError: providerFailure });

  await assert.rejects(service.moderateTextMutation(mutationInput()), {
    code: "CONTENT_MODERATION_UNAVAILABLE"
  });

  assert.deepEqual(state.failures.at(-1), {
    jobId: 41,
    leaseToken: state.initialClaims[0].leaseToken,
    attempts: 1,
    nextRetryAt: new Date(31_000),
    errorCode: "WECHAT_CONTENT_SECURITY_TOKEN_UNAVAILABLE",
    exhausted: false
  });
  assert.deepEqual(state.events.at(-1), {
    event: "moderation_operational_alert",
    fields: {
      provider: "wechat_sec_check",
      subjectType: "session_update",
      outcome: "retry_scheduled",
      errorCode: "WECHAT_CONTENT_SECURITY_TOKEN_UNAVAILABLE",
      attempt: 1,
      priority: "high"
    }
  });
  assert.equal(JSON.stringify(state.events).includes("private upstream diagnostic"), false);
});

test("text moderation rejects a missing producer openid before it can bypass WeChat", async () => {
  const { service, state } = textHarness();

  await assert.rejects(service.moderateTextMutation(mutationInput({ openid: "" })), {
    code: "CONTENT_MODERATION_OPENID_REQUIRED"
  });

  assert.equal(state.checked.length, 0);
  assert.equal(state.jobs.length, 0);
});

test("a stale business baseline marks the proposal stale and never overwrites the newer entity", async () => {
  const stale = Object.assign(new Error("session changed"), {
    code: "CONTENT_MODERATION_PROPOSAL_STALE"
  });
  const { service, state } = textHarness({ applyError: stale });

  await assert.rejects(service.moderateTextMutation(mutationInput()), {
    code: "CONTENT_MODERATION_PROPOSAL_STALE"
  });

  assert.deepEqual(state.proposalTransitions.at(-1), {
    jobId: 41,
    fromStatus: "pending",
    toStatus: "stale"
  });
  assert.equal(state.transitions.at(-1).toStatus, "rejected");
  assert.equal(state.transitions.at(-1).errorCode, "CONTENT_MODERATION_PROPOSAL_STALE");
});

test("a same-second snapshot change stales the proposal before it can write", async () => {
  const capturedBase = createTextBaseline({
    id: 12,
    updated_at: "2026-07-12 12:00:00",
    note: "原说明"
  });
  const changedBase = createTextBaseline({
    id: 12,
    updated_at: "2026-07-12 12:00:00",
    note: "并发修改后的说明"
  });
  let writes = 0;
  const { service, state } = textHarness({
    applyTextProposal: async (input) => {
      if (input.proposal.base_version !== changedBase) {
        throw Object.assign(new Error("same-second snapshot changed"), {
          code: "CONTENT_MODERATION_PROPOSAL_STALE"
        });
      }
      writes += 1;
      return { id: 12 };
    }
  });

  await assert.rejects(service.moderateTextMutation(mutationInput({
    baseVersion: capturedBase
  })), { code: "CONTENT_MODERATION_PROPOSAL_STALE" });
  assert.notEqual(capturedBase, changedBase);
  assert.equal(writes, 0);
  assert.equal(state.transitions.at(-1).errorCode, "CONTENT_MODERATION_PROPOSAL_STALE");
});

test("a stale fallback request can resubmit the same text on a new baseline exactly once", async () => {
  const { service, state } = statefulTextReplayHarness();
  const first = mutationInput({
    baseVersion: "v1",
    idempotencyKey: "fallback-v1",
    idempotencyExplicit: false
  });
  const resubmission = mutationInput({
    baseVersion: "v2",
    idempotencyKey: "fallback-v2",
    idempotencyExplicit: false
  });

  await assert.rejects(service.moderateTextMutation(first), {
    code: "CONTENT_MODERATION_PROPOSAL_STALE"
  });
  assert.equal(state.applies, 0);
  assert.equal(state.jobs.size, 1);

  assert.deepEqual(await service.moderateTextMutation(resubmission), {
    id: 501,
    kind: "session_update"
  });
  assert.equal(state.jobs.size, 2);
  assert.equal(state.applies, 1);

  assert.deepEqual(await service.moderateTextMutation(resubmission), {
    id: 501,
    kind: "session_update"
  });
  assert.equal(state.applies, 1);
});

test("an explicit idempotency key returns the prior stale result without a new provider call", async () => {
  const { service, state } = statefulTextReplayHarness();
  const first = mutationInput({
    baseVersion: "v1",
    idempotencyKey: "same-operation",
    idempotencyExplicit: true
  });
  const retry = mutationInput({
    baseVersion: "v2",
    idempotencyKey: "same-operation",
    idempotencyExplicit: true
  });

  await assert.rejects(service.moderateTextMutation(first), {
    code: "CONTENT_MODERATION_PROPOSAL_STALE"
  });
  const providerCallsAfterFirst = state.checks;

  await assert.rejects(service.moderateTextMutation(retry), {
    code: "CONTENT_MODERATION_PROPOSAL_STALE"
  });
  assert.equal(state.jobs.size, 1);
  assert.equal(state.checks, providerCallsAfterFirst);
  assert.equal(state.applies, 0);
});

test("a new explicit idempotency key resubmits a stale text operation as a new job", async () => {
  const { service, state } = statefulTextReplayHarness();
  const first = mutationInput({
    baseVersion: "v1",
    idempotencyKey: "first-operation",
    idempotencyExplicit: true
  });
  const resubmission = mutationInput({
    baseVersion: "v2",
    idempotencyKey: "second-operation",
    idempotencyExplicit: true
  });

  await assert.rejects(service.moderateTextMutation(first), {
    code: "CONTENT_MODERATION_PROPOSAL_STALE"
  });
  const providerCallsAfterFirst = state.checks;

  assert.deepEqual(await service.moderateTextMutation(resubmission), {
    id: 501,
    kind: "session_update"
  });
  assert.equal(state.jobs.size, 2);
  assert.equal(state.checks, providerCallsAfterFirst + 1);
  assert.equal(state.applies, 1);
});

test("a revalidation permission failure becomes stale and closes the proposal transaction", async () => {
  const { service, state } = textHarness({
    applyError: forbidden("session membership was revoked")
  });

  await assert.rejects(service.moderateTextMutation(mutationInput()), {
    code: "CONTENT_MODERATION_PROPOSAL_STALE"
  });
  assert.deepEqual(state.proposalTransitions.at(-1), {
    jobId: 41,
    fromStatus: "pending",
    toStatus: "stale"
  });
  assert.equal(state.transitions.at(-1).toStatus, "rejected");
  assert.equal(state.transitions.at(-1).errorCode, "CONTENT_MODERATION_PROPOSAL_STALE");
});

test("an existing error text job is left for the leased Worker instead of resubmitting directly", async () => {
  const { service, state } = textHarness({ jobStatus: "error" });

  await assert.rejects(service.moderateTextMutation(mutationInput()), {
    code: "CONTENT_MODERATION_UNAVAILABLE"
  });
  assert.equal(state.checked.length, 0);
  assert.equal(state.applied.length, 0);
});

test("leased text retry applies the current proposal through the same applicator after immutable revalidation", async () => {
  const normalizedText = normalizeTextFields({ note: "周末拼车" });
  const subjectVersion = textMutationSubjectVersion({ normalizedText });
  const normalizedPayload = {
    body: { note: "周末拼车" },
    context: {},
    actor_user_id: 7
  };
  const payloadDigest = textProposalPayloadDigest({
    action: "update_session",
    baseVersion: "session-v1",
    normalizedText,
    normalizedPayload
  });
  const { service, state } = textHarness({
    jobStatus: "error",
    jobOverrides: {
      subject_id: "text-op-41",
      subject_version: subjectVersion
    },
    proposalOverrides: {
      subject_id: "text-op-41",
      payload_digest: payloadDigest,
      normalized_payload_json: JSON.stringify(normalizedPayload)
    }
  });

  const result = await service.retryTextModeration({
      job: {
        id: 41,
        provider: "wechat_sec_check",
        subject_type: "session_update",
        subject_id: "text-op-41",
        subject_version: subjectVersion,
        status: "error",
        lease_token: "lease-text"
      },
      proposal: {
        id: 51,
        status: "pending",
        subject_type: "session_update",
        subject_id: "text-op-41",
        action: "update_session",
        base_version: "session-v1",
        idempotency_key: "session-update-12-request-1",
        payload_digest: payloadDigest,
        created_by_user_id: 7,
        normalized_payload_json: JSON.stringify(normalizedPayload)
      },
      normalizedText,
      openid: "openid-7",
      leaseToken: "lease-text",
      expectedText: {
        jobId: 41,
        proposalId: 51,
        subjectType: "session_update",
        subjectId: "text-op-41",
        subjectVersion,
        action: "update_session",
        actorUserId: 7,
        baseVersion: "session-v1",
        idempotencyKey: "session-update-12-request-1",
        payloadDigest
      }
    });

  assert.deepEqual(result, { kind: "approved", result: { id: 99, note: "周末拼车" } });
  assert.equal(state.checked.length, 1);
  assert.equal(state.applied.length, 1);
  assert.equal(state.jobLookups.some((options) => options.leaseToken === "lease-text"), true);
  assert.equal(state.transitions.at(-1).leaseToken, "lease-text");
  assert.deepEqual(state.renewals.at(-1), {
    jobId: 41,
    leaseToken: "lease-text",
    fromStatus: "error",
    leaseDurationMs: 90_000
  });
});

test("a leased text retry with an expired lease or changed immutable version cannot apply the proposal", async () => {
  const normalizedText = normalizeTextFields({ note: "周末拼车" });
  const subjectVersion = textMutationSubjectVersion({ normalizedText });
  const normalizedPayload = {
    body: { note: "周末拼车" },
    context: {},
    actor_user_id: 7
  };
  const payloadDigest = textProposalPayloadDigest({
    action: "update_session",
    baseVersion: "session-v1",
    normalizedText,
    normalizedPayload
  });
  const { service, state } = textHarness({
    jobStatus: "error",
    jobOverrides: { subject_id: "text-op-42", subject_version: subjectVersion },
    proposalOverrides: {
      subject_id: "text-op-42",
      payload_digest: payloadDigest,
      normalized_payload_json: JSON.stringify(normalizedPayload)
    }
  });
  state.leaseValid = false;
  const baseInput = {
    job: {
      id: 41,
      provider: "wechat_sec_check",
      subject_type: "session_update",
      subject_id: "text-op-42",
      subject_version: subjectVersion,
      status: "error",
      lease_token: "lease-text"
    },
    proposal: {
      id: 51,
      status: "pending",
      subject_type: "session_update",
      subject_id: "text-op-42",
      action: "update_session",
      base_version: "session-v1",
      idempotency_key: "session-update-12-request-1",
      payload_digest: payloadDigest,
      created_by_user_id: 7,
      normalized_payload_json: JSON.stringify(normalizedPayload)
    },
    normalizedText,
    openid: "openid-7",
    leaseToken: "lease-text",
    expectedText: {
      jobId: 41,
      proposalId: 51,
      subjectType: "session_update",
      subjectId: "text-op-42",
      subjectVersion,
      action: "update_session",
      actorUserId: 7,
      baseVersion: "session-v1",
      idempotencyKey: "session-update-12-request-1",
      payloadDigest
    }
  };

  await assert.rejects(service.retryTextModeration(baseInput), {
    code: "CONTENT_MODERATION_SUBMISSION_STALE"
  });
  assert.equal(state.checked.length, 0);
  assert.equal(state.applied.length, 0);

  state.leaseValid = true;
  assert.deepEqual(await service.retryTextModeration({
    ...baseInput,
    normalizedText: normalizeTextFields({ note: "changed" })
  }), { kind: "stale" });
  assert.equal(state.applied.length, 0);
});

test("a post-network text association change cannot reach the applicator or write a result", async () => {
  const normalizedText = normalizeTextFields({ note: "周末拼车" });
  const subjectVersion = textMutationSubjectVersion({ normalizedText });
  const normalizedPayload = {
    body: { note: "周末拼车" },
    context: {},
    actor_user_id: 7
  };
  const payloadDigest = textProposalPayloadDigest({
    action: "update_session",
    baseVersion: "session-v1",
    normalizedText,
    normalizedPayload
  });
  const { service, state } = textHarness({
    jobStatus: "error",
    jobOverrides: { subject_id: "text-op-43", subject_version: subjectVersion },
    proposalOverrides: {
      subject_id: "text-op-43",
      payload_digest: payloadDigest,
      normalized_payload_json: JSON.stringify(normalizedPayload)
    },
    afterCheck: (current) => { current.job.subject_id = "changed-after-network"; }
  });
  const input = {
    job: {
      id: 41,
      provider: "wechat_sec_check",
      subject_type: "session_update",
      subject_id: "text-op-43",
      subject_version: subjectVersion,
      status: "error",
      lease_token: "lease-text"
    },
    proposal: {
      id: 51,
      status: "pending",
      subject_type: "session_update",
      subject_id: "text-op-43",
      action: "update_session",
      base_version: "session-v1",
      idempotency_key: "session-update-12-request-1",
      payload_digest: payloadDigest,
      created_by_user_id: 7,
      normalized_payload_json: JSON.stringify(normalizedPayload)
    },
    normalizedText,
    openid: "openid-7",
    leaseToken: "lease-text",
    expectedText: {
      jobId: 41,
      proposalId: 51,
      subjectType: "session_update",
      subjectId: "text-op-43",
      subjectVersion,
      action: "update_session",
      actorUserId: 7,
      baseVersion: "session-v1",
      idempotencyKey: "session-update-12-request-1",
      payloadDigest
    }
  };

  assert.deepEqual(await service.retryTextModeration(input), { kind: "stale" });
  assert.equal(state.checked.length, 1);
  assert.equal(state.applied.length, 0);
  assert.equal(state.transitions.length, 0);
});

test("an approved creation request replays its safe result without creating another entity", async () => {
  const { service, state } = textHarness({
    jobStatus: "approved",
    proposalStatus: "approved",
    appliedResultJson: JSON.stringify({ id: 77, kind: "create_private_store" })
  });

  const result = await service.moderateTextMutation(mutationInput({
    subjectType: "private_store",
    subjectId: "draft:create_private_store:7:abc",
    action: "create_private_store",
    baseVersion: "create:7",
    idempotencyKey: "store-request-1",
    fields: { name: "门店", city: "上海" },
    payload: { body: { name: "门店", city: "上海" } }
  }));

  assert.deepEqual(result, { id: 77, kind: "create_private_store" });
  assert.equal(state.applied.length, 0);
});

test("terminal text requests do not send duplicate content to WeChat", async () => {
  const approved = textHarness();
  const approvedInput = mutationInput();
  assert.deepEqual(await approved.service.moderateTextMutation(approvedInput), {
    id: 99,
    note: "周末拼车"
  });
  assert.deepEqual(await approved.service.moderateTextMutation(approvedInput), {
    id: 99
  });
  assert.equal(approved.state.checked.length, 1);

  for (const [suggestion, code] of [
    ["review", "CONTENT_MODERATION_REVIEW_PENDING"],
    ["risky", "CONTENT_MODERATION_REJECTED"]
  ]) {
    const terminal = textHarness({ suggestion });
    const input = mutationInput({ idempotencyKey: `terminal-${suggestion}` });
    await assert.rejects(terminal.service.moderateTextMutation(input), { code });
    await assert.rejects(terminal.service.moderateTextMutation(input), { code });
    assert.equal(terminal.state.checked.length, 1, suggestion);
  }

  const stale = Object.assign(new Error("base changed"), {
    code: "CONTENT_MODERATION_PROPOSAL_STALE"
  });
  const staleRequest = textHarness({ applyError: stale });
  const staleInput = mutationInput({ idempotencyKey: "terminal-stale" });
  await assert.rejects(staleRequest.service.moderateTextMutation(staleInput), {
    code: "CONTENT_MODERATION_PROPOSAL_STALE"
  });
  await assert.rejects(staleRequest.service.moderateTextMutation(staleInput), {
    code: "CONTENT_MODERATION_PROPOSAL_STALE"
  });
  assert.equal(staleRequest.state.checked.length, 1);
});

test("an approved profile proposal replays once without applying the patch again", async () => {
  let applications = 0;
  const { service } = textHarness({
    jobStatus: "approved",
    proposalStatus: "approved",
    appliedResultJson: JSON.stringify({ id: 7, kind: "user_profile" }),
    applyTextProposal: async () => {
      applications += 1;
      return { id: 7, kind: "user_profile" };
    }
  });
  const input = profileMutationInput();

  assert.deepEqual(await service.moderateTextMutation(input), { id: 7, kind: "user_profile" });
  assert.deepEqual(await service.moderateTextMutation(input), { id: 7, kind: "user_profile" });
  assert.equal(applications, 0);
});

test("an approved proposal without a safe replay result fails closed before route fallback", async () => {
  for (const appliedResultJson of [
    null,
    JSON.stringify("not-an-object"),
    JSON.stringify({}),
    JSON.stringify({ id: 7, content: "unsafe replay text" })
  ]) {
    const { service, state } = textHarness({
      jobStatus: "approved",
      proposalStatus: "approved",
      appliedResultJson
    });

    await assert.rejects(service.moderateTextMutation(mutationInput({
      subjectType: "private_store",
      subjectId: "draft:create_private_store:7:missing-result",
      action: "create_private_store",
      baseVersion: "create:7",
      idempotencyKey: "store-request-missing-result",
      fields: { name: "门店", city: "上海" },
      payload: { body: { name: "门店", city: "上海" } }
    })), {
      code: "CONTENT_MODERATION_PROPOSAL_STALE"
    });
    assert.equal(state.applied.length, 0);
  }
});

test("a first pass without a safe replay identity fails closed before approval", async () => {
  for (const result of [null, {}, { content: "unsafe result" }, "not-an-object"]) {
    const { service, state } = textHarness({
      applyTextProposal: async () => result
    });

    await assert.rejects(service.moderateTextMutation(mutationInput()), {
      code: "CONTENT_MODERATION_CONFIGURATION_ERROR"
    });
    assert.equal(state.proposalTransitions.length, 0);
    assert.equal(state.transitions.length, 0);
  }
});

test("fixed WeChat scenes cover profile, comment, forum, and dynamic text", () => {
  const { service } = textHarness();

  assert.equal(service.textSceneForSubject("user_nickname"), 1);
  assert.equal(service.textSceneForSubject("session_review"), 2);
  assert.equal(service.textSceneForSubject("forum_post"), 3);
  assert.equal(service.textSceneForSubject("session_message"), 2);
  assert.equal(service.textSceneForSubject("session_create"), 4);
  assert.equal(service.textSceneForSubject("session_npc_role"), 4);
  assert.throws(() => service.textSceneForSubject("unknown"), /subject type/i);
});
