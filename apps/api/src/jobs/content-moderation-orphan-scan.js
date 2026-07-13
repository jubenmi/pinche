import { config } from "../config/env.js";
import { withTransaction } from "../db/mysql.js";
import {
  runContentModerationOrphanScanBatch
} from "../modules/content-moderation/orphan-scan.js";
import * as repository from "../modules/content-moderation/repository.js";
import { emitContentModerationEvent } from "../modules/content-moderation/telemetry.js";
import { deleteCosObject, headCosObject, listCosObjects } from "../storage/cos.js";

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

function emptyScanResult(disabled = false) {
  return {
    ...(disabled ? { disabled: true } : {}),
    cos: { scanned: 0, candidates: 0, deleted: 0 },
    media: { scanned: 0, inconsistencies: 0 },
    jobs: { scanned: 0, inconsistencies: 0 }
  };
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

export function createContentModerationOrphanScanStopController(processRef = process) {
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

export function createContentModerationOrphanScanWorker({
  repositoryModule = repository,
  withTransactionFn = withTransaction,
  moderationConfig = config.contentModeration,
  storage,
  emit = emitContentModerationEvent,
  now,
  randomUUID
} = {}) {
  const enabled = moderationConfig?.orphanScanEnabled === true;
  const cleanupEnabled = moderationConfig?.orphanCleanupEnabled === true;
  const limit = boundedInteger(moderationConfig?.orphanScanBatchSize, 100, 1, 1000);
  const retentionHours = boundedInteger(moderationConfig?.orphanRetentionHours, 48, 24, 30 * 24);
  const runtimeStorage = storage || {
    list: (input) => listCosObjects({ ...input, config: config.cos }),
    head: (key) => headCosObject({ key, config: config.cos }),
    delete: (key) => deleteCosObject({ key, config: config.cos })
  };
  return {
    async runOnce() {
      if (!enabled) return emptyScanResult(true);
      return runContentModerationOrphanScanBatch({
        repository: repositoryModule,
        storage: runtimeStorage,
        withTransaction: withTransactionFn,
        emit,
        ...(typeof now === "function" ? { now } : {}),
        ...(typeof randomUUID === "function" ? { randomUUID } : {}),
        limit,
        retentionMs: retentionHours * 60 * 60 * 1000,
        cleanupEnabled
      });
    }
  };
}

export async function runContentModerationOrphanScanLoop({
  runOnce,
  once = false,
  isStopping = () => false,
  signal,
  sleep = sleepUntilAbort,
  pollMs = 300_000
} = {}) {
  if (typeof runOnce !== "function" || typeof isStopping !== "function" || typeof sleep !== "function") {
    throw new TypeError("orphan scan worker adapters must be functions");
  }
  const interval = boundedInteger(pollMs, 300_000, 60_000, 24 * 60 * 60 * 1000);
  const shouldStop = () => Boolean(signal?.aborted) || isStopping();
  let result = emptyScanResult();
  do {
    result = await runOnce();
    if (once || shouldStop()) break;
    await sleep(interval, signal);
  } while (!shouldStop());
  return result;
}

export async function run({ signal, isStopping } = {}) {
  return createContentModerationOrphanScanWorker().runOnce({ signal, isStopping });
}

async function main({ signal, isStopping } = {}) {
  const once = process.argv.includes("--once");
  const pollMs = boundedInteger(
    config.contentModeration.orphanScanPollMs,
    300_000,
    60_000,
    24 * 60 * 60 * 1000
  );
  return runContentModerationOrphanScanLoop({
    runOnce: () => run({ signal, isStopping }),
    once,
    signal,
    isStopping,
    pollMs
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stop = createContentModerationOrphanScanStopController();
  main({ signal: stop.signal, isStopping: stop.isStopping })
    .then((result) => console.log(JSON.stringify({ ok: true, ...result })))
    .catch((error) => {
      emitContentModerationEvent("moderation_operational_alert", {
        outcome: "scan_failed",
        errorCode: "CONTENT_MODERATION_ORPHAN_SCAN_FAILED",
        priority: "high"
      });
      console.error(JSON.stringify({ ok: false, code: "CONTENT_MODERATION_ORPHAN_SCAN_FAILED" }));
      process.exitCode = 1;
    })
    .finally(() => stop.dispose());
}
