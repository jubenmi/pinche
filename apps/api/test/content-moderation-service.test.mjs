import assert from "node:assert/strict";
import test from "node:test";

import { createContentModerationService } from "../src/modules/content-moderation/service.js";

function harness({ clientResult = { JobId: "provider-job-1" }, clientError = null } = {}) {
  const state = { created: [], submitted: [], transitions: [], mediaUpdates: [], cleanup: [] };
  const repository = {
    createModerationJob: async (_connection, input) => {
      state.created.push(input);
      return { id: 7, status: "pending", ...input };
    },
    recordModerationSubmission: async (_connection, input) => {
      state.submitted.push(input);
      return true;
    },
    transitionModerationJob: async (_connection, input) => {
      state.transitions.push(input);
      return true;
    },
    findModerationJobById: async () => ({
      id: 7,
      subject_type: "album_image",
      subject_id: "91",
      subject_version: "etag-1",
      status: "processing",
      decided_by_admin_user_id: null
    }),
    findModerationMedia: async () => ({
      id: 91,
      session_id: 8,
      media_type: "image",
      object_key: "uploads/session-album/display/a.jpg",
      moderation_status: "pending",
      status: "active"
    }),
    transitionMediaModeration: async (_connection, input) => {
      state.mediaUpdates.push(input);
      return true;
    },
    enqueueRejectedMediaCleanup: async (_connection, media) => {
      state.cleanup.push(media.id);
      return 99;
    }
  };
  const client = {
    submitImage: async () => {
      if (clientError) throw clientError;
      return clientResult;
    },
    submitVideo: async () => {
      if (clientError) throw clientError;
      return clientResult;
    }
  };
  const service = createContentModerationService({
    config: {
      enabled: true,
      imageEnabled: true,
      videoEnabled: true,
      imagePolicyId: "image-policy",
      videoPolicyId: "video-policy"
    },
    client,
    repository,
    withDatabaseConnection: async (run) => run({}),
    transaction: async (run) => run({}),
    randomUUID: () => "00000000-0000-4000-8000-000000000045",
    emit: () => {}
  });
  return { service, state };
}

test("image job is created from immutable media facts and submitted asynchronously", async () => {
  const { service, state } = harness();
  const job = await service.createImageJob({}, {
    media: { id: 91 },
    objectKey: "uploads/session-album/display/a.jpg",
    subjectVersion: "etag-1"
  });
  await service.submitImageJob(job);

  assert.deepEqual(state.created[0], {
    subjectType: "album_image",
    subjectId: "91",
    subjectVersion: "etag-1",
    provider: "tencent_ci",
    dataId: "00000000-0000-4000-8000-000000000045",
    policyId: "image-policy"
  });
  assert.equal(job.objectKey, "uploads/session-album/display/a.jpg");
  assert.equal(state.submitted[0].providerJobId, "provider-job-1");
});

test("submission failure moves the task to error and remains rejected to caller for telemetry", async () => {
  const upstream = Object.assign(new Error("timeout"), { code: "COS_REQUEST_TIMEOUT" });
  const { service, state } = harness({ clientError: upstream });
  const job = await service.createImageJob({}, {
    media: { id: 91 }, objectKey: "key", subjectVersion: "etag"
  });

  await assert.rejects(service.submitImageJob(job), { code: "COS_REQUEST_TIMEOUT" });
  assert.equal(state.transitions.length, 1);
  assert.equal(state.transitions[0].toStatus, "error");
  assert.equal(state.transitions[0].errorCode, "COS_REQUEST_TIMEOUT");
});

test("video job uses the video subject and policy", async () => {
  const { service, state } = harness();
  const job = await service.createVideoJob({}, {
    media: { id: 92 }, objectKey: "uploads/session-album/videos/source/a.mp4", subjectVersion: "etag-v"
  });
  await service.submitVideoJob(job);
  assert.equal(state.created[0].subjectType, "album_video");
  assert.equal(state.created[0].policyId, "video-policy");
});

for (const [decision, expectedStatus] of [
  ["pass", "approved"],
  ["review", "review"],
  ["block", "rejected"]
]) {
  test(`${decision} result atomically transitions both job and media`, async () => {
    const { service, state } = harness();
    const result = await service.applyMediaResult({
      jobId: 7,
      subjectVersion: "etag-1",
      objectKey: "uploads/session-album/display/a.jpg",
      result: { decision, suggestion: decision, label: "label", score: 80 }
    });
    assert.equal(result.status, expectedStatus);
    assert.equal(state.transitions.at(-1).toStatus, expectedStatus);
    assert.equal(state.mediaUpdates[0].toStatus, expectedStatus);
    assert.equal(state.cleanup.length, decision === "block" ? 1 : 0);
  });
}

test("stale immutable media result is rejected without changing media", async () => {
  const { service, state } = harness();
  await assert.rejects(service.applyMediaResult({
    jobId: 7,
    subjectVersion: "other-etag",
    objectKey: "uploads/session-album/display/a.jpg",
    result: { decision: "pass" }
  }), { code: "CONTENT_MODERATION_CALLBACK_STALE" });
  assert.equal(state.mediaUpdates.length, 0);
});
