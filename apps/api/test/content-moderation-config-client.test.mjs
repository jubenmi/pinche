import assert from "node:assert/strict";
import test from "node:test";

import {
  assertContentModerationConfig,
  buildContentModerationConfig
} from "../src/config/env.js";
import {
  createTencentProductionPreflightVideoModerationTransport,
  createTencentVideoModerationClient,
  createTencentVideoModerationTransport
} from "../src/modules/content-moderation/tencent-video-client.js";

function validEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
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
    TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN: "",
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

test("moderation retry worker configuration is bounded and keeps network timeouts below its lease", () => {
  const config = buildContentModerationConfig(validEnv({
    CONTENT_MODERATION_RETRY_POLL_MS: "12000",
    CONTENT_MODERATION_RETRY_BATCH_SIZE: "12",
    CONTENT_MODERATION_RETRY_LEASE_MS: "90000"
  }));
  assert.equal(config.retryPollMs, 12_000);
  assert.equal(config.retryBatchSize, 12);
  assert.equal(config.retryLeaseMs, 90_000);

  for (const [name, value] of [
    ["CONTENT_MODERATION_RETRY_POLL_MS", "999"],
    ["CONTENT_MODERATION_RETRY_BATCH_SIZE", "0"],
    ["CONTENT_MODERATION_RETRY_LEASE_MS", "89999"],
    ["CONTENT_MODERATION_RETRY_LEASE_MS", "not-a-number"]
  ]) {
    assert.throws(() => buildContentModerationConfig(validEnv({ [name]: value })), {
      code: "CONTENT_MODERATION_CONFIGURATION_ERROR"
    });
  }
});

test("orphan scanner configuration stays report-only by default and bounds its safety window", () => {
  const config = buildContentModerationConfig(validEnv({
    CONTENT_MODERATION_ORPHAN_SCAN_ENABLED: "true",
    CONTENT_MODERATION_ORPHAN_CLEANUP_ENABLED: "false",
    CONTENT_MODERATION_ORPHAN_SCAN_POLL_MS: "300000",
    CONTENT_MODERATION_ORPHAN_SCAN_BATCH_SIZE: "50",
    CONTENT_MODERATION_ORPHAN_RETENTION_HOURS: "48",
    CONTENT_MODERATION_QUEUE_ALERT_AGE_SECONDS: "900"
  }));
  assert.equal(config.orphanScanEnabled, true);
  assert.equal(config.orphanCleanupEnabled, false);
  assert.equal(config.orphanScanPollMs, 300_000);
  assert.equal(config.orphanScanBatchSize, 50);
  assert.equal(config.orphanRetentionHours, 48);
  assert.equal(config.queueAlertAgeSeconds, 900);

  for (const [name, value] of [
    ["CONTENT_MODERATION_ORPHAN_SCAN_POLL_MS", "59999"],
    ["CONTENT_MODERATION_ORPHAN_SCAN_BATCH_SIZE", "1001"],
    ["CONTENT_MODERATION_ORPHAN_RETENTION_HOURS", "23"],
    ["CONTENT_MODERATION_QUEUE_ALERT_AGE_SECONDS", "59"]
  ]) {
    assert.throws(() => buildContentModerationConfig(validEnv({ [name]: value })), {
      code: "CONTENT_MODERATION_CONFIGURATION_ERROR"
    });
  }
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

test("Tencent video callback token rotation keeps a valid previous token optional", () => {
  const current = "c".repeat(32);
  const previous = "p".repeat(32);
  const config = buildContentModerationConfig(validEnv({
    TENCENT_CI_VIDEO_CALLBACK_TOKEN: current,
    TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN: previous
  }));
  assert.equal(config.tencentVideoCallbackToken, current);
  assert.equal(config.tencentVideoCallbackPreviousToken, previous);
  assert.doesNotThrow(() => assertContentModerationConfig(config, { nodeEnv: "production" }));

  const invalid = buildContentModerationConfig(validEnv({
    TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN: "too-short"
  }));
  assert.throws(() => assertContentModerationConfig(invalid, { nodeEnv: "production" }), {
    code: "CONTENT_MODERATION_CONFIGURATION_ERROR"
  });
});

test("a Tencent provider gate cannot bypass production callback-token validation through the global flag", () => {
  for (const overrides of [
    { TENCENT_CI_VIDEO_CALLBACK_TOKEN: "" },
    { TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN: "too-short" },
    { TENCENT_CI_VIDEO_REGION: "", COS_REGION: "" },
    { COS_SECRET_ID: "" },
    { COS_SECRET_KEY: "" },
    { COS_BUCKET: "" },
    { TENCENT_CI_VIDEO_BIZ_TYPE: "" },
    { TENCENT_CI_VIDEO_CALLBACK_URL: "" }
  ]) {
    const config = buildContentModerationConfig(validEnv({
      CONTENT_MODERATION_ENABLED: "false",
      CONTENT_MODERATION_TENCENT_VIDEO_ENABLED: "true",
      ...overrides
    }));
    assert.throws(() => assertContentModerationConfig(config, { nodeEnv: "production" }), {
      code: "CONTENT_MODERATION_CONFIGURATION_ERROR"
    });
  }
});

test("Tencent configuration errors never expose callback-token values", () => {
  const previousToken = "secret-prev-token";
  const config = buildContentModerationConfig(validEnv({
    TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN: previousToken
  }));
  assert.throws(
    () => assertContentModerationConfig(config, { nodeEnv: "production" }),
    (error) => {
      assert.equal(error.code, "CONTENT_MODERATION_CONFIGURATION_ERROR");
      assert.equal(error.message.includes(previousToken), false);
      return true;
    }
  );
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
    buildContentModerationConfig({ NODE_ENV: "production" }),
    { nodeEnv: "production" }
  ));
});

test("Tencent client exposes only video submission", async () => {
  const calls = [];
  const client = createTencentVideoModerationClient({
    config: buildContentModerationConfig(validEnv()),
    transport: async (request) => {
      calls.push(request);
      return { JobId: "video-job", DataId: request.dataId, State: "Submitted" };
    }
  });
  assert.deepEqual(Object.keys(client), ["submitVideo"]);
  await client.submitVideo({ objectKey: "uploads/session-album/videos/source/a.mp4", dataId: "d2" });
  assert.deepEqual(calls.map(({ kind, policyId }) => [kind, policyId]), [["video", "video-policy"]]);
  assert.equal(JSON.stringify(calls).includes("secret-key"), false);
});

test("Tencent video submission rejects non-source or non-MP4 objects before an upstream request", async () => {
  let calls = 0;
  const client = createTencentVideoModerationClient({
    config: buildContentModerationConfig(validEnv()),
    transport: async () => {
      calls += 1;
      return { JobId: "ci-video-1", DataId: "d2", State: "Submitted" };
    }
  });
  for (const objectKey of [
    "uploads/session-album/videos/display/a.mp4",
    "uploads/session-album/videos/source/a.mov",
    "uploads/session-album/display/a.jpg"
  ]) {
    await assert.rejects(client.submitVideo({ objectKey, dataId: "d2" }), /video source object/);
  }
  assert.equal(calls, 0);
});

test("Tencent video transport signs CI video request and parses async job", async () => {
  const calls = [];
  const config = buildContentModerationConfig(validEnv({
    TENCENT_CI_VIDEO_CALLBACK_TOKEN: "c".repeat(32),
    TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN: "p".repeat(32)
  }));
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
  assert.match(calls[0].options.body, /<Snapshot><Mode>Average<\/Mode><Count>100<\/Count><\/Snapshot>/);
  assert.match(calls[0].options.body, /<DetectContent>1<\/DetectContent>/);
  assert.match(calls[0].options.body, /<CallbackVersion>Detail<\/CallbackVersion>/);
  assert.match(calls[0].options.body, /<CallbackType>1<\/CallbackType>/);
  assert.match(calls[0].options.body, new RegExp(`token=${"c".repeat(32)}`));
  assert.doesNotMatch(calls[0].options.body, new RegExp(`token=${"p".repeat(32)}`));
  assert.doesNotMatch(calls[0].options.body, /<Async>/);
  assert.equal(JSON.stringify(calls).includes("secret-key"), false);
});

test("Tencent production preflight transport accepts only its derived private video key", async () => {
  const calls = [];
  const runId = "11111111-1111-4111-8111-111111111111";
  const objectKey = `system/content-moderation-preflight/${runId}/video-v1.mp4`;
  const config = buildContentModerationConfig(validEnv());
  const transport = createTencentProductionPreflightVideoModerationTransport({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(
        `<Response><JobsDetail><JobId>ci-video-1</JobId><State>Submitted</State><DataId>${runId}</DataId></JobsDetail></Response>`,
        { status: 200 }
      );
    }
  });

  const response = await transport({
    kind: "video",
    runId,
    objectKey,
    dataId: runId,
    policyId: config.tencentVideoPolicyId,
    bucket: config.bucket,
    callbackUrl: config.tencentVideoCallbackUrl,
    region: config.tencentVideoRegion
  });

  assert.equal(response.JobId, "ci-video-1");
  assert.match(calls[0].options.body, new RegExp(`<Object>${objectKey}</Object>`));
  await assert.rejects(
    transport({
      kind: "video",
      runId,
      objectKey: "uploads/session-album/videos/source/user.mp4",
      dataId: runId,
      policyId: config.tencentVideoPolicyId,
      bucket: config.bucket,
      callbackUrl: config.tencentVideoCallbackUrl,
      region: config.tencentVideoRegion
    }),
    /invalid production preflight video object key/
  );
  assert.equal(calls.length, 1);
});

test("Tencent video response body reading shares the request deadline", async () => {
  const config = buildContentModerationConfig(validEnv());
  const transport = createTencentVideoModerationTransport({
    config,
    timeoutMs: 5,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: () => new Promise(() => {})
    })
  });
  const request = {
    kind: "video",
    objectKey: "uploads/session-album/videos/source/a.mp4",
    dataId: "d2",
    policyId: "video-policy",
    bucket: "bucket-123",
    callbackUrl: config.tencentVideoCallbackUrl,
    region: "ap-nanjing"
  };

  await assert.rejects(
    Promise.race([
      transport(request),
      new Promise((_, reject) => setTimeout(
        () => reject(Object.assign(new Error("Tencent video response body did not respect its deadline"), {
          code: "TEST_TENCENT_VIDEO_BODY_DEADLINE"
        })),
        30
      ))
    ]),
    { code: "TENCENT_CI_VIDEO_TIMEOUT" }
  );
});

test("Tencent video transport fails closed on empty, mismatched, failed, or unknown submissions", async () => {
  const config = buildContentModerationConfig(validEnv());
  const request = {
    kind: "video",
    objectKey: "uploads/session-album/videos/source/a.mp4",
    dataId: "d2",
    policyId: "video-policy",
    bucket: "bucket-123",
    callbackUrl: config.tencentVideoCallbackUrl,
    region: "ap-nanjing"
  };
  for (const xml of [
    "<Response><JobsDetail><DataId>d2</DataId><State>Submitted</State></JobsDetail></Response>",
    "<Response><JobsDetail><JobId>ci-video-1</JobId><DataId>other</DataId><State>Submitted</State></JobsDetail></Response>",
    "<Response><JobsDetail><JobId>ci-video-1</JobId><DataId>d2</DataId><State>Failed</State></JobsDetail></Response>",
    "<Response><JobsDetail><JobId>ci-video-1</JobId><DataId>d2</DataId><State>Unexpected</State></JobsDetail></Response>"
  ]) {
    const transport = createTencentVideoModerationTransport({
      config,
      fetchImpl: async () => new Response(xml, { status: 200 })
    });
    await assert.rejects(transport(request), {
      code: "CONTENT_MODERATION_UPSTREAM_RESPONSE_INVALID"
    });
  }
});

test("Tencent video client does not trust a custom transport with mismatched submission facts", async () => {
  const client = createTencentVideoModerationClient({
    config: buildContentModerationConfig(validEnv()),
    transport: async () => ({ JobId: "ci-video-1", DataId: "other", State: "Submitted" })
  });
  await assert.rejects(client.submitVideo({
    objectKey: "uploads/session-album/videos/source/a.mp4",
    dataId: "d2"
  }), { code: "CONTENT_MODERATION_UPSTREAM_RESPONSE_INVALID" });
});

test("Tencent video client rejects legacy TaskId or lower-case jobId aliases", async () => {
  for (const response of [
    { TaskId: "ci-video-1", DataId: "d2", State: "Submitted" },
    { jobId: "ci-video-1", DataId: "d2", State: "Submitted" }
  ]) {
    const client = createTencentVideoModerationClient({
      config: buildContentModerationConfig(validEnv()),
      transport: async () => response
    });
    await assert.rejects(client.submitVideo({
      objectKey: "uploads/session-album/videos/source/a.mp4",
      dataId: "d2"
    }), { code: "CONTENT_MODERATION_UPSTREAM_RESPONSE_INVALID" });
  }
});

test("Tencent video transport exposes safe retry taxonomy without response-body leakage", async () => {
  const config = buildContentModerationConfig(validEnv());
  const request = {
    kind: "video",
    objectKey: "uploads/session-album/videos/source/a.mp4",
    dataId: "d2",
    policyId: "video-policy",
    bucket: "bucket-123",
    callbackUrl: config.tencentVideoCallbackUrl,
    region: "ap-nanjing"
  };
  const cases = [
    {
      name: "network",
      fetchImpl: async () => { throw new Error("socket reset on signed request"); },
      code: "TENCENT_CI_VIDEO_NETWORK_ERROR"
    },
    {
      name: "raw network errno is redacted into the retry taxonomy",
      fetchImpl: async () => { throw Object.assign(new Error("private endpoint reset"), { code: "ECONNRESET" }); },
      code: "TENCENT_CI_VIDEO_NETWORK_ERROR"
    },
    {
      name: "timeout",
      fetchImpl: async () => { throw Object.assign(new Error("timed out"), { name: "AbortError" }); },
      code: "TENCENT_CI_VIDEO_TIMEOUT"
    },
    {
      name: "raw timeout errno is redacted into the retry taxonomy",
      fetchImpl: async () => { throw Object.assign(new Error("private timeout"), { code: "ETIMEDOUT" }); },
      code: "TENCENT_CI_VIDEO_TIMEOUT"
    },
    {
      name: "rate limit",
      fetchImpl: async () => new Response("<Error><Code>RequestLimitExceeded</Code></Error>", { status: 429 }),
      code: "TENCENT_CI_VIDEO_RATE_LIMITED"
    },
    {
      name: "upstream 5xx",
      fetchImpl: async () => new Response("<Error><Code>InternalError</Code></Error>", { status: 503 }),
      code: "TENCENT_CI_VIDEO_UPSTREAM_5XX"
    },
    {
      name: "CAM auth",
      fetchImpl: async () => new Response("<Error><Code>AuthFailure.SecretIdNotFound</Code></Error>", { status: 403 }),
      code: "AuthFailure"
    },
    {
      name: "permission",
      fetchImpl: async () => new Response("<Error><Code>UnauthorizedOperation.CamVerify</Code></Error>", { status: 403 }),
      code: "UnauthorizedOperation"
    },
    {
      name: "policy",
      fetchImpl: async () => new Response("<Error><Code>InvalidParameter.BizType</Code></Error>", { status: 400 }),
      code: "InvalidParameter.BizType"
    },
    {
      name: "quota",
      fetchImpl: async () => new Response("<Error><Code>LimitExceeded</Code></Error>", { status: 400 }),
      code: "LimitExceeded"
    },
    {
      name: "resource exhausted",
      fetchImpl: async () => new Response("<Error><Code>ResourceUnavailable.FrequencyLimit</Code></Error>", { status: 400 }),
      code: "ResourceUnavailable"
    }
  ];

  for (const entry of cases) {
    const transport = createTencentVideoModerationTransport({
      config,
      fetchImpl: entry.fetchImpl
    });
    await assert.rejects(transport(request), (error) => {
      assert.equal(error.code, entry.code, entry.name);
      assert.equal(`${error.message}\n${JSON.stringify(error)}`.includes("signed request"), false);
      return true;
    });
  }
});

test("Tencent video concurrency quota errors normalize into the retryable high-priority quota taxonomy", async () => {
  const config = buildContentModerationConfig(validEnv());
  const transport = createTencentVideoModerationTransport({
    config,
    fetchImpl: async () => new Response("<Error><Code>RequestLimitExceeded</Code></Error>", { status: 400 })
  });
  await assert.rejects(transport({
    kind: "video",
    objectKey: "uploads/session-album/videos/source/a.mp4",
    dataId: "d2",
    policyId: "video-policy",
    bucket: "bucket-123",
    callbackUrl: config.tencentVideoCallbackUrl,
    region: "ap-nanjing"
  }), { code: "TENCENT_CI_VIDEO_RATE_LIMITED" });
});

test("Tencent transport rejects non-video request kinds", async () => {
  const transport = createTencentVideoModerationTransport({
    config: buildContentModerationConfig(validEnv()),
    fetchImpl: async () => new Response("", { status: 200 })
  });
  await assert.rejects(transport({ kind: "image" }), /only Tencent video moderation/);
});

test("Tencent transport rejects a non-source video object without calling CI", async () => {
  const transport = createTencentVideoModerationTransport({
    config: buildContentModerationConfig(validEnv()),
    fetchImpl: async () => assert.fail("invalid source object must not reach CI")
  });
  await assert.rejects(transport({
    kind: "video",
    objectKey: "uploads/session-album/videos/display/a.mp4"
  }), /video source object/);
});
