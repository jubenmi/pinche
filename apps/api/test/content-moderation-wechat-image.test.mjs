import assert from "node:assert/strict";
import test from "node:test";

import { createContentModerationService } from "../src/modules/content-moderation/service.js";

const objectKey = "uploads/session-album/display/album-8-3-1.jpg";
const signedUrl = "https://bucket.cos.ap-nanjing.myqcloud.com/private.jpg?q-signature=must-not-persist";

function harness({
  openid = "verified-uploader-openid",
  clientError = null,
  retryLimit = 8,
  now = () => 1_000,
  random = () => 0
} = {}) {
  const state = {
    created: [],
    initialClaims: [],
    renewals: [],
    providerCalls: [],
    openidLookups: [],
    signedFor: [],
    submissions: [],
    transitions: [],
    failures: [],
    job: {
      id: 71,
      status: "pending",
      attempt_count: 0,
      provider: "wechat_sec_check",
      subject_type: "album_image",
      subject_id: "91",
      subject_version: "etag-image-91",
      lease_token: null,
      decided_by_admin_user_id: null
    },
    events: []
  };
  const repository = {
    createModerationJob: async (_connection, input) => {
      state.created.push(input);
      Object.assign(state.job, {
        status: "pending",
        attempt_count: 0,
        provider: input.provider,
        subject_type: input.subjectType,
        subject_id: input.subjectId,
        subject_version: input.subjectVersion,
        lease_token: null
      });
      return { id: 71, status: "pending", attempt_count: 0, ...input };
    },
    claimInitialModerationLease: async (_connection, input) => {
      state.initialClaims.push(input);
      state.job.lease_token = input.leaseToken;
      return true;
    },
    renewModerationLease: async (_connection, input) => {
      state.renewals.push(input);
      return (
        String(input.leaseToken) === String(state.job.lease_token || "") &&
        String(input.fromStatus) === String(state.job.status) &&
        state.job.decided_by_admin_user_id === null
      );
    },
    findModerationJobById: async (_connection, _jobId, options = {}) => {
      if (options.leaseToken && String(options.leaseToken) !== String(state.job.lease_token || "")) return null;
      return { ...state.job };
    },
    recordModerationSubmission: async (_connection, input) => {
      state.submissions.push(input);
      return true;
    },
    transitionModerationJob: async (_connection, input) => {
      state.transitions.push(input);
      return true;
    },
    failModerationJob: async (_connection, input) => {
      state.failures.push(input);
      state.job.status = "error";
      state.job.lease_token = null;
      return true;
    }
  };
  const service = createContentModerationService({
    config: { enabled: true, wechatImageEnabled: true, retryLimit },
    client: {
      checkImage: async (input) => {
        state.providerCalls.push(input);
        if (clientError) throw clientError;
        return { traceId: "wechat-image-trace-71" };
      }
    },
    repository,
    transaction: async (run) => run({}),
    withDatabaseConnection: async (run) => run({}),
    randomUUID: () => "00000000-0000-4000-8000-000000000071",
    now,
    random,
    getVerifiedImageUploaderOpenid: async ({ uploaderUserId }) => {
      state.openidLookups.push(uploaderUserId);
      return openid;
    },
    buildWechatImageUrl: ({ objectKey: key }) => {
      state.signedFor.push(key);
      return signedUrl;
    },
    emit: (event, fields) => state.events.push({ event, fields })
  });
  return { service, state };
}

async function createImageJob(service) {
  return service.createWechatImageModerationJob({}, {
    media: { id: 91, uploader_user_id: 3 },
    objectKey,
    subjectVersion: "etag-image-91"
  });
}

test("WeChat image job records immutable image facts and persists only its returned trace", async () => {
  const { service, state } = harness();
  const job = await createImageJob(service);

  assert.deepEqual(state.created, [{
    subjectType: "album_image",
    subjectId: "91",
    subjectVersion: "etag-image-91",
    provider: "wechat_sec_check",
    dataId: "00000000-0000-4000-8000-000000000071",
    policyId: null
  }]);
  assert.deepEqual(job, {
    id: 71,
    status: "pending",
    attempt_count: 0,
    subjectType: "album_image",
    subjectId: "91",
    subjectVersion: "etag-image-91",
    provider: "wechat_sec_check",
    dataId: "00000000-0000-4000-8000-000000000071",
    policyId: null,
    kind: "wechat_image",
    initialLeaseAcquired: true,
    initialLeaseToken: "00000000-0000-4000-8000-000000000071",
    objectKey,
    uploaderUserId: 3
  });

  const result = await service.submitWechatImageModeration(job);
  assert.deepEqual(result, { traceId: "wechat-image-trace-71" });
  assert.deepEqual(state.openidLookups, [3]);
  assert.deepEqual(state.signedFor, [objectKey]);
  assert.deepEqual(state.providerCalls, [{
    mediaUrl: signedUrl,
    openid: "verified-uploader-openid",
    scene: 4,
    subjectType: "album_image"
  }]);
  assert.deepEqual(state.submissions, [{
    jobId: 71,
    provider: "wechat_sec_check",
    providerJobId: "wechat-image-trace-71",
    fromStatus: "pending",
    leaseToken: job.initialLeaseToken,
    responseSummary: { traceId: "wechat-image-trace-71" }
  }]);
  assert.deepEqual(state.renewals, [{
    jobId: 71,
    leaseToken: job.initialLeaseToken,
    fromStatus: "pending",
    leaseDurationMs: 90_000
  }]);
  assert.equal(JSON.stringify({ submissions: state.submissions, events: state.events }).includes("q-signature"), false);
});

test("a retried image submission carries its locked lease and immutable facts into the final attempt rollover", async () => {
  const { service, state } = harness();
  const job = await createImageJob(service);
  const retryFacts = {
    kind: "album_image",
    mediaId: 91,
    subjectVersion: "etag-image-91",
    objectKey,
    uploaderUserId: 3
  };
  state.job.status = "error";
  state.job.lease_token = "lease-image";

  await service.submitWechatImageModeration({
    ...job,
    status: "error",
    leaseToken: "lease-image",
    retryFacts
  });

  assert.deepEqual(state.submissions.at(-1), {
    jobId: 71,
    provider: "wechat_sec_check",
    providerJobId: "wechat-image-trace-71",
    fromStatus: "error",
    leaseToken: "lease-image",
    retryFacts,
    responseSummary: { traceId: "wechat-image-trace-71" }
  });
  assert.deepEqual(state.renewals.at(-1), {
    jobId: 71,
    leaseToken: "lease-image",
    fromStatus: "error",
    leaseDurationMs: 90_000
  });
  assert.equal(JSON.stringify(state.submissions).includes("q-signature"), false);
});

test("a retry submission failure preserves its lease for the Worker to schedule or exhaust", async () => {
  const upstream = Object.assign(new Error("provider timeout"), {
    code: "WECHAT_CONTENT_SECURITY_TIMEOUT"
  });
  const { service, state } = harness({ clientError: upstream });
  const job = await createImageJob(service);
  state.job.status = "error";
  state.job.lease_token = "lease-image";

  await assert.rejects(service.submitWechatImageModeration({
    ...job,
    status: "error",
    leaseToken: "lease-image",
    retryFacts: {
      kind: "album_image",
      mediaId: 91,
      subjectVersion: "etag-image-91",
      objectKey,
      uploaderUserId: 3
    }
  }), { code: "WECHAT_CONTENT_SECURITY_TIMEOUT" });

  assert.deepEqual(state.transitions, []);
  assert.deepEqual(state.failures, []);
  assert.deepEqual(state.events, [{
    event: "moderation_job_created",
    fields: {
      provider: "wechat_sec_check",
      subjectType: "album_image",
      outcome: "pending"
    }
  }]);
});

test("image job rejects oversized immutable object facts instead of truncating them", async () => {
  const { service, state } = harness();

  await assert.rejects(
    service.createWechatImageModerationJob({}, {
      media: { id: 91, uploader_user_id: 3 },
      objectKey: `uploads/session-album/display/${"a".repeat(1_024)}.jpg`,
      subjectVersion: "etag-image-91"
    }),
    { code: "CONTENT_MODERATION_CONFIGURATION_ERROR" }
  );
  assert.deepEqual(state.created, []);
});

test("missing verified uploader openid fails closed before issuing a provider URL", async () => {
  const { service, state } = harness({ openid: "" });
  const job = await createImageJob(service);

  await assert.rejects(
    service.submitWechatImageModeration(job),
    { code: "CONTENT_MODERATION_OPENID_REQUIRED" }
  );
  assert.deepEqual(state.signedFor, []);
  assert.deepEqual(state.providerCalls, []);
  assert.equal(state.failures.length, 1);
  assert.deepEqual(state.failures[0], {
    jobId: 71,
    leaseToken: job.initialLeaseToken,
    attempts: 1,
    nextRetryAt: null,
    errorCode: "CONTENT_MODERATION_OPENID_REQUIRED",
    exhausted: true
  });
  assert.deepEqual(state.events.at(-1), {
    event: "moderation_operational_alert",
    fields: {
      provider: "wechat_sec_check",
      subjectType: "album_image",
      outcome: "operator_required",
      errorCode: "CONTENT_MODERATION_OPENID_REQUIRED",
      attempt: 1,
      priority: "high"
    }
  });
});

test("provider failures keep the image hidden in error and never put its signed URL in state or telemetry", async () => {
  const upstream = Object.assign(new Error("upstream timeout"), {
    code: "WECHAT_CONTENT_SECURITY_TIMEOUT"
  });
  const { service, state } = harness({ clientError: upstream });
  const job = await createImageJob(service);

  await assert.rejects(service.submitWechatImageModeration(job), {
    code: "WECHAT_CONTENT_SECURITY_TIMEOUT"
  });
  assert.equal(state.failures.length, 1);
  assert.deepEqual(state.failures[0], {
    jobId: 71,
    leaseToken: job.initialLeaseToken,
    attempts: 1,
    nextRetryAt: new Date(31_000),
    errorCode: "WECHAT_CONTENT_SECURITY_TIMEOUT",
    exhausted: false
  });
  const fields = {
    provider: "wechat_sec_check",
    subjectType: "album_image",
    outcome: "retry_scheduled",
    errorCode: "WECHAT_CONTENT_SECURITY_TIMEOUT",
    attempt: 1
  };
  assert.deepEqual(state.events.slice(-2), [
    { event: "moderation_submission_failure", fields },
    { event: "moderation_retry_scheduled", fields }
  ]);
  assert.equal(state.submissions.length, 0);
  assert.equal(JSON.stringify({ transitions: state.transitions, events: state.events }).includes("q-signature"), false);
});
