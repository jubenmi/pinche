import assert from "node:assert/strict";
import test from "node:test";

import { createContentModerationService } from "../src/modules/content-moderation/service.js";

const objectKey = "uploads/session-album/display/album-8-3-1.jpg";
const signedUrl = "https://bucket.cos.ap-nanjing.myqcloud.com/private.jpg?q-signature=must-not-persist";

function harness({ openid = "verified-uploader-openid", clientError = null } = {}) {
  const state = {
    created: [],
    providerCalls: [],
    openidLookups: [],
    signedFor: [],
    submissions: [],
    transitions: [],
    events: []
  };
  const repository = {
    createModerationJob: async (_connection, input) => {
      state.created.push(input);
      return { id: 71, status: "pending", ...input };
    },
    recordModerationSubmission: async (_connection, input) => {
      state.submissions.push(input);
      return true;
    },
    transitionModerationJob: async (_connection, input) => {
      state.transitions.push(input);
      return true;
    }
  };
  const service = createContentModerationService({
    config: { enabled: true, wechatImageEnabled: true },
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
    subjectType: "album_image",
    subjectId: "91",
    subjectVersion: "etag-image-91",
    provider: "wechat_sec_check",
    dataId: "00000000-0000-4000-8000-000000000071",
    policyId: null,
    kind: "wechat_image",
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
    scene: 4
  }]);
  assert.deepEqual(state.submissions, [{
    jobId: 71,
    provider: "wechat_sec_check",
    providerJobId: "wechat-image-trace-71",
    fromStatus: "pending",
    responseSummary: { traceId: "wechat-image-trace-71" }
  }]);
  assert.equal(JSON.stringify({ submissions: state.submissions, events: state.events }).includes("q-signature"), false);
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
  assert.equal(state.transitions.length, 1);
  assert.deepEqual(state.transitions[0], {
    jobId: 71,
    fromStatus: "pending",
    toStatus: "error",
    source: "provider",
    errorCode: "CONTENT_MODERATION_OPENID_REQUIRED"
  });
});

test("provider failures keep the image hidden in error and never put its signed URL in state or telemetry", async () => {
  const upstream = Object.assign(new Error("upstream timeout"), {
    code: "WECHAT_CONTENT_SECURITY_REQUEST_FAILED"
  });
  const { service, state } = harness({ clientError: upstream });
  const job = await createImageJob(service);

  await assert.rejects(service.submitWechatImageModeration(job), {
    code: "WECHAT_CONTENT_SECURITY_REQUEST_FAILED"
  });
  assert.equal(state.transitions.length, 1);
  assert.equal(state.transitions[0].toStatus, "error");
  assert.equal(state.submissions.length, 0);
  assert.equal(JSON.stringify({ transitions: state.transitions, events: state.events }).includes("q-signature"), false);
});
