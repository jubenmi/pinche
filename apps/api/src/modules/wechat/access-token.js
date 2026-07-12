import crypto from "node:crypto";

import { createClient } from "redis";

import { config } from "../../config/env.js";

const TOKEN_ENDPOINT = "https://api.weixin.qq.com/cgi-bin/token";
const REFRESH_MARGIN_MS = 60_000;
const LOCK_TTL_MS = 10_000;
const TOKEN_FETCH_TIMEOUT_MS = 8_000;
const LOCK_WAIT_MS = 50;
const LOCK_WAIT_TIMEOUT_MS = 2_000;
const TOKEN_INVALID_ERROR_CODES = new Set([40001, 40014, 42001]);
const CONDITIONAL_CACHE_STORE_SCRIPT = [
  "if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end",
  "redis.call('set', KEYS[2], ARGV[2], 'PX', ARGV[3])",
  "return 1"
].join(" ");

let defaultRedisClientPromise = null;
let defaultProvider = null;

function sanitizedError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  if (Number.isInteger(statusCode)) error.statusCode = statusCode;
  return error;
}

function required(value, name) {
  const text = String(value || "").trim();
  if (!text) {
    throw sanitizedError(
      "WECHAT_ACCESS_TOKEN_CONFIGURATION_ERROR",
      `WeChat ${name} is required`
    );
  }
  return text;
}

function tokenKey(appId) {
  return `wechat:access-token:${appId}`;
}

function lockKey(appId) {
  return `wechat:access-token-lock:${appId}`;
}

function parseRecord(value, now, refreshMarginMs) {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    const accessToken = typeof parsed?.accessToken === "string" ? parsed.accessToken.trim() : "";
    const expiresAt = Number(parsed?.expiresAt);
    if (!accessToken || !Number.isFinite(expiresAt) || expiresAt <= now + refreshMarginMs) return null;
    return { accessToken, expiresAt };
  } catch {
    return null;
  }
}

function cacheTtlMs(record, now) {
  return Math.max(1_000, Math.round(record.expiresAt - now));
}

function createRefreshDeadline(timeoutMs) {
  const controller = new AbortController();
  const timeoutError = sanitizedError(
    "WECHAT_ACCESS_TOKEN_REQUEST_FAILED",
    "WeChat access token request failed"
  );
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  return {
    signal: controller.signal,
    isTimeout(error) {
      return error === timeoutError;
    },
    run(operation) {
      if (controller.signal.aborted) return Promise.reject(timeoutError);
      return Promise.race([Promise.resolve().then(operation), timeout]);
    },
    close() {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  };
}

async function parseJsonResponse(response, errorCode, deadline) {
  let raw = "";
  try {
    raw = await deadline.run(() => response.text());
  } catch (error) {
    if (deadline.isTimeout(error)) throw error;
    throw sanitizedError(errorCode, "WeChat access token request failed", response?.status);
  }
  if (Buffer.byteLength(raw, "utf8") > 64 * 1024) {
    throw sanitizedError(errorCode, "WeChat access token request failed", response.status);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw sanitizedError(errorCode, "WeChat access token request failed", response.status);
  }
}

async function requestAccessToken({ appId, appSecret, fetchImpl, now, deadline }) {
  const url = new URL(TOKEN_ENDPOINT);
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", appId);
  url.searchParams.set("secret", appSecret);

  let response;
  try {
    response = await deadline.run(() => fetchImpl(url, { signal: deadline.signal }));
  } catch (error) {
    if (deadline.isTimeout(error)) throw error;
    throw sanitizedError("WECHAT_ACCESS_TOKEN_REQUEST_FAILED", "WeChat access token request failed");
  }
  const payload = await parseJsonResponse(response, "WECHAT_ACCESS_TOKEN_REQUEST_FAILED", deadline);
  if (!response.ok || Number(payload?.errcode || 0) !== 0 || !payload?.access_token) {
    throw sanitizedError(
      "WECHAT_ACCESS_TOKEN_REQUEST_FAILED",
      "WeChat access token request failed",
      response.status
    );
  }

  const expiresIn = Number(payload.expires_in);
  const seconds = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 7200;
  return {
    accessToken: String(payload.access_token),
    expiresAt: now() + seconds * 1000
  };
}

async function getDefaultRedisClient() {
  if (!config.redis.enabled) return null;
  if (!defaultRedisClientPromise) {
    const client = createClient({ url: config.redis.url });
    client.on("error", () => {});
    defaultRedisClientPromise = client.connect()
      .then(() => client)
      .catch((error) => {
        defaultRedisClientPromise = null;
        try {
          client.disconnect();
        } catch {
          // Best effort: connection failures are exposed as a redacted token error below.
        }
        throw error;
      });
  }
  try {
    return await defaultRedisClientPromise;
  } catch {
    throw sanitizedError("WECHAT_ACCESS_TOKEN_CACHE_UNAVAILABLE", "WeChat access token cache unavailable");
  }
}

function normalizeRedis(redis) {
  if (!redis) return null;
  for (const method of ["get", "set", "del", "eval"]) {
    if (typeof redis[method] !== "function") {
      throw new TypeError(`Redis adapter must provide ${method}()`);
    }
  }
  return redis;
}

async function safelyReadCachedToken(redis, key, now, refreshMarginMs) {
  if (!redis) return null;
  try {
    return parseRecord(await redis.get(key), now, refreshMarginMs);
  } catch {
    throw sanitizedError("WECHAT_ACCESS_TOKEN_CACHE_UNAVAILABLE", "WeChat access token cache unavailable");
  }
}

async function safelyStoreCachedToken({ redis, tokenKey: key, lockKey: lock, owner, record, now, deadline }) {
  let stored;
  try {
    stored = await deadline.run(() => redis.eval(CONDITIONAL_CACHE_STORE_SCRIPT, {
      keys: [lock, key],
      arguments: [owner, JSON.stringify(record), String(cacheTtlMs(record, now))]
    }));
  } catch (error) {
    if (deadline.isTimeout(error)) throw error;
    throw sanitizedError("WECHAT_ACCESS_TOKEN_CACHE_UNAVAILABLE", "WeChat access token cache unavailable");
  }
  if (Number(stored) !== 1) {
    throw sanitizedError("WECHAT_ACCESS_TOKEN_LOCK_LOST", "WeChat access token refresh lease expired");
  }
}

async function acquireLock(redis, key, owner, lockTtlMs) {
  try {
    return (await redis.set(key, owner, { NX: true, PX: lockTtlMs })) === "OK";
  } catch {
    throw sanitizedError("WECHAT_ACCESS_TOKEN_CACHE_UNAVAILABLE", "WeChat access token cache unavailable");
  }
}

async function releaseLock(redis, key, owner) {
  try {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
      { keys: [key], arguments: [owner] }
    );
  } catch {
    // The lock has a short TTL. Never replace a successful token fetch with a release error.
  }
}

async function waitForRedisToken({ redis, key, now, refreshMarginMs, sleep, waitTimeoutMs }) {
  const attempts = Math.max(1, Math.ceil(waitTimeoutMs / LOCK_WAIT_MS));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(LOCK_WAIT_MS);
    const cached = await safelyReadCachedToken(redis, key, now(), refreshMarginMs);
    if (cached) return cached;
  }
  return null;
}

export function isWechatAccessTokenInvalid(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : result;
  return TOKEN_INVALID_ERROR_CODES.has(Number(payload?.errcode));
}

export async function requestWithWechatAccessTokenRetry({
  tokenProvider,
  request,
  isTokenInvalid = isWechatAccessTokenInvalid
}) {
  if (!tokenProvider || typeof tokenProvider.getAccessToken !== "function") {
    throw new TypeError("tokenProvider.getAccessToken is required");
  }
  if (typeof request !== "function") throw new TypeError("request is required");

  const initialToken = await tokenProvider.getAccessToken();
  const initialResult = await request(initialToken);
  if (!isTokenInvalid(initialResult)) return initialResult;

  if (typeof tokenProvider.invalidate === "function") {
    await tokenProvider.invalidate(initialToken);
  }
  const refreshedToken = await tokenProvider.getAccessToken({ forceRefresh: true });
  return request(refreshedToken);
}

export function createWechatAccessTokenProvider({
  appId,
  appSecret,
  redis = null,
  getRedis = null,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  refreshMarginMs = REFRESH_MARGIN_MS,
  waitTimeoutMs = LOCK_WAIT_TIMEOUT_MS,
  lockTtlMs = LOCK_TTL_MS,
  fetchTimeoutMs = TOKEN_FETCH_TIMEOUT_MS,
  randomUUID = crypto.randomUUID
} = {}) {
  const configuredAppId = required(appId, "appId");
  const configuredAppSecret = required(appSecret, "appSecret");
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  if (typeof getRedis !== "function" && getRedis !== null) throw new TypeError("getRedis must be a function");
  if (typeof now !== "function" || typeof sleep !== "function" || typeof randomUUID !== "function") {
    throw new TypeError("token provider adapters must be functions");
  }
  if (!Number.isFinite(lockTtlMs) || lockTtlMs <= 0) {
    throw new TypeError("lockTtlMs must be a positive number");
  }
  if (!Number.isFinite(fetchTimeoutMs) || fetchTimeoutMs <= 0 || fetchTimeoutMs >= lockTtlMs) {
    throw new TypeError("fetchTimeoutMs must be shorter than lockTtlMs");
  }

  const staticRedis = normalizeRedis(redis);
  const cacheKey = tokenKey(configuredAppId);
  const refreshLockKey = lockKey(configuredAppId);
  let localRecord = null;
  let inFlight = null;
  let resolvedRedis = staticRedis;
  let resolvedRedisPromise = null;

  async function resolveRedis() {
    if (resolvedRedis || !getRedis) return resolvedRedis;
    if (!resolvedRedisPromise) {
      resolvedRedisPromise = Promise.resolve(getRedis())
        .then(normalizeRedis)
        .then((client) => {
          resolvedRedis = client;
          return client;
        });
    }
    try {
      return await resolvedRedisPromise;
    } catch {
      throw sanitizedError("WECHAT_ACCESS_TOKEN_CACHE_UNAVAILABLE", "WeChat access token cache unavailable");
    }
  }

  async function readValidToken(redisClient) {
    const current = now();
    if (localRecord && localRecord.expiresAt > current + refreshMarginMs) return localRecord;
    const cached = await safelyReadCachedToken(redisClient, cacheKey, current, refreshMarginMs);
    if (cached) localRecord = cached;
    return cached;
  }

  async function refresh({ forceRefresh = false } = {}) {
    const redisClient = await resolveRedis();
    if (!forceRefresh) {
      const cached = await readValidToken(redisClient);
      if (cached) return cached.accessToken;
    }

    if (!redisClient) {
      const deadline = createRefreshDeadline(fetchTimeoutMs);
      try {
        const record = await requestAccessToken({
          appId: configuredAppId,
          appSecret: configuredAppSecret,
          fetchImpl,
          now,
          deadline
        });
        localRecord = record;
        return record.accessToken;
      } finally {
        deadline.close();
      }
    }

    const owner = randomUUID();
    let locked = await acquireLock(redisClient, refreshLockKey, owner, lockTtlMs);
    if (!locked) {
      const fromOtherWorker = await waitForRedisToken({
        redis: redisClient,
        key: cacheKey,
        now,
        refreshMarginMs,
        sleep,
        waitTimeoutMs
      });
      if (fromOtherWorker) {
        localRecord = fromOtherWorker;
        return fromOtherWorker.accessToken;
      }
      locked = await acquireLock(redisClient, refreshLockKey, owner, lockTtlMs);
      if (!locked) {
        throw sanitizedError(
          "WECHAT_ACCESS_TOKEN_REFRESH_IN_PROGRESS",
          "WeChat access token refresh is in progress"
        );
      }
    }

    const deadline = createRefreshDeadline(fetchTimeoutMs);
    try {
      if (!forceRefresh) {
        const cached = await readValidToken(redisClient);
        if (cached) return cached.accessToken;
      }
      const record = await requestAccessToken({
        appId: configuredAppId,
        appSecret: configuredAppSecret,
        fetchImpl,
        now,
        deadline
      });
      await safelyStoreCachedToken({
        redis: redisClient,
        tokenKey: cacheKey,
        lockKey: refreshLockKey,
        owner,
        record,
        now: now(),
        deadline
      });
      localRecord = record;
      return record.accessToken;
    } finally {
      deadline.close();
      await releaseLock(redisClient, refreshLockKey, owner);
    }
  }

  return {
    async getAccessToken(options = {}) {
      if (inFlight) return inFlight;
      inFlight = refresh(options).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    async invalidate(expectedToken = "") {
      if (!expectedToken || localRecord?.accessToken === expectedToken) localRecord = null;
      const redisClient = await resolveRedis();
      if (!redisClient) return;
      try {
        if (!expectedToken) {
          await redisClient.del(cacheKey);
          return;
        }
        const cached = parseRecord(await redisClient.get(cacheKey), 0, -1);
        if (cached?.accessToken === expectedToken) await redisClient.del(cacheKey);
      } catch {
        throw sanitizedError("WECHAT_ACCESS_TOKEN_CACHE_UNAVAILABLE", "WeChat access token cache unavailable");
      }
    }
  };
}

export function getWechatAccessTokenProvider() {
  if (!defaultProvider) {
    defaultProvider = createWechatAccessTokenProvider({
      appId: config.wechat.appId,
      appSecret: config.wechat.appSecret,
      getRedis: getDefaultRedisClient
    });
  }
  return defaultProvider;
}

export function getWechatAccessToken(options) {
  return getWechatAccessTokenProvider().getAccessToken(options);
}
