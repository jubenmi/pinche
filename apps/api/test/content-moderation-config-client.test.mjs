import assert from "node:assert/strict";
import test from "node:test";

import {
  assertContentModerationConfig,
  buildContentModerationConfig
} from "../src/config/env.js";
import {
  createTencentModerationClient,
  createTencentModerationTransport
} from "../src/modules/content-moderation/tencent-client.js";

function validEnv(overrides = {}) {
  return {
    CONTENT_MODERATION_ENABLED: "true",
    CONTENT_MODERATION_TEXT_ENABLED: "true",
    CONTENT_MODERATION_IMAGE_ENABLED: "true",
    CONTENT_MODERATION_VIDEO_ENABLED: "true",
    TENCENT_MODERATION_REGION: "ap-nanjing",
    TENCENT_CI_IMAGE_BIZ_TYPE: "image-policy",
    TENCENT_CI_VIDEO_BIZ_TYPE: "video-policy",
    TENCENT_TMS_BIZ_TYPE: "text-policy",
    TENCENT_MODERATION_CALLBACK_URL: "https://api.example.com/api/internal/content-moderation/tencent/callback",
    TENCENT_MODERATION_CALLBACK_TOKEN: "x".repeat(32),
    CONTENT_MODERATION_RETRY_LIMIT: "8",
    COS_SECRET_ID: "secret-id",
    COS_SECRET_KEY: "secret-key",
    COS_BUCKET: "bucket-123",
    COS_REGION: "ap-nanjing",
    ...overrides
  };
}

test("moderation config parses independent gates and retry limit", () => {
  const config = buildContentModerationConfig(validEnv({
    CONTENT_MODERATION_VIDEO_ENABLED: "false",
    CONTENT_MODERATION_RETRY_LIMIT: "6"
  }));

  assert.equal(config.enabled, true);
  assert.equal(config.textEnabled, true);
  assert.equal(config.imageEnabled, true);
  assert.equal(config.videoEnabled, false);
  assert.equal(config.retryLimit, 6);
  assert.equal(config.region, "ap-nanjing");
});

test("enabled production moderation fails closed on missing policy, callback, or credentials", () => {
  for (const missing of [
    "TENCENT_CI_IMAGE_BIZ_TYPE",
    "TENCENT_CI_VIDEO_BIZ_TYPE",
    "TENCENT_TMS_BIZ_TYPE",
    "TENCENT_MODERATION_CALLBACK_URL",
    "TENCENT_MODERATION_CALLBACK_TOKEN",
    "COS_SECRET_ID",
    "COS_SECRET_KEY"
  ]) {
    const config = buildContentModerationConfig(validEnv({ [missing]: "" }));
    assert.throws(() => assertContentModerationConfig(config, { nodeEnv: "production" }), {
      code: "CONTENT_MODERATION_CONFIGURATION_ERROR"
    });
  }
});

test("disabled moderation does not require provider configuration", () => {
  const config = buildContentModerationConfig({});
  assert.doesNotThrow(() => assertContentModerationConfig(config, { nodeEnv: "production" }));
});

test("client delegates typed image, video, and text requests without exposing secrets", async () => {
  const calls = [];
  const transport = async (request) => {
    calls.push(request);
    return { Suggestion: "Pass", JobId: `${request.kind}-job` };
  };
  const client = createTencentModerationClient({
    config: buildContentModerationConfig(validEnv()),
    transport
  });

  await client.submitImage({ objectKey: "uploads/session-album/display/a.jpg", dataId: "d1" });
  await client.submitVideo({ objectKey: "uploads/session-album/videos/source/a.mp4", dataId: "d2" });
  await client.moderateText({ content: "[nickname]Alice", dataId: "d3" });

  assert.deepEqual(calls.map(({ kind, policyId }) => [kind, policyId]), [
    ["image", "image-policy"],
    ["video", "video-policy"],
    ["text", "text-policy"]
  ]);
  assert.equal(JSON.stringify(calls).includes("secret-key"), false);
  assert.equal(JSON.stringify(calls).includes("secret-id"), false);
});

test("client refuses a disabled content type before calling transport", async () => {
  let calls = 0;
  const client = createTencentModerationClient({
    config: buildContentModerationConfig(validEnv({ CONTENT_MODERATION_VIDEO_ENABLED: "false" })),
    transport: async () => { calls += 1; }
  });

  await assert.rejects(client.submitVideo({ objectKey: "x", dataId: "d" }), {
    code: "CONTENT_MODERATION_CONFIGURATION_ERROR"
  });
  assert.equal(calls, 0);
});

test("production transport signs CI image requests and parses the asynchronous job", async () => {
  const calls = [];
  const transport = createTencentModerationTransport({
    config: buildContentModerationConfig(validEnv()),
    now: () => new Date("2026-07-12T00:00:00.000Z"),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(
        "<Response><JobsDetail><JobId>ci-job-1</JobId><State>Submitted</State><DataId>d1</DataId></JobsDetail></Response>",
        { status: 200, headers: { "content-type": "application/xml" } }
      );
    }
  });

  const response = await transport({
    kind: "image",
    objectKey: "uploads/session-album/display/a.jpg",
    dataId: "d1",
    policyId: "image-policy",
    bucket: "bucket-123",
    callbackUrl: "https://api.example.com/callback",
    region: "ap-nanjing"
  });

  assert.equal(response.JobId, "ci-job-1");
  assert.equal(calls[0].url, "https://bucket-123.ci.ap-nanjing.myqcloud.com/image/auditing");
  assert.match(calls[0].options.headers.authorization, /^q-sign-algorithm=sha1/);
  assert.match(calls[0].options.body, /<Object>uploads\/session-album\/display\/a\.jpg<\/Object>/);
  assert.match(calls[0].options.body, /<BizType>image-policy<\/BizType>/);
  assert.equal(JSON.stringify(calls).includes("secret-key"), false);
});

test("production transport TC3-signs TMS text requests and base64 encodes content", async () => {
  const calls = [];
  const transport = createTencentModerationTransport({
    config: buildContentModerationConfig(validEnv()),
    now: () => new Date("2026-07-12T00:00:00.000Z"),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ Response: {
        Suggestion: "Pass", Label: "Normal", RequestId: "request-1"
      } }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const response = await transport({
    kind: "text",
    content: "[nickname]Alice",
    dataId: "d3",
    policyId: "text-policy",
    region: "ap-nanjing"
  });

  assert.equal(response.Suggestion, "Pass");
  assert.equal(calls[0].url, "https://tms.tencentcloudapi.com/");
  assert.match(calls[0].options.headers.authorization, /^TC3-HMAC-SHA256 Credential=secret-id\//);
  assert.equal(JSON.parse(calls[0].options.body).Content, Buffer.from("[nickname]Alice").toString("base64"));
  assert.equal(JSON.stringify(calls).includes("secret-key"), false);
});
