import { config } from "../config/env.js";
import { withDatabaseConnection } from "../db/mysql.js";
import { assertProductionPreflightGuards } from "../modules/content-moderation/production-preflight.js";
import {
  finalizeProductionPreflightRun,
  listTimedOutProductionPreflightRuns
} from "../modules/content-moderation/production-preflight-repository.js";
import { runProductionPreflightTimeoutBatch } from "../modules/content-moderation/production-preflight-timeout.js";
import { emitContentModerationEvent } from "../modules/content-moderation/telemetry.js";
import { deleteCosObject, headCosObject } from "../storage/cos.js";

function boundedInteger(value, fallback, minimum, maximum) {
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

export function createContentModerationProductionPreflightTimeoutStopController(processRef = process) {
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

export function createContentModerationProductionPreflightTimeoutWorker({
  repository,
  withDatabaseConnectionFn = withDatabaseConnection,
  moderationConfig = config.contentModeration,
  storage,
  guards = assertProductionPreflightGuards,
  runtimeFactory,
  emit = emitContentModerationEvent,
  now
} = {}) {
  const preflight = moderationConfig?.productionPreflight || {};
  const timeoutMs = boundedInteger(preflight.callbackTimeoutMs, 15 * 60 * 1000, 60_000, 60 * 60 * 1000);
  const limit = boundedInteger(preflight.timeoutBatchSize, 10, 1, 100);
  const runtimeRepository = repository || {
    listTimedOutRuns: (input) =>
      withDatabaseConnectionFn((connection) =>
        listTimedOutProductionPreflightRuns({ connection, ...input })
      ),
    finalizeRun: (input) =>
      withDatabaseConnectionFn((connection) =>
        finalizeProductionPreflightRun({ connection, ...input })
      )
  };
  const runtimeStorage = storage || {
    delete: (key) => deleteCosObject({ key, config: config.cos }),
    head: (key) => headCosObject({ key, config: config.cos })
  };
  const resolveRuntime = runtimeFactory || (() => buildProductionPreflightTimeoutRuntime({
    moderationConfig,
    withDatabaseConnectionFn
  }));

  return {
    async runOnce() {
      const result = await runProductionPreflightTimeoutBatch({
        repository: runtimeRepository,
        cleanupObject: (input) => cleanupPreflightObject(runtimeStorage, input.objectKey),
        guards,
        runtimeFactory: resolveRuntime,
        ...(typeof now === "function" ? { now } : {}),
        timeoutMs,
        limit
      });
      if (result.cleanupFailed > 0) {
        try {
          emit("moderation_operational_alert", {
            outcome: "error",
            errorCode: "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CLEANUP_FAILED",
            priority: "high"
          });
        } catch {
          // Observability must not change the preflight timeout result.
        }
      }
      return result;
    }
  };
}

export async function runContentModerationProductionPreflightTimeoutLoop({
  runOnce,
  once = false,
  isStopping = () => false,
  signal,
  sleep = sleepUntilAbort,
  pollMs = 60_000
} = {}) {
  if (typeof runOnce !== "function" || typeof isStopping !== "function" || typeof sleep !== "function") {
    throw new TypeError("production preflight timeout worker adapters must be functions");
  }
  const interval = boundedInteger(pollMs, 60_000, 10_000, 300_000);
  const shouldStop = () => Boolean(signal?.aborted) || isStopping();
  let result = { scanned: 0, finalized: 0, cleanupFailed: 0 };
  do {
    result = await runOnce();
    if (once || shouldStop()) break;
    await sleep(interval, signal);
  } while (!shouldStop());
  return result;
}

export async function run({ signal, isStopping } = {}) {
  return createContentModerationProductionPreflightTimeoutWorker().runOnce({ signal, isStopping });
}

async function buildProductionPreflightTimeoutRuntime({ moderationConfig, withDatabaseConnectionFn }) {
  const operatorUserId = Number(moderationConfig?.productionPreflight?.operatorUserId || 0);
  const operatorStatus = await withDatabaseConnectionFn(async (connection) => {
    const [rows] = await connection.query(
      "SELECT role, status FROM user_roles WHERE user_id = ? AND role = 'system_admin' LIMIT 1",
      [operatorUserId]
    );
    const row = rows[0];
    return row?.role === "system_admin" && row?.status === "active" ? "active" : "missing";
  });
  return {
    nodeEnv: moderationConfig?.nodeEnv,
    preflightEnabled: Boolean(moderationConfig?.productionPreflight?.enabled),
    confirmation: "",
    expectedConfirmation: moderationConfig?.productionPreflight?.confirmation || "",
    operatorUserId,
    operatorRole: "system_admin",
    operatorStatus,
    intakeModes: {
      text: moderationConfig?.textIntakeMode,
      image: moderationConfig?.imageIntakeMode,
      video: moderationConfig?.videoIntakeMode
    },
    providerConfig: {
      wechatText: Boolean(moderationConfig?.wechatTextEnabled && moderationConfig?.wechatAppId && moderationConfig?.wechatAppSecret),
      wechatImage: Boolean(moderationConfig?.wechatImageEnabled && moderationConfig?.wechatAppId && moderationConfig?.wechatAppSecret),
      tencentVideo: Boolean(moderationConfig?.tencentVideoEnabled && moderationConfig?.tencentVideoPolicyId),
      cos: Boolean(moderationConfig?.cosEnabled && moderationConfig?.bucket && moderationConfig?.cosRegion),
      redis: Boolean(moderationConfig?.redisEnabled && (moderationConfig?.redisUrl || moderationConfig?.redisHost)),
      callback: Boolean(moderationConfig?.tencentVideoCallbackToken || moderationConfig?.wechatEventToken)
    },
    referenceHmacKey: moderationConfig?.productionPreflight?.referenceHmacKey,
    releaseFingerprint: moderationConfig?.productionPreflight?.releaseFingerprint,
    appId: moderationConfig?.wechatAppId
  };
}

async function cleanupPreflightObject(storage, objectKey) {
  await storage.delete(objectKey);
  try {
    await storage.head(objectKey);
  } catch (error) {
    if (error?.code === "COS_OBJECT_NOT_FOUND") return;
    throw error;
  }
  throw new Error("production preflight cleanup verification failed");
}

async function main({ signal, isStopping } = {}) {
  const once = process.argv.includes("--once");
  const pollMs = boundedInteger(
    config.contentModeration?.productionPreflight?.timeoutPollMs,
    60_000,
    10_000,
    300_000
  );
  return runContentModerationProductionPreflightTimeoutLoop({
    runOnce: () => run({ signal, isStopping }),
    once,
    signal,
    isStopping,
    pollMs
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stop = createContentModerationProductionPreflightTimeoutStopController();
  main({ signal: stop.signal, isStopping: stop.isStopping })
    .then((result) => console.log(JSON.stringify({ ok: true, ...result })))
    .catch(() => {
      emitContentModerationEvent("moderation_operational_alert", {
        outcome: "error",
        errorCode: "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TIMEOUT_WORKER_FAILED",
        priority: "high"
      });
      console.error(JSON.stringify({ ok: false, code: "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TIMEOUT_WORKER_FAILED" }));
      process.exitCode = 1;
    })
    .finally(() => stop.dispose());
}
