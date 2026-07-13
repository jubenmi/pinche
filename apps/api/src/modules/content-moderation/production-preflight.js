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

export function parseProductionPreflightCliArgs(argv) {
  if (argv.length !== 1 || !argv[0].startsWith("--case=")) {
    throw new Error("production preflight accepts exactly one --case argument");
  }
  const caseId = argv[0].slice("--case=".length);
  getProductionPreflightCase(caseId);
  return { caseId };
}

export function createProductionPreflightConfigFingerprint(input) {
  const redacted = {
    release: input.release,
    provider: input.provider,
    appId: input.appId
  };
  return crypto.createHash("sha256").update(JSON.stringify(redacted)).digest("hex");
}

export function assertProductionPreflightGuards(runtime, caseId) {
  getProductionPreflightCase(caseId);
  if (runtime.nodeEnv !== "production") {
    throw new Error("production preflight requires NODE_ENV=production");
  }
  if (!runtime.preflightEnabled) {
    throw new Error("production preflight is disabled");
  }
  if (!timingSafeEqual(runtime.confirmation, runtime.expectedConfirmation)) {
    throw new Error("production preflight confirmation mismatch");
  }
  if (runtime.operatorRole !== "system_admin" || runtime.operatorStatus !== "active") {
    throw new Error("production preflight requires an active system_admin operator");
  }
  if (
    runtime.intakeModes?.text !== "closed" ||
    runtime.intakeModes?.image !== "closed" ||
    runtime.intakeModes?.video !== "closed"
  ) {
    throw new Error("production preflight intake modes must remain closed");
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
  runner.guards(runtime, caseId);
  const startedAt = runner.clock ? runner.clock() : new Date();
  const run = await runner.repository.acquireRun({
    provider: sample.provider,
    caseId: sample.caseId,
    operatorUserId: runtime.operatorUserId,
    configFingerprint: createProductionPreflightConfigFingerprint({
      release: runtime.releaseFingerprint || "d45-production-controlled-preflight",
      provider: sample.provider,
      appId: runtime.appId || ""
    }),
    assetFingerprint: `${sample.assetFingerprint}:${productionPreflightAssetSha256(sample)}`,
    now: startedAt
  });

  try {
    const result = await executeProviderCase(runner, run, sample, runtime);
    runner.guards(runtime, caseId);
    if (result.resultCategory !== "pass") {
      throw new Error(`production preflight expected pass but got ${result.resultCategory}`);
    }
    await runner.repository.finishRun({
      runId: run.id,
      state: "passed",
      resultCategory: "pass",
      cleanupStatus: result.cleanupStatus || "not_required",
      elapsedMs: elapsedMs(startedAt, runner.clock)
    });
    return { state: "passed", runId: run.id };
  } catch (error) {
    await runner.repository.finishRun({
      runId: run.id,
      state: "failed",
      resultCategory: "error",
      cleanupStatus: error.cleanupStatus || "not_required",
      elapsedMs: elapsedMs(startedAt, runner.clock),
      failureCode: error.code || "PRODUCTION_PREFLIGHT_FAILED",
      failureMessage: String(error.message || error).slice(0, 255)
    });
    throw error;
  } finally {
    await runner.repository.releaseLock({ provider: sample.provider, runId: run.id });
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

async function executeProviderCase(runner, run, sample, runtime) {
  if (sample.kind === "text") {
    const openid = await runner.userRepository.getOpenIdForUserId(
      runtime.testAdminUserId || runtime.operatorUserId
    );
    return runner.wechatClient.checkText({
      content: sample.text,
      openid,
      scene: 1,
      subjectType: 1
    });
  }
  if (sample.kind === "image") {
    return runCosBackedProviderCase(runner, run, sample, runtime, async ({ mediaUrl, openid }) => {
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
    return runCosBackedProviderCase(runner, run, sample, runtime, async ({ objectKey }) => {
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

async function runCosBackedProviderCase(runner, run, sample, runtime, providerCall) {
  const objectKey = buildProductionPreflightCosKey(run.id, sample);
  await runner.cos.putObject({
    key: objectKey,
    body: readProductionPreflightFixture(sample),
    forbidOverwrite: true
  });
  try {
    const mediaUrl = sample.kind === "image" ? await runner.cos.buildSignedUrl(objectKey) : null;
    const openid = sample.kind === "image"
      ? await runner.userRepository.getOpenIdForUserId(runtime.testAdminUserId || runtime.operatorUserId)
      : null;
    const providerResult = await providerCall({ objectKey, mediaUrl, openid });
    await cleanupPreflightObject(runner, objectKey);
    return { ...providerResult, cleanupStatus: "deleted" };
  } catch (error) {
    try {
      await cleanupPreflightObject(runner, objectKey);
    } catch (cleanupError) {
      cleanupError.cleanupStatus = "cleanup_failed";
      throw cleanupError;
    }
    throw error;
  }
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
