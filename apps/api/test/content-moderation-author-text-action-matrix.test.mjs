import assert from "node:assert/strict";
import test from "node:test";

import { createAuthorDraftService } from "../src/modules/content-moderation/author-drafts.js";
import { AUTHOR_PRIVATE_TEXT_ACTIONS } from "../src/modules/content-moderation/author-dto.js";
import { createAuthorTextProjectionReader } from "../src/modules/content-moderation/author-text-read.js";
import { resolveAuthorVisibility } from "../src/modules/content-moderation/author-visibility.js";
import { createContentModerationService } from "../src/modules/content-moderation/service.js";
import { createTextBaseline } from "../src/modules/content-moderation/text-baseline.js";
import { buildTextModerationDescriptor } from "../src/modules/content-moderation/text-boundaries.js";
import {
  createProductionTextProposalHandlers,
  expectedTextCreationBase,
  PRODUCTION_TEXT_PROPOSAL_ACTIONS
} from "../src/modules/content-moderation/text-proposal-handlers.js";
import { createTextProposalApplicator } from "../src/modules/content-moderation/text-proposal-applicator.js";
import { profileTextSnapshot } from "../src/modules/content-moderation/text-profile-patch.js";

const ACTOR_USER_ID = 7;
const OTHER_USER_ID = 8;
const ACTOR_TEXT_SNAPSHOT = Object.freeze({
  id: ACTOR_USER_ID,
  nickname: "旧昵称",
  avatarUrl: "/uploads/avatars/old.png",
  gender: "male"
});

const ACTION_CASES = Object.freeze({
  update_nickname: {
    targetSubjectId: "7",
    body: { nickname: "矩阵昵称" }
  },
  create_private_store: {
    targetSubjectId: "creation:create_private_store:7",
    body: { name: "矩阵店", city: "上海" }
  },
  create_private_script: {
    targetSubjectId: "creation:create_private_script:7",
    body: {
      name: "矩阵本",
      playerCount: 2,
      typeTags: ["推理"],
      defaultSeatTemplate: []
    }
  },
  create_session: {
    targetSubjectId: "creation:create_session:7",
    body: {
      storeId: 3,
      scriptId: 4,
      startAt: "2026-07-15 20:00:00",
      dmNameSnapshot: "DM",
      depositAmount: 0,
      visibility: "share_only",
      note: "矩阵说明",
      pinnedMessageText: "",
      joinPolicy: "review_required",
      joinPhoneRequired: true,
      npcJoinEnabled: true,
      extraNpcRoles: []
    }
  },
  update_session: {
    targetSubjectId: "12",
    sessionId: 12,
    body: { note: "矩阵新说明" }
  },
  create_session_npc_role: {
    targetSubjectId: "session:12",
    sessionId: 12,
    body: {
      name: "矩阵 NPC",
      description: "说明",
      roleGender: "unlimited",
      source: "session",
      sortOrder: 0
    }
  },
  update_session_npc_role: {
    targetSubjectId: "88",
    sessionId: 12,
    body: { name: "矩阵 NPC 2", status: "active" }
  },
  upsert_session_review: {
    targetSubjectId: "12",
    sessionId: 12,
    body: { rating: 5, content: "矩阵评价", photoUrls: [] }
  },
  create_session_message: {
    targetSubjectId: "12",
    sessionId: 12,
    body: { content: "矩阵消息" }
  },
  update_session_pinned_message: {
    targetSubjectId: "12",
    sessionId: 12,
    body: { pinnedMessageText: "矩阵置顶" }
  }
});

function baseVersionForAction(action) {
  if (action === "update_nickname") {
    return createTextBaseline({
      kind: "user_profile",
      profile: profileTextSnapshot(ACTOR_TEXT_SNAPSHOT)
    });
  }
  if (["create_private_store", "create_private_script"].includes(action)) {
    return expectedTextCreationBase(ACTOR_USER_ID);
  }
  return "domain:baseline:v1";
}

function createLifecycleHarness({ suggestion = "review" } = {}) {
  const state = {
    suggestion,
    checks: 0,
    applies: new Map(),
    jobs: new Map(),
    jobsByIdentity: new Map(),
    proposals: new Map(),
    proposalsByJobId: new Map(),
    formalEntities: new Map(),
    transactionCalls: 0,
    retiredAttempts: 0,
    nextJobId: 1,
    nextProposalId: 1,
    nextPublishedId: 1_000,
    baselineReads: []
  };

  const findJob = (jobId) => state.jobs.get(Number(jobId)) || null;
  const findProposal = (proposalId) => state.proposals.get(Number(proposalId)) || null;
  const proposalWithJob = (proposal) => {
    const job = proposal && findJob(proposal.moderation_job_id);
    return proposal && job
      ? { ...proposal, proposal_status: proposal.status, job_status: job.status }
      : null;
  };

  const repository = {
    createModerationJob: async (_connection, input) => {
      const identity = [
        input.subjectType,
        input.subjectId,
        input.subjectVersion,
        input.provider
      ].join(":");
      const existingId = state.jobsByIdentity.get(identity);
      if (existingId) return { ...findJob(existingId) };
      const job = {
        id: state.nextJobId++,
        subject_type: input.subjectType,
        subject_id: input.subjectId,
        subject_version: input.subjectVersion,
        provider: input.provider,
        status: "pending",
        attempt_count: 0,
        lease_token: null,
        decided_by_admin_user_id: null,
        created_at: "2026-07-15T00:00:00.000Z"
      };
      state.jobs.set(job.id, job);
      state.jobsByIdentity.set(identity, job.id);
      return { ...job };
    },
    createTextProposal: async (_connection, input) => {
      const existingId = state.proposalsByJobId.get(Number(input.jobId));
      if (existingId) {
        const existing = findProposal(existingId);
        if (String(existing.payload_digest) !== String(input.payloadDigest)) {
          const error = new Error("idempotency payload changed");
          error.code = "CONTENT_MODERATION_IDEMPOTENCY_CONFLICT";
          throw error;
        }
        return existing.id;
      }
      const job = findJob(input.jobId);
      const proposal = {
        id: state.nextProposalId++,
        moderation_job_id: Number(input.jobId),
        status: "pending",
        action: input.action,
        subject_type: input.subjectType,
        subject_id: input.subjectId,
        target_subject_id: input.targetSubjectId,
        author_visibility_version: input.authorVisibilityVersion,
        base_version: input.baseVersion,
        idempotency_key: input.idempotencyKey,
        payload_digest: input.payloadDigest,
        created_by_user_id: input.userId,
        normalized_payload_json: JSON.stringify(input.normalizedPayload),
        applied_result_json: null,
        superseded_by_proposal_id: null,
        job_status: job?.status || "pending"
      };
      state.proposals.set(proposal.id, proposal);
      state.proposalsByJobId.set(proposal.moderation_job_id, proposal.id);
      return proposal.id;
    },
    findModerationJobById: async (_connection, jobId, options = {}) => {
      const job = findJob(jobId);
      if (!job) return null;
      if (options.leaseToken && String(options.leaseToken) !== String(job.lease_token || "")) {
        return null;
      }
      return { ...job };
    },
    findTextProposalByJobId: async (_connection, jobId) => {
      const proposalId = state.proposalsByJobId.get(Number(jobId));
      const proposal = findProposal(proposalId);
      return proposal ? { ...proposal } : null;
    },
    claimInitialModerationLease: async (_connection, input) => {
      const job = findJob(input.jobId);
      if (!job || job.status !== "pending" || job.lease_token) return false;
      job.lease_token = input.leaseToken;
      return true;
    },
    renewModerationLease: async (_connection, input) => {
      const job = findJob(input.jobId);
      return Boolean(
        job &&
        job.status === input.fromStatus &&
        job.decided_by_admin_user_id === null &&
        String(job.lease_token || "") === String(input.leaseToken || "")
      );
    },
    failModerationJob: async (_connection, input) => {
      const job = findJob(input.jobId);
      if (!job || String(job.lease_token || "") !== String(input.leaseToken || "")) return false;
      job.status = "error";
      job.lease_token = null;
      return true;
    },
    transitionModerationJob: async (_connection, input) => {
      const job = findJob(input.jobId);
      if (!job || job.status !== input.fromStatus) return false;
      if (input.leaseToken && String(job.lease_token || "") !== String(input.leaseToken)) return false;
      job.status = input.toStatus;
      job.lease_token = null;
      return true;
    },
    markTextProposalStatus: async (_connection, input) => {
      const proposalId = state.proposalsByJobId.get(Number(input.jobId));
      const proposal = findProposal(proposalId);
      if (!proposal || proposal.status !== input.fromStatus) return false;
      proposal.status = input.toStatus;
      proposal.applied_result_json = input.appliedResult
        ? JSON.stringify(input.appliedResult)
        : null;
      return true;
    },
    markTextProposalStale: async (_connection, input) => {
      const proposalId = state.proposalsByJobId.get(Number(input.jobId));
      const proposal = findProposal(proposalId);
      if (!proposal || proposal.status !== input.fromStatus) return false;
      proposal.status = "stale";
      return true;
    },
    findAuthorTextDraftById: async (_connection, input) => {
      const proposal = findProposal(input.draftId);
      if (!proposal || Number(proposal.created_by_user_id) !== Number(input.userId)) return null;
      return proposalWithJob(proposal);
    },
    cancelTextProposalByAuthor: async (_connection, input) => {
      const proposal = findProposal(input.proposalId);
      if (
        !proposal ||
        Number(proposal.created_by_user_id) !== Number(input.userId) ||
        proposal.status !== input.fromStatus
      ) return false;
      proposal.status = "cancelled";
      return true;
    },
    cancelModerationJobByUser: async (_connection, input) => {
      const job = findJob(input.jobId);
      if (!job || job.status !== input.fromStatus) return false;
      job.status = "cancelled";
      job.lease_token = null;
      return true;
    },
    retireCurrentModerationAttempt: async () => {
      state.retiredAttempts += 1;
      return true;
    },
    supersedeRejectedTextProposal: async (_connection, input) => {
      const proposal = findProposal(input.proposalId);
      if (
        !proposal ||
        proposal.status !== "rejected" ||
        Number(proposal.created_by_user_id) !== Number(input.userId) ||
        proposal.action !== input.action ||
        String(proposal.target_subject_id) !== String(input.targetSubjectId)
      ) return false;
      proposal.status = "superseded";
      proposal.superseded_by_proposal_id = Number(input.newProposalId);
      return true;
    },
    findLatestAuthorTextProposal: async (_connection, input) => {
      const matches = [...state.proposals.values()].filter((proposal) => (
        Number(proposal.created_by_user_id) === Number(input.userId) &&
        proposal.action === input.action &&
        String(proposal.target_subject_id) === String(input.targetSubjectId)
      ));
      matches.sort((left, right) => right.id - left.id);
      return proposalWithJob(matches[0]);
    }
  };

  const transaction = async (run) => {
    state.transactionCalls += 1;
    return run(state);
  };
  const authorDrafts = createAuthorDraftService({ transaction, repository });
  const recordBaselineRead = (reader, options) => {
    state.baselineReads.push({ reader, forUpdate: options?.forUpdate === true });
    return "domain:baseline:v1";
  };
  const recordWrite = (action, targetSubjectId, body, { pinned = false } = {}) => {
    const key = `${action}:${targetSubjectId}`;
    state.applies.set(key, (state.applies.get(key) || 0) + 1);
    const entity = {
      id: state.nextPublishedId++,
      kind: action,
      body: structuredClone(body)
    };
    state.formalEntities.set(key, entity);
    return pinned
      ? { pinnedMessage: { id: entity.id } }
      : { id: entity.id, kind: entity.kind };
  };
  const handlers = createProductionTextProposalHandlers({
    currentActorTextSnapshot: async (_connection, _actorUserId, options) => {
      state.baselineReads.push({ reader: "currentActorTextSnapshot", forUpdate: options?.forUpdate === true });
      return { ...ACTOR_TEXT_SNAPSHOT };
    },
    currentSessionCreateTextBase: async (_connection, _actorUserId, _body, options) =>
      recordBaselineRead("currentSessionCreateTextBase", options),
    currentSessionTextBase: async (_connection, _sessionId, _actorUserId, options) =>
      recordBaselineRead("currentSessionTextBase", options),
    currentNpcRoleTextBase: async (_connection, _npcRoleId, _actorUserId, options) =>
      recordBaselineRead("currentNpcRoleTextBase", options),
    currentReviewTextBase: async (_connection, _sessionId, _actorUserId, options) =>
      recordBaselineRead("currentReviewTextBase", options),
    currentMessageTextBase: async (_connection, _sessionId, _actorUserId, options) =>
      recordBaselineRead("currentMessageTextBase", options),
    currentPinnedTextBase: async (_connection, _sessionId, _actorUserId, options) =>
      recordBaselineRead("currentPinnedTextBase", options),
    updateUserProfileWithConnection: async (_connection, actorUserId, body) =>
      recordWrite("update_nickname", String(actorUserId), body),
    createPrivateStoreWithConnection: async (_connection, actor, body) =>
      recordWrite("create_private_store", `creation:create_private_store:${actor.user.id}`, body),
    createPrivateScriptWithConnection: async (_connection, actor, body) =>
      recordWrite("create_private_script", `creation:create_private_script:${actor.user.id}`, body),
    createSessionWithConnection: async (_connection, actor, body) =>
      recordWrite("create_session", `creation:create_session:${actor.user.id}`, body),
    updateSessionWithConnection: async (_connection, _actor, sessionId, body) =>
      recordWrite("update_session", String(sessionId), body),
    createSessionNpcRoleWithConnection: async (_connection, _actor, sessionId, body) =>
      recordWrite("create_session_npc_role", `session:${sessionId}`, body),
    updateSessionNpcRoleWithConnection: async (_connection, _actor, npcRoleId, body) =>
      recordWrite("update_session_npc_role", String(npcRoleId), body),
    upsertMySessionReviewWithConnection: async (_connection, _actor, sessionId, body) =>
      recordWrite("upsert_session_review", String(sessionId), body),
    createSessionMessageWithConnection: async (_connection, _actor, sessionId, body) =>
      recordWrite("create_session_message", String(sessionId), body),
    updateSessionPinnedMessageWithConnection: async (_connection, _actor, sessionId, body) =>
      recordWrite("update_session_pinned_message", String(sessionId), body, { pinned: true })
  });
  const applicator = createTextProposalApplicator({
    loadActor: async (_connection, actorUserId) => ({
      user: { id: actorUserId, openid: `openid-${actorUserId}` },
      roles: ["player"]
    }),
    handlers
  });
  const config = {
    enabled: true,
    wechatTextEnabled: true,
    authorPrivateTextEnabled: true,
    authorPrivateTextActions: AUTHOR_PRIVATE_TEXT_ACTIONS
  };
  const service = createContentModerationService({
    config,
    client: {
      checkText: async () => {
        state.checks += 1;
        return { suggestion: state.suggestion, label: "100", score: 1 };
      }
    },
    repository,
    transaction,
    withDatabaseConnection: async (run) => run(state),
    randomUUID: () => `d46-lifecycle-${state.nextJobId}`,
    now: () => Date.parse("2026-07-15T00:00:01.000Z"),
    random: () => 0,
    applyTextProposal: (connection, input) => applicator.apply(connection, input),
    supersedeRejectedDraft: (connection, input) => authorDrafts.supersedeRejected(connection, input)
  });
  const reader = createAuthorTextProjectionReader({ config, repository });

  return { state, service, authorDrafts, reader, repository };
}

function moderationInput(action, testCase, idempotencyKey, extra = {}) {
  const context = {
    targetSubjectId: testCase.targetSubjectId,
    ...(testCase.sessionId ? { sessionId: testCase.sessionId } : {})
  };
  const descriptor = buildTextModerationDescriptor({
    action,
    body: testCase.body,
    context,
    subjectId: testCase.targetSubjectId,
    actorUserId: ACTOR_USER_ID,
    openid: `openid-${ACTOR_USER_ID}`,
    baseVersion: extra.baseVersion || baseVersionForAction(action),
    idempotencyKey,
    idempotencyExplicit: true
  });
  assert.ok(descriptor, `${action}: production boundary must emit a descriptor`);
  return { ...descriptor, ...extra };
}

function entityKey(action, testCase) {
  return `${action}:${testCase.targetSubjectId}`;
}

function seedFormalEntity(state, action, testCase) {
  const entity = { id: 500, kind: action, body: { marker: "old-public-value" } };
  state.formalEntities.set(entityKey(action, testCase), structuredClone(entity));
  return entity;
}

async function visibleDraft(reader, action, testCase, userId = ACTOR_USER_ID) {
  return reader.find({}, {
    userId,
    action,
    targetSubjectId: testCase.targetSubjectId
  });
}

test("D46 all ten text actions execute the real service/boundary/applicator lifecycle matrix", async (t) => {
  assert.deepEqual(Object.keys(ACTION_CASES), AUTHOR_PRIVATE_TEXT_ACTIONS);
  assert.deepEqual(PRODUCTION_TEXT_PROPOSAL_ACTIONS, AUTHOR_PRIVATE_TEXT_ACTIONS);

  for (const action of AUTHOR_PRIVATE_TEXT_ACTIONS) {
    await t.test(action, async () => {
      const testCase = ACTION_CASES[action];

      const review = createLifecycleHarness({ suggestion: "review" });
      const reviewBaseline = seedFormalEntity(review.state, action, testCase);
      const reviewInput = moderationInput(action, testCase, `${action}:review`);
      const reviewResult = await review.service.moderateTextMutation(reviewInput);
      assert.equal(reviewResult.publication_state, "author_only", `${action}:review:author-result`);
      assert.equal(reviewResult.moderation_status, "review", `${action}:review:status`);
      assert.deepEqual(
        review.state.formalEntities.get(entityKey(action, testCase)),
        reviewBaseline,
        `${action}:review:formal-entity-unchanged`
      );
      assert.equal((await visibleDraft(review.reader, action, testCase)).draft_id, reviewResult.draft_id);
      assert.equal(await visibleDraft(review.reader, action, testCase, OTHER_USER_ID), null);
      assert.deepEqual(await review.service.moderateTextMutation(reviewInput), reviewResult);
      assert.equal(review.state.checks, 1, `${action}:review:idempotent-provider-call`);

      const approved = createLifecycleHarness({ suggestion: "pass" });
      seedFormalEntity(approved.state, action, testCase);
      const approvedInput = moderationInput(action, testCase, `${action}:approved`);
      const approvedResult = await approved.service.moderateTextMutation(approvedInput);
      const approvedEntity = approved.state.formalEntities.get(entityKey(action, testCase));
      assert.equal(approvedEntity.id, approvedResult.id, `${action}:approved:formal-write`);
      assert.deepEqual(approvedEntity.body, approvedInput.payload.body, `${action}:approved:canonical-body`);
      assert.equal(await visibleDraft(approved.reader, action, testCase), null);
      assert.equal(resolveAuthorVisibility({
        viewerUserId: OTHER_USER_ID,
        authorUserId: ACTOR_USER_ID,
        moderationStatus: "approved",
        authorVisibilityVersion: 1,
        recordStatus: "active",
        contentKind: "text"
      }).scope, "public", `${action}:approved:public`);
      const approvedSnapshot = structuredClone(approvedEntity);
      assert.deepEqual(await approved.service.moderateTextMutation(approvedInput), approvedResult);
      assert.equal(approved.state.checks, 1, `${action}:approved:idempotent-provider-call`);
      assert.equal(approved.state.applies.get(entityKey(action, testCase)), 1, `${action}:approved:idempotent-apply`);
      assert.deepEqual(approved.state.formalEntities.get(entityKey(action, testCase)), approvedSnapshot);
      assert.equal(
        approved.state.baselineReads.every((read) => read.forUpdate === true),
        true,
        `${action}:approved:baseline-read-is-locked`
      );

      const cancelled = createLifecycleHarness({ suggestion: "review" });
      const cancelledBaseline = seedFormalEntity(cancelled.state, action, testCase);
      const cancelledInput = moderationInput(action, testCase, `${action}:cancelled`);
      const privateDraft = await cancelled.service.moderateTextMutation(cancelledInput);
      const transactionsBeforeCancel = cancelled.state.transactionCalls;
      assert.deepEqual(await cancelled.authorDrafts.cancel({
        user: { user: { id: ACTOR_USER_ID } },
        draftId: privateDraft.draft_id
      }), { draft_id: privateDraft.draft_id, status: "cancelled" });
      assert.ok(cancelled.state.transactionCalls > transactionsBeforeCancel, `${action}:cancel:transaction`);
      assert.equal((await cancelled.repository.findAuthorTextDraftById({}, {
        draftId: privateDraft.draft_id,
        userId: ACTOR_USER_ID
      })).proposal_status, "cancelled");
      assert.equal(await visibleDraft(cancelled.reader, action, testCase), null);
      assert.deepEqual(cancelled.state.formalEntities.get(entityKey(action, testCase)), cancelledBaseline);
      await assert.rejects(
        cancelled.service.moderateTextMutation(cancelledInput),
        { code: "CONTENT_MODERATION_PROPOSAL_STALE" },
        `${action}:cancelled:idempotent-replay-is-stale`
      );
      assert.equal(cancelled.state.checks, 1, `${action}:cancelled:no-provider-replay`);

      const replaced = createLifecycleHarness({ suggestion: "risky" });
      const replacedBaseline = seedFormalEntity(replaced.state, action, testCase);
      const rejectedInput = moderationInput(action, testCase, `${action}:rejected`);
      const rejectedDraft = await replaced.service.moderateTextMutation(rejectedInput);
      assert.equal(rejectedDraft.moderation_status, "rejected", `${action}:replacement:rejected`);
      replaced.state.suggestion = "review";
      const replacementInput = moderationInput(action, testCase, `${action}:replacement`, {
        replacesDraftId: rejectedDraft.draft_id
      });
      const replacementDraft = await replaced.service.moderateTextMutation(replacementInput);
      const retired = await replaced.repository.findAuthorTextDraftById({}, {
        draftId: rejectedDraft.draft_id,
        userId: ACTOR_USER_ID
      });
      assert.equal(retired.proposal_status, "superseded", `${action}:replacement:old-retired`);
      assert.equal(retired.superseded_by_proposal_id, replacementDraft.draft_id);
      assert.equal((await visibleDraft(replaced.reader, action, testCase)).draft_id, replacementDraft.draft_id);
      assert.deepEqual(replaced.state.formalEntities.get(entityKey(action, testCase)), replacedBaseline);
      assert.deepEqual(await replaced.service.moderateTextMutation(replacementInput), replacementDraft);
      assert.equal(replaced.state.checks, 2, `${action}:replacement:idempotent-provider-call`);
      await assert.rejects(
        replaced.service.moderateTextMutation(rejectedInput),
        { code: "CONTENT_MODERATION_PROPOSAL_STALE" },
        `${action}:replacement:old-replay-is-stale`
      );

      const stale = createLifecycleHarness({ suggestion: "pass" });
      const staleBaseline = seedFormalEntity(stale.state, action, testCase);
      const staleInput = moderationInput(action, testCase, `${action}:stale`, {
        baseVersion: `stale:${baseVersionForAction(action)}`
      });
      await assert.rejects(
        stale.service.moderateTextMutation(staleInput),
        { code: "CONTENT_MODERATION_PROPOSAL_STALE" },
        `${action}:stale:baseline-revalidation`
      );
      assert.deepEqual(stale.state.formalEntities.get(entityKey(action, testCase)), staleBaseline);
      assert.equal(await visibleDraft(stale.reader, action, testCase), null);
      await assert.rejects(
        stale.service.moderateTextMutation(staleInput),
        { code: "CONTENT_MODERATION_PROPOSAL_STALE" },
        `${action}:stale:idempotent-replay`
      );
      assert.equal(stale.state.checks, 1, `${action}:stale:no-provider-replay`);
      assert.equal(stale.state.applies.get(entityKey(action, testCase)), undefined, `${action}:stale:no-business-write`);
      assert.equal(
        stale.state.baselineReads.every((read) => read.forUpdate === true),
        true,
        `${action}:stale:baseline-read-is-locked`
      );
    });
  }
});
