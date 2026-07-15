import { config } from "../config/env.js";
import { withTransaction } from "../db/mysql.js";
import { contentModeration } from "../server.js";
import * as repository from "../modules/content-moderation/repository.js";
import { MODERATION_RETRY_LEASE_MIN_MS } from "../modules/content-moderation/constants.js";
import { MODERATION_RETRY_ROUTES, runContentModerationRetryBatch } from "../modules/content-moderation/retry.js";
import { createContentModerationRetryProcessor } from "../modules/content-moderation/retry-dispatch.js";
import {
  emitAuthorPrivateRetentionSnapshot,
  emitContentModerationEvent,
  emitModerationQueueSnapshots
} from "../modules/content-moderation/telemetry.js";

function boundedPositiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

function sleepUntilAbort(milliseconds, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let timer = null;
    const finish = () => {
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener?.("abort", finish);
      resolve();
    };
    timer = setTimeout(finish, milliseconds);
    signal?.addEventListener?.("abort", finish, { once: true });
    if (signal?.aborted) finish();
  });
}

export function createContentModerationRetryStopController(processRef = process) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  for (const signal of ["SIGTERM", "SIGINT"]) processRef.on(signal, stop);

  return {
    signal: controller.signal,
    isStopping: () => controller.signal.aborted,
    dispose() {
      for (const signal of ["SIGTERM", "SIGINT"]) {
        if (typeof processRef.off === "function") processRef.off(signal, stop);
        else processRef.removeListener?.(signal, stop);
      }
    }
  };
}

export function createContentModerationRetryWorker({
  repositoryModule = repository,
  withTransactionFn = withTransaction,
  contentModerationRuntime = contentModeration,
  moderationConfig = config.contentModeration,
  now,
  randomUUID,
  random,
  emit = emitContentModerationEvent
} = {}) {
  const retryLimit = boundedPositiveInteger(moderationConfig?.retryLimit, 8, 1, 20);
  const retryBatchSize = boundedPositiveInteger(moderationConfig?.retryBatchSize, 25, 1, 100);
  const retryLeaseMs = boundedPositiveInteger(
    moderationConfig?.retryLeaseMs,
    MODERATION_RETRY_LEASE_MIN_MS,
    MODERATION_RETRY_LEASE_MIN_MS,
    300_000
  );
  const queueAlertAgeSeconds = boundedPositiveInteger(
    moderationConfig?.queueAlertAgeSeconds,
    900,
    60,
    7 * 24 * 60 * 60
  );
  const processor = createContentModerationRetryProcessor({
    repository: repositoryModule,
    withTransaction: withTransactionFn,
    contentModerationRuntime
  });

  return {
    processJob: (job) => processor.processJob(job),
    async runOnce({ signal, isStopping } = {}) {
      const result = await runContentModerationRetryBatch({
        repository: repositoryModule,
        withTransaction: withTransactionFn,
        processJob: (job) => processor.processJob(job),
        routes: MODERATION_RETRY_ROUTES,
        retryLimit,
        limit: retryBatchSize,
        leaseMs: retryLeaseMs,
        ...(typeof now === "function" ? { now } : {}),
        ...(typeof randomUUID === "function" ? { randomUUID } : {}),
        ...(typeof random === "function" ? { random } : {}),
        ...(signal ? { signal } : {}),
        ...(typeof isStopping === "function" ? { isStopping } : {}),
        emit
      });
      if (typeof repositoryModule.getModerationQueueStats === "function") {
        try {
          const snapshotAt = new Date(typeof now === "function" ? now() : Date.now());
          const rows = await withTransactionFn((connection) => repositoryModule.getModerationQueueStats(
            connection,
            { now: snapshotAt }
          ));
          emitModerationQueueSnapshots({
            telemetry: { emit },
            rows,
            alertAgeSeconds: queueAlertAgeSeconds
          });
        } catch {
          emit("moderation_operational_alert", {
            outcome: "error",
            errorCode: "CONTENT_MODERATION_QUEUE_SNAPSHOT_FAILED",
            priority: "high"
          });
        }
      }
      if (typeof repositoryModule.getAuthorPrivateRetentionStats === "function") {
        try {
          const stats = await withTransactionFn((connection) => (
            repositoryModule.getAuthorPrivateRetentionStats(connection, { longLivedDays: 30 })
          ));
          emitAuthorPrivateRetentionSnapshot({ telemetry: { emit }, stats });
        } catch {
          emit("moderation_operational_alert", {
            outcome: "error",
            errorCode: "CONTENT_MODERATION_AUTHOR_PRIVATE_RETENTION_SNAPSHOT_FAILED",
            priority: "high"
          });
        }
      }
      return result;
    }
  };
}

export async function runContentModerationRetryLoop({
  runOnce,
  once = false,
  isStopping = () => false,
  signal,
  sleep = sleepUntilAbort,
  pollMs = 30_000
} = {}) {
  if (typeof runOnce !== "function") throw new TypeError("runOnce is required");
  if (typeof isStopping !== "function" || typeof sleep !== "function") {
    throw new TypeError("worker control adapters must be functions");
  }
  const interval = boundedPositiveInteger(pollMs, 30_000, 1_000, 300_000);
  const shouldStop = () => Boolean(signal?.aborted) || isStopping();
  let result = { claimed: 0, failed: 0 };
  do {
    result = await runOnce({ signal, isStopping });
    if (once || shouldStop()) break;
    await sleep(interval, signal);
  } while (!shouldStop());
  return result;
}

export async function run({ signal, isStopping } = {}) {
  return createContentModerationRetryWorker().runOnce({ signal, isStopping });
}

async function main({ isStopping, signal } = {}) {
  const once = process.argv.includes("--once");
  const pollMs = boundedPositiveInteger(
    config.contentModeration.retryPollMs,
    30_000,
    1_000,
    300_000
  );
  return runContentModerationRetryLoop({
    runOnce: () => run({ signal, isStopping }),
    once,
    isStopping,
    signal,
    pollMs
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stop = createContentModerationRetryStopController();
  main({ isStopping: stop.isStopping, signal: stop.signal })
    .then((result) => console.log(JSON.stringify({ ok: true, ...result })))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, code: error?.code || "MODERATION_RETRY_FAILED" }));
      process.exitCode = 1;
    })
    .finally(() => stop.dispose());
}
