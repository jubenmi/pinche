import { productionPreflightReferenceHmac } from "./production-preflight-repository.js";
import {
  buildProductionPreflightCosKey,
  getProductionPreflightCase
} from "./production-preflight-samples.js";

export async function tryHandleProductionPreflightTencentCallback({
  payload,
  runtime,
  hmacKey,
  guards,
  repository,
  cleanupObject,
  onCleanupFailure,
  requireJobAssociation = false
}) {
  const dataAttempt = payload.dataId
    ? await lookup(repository, hmacKey, "tencent_video", "data_id", payload.dataId)
    : null;
  const jobAttempt = payload.jobId
    ? await lookup(repository, hmacKey, "tencent_video", "job_id", payload.jobId)
    : null;
  const attempt = jobAttempt || dataAttempt;
  if (!attempt) {
    return { status: "miss" };
  }
  if (requireJobAssociation && payload.jobId && !jobAttempt) {
    return { status: "retry", httpStatus: 503 };
  }
  const callbackState = await preflightCallbackState(repository, attempt.runId);
  if (callbackState.status === "retry") return { status: "retry", httpStatus: 503 };
  if (callbackState.status === "handled") return { status: "handled", httpStatus: 200 };
  const guardFailureCode = preflightGuardFailure(guards, runtime, "tencent-video-v1", {
    run: callbackState.run,
    hmacKey
  });
  if (!guardFailureCode && payload.jobId && !jobAttempt) {
    await repository.recordAssociation({
      runId: attempt.runId,
      provider: "tencent_video",
      kind: "job_id",
      hmac: productionPreflightReferenceHmac({
        key: hmacKey,
        provider: "tencent_video",
        kind: "job_id",
        value: payload.jobId
      })
    });
  }
  const finalized = await finishPreflightCallbackRun(repository, {
    runId: attempt.runId,
    provider: "tencent_video",
    resultCategory: guardFailureCode ? "error" : normalizeResultCategory(payload),
    cleanupObject,
    caseId: "tencent-video-v1",
    failureCode: guardFailureCode
  });
  notifyCleanupFailure(finalized, onCleanupFailure, "tencent_video");
  return { status: "handled", httpStatus: 200 };
}

export async function tryHandleProductionPreflightWechatImageCallback({
  event,
  runtime,
  hmacKey,
  guards,
  repository,
  cleanupObject,
  onCleanupFailure
}) {
  const attempt = event.traceId
    ? await lookup(repository, hmacKey, "wechat_image", "trace_id", event.traceId)
    : null;
  if (!attempt) {
    const ordinaryAttempt = event.traceId && typeof repository.findOrdinaryWechatImageAttempt === "function"
      ? await repository.findOrdinaryWechatImageAttempt({ traceId: event.traceId })
      : null;
    if (ordinaryAttempt) return { status: "miss" };
    const hasActiveWechatImagePreflight =
      repository.hasActiveWechatImagePreflight || repository.hasAwaitingWechatImageTrace;
    if (runtime?.preflightEnabled !== false && await hasActiveWechatImagePreflight?.()) {
      return { status: "retry", httpStatus: 503 };
    }
    return { status: "miss" };
  }
  const callbackState = await preflightCallbackState(repository, attempt.runId);
  if (callbackState.status === "retry") return { status: "retry", httpStatus: 503 };
  if (callbackState.status === "handled") return { status: "handled", httpStatus: 200 };
  const guardFailureCode = preflightGuardFailure(guards, runtime, "wechat-image-v1", {
    run: callbackState.run,
    hmacKey
  });
  const finalized = await finishPreflightCallbackRun(repository, {
    runId: attempt.runId,
    provider: "wechat_image",
    resultCategory: guardFailureCode ? "error" : normalizeResultCategory(event),
    cleanupObject,
    caseId: "wechat-image-v1",
    failureCode: guardFailureCode
  });
  notifyCleanupFailure(finalized, onCleanupFailure, "wechat_image");
  return { status: "handled", httpStatus: 200 };
}

async function lookup(repository, hmacKey, provider, kind, value) {
  const hmac = productionPreflightReferenceHmac({ key: hmacKey, provider, kind, value });
  return repository.findAttemptByAssociation({ provider, kind, hmac });
}

async function preflightCallbackState(repository, runId) {
  if (typeof repository.findRun !== "function") return { status: "ready", run: null };
  const run = await repository.findRun({ runId });
  if (!run) return { status: "handled", run: null };
  if (run.state === "submitting") return { status: "retry", run };
  return run.state === "awaiting_callback"
    ? { status: "ready", run }
    : { status: "handled", run };
}

function normalizeResultCategory(payload) {
  return payload.resultCategory || payload.result?.decision || "error";
}

function preflightGuardFailure(guards, runtime, caseId, { run, hmacKey } = {}) {
  try {
    if (run) {
      guards(runtime, caseId, {
        configFingerprint: run.configFingerprint,
        hmacKey
      });
    } else {
      guards(runtime, caseId);
    }
    return null;
  } catch {
    return "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_GUARD_FAILED";
  }
}

async function finishPreflightCallbackRun(repository, {
  runId,
  provider,
  resultCategory,
  cleanupObject,
  caseId,
  failureCode = null
}) {
  return repository.finalizeRun({
    runId,
    provider,
    resultCategory,
    failureCode,
    cleanupObject: () => cleanupPreflightCallbackObject({
      runId,
      state: resultCategory === "pass" ? "passed" : "failed",
      cleanupObject,
      caseId
    })
  });
}

async function cleanupPreflightCallbackObject({ runId, state, cleanupObject, caseId }) {
  if (typeof cleanupObject !== "function") {
    return "not_required";
  }
  const sample = getProductionPreflightCase(caseId);
  const objectKey = buildProductionPreflightCosKey(runId, sample);
  await cleanupObject({ runId, provider: sample.provider, objectKey, state });
  return "deleted";
}

function notifyCleanupFailure(finalized, onCleanupFailure, provider) {
  if (finalized?.cleanupStatus !== "cleanup_failed" || typeof onCleanupFailure !== "function") return;
  try {
    Promise.resolve(onCleanupFailure({ provider })).catch(() => {});
  } catch {
    // Observability must not change the callback response or cleanup outcome.
  }
}
