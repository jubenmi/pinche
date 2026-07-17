import crypto from "node:crypto";

import { productionPreflightReferenceHmac } from "./production-preflight-repository.js";
import {
  buildProductionPreflightCosKey,
  getProductionPreflightCase,
  productionPreflightAssetSha256,
  readProductionPreflightFixture
} from "./production-preflight-samples.js";

const PROVIDER_FLAGS_BY_CASE = Object.freeze({
  "wechat-text-v1": ["wechatText"],
  "wechat-image-v1": ["wechatImage", "cos", "redis", "callback"],
  "tencent-video-v1": ["tencentVideo", "cos", "callback"]
});

const WECHAT_TEXT_RESULT_CATEGORY_BY_SUGGESTION = Object.freeze({
  pass: "pass",
  review: "review",
  risky: "block"
});

export function parseProductionPreflightCliArgs(argv) {
  if (argv.length !== 1 || !argv[0].startsWith("--case=")) {
    throw new Error("production preflight accepts exactly one --case argument");
  }
  const caseId = argv[0].slice("--case=".length);
  getProductionPreflightCase(caseId);
  return { caseId };
}

export function createProductionPreflightConfigFingerprint(input) {
  const confirmationProof = productionPreflightConfirmationProof({
    confirmation: input.confirmation,
    hmacKey: input.hmacKey
  });
  const redacted = {
    release: input.release,
    provider: input.provider,
    appId: input.appId,
    confirmationProof
  };
  return crypto.createHash("sha256").update(JSON.stringify(redacted)).digest("hex");
}

export function assertProductionPreflightGuards(runtime, caseId, options = {}) {
  const sample = getProductionPreflightCase(caseId);
  if (runtime.nodeEnv !== "production") {
    throw new Error("production preflight requires NODE_ENV=production");
  }
  if (!runtime.preflightEnabled) {
    throw new Error("production preflight is disabled");
  }
  if (Object.hasOwn(options, "configFingerprint")) {
    const expectedFingerprint = createProductionPreflightConfigFingerprint({
      release: runtime.releaseFingerprint || "d45-production-controlled-preflight",
      provider: sample.provider,
      appId: runtime.appId || "",
      confirmation: runtime.expectedConfirmation,
      hmacKey: options.hmacKey
    });
    if (!timingSafeEqual(options.configFingerprint, expectedFingerprint)) {
      throw new Error("production preflight confirmation mismatch");
    }
  } else if (!timingSafeEqual(runtime.confirmation, runtime.expectedConfirmation)) {
    throw new Error("production preflight confirmation mismatch");
  }
  if (runtime.operatorRole !== "system_admin" || runtime.operatorStatus !== "active") {
    throw new Error("production preflight requires an active system_admin operator");
  }
  const requiredFlags = PROVIDER_FLAGS_BY_CASE[caseId];
  if (requiredFlags.some((flag) => !runtime.providerConfig?.[flag])) {
    throw new Error("production preflight target provider config is incomplete");
  }
}

export function createProductionPreflightRunner(dependencies) {
  return Object.freeze({ ...dependencies });
}

export async function runProductionPreflightCase(runner, { caseId, runtime }) {
  const sample = getProductionPreflightCase(caseId);
  const initialRuntime = await assertCurrentPreflightGuards(runner, runtime, caseId);
  const startedAt = runner.clock ? runner.clock() : new Date();
  const run = await runner.repository.acquireRun({
    provider: sample.provider,
    caseId: sample.caseId,
    operatorUserId: initialRuntime.operatorUserId,
    configFingerprint: createProductionPreflightConfigFingerprint({
      release: initialRuntime.releaseFingerprint || "d45-production-controlled-preflight",
      provider: sample.provider,
      appId: initialRuntime.appId || "",
      confirmation: initialRuntime.confirmation,
      hmacKey: runner.hmacKey
    }),
    assetFingerprint: `${sample.assetFingerprint}:${productionPreflightAssetSha256(sample)}`,
    now: startedAt
  });

  const execution = { objectKey: null };
  const cleanupFailureAlert = { sent: false };
  try {
    const markedSubmitting = await runner.repository.markSubmitting({ runId: run.id });
    if (!markedSubmitting) {
      throw new Error("production preflight submission state transition failed");
    }
    const result = await executeProviderCase(runner, run, sample, runtime, execution);
    await assertCurrentPreflightGuards(runner, runtime, caseId);
    if (result.awaitingCallback) {
      const markedAwaitingCallback = await runner.repository.markAwaitingCallback({
        runId: run.id,
        resultCategory: "submitted",
        cleanupStatus: "pending",
        elapsedMs: elapsedMs(startedAt, runner.clock)
      });
      if (!markedAwaitingCallback) {
        throw new Error("production preflight awaiting callback state transition failed");
      }
      return { state: "awaiting_callback", runId: run.id };
    }
    if (result.resultCategory !== "pass") {
      const error = new Error(`production preflight expected pass but got ${result.resultCategory}`);
      error.resultCategory = result.resultCategory;
      throw error;
    }
    const finalized = await finalizePreflightRunAndNotify(runner, {
      runId: run.id,
      provider: sample.provider,
      resultCategory: "pass",
      expectedStates: ["submitting"],
      now: runner.clock ? runner.clock() : new Date(),
      ...preflightCleanupInput(runner, execution.objectKey)
    }, sample.provider, cleanupFailureAlert);
    if (!finalized?.finalized || finalized.state !== "passed" || finalized.resultCategory !== "pass") {
      const error = new Error("production preflight completion finalization failed");
      error.code = finalized?.cleanupStatus === "cleanup_failed"
        ? "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CLEANUP_FAILED"
        : "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_FINALIZATION_FAILED";
      throw error;
    }
    return { state: "passed", runId: run.id };
  } catch (error) {
    await finalizePreflightRunAndNotify(runner, {
      runId: run.id,
      provider: sample.provider,
      resultCategory: error.resultCategory || "error",
      expectedStates: ["started", "submitting"],
      now: runner.clock ? runner.clock() : new Date(),
      failureCode: error.code || "PRODUCTION_PREFLIGHT_FAILED",
      ...preflightCleanupInput(runner, execution.objectKey)
    }, sample.provider, cleanupFailureAlert);
    throw error;
  }
}

function timingSafeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || right.length < 32) {
    return false;
  }
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function productionPreflightConfirmationProof({ confirmation, hmacKey }) {
  if (typeof confirmation !== "string" || confirmation.length === 0) return "";
  if (typeof hmacKey !== "string" || hmacKey.length < 32) return "";
  return crypto
    .createHmac("sha256", hmacKey)
    .update(`production-preflight-confirmation:${confirmation}`, "utf8")
    .digest("hex");
}

async function executeProviderCase(runner, run, sample, runtime, execution) {
  if (sample.kind === "text") {
    const currentRuntime = await assertCurrentPreflightGuards(runner, runtime, sample.caseId);
    const openid = await runner.userRepository.getOpenIdForUserId(
      currentRuntime.testAdminUserId || currentRuntime.operatorUserId
    );
    await assertCurrentPreflightGuards(runner, runtime, sample.caseId);
    const providerResult = await runner.wechatClient.checkText({
      content: sample.text,
      openid,
      scene: 1,
      subjectType: 1
    });
    return {
      ...providerResult,
      resultCategory: normalizeWechatTextResultCategory(providerResult)
    };
  }
  if (sample.kind === "image") {
    return runCosBackedProviderCase(runner, run, sample, runtime, execution, async ({
      mediaUrl,
      openid,
      assertExternalOutbound
    }) => {
      await assertExternalOutbound();
      const providerResult = await runner.wechatClient.checkImage({
        mediaUrl,
        openid,
        scene: 1,
        subjectType: 1
      });
      await runner.repository.recordAssociation({
        runId: run.id,
        provider: sample.provider,
        kind: "trace_id",
        hmac: productionPreflightReferenceHmac({
          key: runner.hmacKey,
          provider: sample.provider,
          kind: "trace_id",
          value: providerResult.traceId
        })
      });
      return providerResult;
    });
  }
  if (sample.kind === "video") {
    return runCosBackedProviderCase(runner, run, sample, runtime, execution, async ({
      objectKey,
      assertExternalOutbound
    }) => {
      const dataId = run.id;
      await runner.repository.recordAssociation({
        runId: run.id,
        provider: sample.provider,
        kind: "data_id",
        hmac: productionPreflightReferenceHmac({
          key: runner.hmacKey,
          provider: sample.provider,
          kind: "data_id",
          value: dataId
        })
      });
      await assertExternalOutbound();
      const providerResult = await runner.tencentVideoClient.submitProductionPreflightVideo({
        runId: run.id,
        objectKey,
        dataId
      });
      if (providerResult.jobId || providerResult.JobId) {
        await runner.repository.recordAssociation({
          runId: run.id,
          provider: sample.provider,
          kind: "job_id",
          hmac: productionPreflightReferenceHmac({
            key: runner.hmacKey,
            provider: sample.provider,
            kind: "job_id",
            value: providerResult.jobId || providerResult.JobId
          })
        });
      }
      return providerResult;
    });
  }
  throw new Error(`unsupported production preflight sample kind: ${sample.kind}`);
}

function normalizeWechatTextResultCategory(result) {
  const suggestion = String(result?.suggestion || "").trim().toLowerCase();
  return WECHAT_TEXT_RESULT_CATEGORY_BY_SUGGESTION[suggestion] || "error";
}

async function runCosBackedProviderCase(runner, run, sample, runtime, execution, providerCall) {
  const objectKey = buildProductionPreflightCosKey(run.id, sample);
  await assertCurrentPreflightGuards(runner, runtime, sample.caseId);
  await runner.cos.putObject({
    key: objectKey,
    body: readProductionPreflightFixture(sample),
    forbidOverwrite: true
  });
  execution.objectKey = objectKey;
  const currentRuntime = await assertCurrentPreflightGuards(runner, runtime, sample.caseId);
  const mediaUrl = sample.kind === "image" ? await runner.cos.buildSignedUrl(objectKey) : null;
  const openid = sample.kind === "image"
    ? await runner.userRepository.getOpenIdForUserId(
        currentRuntime.testAdminUserId || currentRuntime.operatorUserId
      )
    : null;
  const providerResult = await providerCall({
    objectKey,
    mediaUrl,
    openid,
    assertExternalOutbound: () => assertCurrentPreflightGuards(runner, runtime, sample.caseId)
  });
  if (!providerResult.resultCategory && isAsyncSubmissionResult(sample, providerResult)) {
    return { awaitingCallback: true };
  }
  return providerResult;
}

function preflightCleanupInput(runner, objectKey) {
  if (!objectKey) return {};
  return {
    cleanupObject: () => cleanupPreflightObject(runner, objectKey)
  };
}

async function finalizePreflightRunAndNotify(runner, input, provider, cleanupFailureAlert) {
  const finalized = await runner.repository.finalizeRun(input);
  if (
    !cleanupFailureAlert.sent &&
    finalized?.cleanupStatus === "cleanup_failed" &&
    typeof runner.onCleanupFailure === "function"
  ) {
    cleanupFailureAlert.sent = true;
    try {
      await runner.onCleanupFailure({ provider });
    } catch {
      // Observability must not change the preflight terminal state or CLI result.
    }
  }
  return finalized;
}

async function assertCurrentPreflightGuards(runner, runtime, caseId) {
  const currentRuntime = typeof runner.refreshRuntime === "function"
    ? await runner.refreshRuntime(runtime)
    : runtime;
  runner.guards(currentRuntime, caseId);
  return currentRuntime;
}

function isAsyncSubmissionResult(sample, providerResult) {
  if (!providerResult || typeof providerResult !== "object") {
    return false;
  }
  if (sample.kind === "image") {
    return Boolean(providerResult.traceId);
  }
  if (sample.kind === "video") {
    return Boolean(providerResult.JobId || providerResult.jobId);
  }
  return false;
}

async function cleanupPreflightObject(runner, objectKey) {
  await runner.cos.deleteObject(objectKey);
  try {
    await runner.cos.headObject(objectKey);
  } catch (error) {
    if (error.code === "COS_OBJECT_NOT_FOUND") {
      return;
    }
    throw error;
  }
  const error = new Error("production preflight cleanup verification failed");
  error.cleanupStatus = "cleanup_failed";
  throw error;
}

function elapsedMs(startedAt, clock) {
  const endedAt = clock ? clock() : new Date();
  return Math.max(0, endedAt.getTime() - startedAt.getTime());
}
