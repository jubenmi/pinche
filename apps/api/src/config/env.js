import fs from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MODERATION_RETRY_LEASE_MIN_MS } from "../modules/content-moderation/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../..");

function loadDotEnv() {
  const envPath = path.join(repoRoot, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

function booleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function integerEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function integerValue(raw, fallback) {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function booleanValue(raw, fallback = false) {
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

function listEnv(name) {
  const raw = process.env[name] ?? "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringValue(env, name) {
  const raw = env[name];
  return typeof raw === "string" ? raw.trim() : "";
}

function redisHostForUrl(host) {
  if (host.includes(":") && !host.startsWith("[") && !host.endsWith("]")) {
    return `[${host}]`;
  }

  return host;
}

function redisAuthForUrl(env) {
  const username = stringValue(env, "REDIS_USERNAME");
  const password = typeof env.REDIS_PASSWORD === "string" ? env.REDIS_PASSWORD : "";

  if (!username && !password) {
    return "";
  }

  if (!username) {
    return `:${encodeURIComponent(password)}@`;
  }

  const encodedUsername = encodeURIComponent(username);
  const encodedPassword = password ? `:${encodeURIComponent(password)}` : "";
  return `${encodedUsername}${encodedPassword}@`;
}

export function buildRedisUrl(env = process.env) {
  const explicitUrl = stringValue(env, "REDIS_URL");
  if (explicitUrl) {
    return explicitUrl;
  }

  const host = redisHostForUrl(stringValue(env, "REDIS_HOST") || "127.0.0.1");
  const port = integerValue(env.REDIS_PORT, 6379);
  const database = stringValue(env, "REDIS_DB");
  const databasePath = database ? `/${encodeURIComponent(database)}` : "";
  return `redis://${redisAuthForUrl(env)}${host}:${port}${databasePath}`;
}

function normalizedHost(host) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
}

function isLocalMysqlHost(host) {
  const value = normalizedHost(host);
  return value === "localhost" || value === "127.0.0.1" || value === "0.0.0.0" || value === "::1";
}

export function assertDatabaseTargetLock(mysqlConfig, env = process.env) {
  const lock = stringValue(env, "DATABASE_TARGET_LOCK").toLowerCase();
  if (!lock) {
    return;
  }

  if (lock !== "cloud" && lock !== "online") {
    throw new Error("DATABASE_TARGET_LOCK must be cloud or online when set");
  }

  if (isLocalMysqlHost(mysqlConfig.host)) {
    throw new Error(
      `Database target is locked to ${lock}; refuse to start with local MYSQL_HOST=${mysqlConfig.host}`
    );
  }

  const expectedHost = stringValue(env, "DATABASE_TARGET_LOCK_HOST");
  if (expectedHost && normalizedHost(mysqlConfig.host) !== normalizedHost(expectedHost)) {
    throw new Error(
      `Database target is locked to ${lock}; expected MYSQL_HOST=${expectedHost}, got ${mysqlConfig.host}`
    );
  }
}

function moderationConfigurationError(message) {
  const error = new Error(message);
  error.code = "CONTENT_MODERATION_CONFIGURATION_ERROR";
  return error;
}

function boundedModerationInteger(env, name, { fallback, minimum, maximum }) {
  const raw = stringValue(env, name);
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw moderationConfigurationError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw moderationConfigurationError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function validRedisPort(raw) {
  if (!raw) return true;
  if (!/^\d+$/.test(raw)) return false;
  const port = Number(raw);
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

function validRedisHost(raw) {
  const host = String(raw || "").trim();
  if (!host || host.length > 253) return false;
  const bracketed = host.startsWith("[") || host.endsWith("]");
  if (bracketed && !(host.startsWith("[") && host.endsWith("]"))) return false;
  const candidate = bracketed ? host.slice(1, -1) : host;
  if (isIP(candidate)) return true;
  if (candidate.includes(":")) return false;
  return candidate.split(".").every((label) => (
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)
  ));
}

function validRedisUrl(raw) {
  try {
    const parsed = new URL(raw);
    return (
      (parsed.protocol === "redis:" || parsed.protocol === "rediss:") &&
      validRedisHost(parsed.hostname) &&
      validRedisPort(parsed.port)
    );
  } catch {
    return false;
  }
}

function validWechatEventAesKey(raw) {
  const encoded = String(raw || "").trim();
  if (!/^[A-Za-z0-9+/]{43}$/.test(encoded)) return false;
  const decoded = Buffer.from(`${encoded}=`, "base64");
  return decoded.length === 32;
}

const CONTENT_MODERATION_INTAKE_MODES = new Set(["legacy", "closed", "moderated"]);

function moderationNodeEnv(env) {
  return String(
    stringValue(env, "NODE_ENV") || (env === process.env ? process.env.NODE_ENV : "") || "development"
  ).trim().toLowerCase();
}

function contentModerationIntakeMode(env, name, { nodeEnv = moderationNodeEnv(env) } = {}) {
  const configured = stringValue(env, name).toLowerCase();
  const mode = configured || (nodeEnv === "production" ? "closed" : "legacy");
  if (!CONTENT_MODERATION_INTAKE_MODES.has(mode)) {
    throw moderationConfigurationError(
      `${name} must be one of legacy, closed, or moderated`
    );
  }
  return mode;
}

export function buildContentModerationConfig(env = process.env) {
  const nodeEnv = moderationNodeEnv(env);
  return {
    nodeEnv,
    enabled: booleanValue(env.CONTENT_MODERATION_ENABLED, false),
    wechatTextEnabled: booleanValue(env.CONTENT_MODERATION_WECHAT_TEXT_ENABLED, false),
    wechatImageEnabled: booleanValue(env.CONTENT_MODERATION_WECHAT_IMAGE_ENABLED, false),
    textIntakeMode: contentModerationIntakeMode(env, "CONTENT_MODERATION_TEXT_INTAKE_MODE", {
      nodeEnv
    }),
    imageIntakeMode: contentModerationIntakeMode(env, "CONTENT_MODERATION_IMAGE_INTAKE_MODE", {
      nodeEnv
    }),
    videoIntakeMode: contentModerationIntakeMode(env, "CONTENT_MODERATION_VIDEO_INTAKE_MODE", {
      nodeEnv
    }),
    redisEnabled: booleanValue(env.REDIS_ENABLED, false),
    redisUrl: stringValue(env, "REDIS_URL"),
    redisHost: stringValue(env, "REDIS_HOST"),
    redisPort: stringValue(env, "REDIS_PORT"),
    wechatAppId: stringValue(env, "WECHAT_APP_ID"),
    wechatAppSecret: stringValue(env, "WECHAT_APP_SECRET"),
    wechatEventToken: stringValue(env, "WECHAT_CONTENT_SECURITY_EVENT_TOKEN"),
    wechatEventAesKey: stringValue(env, "WECHAT_CONTENT_SECURITY_EVENT_AES_KEY"),
    tencentVideoEnabled: booleanValue(env.CONTENT_MODERATION_TENCENT_VIDEO_ENABLED, false),
    tencentVideoRegion:
      stringValue(env, "TENCENT_CI_VIDEO_REGION") || stringValue(env, "COS_REGION"),
    tencentVideoPolicyId: stringValue(env, "TENCENT_CI_VIDEO_BIZ_TYPE"),
    tencentVideoCallbackUrl: stringValue(env, "TENCENT_CI_VIDEO_CALLBACK_URL"),
    tencentVideoCallbackToken: stringValue(env, "TENCENT_CI_VIDEO_CALLBACK_TOKEN"),
    tencentVideoCallbackPreviousToken: stringValue(
      env,
      "TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN"
    ),
    retryLimit: boundedModerationInteger(env, "CONTENT_MODERATION_RETRY_LIMIT", {
      fallback: 8,
      minimum: 1,
      maximum: 20
    }),
    retryPollMs: boundedModerationInteger(env, "CONTENT_MODERATION_RETRY_POLL_MS", {
      fallback: 30_000,
      minimum: 1_000,
      maximum: 300_000
    }),
    retryBatchSize: boundedModerationInteger(env, "CONTENT_MODERATION_RETRY_BATCH_SIZE", {
      fallback: 25,
      minimum: 1,
      maximum: 100
    }),
    retryLeaseMs: boundedModerationInteger(env, "CONTENT_MODERATION_RETRY_LEASE_MS", {
      fallback: MODERATION_RETRY_LEASE_MIN_MS,
      minimum: MODERATION_RETRY_LEASE_MIN_MS,
      maximum: 300_000
    }),
    queueAlertAgeSeconds: boundedModerationInteger(env, "CONTENT_MODERATION_QUEUE_ALERT_AGE_SECONDS", {
      fallback: 900,
      minimum: 60,
      maximum: 7 * 24 * 60 * 60
    }),
    orphanScanEnabled: booleanValue(env.CONTENT_MODERATION_ORPHAN_SCAN_ENABLED, false),
    orphanCleanupEnabled: booleanValue(env.CONTENT_MODERATION_ORPHAN_CLEANUP_ENABLED, false),
    orphanScanPollMs: boundedModerationInteger(env, "CONTENT_MODERATION_ORPHAN_SCAN_POLL_MS", {
      fallback: 300_000,
      minimum: 60_000,
      maximum: 24 * 60 * 60 * 1000
    }),
    orphanScanBatchSize: boundedModerationInteger(env, "CONTENT_MODERATION_ORPHAN_SCAN_BATCH_SIZE", {
      fallback: 100,
      minimum: 1,
      maximum: 1000
    }),
    orphanRetentionHours: boundedModerationInteger(env, "CONTENT_MODERATION_ORPHAN_RETENTION_HOURS", {
      fallback: 48,
      minimum: 24,
      maximum: 30 * 24
    }),
    cosEnabled: booleanValue(env.COS_ENABLED, false),
    secretId: stringValue(env, "COS_SECRET_ID"),
    secretKey: stringValue(env, "COS_SECRET_KEY"),
    bucket: stringValue(env, "COS_BUCKET"),
    cosRegion: stringValue(env, "COS_REGION"),
    productionPreflight: {
      enabled: booleanValue(env.CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED, false),
      confirmation: stringValue(env, "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CONFIRMATION"),
      operatorUserId: boundedModerationInteger(env, "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_OPERATOR_USER_ID", {
        fallback: 0,
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER
      }),
      testAdminUserId: boundedModerationInteger(env, "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TEST_ADMIN_USER_ID", {
        fallback: 0,
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER
      }),
      referenceHmacKey: stringValue(env, "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_REFERENCE_HMAC_KEY"),
      imageFingerprint: stringValue(env, "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_IMAGE_FINGERPRINT"),
      videoFingerprint: stringValue(env, "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_VIDEO_FINGERPRINT"),
      releaseFingerprint: stringValue(env, "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_RELEASE_FINGERPRINT"),
      callbackTimeoutMs: boundedModerationInteger(
        env,
        "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CALLBACK_TIMEOUT_MS",
        { fallback: 15 * 60 * 1000, minimum: 60_000, maximum: 60 * 60 * 1000 }
      ),
      timeoutPollMs: boundedModerationInteger(
        env,
        "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TIMEOUT_POLL_MS",
        { fallback: 60_000, minimum: 10_000, maximum: 300_000 }
      ),
      timeoutBatchSize: boundedModerationInteger(
        env,
        "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TIMEOUT_BATCH_SIZE",
        { fallback: 10, minimum: 1, maximum: 100 }
      )
    }
  };
}

export function assertContentModerationConfig(
  moderationConfig,
  { nodeEnv = process.env.NODE_ENV || "development" } = {}
) {
  if (!moderationConfig) return moderationConfig;
  const normalizedNodeEnv = String(nodeEnv || "development").trim().toLowerCase();
  const missing = [];
  const wechatModerationEnabled = Boolean(
    moderationConfig.wechatTextEnabled || moderationConfig.wechatImageEnabled
  );
  if (normalizedNodeEnv === "production") {
    for (const [name, mode] of [
      ["CONTENT_MODERATION_TEXT_INTAKE_MODE", moderationConfig.textIntakeMode],
      ["CONTENT_MODERATION_IMAGE_INTAKE_MODE", moderationConfig.imageIntakeMode],
      ["CONTENT_MODERATION_VIDEO_INTAKE_MODE", moderationConfig.videoIntakeMode]
    ]) {
      if (mode === "legacy") missing.push(`${name} must not be legacy in production`);
    }
  }
  if (moderationConfig.orphanCleanupEnabled && !moderationConfig.orphanScanEnabled) {
    missing.push("CONTENT_MODERATION_ORPHAN_SCAN_ENABLED");
  }
  if (moderationConfig.orphanScanEnabled) {
    if (!moderationConfig.cosEnabled) missing.push("COS_ENABLED");
    if (!moderationConfig.secretId) missing.push("COS_SECRET_ID");
    if (!moderationConfig.secretKey) missing.push("COS_SECRET_KEY");
    if (!moderationConfig.bucket) missing.push("COS_BUCKET");
    if (!moderationConfig.cosRegion) missing.push("COS_REGION");
  }
  if (normalizedNodeEnv === "production" && wechatModerationEnabled) {
    if (!moderationConfig.redisEnabled) missing.push("REDIS_ENABLED");
    if (moderationConfig.redisUrl) {
      if (!validRedisUrl(moderationConfig.redisUrl)) missing.push("valid REDIS_URL");
    } else if (!moderationConfig.redisHost) {
      missing.push("REDIS_URL or REDIS_HOST");
    } else {
      if (!validRedisHost(moderationConfig.redisHost)) missing.push("valid REDIS_HOST");
      if (!validRedisPort(moderationConfig.redisPort)) missing.push("valid REDIS_PORT");
    }
    if (!moderationConfig.wechatAppId) missing.push("WECHAT_APP_ID");
    if (!moderationConfig.wechatAppSecret) missing.push("WECHAT_APP_SECRET");
    if (!moderationConfig.wechatEventToken) missing.push("WECHAT_CONTENT_SECURITY_EVENT_TOKEN");
    if (!moderationConfig.wechatEventAesKey) {
      missing.push("WECHAT_CONTENT_SECURITY_EVENT_AES_KEY");
    } else if (!validWechatEventAesKey(moderationConfig.wechatEventAesKey)) {
      missing.push("valid WECHAT_CONTENT_SECURITY_EVENT_AES_KEY");
    }
    if (moderationConfig.wechatImageEnabled) {
      if (!moderationConfig.cosEnabled) missing.push("COS_ENABLED");
      if (!moderationConfig.secretId) missing.push("COS_SECRET_ID");
      if (!moderationConfig.secretKey) missing.push("COS_SECRET_KEY");
      if (!moderationConfig.bucket) missing.push("COS_BUCKET");
      if (!moderationConfig.cosRegion) missing.push("COS_REGION");
    }
  }
  if (
    moderationConfig.productionPreflight?.enabled
  ) {
    if (!moderationConfig.productionPreflight.confirmation || moderationConfig.productionPreflight.confirmation.length < 32) {
      missing.push("CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CONFIRMATION");
    }
    if (!moderationConfig.productionPreflight.operatorUserId) {
      missing.push("CONTENT_MODERATION_PRODUCTION_PREFLIGHT_OPERATOR_USER_ID");
    }
    if (!moderationConfig.productionPreflight.testAdminUserId) {
      missing.push("CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TEST_ADMIN_USER_ID");
    }
    if (!moderationConfig.productionPreflight.referenceHmacKey || moderationConfig.productionPreflight.referenceHmacKey.length < 32) {
      missing.push("CONTENT_MODERATION_PRODUCTION_PREFLIGHT_REFERENCE_HMAC_KEY");
    }
    if (!moderationConfig.productionPreflight.imageFingerprint) {
      missing.push("CONTENT_MODERATION_PRODUCTION_PREFLIGHT_IMAGE_FINGERPRINT");
    }
    if (!moderationConfig.productionPreflight.videoFingerprint) {
      missing.push("CONTENT_MODERATION_PRODUCTION_PREFLIGHT_VIDEO_FINGERPRINT");
    }
    if (!moderationConfig.productionPreflight.releaseFingerprint) {
      missing.push("CONTENT_MODERATION_PRODUCTION_PREFLIGHT_RELEASE_FINGERPRINT");
    }
  }
  if (
    !moderationConfig.enabled &&
    !wechatModerationEnabled &&
    !moderationConfig.tencentVideoEnabled &&
    !moderationConfig.productionPreflight?.enabled
  ) {
    if (missing.length > 0) {
      throw moderationConfigurationError(`content moderation configuration is missing: ${missing.join(", ")}`);
    }
    return moderationConfig;
  }
  if (moderationConfig.tencentVideoEnabled && !moderationConfig.tencentVideoRegion) {
    missing.push("TENCENT_CI_VIDEO_REGION");
  }
  if (moderationConfig.tencentVideoEnabled && !moderationConfig.secretId) missing.push("COS_SECRET_ID");
  if (moderationConfig.tencentVideoEnabled && !moderationConfig.secretKey) missing.push("COS_SECRET_KEY");
  if (moderationConfig.tencentVideoEnabled && !moderationConfig.bucket) missing.push("COS_BUCKET");
  if (moderationConfig.tencentVideoEnabled && !moderationConfig.tencentVideoPolicyId) {
    missing.push("TENCENT_CI_VIDEO_BIZ_TYPE");
  }
  if (moderationConfig.tencentVideoEnabled) {
    if (!moderationConfig.tencentVideoCallbackUrl) missing.push("TENCENT_CI_VIDEO_CALLBACK_URL");
    if (!moderationConfig.tencentVideoCallbackToken || moderationConfig.tencentVideoCallbackToken.length < 32) {
      missing.push("TENCENT_CI_VIDEO_CALLBACK_TOKEN");
    }
    if (
      moderationConfig.tencentVideoCallbackPreviousToken &&
      moderationConfig.tencentVideoCallbackPreviousToken.length < 32
    ) {
      missing.push("valid TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN");
    }
    if (normalizedNodeEnv === "production" && !/^https:\/\//i.test(moderationConfig.tencentVideoCallbackUrl)) {
      throw moderationConfigurationError("moderation callback URL must use HTTPS in production");
    }
  }
  if (missing.length > 0) {
    throw moderationConfigurationError(`content moderation configuration is missing: ${missing.join(", ")}`);
  }
  return moderationConfig;
}

const mysqlConfig = {
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: integerEnv("MYSQL_PORT", 3307),
  database: process.env.MYSQL_DATABASE || "pinche",
  user: process.env.MYSQL_USER || "pinche",
  password: process.env.MYSQL_PASSWORD || "pinche_dev_password"
};

assertDatabaseTargetLock(mysqlConfig);
const contentModerationConfig = buildContentModerationConfig();
assertContentModerationConfig(contentModerationConfig, {
  nodeEnv: process.env.NODE_ENV || "development"
});

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: integerEnv("PORT", 3018),
  appBaseUrl: process.env.APP_BASE_URL || "http://localhost:3018",
  mysql: mysqlConfig,
  redis: {
    enabled: booleanEnv("REDIS_ENABLED", false),
    url: buildRedisUrl()
  },
  cos: {
    enabled: booleanEnv("COS_ENABLED", false),
    secretId: process.env.COS_SECRET_ID || "",
    secretKey: process.env.COS_SECRET_KEY || "",
    bucket: process.env.COS_BUCKET || "",
    region: process.env.COS_REGION || "",
    ciCallbackToken: process.env.COS_CI_CALLBACK_TOKEN || ""
  },
  albumMedia: {
    directMediaUrls: booleanEnv("COS_DIRECT_MEDIA_URLS", false),
    directUploadRequired: booleanEnv("COS_DIRECT_UPLOAD_REQUIRED", false)
  },
  contentModeration: contentModerationConfig,
  wechat: {
    mockLogin: booleanEnv("WECHAT_MOCK_LOGIN", true),
    appId: process.env.WECHAT_APP_ID || "wx-placeholder",
    appSecret: process.env.WECHAT_APP_SECRET || "",
    contentSecurityEventToken: process.env.WECHAT_CONTENT_SECURITY_EVENT_TOKEN || "",
    contentSecurityEventAesKey: process.env.WECHAT_CONTENT_SECURITY_EVENT_AES_KEY || ""
  },
  subscribeMessage: {
    enabled: booleanEnv("WECHAT_SUBSCRIBE_MESSAGE_ENABLED", false),
    signupCreatedTemplateId: process.env.WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_CREATED || "",
    signupReviewedTemplateId: process.env.WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_REVIEWED || "",
    sessionRescheduledTemplateId:
      process.env.WECHAT_SUBSCRIBE_SESSION_RESCHEDULED_TEMPLATE_ID || "",
    timeoutMs: integerEnv("WECHAT_SUBSCRIBE_MESSAGE_TIMEOUT_MS", 8000)
  },
  map: {
    tencentKey:
      process.env.TENCENT_MAP_SERVICE_KEY ||
      process.env.TENCENT_MAP_KEY ||
      process.env.VITE_TENCENT_MAP_KEY ||
      "",
    amapKey: process.env.AMAP_WEB_SERVICE_KEY || process.env.GAODE_MAP_KEY || ""
  },
  sessionSecret:
    process.env.SESSION_SECRET ||
    "local-development-session-secret-change-before-production",
  bootstrapAdminOpenids: listEnv("BOOTSTRAP_ADMIN_OPENIDS"),
  bootstrapAdminUnionids: listEnv("BOOTSTRAP_ADMIN_UNIONIDS")
};

export function publicConfig() {
  return {
    nodeEnv: config.nodeEnv,
    port: config.port,
    redisEnabled: config.redis.enabled,
    wechatMockLogin: config.wechat.mockLogin,
    albumMedia: {
      directMediaUrls: config.albumMedia.directMediaUrls,
      directUploadRequired: config.albumMedia.directUploadRequired
    }
  };
}
