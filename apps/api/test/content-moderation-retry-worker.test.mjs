import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createContentModerationRetryWorker,
  runContentModerationRetryLoop
} from "../src/jobs/content-moderation-retry.js";

test("retry worker imports the controlled server moderation runtime without starting an HTTP listener", async () => {
  const [workerSource, serverSource] = await Promise.all([
    readFile(new URL("../src/jobs/content-moderation-retry.js", import.meta.url), "utf8"),
    readFile(new URL("../src/server.js", import.meta.url), "utf8")
  ]);
  assert.match(workerSource, /import \{ contentModeration \} from "\.\.\/server\.js"/);
  assert.match(serverSource, /export const contentModeration = createContentModerationService/);
  assert.match(serverSource, /if \(import\.meta\.url === `file:\/\/\$\{process\.argv\[1\]\}`\)/);

  const imported = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", "import './src/jobs/content-moderation-retry.js'; console.log('imported')"],
    {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    }
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout.trim(), "imported");
  assert.equal(imported.stderr.includes("pinche-api"), false);
});

test("retry worker uses the shared runtime processor and configured bounded batch settings", async () => {
  const calls = [];
  let claimed = false;
  const worker = createContentModerationRetryWorker({
    repositoryModule: {
      claimModerationRetryJobs: async (_connection, input) => {
        calls.push({ kind: "claim", input });
        if (claimed) return [];
        claimed = true;
        return [{
          id: 91,
          attempt_count: 0,
          provider: "wechat_sec_check",
          subject_type: "album_image",
          lease_token: input.leaseToken
        }];
      },
      rehydrateModerationRetryJob: async () => ({
        kind: "wechat_image",
        job: {
          id: 91,
          provider: "wechat_sec_check",
          subject_type: "album_image",
          status: "error"
        },
        objectKey: "uploads/session-album/display/a.jpg",
        uploaderUserId: 7,
        retryFacts: {
          kind: "album_image",
          mediaId: 91,
          subjectVersion: "etag-91",
          objectKey: "uploads/session-album/display/a.jpg",
          uploaderUserId: 7
        }
      }),
      failModerationJob: async () => assert.fail("successful retry must not fail")
    },
    withTransactionFn: async (run) => run({}),
    contentModerationRuntime: {
      submitWechatImageModeration: async (input) => calls.push({ kind: "image", input })
    },
    moderationConfig: {
      retryLimit: 6,
      retryBatchSize: 3,
      retryLeaseMs: 90_000
    },
    randomUUID: () => "lease-worker",
    now: () => 1_000,
    emit: () => {}
  });

  assert.deepEqual(await worker.runOnce(), { claimed: 1, failed: 0 });
  assert.equal(calls.find((call) => call.kind === "claim").input.limit, 1);
  assert.equal(calls.find((call) => call.kind === "image").input.objectKey, "uploads/session-album/display/a.jpg");
  assert.equal(calls.find((call) => call.kind === "image").input.leaseToken, "lease-worker");
});

test("retry worker never creates an injected lease shorter than the safe WeChat chain bound", async () => {
  let claim = null;
  const worker = createContentModerationRetryWorker({
    repositoryModule: {
      claimModerationRetryJobs: async (_connection, input) => {
        claim = input;
        return [];
      },
      rehydrateModerationRetryJob: async () => assert.fail("no job should be dispatched"),
      failModerationJob: async () => assert.fail("no job should fail")
    },
    withTransactionFn: async (run) => run({}),
    contentModerationRuntime: {},
    moderationConfig: {
      retryLimit: 6,
      retryBatchSize: 1,
      retryLeaseMs: 89_999
    },
    now: () => 1_000,
    randomUUID: () => "lease-safe",
    emit: () => {}
  });

  assert.deepEqual(await worker.runOnce(), { claimed: 0, failed: 0 });
  assert.equal(claim.leaseExpiresAt.getTime(), 91_000);
});

test("retry worker publishes queue depth and overdue-age snapshots after each batch", async () => {
  const events = [];
  const worker = createContentModerationRetryWorker({
    repositoryModule: {
      claimModerationRetryJobs: async () => [],
      rehydrateModerationRetryJob: async () => assert.fail("empty queue must not rehydrate"),
      getModerationQueueStats: async () => [{
        provider: "wechat_sec_check",
        subject_type: "album_image",
        status: "pending",
        queue_depth: 2,
        oldest_age_seconds: 901
      }]
    },
    withTransactionFn: async (run) => run({}),
    contentModerationRuntime: {},
    moderationConfig: {
      retryLimit: 6,
      retryBatchSize: 3,
      retryLeaseMs: 90_000,
      queueAlertAgeSeconds: 900
    },
    now: () => 1_000,
    randomUUID: () => "lease-queue",
    emit: (event, fields) => events.push({ event, fields })
  });

  assert.deepEqual(await worker.runOnce(), { claimed: 0, failed: 0 });
  assert.deepEqual(events, [
    {
      event: "moderation_queue_snapshot",
      fields: {
        provider: "wechat_sec_check",
        subjectType: "album_image",
        outcome: "pending",
        queueDepth: 2,
        oldestAgeSeconds: 901
      }
    },
    {
      event: "moderation_queue_oldest_age",
      fields: {
        provider: "wechat_sec_check",
        subjectType: "album_image",
        outcome: "pending",
        queueDepth: 2,
        oldestAgeSeconds: 901
      }
    },
    {
      event: "moderation_operational_alert",
      fields: {
        provider: "wechat_sec_check",
        subjectType: "album_image",
        outcome: "pending",
        errorCode: "CONTENT_MODERATION_QUEUE_AGE_EXCEEDED",
        priority: "high"
      }
    }
  ]);
});

test("current invalid rehydrated facts become a terminal hidden error and are not claimed again", async () => {
  const failures = [];
  const events = [];
  let eligible = true;
  const worker = createContentModerationRetryWorker({
    repositoryModule: {
      claimModerationRetryJobs: async (_connection, input) => eligible
        ? [{
          id: 92,
          attempt_count: 0,
          provider: "wechat_sec_check",
          subject_type: "album_image",
          lease_token: input.leaseToken
        }]
        : [],
      rehydrateModerationRetryJob: async () => {
        throw Object.assign(new Error("object facts changed"), {
          code: "CONTENT_MODERATION_RETRY_FACTS_INVALID"
        });
      },
      failModerationJob: async (_connection, input) => {
        failures.push(input);
        eligible = false;
        return true;
      }
    },
    withTransactionFn: async (run) => run({}),
    contentModerationRuntime: {
      submitWechatImageModeration: async () => assert.fail("invalid facts must not reach provider")
    },
    moderationConfig: {
      retryLimit: 6,
      retryBatchSize: 3,
      retryLeaseMs: 90_000
    },
    now: () => 1_000,
    randomUUID: () => "lease-invalid",
    emit: (event, fields) => events.push({ event, fields })
  });

  assert.deepEqual(await worker.runOnce(), { claimed: 1, failed: 1 });
  assert.equal(failures[0].exhausted, true);
  assert.equal(failures[0].errorCode, "CONTENT_MODERATION_RETRY_FACTS_INVALID");
  const fields = {
    provider: "wechat_sec_check",
    subjectType: "album_image",
    outcome: "operator_required",
    errorCode: "CONTENT_MODERATION_RETRY_FACTS_INVALID",
    attempt: 1,
    priority: "high"
  };
  assert.deepEqual(events, [
    { event: "moderation_submission_failure", fields },
    { event: "moderation_operational_alert", fields }
  ]);
  assert.deepEqual(await worker.runOnce(), { claimed: 0, failed: 0 });
});

test("idle retry worker sleeps at bounded cadence and exits after a stop signal or --once", async () => {
  let runs = 0;
  const sleeps = [];
  let stopping = false;
  const result = await runContentModerationRetryLoop({
    runOnce: async () => {
      runs += 1;
      return { claimed: 0, failed: 0 };
    },
    once: false,
    isStopping: () => stopping,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      stopping = true;
    },
    pollMs: 12_000
  });
  assert.deepEqual(result, { claimed: 0, failed: 0 });
  assert.equal(runs, 1);
  assert.deepEqual(sleeps, [12_000]);

  const onceSleeps = [];
  await runContentModerationRetryLoop({
    runOnce: async () => ({ claimed: 0, failed: 0 }),
    once: true,
    isStopping: () => false,
    sleep: async (milliseconds) => onceSleeps.push(milliseconds),
    pollMs: 12_000
  });
  assert.deepEqual(onceSleeps, []);
});

test("retry loop forwards its stop controls into the currently running batch", async () => {
  const controller = new AbortController();
  let received = null;

  await runContentModerationRetryLoop({
    once: true,
    signal: controller.signal,
    isStopping: () => controller.signal.aborted,
    runOnce: async (controls) => {
      received = controls;
      return { claimed: 0, failed: 0 };
    }
  });

  assert.equal(received.signal, controller.signal);
  assert.equal(received.isStopping(), false);
});

test("idle retry polling aborts promptly instead of waiting for the full cadence", async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  let runs = 0;
  const result = await runContentModerationRetryLoop({
    runOnce: async () => {
      runs += 1;
      setTimeout(() => controller.abort(), 10);
      return { claimed: 0, failed: 0 };
    },
    once: false,
    signal: controller.signal,
    isStopping: () => controller.signal.aborted,
    pollMs: 1_000
  });

  assert.deepEqual(result, { claimed: 0, failed: 0 });
  assert.ok(Date.now() - startedAt < 500, "abort should not wait for the one-second poll cadence");
  assert.equal(runs, 1, "abort during idle sleep must not start another moderation batch");
});

test("worker signal controller wires SIGTERM and SIGINT to an abortable stop signal", async () => {
  const { createContentModerationRetryStopController } = await import(
    "../src/jobs/content-moderation-retry.js"
  );
  assert.equal(typeof createContentModerationRetryStopController, "function");
  const handlers = new Map();
  const processRef = {
    on(signal, handler) { handlers.set(signal, handler); },
    off(signal, handler) {
      if (handlers.get(signal) === handler) handlers.delete(signal);
    }
  };
  const stop = createContentModerationRetryStopController(processRef);

  assert.equal(stop.isStopping(), false);
  handlers.get("SIGTERM")();
  assert.equal(stop.signal.aborted, true);
  assert.equal(stop.isStopping(), true);
  stop.dispose();
  assert.equal(handlers.size, 0);
});

test("production moderation retry worker has a shutdown grace period", async () => {
  const compose = await readFile(new URL("../../../docker-compose.prod.example.yml", import.meta.url), "utf8");
  assert.match(compose, /content-moderation-retry:[\s\S]*?stop_grace_period:\s*2m/);
});
