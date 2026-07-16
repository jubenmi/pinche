import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assertD46IsolatedSmokeEnvironment,
  buildD46AuthorVideoCapabilityClaims,
  buildD46IsolatedSmokeImageUrl,
  assertD46IsolatedSmokeGenericJobDisabled,
  createD46IsolatedSmokeModerationClient,
  d46IsolatedSmokeRuntime,
  validateD46AuthorVideoCapabilityClaims
} from "../src/modules/content-moderation/d46-isolated-smoke.js";
import { shouldLoadDotEnv } from "../src/config/env.js";

function isolatedEnv(overrides = {}) {
  return {
    NODE_ENV: "test",
    WECHAT_MOCK_LOGIN: "true",
    D46_SMOKE_ISOLATED: "1",
    PORT: "3046",
    APP_BASE_URL: "http://127.0.0.1:3046",
    MYSQL_HOST: "127.0.0.1",
    MYSQL_PORT: "3346",
    MYSQL_DATABASE: "pinche_d46_test",
    MYSQL_USER: "pinche_d46",
    MYSQL_PASSWORD: "pinche_d46_local_only",
    REDIS_ENABLED: "true",
    REDIS_URL: "redis://127.0.0.1:6446/15",
    COS_ENABLED: "false",
    COS_SECRET_ID: "d46-local-fake-id",
    COS_SECRET_KEY: "d46-local-fake-key",
    COS_BUCKET: "d46-local-fake-bucket",
    COS_REGION: "ap-nanjing",
    WECHAT_APP_ID: "wx-d46-local",
    WECHAT_APP_SECRET: "d46-local-placeholder",
    WECHAT_CONTENT_SECURITY_EVENT_TOKEN: "d46-local-wechat-callback-token-0000000000",
    WECHAT_CONTENT_SECURITY_EVENT_AES_KEY: "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU",
    TENCENT_CI_VIDEO_REGION: "ap-nanjing",
    TENCENT_CI_VIDEO_BIZ_TYPE: "d46-local-fake-policy",
    TENCENT_CI_VIDEO_CALLBACK_URL:
      "http://127.0.0.1:3046/api/internal/content-moderation/tencent-video/callback",
    TENCENT_CI_VIDEO_CALLBACK_TOKEN: "d46-local-video-callback-token-0000000000",
    TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN: "",
    COS_CI_CALLBACK_TOKEN: "",
    CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED: "false",
    CONTENT_MODERATION_ORPHAN_SCAN_ENABLED: "false",
    CONTENT_MODERATION_ORPHAN_CLEANUP_ENABLED: "false",
    CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CONFIRMATION: "",
    CONTENT_MODERATION_PRODUCTION_PREFLIGHT_OPERATOR_USER_ID: "",
    CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TEST_ADMIN_USER_ID: "",
    CONTENT_MODERATION_PRODUCTION_PREFLIGHT_REFERENCE_HMAC_KEY: "",
    CONTENT_MODERATION_PRODUCTION_PREFLIGHT_IMAGE_FINGERPRINT: "",
    CONTENT_MODERATION_PRODUCTION_PREFLIGHT_VIDEO_FINGERPRINT: "",
    CONTENT_MODERATION_PRODUCTION_PREFLIGHT_RELEASE_FINGERPRINT: "",
    D45_PREFLIGHT_CONFIRMATION: "",
    TENCENT_MAP_SERVICE_KEY: "",
    TENCENT_MAP_KEY: "",
    VITE_TENCENT_MAP_KEY: "",
    AMAP_WEB_SERVICE_KEY: "",
    GAODE_MAP_KEY: "",
    WECHAT_SUBSCRIBE_MESSAGE_ENABLED: "false",
    WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_CREATED: "",
    WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_REVIEWED: "",
    WECHAT_SUBSCRIBE_SESSION_RESCHEDULED_TEMPLATE_ID: "",
    ...overrides
  };
}

function isolatedConfig(overrides = {}) {
  const base = {
    nodeEnv: "test",
    port: 3046,
    appBaseUrl: "http://127.0.0.1:3046",
    wechat: { mockLogin: true },
    mysql: {
      host: "127.0.0.1",
      port: 3346,
      database: "pinche_d46_test",
      user: "pinche_d46"
    },
    redis: { enabled: true, url: "redis://127.0.0.1:6446/15" },
    cos: { enabled: false }
  };
  return {
    ...base,
    ...overrides,
    wechat: { ...base.wechat, ...overrides.wechat },
    mysql: {
      ...base.mysql,
      ...overrides.mysql
    },
    redis: { ...base.redis, ...overrides.redis },
    cos: { ...base.cos, ...overrides.cos }
  };
}

function videoRecord(overrides = {}) {
  return {
    mediaId: 42,
    userId: 7,
    mediaType: "video",
    previewPath: "/uploads/session-album/videos/display/d46-video.mp4",
    objectVersion: "d46-video-version-1",
    ...overrides
  };
}

function fingerprint(record) {
  return `${record.mediaId}:${record.userId}:${record.previewPath}:${record.objectVersion}`;
}

test("D46 isolated smoke environment rejects every production-adjacent prerequisite before runtime", () => {
  assert.equal(assertD46IsolatedSmokeEnvironment(isolatedEnv()), true);

  for (const [key, value] of [
    ["NODE_ENV", "development"],
    ["WECHAT_MOCK_LOGIN", "false"],
    ["D46_SMOKE_ISOLATED", "0"],
    ["PORT", "3018"],
    ["APP_BASE_URL", "https://api.pinche.jubenmi.com"],
    ["MYSQL_HOST", "mysql"],
    ["MYSQL_PORT", "3307"],
    ["MYSQL_DATABASE", "pinche"],
    ["MYSQL_USER", "pinche"],
    ["MYSQL_PASSWORD", "production-password"],
    ["REDIS_ENABLED", "false"],
    ["REDIS_URL", "redis://10.0.0.7:6379/15"],
    ["DATABASE_TARGET_LOCK", "cloud"],
    ["DATABASE_TARGET_LOCK_HOST", "db.example.invalid"],
    ["COS_ENABLED", "true"],
    ["COS_ENABLED", "TRUE"],
    ["COS_ENABLED", "1"],
    ["COS_ENABLED", "yes"],
    ["COS_ENABLED", "on"],
    ["COS_SECRET_ID", "AKID-production"],
    ["COS_SECRET_KEY", "production-secret"],
    ["COS_BUCKET", "production-1250000000"],
    ["COS_REGION", "ap-shanghai"],
    ["WECHAT_APP_ID", "wx-production"],
    ["WECHAT_APP_SECRET", "production-app-secret"],
    ["WECHAT_CONTENT_SECURITY_EVENT_TOKEN", "production-event-token"],
    ["WECHAT_CONTENT_SECURITY_EVENT_AES_KEY", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi01234567"],
    ["TENCENT_CI_VIDEO_REGION", "ap-shanghai"],
    ["TENCENT_CI_VIDEO_BIZ_TYPE", "production-policy"],
    ["TENCENT_CI_VIDEO_CALLBACK_URL", "https://api.pinche.jubenmi.com/callback"],
    ["TENCENT_CI_VIDEO_CALLBACK_TOKEN", "production-callback-token"],
    ["TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN", "production-previous-token"],
    ["COS_CI_CALLBACK_TOKEN", "production-cos-callback-token"]
  ]) {
    assert.throws(
      () => assertD46IsolatedSmokeEnvironment(isolatedEnv({ [key]: value })),
      /D46 isolated smoke/
    );
  }

  for (const [name, expectedValue] of [
    ["TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN", ""],
    ["COS_CI_CALLBACK_TOKEN", ""],
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
    ["WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_REVIEWED", ""],
    ["WECHAT_SUBSCRIBE_SESSION_RESCHEDULED_TEMPLATE_ID", ""]
  ]) {
    const unsafeValue = expectedValue === "" ? "production-value" : "true";
    assert.throws(
      () => assertD46IsolatedSmokeEnvironment(isolatedEnv({ [name]: unsafeValue })),
      /D46 isolated smoke/
    );

    const withoutExplicitEmptyValue = isolatedEnv();
    delete withoutExplicitEmptyValue[name];
    assert.throws(
      () => assertD46IsolatedSmokeEnvironment(withoutExplicitEmptyValue),
      /D46 isolated smoke/
    );
  }
});

test("D46 isolation marker disables dotenv hydration before any cloud-capable config is read", () => {
  assert.equal(shouldLoadDotEnv({ D46_SMOKE_ISOLATED: "1" }), false);
  assert.equal(shouldLoadDotEnv({ D46_SMOKE_ISOLATED: "0" }), true);
  assert.equal(shouldLoadDotEnv({}), true);
});

test("D46 marker rejects generic cloud-capable jobs while retaining dedicated fixture cleanup", () => {
  assert.doesNotThrow(() => assertD46IsolatedSmokeGenericJobDisabled(
    "content-moderation-retry",
    isolatedEnv({ D46_SMOKE_ISOLATED: "0" })
  ));
  assert.throws(
    () => assertD46IsolatedSmokeGenericJobDisabled("content-moderation-retry", isolatedEnv()),
    /D46 isolated smoke generic job is disabled/
  );
  assert.throws(
    () => assertD46IsolatedSmokeGenericJobDisabled(
      "album-image-cleanup",
      isolatedEnv({ MYSQL_DATABASE: "pinche" })
    ),
    /D46 isolated smoke/
  );
});

test("all generic job CLI entrypoints fail before their work under the strict D46 marker", () => {
  const apiRoot = new URL("../", import.meta.url);
  for (const jobPath of [
    "src/jobs/album-image-cleanup.js",
    "src/jobs/backfill-album-image-object-keys.js",
    "src/jobs/content-moderation-retry.js",
    "src/jobs/content-moderation-orphan-scan.js",
    "src/jobs/content-moderation-production-preflight-timeout.js",
    "src/jobs/content-moderation-production-preflight.js"
  ]) {
    const result = spawnSync(process.execPath, [jobPath, "--once"], {
      cwd: apiRoot,
      env: { PATH: process.env.PATH || "", ...isolatedEnv() },
      encoding: "utf8",
      timeout: 5_000
    });
    assert.notEqual(result.status, 0, `${jobPath} must reject D46 marker execution`);
    assert.equal(result.signal, null, `${jobPath} must fail closed rather than time out`);
  }
});

test("D46 isolated runtime refuses a config that does not exactly mirror the isolated environment", () => {
  const env = isolatedEnv({ MYSQL_HOST: "localhost" });
  const runtimeConfig = isolatedConfig({ mysql: { host: "localhost" } });
  assert.equal(d46IsolatedSmokeRuntime(runtimeConfig, env), true);

  assert.equal(
    d46IsolatedSmokeRuntime(isolatedConfig({ nodeEnv: "development" }), env),
    false
  );
  assert.equal(
    d46IsolatedSmokeRuntime(isolatedConfig({ port: 3018 }), env),
    false
  );
  assert.equal(
    d46IsolatedSmokeRuntime(isolatedConfig({ appBaseUrl: "http://localhost:3018" }), env),
    false
  );
  assert.equal(
    d46IsolatedSmokeRuntime(isolatedConfig({ wechat: { mockLogin: false } }), env),
    false
  );
  assert.equal(
    d46IsolatedSmokeRuntime(isolatedConfig({ mysql: { host: "localhost", database: "pinche" } }), env),
    false
  );
  assert.equal(
    d46IsolatedSmokeRuntime(isolatedConfig({ mysql: { port: 3307 } }), env),
    false
  );
  assert.equal(
    d46IsolatedSmokeRuntime(isolatedConfig({ mysql: { user: "pinche" } }), env),
    false
  );
  assert.equal(
    d46IsolatedSmokeRuntime(isolatedConfig({ redis: { enabled: false } }), env),
    false
  );
  assert.equal(
    d46IsolatedSmokeRuntime(isolatedConfig({ redis: { url: "redis://127.0.0.1:6379/15" } }), env),
    false
  );
  assert.equal(
    d46IsolatedSmokeRuntime(isolatedConfig({ cos: { enabled: true } }), env),
    false
  );
});

test("D46 fake moderation client is deterministic and cannot reach network transport", async () => {
  const client = createD46IsolatedSmokeModerationClient(true);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("D46 fake provider must not call fetch");
  };
  try {
    assert.deepEqual(await client.checkText({ content: "[d46:review] harmless fixture" }), {
      suggestion: "review"
    });
    assert.deepEqual(await client.checkText({ content: "[d46:block] harmless fixture" }), {
      suggestion: "risky"
    });
    assert.deepEqual(await client.checkText({ content: "ordinary harmless fixture" }), {
      suggestion: "pass"
    });

    const trace = await client.checkImage({
      mediaUrl: buildD46IsolatedSmokeImageUrl("uploads/session-album/display/d46-image.jpg")
    });
    assert.match(trace.traceId, /^d46-image-[a-f0-9]{32}$/);
    assert.ok(trace.traceId.length <= 128);
    await assert.rejects(
      client.checkImage({ mediaUrl: "https://example.invalid/private.jpg" }),
      /D46 isolated smoke image URL/
    );

    const submitted = await client.submitVideo({
      objectKey: "uploads/session-album/videos/source/d46-video.mp4",
      dataId: "d46-data-1"
    });
    assert.deepEqual(submitted, {
      JobId: "d46-video-1e4405330157a972",
      DataId: "d46-data-1",
      State: "Submitted"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.throws(() => createD46IsolatedSmokeModerationClient(false), /D46 isolated smoke runtime/);
});

test("D46 local author video capability closes on tampering, expiry, or record changes", () => {
  const record = videoRecord();
  const claims = buildD46AuthorVideoCapabilityClaims(record, {
    nowSeconds: 1000,
    ttlSeconds: 60,
    fingerprint
  });
  assert.deepEqual(validateD46AuthorVideoCapabilityClaims(record, claims, {
    nowSeconds: 1000,
    ttlSeconds: 60,
    fingerprint
  }), record);
  assert.equal(claims.exp - claims.iat, 60);
  assert.deepEqual(validateD46AuthorVideoCapabilityClaims(record, claims, {
    nowSeconds: claims.exp - 1,
    ttlSeconds: 60,
    fingerprint
  }), record);
  assert.equal(validateD46AuthorVideoCapabilityClaims(record, claims, {
    nowSeconds: claims.exp,
    ttlSeconds: 60,
    fingerprint
  }), null);

  for (const altered of [
    { ...claims, mediaId: 43 },
    { ...claims, userId: 8 },
    { ...claims, versionFingerprint: "tampered" },
    { ...claims, mediaType: "image" }
  ]) {
    assert.equal(validateD46AuthorVideoCapabilityClaims(record, altered, {
      nowSeconds: 1000,
      ttlSeconds: 60,
      fingerprint
    }), null);
  }
  assert.equal(validateD46AuthorVideoCapabilityClaims(record, claims, {
    nowSeconds: 1061,
    ttlSeconds: 60,
    fingerprint
  }), null);
  assert.equal(validateD46AuthorVideoCapabilityClaims(videoRecord({ objectVersion: "changed" }), claims, {
    nowSeconds: 1000,
    ttlSeconds: 60,
    fingerprint
  }), null);
});

test("D46 server wiring gates test target, fake provider, and local author video bytes behind the strict runtime", async () => {
  const [server, smoke] = await Promise.all([
    readFile(new URL("../src/server.js", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/content-moderation/d46-isolated-smoke.js", import.meta.url), "utf8")
  ]);
  assert.match(smoke, /NODE_ENV[\s\S]*===\s*["']test["']/);
  assert.match(smoke, /WECHAT_MOCK_LOGIN[\s\S]*===\s*["']true["']/);
  assert.match(smoke, /D46_SMOKE_ISOLATED[\s\S]*===\s*["']1["']/);
  assert.match(smoke, /["']MYSQL_DATABASE["']/);
  assert.match(smoke, /["']MYSQL_PORT["']/);
  assert.match(smoke, /["']MYSQL_USER["']/);
  assert.match(smoke, /D46_SMOKE_DATABASE\s*=\s*["']pinche_d46_test["']/);
  assert.match(smoke, /BOOLEAN_TRUE_VALUES\s*=\s*new Set\(\[["']1["'],\s*["']true["'],\s*["']yes["'],\s*["']on["']\]\)/);
  assert.match(smoke, /!booleanEnvironmentValue\(env, ["']COS_ENABLED["']\)/);
  assert.match(smoke, /COS_SECRET_ID/);
  assert.match(smoke, /WECHAT_APP_SECRET/);
  assert.match(smoke, /TENCENT_CI_VIDEO_CALLBACK_URL/);
  assert.match(smoke, /TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN/);
  assert.match(smoke, /COS_CI_CALLBACK_TOKEN/);
  assert.match(server, /d46IsolatedSmokeRuntime\(config, process\.env\)/);
  assert.match(server, /createD46IsolatedSmokeModerationClient\(d46IsolatedSmokeRuntime/);
  assert.match(server, /\/api\/testing\/d46-smoke-target/);
  assert.match(server, /SMOKE_DATABASE_NOT_ISOLATED/);
  assert.match(server, /d46-smoke\/author-media\/videos/);
  assert.match(server, /verifySignedPayload\(\s*["']d46-author-video-preview["']/);
  assert.match(server, /getAuthorAlbumVideoPreview\([\s\S]*serveUploadedSessionAlbumVideoFile/);
  assert.match(server, /AUTHOR_MEDIA_PREVIEW_CACHE_CONTROL/);
  assert.match(server, /getVisibleSessionAlbumVideoForPlayback/);
  assert.match(server, /allowLocalD46Preview:\s*d46IsolatedSmokeRuntimeEnabled\s*===\s*true/);
  assert.match(
    server,
    /const listenOptions\s*=\s*d46IsolatedSmokeRuntimeEnabled\s*\?\s*\{\s*port:\s*config\.port,\s*host:\s*["']127\.0\.0\.1["']\s*\}\s*:\s*\{\s*port:\s*config\.port\s*\}/
  );
  assert.doesNotMatch(server, /d46-smoke[\s\S]{0,220}getVisibleSessionAlbumVideoForPlayback/);
});

test("D46 isolated HTTP acceptance script proves its target before any local fixture writes", async () => {
  const script = await readFile(
    new URL("../../../scripts/d46-author-private-content-api-smoke.js", import.meta.url),
    "utf8"
  );
  const probe = script.indexOf('"/api/testing/d46-smoke-target"');
  const mainStart = script.indexOf("async function main()");
  const mainEnd = script.indexOf("\ntry {\n  await main();", mainStart);
  const main = script.slice(mainStart, mainEnd);
  const targetRequest = main.indexOf('request("GET", TARGET_PATH');
  const mysql = main.indexOf("mysqlConnection()");
  const login = main.indexOf('login("dev-d46-admin")');

  assert.match(script, /assertD46IsolatedSmokeEnvironment\(process\.env\)/);
  assert.match(script, /const BASE_URL = "http:\/\/127\.0\.0\.1:3046"/);
  assert.ok(probe >= 0, "D46 smoke must probe its isolated HTTP target");
  assert.ok(mainStart >= 0 && mainEnd > mainStart, "D46 smoke must expose a main acceptance flow");
  assert.ok(targetRequest >= 0, "D46 smoke must execute the isolated target probe");
  assert.ok(mysql > targetRequest, "D46 smoke must not open MySQL before the target probe");
  assert.ok(login > targetRequest, "D46 smoke must not log in or write fixtures before the target probe");
  assert.match(main, /try\s*\{[\s\S]*finally\s*\{[\s\S]*cleanupFixture\(database, fixture\)/);
  assert.match(script, /cache-control[\s\S]{0,120}private, no-store/i);
  assert.doesNotMatch(script, /api\.pinche\.jubenmi\.com/i);
  assert.doesNotMatch(script, /env:\s*\{\s*\.\.\.process\.env/);
});

test("D46 acceptance cleanup waits for the launcher before removing Compose resources", async () => {
  const plan = await readFile(
    new URL("../../../docs/superpowers/plans/2026-07-16-d46-isolated-http-acceptance.md", import.meta.url),
    "utf8"
  );
  const cleanupStart = plan.indexOf("cleanup_d46() {");
  const cleanupEnd = plan.indexOf("\n  }\n  trap cleanup_d46 EXIT", cleanupStart);
  const cleanup = plan.slice(cleanupStart, cleanupEnd);

  assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart);
  assert.match(cleanup, /kill -0 "\$launcher_pid"/);
  assert.match(cleanup, /kill -TERM "\$launcher_pid"/);
  const waitForLauncher = cleanup.indexOf('wait "$launcher_pid"');
  const composeDown = cleanup.indexOf("d46_compose down -v");
  assert.ok(waitForLauncher >= 0 && composeDown > waitForLauncher);
});

test("D46 API smoke guards before loading database or business dependencies", async () => {
  const scriptUrl = new URL(
    "../../../scripts/d46-author-private-content-api-smoke.js",
    import.meta.url
  );
  const script = await readFile(scriptUrl, "utf8");
  const guard = script.indexOf("assertD46IsolatedSmokeEnvironment(process.env)");
  const mysqlImport = script.indexOf('await import("mysql2/promise")');
  const cleanupImport = script.indexOf(
    'await import("../apps/api/src/modules/album-image/cleanup.js")'
  );

  assert.ok(guard >= 0, "the strict D46 environment guard must be present");
  assert.ok(mysqlImport > guard, "MySQL must load dynamically after the strict guard");
  assert.ok(cleanupImport > guard, "album cleanup must load dynamically after the strict guard");
  const beforeGuard = script.slice(0, guard);
  const staticImports = [...beforeGuard.matchAll(/^import[\s\S]*?from\s+["']([^"']+)["'];$/gm)]
    .map((match) => match[1]);
  assert.ok(staticImports.includes("../apps/api/src/modules/content-moderation/d46-isolated-smoke.js"));
  assert.ok(
    staticImports.every((specifier) =>
      specifier.startsWith("node:") ||
      specifier === "../apps/api/src/modules/content-moderation/d46-isolated-smoke.js"
    ),
    "only Node builtins and the strict guard module may load before the guard"
  );

  const loader = `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === "mysql2/promise" || specifier.endsWith("/modules/album-image/cleanup.js")) {
        throw new Error("D46 forbidden dependency evaluated before guard");
      }
      return nextResolve(specifier, context);
    }
  `)}`;
  const result = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-loader", loader, fileURLToPath(scriptUrl)],
    {
      env: { PATH: process.env.PATH || "", D46_SMOKE_ISOLATED: "0" },
      encoding: "utf8",
      timeout: 5_000
    }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /D46 isolated smoke/);
  assert.doesNotMatch(result.stderr, /D46 forbidden dependency evaluated before guard/);
});

test("D46 acceptance cleanup runner is limited to the current fixture job", async () => {
  const [script, runner] = await Promise.all([
    readFile(
      new URL("../../../scripts/d46-author-private-content-api-smoke.js", import.meta.url),
      "utf8"
    ),
    readFile(new URL("../../../scripts/d46-fixture-cleanup.mjs", import.meta.url), "utf8")
  ]);

  assert.match(script, /async function runCleanupWorkerOnce\(cleanupJobId\)/);
  assert.match(script, /["']scripts\/d46-fixture-cleanup\.mjs["']/);
  assert.doesNotMatch(script, /src\/jobs\/album-image-cleanup\.js/);
  assert.ok(
    (script.match(/runCleanupWorkerOnce\(Number\(cleanup\.id\)\)/g) || []).length >= 2,
    "each D46 cleanup invocation must carry its fixture cleanup job id"
  );
  const guard = runner.indexOf("assertD46IsolatedSmokeEnvironment(process.env)");
  const cleanupImport = runner.indexOf('await import("../apps/api/src/modules/album-image/cleanup.js")');
  assert.ok(guard >= 0 && cleanupImport > guard, "the runner must guard before loading cleanup dependencies");
  assert.match(runner, /mediaCleanupJobIds:\s*\[cleanupJobId\]/);
  assert.match(runner, /status !== ["']cleaned["']/);
  assert.doesNotMatch(runner, /deleteCosObject|headCosObject/);
});

test("D46 cleanup records automatic setup text proposals by exact post-snapshot IDs", async () => {
  const script = await readFile(
    new URL("../../../scripts/d46-author-private-content-api-smoke.js", import.meta.url),
    "utf8"
  );
  const mainStart = script.indexOf("async function main()");
  const mainEnd = script.indexOf("\ntry {\n  await main();", mainStart);
  const main = script.slice(mainStart, mainEnd);
  const trackerStart = script.indexOf("async function collectNewAuthorTextProposals");
  const trackerEnd = script.indexOf("\nasync function collectTrackedArtifacts", trackerStart);

  assert.match(script, /async function currentAuthorTextProposalHighWaterMark\(/);
  assert.ok(trackerStart >= 0 && trackerEnd > trackerStart, "setup proposal tracker must be defined");
  const tracker = script.slice(trackerStart, trackerEnd);
  assert.match(
    tracker,
    /FROM content_moderation_text_proposals\s+WHERE created_by_user_id = \? AND id > \?/,
    "automatic proposals must be discovered only after the fixture snapshot"
  );
  assert.match(tracker, /addTrackedRows\(fixture\.proposalIds, proposals\)/);
  assert.match(tracker, /addTrackedRows\(fixture\.jobIds, proposals, "moderation_job_id"\)/);

  const snapshot = main.indexOf("currentAuthorTextProposalHighWaterMark");
  const setup = main.indexOf("await createMediaFixture");
  const collect = main.indexOf("await collectNewAuthorTextProposals");
  assert.ok(snapshot >= 0 && snapshot < setup, "fixture setup must first take an ID snapshot");
  assert.ok(collect > setup, "fixture setup must record only the new exact proposal IDs");
});

test("D46 cleanup preserves the setup proposal high-water mark through a failed setup", async () => {
  const script = await readFile(
    new URL("../../../scripts/d46-author-private-content-api-smoke.js", import.meta.url),
    "utf8"
  );
  const mainStart = script.indexOf("async function main()");
  const mainEnd = script.indexOf("\ntry {\n  await main();", mainStart);
  const main = script.slice(mainStart, mainEnd);
  const artifactCollectorStart = script.indexOf("async function collectTrackedArtifacts");
  const artifactCollectorEnd = script.indexOf("\nasync function cleanupFixture", artifactCollectorStart);
  const artifactCollector = script.slice(artifactCollectorStart, artifactCollectorEnd);

  assert.match(script, /setupTextProposalHighWaterMark:\s*null/);
  assert.match(
    main,
    /fixture\.setupTextProposalHighWaterMark\s*=\s*await currentAuthorTextProposalHighWaterMark\(/,
    "the snapshot must survive until finally cleanup"
  );
  assert.ok(artifactCollectorStart >= 0 && artifactCollectorEnd > artifactCollectorStart);
  assert.match(
    artifactCollector,
    /await collectNewAuthorTextProposals\(\s*database,\s*fixture,\s*fixture\.setupTextProposalHighWaterMark\s*\)/,
    "finally cleanup must recover automatic proposals if setup throws before post-setup collection"
  );
});

test("D46 acceptance serializes the dedicated fixture database before any fixture write", async () => {
  const script = await readFile(
    new URL("../../../scripts/d46-author-private-content-api-smoke.js", import.meta.url),
    "utf8"
  );
  const mainStart = script.indexOf("async function main()");
  const mainEnd = script.indexOf("\ntry {\n  await main();", mainStart);
  const main = script.slice(mainStart, mainEnd);

  assert.match(script, /const D46_FIXTURE_LOCK_NAME = "pinche-d46-isolated-acceptance"/);
  assert.match(script, /async function acquireD46FixtureLock\(/);
  assert.match(script, /SELECT GET_LOCK\(\?, 0\) AS acquired/);
  assert.match(script, /async function releaseD46FixtureLock\(/);
  assert.match(script, /SELECT RELEASE_LOCK\(\?\) AS released/);

  const databaseIdentity = main.indexOf("SELECT DATABASE() AS database_name");
  const acquire = main.indexOf("await acquireD46FixtureLock(database)");
  const firstLogin = main.indexOf('login("dev-d46-admin")');
  const cleanup = main.indexOf("await cleanupFixture(database, fixture)");
  const release = main.indexOf("await releaseD46FixtureLock(database)");
  assert.ok(databaseIdentity >= 0 && acquire > databaseIdentity && acquire < firstLogin);
  assert.ok(release > cleanup, "the fixture lock must survive cleanup and residue validation");
});

test("D46 acceptance rejects a green result when its dedicated transient tables retain rows", async () => {
  const script = await readFile(
    new URL("../../../scripts/d46-author-private-content-api-smoke.js", import.meta.url),
    "utf8"
  );
  const mainStart = script.indexOf("async function main()");
  const mainEnd = script.indexOf("\ntry {\n  await main();", mainStart);
  const main = script.slice(mainStart, mainEnd);

  assert.match(script, /async function assertNoD46FixtureResidue\(/);
  assert.match(script, /FROM content_moderation_jobs/);
  assert.match(script, /FROM content_moderation_text_proposals/);
  assert.match(script, /FROM content_moderation_provider_attempts/);
  assert.match(script, /FROM session_album_photos/);
  assert.match(script, /FROM session_album_upload_intents/);
  assert.match(script, /FROM session_album_object_cleanup_jobs/);

  const cleanup = main.indexOf("await cleanupFixture(database, fixture)");
  const residue = main.indexOf("await assertNoD46FixtureResidue(database)");
  assert.ok(cleanup >= 0, "D46 acceptance must clean its fixture");
  assert.ok(residue > cleanup, "D46 acceptance must prove its dedicated transient tables are empty after cleanup");
});

test("D46 isolated HTTP acceptance covers second-admin isolation, cancellation disappearance, review callbacks, and image TTL", async () => {
  const script = await readFile(
    new URL("../../../scripts/d46-author-private-content-api-smoke.js", import.meta.url),
    "utf8"
  );

  assert.match(script, /async function ensureLocalSystemAdmin\(/);
  assert.match(script, /await ensureLocalSystemAdmin\(database, fixture, observer\.user\?\.id\)/);
  assert.ok(
    (script.match(/observer\s*=\s*await login\(/g) || []).length >= 2,
    "the second administrator must receive a fresh role-bearing token"
  );
  assert.match(script, /expect\(observer\.roles\.includes\("system_admin"\)\)/);
  assert.match(script, /async function assertAuthorDraftAbsent\(/);
  assert.ok(
    (script.match(/await assertAuthorDraftAbsent\(/g) || []).length >= 2,
    "both cancelled author drafts must disappear from the author reader"
  );
  assert.match(script, /Result:\s*2/);
  assert.match(script, /status === "review"/);
  assert.match(script, /media_url_expires_at/);
  assert.match(script, /60_000/);
});

test("D46 isolated HTTP acceptance reads pending image and video bytes before callbacks", async () => {
  const script = await readFile(
    new URL("../../../scripts/d46-author-private-content-api-smoke.js", import.meta.url),
    "utf8"
  );
  const imagePendingPreview = script.indexOf('activeStage = "image-pending-preview"');
  const imageCallback = script.indexOf("const adapted = await addImageModerationFixture");
  const videoPendingPreview = script.indexOf('activeStage = "video-pending-preview"');
  const reviewCallback = script.indexOf("const reviewCallback = await sendTencentVideoCallback");

  assert.ok(imagePendingPreview >= 0 && imagePendingPreview < imageCallback);
  assert.ok(videoPendingPreview >= 0 && videoPendingPreview < reviewCallback);
  assert.match(script, /const pendingAuthorAlbum\s*=\s*await getAlbum\(/);
  assert.match(script, /const pendingImagePreview\s*=\s*await request\("GET", pendingImagePreviewUrl, \{ expected: \[200\], binary: true \}\)/);
  assert.match(script, /const pendingAuthorVideoUrl\s*=\s*await request\("GET", `\/api\/session-album\/media\/\$\{videoId\}\/video-url`,/);
  assert.match(script, /const pendingVideoPreview\s*=\s*await request\("GET", pendingVideoPreviewUrl, \{[\s\S]*range: "bytes=0-7"[\s\S]*expected: \[206\][\s\S]*binary: true/);
});

test("D46 encrypted image callback covers review isolation before an admin rejection", async () => {
  const script = await readFile(
    new URL("../../../scripts/d46-author-private-content-api-smoke.js", import.meta.url),
    "utf8"
  );
  const imageStart = script.indexOf("async function runImageAcceptance");
  const imageEnd = script.indexOf("\nasync function createPendingVideoFixture", imageStart);
  const imageFlow = script.slice(imageStart, imageEnd);

  assert.match(script, /const WECHAT_IMAGE_CALLBACK_SUGGESTIONS = new Set\(\["review", "risky"\]\)/);
  assert.match(script, /if \(!WECHAT_IMAGE_CALLBACK_SUGGESTIONS\.has\(suggestion\)\) throw smokeFailure\(\)/);
  assert.match(
    imageFlow,
    /createWechatEncryptedCallback\(adapted\.traceId, \{ suggestion: "review" \}\)/
  );
  const reviewStatus = imageFlow.indexOf('status === "review"');
  const reviewPreview = imageFlow.indexOf('activeStage = "image-review-preview"');
  const reviewIsolation = imageFlow.indexOf('activeStage = "image-review-isolation"');
  const adminReject = imageFlow.indexOf(
    '`/api/admin/content-moderation/${adapted.jobId}/reject`'
  );
  const rejectedStatus = imageFlow.indexOf('status === "rejected"');
  assert.ok(reviewStatus >= 0 && reviewPreview > reviewStatus);
  assert.ok(reviewIsolation > reviewPreview && adminReject > reviewIsolation);
  assert.ok(rejectedStatus > adminReject);
  assert.match(
    imageFlow,
    /const reviewImagePreview\s*=\s*await request\("GET", reviewImagePreviewUrl, \{ expected: \[200\], binary: true \}\)/
  );
  assert.match(imageFlow, /await assertImageHiddenFromNonAuthors\(/);
  assert.doesNotMatch(script, /console\.(?:log|error)\([^\n]*(?:suggestion|suggest|providerResult)/i);
});

test("D46 isolated HTTP acceptance debug output is opt-in and exposes only a fixed stage name", async () => {
  const script = await readFile(
    new URL("../../../scripts/d46-author-private-content-api-smoke.js", import.meta.url),
    "utf8"
  );

  assert.match(script, /D46_SMOKE_DEBUG\s*===\s*["']1["']/);
  assert.match(script, /D46 isolated HTTP acceptance failed at \$\{activeStage\}/);
  assert.match(script, /activeStage\s*=\s*["']text-replacement-link["']/);
  assert.match(script, /activeStage\s*=\s*["']image-create["']/);
  assert.match(script, /activeStage\s*=\s*["']image-create-response["']/);
  assert.match(script, /activeStage\s*=\s*["']image-create-payload["']/);
  assert.match(script, /activeStage\s*=\s*["']image-pending-preview["']/);
  assert.match(script, /activeStage\s*=\s*["']video-pending-preview["']/);
  assert.doesNotMatch(script, /console\.error\(\s*error/);
  assert.doesNotMatch(script, /console\.error\(\s*error\?\./);
});
