import assert from "node:assert/strict";
import test from "node:test";

import { createContentModerationService } from "../src/modules/content-moderation/service.js";

function mediaHarness(
  kind,
  {
    initialLeaseGranted = true,
    liveLease = true,
    renewalGranted = true,
    maxLiveLeaseChecks = Number.POSITIVE_INFINITY
  } = {}
) {
  const isVideo = kind === "video";
  const state = {
    initialClaims: [],
    providerCalls: [],
    recorded: [],
    failures: [],
    renewals: [],
    initialLeaseToken: null,
    leaseChecks: 0,
    timeline: []
  };
  const job = {
    id: isVideo ? 81 : 82,
    status: "pending",
    attempt_count: 0,
    provider: isVideo ? "tencent_ci_video" : "wechat_sec_check",
    subject_type: isVideo ? "album_video" : "album_image",
    subject_id: isVideo ? "91" : "92",
    subject_version: isVideo ? "etag-video" : "etag-image",
    decided_by_admin_user_id: null
  };
  const repository = {
    createModerationJob: async () => ({ ...job }),
    claimInitialModerationLease: async (_connection, input) => {
      state.initialClaims.push(input);
      if (!initialLeaseGranted) return false;
      state.initialLeaseToken = input.leaseToken;
      return true;
    },
    renewModerationLease: async (_connection, input) => {
      state.renewals.push(input);
      state.timeline.push("lease_renewal");
      return renewalGranted && liveLease;
    },
    findModerationJobById: async (_connection, _jobId, options = {}) => {
      if (options.leaseToken) {
        state.leaseChecks += 1;
        state.timeline.push("lease_check");
      }
      if (
        options.leaseToken &&
        (
          !liveLease ||
          state.leaseChecks > maxLiveLeaseChecks ||
          options.leaseToken !== state.initialLeaseToken
        )
      ) return null;
      return { ...job, lease_token: state.initialLeaseToken };
    },
    recordModerationSubmission: async (_connection, input) => {
      state.recorded.push(input);
      return input.leaseToken === state.initialLeaseToken && liveLease;
    },
    failModerationJob: async (_connection, input) => {
      state.failures.push(input);
      return input.leaseToken === state.initialLeaseToken && liveLease;
    }
  };
  let uuid = 0;
  const service = createContentModerationService({
    config: { tencentVideoPolicyId: "policy", retryLimit: 8 },
    repository,
    client: isVideo
      ? { submitVideo: async (input) => {
        state.timeline.push("provider");
        state.providerCalls.push(input);
        return { JobId: "video-job-81" };
      } }
      : { checkImage: async (input) => {
        state.timeline.push("provider");
        state.providerCalls.push(input);
        return { traceId: "image-trace-82" };
      } },
    transaction: async (run) => run({}),
    withDatabaseConnection: async (run) => run({}),
    randomUUID: () => `lease-test-${++uuid}`,
    now: () => 1_000,
    random: () => 0,
    getVerifiedImageUploaderOpenid: async () => {
      state.timeline.push("openid_lookup");
      return "openid-82";
    },
    buildWechatImageUrl: async () => {
      state.timeline.push("signed_url");
      return "https://example.test/private-image";
    },
    emit: () => {}
  });
  return { service, state };
}

test("initial video submission reserves a 90-second lease before its provider call", async () => {
  const { service, state } = mediaHarness("video");
  const job = await service.createVideoJob({}, {
    media: { id: 91 },
    objectKey: "uploads/session-album/videos/source/a.mp4",
    subjectVersion: "etag-video"
  });

  assert.equal(job.initialLeaseAcquired, true);
  assert.equal(job.initialLeaseToken, "lease-test-2");
  assert.deepEqual(state.initialClaims, [{
    jobId: 81,
    leaseToken: "lease-test-2",
    leaseExpiresAt: new Date(91_000)
  }]);

  await service.submitVideoJob(job);
  assert.equal(state.providerCalls.length, 1);
  assert.equal(state.recorded[0].leaseToken, "lease-test-2");
  assert.deepEqual(state.renewals, [{
    jobId: 81,
    leaseToken: "lease-test-2",
    fromStatus: "pending",
    leaseDurationMs: 90_000
  }]);
});

test("an image job without an acquired initial lease is not returned for WeChat submission", async () => {
  const { service, state } = mediaHarness("image", { initialLeaseGranted: false });
  const job = await service.createWechatImageModerationJob({}, {
    media: { id: 92, uploader_user_id: 7 },
    objectKey: "uploads/session-album/display/a.jpg",
    subjectVersion: "etag-image"
  });

  assert.equal(job, null);
  assert.deepEqual(state.providerCalls, []);
  assert.deepEqual(state.recorded, []);
  assert.deepEqual(state.failures, []);
});

test("a lost initial video lease cannot submit or write a failure transition", async () => {
  const { service, state } = mediaHarness("video", { liveLease: false });
  const job = await service.createVideoJob({}, {
    media: { id: 91 },
    objectKey: "uploads/session-album/videos/source/a.mp4",
    subjectVersion: "etag-video"
  });

  await assert.rejects(service.submitVideoJob(job), {
    code: "CONTENT_MODERATION_SUBMISSION_STALE"
  });
  assert.deepEqual(state.providerCalls, []);
  assert.deepEqual(state.recorded, []);
  assert.deepEqual(state.failures, []);
});

test("an initial video submission does not call Tencent when its atomic 90-second renewal loses an admin or expiry race", async () => {
  const { service, state } = mediaHarness("video", { renewalGranted: false });
  const job = await service.createVideoJob({}, {
    media: { id: 91 },
    objectKey: "uploads/session-album/videos/source/a.mp4",
    subjectVersion: "etag-video"
  });

  await assert.rejects(service.submitVideoJob(job), {
    code: "CONTENT_MODERATION_SUBMISSION_STALE"
  });
  assert.equal(state.providerCalls.length, 0);
  assert.equal(state.recorded.length, 0);
  assert.equal(state.failures.length, 0);
  assert.deepEqual(state.renewals, [{
    jobId: 81,
    leaseToken: "lease-test-2",
    fromStatus: "pending",
    leaseDurationMs: 90_000
  }]);
});

test("an image submission signs only after its renewed lease still owns the provider call", async () => {
  const { service, state } = mediaHarness("image", { renewalGranted: false });
  const job = await service.createWechatImageModerationJob({}, {
    media: { id: 92, uploader_user_id: 7 },
    objectKey: "uploads/session-album/display/a.jpg",
    subjectVersion: "etag-image"
  });

  await assert.rejects(service.submitWechatImageModeration(job), {
    code: "CONTENT_MODERATION_SUBMISSION_STALE"
  });
  assert.deepEqual(state.timeline, [
    "lease_check",
    "openid_lookup",
    "lease_renewal"
  ]);
  assert.equal(state.timeline.includes("signed_url"), false);
  assert.deepEqual(state.providerCalls, []);
  assert.deepEqual(state.recorded, []);
  assert.deepEqual(state.failures, []);
});

function textHarness({ initialLeaseGranted = true, liveLease = true } = {}) {
  const state = {
    initialClaims: [],
    checks: [],
    applies: 0,
    transitions: [],
    proposalTransitions: [],
    renewals: [],
    initialLeaseToken: null
  };
  const job = {
    id: 83,
    status: "pending",
    attempt_count: 0,
    provider: "wechat_sec_check",
    subject_type: "session_update",
    subject_id: "text-op-83",
    subject_version: "",
    decided_by_admin_user_id: null
  };
  const proposal = {
    id: 93,
    moderation_job_id: 83,
    status: "pending",
    action: "update_session",
    subject_type: "session_update",
    subject_id: "text-op-83",
    base_version: "session-v1",
    idempotency_key: "request-83",
    payload_digest: "",
    created_by_user_id: 7,
    normalized_payload_json: "",
    applied_result_json: null
  };
  const repository = {
    createModerationJob: async (_connection, input) => {
      job.subject_type = input.subjectType;
      job.subject_id = input.subjectId;
      job.subject_version = input.subjectVersion;
      job.provider = input.provider;
      return { ...job };
    },
    createTextProposal: async (_connection, input) => {
      proposal.subject_type = input.subjectType;
      proposal.subject_id = input.subjectId;
      proposal.action = input.action;
      proposal.base_version = input.baseVersion;
      proposal.idempotency_key = input.idempotencyKey;
      proposal.payload_digest = input.payloadDigest;
      proposal.normalized_payload_json = JSON.stringify(input.normalizedPayload);
      return proposal.id;
    },
    claimInitialModerationLease: async (_connection, input) => {
      state.initialClaims.push(input);
      if (!initialLeaseGranted) return false;
      state.initialLeaseToken = input.leaseToken;
      return true;
    },
    renewModerationLease: async (_connection, input) => {
      state.renewals.push(input);
      return true;
    },
    findModerationJobById: async (_connection, _jobId, options = {}) => {
      if (
        options.leaseToken &&
        (!liveLease || options.leaseToken !== state.initialLeaseToken)
      ) return null;
      return { ...job, lease_token: state.initialLeaseToken };
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
      return true;
    },
    markTextProposalStale: async () => true,
    failModerationJob: async () => false
  };
  let uuid = 0;
  const service = createContentModerationService({
    config: { retryLimit: 8 },
    repository,
    client: { checkText: async (input) => {
      state.checks.push(input);
      return { suggestion: "pass" };
    } },
    transaction: async (run) => run({}),
    withDatabaseConnection: async (run) => run({}),
    randomUUID: () => `text-lease-${++uuid}`,
    now: () => 1_000,
    random: () => 0,
    applyTextProposal: async () => {
      state.applies += 1;
      return { id: 99, kind: "session_update" };
    },
    emit: () => {}
  });
  return { service, state };
}

function textInput() {
  return {
    subjectType: "session_update",
    subjectId: "12",
    actorUserId: 7,
    openid: "openid-7",
    action: "update_session",
    baseVersion: "session-v1",
    idempotencyKey: "request-83",
    fields: { note: "审核文本" },
    payload: { body: { note: "审核文本" } }
  };
}

test("text pass keeps the initial lease through the final application transition", async () => {
  const { service, state } = textHarness();

  assert.deepEqual(await service.moderateTextMutation(textInput()), {
    id: 99,
    kind: "session_update"
  });
  assert.equal(state.initialClaims[0].leaseToken, "text-lease-2");
  assert.equal(state.checks.length, 1);
  assert.equal(state.applies, 1);
  assert.equal(state.transitions.at(-1).leaseToken, "text-lease-2");
  assert.deepEqual(state.renewals, [{
    jobId: 83,
    leaseToken: "text-lease-2",
    fromStatus: "pending",
    leaseDurationMs: 90_000
  }]);
});

test("an existing text job without an initial lease is not checked or applied again", async () => {
  const { service, state } = textHarness({ initialLeaseGranted: false });

  await assert.rejects(service.moderateTextMutation(textInput()), {
    code: "CONTENT_MODERATION_UNAVAILABLE"
  });
  assert.deepEqual(state.checks, []);
  assert.equal(state.applies, 0);
  assert.deepEqual(state.transitions, []);
});
