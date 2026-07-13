import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "fixtures");
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const PRODUCTION_PREFLIGHT_CASES = Object.freeze({
  "wechat-text-v1": Object.freeze({
    caseId: "wechat-text-v1",
    provider: "wechat_text",
    kind: "text",
    text: "内容安全生产预演样本 v1",
    assetFingerprint: "text-v1"
  }),
  "wechat-image-v1": Object.freeze({
    caseId: "wechat-image-v1",
    provider: "wechat_image",
    kind: "image",
    filename: "production-preflight-image-v1.png",
    cosFilename: "image-v1.png",
    assetFingerprint: "image-v1"
  }),
  "tencent-video-v1": Object.freeze({
    caseId: "tencent-video-v1",
    provider: "tencent_video",
    kind: "video",
    filename: "production-preflight-video-v1.mp4",
    cosFilename: "video-v1.mp4",
    assetFingerprint: "video-v1"
  })
});

export function getProductionPreflightCase(caseId, callerPayload = undefined) {
  if (callerPayload && Object.keys(callerPayload).length > 0) {
    throw new Error("caller supplied preflight content is forbidden");
  }
  const sample = PRODUCTION_PREFLIGHT_CASES[caseId];
  if (!sample) {
    throw new Error(`unsupported production preflight case: ${caseId}`);
  }
  return sample;
}

export function buildProductionPreflightCosKey(runId, sample) {
  validateProductionPreflightRunId(runId);
  if (!["image-v1.png", "video-v1.mp4"].includes(sample.cosFilename)) {
    throw new Error("invalid production preflight fixture filename");
  }
  return `system/content-moderation-preflight/${runId}/${sample.cosFilename}`;
}

export function validateProductionPreflightRunId(runId) {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error("invalid production preflight run id");
  }
  return true;
}

export function validateProductionPreflightCosKey(runId, key) {
  validateProductionPreflightRunId(runId);
  const allowed = new Set([
    `system/content-moderation-preflight/${runId}/image-v1.png`,
    `system/content-moderation-preflight/${runId}/video-v1.mp4`
  ]);
  if (!allowed.has(key)) {
    throw new Error("invalid production preflight COS key");
  }
  return true;
}

export function readProductionPreflightFixture(sample) {
  if (sample.kind === "text") {
    return Buffer.from(sample.text, "utf8");
  }
  return fs.readFileSync(path.join(FIXTURE_DIR, sample.filename));
}

export function productionPreflightAssetSha256(sample) {
  return crypto.createHash("sha256").update(readProductionPreflightFixture(sample)).digest("hex");
}
