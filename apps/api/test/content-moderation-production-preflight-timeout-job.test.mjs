import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createContentModerationProductionPreflightTimeoutWorker
} from "../src/jobs/content-moderation-production-preflight-timeout.js";

test("preflight timeout worker uses its isolated repository and verifies COS deletion", async () => {
  const calls = [];
  const worker = createContentModerationProductionPreflightTimeoutWorker({
    repository: {
      listTimedOutRuns: async () => [{
        id: "11111111-1111-4111-8111-111111111111",
        provider: "tencent_video",
        caseId: "tencent-video-v1"
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
    storage: {
      delete: async (key) => calls.push({ name: "delete", key }),
      head: async () => {
        const error = new Error("not found");
        error.code = "COS_OBJECT_NOT_FOUND";
        throw error;
      }
    },
    guards: () => undefined,
    runtimeFactory: async () => ({}),
    moderationConfig: {
      productionPreflight: {
        callbackTimeoutMs: 15 * 60 * 1000,
        timeoutBatchSize: 10,
        timeoutPollMs: 60_000
      }
    }
  });

  const result = await worker.runOnce();

  assert.deepEqual(result, { scanned: 1, finalized: 1, cleanupFailed: 0 });
  assert.equal(
    calls.find((call) => call.name === "delete").key,
    "system/content-moderation-preflight/11111111-1111-4111-8111-111111111111/video-v1.mp4"
  );
  assert.equal(
    calls.find((call) => call.name === "finalizeRun").input.failureCode,
    "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CALLBACK_TIMEOUT"
  );
});

test("preflight timeout worker emits a high-priority safe alert when cleanup fails", async () => {
  const events = [];
  const worker = createContentModerationProductionPreflightTimeoutWorker({
    repository: {
      listTimedOutRuns: async () => [{
        id: "11111111-1111-4111-8111-111111111111",
        provider: "wechat_image",
        caseId: "wechat-image-v1"
      }],
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
        assert.fail("cleanup must fail");
      }
    },
    storage: {
      delete: async () => { throw new Error("private COS delete failed"); },
      head: async () => assert.fail("head must not run after delete failure")
    },
    guards: () => undefined,
    runtimeFactory: async () => ({}),
    emit: (event, fields) => events.push({ event, fields }),
    moderationConfig: {
      productionPreflight: {
        callbackTimeoutMs: 15 * 60 * 1000,
        timeoutBatchSize: 10,
        timeoutPollMs: 60_000
      }
    }
  });

  const result = await worker.runOnce();

  assert.deepEqual(result, { scanned: 1, finalized: 1, cleanupFailed: 1 });
  assert.deepEqual(events, [{
    event: "moderation_operational_alert",
    fields: {
      outcome: "error",
      errorCode: "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CLEANUP_FAILED",
      priority: "high"
    }
  }]);
});

test("API package exposes the isolated preflight timeout worker command", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );
  assert.equal(
    packageJson.scripts["job:content-moderation-production-preflight-timeout"],
    "node src/jobs/content-moderation-production-preflight-timeout.js"
  );
});

test("production example keeps the preflight timeout worker running with bounded settings", async () => {
  const [compose, productionEnv] = await Promise.all([
    readFile(new URL("../../../docker-compose.prod.example.yml", import.meta.url), "utf8"),
    readFile(new URL("../../../.env.production.example", import.meta.url), "utf8")
  ]);
  assert.match(
    compose,
    /content-moderation-production-preflight-timeout:[\s\S]*job:content-moderation-production-preflight-timeout/
  );
  for (const entry of [
    "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CALLBACK_TIMEOUT_MS=900000",
    "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TIMEOUT_POLL_MS=60000",
    "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TIMEOUT_BATCH_SIZE=10"
  ]) {
    assert.equal(productionEnv.includes(entry), true, `missing ${entry}`);
  }
});
