import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const configUrl = new URL("../src/config/env.js", import.meta.url).href;
const importScript = `import(${JSON.stringify(configUrl)}).then(() => process.stdout.write("CONFIG_OK"));`;

const secureProductionEnv = Object.freeze({
  NODE_ENV: "production",
  WECHAT_MOCK_LOGIN: "false",
  SESSION_SECRET: "d51-production-secret-with-at-least-32-characters",
  APP_BASE_URL: "https://api.example.invalid",
  MYSQL_HOST: "mysql.example.invalid",
  MYSQL_DATABASE: "pinche",
  DATABASE_TARGET_LOCK: "cloud",
  DATABASE_TARGET_LOCK_HOST: "mysql.example.invalid",
  CONTENT_MODERATION_ENABLED: "false",
  CONTENT_MODERATION_TEXT_INTAKE_MODE: "closed",
  CONTENT_MODERATION_IMAGE_INTAKE_MODE: "closed",
  CONTENT_MODERATION_VIDEO_INTAKE_MODE: "closed",
  CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ENABLED: "false",
  CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ACTIONS: "",
  CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED: "false",
  CONTENT_MODERATION_AUTHOR_PRIVATE_VIDEO_ENABLED: "false",
  CONTENT_MODERATION_ORPHAN_SCAN_ENABLED: "false",
  CONTENT_MODERATION_ORPHAN_CLEANUP_ENABLED: "false",
  CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED: "false"
});

function importProductionConfig(overrides) {
  return spawnSync(process.execPath, ["--input-type=module", "--eval", importScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...secureProductionEnv,
      ...overrides
    }
  });
}

for (const [name, overrides, expectedVariable] of [
  ["mock login", { WECHAT_MOCK_LOGIN: "true" }, "WECHAT_MOCK_LOGIN"],
  ["weak session secret", { SESSION_SECRET: "development-secret" }, "SESSION_SECRET"],
  ["HTTP public base URL", { APP_BASE_URL: "http://api.example.invalid" }, "APP_BASE_URL"],
  [
    "missing database target lock",
    { DATABASE_TARGET_LOCK: "", DATABASE_TARGET_LOCK_HOST: "" },
    "DATABASE_TARGET_LOCK"
  ]
]) {
  test(`production config rejects ${name} before startup`, () => {
    const result = importProductionConfig(overrides);
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    assert.notEqual(result.status, 0, combinedOutput);
    assert.match(combinedOutput, /RUNTIME_CONFIG_INVALID/);
    assert.match(combinedOutput, new RegExp(expectedVariable));
    assert.doesNotMatch(combinedOutput, /development-secret|d51-production-secret/);
  });
}
