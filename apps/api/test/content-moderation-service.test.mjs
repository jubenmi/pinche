import assert from "node:assert/strict";
import test from "node:test";

import { createContentModerationService } from "../src/modules/content-moderation/service.js";

function harness({
  clientError = null,
  recordSubmissionResult = true,
  jobOverrides = {},
  mediaOverrides = {},
  attemptOverrides = {},
  retryLimit = 8,
  now = () => 1_000,
  random = () => 0
} = {}) {
  const state = {
    created: [], initialClaims: [], renewals: [], submitted: [], failures: [], providerCalls: [], transitions: [], mediaUpdates: [], cleanup: [],
    events: [],
    transactionCalls: 0, databaseConnectionCalls: 0,
    currentAttempt: { id: 19, moderation_job_id: 7, is_current: 1, ...attemptOverrides },
    job: {
      id: 7, subject_type: "album_video", subject_id: "91", subject_version: "etag-1",
      provider: "tencent_ci_video", status: "processing", decided_by_admin_user_id: null,
      ...jobOverrides
    }
  };
  const repository = {
    createModerationJob: async (_connection, input) => {
      state.created.push(input);
      Object.assign(state.job, {
        subject_type: input.subjectType,
        subject_id: input.subjectId,
        subject_version: input.subjectVersion,
        provider: input.provider,
        status: "pending",
        attempt_count: 0,
        decided_by_admin_user_id: null
      });
      return { id: 7, status: "pending", ...input };
    },
    claimInitialModerationLease: async (_connection, input) => {
      state.initialClaims.push(input);
      state.job.lease_token = input.leaseToken;
      return true;
    },
    renewModerationLease: async (_connection, input) => {
      state.renewals.push(input);
      return (
        String(state.job.lease_token || "") === String(input.leaseToken) &&
        String(state.job.status) === String(input.fromStatus) &&
        state.job.decided_by_admin_user_id === null
      );
    },
    recordModerationSubmission: async (_connection, input) => {
      state.submitted.push(input);
      return recordSubmissionResult;
    },
    transitionModerationJob: async (_connection, input) => {
      state.transitions.push(input);
      state.job.status = input.toStatus;
      if (input.source === "admin") state.job.decided_by_admin_user_id = input.adminUserId;
      return true;
    },
    findModerationJobById: async (_connection, _jobId, options = {}) => {
      if (options.leaseToken && String(state.job.lease_token || "") !== String(options.leaseToken)) return null;
      return { ...state.job };
    },
    failModerationJob: async (_connection, input) => {
      state.failures.push(input);
      state.job.status = "error";
      state.job.lease_token = null;
      return true;
    },
    findModerationMedia: async () => ({
      id: 91, session_id: 8, media_type: "video",
      source_url: "/uploads/session-album/videos/source/a.mp4",
      moderation_object_version: "etag-1", moderation_status: "pending", status: "active",
      ...mediaOverrides
    }),
    transitionMediaModeration: async (_connection, input) => { state.mediaUpdates.push(input); return true; },
    enqueueRejectedMediaCleanup: async (_connection, media) => { state.cleanup.push(media.id); return 99; }
  };
  repository.findModerationAttemptByProviderJobId = async (_connection, provider, providerJobId) => ({
    ...state.currentAttempt,
    provider,
    provider_job_id: providerJobId
  });
  repository.findCurrentModerationAttempt = async () => ({ ...state.currentAttempt });
  const service = createContentModerationService({
    config: {
      enabled: true,
      tencentVideoEnabled: true,
      tencentVideoPolicyId: "video-policy",
      retryLimit
    },
    client: { submitVideo: async (input) => {
      state.providerCalls.push(input);
      if (clientError) throw clientError;
      return { JobId: "provider-job-1" };
    } },
    repository,
    withDatabaseConnection: async (run) => {
      state.databaseConnectionCalls += 1;
      return run({});
    },
    transaction: async (run) => {
      state.transactionCalls += 1;
      return run({});
    },
    randomUUID: () => "00000000-0000-4000-8000-000000000045",
    now,
    random,
    emit: (event, fields) => state.events.push({ event, fields })
  });
  return { service, state };
}

test("service exposes Tencent video flow and the WeChat text entrypoint without Tencent image methods", () => {
  const { service } = harness();
  assert.equal(typeof service.createVideoJob, "function");
  assert.equal(typeof service.submitVideoJob, "function");
  assert.equal("createImageJob" in service, false);
  assert.equal("submitImageJob" in service, false);
  assert.equal(typeof service.moderateTextMutation, "function");
});

test("video job uses immutable media facts and Tencent video provider", async () => {
  const { service, state } = harness();
  const job = await service.createVideoJob({}, {
    media: { id: 92 }, objectKey: "uploads/session-album/videos/source/a.mp4", subjectVersion: "etag-v"
  });
  await service.submitVideoJob(job);
  assert.deepEqual(state.created[0], {
    subjectType: "album_video", subjectId: "92", subjectVersion: "etag-v",
    provider: "tencent_ci_video", dataId: "00000000-0000-4000-8000-000000000045",
    policyId: "video-policy"
  });
  assert.equal(state.submitted[0].providerJobId, "provider-job-1");
  assert.equal(state.submitted[0].provider, "tencent_ci_video");
  assert.equal(state.submitted[0].leaseToken, job.initialLeaseToken);
  assert.deepEqual(state.renewals, [{
    jobId: 7,
    leaseToken: job.initialLeaseToken,
    fromStatus: "pending",
    leaseDurationMs: 90_000
  }]);
});

test("moderation lifecycle events retain provider dimensions and only numeric latency", async () => {
  const { service: createService, state: createState } = harness();
  await createService.createVideoJob({}, {
    media: { id: 92 },
    objectKey: "uploads/session-album/videos/source/a.mp4",
    subjectVersion: "etag-v"
  });
  assert.deepEqual(createState.events, [{
    event: "moderation_job_created",
    fields: {
      provider: "tencent_ci_video",
      subjectType: "album_video",
      outcome: "pending"
    }
  }]);

  const { service, state } = harness({
    now: () => Date.parse("2026-07-12T08:00:01.000Z"),
    jobOverrides: { created_at: "2026-07-12T08:00:00.000Z" }
  });
  await service.applyMediaResult({
    jobId: 7,
    provider: "tencent_ci_video",
    providerJobId: "current-video-job",
    subjectVersion: "etag-1",
    objectKey: "uploads/session-album/videos/source/a.mp4",
    result: { decision: "pass", suggestion: "pass" }
  });
  const fields = {
    provider: "tencent_ci_video",
    subjectType: "album_video",
    outcome: "approved",
    latencyMs: 1_000
  };
  assert.deepEqual(state.events, [
    { event: "moderation_decision_pass", fields },
    { event: "moderation_latency", fields }
  ]);
});

test("provider attempt rollover runs inside the repository transaction", async () => {
  const { service, state } = harness();
  const job = await service.createVideoJob({}, {
    media: { id: 92 }, objectKey: "uploads/session-album/videos/source/a.mp4", subjectVersion: "etag-v"
  });
  const baselineTransactions = state.transactionCalls;
  const baselineConnections = state.databaseConnectionCalls;

  await service.submitVideoJob(job);

  assert.equal(state.transactionCalls, baselineTransactions + 1);
  assert.equal(state.databaseConnectionCalls, baselineConnections + 1);
});

test("video submission failure moves task to error and remains hidden", async () => {
  const upstream = Object.assign(new Error("timeout"), { code: "COS_REQUEST_TIMEOUT" });
  const { service, state } = harness({ clientError: upstream });
  const job = await service.createVideoJob({}, { media: { id: 91 }, objectKey: "key", subjectVersion: "etag" });
  await assert.rejects(service.submitVideoJob(job), { code: "COS_REQUEST_TIMEOUT" });
  assert.deepEqual(state.failures[0], {
    jobId: 7,
    leaseToken: job.initialLeaseToken,
    attempts: 1,
    nextRetryAt: new Date(31_000),
    errorCode: "COS_REQUEST_TIMEOUT",
    exhausted: false
  });
  assert.deepEqual(state.events.slice(-2), [
    {
      event: "moderation_submission_failure",
      fields: {
        provider: "tencent_ci_video",
        subjectType: "album_video",
        outcome: "retry_scheduled",
        errorCode: "COS_REQUEST_TIMEOUT",
        attempt: 1
      }
    },
    {
      event: "moderation_retry_scheduled",
      fields: {
        provider: "tencent_ci_video",
        subjectType: "album_video",
        outcome: "retry_scheduled",
        errorCode: "COS_REQUEST_TIMEOUT",
        attempt: 1
      }
    }
  ]);
});

test("a retried video submission failure leaves its lease for Worker retry bookkeeping", async () => {
  const upstream = Object.assign(new Error("timeout"), { code: "TENCENT_CI_VIDEO_TIMEOUT" });
  const { service, state } = harness({ clientError: upstream });
  const job = await service.createVideoJob({}, {
    media: { id: 91 }, objectKey: "uploads/session-album/videos/source/a.mp4", subjectVersion: "etag"
  });
  state.job.status = "error";
  state.job.lease_token = "lease-video";

  await assert.rejects(service.submitVideoJob({
    ...job,
    status: "error",
    leaseToken: "lease-video",
    retryFacts: {
      kind: "album_video",
      mediaId: 91,
      subjectVersion: "etag",
      objectKey: "uploads/session-album/videos/source/a.mp4",
      uploaderUserId: 7
    }
  }), { code: "TENCENT_CI_VIDEO_TIMEOUT" });

  assert.deepEqual(state.transitions, []);
  assert.deepEqual(state.failures, []);
  assert.deepEqual(state.renewals.at(-1), {
    jobId: 7,
    leaseToken: "lease-video",
    fromStatus: "error",
    leaseDurationMs: 90_000
  });
});

test("video submission treats an unrecorded provider attempt as a hidden failure", async () => {
  const { service, state } = harness({ recordSubmissionResult: false });
  const job = await service.createVideoJob({}, {
    media: { id: 91 },
    objectKey: "uploads/session-album/videos/source/a.mp4",
    subjectVersion: "etag"
  });

  await assert.rejects(service.submitVideoJob(job), {
    code: "CONTENT_MODERATION_SUBMISSION_STALE"
  });
  assert.equal(state.submitted.length, 1);
  assert.equal(state.failures.length, 0);
});

for (const [decision, expectedStatus] of [["pass", "approved"], ["review", "review"], ["block", "rejected"]]) {
  test(`${decision} video result atomically transitions job and media`, async () => {
    const { service, state } = harness();
    const result = await service.applyMediaResult({
      jobId: 7,
      provider: "tencent_ci_video",
      providerJobId: "current-video-job",
      subjectVersion: "etag-1",
      objectKey: "uploads/session-album/videos/source/a.mp4",
      result: { decision, suggestion: decision, label: "label", score: 80 }
    });
    assert.equal(result.status, expectedStatus);
    assert.equal(state.mediaUpdates[0].toStatus, expectedStatus);
    assert.equal(state.cleanup.length, decision === "block" ? 1 : 0);
  });
}

test("an unknown Tencent decision transitions the current video to the unified hidden error state", async () => {
  const { service, state } = harness();
  const result = await service.applyMediaResult({
    jobId: 7,
    provider: "tencent_ci_video",
    providerJobId: "current-video-job",
    subjectVersion: "etag-1",
    objectKey: "uploads/session-album/videos/source/a.mp4",
    result: { decision: "error", suggestion: "Unexpected" }
  });
  assert.equal(result.status, "error");
  assert.equal(state.transitions[0].toStatus, "error");
  assert.equal(state.transitions[0].errorCode, "CONTENT_MODERATION_INVALID_RESPONSE");
  assert.equal(state.mediaUpdates[0].toStatus, "error");
});

test("a provider callback error persists delayed retry state while media remains hidden", async () => {
  const { service, state } = harness({
    jobOverrides: { attempt_count: 1 },
    retryLimit: 3
  });

  const result = await service.applyMediaResult({
    jobId: 7,
    provider: "tencent_ci_video",
    providerJobId: "current-video-job",
    subjectVersion: "etag-1",
    objectKey: "uploads/session-album/videos/source/a.mp4",
    result: { decision: "error", suggestion: "provider-failed" }
  });

  assert.equal(result.status, "error");
  assert.deepEqual(state.transitions[0].retry, {
    attempts: 1,
    nextRetryAt: new Date(31_000),
    exhausted: false
  });
  assert.deepEqual(state.mediaUpdates[0], {
    mediaId: 91,
    fromStatuses: ["pending", "error"],
    toStatus: "error"
  });
  assert.deepEqual(state.events.at(-1), {
    event: "moderation_retry_scheduled",
    fields: {
      provider: "tencent_ci_video",
      subjectType: "album_video",
      outcome: "retry_scheduled",
      errorCode: "CONTENT_MODERATION_INVALID_RESPONSE",
      attempt: 1
    }
  });
});

test("a provider callback error at the retry limit persists exhaustion and raises a high alert", async () => {
  const { service, state } = harness({
    jobOverrides: { attempt_count: 3 },
    retryLimit: 3
  });

  await service.applyMediaResult({
    jobId: 7,
    provider: "tencent_ci_video",
    providerJobId: "current-video-job",
    subjectVersion: "etag-1",
    objectKey: "uploads/session-album/videos/source/a.mp4",
    result: { decision: "error", suggestion: "provider-failed" }
  });

  assert.deepEqual(state.transitions[0].retry, {
    attempts: 3,
    nextRetryAt: null,
    exhausted: true
  });
  assert.deepEqual(state.events.at(-1), {
    event: "moderation_retry_exhausted",
    fields: {
      provider: "tencent_ci_video",
      subjectType: "album_video",
      outcome: "operator_required",
      errorCode: "CONTENT_MODERATION_INVALID_RESPONSE",
      attempt: 3,
      priority: "high"
    }
  });
});

function wechatImageResult(decision = "pass") {
  return {
    jobId: 7,
    provider: "wechat_sec_check",
    providerJobId: "wechat-image-trace-7",
    subjectVersion: "etag-1",
    result: { decision, suggestion: decision, label: "normal", score: 100 }
  };
}

test("a WeChat image result reads the object key only from locked media state", async () => {
  const { service, state } = harness({
    jobOverrides: { provider: "wechat_sec_check", subject_type: "album_image" },
    mediaOverrides: {
      media_type: "image",
      object_key: "uploads/session-album/display/image-91.jpg"
    }
  });

  const result = await service.applyMediaResult(wechatImageResult());

  assert.deepEqual(result, { status: "approved", duplicate: false });
  assert.equal(state.mediaUpdates[0].toStatus, "approved");
});

test("duplicate WeChat image events are idempotent after the first current result", async () => {
  const { service, state } = harness({
    jobOverrides: { provider: "wechat_sec_check", subject_type: "album_image" },
    mediaOverrides: {
      media_type: "image",
      object_key: "uploads/session-album/display/image-91.jpg"
    }
  });

  await service.applyMediaResult(wechatImageResult());
  const duplicate = await service.applyMediaResult(wechatImageResult());

  assert.deepEqual(duplicate, { status: "approved", duplicate: true, stale: false });
  assert.equal(state.mediaUpdates.length, 1);
});

for (const [name, options, expected] of [
  ["old attempt", { attemptOverrides: { is_current: 0 } }, { stale: true }],
  ["changed media version", { mediaOverrides: { moderation_object_version: "etag-new" } }, { stale: true }],
  ["missing internal object key", { mediaOverrides: { object_key: "" } }, { stale: true }],
  ["deleted media", { mediaOverrides: { status: "deleted" } }, { stale: true }],
  [
    "administrator decision",
    { jobOverrides: { status: "review", decided_by_admin_user_id: 2 } },
    { stale: true, adminDecided: true }
  ]
]) {
  test(`a WeChat image ${name} event cannot overwrite the current hidden state`, async () => {
    const { service, state } = harness({
      ...options,
      jobOverrides: {
        provider: "wechat_sec_check",
        subject_type: "album_image",
        ...options.jobOverrides
      },
      mediaOverrides: {
        media_type: "image",
        object_key: "uploads/session-album/display/image-91.jpg",
        ...options.mediaOverrides
      }
    });

    const result = await service.applyMediaResult(wechatImageResult());

    assert.equal(result.stale, expected.stale);
    if (expected.adminDecided) assert.equal(result.adminDecided, true);
    assert.equal(state.transitions.length, 0);
    assert.equal(state.mediaUpdates.length, 0);
  });
}

test("stale immutable video result cannot change media", async () => {
  const { service, state } = harness();
  const result = await service.applyMediaResult({
    jobId: 7,
    provider: "tencent_ci_video",
    providerJobId: "current-video-job",
    subjectVersion: "other-etag",
    objectKey: "uploads/session-album/videos/source/a.mp4", result: { decision: "pass" }
  });
  assert.equal(result.status, "processing");
  assert.equal(result.stale, true);
  assert.equal(state.transitions.length, 0);
  assert.equal(state.mediaUpdates.length, 0);
});

test("a video callback with a missing persisted media version stays hidden", async () => {
  const { service, state } = harness({
    mediaOverrides: { moderation_object_version: null }
  });

  const result = await service.applyMediaResult({
    jobId: 7,
    provider: "tencent_ci_video",
    providerJobId: "current-video-job",
    subjectVersion: "etag-1",
    objectKey: "uploads/session-album/videos/source/a.mp4",
    result: { decision: "pass" }
  });

  assert.equal(result.status, "processing");
  assert.equal(result.stale, true);
  assert.equal(state.transitions.length, 0);
  assert.equal(state.mediaUpdates.length, 0);
});

test("a stale video object key is idempotent and cannot change media", async () => {
  const { service, state } = harness();
  const result = await service.applyMediaResult({
    jobId: 7,
    provider: "tencent_ci_video",
    providerJobId: "current-video-job",
    subjectVersion: "etag-1",
    objectKey: "uploads/session-album/videos/source/other.mp4",
    result: { decision: "pass" }
  });

  assert.equal(result.status, "processing");
  assert.equal(result.stale, true);
  assert.equal(state.transitions.length, 0);
  assert.equal(state.mediaUpdates.length, 0);
});

test("a provider result without provider attempt identity stays hidden", async () => {
  const { service, state } = harness();
  const result = await service.applyMediaResult({
    jobId: 7,
    subjectVersion: "etag-1",
    objectKey: "uploads/session-album/videos/source/a.mp4",
    result: { decision: "pass" }
  });

  assert.equal(result.status, "processing");
  assert.equal(result.stale, true);
  assert.equal(state.transitions.length, 0);
  assert.equal(state.mediaUpdates.length, 0);
});

test("a result for an old provider attempt is idempotent and cannot publish media", async () => {
  const { service, state } = harness();
  state.currentAttempt = { id: 18, moderation_job_id: 7, is_current: 0 };

  const result = await service.applyMediaResult({
    jobId: 7,
    provider: "tencent_ci_video",
    providerJobId: "old-video-job",
    subjectVersion: "etag-1",
    objectKey: "uploads/session-album/videos/source/a.mp4",
    result: { decision: "pass" }
  });

  assert.equal(result.status, "processing");
  assert.equal(result.stale, true);
  assert.equal(state.transitions.length, 0);
  assert.equal(state.mediaUpdates.length, 0);
});

test("an administrator decision makes later provider result idempotent without changing media", async () => {
  const { service, state } = harness({
    jobOverrides: { status: "rejected", decided_by_admin_user_id: 2 }
  });
  const result = await service.applyMediaResult({
    jobId: 7,
    provider: "tencent_ci_video",
    providerJobId: "current-video-job",
    subjectVersion: "etag-1",
    objectKey: "uploads/session-album/videos/source/a.mp4",
    result: { decision: "pass" }
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.stale, true);
  assert.equal(result.adminDecided, true);
  assert.equal(state.transitions.length, 0);
  assert.equal(state.mediaUpdates.length, 0);
});
