import assert from "node:assert/strict";
import test from "node:test";

import {
  assertContentModerationConfig,
  buildContentModerationConfig
} from "../src/config/env.js";
import {
  createTencentVideoModerationClient,
  createTencentVideoModerationTransport
} from "../src/modules/content-moderation/tencent-video-client.js";

function validEnv(overrides = {}) {
  return {
    CONTENT_MODERATION_ENABLED: "true",
    CONTENT_MODERATION_WECHAT_TEXT_ENABLED: "false",
    CONTENT_MODERATION_WECHAT_IMAGE_ENABLED: "false",
    CONTENT_MODERATION_TENCENT_VIDEO_ENABLED: "true",
    COS_ENABLED: "true",
    REDIS_ENABLED: "true",
    REDIS_URL: "redis://redis.example.test:6379",
    WECHAT_APP_ID: "wx-d45-test",
    WECHAT_APP_SECRET: "wechat-app-secret",
    WECHAT_CONTENT_SECURITY_EVENT_TOKEN: "wechat-content-security-event-token",
    WECHAT_CONTENT_SECURITY_EVENT_AES_KEY: "A".repeat(43),
    TENCENT_CI_VIDEO_REGION: "ap-nanjing",
    TENCENT_CI_VIDEO_BIZ_TYPE: "video-policy",
    TENCENT_CI_VIDEO_CALLBACK_URL: "https://api.example.com/api/internal/content-moderation/tencent-video/callback",
    TENCENT_CI_VIDEO_CALLBACK_TOKEN: "x".repeat(32),
    CONTENT_MODERATION_RETRY_LIMIT: "8",
    COS_SECRET_ID: "secret-id",
    COS_SECRET_KEY: "secret-key",
    COS_BUCKET: "bucket-123",
    ...overrides
  };
}

test("hybrid moderation config parses independent provider gates", () => {
  const config = buildContentModerationConfig(validEnv({
    CONTENT_MODERATION_WECHAT_TEXT_ENABLED: "true",
    CONTENT_MODERATION_WECHAT_IMAGE_ENABLED: "true",
    CONTENT_MODERATION_RETRY_LIMIT: "6"
  }));
  assert.equal(config.wechatTextEnabled, true);
  assert.equal(config.wechatImageEnabled, true);
  assert.equal(config.tencentVideoEnabled, true);
  assert.equal(config.tencentVideoRegion, "ap-nanjing");
  assert.equal(config.retryLimit, 6);
});

test("enabled Tencent video moderation fails closed on missing production configuration", () => {
  for (const missing of [
    "TENCENT_CI_VIDEO_REGION",
    "TENCENT_CI_VIDEO_BIZ_TYPE",
    "TENCENT_CI_VIDEO_CALLBACK_URL",
    "TENCENT_CI_VIDEO_CALLBACK_TOKEN",
    "COS_SECRET_ID",
    "COS_SECRET_KEY",
    "COS_BUCKET"
  ]) {
    const config = buildContentModerationConfig(validEnv({ [missing]: "" }));
    assert.throws(() => assertContentModerationConfig(config, { nodeEnv: "production" }), {
      code: "CONTENT_MODERATION_CONFIGURATION_ERROR"
    });
  }
});

test("enabled WeChat moderation fails closed in production without Redis, credentials or event secrets", () => {
  for (const missing of [
    "REDIS_ENABLED",
    "WECHAT_APP_ID",
    "WECHAT_APP_SECRET",
    "WECHAT_CONTENT_SECURITY_EVENT_TOKEN",
    "WECHAT_CONTENT_SECURITY_EVENT_AES_KEY"
  ]) {
    const config = buildContentModerationConfig(validEnv({
      CONTENT_MODERATION_TENCENT_VIDEO_ENABLED: "false",
      CONTENT_MODERATION_WECHAT_TEXT_ENABLED: "true",
      [missing]: ""
    }));
    assert.throws(() => assertContentModerationConfig(config, { nodeEnv: "production" }), {
      code: "CONTENT_MODERATION_CONFIGURATION_ERROR"
    });
  }
});

test("enabled WeChat moderation requires a canonical 43-character event AES key", () => {
  for (const aesKey of ["short", `${"A".repeat(42)}=`, "!".repeat(43)]) {
    const config = buildContentModerationConfig(validEnv({
      CONTENT_MODERATION_TENCENT_VIDEO_ENABLED: "false",
      CONTENT_MODERATION_WECHAT_IMAGE_ENABLED: "true",
      WECHAT_CONTENT_SECURITY_EVENT_AES_KEY: aesKey,
      COS_REGION: "ap-nanjing"
    }));
    assert.throws(() => assertContentModerationConfig(config, { nodeEnv: "production" }), {
      code: "CONTENT_MODERATION_CONFIGURATION_ERROR"
    });
  }
});

test("enabled WeChat moderation requires an explicit Redis URL or host in production", () => {
  const config = buildContentModerationConfig(validEnv({
    CONTENT_MODERATION_TENCENT_VIDEO_ENABLED: "false",
    CONTENT_MODERATION_WECHAT_IMAGE_ENABLED: "true",
    REDIS_URL: "",
    REDIS_HOST: ""
  }));

  assert.throws(
    () => assertContentModerationConfig(config, { nodeEnv: "production" }),
    /REDIS_URL or REDIS_HOST/
  );
});

test("enabled WeChat image moderation requires private COS storage in production", () => {
  for (const [name, value] of [
    ["COS_ENABLED", "false"],
    ["COS_SECRET_ID", ""],
    ["COS_SECRET_KEY", ""],
    ["COS_BUCKET", ""],
    ["COS_REGION", ""]
  ]) {
    const config = buildContentModerationConfig(validEnv({
      CONTENT_MODERATION_TENCENT_VIDEO_ENABLED: "false",
      CONTENT_MODERATION_WECHAT_IMAGE_ENABLED: "true",
      [name]: value
    }));
    assert.throws(() => assertContentModerationConfig(config, { nodeEnv: "production" }), {
      code: "CONTENT_MODERATION_CONFIGURATION_ERROR"
    });
  }
});

test("enabled WeChat moderation rejects malformed Redis URLs and invalid host ports", () => {
  const invalidEndpoints = [
    { REDIS_URL: "http://cache.example.test:6379" },
    { REDIS_URL: "redis://" },
    { REDIS_URL: "redis://cache.example.test:99999" },
    { REDIS_URL: "redis://foo_bar:6379" },
    { REDIS_URL: "rediss://cache..example.test:6380" },
    { REDIS_URL: "", REDIS_HOST: "not a valid host", REDIS_PORT: "6379" },
    { REDIS_URL: "", REDIS_HOST: "cache.example.test", REDIS_PORT: "0" },
    { REDIS_URL: "", REDIS_HOST: "cache.example.test", REDIS_PORT: "not-a-port" }
  ];
  for (const endpoint of invalidEndpoints) {
    const config = buildContentModerationConfig(validEnv({
      CONTENT_MODERATION_TENCENT_VIDEO_ENABLED: "false",
      CONTENT_MODERATION_WECHAT_TEXT_ENABLED: "true",
      ...endpoint
    }));
    assert.throws(() => assertContentModerationConfig(config, { nodeEnv: "production" }), {
      code: "CONTENT_MODERATION_CONFIGURATION_ERROR"
    });
  }
});

test("enabled WeChat moderation accepts redis and rediss URLs or a valid host port", () => {
  for (const endpoint of [
    { REDIS_URL: "redis://cache.example.test:6379/3" },
    { REDIS_URL: "rediss://cache.example.test:6380/3" },
    { REDIS_URL: "", REDIS_HOST: "10.206.16.15", REDIS_PORT: "6379" }
  ]) {
    const config = buildContentModerationConfig(validEnv({
      CONTENT_MODERATION_TENCENT_VIDEO_ENABLED: "false",
      CONTENT_MODERATION_WECHAT_TEXT_ENABLED: "true",
      ...endpoint
    }));
    assert.doesNotThrow(() => assertContentModerationConfig(config, { nodeEnv: "production" }));
  }
});

test("a WeChat provider gate cannot bypass production validation through the global flag", () => {
  const config = buildContentModerationConfig(validEnv({
    CONTENT_MODERATION_ENABLED: "false",
    CONTENT_MODERATION_TENCENT_VIDEO_ENABLED: "false",
    CONTENT_MODERATION_WECHAT_IMAGE_ENABLED: "true",
    WECHAT_APP_SECRET: ""
  }));

  assert.throws(() => assertContentModerationConfig(config, { nodeEnv: "production" }), {
    code: "CONTENT_MODERATION_CONFIGURATION_ERROR"
  });
});

test("disabled moderation does not require provider configuration", () => {
  assert.doesNotThrow(() => assertContentModerationConfig(
    buildContentModerationConfig({}),
    { nodeEnv: "production" }
  ));
});

test("Tencent client exposes only video submission", async () => {
  const calls = [];
  const client = createTencentVideoModerationClient({
    config: buildContentModerationConfig(validEnv()),
    transport: async (request) => { calls.push(request); return { JobId: "video-job" }; }
  });
  assert.deepEqual(Object.keys(client), ["submitVideo"]);
  await client.submitVideo({ objectKey: "uploads/session-album/videos/source/a.mp4", dataId: "d2" });
  assert.deepEqual(calls.map(({ kind, policyId }) => [kind, policyId]), [["video", "video-policy"]]);
  assert.equal(JSON.stringify(calls).includes("secret-key"), false);
});

test("Tencent video transport signs CI video request and parses async job", async () => {
  const calls = [];
  const config = buildContentModerationConfig(validEnv());
  const transport = createTencentVideoModerationTransport({
    config,
    now: () => new Date("2026-07-12T00:00:00.000Z"),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(
        "<Response><JobsDetail><JobId>ci-video-1</JobId><State>Submitted</State><DataId>d2</DataId></JobsDetail></Response>",
        { status: 200 }
      );
    }
  });
  const response = await transport({
    kind: "video",
    objectKey: "uploads/session-album/videos/source/a.mp4",
    dataId: "d2",
    policyId: "video-policy",
    bucket: "bucket-123",
    callbackUrl: config.tencentVideoCallbackUrl,
    region: "ap-nanjing"
  });
  assert.equal(response.JobId, "ci-video-1");
  assert.equal(calls[0].url, "https://bucket-123.ci.ap-nanjing.myqcloud.com/video/auditing");
  assert.match(calls[0].options.headers.authorization, /^q-sign-algorithm=sha1/);
  assert.match(calls[0].options.body, /<BizType>video-policy<\/BizType>/);
  assert.equal(JSON.stringify(calls).includes("secret-key"), false);
});

test("Tencent transport rejects non-video request kinds", async () => {
  const transport = createTencentVideoModerationTransport({
    config: buildContentModerationConfig(validEnv()),
    fetchImpl: async () => new Response("", { status: 200 })
  });
  await assert.rejects(transport({ kind: "image" }), /only Tencent video moderation/);
});
