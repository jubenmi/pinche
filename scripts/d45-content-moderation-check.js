import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

const [
  rootPackageRaw,
  apiPackageRaw,
  migrationRunner,
  migration24,
  migration28,
  migration29,
  moderationEnv,
  preflightJob,
  preflightTimeoutJob,
  moderationIntakeGate,
  albumImageUploadService,
  coreService,
  sharedAlbumMedia,
  server,
  compose,
  runbook,
  productionEnvExample
] = await Promise.all([
  text("package.json"),
  text("apps/api/package.json"),
  text("apps/api/src/db/migrate.js"),
  text("apps/api/migrations/0024_content_moderation.sql"),
  text("apps/api/migrations/0028_content_moderation_orphan_scan_state.sql"),
  text("apps/api/migrations/0029_content_moderation_production_preflight.sql"),
  text("apps/api/src/config/env.js"),
  text("apps/api/src/jobs/content-moderation-production-preflight.js"),
  text("apps/api/src/jobs/content-moderation-production-preflight-timeout.js"),
  text("apps/api/src/modules/content-moderation/intake-gate.js"),
  text("apps/api/src/modules/album-image/upload-service.js"),
  text("apps/api/src/modules/core/service.js"),
  text("packages/shared/src/albumMedia.js"),
  text("apps/api/src/server.js"),
  text("docker-compose.prod.example.yml"),
  text("docs/runbooks/hybrid-content-moderation-release.md"),
  text(".env.production.example")
]);

const rootPackage = JSON.parse(rootPackageRaw);
const apiPackage = JSON.parse(apiPackageRaw);

for (const migration of [
  "0024_content_moderation.sql",
  "0025_content_moderation_provider_attempts.sql",
  "0026_content_moderation_text_proposal_result.sql",
  "0027_content_moderation_retry_exhaustion.sql",
  "0028_content_moderation_orphan_scan_state.sql",
  "0029_content_moderation_production_preflight.sql"
]) {
  assert.equal((await text(`apps/api/migrations/${migration}`)).length > 0, true, `missing migration file: ${migration}`);
}
assert.match(migrationRunner, /fs\.readdir\(migrationsDir/);
assert.match(migrationRunner, /migrationFiles\(\)/);
assert.match(migration24, /content_moderation_jobs/);
assert.match(migration28, /content_moderation_orphan_scan_state/);
assert.match(migration29, /content_moderation_production_preflight_runs/);
assert.match(migration29, /content_moderation_production_preflight_attempts/);
assert.match(migration29, /content_moderation_production_preflight_provider_locks/);

for (const key of [
  "CONTENT_MODERATION_WECHAT_TEXT_ENABLED",
  "CONTENT_MODERATION_WECHAT_IMAGE_ENABLED",
  "CONTENT_MODERATION_TENCENT_VIDEO_ENABLED",
  "CONTENT_MODERATION_TEXT_INTAKE_MODE",
  "CONTENT_MODERATION_IMAGE_INTAKE_MODE",
  "CONTENT_MODERATION_VIDEO_INTAKE_MODE",
  "CONTENT_MODERATION_ORPHAN_SCAN_ENABLED",
  "CONTENT_MODERATION_ORPHAN_CLEANUP_ENABLED",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CALLBACK_TIMEOUT_MS",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TIMEOUT_POLL_MS",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TIMEOUT_BATCH_SIZE"
]) {
  assert.equal(moderationEnv.includes(key), true, `missing moderation config: ${key}`);
}
assert.match(moderationEnv, /orphanCleanupEnabled && !moderationConfig\.orphanScanEnabled/);
assert.doesNotMatch(moderationEnv, /TENCENT_TMS|TENCENT_CI_IMAGE/);
assert.match(moderationIntakeGate, /CONTENT_MODERATION_INTAKE_CLOSED/);
assert.match(moderationIntakeGate, /fallback_blocked/);
assert.match(albumImageUploadService, /function assertImageIntake/);
for (const type of ["text", "image", "video"]) {
  assert.match(
    server,
    new RegExp(`resolveContentSecurityIntake\\("${type}"\\)`)
  );
}
assert.doesNotMatch(server, /assertContentModerationIntake\(/);
assert.match(coreService, /const assertVideoIntake = options\.assertVideoIntake/);
assert.match(productionEnvExample, /CONTENT_MODERATION_ENABLED=true/);
for (const mode of [
  "CONTENT_MODERATION_TEXT_INTAKE_MODE=legacy",
  "CONTENT_MODERATION_IMAGE_INTAKE_MODE=legacy",
  "CONTENT_MODERATION_VIDEO_INTAKE_MODE=legacy"
]) {
  assert.equal(productionEnvExample.includes(mode), true, `missing production intake default: ${mode}`);
}

assert.match(coreService, /import \{ isModerationPublished \} from "@pinche\/shared"/);
assert.match(sharedAlbumMedia, /export function isModerationPublished\(status\)/);
for (const getter of [
  "getVisibleSessionAlbumPhotoForMedia",
  "getPublicSessionAlbumPhotoForMedia",
  "getVisibleSessionAlbumVideoForPlayback",
  "getPublicSessionAlbumVideoCoverForMedia"
]) {
  const start = coreService.indexOf(`export async function ${getter}`);
  const next = coreService.indexOf("\nexport async function ", start + 10);
  assert.notEqual(start, -1, `missing media getter: ${getter}`);
  assert.match(coreService.slice(start, next === -1 ? undefined : next), /isModerationPublished\(/);
}
assert.match(server, /\/api\/internal\/content-moderation\/wechat-image\/callback/);
assert.match(server, /\/api\/internal\/content-moderation\/tencent-video\/callback/);
assert.match(server, /tryHandleProductionPreflightTencentCallback/);
assert.match(server, /tryHandleProductionPreflightWechatImageCallback/);
assert.doesNotMatch(server, /\/api\/(?:admin\/)?content-moderation\/preflight/);

assert.equal(apiPackage.scripts["job:content-moderation-retry"], "node src/jobs/content-moderation-retry.js");
assert.equal(apiPackage.scripts["job:content-moderation-orphan-scan"], "node src/jobs/content-moderation-orphan-scan.js");
assert.equal(apiPackage.scripts["job:content-moderation-production-preflight"], "node src/jobs/content-moderation-production-preflight.js");
assert.equal(
  apiPackage.scripts["job:content-moderation-production-preflight-timeout"],
  "node src/jobs/content-moderation-production-preflight-timeout.js"
);
assert.match(preflightJob, /parseProductionPreflightCliArgs/);
assert.doesNotMatch(preflightJob, /server\.js/);
const preflightRuntimeStart = preflightJob.indexOf(
  "export async function buildProductionPreflightRuntime"
);
const preflightRuntimeEnd = preflightJob.indexOf(
  "function bindProductionPreflightRepository",
  preflightRuntimeStart
);
assert.notEqual(preflightRuntimeStart, -1, "missing production preflight runtime builder");
assert.notEqual(preflightRuntimeEnd, -1, "missing production preflight runtime builder boundary");
const preflightRuntime = preflightJob.slice(preflightRuntimeStart, preflightRuntimeEnd);
for (const prerequisite of [
  "redisEnabled",
  "wechatAppId",
  "wechatAppSecret",
  "wechatEventToken",
  "wechatEventAesKey",
  "cosEnabled",
  "secretId",
  "secretKey",
  "tencentVideoRegion",
  "tencentVideoPolicyId",
  "tencentVideoCallbackUrl",
  "tencentVideoCallbackToken"
]) {
  assert.equal(
    preflightRuntime.includes(prerequisite),
    true,
    `production preflight runtime missing raw prerequisite: ${prerequisite}`
  );
}
for (const businessSwitch of [
  "wechatTextEnabled",
  "wechatImageEnabled",
  "tencentVideoEnabled"
]) {
  assert.equal(
    preflightRuntime.includes(businessSwitch),
    false,
    `production preflight runtime must not depend on business switch: ${businessSwitch}`
  );
}
const callbackRuntimeStart = server.indexOf(
  "async function buildProductionPreflightCallbackRuntime"
);
const callbackRuntimeEnd = server.indexOf(
  "async function applyApprovedTextProposal",
  callbackRuntimeStart
);
assert.notEqual(callbackRuntimeStart, -1, "missing production preflight callback runtime builder");
assert.notEqual(callbackRuntimeEnd, -1, "missing production preflight callback runtime boundary");
const callbackRuntime = server.slice(callbackRuntimeStart, callbackRuntimeEnd);
assert.match(callbackRuntime, /buildProductionPreflightRuntime\(/);
for (const businessSwitch of [
  "wechatTextEnabled",
  "wechatImageEnabled",
  "tencentVideoEnabled"
]) {
  assert.equal(
    callbackRuntime.includes(businessSwitch),
    false,
    `production preflight callback runtime must not depend on business switch: ${businessSwitch}`
  );
}
assert.match(
  moderationEnv,
  /const wechatConfigurationRequired = Boolean\([\s\S]*?wechatModerationEnabled \|\| productionPreflightEnabled/
);
assert.match(
  moderationEnv,
  /const tencentVideoConfigurationRequired = Boolean\([\s\S]*?tencentVideoEnabled \|\| productionPreflightEnabled/
);
assert.match(preflightTimeoutJob, /runProductionPreflightTimeoutBatch/);
assert.doesNotMatch(preflightTimeoutJob, /server\.js/);
const timeoutRuntimeStart = preflightTimeoutJob.indexOf(
  "async function buildProductionPreflightTimeoutRuntime"
);
const timeoutRuntimeEnd = preflightTimeoutJob.indexOf(
  "async function cleanupPreflightObject",
  timeoutRuntimeStart
);
assert.notEqual(timeoutRuntimeStart, -1, "missing production preflight timeout runtime builder");
assert.notEqual(timeoutRuntimeEnd, -1, "missing production preflight timeout runtime boundary");
const timeoutRuntime = preflightTimeoutJob.slice(timeoutRuntimeStart, timeoutRuntimeEnd);
assert.match(timeoutRuntime, /buildProductionPreflightRuntime\(/);
for (const businessSwitch of [
  "wechatTextEnabled",
  "wechatImageEnabled",
  "tencentVideoEnabled"
]) {
  assert.equal(
    timeoutRuntime.includes(businessSwitch),
    false,
    `production preflight timeout runtime must not depend on business switch: ${businessSwitch}`
  );
}
assert.match(compose, /content-moderation-retry:[\s\S]*job:content-moderation-retry/);
assert.match(compose, /content-moderation-orphan-scan:[\s\S]*job:content-moderation-orphan-scan/);
assert.match(
  compose,
  /content-moderation-production-preflight-timeout:[\s\S]*job:content-moderation-production-preflight-timeout/
);

for (const statement of [
  "微信免费",
  "不是永久 SLA",
  "腾讯云 CI 视频审核",
  "私有 COS",
  "CONTENT_MODERATION_ORPHAN_CLEANUP_ENABLED",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CALLBACK_TIMEOUT_MS",
  "不启用腾讯云 TMS、腾讯云 CI 图片审核、COS 图片自动审核",
  "CONTENT_MODERATION_INTAKE_CLOSED",
  "不是维护开关",
  "不是逐请求动态健康检查",
  "仅打开 DB 开关并保持 provider enabled 不会动态阻断",
  "回滚"
]) {
  assert.equal(runbook.includes(statement), true, `runbook missing: ${statement}`);
}
assert.doesNotMatch(runbook, /CONTENT_MODERATION_ENABLED=false/);
assert.doesNotMatch(runbook, /非生产真实联调记录/);
assert.match(
  runbook,
  /PINCHE_API_IMAGE="<当前 API 已验证的不可变镜像引用（repo@sha256:\.\.\.）>"/
);
assert.match(runbook, /--pull never/);
assert.match(runbook, /-e CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED=true/);
assert.match(runbook, /-e D45_PREFLIGHT_CONFIRMATION/);

for (const command of ["d45:unit", "d45:check", "d45:smoke"]) {
  assert.equal(typeof rootPackage.scripts[command], "string", `missing root command: ${command}`);
  assert.match(rootPackage.scripts.precheck, new RegExp(`npm run ${command.replace(/:/g, "\\:")}`));
}

console.log("D45 content moderation static checks passed");
