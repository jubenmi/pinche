import crypto from "node:crypto";

import { createClient } from "redis";

import { config } from "../../config/env.js";

const TOKEN_ENDPOINT = "https://api.weixin.qq.com/cgi-bin/token";
const REFRESH_MARGIN_MS = 60_000;
const LOCK_TTL_MS = 10_000;
// One token-cache operation (including Redis resolution and every Redis
// command) must finish before a moderation submission lease can be claimed by
// another worker.  The invalid-token path is budgeted with the content client
// below: 9 + <20 + 9 + 9 + <20 = <67 seconds, well inside the 90-second lease.
export const WECHAT_ACCESS_TOKEN_OPERATION_TIMEOUT_MS = 9_000;
export const WECHAT_REDIS_CONNECT_DEADLINE_MS = 8_000;
export const WECHAT_ACCESS_TOKEN_FETCH_TIMEOUT_MS = 8_000;
const LOCK_WAIT_MS = 50;
const LOCK_WAIT_TIMEOUT_MS = 2_000;
const TOKEN_INVALID_ERROR_CODES = new Set([40001, 40014, 42001]);
const CONDITIONAL_CACHE_STORE_SCRIPT = [
  "if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end",
  "redis.call('set', KEYS[2], ARGV[2], 'PX', ARGV[3])",
  "return 1"
].join(" ");

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

function createDeadline({
  timeoutMs,
  timeoutError,
  onTimeout = () => {},
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
}) {
  const controller = new AbortController();
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeoutFn(() => {
      controller.abort(timeoutError);
      try {
        onTimeout();
      } catch {
        // A timeout must never be delayed by best-effort Redis cleanup.
      }
      reject(timeoutError);
    }, timeoutMs);
  });
  return {
    signal: controller.signal,
    isTimeout(error) {
      return error === timeoutError;
    },
    run(operation) {
      if (controller.signal.aborted) {
        const aborted = Promise.reject(timeoutError);
        aborted.catch(() => {});
        return aborted;
      }
      const operationPromise = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw timeoutError;
        return operation();
      });
      // A deadline can settle before an unabortable Redis promise. Keep that
      // late rejection observed; state changes still stop because later calls
      // see the aborted signal and the resolver has been reset.
      operationPromise.catch(() => {});
      const raced = Promise.race([operationPromise, timeout]);
      raced.catch(() => {});
      return raced;
    },
    close() {
      if (timeoutId !== null) clearTimeoutFn(timeoutId);
    }
  };
}

function createRefreshDeadline(timeoutMs) {
  return createDeadline({
    timeoutMs,
    timeoutError: sanitizedError(
      "WECHAT_ACCESS_TOKEN_REQUEST_FAILED",
      "WeChat access token request failed"
    )
  });
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

function cacheUnavailableError() {
  return sanitizedError("WECHAT_ACCESS_TOKEN_CACHE_UNAVAILABLE", "WeChat access token cache unavailable");
}

function disconnectRedisClient(client) {
  try {
    const result = client?.disconnect?.();
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch {
    // Cleanup must not expose driver diagnostics or delay the closed failure.
  }
}

export function createDefaultRedisClientResolver({
  enabled = () => config.redis.enabled,
  url = () => config.redis.url,
  createRedisClient = createClient,
  connectDeadlineMs = WECHAT_REDIS_CONNECT_DEADLINE_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  if (typeof enabled !== "function" || typeof url !== "function" || typeof createRedisClient !== "function") {
    throw new TypeError("Redis client resolver adapters must be functions");
  }
  if (!Number.isFinite(connectDeadlineMs) || connectDeadlineMs <= 0 ||
    connectDeadlineMs >= WECHAT_ACCESS_TOKEN_OPERATION_TIMEOUT_MS) {
    throw new TypeError("Redis connect deadline must be positive and shorter than the token operation deadline");
  }
  if (typeof setTimeoutFn !== "function" || typeof clearTimeoutFn !== "function") {
    throw new TypeError("Redis client resolver timer adapters must be functions");
  }

  let connectedClient = null;
  let connectingClient = null;
  let connectingPromise = null;

  const reset = (expectedClient = null) => {
    const activeClient = connectedClient || connectingClient;
    if (expectedClient && activeClient && expectedClient !== activeClient) return false;
    const target = expectedClient || activeClient;
    if (target && connectedClient === target) connectedClient = null;
    if (target && connectingClient === target) connectingClient = null;
    if (!expectedClient || expectedClient === activeClient) connectingPromise = null;
    disconnectRedisClient(target);
    return Boolean(target);
  };

  const resolve = async () => {
    if (!enabled()) return null;
    if (connectedClient?.isOpen === false) reset(connectedClient);
    if (connectedClient) return connectedClient;
    if (!connectingPromise) {
      let client;
      try {
        client = createRedisClient({
          url: url(),
          disableOfflineQueue: true,
          socket: {
            connectTimeout: connectDeadlineMs,
            reconnectStrategy: false
          }
        });
        client.on?.("error", () => {});
      } catch {
        throw cacheUnavailableError();
      }
      connectingClient = client;
      const deadline = createDeadline({
        timeoutMs: connectDeadlineMs,
        timeoutError: cacheUnavailableError(),
        onTimeout: () => reset(client),
        setTimeoutFn,
        clearTimeoutFn
      });
      let attempt;
      attempt = deadline.run(() => client.connect())
        .then(() => {
          if (connectingPromise !== attempt || connectingClient !== client) {
            disconnectRedisClient(client);
            throw cacheUnavailableError();
          }
          connectedClient = client;
          connectingClient = null;
          connectingPromise = null;
          return client;
        })
        .catch(() => {
          const stillCurrent = connectingPromise === attempt || connectingClient === client;
          if (connectingPromise === attempt) connectingPromise = null;
          if (connectingClient === client) connectingClient = null;
          if (stillCurrent) disconnectRedisClient(client);
          throw cacheUnavailableError();
        })
        .finally(() => deadline.close());
      connectingPromise = attempt;
    }
    return connectingPromise;
  };

  resolve.reset = reset;
  return resolve;
}

const defaultRedisClientResolver = createDefaultRedisClientResolver();

async function getDefaultRedisClient() {
  return defaultRedisClientResolver();
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

function runWithinDeadline(deadline, operation) {
  return deadline ? deadline.run(operation) : Promise.resolve().then(operation);
}

async function safelyReadCachedToken(redis, key, now, refreshMarginMs, deadline = null) {
  if (!redis) return null;
  try {
    return parseRecord(await runWithinDeadline(deadline, () => redis.get(key)), now, refreshMarginMs);
  } catch (error) {
    if (deadline?.isTimeout(error)) throw error;
    throw cacheUnavailableError();
  }
}

async function safelyStoreCachedToken({ redis, tokenKey: key, lockKey: lock, owner, record, now, deadline }) {
  let stored;
  try {
    stored = await runWithinDeadline(deadline, () => redis.eval(CONDITIONAL_CACHE_STORE_SCRIPT, {
      keys: [lock, key],
      arguments: [owner, JSON.stringify(record), String(cacheTtlMs(record, now))]
    }));
  } catch (error) {
    if (deadline.isTimeout(error)) throw error;
    throw cacheUnavailableError();
  }
  if (Number(stored) !== 1) {
    throw sanitizedError("WECHAT_ACCESS_TOKEN_LOCK_LOST", "WeChat access token refresh lease expired");
  }
}

async function acquireLock(redis, key, owner, lockTtlMs, deadline = null) {
  try {
    return (await runWithinDeadline(deadline, () => redis.set(key, owner, {
      NX: true,
      PX: lockTtlMs
    }))) === "OK";
  } catch (error) {
    if (deadline?.isTimeout(error)) throw error;
    throw cacheUnavailableError();
  }
}

async function releaseLock(redis, key, owner, deadline = null) {
  try {
    await runWithinDeadline(deadline, () => redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
      { keys: [key], arguments: [owner] }
    ));
  } catch {
    // The lock has a short TTL. Never replace a successful token fetch with a release error.
  }
}

async function waitForRedisToken({ redis, key, now, refreshMarginMs, sleep, waitTimeoutMs, deadline = null }) {
  const attempts = Math.max(1, Math.ceil(waitTimeoutMs / LOCK_WAIT_MS));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await runWithinDeadline(deadline, () => sleep(LOCK_WAIT_MS));
    const cached = await safelyReadCachedToken(redis, key, now(), refreshMarginMs, deadline);
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
  resetRedis = null,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  refreshMarginMs = REFRESH_MARGIN_MS,
  waitTimeoutMs = LOCK_WAIT_TIMEOUT_MS,
  lockTtlMs = LOCK_TTL_MS,
  fetchTimeoutMs = WECHAT_ACCESS_TOKEN_FETCH_TIMEOUT_MS,
  operationTimeoutMs = WECHAT_ACCESS_TOKEN_OPERATION_TIMEOUT_MS,
  randomUUID = crypto.randomUUID,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  const configuredAppId = required(appId, "appId");
  const configuredAppSecret = required(appSecret, "appSecret");
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  if (typeof getRedis !== "function" && getRedis !== null) throw new TypeError("getRedis must be a function");
  if (typeof resetRedis !== "function" && resetRedis !== null) throw new TypeError("resetRedis must be a function");
  if (typeof now !== "function" || typeof sleep !== "function" || typeof randomUUID !== "function") {
    throw new TypeError("token provider adapters must be functions");
  }
  if (typeof setTimeoutFn !== "function" || typeof clearTimeoutFn !== "function") {
    throw new TypeError("token provider timer adapters must be functions");
  }
  if (!Number.isFinite(lockTtlMs) || lockTtlMs <= 0) {
    throw new TypeError("lockTtlMs must be a positive number");
  }
  if (!Number.isFinite(fetchTimeoutMs) || fetchTimeoutMs <= 0 || fetchTimeoutMs >= lockTtlMs) {
    throw new TypeError("fetchTimeoutMs must be shorter than lockTtlMs");
  }
  if (!Number.isFinite(operationTimeoutMs) || operationTimeoutMs <= 0 || operationTimeoutMs >= 90_000) {
    throw new TypeError("operationTimeoutMs must be a positive duration shorter than the moderation lease");
  }
  if (fetchTimeoutMs >= operationTimeoutMs) {
    throw new TypeError("fetchTimeoutMs must be shorter than operationTimeoutMs");
  }

  const staticRedis = normalizeRedis(redis);
  const cacheKey = tokenKey(configuredAppId);
  const refreshLockKey = lockKey(configuredAppId);
  let localRecord = null;
  let inFlight = null;
  let resolvedRedis = null;
  let resolvedRedisPromise = null;
  let redisGeneration = 0;

  function resetDynamicRedisClient(client) {
    if (!client || typeof resetRedis !== "function") return;
    try {
      const result = resetRedis(client);
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch {
      // The caller still receives the redacted cache-unavailable result.
    }
  }

  function resetDynamicRedis() {
    if (staticRedis) return;
    const client = resolvedRedis;
    resolvedRedis = null;
    resolvedRedisPromise = null;
    redisGeneration += 1;
    resetDynamicRedisClient(client);
  }

  async function resolveRedis(deadline = null) {
    if (staticRedis) return staticRedis;
    if (resolvedRedis || !getRedis) return resolvedRedis;
    if (!resolvedRedisPromise) {
      const generation = redisGeneration;
      let pending;
      pending = Promise.resolve()
        .then(() => getRedis())
        .then(normalizeRedis)
        .then((client) => {
          if (generation !== redisGeneration) {
            resetDynamicRedisClient(client);
            throw cacheUnavailableError();
          }
          resolvedRedis = client;
          return client;
        })
        .catch((error) => {
          if (generation === redisGeneration && resolvedRedisPromise === pending) {
            resolvedRedisPromise = null;
          }
          throw error;
        });
      resolvedRedisPromise = pending;
      // A caller can time out before a non-cancellable getRedis() settles.
      // Preserve the rejection for an active caller while observing a late one.
      pending.catch(() => {});
    }
    try {
      return await runWithinDeadline(deadline, () => resolvedRedisPromise);
    } catch (error) {
      if (deadline?.isTimeout(error)) resetDynamicRedis();
      throw cacheUnavailableError();
    }
  }

  async function readValidToken(redisClient, deadline = null) {
    const current = now();
    if (localRecord && localRecord.expiresAt > current + refreshMarginMs) return localRecord;
    const cached = await safelyReadCachedToken(redisClient, cacheKey, current, refreshMarginMs, deadline);
    if (cached) localRecord = cached;
    return cached;
  }

  async function refresh({ forceRefresh = false } = {}, operationDeadline = null) {
    const redisClient = await resolveRedis(operationDeadline);
    if (!forceRefresh) {
      const cached = await readValidToken(redisClient, operationDeadline);
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
    let locked = await acquireLock(redisClient, refreshLockKey, owner, lockTtlMs, operationDeadline);
    if (!locked) {
      const fromOtherWorker = await waitForRedisToken({
        redis: redisClient,
        key: cacheKey,
        now,
        refreshMarginMs,
        sleep,
        waitTimeoutMs,
        deadline: operationDeadline
      });
      if (fromOtherWorker) {
        localRecord = fromOtherWorker;
        return fromOtherWorker.accessToken;
      }
      locked = await acquireLock(redisClient, refreshLockKey, owner, lockTtlMs, operationDeadline);
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
        const cached = await readValidToken(redisClient, operationDeadline);
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
        deadline: operationDeadline
      });
      localRecord = record;
      return record.accessToken;
    } finally {
      deadline.close();
      await releaseLock(redisClient, refreshLockKey, owner, operationDeadline);
    }
  }

  async function runTokenOperation(operation) {
    const deadline = createDeadline({
      timeoutMs: operationTimeoutMs,
      timeoutError: cacheUnavailableError(),
      onTimeout: resetDynamicRedis,
      setTimeoutFn,
      clearTimeoutFn
    });
    try {
      return await deadline.run(() => operation(deadline));
    } catch (error) {
      if (deadline.isTimeout(error)) throw cacheUnavailableError();
      if (String(error?.code || "") === "WECHAT_ACCESS_TOKEN_CACHE_UNAVAILABLE") {
        resetDynamicRedis();
      }
      throw error;
    } finally {
      deadline.close();
    }
  }

  return {
    async getAccessToken(options = {}) {
      if (inFlight) return inFlight;
      inFlight = runTokenOperation((deadline) => refresh(options, deadline)).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    async invalidate(expectedToken = "") {
      if (!expectedToken || localRecord?.accessToken === expectedToken) localRecord = null;
      return runTokenOperation(async (deadline) => {
        const redisClient = await resolveRedis(deadline);
        if (!redisClient) return;
        try {
          if (!expectedToken) {
            await runWithinDeadline(deadline, () => redisClient.del(cacheKey));
            return;
          }
          const cached = parseRecord(
            await runWithinDeadline(deadline, () => redisClient.get(cacheKey)),
            0,
            -1
          );
          if (cached?.accessToken === expectedToken) {
            await runWithinDeadline(deadline, () => redisClient.del(cacheKey));
          }
        } catch (error) {
          if (deadline.isTimeout(error)) throw error;
          throw cacheUnavailableError();
        }
      });
    }
  };
}

export function getWechatAccessTokenProvider() {
  if (!defaultProvider) {
    defaultProvider = createWechatAccessTokenProvider({
      appId: config.wechat.appId,
      appSecret: config.wechat.appSecret,
      getRedis: getDefaultRedisClient,
      resetRedis: defaultRedisClientResolver.reset
    });
  }
  return defaultProvider;
}

export function getWechatAccessToken(options) {
  return getWechatAccessTokenProvider().getAccessToken(options);
}
