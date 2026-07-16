import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRequired(relativePath) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  assert.ok(fs.existsSync(absolutePath), `${relativePath} must exist for D46 isolated acceptance`);
  return fs.readFileSync(absolutePath, "utf8");
}

function assertNoUnsafeLocalValue(source, sourceName) {
  const forbiddenPatterns = [
    /api\.pinche\.jubenmi\.com/i,
    /https?:\/\//i,
    /\bMYSQL_DATABASE\s*[:=]\s*["']?pinche\b(?!_d46_test)/i,
    /\bCOS_ENABLED\s*[:=]\s*["']?true\b/i,
    /\bCOS_(?:SECRET_ID|SECRET_KEY|BUCKET|REGION)\b/i,
    /\b(?:production|prod)\b/i,
    /^\s*(?:"(?:network_mode|extends)"|'(?:network_mode|extends)'|network_mode|extends)\s*:/m,
    /^\s*(?:"<<"|'<<'|<<)\s*:/m,
    /(?:^|[\s:[,{\-])(?:&|\*)[A-Za-z_][A-Za-z0-9_-]*(?=\s|$|[,}\]])/m
  ];

  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(source, pattern, `${sourceName} must not contain a production or cloud value`);
  }
}

function extractServiceBlock(servicesSection, serviceName) {
  const header = `  ${serviceName}:\n`;
  const start = servicesSection.indexOf(header);
  assert.ok(start >= 0, `compose must define ${serviceName}`);
  const remaining = servicesSection.slice(start + header.length);
  const nextServiceOffset = remaining.search(/^ {2}[a-z0-9_-]+:\s*$/m);
  return nextServiceOffset >= 0 ? remaining.slice(0, nextServiceOffset) : remaining;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function yamlServicePropertyPattern(propertyName, options = {}) {
  const property = escapeRegExp(propertyName);
  const suffix = options.headerOnly ? "\\s*:\\s*$" : "\\s*:";
  return new RegExp(`^ {4}(?:"${property}"|'${property}'|${property})${suffix}`);
}

function yamlServicePropertyIndexes(lines, propertyName) {
  const pattern = yamlServicePropertyPattern(propertyName);
  return lines.flatMap((line, index) => pattern.test(line) ? [index] : []);
}

function yamlListValues(serviceBlock, propertyName) {
  const lines = serviceBlock.split(/\r?\n/);
  const headerIndexes = yamlServicePropertyIndexes(lines, propertyName);
  if (headerIndexes.length !== 1) return null;
  const headerIndex = headerIndexes[0];
  if (!yamlServicePropertyPattern(propertyName, { headerOnly: true }).test(lines[headerIndex])) return null;

  const values = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const item = line.match(/^      -\s+(.+?)\s*$/);
    if (!item) break;
    values.push(item[1].replace(/^(["'])(.*)\1$/, "$2"));
  }
  return values;
}

function assertOnlyYamlList(serviceName, serviceBlock, propertyName, expectedValues) {
  const propertyCount = yamlServicePropertyIndexes(serviceBlock.split(/\r?\n/), propertyName).length;
  assert.equal(propertyCount, 1, `${serviceName} must define ${propertyName} exactly once`);
  assert.deepEqual(
    yamlListValues(serviceBlock, propertyName),
    expectedValues,
    `${serviceName} ${propertyName} must contain only the dedicated local value`
  );
}

function assertNoServiceProperty(serviceName, serviceBlock, propertyName) {
  assert.equal(
    yamlServicePropertyIndexes(serviceBlock.split(/\r?\n/), propertyName).length,
    0,
    `${serviceName} must not define ${propertyName}`
  );
}

const runtimeGuard = readRequired("apps/api/src/modules/content-moderation/d46-isolated-smoke.js");
const server = readRequired("apps/api/src/server.js");
const apiEnv = readRequired("apps/api/src/config/env.js");
const compose = readRequired("docker-compose.d46-smoke.yml");
const launcher = readRequired("scripts/d46-api-smoke-server.mjs");
const acceptanceScript = readRequired("scripts/d46-author-private-content-api-smoke.js");
const fixtureCleanupRunner = readRequired("scripts/d46-fixture-cleanup.mjs");
const acceptancePlan = readRequired("docs/superpowers/plans/2026-07-16-d46-isolated-http-acceptance.md");
const packageJson = JSON.parse(readRequired("package.json"));

const guardStart = runtimeGuard.indexOf("export function assertD46IsolatedSmokeEnvironment");
const guardEnd = runtimeGuard.indexOf("export function d46IsolatedSmokeRuntime", guardStart);
assert.ok(guardStart >= 0 && guardEnd > guardStart, "Task 1 must expose the authoritative D46 isolation guard");
const authoritativeGuard = runtimeGuard.slice(guardStart, guardEnd);
const guardEnvironmentNames = new Set(
  Array.from(
    authoritativeGuard.matchAll(
      /(?:envValue|booleanEnvironmentValue|explicitlyEmptyEnvironmentValue)\(env, "([A-Z0-9_]+)"\)/g
    ),
    ([, name]) => name
  )
);
for (const requiredName of [
  "NODE_ENV",
  "WECHAT_MOCK_LOGIN",
  "D46_SMOKE_ISOLATED",
  "MYSQL_HOST",
  "MYSQL_PORT",
  "MYSQL_DATABASE",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "PORT",
  "APP_BASE_URL",
  "REDIS_ENABLED",
  "REDIS_URL",
  "COS_ENABLED",
  "COS_SECRET_ID",
  "COS_SECRET_KEY",
  "COS_BUCKET",
  "COS_REGION",
  "WECHAT_APP_ID",
  "WECHAT_APP_SECRET",
  "WECHAT_CONTENT_SECURITY_EVENT_TOKEN",
  "WECHAT_CONTENT_SECURITY_EVENT_AES_KEY",
  "TENCENT_CI_VIDEO_REGION",
  "TENCENT_CI_VIDEO_BIZ_TYPE",
  "TENCENT_CI_VIDEO_CALLBACK_URL",
  "TENCENT_CI_VIDEO_CALLBACK_TOKEN",
  "TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN",
  "COS_CI_CALLBACK_TOKEN",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED",
  "CONTENT_MODERATION_ORPHAN_SCAN_ENABLED",
  "CONTENT_MODERATION_ORPHAN_CLEANUP_ENABLED",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CONFIRMATION",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_OPERATOR_USER_ID",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TEST_ADMIN_USER_ID",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_REFERENCE_HMAC_KEY",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_IMAGE_FINGERPRINT",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_VIDEO_FINGERPRINT",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_RELEASE_FINGERPRINT",
  "D45_PREFLIGHT_CONFIRMATION",
  "TENCENT_MAP_SERVICE_KEY",
  "TENCENT_MAP_KEY",
  "VITE_TENCENT_MAP_KEY",
  "AMAP_WEB_SERVICE_KEY",
  "GAODE_MAP_KEY",
  "WECHAT_SUBSCRIBE_MESSAGE_ENABLED",
  "WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_CREATED",
  "WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_REVIEWED"
]) {
  assert.ok(
    guardEnvironmentNames.has(requiredName) || runtimeGuard.includes(`"${requiredName}"`),
    `D46 isolation guard must enforce ${requiredName}`
  );
}
assert.match(authoritativeGuard, /LOCAL_MYSQL_HOSTS\.has/, "D46 isolation guard must restrict MySQL to loopback");
assert.match(authoritativeGuard, /D46_SMOKE_MYSQL_PORT/, "D46 isolation guard must pin the dedicated MySQL port");
assert.match(authoritativeGuard, /D46_SMOKE_DATABASE/, "D46 isolation guard must pin the dedicated database");
assert.match(authoritativeGuard, /D46_SMOKE_MYSQL_USER/, "D46 isolation guard must pin the dedicated database user");
assert.match(authoritativeGuard, /D46_SMOKE_MYSQL_PASSWORD/, "D46 isolation guard must pin the dedicated database password");
assert.match(authoritativeGuard, /D46_SMOKE_COS_SECRET_ID/, "D46 isolation guard must pin local COS placeholders");
assert.match(authoritativeGuard, /D46_SMOKE_WECHAT_APP_SECRET/, "D46 isolation guard must pin local WeChat placeholders");
assert.match(authoritativeGuard, /D46_SMOKE_VIDEO_CALLBACK_URL/, "D46 isolation guard must pin the loopback video callback");
assert.match(runtimeGuard, /D46_SMOKE_ENVIRONMENT_LOCKS/, "D46 isolation guard must declare environment lock names");
assert.match(runtimeGuard, /"DATABASE_TARGET_LOCK"/, "D46 isolation guard must reject a database target lock");
assert.match(runtimeGuard, /"DATABASE_TARGET_LOCK_HOST"/, "D46 isolation guard must reject a database target host lock");
assert.match(authoritativeGuard, /D46_SMOKE_ENVIRONMENT_LOCKS\.every/, "D46 isolation guard must enforce every environment lock");
assert.match(
  authoritativeGuard,
  /D46_SMOKE_EXPLICIT_EMPTY_ENVIRONMENT_NAMES\.every/,
  "D46 isolation guard must require every explicitly empty cloud value"
);
assert.match(
  authoritativeGuard,
  /D46_SMOKE_EXPLICIT_FALSE_ENVIRONMENT_NAMES\.every/,
  "D46 isolation guard must require every explicitly false cloud toggle"
);
assert.match(
  authoritativeGuard,
  /explicitlyExactEnvironmentValue\(env, name, "false"\)/,
  "D46 isolation guard must require exact false cloud toggles"
);
assert.match(authoritativeGuard, /throw d46SmokeError/, "D46 isolation guard must fail closed");
assert.match(
  apiEnv,
  /export function shouldLoadDotEnv\(env = process\.env\)[\s\S]*D46_SMOKE_ISOLATED[\s\S]*!==\s*["']1["']/,
  "D46 config must classify its marker before reading dotenv"
);
assert.match(
  apiEnv,
  /function loadDotEnv\(\)\s*\{\s*if \(!shouldLoadDotEnv\(process\.env\)\)\s*\{\s*return;/,
  "D46 config must skip dotenv hydration before reading any environment file"
);
assert.match(
  apiEnv,
  /assertD46IsolatedSmokeEnvironment\(process\.env\)/,
  "D46 config marker must fail closed before any generic process builds configuration"
);
for (const [relativePath, jobName] of [
  ["apps/api/src/jobs/album-image-cleanup.js", "album-image-cleanup"],
  ["apps/api/src/jobs/backfill-album-image-object-keys.js", "album-image-backfill"],
  ["apps/api/src/jobs/content-moderation-retry.js", "content-moderation-retry"],
  ["apps/api/src/jobs/content-moderation-orphan-scan.js", "content-moderation-orphan-scan"],
  ["apps/api/src/jobs/content-moderation-production-preflight-timeout.js", "content-moderation-production-preflight-timeout"],
  ["apps/api/src/jobs/content-moderation-production-preflight.js", "content-moderation-production-preflight"]
]) {
  const source = readRequired(relativePath);
  assert.match(
    source,
    /assertD46IsolatedSmokeGenericJobDisabled/,
    `${jobName} must import the D46 generic-job rejection guard`
  );
  assert.match(
    source,
    new RegExp(`assertD46IsolatedSmokeGenericJobDisabled\\(\\s*["']${jobName}["']`),
    `${jobName} must reject strict D46 marker execution before job work`
  );
}

assert.match(server, /\/api\/testing\/d46-smoke-target/, "server must expose only the guarded D46 target probe");
assert.match(server, /d46IsolatedSmokeRuntimeEnabled/, "target probe must use the strict D46 runtime gate");
assert.match(server, /allowLocalD46Preview:\s*d46IsolatedSmokeRuntimeEnabled\s*===\s*true/, "local image fallback must be strict-D46 only");
assert.match(
  server,
  /const listenOptions\s*=\s*d46IsolatedSmokeRuntimeEnabled\s*\?\s*\{\s*port:\s*config\.port,\s*host:\s*["']127\.0\.0\.1["']\s*\}\s*:\s*\{\s*port:\s*config\.port\s*\}/,
  "direct D46 startup must bind only loopback"
);

assert.match(launcher, /assertD46IsolatedSmokeEnvironment\(process\.env\)/, "launcher must assert isolation before startup");
assert.match(launcher, /server\.listen\(3046, "127\.0\.0\.1"/, "launcher must bind API to loopback only");
assert.match(launcher, /SIGINT/, "launcher must handle SIGINT");
assert.match(launcher, /SIGTERM/, "launcher must handle SIGTERM");
assert.match(launcher, /server\.close/, "launcher shutdown must close only its HTTP server");
assert.doesNotMatch(
  launcher,
  /\bdotenv\b|(?:readFile|config)\w*\([^)]*["'][^"']*\.env/i,
  "launcher must not load an environment file"
);
assert.ok(
  launcher.indexOf("assertD46IsolatedSmokeEnvironment(process.env)") < launcher.indexOf('await import("../apps/api/src/server.js")'),
  "launcher must guard before importing the API server"
);
assert.match(
  acceptanceScript,
  /TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN:\s*""/,
  "fixture cleanup runner must explicitly blank a legacy video callback token"
);
assert.match(
  acceptanceScript,
  /COS_CI_CALLBACK_TOKEN:\s*""/,
  "fixture cleanup runner must explicitly blank the COS CI callback token"
);
for (const [name, value] of [
  ["CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED", "false"],
  ["CONTENT_MODERATION_ORPHAN_SCAN_ENABLED", "false"],
  ["CONTENT_MODERATION_ORPHAN_CLEANUP_ENABLED", "false"],
  ["CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CONFIRMATION", ""],
  ["CONTENT_MODERATION_PRODUCTION_PREFLIGHT_OPERATOR_USER_ID", ""],
  ["CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TEST_ADMIN_USER_ID", ""],
  ["CONTENT_MODERATION_PRODUCTION_PREFLIGHT_REFERENCE_HMAC_KEY", ""],
  ["CONTENT_MODERATION_PRODUCTION_PREFLIGHT_IMAGE_FINGERPRINT", ""],
  ["CONTENT_MODERATION_PRODUCTION_PREFLIGHT_VIDEO_FINGERPRINT", ""],
  ["CONTENT_MODERATION_PRODUCTION_PREFLIGHT_RELEASE_FINGERPRINT", ""],
  ["D45_PREFLIGHT_CONFIRMATION", ""],
  ["TENCENT_MAP_SERVICE_KEY", ""],
  ["TENCENT_MAP_KEY", ""],
  ["VITE_TENCENT_MAP_KEY", ""],
  ["AMAP_WEB_SERVICE_KEY", ""],
  ["GAODE_MAP_KEY", ""],
  ["WECHAT_SUBSCRIBE_MESSAGE_ENABLED", "false"],
  ["WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_CREATED", ""],
  ["WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_REVIEWED", ""]
]) {
  assert.match(
    acceptanceScript,
    new RegExp(`${name}:\\s*["']${value}["']`),
    `fixture cleanup runner must explicitly pin ${name}`
  );
}
assert.match(
  acceptancePlan,
  /d46_env\(\)\s*\{[\s\S]*env -i PATH="\$PATH" HOME="\$HOME"[\s\S]*"\$@"/,
  "acceptance plan must define a no-inheritance local environment wrapper"
);
assert.match(
  acceptancePlan,
  /test -z "\$\{DOCKER_HOST:-\}" \|\| \{ echo "D46 requires no DOCKER_HOST override"/,
  "acceptance plan must refuse a Docker host override"
);
assert.match(
  acceptancePlan,
  /D46_DOCKER_CONTEXT="\$\(docker context show\)"/,
  "acceptance plan must inspect the active Docker context"
);
assert.match(
  acceptancePlan,
  /D46_DOCKER_HOST="\$\(docker context inspect "\$D46_DOCKER_CONTEXT" --format '\{\{\.Endpoints\.docker\.Host\}\}'\)"/,
  "acceptance plan must inspect the selected Docker endpoint"
);
assert.match(
  acceptancePlan,
  /unix:\/\/\*\|npipe:\/\/\*/,
  "acceptance plan must accept only a local Docker socket"
);
assert.match(
  acceptancePlan,
  /d46_compose\(\)\s*\{[\s\S]*docker --context "\$D46_DOCKER_CONTEXT" compose -p pinche-d46-smoke/,
  "acceptance plan must pin Compose commands to the inspected local context"
);
assert.match(
  acceptancePlan,
  /d46_compose up -d --wait mysql redis/,
  "acceptance plan must start only through the local Compose wrapper"
);
assert.match(
  acceptancePlan,
  /d46_compose down -v/,
  "acceptance plan must clean only through the local Compose wrapper"
);
for (const command of [
  "d46_env npm --workspace apps/api run migrate",
  "d46_env node scripts/d46-api-smoke-server.mjs",
  "d46_env npm run d46:acceptance:api"
]) {
  assert.ok(
    acceptancePlan.includes(command),
    `acceptance plan must run ${command} through the same strict environment wrapper`
  );
}

const planLocalEnvironmentWrapperStart = acceptancePlan.indexOf("  d46_env() {");
const planLocalEnvironmentStart = acceptancePlan.indexOf(
  'env -i PATH="$PATH" HOME="$HOME"',
  planLocalEnvironmentWrapperStart
);
const planLocalEnvironmentEnd = acceptancePlan.indexOf("\n  ```", planLocalEnvironmentStart);
assert.ok(
  planLocalEnvironmentWrapperStart >= 0 &&
    planLocalEnvironmentStart > planLocalEnvironmentWrapperStart &&
    planLocalEnvironmentEnd > planLocalEnvironmentStart,
  "acceptance plan must contain its explicit local environment command"
);
const planLocalEnvironment = acceptancePlan.slice(planLocalEnvironmentStart, planLocalEnvironmentEnd);
for (const [name, value] of [
  ["WECHAT_CONTENT_SECURITY_EVENT_TOKEN", "d46-local-wechat-callback-token-0000000000"],
  ["WECHAT_CONTENT_SECURITY_EVENT_AES_KEY", "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU"],
  ["TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN", ""],
  ["COS_CI_CALLBACK_TOKEN", ""],
  ["CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED", "false"],
  ["CONTENT_MODERATION_ORPHAN_SCAN_ENABLED", "false"],
  ["CONTENT_MODERATION_ORPHAN_CLEANUP_ENABLED", "false"],
  ["D45_PREFLIGHT_CONFIRMATION", ""],
  ["TENCENT_MAP_SERVICE_KEY", ""],
  ["WECHAT_SUBSCRIBE_MESSAGE_ENABLED", "false"]
]) {
  assert.match(
    planLocalEnvironment,
    new RegExp(`${name}=${value}`),
    `acceptance plan must provide the strict local value for ${name}`
  );
}

assert.match(compose, /^name: pinche-d46-smoke$/m, "compose project name must be isolated");
assert.match(compose, /^  mysql:\s*$/m, "compose must define mysql");
assert.match(compose, /^  redis:\s*$/m, "compose must define redis");
assert.match(compose, /image:\s*mysql:8\.4/, "compose must use local MySQL 8.4");
assert.match(compose, /image:\s*redis:7-alpine/, "compose must use local Redis 7");
assert.match(compose, /MYSQL_DATABASE:\s*pinche_d46_test/, "compose must use only the D46 test database");
assert.match(compose, /MYSQL_USER:\s*pinche_d46/, "compose must use only the D46 test user");
assert.match(compose, /^  internal:\s*$/m, "compose must retain its dedicated D46 network");
assert.doesNotMatch(
  compose,
  /^    internal:\s*true\s*$/m,
  "compose must not suppress its loopback-only published ports with an internal-only network"
);
assert.match(compose, /healthcheck:/, "compose services must be health checked");
assert.doesNotMatch(compose, /^\s{2}api:\s*$/m, "compose must not define an API service");
const servicesSection = compose.match(/^services:\n([\s\S]*?)^(?:networks|volumes):/m)?.[1];
assert.ok(servicesSection, "compose must have a bounded services section");
assert.deepEqual(
  Array.from(servicesSection.matchAll(/^ {2}([a-z0-9_-]+):\s*$/gim), ([, serviceName]) => serviceName).sort(),
  ["mysql", "redis"],
  "compose must contain only mysql and redis services"
);
const mysqlService = extractServiceBlock(servicesSection, "mysql");
const redisService = extractServiceBlock(servicesSection, "redis");
assertOnlyYamlList("mysql", mysqlService, "ports", ["127.0.0.1:3346:3306"]);
assertOnlyYamlList("redis", redisService, "ports", ["127.0.0.1:6446:6379"]);
assertOnlyYamlList("mysql", mysqlService, "volumes", ["mysql_data:/var/lib/mysql"]);
assertOnlyYamlList("redis", redisService, "tmpfs", ["/data"]);
assertOnlyYamlList("mysql", mysqlService, "networks", ["internal"]);
assertOnlyYamlList("redis", redisService, "networks", ["internal"]);
assertNoServiceProperty("mysql", mysqlService, "tmpfs");
assertNoServiceProperty("mysql", mysqlService, "mounts");
assertNoServiceProperty("mysql", mysqlService, "extra_hosts");
assertNoServiceProperty("mysql", mysqlService, "volumes_from");
assertNoServiceProperty("mysql", mysqlService, "network_mode");
assertNoServiceProperty("mysql", mysqlService, "extends");
assertNoServiceProperty("redis", redisService, "volumes");
assertNoServiceProperty("redis", redisService, "mounts");
assertNoServiceProperty("redis", redisService, "extra_hosts");
assertNoServiceProperty("redis", redisService, "volumes_from");
assertNoServiceProperty("redis", redisService, "network_mode");
assertNoServiceProperty("redis", redisService, "extends");
assert.doesNotMatch(servicesSection, /^ {6}type:\s*bind\s*$/m, "compose must not use a bind mount");
assert.doesNotMatch(compose, /env_file:/, "compose must not load an inherited environment file");

assertNoUnsafeLocalValue(compose, "docker-compose.d46-smoke.yml");
assertNoUnsafeLocalValue(launcher, "scripts/d46-api-smoke-server.mjs");
assertNoUnsafeLocalValue(fixtureCleanupRunner, "scripts/d46-fixture-cleanup.mjs");

assert.match(acceptanceScript, /activeStage\s*=\s*["']image-pending-preview["']/);
assert.match(acceptanceScript, /activeStage\s*=\s*["']video-pending-preview["']/);
assert.match(acceptanceScript, /async function runCleanupWorkerOnce\(cleanupJobId\)/);
assert.match(acceptanceScript, /["']scripts\/d46-fixture-cleanup\.mjs["']/);
assert.doesNotMatch(acceptanceScript, /src\/jobs\/album-image-cleanup\.js/);
const fixtureGuard = fixtureCleanupRunner.indexOf("assertD46IsolatedSmokeEnvironment(process.env)");
const fixtureCleanupImport = fixtureCleanupRunner.indexOf(
  'await import("../apps/api/src/modules/album-image/cleanup.js")'
);
assert.ok(
  fixtureGuard >= 0 && fixtureCleanupImport > fixtureGuard,
  "fixture cleanup runner must guard before cleanup imports"
);
assert.match(fixtureCleanupRunner, /mediaCleanupJobIds:\s*\[cleanupJobId\]/);
assert.doesNotMatch(fixtureCleanupRunner, /deleteCosObject|headCosObject/);

assert.equal(
  packageJson.scripts?.["d46:acceptance:check"],
  "node scripts/d46-isolated-acceptance-check.js",
  "package.json must expose the read-only D46 acceptance checker"
);
assert.equal(
  packageJson.scripts?.["d46:acceptance:api"],
  "node scripts/d46-author-private-content-api-smoke.js",
  "package.json must reserve the D46 HTTP acceptance command"
);
assert.doesNotMatch(packageJson.scripts?.precheck || "", /d46:acceptance/, "root precheck must not run acceptance writes");
assert.doesNotMatch(packageJson.scripts?.check || "", /d46:acceptance/, "root check must not run acceptance writes");

console.log("D46 isolated acceptance static contract passed.");
