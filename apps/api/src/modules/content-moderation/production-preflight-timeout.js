import {
  buildProductionPreflightCosKey,
  getProductionPreflightCase
} from "./production-preflight-samples.js";

const CALLBACK_TIMEOUT_FAILURE = "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CALLBACK_TIMEOUT";
const GUARD_FAILURE = "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_GUARD_FAILED";

export async function runProductionPreflightTimeoutBatch({
  repository,
  cleanupObject,
  guards,
  runtime,
  runtimeFactory,
  now = () => new Date(),
  timeoutMs,
  limit
}) {
  if (typeof repository?.listTimedOutRuns !== "function" || typeof repository?.finalizeRun !== "function") {
    throw new TypeError("production preflight timeout repository is required");
  }
  if (
    typeof cleanupObject !== "function" ||
    typeof guards !== "function" ||
    typeof now !== "function" ||
    (runtimeFactory !== undefined && typeof runtimeFactory !== "function")
  ) {
    throw new TypeError("production preflight timeout dependencies are required");
  }
  const endedAt = asDate(now());
  const cutoff = new Date(endedAt.getTime() - boundedTimeout(timeoutMs));
  const runs = await repository.listTimedOutRuns({
    cutoff,
    now: endedAt,
    limit: boundedLimit(limit)
  });
  const result = { scanned: runs.length, finalized: 0, cleanupFailed: 0 };

  for (const run of runs) {
    const sample = getProductionPreflightCase(run.caseId);
    if (run.provider !== sample.provider) {
      throw new Error("production preflight timeout provider mismatch");
    }
    const currentRuntime = typeof runtimeFactory === "function"
      ? await runtimeFactory()
      : runtime;
    let failureCode = CALLBACK_TIMEOUT_FAILURE;
    try {
      guards(currentRuntime, sample.caseId, {
        configFingerprint: run.configFingerprint,
        hmacKey: currentRuntime?.referenceHmacKey
      });
    } catch {
      failureCode = GUARD_FAILURE;
    }
    const cleanupObjectForRun = sample.kind === "text"
      ? undefined
      : () => cleanupObject({
          runId: run.id,
          provider: run.provider,
          objectKey: buildProductionPreflightCosKey(run.id, sample),
          state: "failed"
        });
    const finalized = await repository.finalizeRun({
      runId: run.id,
      provider: run.provider,
      resultCategory: "error",
      failureCode,
      expectedStates: ["started", "submitting", "awaiting_callback"],
      now: endedAt,
      ...(cleanupObjectForRun ? { cleanupObject: cleanupObjectForRun } : {})
    });
    if (finalized.finalized) {
      result.finalized += 1;
      if (finalized.cleanupStatus === "cleanup_failed") result.cleanupFailed += 1;
    }
  }
  return result;
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("production preflight timeout clock is invalid");
  return date;
}

function boundedTimeout(value) {
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < 60_000 || timeout > 60 * 60 * 1000) {
    throw new TypeError("production preflight callback timeout must be between one minute and one hour");
  }
  return timeout;
}

function boundedLimit(value) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError("production preflight timeout batch size must be between 1 and 100");
  }
  return limit;
}
