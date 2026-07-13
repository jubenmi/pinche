import crypto from "node:crypto";

import { getProductionPreflightCase } from "./production-preflight-samples.js";

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
