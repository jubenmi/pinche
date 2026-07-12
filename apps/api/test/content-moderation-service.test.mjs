import assert from "node:assert/strict";
import test from "node:test";

import { createContentModerationService } from "../src/modules/content-moderation/service.js";

function harness({
  clientError = null,
  jobOverrides = {},
  mediaOverrides = {},
  attemptOverrides = {}
} = {}) {
  const state = {
    created: [], submitted: [], transitions: [], mediaUpdates: [], cleanup: [],
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
      return { id: 7, status: "pending", ...input };
    },
    recordModerationSubmission: async (_connection, input) => { state.submitted.push(input); return true; },
    transitionModerationJob: async (_connection, input) => {
      state.transitions.push(input);
      state.job.status = input.toStatus;
      if (input.source === "admin") state.job.decided_by_admin_user_id = input.adminUserId;
      return true;
    },
    findModerationJobById: async () => ({ ...state.job }),
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
    config: { enabled: true, tencentVideoEnabled: true, tencentVideoPolicyId: "video-policy" },
    client: { submitVideo: async () => {
      if (clientError) throw clientError;
      return { JobId: "provider-job-1" };
    } },
    repository,
    withDatabaseConnection: async (run) => run({}),
    transaction: async (run) => run({}),
    randomUUID: () => "00000000-0000-4000-8000-000000000045",
    emit: () => {}
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
});

test("video submission failure moves task to error and remains hidden", async () => {
  const upstream = Object.assign(new Error("timeout"), { code: "COS_REQUEST_TIMEOUT" });
  const { service, state } = harness({ clientError: upstream });
  const job = await service.createVideoJob({}, { media: { id: 91 }, objectKey: "key", subjectVersion: "etag" });
  await assert.rejects(service.submitVideoJob(job), { code: "COS_REQUEST_TIMEOUT" });
  assert.equal(state.transitions[0].toStatus, "error");
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
