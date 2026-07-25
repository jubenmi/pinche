import { config, publicConfig } from "../config/env.js";
import { checkDatabaseReadiness, withDatabaseConnection, withTransaction } from "../db/mysql.js";
import { createLazyRedisRateLimitStore } from "../infra/redis/rate-limit-store.js";
import { createAuthRateLimiter, createMemoryRateLimitStore } from "../modules/auth/rate-limit.js";
import { loginWithWechatCode, verifyBusinessToken } from "../modules/auth/wechat.js";

function defaultRateLimiter() {
  return createAuthRateLimiter({
    store: config.nodeEnv === "production"
      ? createLazyRedisRateLimitStore({ url: config.redis.url })
      : createMemoryRateLimitStore(),
  });
}

export function createDependencies(overrides = {}) {
  const runtimeConfig = overrides.config || config;
  const auth = Object.freeze({
    loginWithWechatCode,
    verifyBusinessToken,
    ...(overrides.auth || {}),
  });
  const database = Object.freeze({
    withConnection: withDatabaseConnection,
    withTransaction,
    ...(overrides.database || {}),
  });
  return Object.freeze({
    config: runtimeConfig,
    publicConfig: overrides.publicConfig || publicConfig,
    checkDatabaseReadiness: overrides.checkDatabaseReadiness || checkDatabaseReadiness,
    database,
    redis: Object.freeze({ url: runtimeConfig.redis.url, enabled: runtimeConfig.redis.enabled }),
    cos: Object.freeze({ ...runtimeConfig.cos }),
    auth,
    clock: overrides.clock || Object.freeze({ now: Date.now, date: () => new Date() }),
    logger: overrides.logger || console,
    rateLimiter: overrides.rateLimiter || defaultRateLimiter(),
  });
}
