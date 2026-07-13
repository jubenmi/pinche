import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTextFields } from "../src/modules/content-moderation/normalize.js";
import {
  buildTextRetryDescriptor,
  createContentModerationRetryProcessor
} from "../src/modules/content-moderation/retry-dispatch.js";
import { textProposalPayloadDigest } from "../src/modules/content-moderation/text-proposal-digest.js";
import { textMutationSubjectVersion } from "../src/modules/content-moderation/text-request-identity.js";

function textRetryFacts() {
  const job = {
    id: 41,
    provider: "wechat_sec_check",
    subject_type: "session_update",
    subject_id: "text-op-41",
    status: "error",
    subject_version: "",
    lease_token: "lease-text"
  };
  const normalizedPayload = {
    body: { note: "周末拼车" },
    context: { sessionId: 12, targetSubjectId: "12" },
    actor_user_id: 7
  };
  const proposal = {
    id: 51,
    moderation_job_id: 41,
    subject_type: "session_update",
    subject_id: "text-op-41",
    status: "pending",
    action: "update_session",
    base_version: "session-v1",
    idempotency_key: "request-41",
    payload_digest: "",
    created_by_user_id: 7,
    normalized_payload_json: JSON.stringify(normalizedPayload)
  };
  const normalizedText = normalizeTextFields({ note: "周末拼车" });
  job.subject_version = textMutationSubjectVersion({ normalizedText });
  proposal.payload_digest = textProposalPayloadDigest({
    action: proposal.action,
    baseVersion: proposal.base_version,
    normalizedText,
    normalizedPayload
  });
  return { job, proposal, actorOpenid: "openid-7", normalizedText };
}

test("text retry reconstructs a descriptor only from the persisted proposal and current actor openid", () => {
  const facts = textRetryFacts();
  const retry = buildTextRetryDescriptor(facts);

  assert.equal(retry.normalizedText, facts.normalizedText);
  assert.equal(retry.openid, "openid-7");
  assert.equal(retry.scene, 4);
  assert.equal(retry.expectedText.jobId, 41);
  assert.equal(retry.expectedText.proposalId, 51);
  assert.equal(retry.expectedText.subjectVersion, facts.job.subject_version);
  assert.equal(JSON.stringify(retry).includes("[note]"), true);
});

test("text retry refuses a changed immutable version before any provider call", () => {
  const facts = textRetryFacts();
  facts.job.subject_version = "different-version";
  assert.equal(buildTextRetryDescriptor(facts), null);
});

test("text retry rejects a changed non-text payload field or digest even when the moderated text hash is unchanged", () => {
  const changedPayload = textRetryFacts();
  changedPayload.proposal.normalized_payload_json = JSON.stringify({
    body: { note: "周末拼车", startAt: "2026-08-01T12:00:00.000Z" },
    context: { sessionId: 12, targetSubjectId: "12" }
  });
  assert.equal(buildTextRetryDescriptor(changedPayload), null);

  const changedDigest = textRetryFacts();
  changedDigest.proposal.payload_digest = "tampered-digest";
  assert.equal(buildTextRetryDescriptor(changedDigest), null);

  const changedActorPayload = textRetryFacts();
  changedActorPayload.proposal.normalized_payload_json = JSON.stringify({
    body: { note: "周末拼车" },
    context: { sessionId: 12, targetSubjectId: "12" },
    actor_user_id: 99
  });
  assert.equal(buildTextRetryDescriptor(changedActorPayload), null);
});

test("retry processor turns invalid rehydrated text facts into a safe terminal error", async () => {
  const invalid = textRetryFacts();
  invalid.proposal.payload_digest = "tampered-digest";
  let providerCalled = false;
  const processor = createContentModerationRetryProcessor({
    repository: {
      rehydrateModerationRetryJob: async () => ({ kind: "text", ...invalid })
    },
    withTransaction: async (run) => run({}),
    contentModerationRuntime: {
      retryTextModeration: async () => {
        providerCalled = true;
      }
    }
  });

  await assert.rejects(
    processor.processJob({ id: 41, lease_token: "lease-text" }),
    { code: "CONTENT_MODERATION_RETRY_FACTS_INVALID" }
  );
  assert.equal(providerCalled, false);
});

test("retry processor dispatches only rehydrated text, image, and video facts through the shared runtime", async () => {
  const text = textRetryFacts();
  const image = {
    kind: "wechat_image",
    job: {
      id: 42,
      provider: "wechat_sec_check",
      subject_type: "album_image",
      status: "error",
      lease_token: "lease-image",
      data_id: "image-data"
    },
    objectKey: "uploads/session-album/display/a.jpg",
    uploaderUserId: 8,
    retryFacts: {
      kind: "album_image",
      mediaId: 12,
      subjectVersion: "etag-image",
      objectKey: "uploads/session-album/display/a.jpg",
      uploaderUserId: 8
    }
  };
  const video = {
    kind: "tencent_video",
    job: {
      id: 43,
      provider: "tencent_ci_video",
      subject_type: "album_video",
      status: "error",
      lease_token: "lease-video",
      data_id: "video-data"
    },
    objectKey: "uploads/session-album/videos/source/a.mp4",
    uploaderUserId: 9,
    retryFacts: {
      kind: "album_video",
      mediaId: 13,
      subjectVersion: "etag-video",
      objectKey: "uploads/session-album/videos/source/a.mp4",
      uploaderUserId: 9
    }
  };
  const calls = [];
  const factsById = new Map([[41, { kind: "text", ...text }], [42, image], [43, video]]);
  const processor = createContentModerationRetryProcessor({
    repository: {
      rehydrateModerationRetryJob: async (_connection, input) => factsById.get(input.jobId) || null
    },
    withTransaction: async (run) => run({}),
    contentModerationRuntime: {
      retryTextModeration: async (input) => calls.push({ kind: "text", input }),
      submitWechatImageModeration: async (input) => calls.push({ kind: "image", input }),
      submitVideoJob: async (input) => calls.push({ kind: "video", input })
    }
  });

  await processor.processJob({ id: 41, lease_token: "lease-text" });
  await processor.processJob({ id: 42, lease_token: "lease-image" });
  await processor.processJob({ id: 43, lease_token: "lease-video" });
  await processor.processJob({ id: 44, lease_token: "lease-stale" });

  assert.deepEqual(calls.map(({ kind }) => kind), ["text", "image", "video"]);
  assert.equal(calls[0].input.leaseToken, "lease-text");
  assert.equal(calls[0].input.expectedText.proposalId, 51);
  assert.deepEqual(calls[1].input.retryFacts, image.retryFacts);
  assert.equal(calls[1].input.objectKey, image.objectKey);
  assert.deepEqual(calls[2].input.retryFacts, video.retryFacts);
  assert.equal(calls[2].input.objectKey, video.objectKey);
});
