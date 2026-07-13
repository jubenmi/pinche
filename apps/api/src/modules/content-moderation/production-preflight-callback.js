import { productionPreflightReferenceHmac } from "./production-preflight-repository.js";

export async function tryHandleProductionPreflightTencentCallback({
  payload,
  runtime,
  hmacKey,
  guards,
  repository,
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
  guards(runtime, "tencent-video-v1");
  if (payload.jobId && !jobAttempt) {
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
  await finishPreflightCallbackRun(repository, {
    runId: attempt.runId,
    provider: "tencent_video",
    resultCategory: normalizeResultCategory(payload)
  });
  return { status: "handled", httpStatus: 200 };
}

export async function tryHandleProductionPreflightWechatImageCallback({
  event,
  runtime,
  hmacKey,
  guards,
  repository
}) {
  const attempt = event.traceId
    ? await lookup(repository, hmacKey, "wechat_image", "trace_id", event.traceId)
    : null;
  if (!attempt) {
    if (await repository.hasAwaitingWechatImageTrace?.()) {
      return { status: "retry", httpStatus: 503 };
    }
    return { status: "miss" };
  }
  guards(runtime, "wechat-image-v1");
  await finishPreflightCallbackRun(repository, {
    runId: attempt.runId,
    provider: "wechat_image",
    resultCategory: normalizeResultCategory(event)
  });
  return { status: "handled", httpStatus: 200 };
}

async function lookup(repository, hmacKey, provider, kind, value) {
  const hmac = productionPreflightReferenceHmac({ key: hmacKey, provider, kind, value });
  return repository.findAttemptByAssociation({ provider, kind, hmac });
}

function normalizeResultCategory(payload) {
  return payload.resultCategory || payload.result?.decision || "error";
}

async function finishPreflightCallbackRun(repository, { runId, provider, resultCategory }) {
  const state = resultCategory === "pass" ? "passed" : "failed";
  await repository.finishRun({
    runId,
    state,
    resultCategory,
    cleanupStatus: "not_required",
    elapsedMs: 0,
    failureCode: state === "passed" ? null : "PRODUCTION_PREFLIGHT_NON_PASS",
    failureMessage: state === "passed" ? null : `provider returned ${resultCategory}`
  });
  await repository.releaseLock({ provider, runId });
}
