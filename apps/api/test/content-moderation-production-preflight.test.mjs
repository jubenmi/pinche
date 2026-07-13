import assert from "node:assert/strict";
import test from "node:test";

import {
  assertContentModerationConfig,
  buildContentModerationConfig
} from "../src/config/env.js";
import {
  PRODUCTION_PREFLIGHT_CASES,
  getProductionPreflightCase,
  validateProductionPreflightCosKey
} from "../src/modules/content-moderation/production-preflight-samples.js";
import {
  assertProductionPreflightGuards,
  createProductionPreflightConfigFingerprint,
  createProductionPreflightRunner,
  parseProductionPreflightCliArgs,
  runProductionPreflightCase
} from "../src/modules/content-moderation/production-preflight.js";

function validRuntime(overrides = {}) {
  return {
    nodeEnv: "production",
    preflightEnabled: true,
    confirmation: "confirm-012345678901234567890123",
    expectedConfirmation: "confirm-012345678901234567890123",
    operatorUserId: 42,
    operatorRole: "system_admin",
    operatorStatus: "active",
    intakeModes: {
      text: "closed",
      image: "closed",
      video: "closed"
    },
    providerConfig: {
      wechatText: true,
      wechatImage: true,
      tencentVideo: true,
      cos: true,
      redis: true,
      callback: true
    },
    ...overrides
  };
}

test("production preflight config defaults disabled and validates only when enabled", () => {
  const disabled = buildContentModerationConfig({ NODE_ENV: "production" });
  assert.equal(disabled.productionPreflight.enabled, false);
  assert.doesNotThrow(() => assertContentModerationConfig(disabled, { nodeEnv: "production" }));

  const enabledMissing = buildContentModerationConfig({
    NODE_ENV: "production",
    CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED: "true"
  });
  assert.throws(
    () => assertContentModerationConfig(enabledMissing, { nodeEnv: "production" }),
    /CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CONFIRMATION/
  );
});

test("PRODUCTION_PREFLIGHT_CASES exposes exactly approved case ids", () => {
  assert.deepEqual(Object.keys(PRODUCTION_PREFLIGHT_CASES).sort(), [
    "tencent-video-v1",
    "wechat-image-v1",
    "wechat-text-v1"
  ]);
});

test("getProductionPreflightCase rejects unknown cases and caller supplied payload", () => {
  assert.throws(() => getProductionPreflightCase("custom-case"), /unsupported production preflight case/);
  assert.throws(
    () => getProductionPreflightCase("wechat-text-v1", { content: "caller content" }),
    /caller supplied preflight content is forbidden/
  );
});

test("parseProductionPreflightCliArgs accepts only one case argument", () => {
  assert.deepEqual(parseProductionPreflightCliArgs(["--case=wechat-text-v1"]), {
    caseId: "wechat-text-v1"
  });
  assert.throws(
    () => parseProductionPreflightCliArgs(["--case=wechat-text-v1", "--openid=x"]),
    /unsupported production preflight argument|exactly one --case/
  );
  assert.throws(() => parseProductionPreflightCliArgs(["--content=x"]), /exactly one --case/);
});

test("assertProductionPreflightGuards requires production confirmation admin closed intake and provider config", () => {
  assert.doesNotThrow(() => assertProductionPreflightGuards(validRuntime(), "wechat-text-v1"));
  assert.throws(
    () => assertProductionPreflightGuards(validRuntime({ nodeEnv: "test" }), "wechat-text-v1"),
    /NODE_ENV=production/
  );
  assert.throws(
    () => assertProductionPreflightGuards(validRuntime({ preflightEnabled: false }), "wechat-text-v1"),
    /disabled/
  );
  assert.throws(
    () => assertProductionPreflightGuards(validRuntime({ confirmation: "wrong" }), "wechat-text-v1"),
    /confirmation/
  );
  assert.throws(
    () => assertProductionPreflightGuards(validRuntime({ operatorStatus: "disabled" }), "wechat-text-v1"),
    /system_admin/
  );
  assert.throws(
    () => assertProductionPreflightGuards(
      validRuntime({ intakeModes: { text: "moderated", image: "closed", video: "closed" } }),
      "wechat-text-v1"
    ),
    /closed/
  );
  assert.throws(
    () => assertProductionPreflightGuards(
      validRuntime({ providerConfig: { ...validRuntime().providerConfig, wechatText: false } }),
      "wechat-text-v1"
    ),
    /target provider config/
  );
});

test("validateProductionPreflightCosKey accepts only private derived keys", () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    validateProductionPreflightCosKey(runId, `system/content-moderation-preflight/${runId}/image-v1.png`),
    true
  );
  assert.throws(
    () => validateProductionPreflightCosKey(runId, "uploads/session-album/videos/source/user.mp4"),
    /invalid production preflight COS key/
  );
});

test("createProductionPreflightConfigFingerprint is stable and redacted", () => {
  const fingerprint = createProductionPreflightConfigFingerprint({
    release: "d45-production-controlled-preflight",
    provider: "wechat_image",
    appId: "wx-app-id",
    secret: "do-not-include"
  });
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(fingerprint.includes("do-not-include"), false);
});

test("runProductionPreflightCase sends WeChat text directly and writes no normal moderation state", async () => {
  const calls = [];
  const runner = createProductionPreflightRunner({
    guards: () => undefined,
    repository: {
      acquireRun: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
      finishRun: async (input) => calls.push({ name: "finishRun", input }),
      releaseLock: async (input) => calls.push({ name: "releaseLock", input })
    },
    userRepository: {
      getOpenIdForUserId: async () => "openid-in-memory-only"
    },
    wechatClient: {
      checkText: async (input) => {
        calls.push({ name: "checkText", input });
        return { resultCategory: "pass" };
      }
    },
    normalModeration: {
      applyMediaResult: async () => calls.push({ name: "forbidden-normal-apply" })
    },
    clock: () => new Date("2026-07-13T00:00:00.000Z")
  });

  const result = await runProductionPreflightCase(runner, {
    caseId: "wechat-text-v1",
    runtime: validRuntime()
  });

  assert.equal(result.state, "passed");
  assert.equal(calls.some((call) => call.name === "forbidden-normal-apply"), false);
  assert.equal(calls.some((call) => call.input?.openid === "openid-in-memory-only"), true);
});

test("runProductionPreflightCase uploads image to private COS, stores trace HMAC, and cleans up on pass", async () => {
  const calls = [];
  const runner = createProductionPreflightRunner({
    guards: () => undefined,
    repository: {
      acquireRun: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
      recordAssociation: async (input) => calls.push({ name: "recordAssociation", input }),
      finishRun: async (input) => calls.push({ name: "finishRun", input }),
      releaseLock: async (input) => calls.push({ name: "releaseLock", input })
    },
    userRepository: {
      getOpenIdForUserId: async () => "openid-in-memory-only"
    },
    cos: {
      putObject: async (input) => calls.push({ name: "putObject", input }),
      buildSignedUrl: async (key) => `https://private.example/${encodeURIComponent(key)}`,
      deleteObject: async (key) => calls.push({ name: "deleteObject", key }),
      headObject: async () => {
        const error = new Error("not found");
        error.code = "COS_OBJECT_NOT_FOUND";
        throw error;
      }
    },
    wechatClient: {
      checkImage: async () => ({ traceId: "raw-trace-id", resultCategory: "pass" })
    },
    hmacKey: "01234567890123456789012345678901",
    clock: () => new Date("2026-07-13T00:00:00.000Z")
  });

  const result = await runProductionPreflightCase(runner, {
    caseId: "wechat-image-v1",
    runtime: validRuntime()
  });

  assert.equal(result.state, "passed");
  assert.equal(
    calls.find((call) => call.name === "putObject").input.key,
    "system/content-moderation-preflight/11111111-1111-4111-8111-111111111111/image-v1.png"
  );
  assert.equal(calls.some((call) => call.name === "deleteObject"), true);
  assert.equal(JSON.stringify(calls).includes("raw-trace-id"), false);
});

test("runProductionPreflightCase fails when COS cleanup verification fails", async () => {
  const runner = createProductionPreflightRunner({
    guards: () => undefined,
    repository: {
      acquireRun: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
      recordAssociation: async () => undefined,
      finishRun: async (input) => {
        assert.equal(input.cleanupStatus, "cleanup_failed");
      },
      releaseLock: async () => undefined
    },
    userRepository: {
      getOpenIdForUserId: async () => "openid-in-memory-only"
    },
    cos: {
      putObject: async () => undefined,
      buildSignedUrl: async () => "https://private.example/image",
      deleteObject: async () => undefined,
      headObject: async () => ({ exists: true })
    },
    wechatClient: {
      checkImage: async () => ({ traceId: "raw-trace-id", resultCategory: "pass" })
    },
    hmacKey: "01234567890123456789012345678901",
    clock: () => new Date("2026-07-13T00:00:00.000Z")
  });

  await assert.rejects(
    runProductionPreflightCase(runner, { caseId: "wechat-image-v1", runtime: validRuntime() }),
    /cleanup verification failed/
  );
});

test("normal Tencent video validator still rejects production preflight keys", async () => {
  const { validateTencentVideoSourceObjectKey } = await import("../src/modules/content-moderation/tencent-video-client.js");
  assert.throws(
    () => validateTencentVideoSourceObjectKey("system/content-moderation-preflight/11111111-1111-4111-8111-111111111111/video-v1.mp4"),
    /video source object/
  );
});
