import crypto from "node:crypto";

const LOCAL_MYSQL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const D46_SMOKE_DATABASE = "pinche_d46_test";
const D46_SMOKE_MYSQL_PORT = 3346;
const D46_SMOKE_MYSQL_USER = "pinche_d46";
const D46_SMOKE_MYSQL_PASSWORD = "pinche_d46_local_only";
const D46_SMOKE_PORT = 3046;
const D46_SMOKE_APP_BASE_URL = "http://127.0.0.1:3046";
const D46_SMOKE_REDIS_URL = "redis://127.0.0.1:6446/15";
const D46_SMOKE_WECHAT_APP_ID = "wx-d46-local";
const D46_SMOKE_WECHAT_APP_SECRET = "d46-local-placeholder";
const D46_SMOKE_WECHAT_EVENT_TOKEN = "d46-local-wechat-callback-token-0000000000";
const D46_SMOKE_WECHAT_EVENT_AES_KEY = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU";
const D46_SMOKE_COS_SECRET_ID = "d46-local-fake-id";
const D46_SMOKE_COS_SECRET_KEY = "d46-local-fake-key";
const D46_SMOKE_COS_BUCKET = "d46-local-fake-bucket";
const D46_SMOKE_COS_REGION = "ap-nanjing";
const D46_SMOKE_VIDEO_REGION = "ap-nanjing";
const D46_SMOKE_VIDEO_BIZ_TYPE = "d46-local-fake-policy";
const D46_SMOKE_VIDEO_CALLBACK_URL =
  "http://127.0.0.1:3046/api/internal/content-moderation/tencent-video/callback";
const D46_SMOKE_VIDEO_CALLBACK_TOKEN = "d46-local-video-callback-token-0000000000";
const D46_SMOKE_ENVIRONMENT_LOCKS = Object.freeze([
  "DATABASE_TARGET_LOCK",
  "DATABASE_TARGET_LOCK_HOST"
]);
const D46_SMOKE_EXPLICIT_EMPTY_ENVIRONMENT_NAMES = Object.freeze([
  "TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN",
  "COS_CI_CALLBACK_TOKEN",
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
  "WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_CREATED",
  "WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_REVIEWED"
]);
const D46_SMOKE_EXPLICIT_FALSE_ENVIRONMENT_NAMES = Object.freeze([
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED",
  "CONTENT_MODERATION_ORPHAN_SCAN_ENABLED",
  "CONTENT_MODERATION_ORPHAN_CLEANUP_ENABLED",
  "WECHAT_SUBSCRIBE_MESSAGE_ENABLED"
]);
const D46_SMOKE_IMAGE_URL = /^d46-smoke-image:\/\/[a-f0-9]{32}$/;
const MAX_AUTHOR_VIDEO_CAPABILITY_SECONDS = 60;
const BOOLEAN_TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function envValue(env, name) {
  return typeof env?.[name] === "string" ? env[name].trim() : "";
}

function explicitlyExactEnvironmentValue(env, name, expectedValue) {
  return Object.prototype.hasOwnProperty.call(env || {}, name) && env?.[name] === expectedValue;
}

function explicitlyEmptyEnvironmentValue(env, name) {
  return explicitlyExactEnvironmentValue(env, name, "");
}

function normalizedHost(value) {
  return String(value || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function booleanEnvironmentValue(env, name) {
  return BOOLEAN_TRUE_VALUES.has(envValue(env, name).toLowerCase());
}

function d46SmokeError(message) {
  return new TypeError(`D46 isolated smoke ${message}`);
}

function opaqueDigest(value, length = 32) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function capabilityTtlSeconds(value) {
  const ttl = Number(value);
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > MAX_AUTHOR_VIDEO_CAPABILITY_SECONDS) {
    throw d46SmokeError("author video capability TTL must be between 1 and 60 seconds");
  }
  return ttl;
}

function normalizedVideoRecord(record) {
  const mediaId = positiveInteger(record?.mediaId);
  const userId = positiveInteger(record?.userId);
  const mediaType = String(record?.mediaType || "");
  const previewPath = String(record?.previewPath || "");
  const objectVersion = String(record?.objectVersion || "");
  if (
    mediaId === null ||
    userId === null ||
    mediaType !== "video" ||
    !/^\/uploads\/session-album\/videos\/(?:display|source)\/[A-Za-z0-9._-]+\.mp4$/.test(previewPath) ||
    !objectVersion
  ) {
    return null;
  }
  return { mediaId, userId, mediaType, previewPath, objectVersion };
}

export function assertD46IsolatedSmokeEnvironment(env = process.env) {
  const nodeEnvIsTest = envValue(env, "NODE_ENV") === "test";
  const mockLoginEnabled = envValue(env, "WECHAT_MOCK_LOGIN") === "true";
  const isolationEnabled = envValue(env, "D46_SMOKE_ISOLATED") === "1";
  const mysqlHost = normalizedHost(envValue(env, "MYSQL_HOST"));
  const localMysql = LOCAL_MYSQL_HOSTS.has(mysqlHost);
  const testMysqlPort = envValue(env, "MYSQL_PORT") === String(D46_SMOKE_MYSQL_PORT);
  const testDatabase = envValue(env, "MYSQL_DATABASE") === D46_SMOKE_DATABASE;
  const testMysqlUser = envValue(env, "MYSQL_USER") === D46_SMOKE_MYSQL_USER;
  const testMysqlPassword = envValue(env, "MYSQL_PASSWORD") === D46_SMOKE_MYSQL_PASSWORD;
  const testPort = envValue(env, "PORT") === String(D46_SMOKE_PORT);
  const testAppBaseUrl = envValue(env, "APP_BASE_URL") === D46_SMOKE_APP_BASE_URL;
  const redisEnabled = envValue(env, "REDIS_ENABLED") === "true";
  const testRedisUrl = envValue(env, "REDIS_URL") === D46_SMOKE_REDIS_URL;
  const noDatabaseTargetLock = D46_SMOKE_ENVIRONMENT_LOCKS.every((name) => !envValue(env, name));
  const cosDisabled = !booleanEnvironmentValue(env, "COS_ENABLED");
  const localWechatCredentials =
    envValue(env, "WECHAT_APP_ID") === D46_SMOKE_WECHAT_APP_ID &&
    envValue(env, "WECHAT_APP_SECRET") === D46_SMOKE_WECHAT_APP_SECRET &&
    envValue(env, "WECHAT_CONTENT_SECURITY_EVENT_TOKEN") === D46_SMOKE_WECHAT_EVENT_TOKEN &&
    envValue(env, "WECHAT_CONTENT_SECURITY_EVENT_AES_KEY") === D46_SMOKE_WECHAT_EVENT_AES_KEY;
  const localCosPlaceholders =
    envValue(env, "COS_SECRET_ID") === D46_SMOKE_COS_SECRET_ID &&
    envValue(env, "COS_SECRET_KEY") === D46_SMOKE_COS_SECRET_KEY &&
    envValue(env, "COS_BUCKET") === D46_SMOKE_COS_BUCKET &&
    envValue(env, "COS_REGION") === D46_SMOKE_COS_REGION;
  const localVideoCallback =
    envValue(env, "TENCENT_CI_VIDEO_REGION") === D46_SMOKE_VIDEO_REGION &&
    envValue(env, "TENCENT_CI_VIDEO_BIZ_TYPE") === D46_SMOKE_VIDEO_BIZ_TYPE &&
    envValue(env, "TENCENT_CI_VIDEO_CALLBACK_URL") === D46_SMOKE_VIDEO_CALLBACK_URL &&
    envValue(env, "TENCENT_CI_VIDEO_CALLBACK_TOKEN") === D46_SMOKE_VIDEO_CALLBACK_TOKEN;
  // config/env.js fills only undefined variables from .env.  These values
  // must therefore be present and exact before that module is imported.
  const noInheritedCloudConfiguration =
    D46_SMOKE_EXPLICIT_EMPTY_ENVIRONMENT_NAMES.every((name) =>
      explicitlyEmptyEnvironmentValue(env, name)
    ) &&
    D46_SMOKE_EXPLICIT_FALSE_ENVIRONMENT_NAMES.every((name) =>
      explicitlyExactEnvironmentValue(env, name, "false")
    );

  if (
    !nodeEnvIsTest ||
    !mockLoginEnabled ||
    !isolationEnabled ||
    !localMysql ||
    !testMysqlPort ||
    !testDatabase ||
    !testMysqlUser ||
    !testMysqlPassword ||
    !testPort ||
    !testAppBaseUrl ||
    !redisEnabled ||
    !testRedisUrl ||
    !noDatabaseTargetLock ||
    !cosDisabled ||
    !localWechatCredentials ||
    !localCosPlaceholders ||
    !localVideoCallback ||
    !noInheritedCloudConfiguration
  ) {
    throw d46SmokeError("environment is not local-only");
  }
  return true;
}

export function assertD46IsolatedSmokeGenericJobDisabled(jobName, env = process.env) {
  if (envValue(env, "D46_SMOKE_ISOLATED") !== "1") return;
  assertD46IsolatedSmokeEnvironment(env);
  const normalizedJobName = String(jobName || "generic-job").trim() || "generic-job";
  throw d46SmokeError(`generic job is disabled: ${normalizedJobName}`);
}

export function d46IsolatedSmokeRuntime(config, env = process.env) {
  try {
    assertD46IsolatedSmokeEnvironment(env);
  } catch {
    return false;
  }

  const envMysqlHost = normalizedHost(envValue(env, "MYSQL_HOST"));
  const envMysqlPort = Number(envValue(env, "MYSQL_PORT"));
  const envMysqlUser = envValue(env, "MYSQL_USER");
  return (
    String(config?.nodeEnv || "") === "test" &&
    config?.wechat?.mockLogin === true &&
    normalizedHost(config?.mysql?.host) === envMysqlHost &&
    config?.mysql?.port === envMysqlPort &&
    String(config?.mysql?.database || "") === D46_SMOKE_DATABASE &&
    String(config?.mysql?.user || "") === envMysqlUser &&
    config?.port === D46_SMOKE_PORT &&
    String(config?.appBaseUrl || "") === D46_SMOKE_APP_BASE_URL &&
    config?.redis?.enabled === true &&
    String(config?.redis?.url || "") === D46_SMOKE_REDIS_URL &&
    config?.cos?.enabled !== true
  );
}

export function buildD46IsolatedSmokeImageUrl(objectKey) {
  const normalizedKey = String(objectKey || "").trim();
  if (!normalizedKey) throw d46SmokeError("image object key is required");
  return `d46-smoke-image://${opaqueDigest(normalizedKey)}`;
}

export function createD46IsolatedSmokeModerationClient(runtime) {
  if (runtime !== true) throw d46SmokeError("runtime is required");

  return Object.freeze({
    async checkText({ content } = {}) {
      const text = String(content || "");
      if (text.includes("[d46:review]")) return { suggestion: "review" };
      if (text.includes("[d46:block]")) return { suggestion: "risky" };
      return { suggestion: "pass" };
    },
    async checkImage({ mediaUrl } = {}) {
      const opaqueUrl = String(mediaUrl || "");
      if (!D46_SMOKE_IMAGE_URL.test(opaqueUrl)) {
        throw d46SmokeError("image URL is invalid");
      }
      return { traceId: `d46-image-${opaqueDigest(opaqueUrl)}` };
    },
    async submitVideo({ dataId } = {}) {
      const safeDataId = String(dataId || "");
      if (!safeDataId || safeDataId.length > 512) {
        throw d46SmokeError("video data id is invalid");
      }
      return {
        JobId: `d46-video-${opaqueDigest(safeDataId, 16)}`,
        DataId: safeDataId,
        State: "Submitted"
      };
    }
  });
}

export function buildD46AuthorVideoCapabilityClaims(record, options = {}) {
  const normalizedRecord = normalizedVideoRecord(record);
  const nowSeconds = Number(options.nowSeconds);
  const ttlSeconds = capabilityTtlSeconds(options.ttlSeconds);
  if (!normalizedRecord || !Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw d46SmokeError("author video capability record is invalid");
  }
  if (typeof options.fingerprint !== "function") {
    throw d46SmokeError("author video capability fingerprint is required");
  }
  const versionFingerprint = String(options.fingerprint(normalizedRecord) || "");
  if (!versionFingerprint) throw d46SmokeError("author video capability fingerprint is invalid");
  return {
    mediaId: normalizedRecord.mediaId,
    userId: normalizedRecord.userId,
    mediaType: "video",
    versionFingerprint,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds
  };
}

export function validateD46AuthorVideoCapabilityClaims(record, claims, options = {}) {
  const normalizedRecord = normalizedVideoRecord(record);
  const nowSeconds = Number(options.nowSeconds);
  const ttlSeconds = capabilityTtlSeconds(options.ttlSeconds);
  if (
    !normalizedRecord ||
    !claims || typeof claims !== "object" ||
    !Number.isSafeInteger(nowSeconds) || nowSeconds < 0 ||
    !Number.isSafeInteger(Number(claims.iat)) ||
    !Number.isSafeInteger(Number(claims.exp)) ||
    Number(claims.exp) - Number(claims.iat) < 1 ||
    Number(claims.exp) - Number(claims.iat) > ttlSeconds ||
    nowSeconds < Number(claims.iat) || nowSeconds >= Number(claims.exp) ||
    Number(claims.mediaId) !== normalizedRecord.mediaId ||
    Number(claims.userId) !== normalizedRecord.userId ||
    String(claims.mediaType || "") !== "video" ||
    typeof options.fingerprint !== "function"
  ) {
    return null;
  }
  const expectedFingerprint = String(options.fingerprint(normalizedRecord) || "");
  return expectedFingerprint && expectedFingerprint === String(claims.versionFingerprint || "")
    ? record
    : null;
}
