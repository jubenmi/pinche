import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

function createPreflightCallbackFinalizer(calls) {
  return async ({ cleanupObject, ...input }) => {
    const cleanupStatus = await cleanupObject();
    const state = input.resultCategory === "pass" ? "passed" : "failed";
    calls.push({
      name: "finalizeRun",
      input: { ...input, state, cleanupStatus }
    });
    return {
      finalized: true,
      state,
      resultCategory: input.resultCategory,
      cleanupStatus
    };
  };
}

function createPreflightRunnerFinalizer(calls) {
  return async ({ cleanupObject, ...input }) => {
    let cleanupStatus = "not_required";
    if (typeof cleanupObject === "function") {
      await cleanupObject();
      cleanupStatus = "deleted";
    }
    const state = input.resultCategory === "pass" ? "passed" : "failed";
    calls.push({
      name: "finalizeRun",
      input: { ...input, state, cleanupStatus }
    });
    return {
      finalized: true,
      state,
      resultCategory: input.resultCategory,
      cleanupStatus
    };
  };
}

test("production preflight config defaults disabled and validates only when enabled", () => {
  const disabled = buildContentModerationConfig({ NODE_ENV: "production" });
  assert.equal(disabled.productionPreflight.enabled, false);
  assert.equal(disabled.productionPreflight.callbackTimeoutMs, 15 * 60 * 1000);
  assert.equal(disabled.productionPreflight.timeoutPollMs, 60_000);
  assert.equal(disabled.productionPreflight.timeoutBatchSize, 10);
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

test("assertProductionPreflightGuards requires production confirmation admin and provider config independent of deprecated intake modes", () => {
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
  for (const mode of ["closed", "moderated", "legacy"]) {
    assert.doesNotThrow(() => assertProductionPreflightGuards(
      validRuntime({ intakeModes: { text: mode, image: mode, video: mode } }),
      "wechat-text-v1"
    ));
  }
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
  const input = {
    release: "d45-production-controlled-preflight",
    provider: "wechat_image",
    appId: "wx-app-id",
    confirmation: "confirm-012345678901234567890123",
    hmacKey: "01234567890123456789012345678901",
    secret: "do-not-include"
  };
  const fingerprint = createProductionPreflightConfigFingerprint(input);
  const rotatedConfirmation = createProductionPreflightConfigFingerprint({
    ...input,
    confirmation: "rotated-012345678901234567890"
  });
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  assert.notEqual(fingerprint, rotatedConfirmation);
  assert.equal(fingerprint.includes("do-not-include"), false);
  assert.equal(fingerprint.includes(input.confirmation), false);
});

test("runProductionPreflightCase accepts the real WeChat text pass result and writes no normal moderation state", async () => {
  const calls = [];
  const runner = createProductionPreflightRunner({
    guards: () => undefined,
    repository: {
      acquireRun: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
      markSubmitting: async (input) => {
        calls.push({ name: "markSubmitting", input });
        return true;
      },
      finalizeRun: createPreflightRunnerFinalizer(calls)
    },
    userRepository: {
      getOpenIdForUserId: async () => "openid-in-memory-only"
    },
    wechatClient: {
      checkText: async (input) => {
        calls.push({ name: "checkText", input });
        return { suggestion: "pass", label: "", score: 100 };
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

test("synchronous preflight completion uses one finalizer for terminal state and provider lock", async () => {
  const calls = [];
  const runner = createProductionPreflightRunner({
    guards: () => undefined,
    repository: {
      acquireRun: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
      markSubmitting: async (input) => {
        calls.push({ name: "markSubmitting", input });
        return true;
      },
      finalizeRun: async ({ cleanupObject, ...input }) => {
        assert.equal(cleanupObject, undefined);
        calls.push({ name: "finalizeRun", input });
        return {
          finalized: true,
          state: "passed",
          resultCategory: "pass",
          cleanupStatus: "not_required"
        };
      }
    },
    userRepository: {
      getOpenIdForUserId: async () => "openid-in-memory-only"
    },
    wechatClient: {
      checkText: async () => {
        calls.push({ name: "checkText" });
        return { suggestion: "pass" };
      }
    },
    clock: () => new Date("2026-07-13T00:00:00.000Z")
  });

  const result = await runProductionPreflightCase(runner, {
    caseId: "wechat-text-v1",
    runtime: validRuntime()
  });

  assert.equal(result.state, "passed");
  assert.deepEqual(calls.map((call) => call.name), [
    "markSubmitting",
    "checkText",
    "finalizeRun"
  ]);
  assert.equal(calls.find((call) => call.name === "finalizeRun").input.provider, "wechat_text");
  assert.deepEqual(
    calls.find((call) => call.name === "finalizeRun").input.expectedStates,
    ["submitting"]
  );
});

test("preflight refreshes the active system_admin guard immediately before provider outbound", async () => {
  const calls = [];
  let refreshes = 0;
  const runner = createProductionPreflightRunner({
    guards: assertProductionPreflightGuards,
    refreshRuntime: async () => {
      refreshes += 1;
      return refreshes === 1
        ? validRuntime()
        : validRuntime({ operatorStatus: "missing" });
    },
    repository: {
      acquireRun: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
      markSubmitting: async () => true,
      finalizeRun: createPreflightRunnerFinalizer(calls)
    },
    userRepository: {
      getOpenIdForUserId: async () => "openid-in-memory-only"
    },
    wechatClient: {
      checkText: async () => assert.fail("disabled system_admin must prevent provider outbound")
    },
    clock: () => new Date("2026-07-13T00:00:00.000Z")
  });

  await assert.rejects(
    runProductionPreflightCase(runner, {
      caseId: "wechat-text-v1",
      runtime: validRuntime()
    }),
    /active system_admin/
  );
  assert.equal(refreshes, 2);
  assert.equal(calls.some((call) => call.name === "finalizeRun"), true);
});

test("preflight revalidates after resolving text identity before WeChat outbound", async () => {
  const calls = [];
  let refreshes = 0;
  let operatorActive = true;
  const runner = createProductionPreflightRunner({
    guards: assertProductionPreflightGuards,
    refreshRuntime: async () => {
      refreshes += 1;
      return validRuntime({ operatorStatus: operatorActive ? "active" : "missing" });
    },
    repository: {
      acquireRun: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
      markSubmitting: async () => true,
      finalizeRun: createPreflightRunnerFinalizer(calls)
    },
    userRepository: {
      getOpenIdForUserId: async () => {
        operatorActive = false;
        return "openid-in-memory-only";
      }
    },
    wechatClient: {
      checkText: async () => assert.fail("operator change during identity lookup must prevent WeChat outbound")
    },
    clock: () => new Date("2026-07-13T00:00:00.000Z")
  });

  await assert.rejects(
    runProductionPreflightCase(runner, {
      caseId: "wechat-text-v1",
      runtime: validRuntime()
    }),
    /active system_admin/
  );
  assert.equal(refreshes, 3);
});

test("preflight revalidates after image preparation before WeChat image outbound", async () => {
  const calls = [];
  let refreshes = 0;
  let operatorActive = true;
  const runner = createProductionPreflightRunner({
    hmacKey: "01234567890123456789012345678901",
    guards: assertProductionPreflightGuards,
    refreshRuntime: async () => {
      refreshes += 1;
      return validRuntime({ operatorStatus: operatorActive ? "active" : "missing" });
    },
    repository: {
      acquireRun: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
      markSubmitting: async () => true,
      finalizeRun: createPreflightRunnerFinalizer(calls)
    },
    cos: {
      putObject: async () => undefined,
      buildSignedUrl: async () => "https://private.example/signed",
      deleteObject: async () => undefined,
      headObject: async () => {
        const error = new Error("not found");
        error.code = "COS_OBJECT_NOT_FOUND";
        throw error;
      }
    },
    userRepository: {
      getOpenIdForUserId: async () => {
        operatorActive = false;
        return "openid-in-memory-only";
      }
    },
    wechatClient: {
      checkImage: async () => assert.fail("operator change during image preparation must prevent WeChat outbound")
    },
    clock: () => new Date("2026-07-13T00:00:00.000Z")
  });

  await assert.rejects(
    runProductionPreflightCase(runner, {
      caseId: "wechat-image-v1",
      runtime: validRuntime()
    }),
    /active system_admin/
  );
  assert.equal(refreshes, 4);
});

test("preflight revalidates after video association before Tencent outbound", async () => {
  const calls = [];
  let refreshes = 0;
  let operatorActive = true;
  const runner = createProductionPreflightRunner({
    hmacKey: "01234567890123456789012345678901",
    guards: assertProductionPreflightGuards,
    refreshRuntime: async () => {
      refreshes += 1;
      return validRuntime({ operatorStatus: operatorActive ? "active" : "missing" });
    },
    repository: {
      acquireRun: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
      markSubmitting: async () => true,
      recordAssociation: async () => {
        operatorActive = false;
      },
      finalizeRun: createPreflightRunnerFinalizer(calls)
    },
    cos: {
      putObject: async () => undefined,
      deleteObject: async () => undefined,
      headObject: async () => {
        const error = new Error("not found");
        error.code = "COS_OBJECT_NOT_FOUND";
        throw error;
      }
    },
    tencentVideoClient: {
      submitProductionPreflightVideo: async () => assert.fail("operator change during association write must prevent Tencent outbound")
    },
    clock: () => new Date("2026-07-13T00:00:00.000Z")
  });

  await assert.rejects(
    runProductionPreflightCase(runner, {
      caseId: "tencent-video-v1",
      runtime: validRuntime()
    }),
    /active system_admin/
  );
  assert.equal(refreshes, 4);
});

test("synchronous preflight cleanup failure raises one safe operational alert", async () => {
  const alerts = [];
  const runner = createProductionPreflightRunner({
    hmacKey: "01234567890123456789012345678901",
    guards: () => undefined,
    onCleanupFailure: async (input) => alerts.push(input),
    repository: {
      acquireRun: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
      markSubmitting: async () => true,
      recordAssociation: async () => undefined,
      finalizeRun: async ({ cleanupObject }) => {
        try {
          await cleanupObject();
        } catch {
          return {
            finalized: true,
            state: "failed",
            resultCategory: "error",
            cleanupStatus: "cleanup_failed"
          };
        }
        return {
          finalized: true,
          state: "failed",
          resultCategory: "error",
          cleanupStatus: "deleted"
        };
      }
    },
    cos: {
      putObject: async () => undefined,
      buildSignedUrl: async () => "https://private.example/signed",
      deleteObject: async () => { throw new Error("delete failed"); },
      headObject: async () => { throw new Error("head must not run"); }
    },
    userRepository: { getOpenIdForUserId: async () => "openid-in-memory-only" },
    wechatClient: { checkImage: async () => { throw new Error("provider failed"); } },
    clock: () => new Date("2026-07-13T00:00:00.000Z")
  });

  await assert.rejects(
    runProductionPreflightCase(runner, {
      caseId: "wechat-image-v1",
      runtime: validRuntime()
    }),
    /provider failed/
  );
  assert.deepEqual(alerts, [{ provider: "wechat_image" }]);
});

test("runProductionPreflightCase uploads image to private COS, stores trace HMAC, and cleans up on pass", async () => {
  const calls = [];
  const runner = createProductionPreflightRunner({
    guards: () => undefined,
    repository: {
      acquireRun: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
      recordAssociation: async (input) => calls.push({ name: "recordAssociation", input }),
      markSubmitting: async () => true,
      finalizeRun: createPreflightRunnerFinalizer(calls)
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

test("runProductionPreflightCase leaves async WeChat image preflight awaiting callback without cleanup or lock release", async () => {
  const calls = [];
  const runner = createProductionPreflightRunner({
    guards: () => undefined,
    repository: {
      acquireRun: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
      recordAssociation: async (input) => calls.push({ name: "recordAssociation", input }),
      markSubmitting: async (input) => {
        calls.push({ name: "markSubmitting", input });
        return true;
      },
      markAwaitingCallback: async (input) => calls.push({ name: "markAwaitingCallback", input })
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
      checkImage: async () => ({ traceId: "raw-trace-id" })
    },
    hmacKey: "01234567890123456789012345678901",
    clock: () => new Date("2026-07-13T00:00:00.000Z")
  });

  const result = await runProductionPreflightCase(runner, {
    caseId: "wechat-image-v1",
    runtime: validRuntime()
  });

  assert.equal(result.state, "awaiting_callback");
  assert.equal(calls.some((call) => call.name === "deleteObject"), false);
  assert.equal(calls.some((call) => call.name === "finalizeRun"), false);
  assert.equal(calls.some((call) => call.name === "markSubmitting"), true);
  assert.equal(calls.some((call) => call.name === "markAwaitingCallback"), true);
  assert.ok(
    calls.findIndex((call) => call.name === "markSubmitting") <
      calls.findIndex((call) => call.name === "recordAssociation")
  );
  assert.equal(JSON.stringify(calls).includes("raw-trace-id"), false);
});

test("runProductionPreflightCase leaves async Tencent video preflight awaiting callback without cleanup or lock release", async () => {
  const calls = [];
  const runner = createProductionPreflightRunner({
    guards: () => undefined,
    repository: {
      acquireRun: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
      recordAssociation: async (input) => calls.push({ name: "recordAssociation", input }),
      markSubmitting: async () => true,
      markAwaitingCallback: async (input) => calls.push({ name: "markAwaitingCallback", input })
    },
    cos: {
      putObject: async (input) => calls.push({ name: "putObject", input }),
      buildSignedUrl: async () => "https://private.example/video",
      deleteObject: async (key) => calls.push({ name: "deleteObject", key }),
      headObject: async () => {
        const error = new Error("not found");
        error.code = "COS_OBJECT_NOT_FOUND";
        throw error;
      }
    },
    tencentVideoClient: {
      submitProductionPreflightVideo: async () => ({
        JobId: "raw-job-id",
        DataId: "11111111-1111-4111-8111-111111111111",
        State: "Submitted"
      })
    },
    hmacKey: "01234567890123456789012345678901",
    clock: () => new Date("2026-07-13T00:00:00.000Z")
  });

  const result = await runProductionPreflightCase(runner, {
    caseId: "tencent-video-v1",
    runtime: validRuntime()
  });

  assert.equal(result.state, "awaiting_callback");
  assert.equal(calls.some((call) => call.name === "deleteObject"), false);
  assert.equal(calls.some((call) => call.name === "finalizeRun"), false);
  assert.equal(calls.some((call) => call.name === "markAwaitingCallback"), true);
  assert.equal(JSON.stringify(calls).includes("raw-job-id"), false);
});

test("runProductionPreflightCase fails closed when an async run cannot enter awaiting callback", async () => {
  const calls = [];
  const runner = createProductionPreflightRunner({
    guards: () => undefined,
    repository: {
      acquireRun: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
      recordAssociation: async () => undefined,
      markSubmitting: async () => true,
      markAwaitingCallback: async () => false,
      finalizeRun: createPreflightRunnerFinalizer(calls)
    },
    userRepository: {
      getOpenIdForUserId: async () => "openid-in-memory-only"
    },
    cos: {
      putObject: async () => undefined,
      buildSignedUrl: async () => "https://private.example/image",
      deleteObject: async () => calls.push({ name: "deleteObject" }),
      headObject: async () => {
        const error = new Error("not found");
        error.code = "COS_OBJECT_NOT_FOUND";
        throw error;
      }
    },
    wechatClient: {
      checkImage: async () => ({ traceId: "raw-trace-id" })
    },
    hmacKey: "01234567890123456789012345678901",
    clock: () => new Date("2026-07-13T00:00:00.000Z")
  });

  await assert.rejects(
    runProductionPreflightCase(runner, { caseId: "wechat-image-v1", runtime: validRuntime() }),
    /awaiting callback state transition failed/
  );
  assert.equal(calls.some((call) => call.name === "deleteObject"), true);
  assert.equal(calls.find((call) => call.name === "finalizeRun").input.state, "failed");
});

test("runProductionPreflightCase fails when COS cleanup verification fails", async () => {
  let finalizationCount = 0;
  const runner = createProductionPreflightRunner({
    guards: () => undefined,
    repository: {
      acquireRun: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
      recordAssociation: async () => undefined,
      markSubmitting: async () => true,
      finalizeRun: async ({ cleanupObject, ...input }) => {
        finalizationCount += 1;
        if (finalizationCount > 1) {
          return { finalized: false, state: "failed" };
        }
        try {
          await cleanupObject();
        } catch {
          return {
            finalized: true,
            state: "failed",
            resultCategory: "error",
            cleanupStatus: "cleanup_failed"
          };
        }
        assert.fail(`unexpected cleanup success: ${JSON.stringify(input)}`);
      },
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
    { code: "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CLEANUP_FAILED" }
  );
});

test("normal Tencent video validator still rejects production preflight keys", async () => {
  const { validateTencentVideoSourceObjectKey } = await import("../src/modules/content-moderation/tencent-video-client.js");
  assert.throws(
    () => validateTencentVideoSourceObjectKey("system/content-moderation-preflight/11111111-1111-4111-8111-111111111111/video-v1.mp4"),
    /video source object/
  );
});

test("runtime preflight runner sends its private video through the dedicated strict transport", async () => {
  const { createProductionPreflightRunnerFromRuntime } = await import(
    "../src/jobs/content-moderation-production-preflight.js"
  );
  const calls = [];
  const runId = "11111111-1111-4111-8111-111111111111";
  const moderationConfig = buildContentModerationConfig({
    NODE_ENV: "production",
    CONTENT_MODERATION_ENABLED: "true",
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
    TENCENT_CI_VIDEO_CALLBACK_URL: "https://api.example.test/api/internal/content-moderation/tencent-video/callback",
    TENCENT_CI_VIDEO_CALLBACK_TOKEN: "x".repeat(32),
    COS_SECRET_ID: "secret-id",
    COS_SECRET_KEY: "secret-key",
    COS_BUCKET: "bucket-123"
  });
  const runner = createProductionPreflightRunnerFromRuntime({
    connection: {},
    moderationConfig,
    wechatClient: {},
    fetchImpl: async (_url, options) => {
      calls.push(options);
      return new Response(
        `<Response><JobsDetail><JobId>ci-video-1</JobId><State>Submitted</State><DataId>${runId}</DataId></JobsDetail></Response>`,
        { status: 200 }
      );
    }
  });

  const response = await runner.tencentVideoClient.submitProductionPreflightVideo({
    runId,
    dataId: runId,
    objectKey: `system/content-moderation-preflight/${runId}/video-v1.mp4`
  });

  assert.equal(response.JobId, "ci-video-1");
  assert.match(calls[0].body, /<Object>system\/content-moderation-preflight\//);
});

test("runtime preflight runner refreshes the current admin guard with the one-time CLI confirmation", async () => {
  const { createProductionPreflightRunnerFromRuntime } = await import(
    "../src/jobs/content-moderation-production-preflight.js"
  );
  const moderationConfig = {
    nodeEnv: "production",
    textIntakeMode: "closed",
    imageIntakeMode: "closed",
    videoIntakeMode: "closed",
    wechatTextEnabled: true,
    wechatImageEnabled: true,
    wechatAppId: "wx-d45-test",
    wechatAppSecret: "secret",
    tencentVideoEnabled: true,
    tencentVideoPolicyId: "video-policy",
    tencentVideoRegion: "ap-nanjing",
    tencentVideoCallbackUrl: "https://api.example.test/callback",
    tencentVideoCallbackToken: "x".repeat(32),
    bucket: "bucket-123",
    cosEnabled: true,
    cosRegion: "ap-nanjing",
    redisEnabled: true,
    redisUrl: "redis://redis.example.test:6379",
    productionPreflight: {
      enabled: true,
      confirmation: "confirm-012345678901234567890123",
      referenceHmacKey: "h".repeat(32),
      operatorUserId: 42,
      testAdminUserId: 42,
      releaseFingerprint: "release"
    }
  };
  const runner = createProductionPreflightRunnerFromRuntime({
    connection: {
      query: async () => [[{ role: "system_admin", status: "active" }]]
    },
    moderationConfig,
    env: { D45_PREFLIGHT_CONFIRMATION: "confirm-012345678901234567890123" },
    wechatClient: {}
  });

  const runtime = await runner.refreshRuntime();

  assert.equal(runtime.operatorStatus, "active");
  assert.equal(runtime.confirmation, "confirm-012345678901234567890123");
});

test("Tencent preflight callback matched by data id updates preflight only", async () => {
  const {
    tryHandleProductionPreflightTencentCallback
  } = await import("../src/modules/content-moderation/production-preflight-callback.js");
  const calls = [];
  const handled = await tryHandleProductionPreflightTencentCallback({
    payload: {
      dataId: "raw-data-id",
      jobId: "raw-job-id",
      resultCategory: "pass"
    },
    runtime: validRuntime(),
    hmacKey: "01234567890123456789012345678901",
    guards: () => undefined,
    repository: {
      findAttemptByAssociation: async ({ kind }) => (kind === "data_id" ? { runId: "run-1" } : null),
      recordAssociation: async (input) => calls.push({ name: "recordAssociation", input }),
      finalizeRun: createPreflightCallbackFinalizer(calls)
    },
    normalModeration: {
      applyMediaResult: async () => calls.push({ name: "forbidden-normal-apply" })
    }
  });

  assert.equal(handled.status, "handled");
  assert.equal(calls.some((call) => call.name === "forbidden-normal-apply"), false);
  assert.equal(JSON.stringify(calls).includes("raw-job-id"), false);
});

test("Tencent preflight early callback returns retry while job association is missing", async () => {
  const {
    tryHandleProductionPreflightTencentCallback
  } = await import("../src/modules/content-moderation/production-preflight-callback.js");
  const handled = await tryHandleProductionPreflightTencentCallback({
    payload: {
      dataId: "raw-data-id",
      jobId: "raw-job-id",
      resultCategory: "pass"
    },
    runtime: validRuntime(),
    hmacKey: "01234567890123456789012345678901",
    guards: () => undefined,
    repository: {
      findAttemptByAssociation: async ({ kind }) => (kind === "data_id" ? { runId: "run-1" } : null)
    },
    requireJobAssociation: true
  });

  assert.deepEqual(handled, { status: "retry", httpStatus: 503 });
});

test("WeChat image preflight callback matched by trace id updates preflight only", async () => {
  const {
    tryHandleProductionPreflightWechatImageCallback
  } = await import("../src/modules/content-moderation/production-preflight-callback.js");
  const calls = [];
  const handled = await tryHandleProductionPreflightWechatImageCallback({
    event: {
      traceId: "raw-trace-id",
      resultCategory: "pass"
    },
    runtime: validRuntime(),
    hmacKey: "01234567890123456789012345678901",
    guards: () => undefined,
    repository: {
      findAttemptByAssociation: async () => ({ runId: "11111111-1111-4111-8111-111111111111" }),
      finalizeRun: createPreflightCallbackFinalizer(calls)
    },
    normalModeration: {
      applyMediaResult: async () => calls.push({ name: "forbidden-normal-apply" })
    }
  });

  assert.equal(handled.status, "handled");
  assert.equal(calls.some((call) => call.name === "forbidden-normal-apply"), false);
  assert.equal(JSON.stringify(calls).includes("raw-trace-id"), false);
});

test("WeChat image preflight callback retries while its submission is still being recorded", async () => {
  const {
    tryHandleProductionPreflightWechatImageCallback
  } = await import("../src/modules/content-moderation/production-preflight-callback.js");
  const handled = await tryHandleProductionPreflightWechatImageCallback({
    event: {
      traceId: "raw-trace-id",
      resultCategory: "pass"
    },
    runtime: validRuntime(),
    hmacKey: "01234567890123456789012345678901",
    guards: () => undefined,
    repository: {
      findAttemptByAssociation: async () => ({ runId: "run-1" }),
      findRun: async () => ({ state: "submitting" })
    }
  });

  assert.deepEqual(handled, { status: "retry", httpStatus: 503 });
});

test("WeChat image preflight pass callback cleans derived COS object before releasing lock", async () => {
  const {
    tryHandleProductionPreflightWechatImageCallback
  } = await import("../src/modules/content-moderation/production-preflight-callback.js");
  const calls = [];
  const runId = "11111111-1111-4111-8111-111111111111";
  const handled = await tryHandleProductionPreflightWechatImageCallback({
    event: {
      traceId: "raw-trace-id",
      resultCategory: "pass"
    },
    runtime: validRuntime(),
    hmacKey: "01234567890123456789012345678901",
    guards: () => undefined,
    repository: {
      findAttemptByAssociation: async () => ({ runId }),
      finalizeRun: createPreflightCallbackFinalizer(calls)
    },
    cleanupObject: async (input) => calls.push({ name: "cleanupObject", input })
  });

  assert.equal(handled.status, "handled");
  assert.deepEqual(calls.map((call) => call.name), ["cleanupObject", "finalizeRun"]);
  assert.equal(
    calls[0].input.objectKey,
    `system/content-moderation-preflight/${runId}/image-v1.png`
  );
  assert.equal(calls.find((call) => call.name === "finalizeRun").input.cleanupStatus, "deleted");
});

test("Tencent video preflight pass callback cleans derived COS object before releasing lock", async () => {
  const {
    tryHandleProductionPreflightTencentCallback
  } = await import("../src/modules/content-moderation/production-preflight-callback.js");
  const calls = [];
  const runId = "11111111-1111-4111-8111-111111111111";
  const handled = await tryHandleProductionPreflightTencentCallback({
    payload: {
      dataId: runId,
      jobId: "raw-job-id",
      resultCategory: "pass"
    },
    runtime: validRuntime(),
    hmacKey: "01234567890123456789012345678901",
    guards: () => undefined,
    repository: {
      findAttemptByAssociation: async ({ kind }) => (kind === "data_id" ? { runId } : null),
      recordAssociation: async (input) => calls.push({ name: "recordAssociation", input }),
      finalizeRun: createPreflightCallbackFinalizer(calls)
    },
    cleanupObject: async (input) => calls.push({ name: "cleanupObject", input })
  });

  assert.equal(handled.status, "handled");
  assert.equal(calls.some((call) => call.name === "cleanupObject"), true);
  assert.equal(
    calls.find((call) => call.name === "cleanupObject").input.objectKey,
    `system/content-moderation-preflight/${runId}/video-v1.mp4`
  );
  assert.equal(calls.find((call) => call.name === "finalizeRun").input.cleanupStatus, "deleted");
  assert.equal(JSON.stringify(calls).includes("raw-job-id"), false);
});

test("preflight callback cleans derived COS object even when provider returns non-pass", async () => {
  const {
    tryHandleProductionPreflightWechatImageCallback
  } = await import("../src/modules/content-moderation/production-preflight-callback.js");
  const calls = [];
  const runId = "11111111-1111-4111-8111-111111111111";
  const handled = await tryHandleProductionPreflightWechatImageCallback({
    event: {
      traceId: "raw-trace-id",
      resultCategory: "review"
    },
    runtime: validRuntime(),
    hmacKey: "01234567890123456789012345678901",
    guards: () => undefined,
    repository: {
      findAttemptByAssociation: async () => ({ runId }),
      finalizeRun: createPreflightCallbackFinalizer(calls)
    },
    cleanupObject: async (input) => calls.push({ name: "cleanupObject", input })
  });

  assert.equal(handled.status, "handled");
  assert.equal(calls.find((call) => call.name === "cleanupObject").input.state, "failed");
  assert.equal(calls.find((call) => call.name === "finalizeRun").input.state, "failed");
  assert.equal(calls.find((call) => call.name === "finalizeRun").input.cleanupStatus, "deleted");
});

test("preflight callback turns cleanup failure into a handled failed preflight", async () => {
  const {
    tryHandleProductionPreflightWechatImageCallback
  } = await import("../src/modules/content-moderation/production-preflight-callback.js");
  const calls = [];
  const alerts = [];
  const handled = await tryHandleProductionPreflightWechatImageCallback({
    event: {
      traceId: "raw-trace-id",
      resultCategory: "pass"
    },
    runtime: validRuntime(),
    hmacKey: "01234567890123456789012345678901",
    guards: () => undefined,
    repository: {
      findAttemptByAssociation: async () => ({ runId: "11111111-1111-4111-8111-111111111111" }),
      findRun: async () => ({ state: "awaiting_callback" }),
      finalizeRun: async (input) => {
        try {
          await input.cleanupObject();
        } catch {
          calls.push({ name: "cleanupFailed", input });
        }
        return {
          finalized: true,
          state: "failed",
          resultCategory: "error",
          cleanupStatus: "cleanup_failed"
        };
      }
    },
    cleanupObject: async () => {
      throw new Error("private COS delete failed");
    },
    onCleanupFailure: (input) => alerts.push(input)
  });

  assert.deepEqual(handled, { status: "handled", httpStatus: 200 });
  assert.equal(calls.some((call) => call.name === "cleanupFailed"), true);
  assert.deepEqual(alerts, [{ provider: "wechat_image" }]);
});

test("preflight callback closes and cleans its run when the callback guard fails", async () => {
  const {
    tryHandleProductionPreflightWechatImageCallback
  } = await import("../src/modules/content-moderation/production-preflight-callback.js");
  const calls = [];
  const handled = await tryHandleProductionPreflightWechatImageCallback({
    event: {
      traceId: "raw-trace-id",
      resultCategory: "pass"
    },
    runtime: validRuntime(),
    hmacKey: "01234567890123456789012345678901",
    guards: () => {
      throw new Error("operator authorization changed");
    },
    repository: {
      findAttemptByAssociation: async () => ({ runId: "11111111-1111-4111-8111-111111111111" }),
      findRun: async () => ({ state: "awaiting_callback" }),
      finalizeRun: async ({ cleanupObject, ...input }) => {
        await cleanupObject();
        calls.push({ name: "finalizeRun", input });
        return {
          finalized: true,
          state: "failed",
          resultCategory: "error",
          cleanupStatus: "deleted"
        };
      }
    },
    cleanupObject: async () => calls.push({ name: "cleanupObject" })
  });

  assert.deepEqual(handled, { status: "handled", httpStatus: 200 });
  assert.equal(calls.some((call) => call.name === "cleanupObject"), true);
  assert.equal(calls.find((call) => call.name === "finalizeRun").input.resultCategory, "error");
  assert.equal(
    calls.find((call) => call.name === "finalizeRun").input.failureCode,
    "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_GUARD_FAILED"
  );
});

test("preflight callback rejects a run whose one-time confirmation proof has rotated", async () => {
  const {
    tryHandleProductionPreflightWechatImageCallback
  } = await import("../src/modules/content-moderation/production-preflight-callback.js");
  const hmacKey = "01234567890123456789012345678901";
  const oldConfirmation = "old-confirm-012345678901234567890";
  const currentConfirmation = "new-confirm-012345678901234567890";
  const calls = [];
  const handled = await tryHandleProductionPreflightWechatImageCallback({
    event: {
      traceId: "raw-trace-id",
      resultCategory: "pass"
    },
    runtime: validRuntime({
      confirmation: currentConfirmation,
      expectedConfirmation: currentConfirmation,
      releaseFingerprint: "release",
      appId: "wx-app-id"
    }),
    hmacKey,
    guards: assertProductionPreflightGuards,
    repository: {
      findAttemptByAssociation: async () => ({ runId: "11111111-1111-4111-8111-111111111111" }),
      findRun: async () => ({
        state: "awaiting_callback",
        configFingerprint: createProductionPreflightConfigFingerprint({
          release: "release",
          provider: "wechat_image",
          appId: "wx-app-id",
          confirmation: oldConfirmation,
          hmacKey
        })
      }),
      finalizeRun: createPreflightCallbackFinalizer(calls)
    },
    cleanupObject: async () => undefined
  });

  assert.deepEqual(handled, { status: "handled", httpStatus: 200 });
  assert.equal(calls.find((call) => call.name === "finalizeRun").input.resultCategory, "error");
  assert.equal(
    calls.find((call) => call.name === "finalizeRun").input.failureCode,
    "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_GUARD_FAILED"
  );
  assert.equal(JSON.stringify(calls).includes(oldConfirmation), false);
  assert.equal(JSON.stringify(calls).includes(currentConfirmation), false);
});

test("unknown preflight callback returns miss so normal path remains responsible", async () => {
  const {
    tryHandleProductionPreflightWechatImageCallback
  } = await import("../src/modules/content-moderation/production-preflight-callback.js");
  const handled = await tryHandleProductionPreflightWechatImageCallback({
    event: {
      traceId: "normal-user-trace",
      resultCategory: "pass"
    },
    runtime: validRuntime(),
    hmacKey: "01234567890123456789012345678901",
    guards: () => undefined,
    repository: {
      findAttemptByAssociation: async () => null
    }
  });

  assert.equal(handled.status, "miss");
});

test("active image preflight does not retry a trace already owned by the normal callback chain", async () => {
  const {
    tryHandleProductionPreflightWechatImageCallback
  } = await import("../src/modules/content-moderation/production-preflight-callback.js");
  const handled = await tryHandleProductionPreflightWechatImageCallback({
    event: {
      traceId: "normal-user-trace",
      resultCategory: "pass"
    },
    runtime: validRuntime(),
    hmacKey: "01234567890123456789012345678901",
    guards: () => undefined,
    repository: {
      findAttemptByAssociation: async () => null,
      findOrdinaryWechatImageAttempt: async ({ traceId }) => {
        assert.equal(traceId, "normal-user-trace");
        return { id: 1 };
      },
      hasActiveWechatImagePreflight: async () => true
    }
  });

  assert.equal(handled.status, "miss");
});

test("disabled preflight does not delay an unknown ordinary WeChat image callback", async () => {
  const {
    tryHandleProductionPreflightWechatImageCallback
  } = await import("../src/modules/content-moderation/production-preflight-callback.js");
  const handled = await tryHandleProductionPreflightWechatImageCallback({
    event: {
      traceId: "normal-user-trace",
      result: { decision: "pass" }
    },
    runtime: validRuntime({ preflightEnabled: false }),
    hmacKey: "01234567890123456789012345678901",
    guards: assertProductionPreflightGuards,
    repository: {
      findAttemptByAssociation: async () => null,
      findOrdinaryWechatImageAttempt: async () => null,
      hasActiveWechatImagePreflight: async () => true
    }
  });

  assert.deepEqual(handled, { status: "miss" });
});

test("production preflight job exposes main and redacts confirmation on rejected args", async () => {
  const job = await import("../src/jobs/content-moderation-production-preflight.js");
  assert.equal(typeof job.main, "function");
  const output = [];
  await assert.rejects(
    job.main({
      argv: ["--case=wechat-text-v1", "--openid=forbidden"],
      env: {
        D45_PREFLIGHT_CONFIRMATION: "confirm-012345678901234567890123"
      },
      stdout: { write: (line) => output.push(String(line)) },
      stderr: { write: (line) => output.push(String(line)) },
      exit: (code) => {
        throw new Error(`exit ${code}`);
      }
    }),
    /exit 1/
  );
  assert.equal(output.join("").includes("confirm-012345678901234567890123"), false);
  assert.match(output.join(""), /CONTENT_MODERATION_PRODUCTION_PREFLIGHT_JOB_FAILED/);
  assert.equal(output.join("").includes("unsupported production preflight argument"), false);
});

test("production preflight job emits a safe high-priority alert for synchronous cleanup failure", async () => {
  const source = await readFile(
    new URL("../src/jobs/content-moderation-production-preflight.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /onCleanupFailure:\s*\(\)\s*=>\s*emitContentModerationEvent\(/);
  assert.match(source, /CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CLEANUP_FAILED/);
  assert.match(source, /priority:\s*"high"/);
});
