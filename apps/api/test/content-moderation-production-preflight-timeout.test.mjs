import assert from "node:assert/strict";
import test from "node:test";

import {
  runProductionPreflightTimeoutBatch
} from "../src/modules/content-moderation/production-preflight-timeout.js";
import {
  assertProductionPreflightGuards,
  createProductionPreflightConfigFingerprint
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
    intakeModes: { text: "closed", image: "closed", video: "closed" },
    providerConfig: {
      wechatText: true,
      wechatImage: true,
      tencentVideo: true,
      cos: true,
      redis: true,
      callback: true
    },
    releaseFingerprint: "release",
    appId: "wx-app-id",
    referenceHmacKey: "01234567890123456789012345678901",
    ...overrides
  };
}

test("timeout batch cleans an expired async preflight and records a timeout failure", async () => {
  const calls = [];
  const runId = "11111111-1111-4111-8111-111111111111";
  const result = await runProductionPreflightTimeoutBatch({
    repository: {
      listTimedOutRuns: async (input) => {
        calls.push({ name: "listTimedOutRuns", input });
        return [{
          id: runId,
          provider: "wechat_image",
          caseId: "wechat-image-v1"
        }];
      },
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
    cleanupObject: async (input) => calls.push({ name: "cleanupObject", input }),
    guards: () => undefined,
    runtime: {},
    now: () => new Date("2026-07-13T00:15:00.000Z"),
    timeoutMs: 15 * 60 * 1000,
    limit: 10
  });

  assert.deepEqual(result, { scanned: 1, finalized: 1, cleanupFailed: 0 });
  assert.equal(calls.find((call) => call.name === "listTimedOutRuns").input.cutoff.toISOString(), "2026-07-13T00:00:00.000Z");
  assert.equal(
    calls.find((call) => call.name === "cleanupObject").input.objectKey,
    `system/content-moderation-preflight/${runId}/image-v1.png`
  );
  assert.equal(
    calls.find((call) => call.name === "finalizeRun").input.failureCode,
    "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CALLBACK_TIMEOUT"
  );
});

test("timeout recovery finalizes a started text preflight without touching COS", async () => {
  const calls = [];
  const result = await runProductionPreflightTimeoutBatch({
    repository: {
      listTimedOutRuns: async () => [{
        id: "11111111-1111-4111-8111-111111111111",
        provider: "wechat_text",
        caseId: "wechat-text-v1"
      }],
      finalizeRun: async ({ cleanupObject, ...input }) => {
        assert.equal(cleanupObject, undefined);
        calls.push({ name: "finalizeRun", input });
        return {
          finalized: true,
          state: "failed",
          resultCategory: "error",
          cleanupStatus: "not_required"
        };
      }
    },
    cleanupObject: async () => assert.fail("text preflight must not access COS"),
    guards: () => undefined,
    runtime: {},
    timeoutMs: 15 * 60 * 1000,
    limit: 10
  });

  assert.deepEqual(result, { scanned: 1, finalized: 1, cleanupFailed: 0 });
  assert.deepEqual(
    calls.find((call) => call.name === "finalizeRun").input.expectedStates,
    ["started", "submitting", "awaiting_callback"]
  );
});

test("timeout recovery rejects a run whose one-time confirmation proof has rotated", async () => {
  const calls = [];
  const hmacKey = "01234567890123456789012345678901";
  const result = await runProductionPreflightTimeoutBatch({
    repository: {
      listTimedOutRuns: async () => [{
        id: "11111111-1111-4111-8111-111111111111",
        provider: "wechat_image",
        caseId: "wechat-image-v1",
        configFingerprint: createProductionPreflightConfigFingerprint({
          release: "release",
          provider: "wechat_image",
          appId: "wx-app-id",
          confirmation: "old-confirm-012345678901234567890",
          hmacKey
        })
      }],
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
    cleanupObject: async () => undefined,
    guards: assertProductionPreflightGuards,
    runtime: validRuntime(),
    timeoutMs: 15 * 60 * 1000,
    limit: 10
  });

  assert.equal(result.finalized, 1);
  assert.equal(
    calls.find((call) => call.name === "finalizeRun").input.failureCode,
    "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_GUARD_FAILED"
  );
});

test("timeout recovery refreshes its guard runtime for each finalization", async () => {
  const calls = [];
  let runtimeReads = 0;
  const result = await runProductionPreflightTimeoutBatch({
    repository: {
      listTimedOutRuns: async () => [
        { id: "run-text-1", provider: "wechat_text", caseId: "wechat-text-v1" },
        { id: "run-text-2", provider: "wechat_text", caseId: "wechat-text-v1" }
      ],
      finalizeRun: async (input) => {
        calls.push(input);
        return {
          finalized: true,
          state: "failed",
          resultCategory: "error",
          cleanupStatus: "not_required"
        };
      }
    },
    cleanupObject: async () => assert.fail("text preflight must not access COS"),
    guards: (runtime) => {
      if (runtime.operatorStatus !== "active") throw new Error("operator changed");
    },
    runtimeFactory: async () => {
      runtimeReads += 1;
      return { operatorStatus: runtimeReads === 1 ? "active" : "missing" };
    },
    timeoutMs: 15 * 60 * 1000,
    limit: 10
  });

  assert.equal(result.finalized, 2);
  assert.equal(runtimeReads, 2);
  assert.equal(calls[0].failureCode, "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CALLBACK_TIMEOUT");
  assert.equal(calls[1].failureCode, "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_GUARD_FAILED");
});
