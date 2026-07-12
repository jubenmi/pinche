import assert from "node:assert/strict";
import test from "node:test";

import { createContentModerationService } from "../src/modules/content-moderation/service.js";

function harness({ clientError = null } = {}) {
  const state = { created: [], submitted: [], transitions: [], mediaUpdates: [], cleanup: [] };
  const repository = {
    createModerationJob: async (_connection, input) => {
      state.created.push(input);
      return { id: 7, status: "pending", ...input };
    },
    recordModerationSubmission: async (_connection, input) => { state.submitted.push(input); return true; },
    transitionModerationJob: async (_connection, input) => { state.transitions.push(input); return true; },
    findModerationJobById: async () => ({
      id: 7, subject_type: "album_video", subject_id: "91", subject_version: "etag-1",
      status: "processing", decided_by_admin_user_id: null
    }),
    findModerationMedia: async () => ({
      id: 91, session_id: 8, media_type: "video",
      source_url: "/uploads/session-album/videos/source/a.mp4",
      moderation_object_version: "etag-1", moderation_status: "pending", status: "active"
    }),
    transitionMediaModeration: async (_connection, input) => { state.mediaUpdates.push(input); return true; },
    enqueueRejectedMediaCleanup: async (_connection, media) => { state.cleanup.push(media.id); return 99; }
  };
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

test("service exposes Tencent video flow but no Tencent image or text methods", () => {
  const { service } = harness();
  assert.equal(typeof service.createVideoJob, "function");
  assert.equal(typeof service.submitVideoJob, "function");
  assert.equal("createImageJob" in service, false);
  assert.equal("submitImageJob" in service, false);
  assert.equal("moderateTextMutation" in service, false);
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
      subjectVersion: "etag-1",
      objectKey: "uploads/session-album/videos/source/a.mp4",
      result: { decision, suggestion: decision, label: "label", score: 80 }
    });
    assert.equal(result.status, expectedStatus);
    assert.equal(state.mediaUpdates[0].toStatus, expectedStatus);
    assert.equal(state.cleanup.length, decision === "block" ? 1 : 0);
  });
}

test("stale immutable video result cannot change media", async () => {
  const { service, state } = harness();
  await assert.rejects(service.applyMediaResult({
    jobId: 7, subjectVersion: "other-etag",
    objectKey: "uploads/session-album/videos/source/a.mp4", result: { decision: "pass" }
  }), { code: "CONTENT_MODERATION_CALLBACK_STALE" });
  assert.equal(state.mediaUpdates.length, 0);
});
