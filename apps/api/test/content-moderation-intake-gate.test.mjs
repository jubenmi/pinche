import assert from "node:assert/strict";
import test from "node:test";

import {
  assertContentModerationConfig,
  buildContentModerationConfig
} from "../src/config/env.js";
import {
  assertContentModerationIntake,
  resolveContentModerationIntake
} from "../src/modules/content-moderation/intake-gate.js";
import * as intakeGate from "../src/modules/content-moderation/intake-gate.js";

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    CONTENT_MODERATION_ENABLED: "true",
    CONTENT_MODERATION_WECHAT_TEXT_ENABLED: "true",
    CONTENT_MODERATION_WECHAT_IMAGE_ENABLED: "true",
    CONTENT_MODERATION_TENCENT_VIDEO_ENABLED: "true",
    CONTENT_MODERATION_TEXT_INTAKE_MODE: "moderated",
    CONTENT_MODERATION_IMAGE_INTAKE_MODE: "moderated",
    CONTENT_MODERATION_VIDEO_INTAKE_MODE: "moderated",
    COS_ENABLED: "true",
    REDIS_ENABLED: "true",
    REDIS_URL: "redis://redis.example.test:6379",
    WECHAT_APP_ID: "wx-d45-test",
    WECHAT_APP_SECRET: "wechat-app-secret",
    WECHAT_CONTENT_SECURITY_EVENT_TOKEN: "wechat-content-security-event-token",
    WECHAT_CONTENT_SECURITY_EVENT_AES_KEY: "A".repeat(43),
    TENCENT_CI_VIDEO_REGION: "ap-nanjing",
    TENCENT_CI_VIDEO_BIZ_TYPE: "video-policy",
    TENCENT_CI_VIDEO_CALLBACK_URL: "https://api.example.com/api/internal/content-moderation/tencent-video/callback",
    TENCENT_CI_VIDEO_CALLBACK_TOKEN: "x".repeat(32),
    COS_SECRET_ID: "secret-id",
    COS_SECRET_KEY: "secret-key",
    COS_BUCKET: "bucket-123",
    COS_REGION: "ap-nanjing",
    ...overrides
  };
}

test("unconfigured moderation defaults to legacy publication in every environment", () => {
  const production = buildContentModerationConfig({ NODE_ENV: "PrOdUcTiOn" });
  assert.deepEqual(
    [production.textIntakeMode, production.imageIntakeMode, production.videoIntakeMode],
    ["legacy", "legacy", "legacy"]
  );

  const development = buildContentModerationConfig({ NODE_ENV: "development" });
  assert.deepEqual(
    [development.textIntakeMode, development.imageIntakeMode, development.videoIntakeMode],
    ["legacy", "legacy", "legacy"]
  );
});

test("unavailable providers preserve direct publication unless fallback blocking is enabled", () => {
  for (const [type, provider] of [
    ["text", "CONTENT_MODERATION_WECHAT_TEXT_ENABLED"],
    ["image", "CONTENT_MODERATION_WECHAT_IMAGE_ENABLED"],
    ["video", "CONTENT_MODERATION_TENCENT_VIDEO_ENABLED"]
  ]) {
    const open = buildContentModerationConfig(productionEnv());
    assert.equal(resolveContentModerationIntake(open, type).mode, "moderated");
    assert.doesNotThrow(() => assertContentModerationIntake(open, type));

    const providerDisabled = buildContentModerationConfig(productionEnv({ [provider]: "false" }));
    assert.doesNotThrow(() => assertContentModerationIntake(providerDisabled, type));
    assert.throws(() => assertContentModerationIntake(providerDisabled, type, { fallbackBlocking: true }), {
      code: "CONTENT_MODERATION_INTAKE_CLOSED",
      statusCode: 503
    });

    const globallyDisabled = buildContentModerationConfig(productionEnv({
      CONTENT_MODERATION_ENABLED: "false"
    }));
    assert.doesNotThrow(() => assertContentModerationIntake(globallyDisabled, type));
    assert.throws(() => assertContentModerationIntake(globallyDisabled, type, { fallbackBlocking: true }), {
      code: "CONTENT_MODERATION_INTAKE_CLOSED",
      statusCode: 503
    });
  }
});

test("legacy closed mode cannot disable an available moderation capability", () => {
  const config = buildContentModerationConfig(productionEnv({
    CONTENT_MODERATION_IMAGE_INTAKE_MODE: "closed"
  }));

  for (const type of ["text", "image", "video"]) {
    assert.equal(assertContentModerationIntake(config, type).moderationRequired, true);
  }
});

test("legacy intake preserves production compatibility when moderation is not configured", () => {
  const local = buildContentModerationConfig({
    NODE_ENV: "development",
    CONTENT_MODERATION_TEXT_INTAKE_MODE: "legacy"
  });
  assert.equal(resolveContentModerationIntake(local, "text").mode, "legacy");
  assert.doesNotThrow(() => assertContentModerationIntake(local, "text"));

  const productionLegacy = buildContentModerationConfig({ NODE_ENV: "production" });
  assert.doesNotThrow(() => assertContentModerationConfig(productionLegacy, { nodeEnv: "PRODUCTION" }));
  assert.throws(() => buildContentModerationConfig({
    NODE_ENV: "production",
    CONTENT_MODERATION_TEXT_INTAKE_MODE: "accept-anything"
  }), {
    code: "CONTENT_MODERATION_CONFIGURATION_ERROR"
  });
  assert.throws(() => resolveContentModerationIntake(local, "document"), /Unsupported content moderation intake type/);
});

test("automatic capability takes priority and unavailable capability follows the fallback switch", () => {
  const capable = buildContentModerationConfig(productionEnv({
    CONTENT_MODERATION_TEXT_INTAKE_MODE: "legacy"
  }));
  assert.deepEqual(resolveContentModerationIntake(capable, "text"), {
    accepting: true,
    mode: "moderated",
    moderationRequired: true,
    reason: "ready"
  });

  const unavailable = buildContentModerationConfig({ NODE_ENV: "production" });
  assert.deepEqual(resolveContentModerationIntake(unavailable, "image"), {
    accepting: true,
    mode: "legacy",
    moderationRequired: false,
    reason: "legacy"
  });
  assert.throws(
    () => assertContentModerationIntake(unavailable, "image", { fallbackBlocking: true }),
    { code: "CONTENT_MODERATION_INTAKE_CLOSED", statusCode: 503 }
  );
});

test("production preflight readiness does not enable moderation for ordinary content", () => {
  const config = buildContentModerationConfig(productionEnv({
    CONTENT_MODERATION_WECHAT_TEXT_ENABLED: "false",
    CONTENT_MODERATION_WECHAT_IMAGE_ENABLED: "false",
    CONTENT_MODERATION_TENCENT_VIDEO_ENABLED: "false",
    CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED: "true",
    CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CONFIRMATION: "confirm-012345678901234567890123",
    CONTENT_MODERATION_PRODUCTION_PREFLIGHT_OPERATOR_USER_ID: "42",
    CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TEST_ADMIN_USER_ID: "42",
    CONTENT_MODERATION_PRODUCTION_PREFLIGHT_REFERENCE_HMAC_KEY: "h".repeat(32),
    CONTENT_MODERATION_PRODUCTION_PREFLIGHT_IMAGE_FINGERPRINT: "image-v1",
    CONTENT_MODERATION_PRODUCTION_PREFLIGHT_VIDEO_FINGERPRINT: "video-v1",
    CONTENT_MODERATION_PRODUCTION_PREFLIGHT_RELEASE_FINGERPRINT: "release-v1"
  }));

  assert.doesNotThrow(() => assertContentModerationConfig(config, { nodeEnv: "production" }));
  for (const type of ["text", "image", "video"]) {
    assert.deepEqual(resolveContentModerationIntake(config, type), {
      accepting: true,
      mode: "legacy",
      moderationRequired: false,
      reason: "legacy"
    });
    assert.throws(
      () => assertContentModerationIntake(config, type, { fallbackBlocking: true }),
      { code: "CONTENT_MODERATION_INTAKE_CLOSED", statusCode: 503 }
    );
  }
});

test("publication status is pending only when automatic moderation is required", () => {
  assert.equal(typeof intakeGate.moderationStatusForIntake, "function");
  assert.equal(
    intakeGate.moderationStatusForIntake({ moderationRequired: true }),
    "pending"
  );
  assert.equal(
    intakeGate.moderationStatusForIntake({ moderationRequired: false }),
    "approved_legacy"
  );
});
