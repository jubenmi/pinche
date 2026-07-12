import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  WECHAT_ACCESS_TOKEN_OPERATION_TIMEOUT_MS,
  WECHAT_REDIS_CONNECT_DEADLINE_MS,
  createDefaultRedisClientResolver,
  createWechatAccessTokenProvider,
  requestWithWechatAccessTokenRetry
} from "../src/modules/wechat/access-token.js";
import { WECHAT_CONTENT_SECURITY_REQUEST_TIMEOUT_LIMIT_MS } from "../src/modules/content-moderation/wechat-client.js";
import { MODERATION_RETRY_LEASE_MIN_MS } from "../src/modules/content-moderation/constants.js";
import { sendSubscribeMessage } from "../src/modules/wechat/subscribe-message.js";

function createFakeRedis() {
  const values = new Map();
  const calls = [];

  return {
    calls,
    async get(key) {
      calls.push(["get", key]);
      return values.get(key) ?? null;
    },
    async set(key, value, options = {}) {
      calls.push(["set", key, value, options]);
      if (options?.NX && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    async del(key) {
      calls.push(["del", key]);
      values.delete(key);
      return 1;
    },
    async eval(_script, { keys, arguments: args }) {
      const [key] = keys;
      const [expected] = args;
      calls.push(["eval", key, expected]);
      if (keys.length === 2) {
        const [, tokenKey] = keys;
        const [, record] = args;
        if (values.get(key) !== expected) return 0;
        values.set(tokenKey, record);
        return 1;
      }
      if (values.get(key) !== expected) return 0;
      values.delete(key);
      return 1;
    },
    value(key) {
      return values.get(key) ?? null;
    }
  };
}

function tokenResponse(accessToken, expiresIn = 7200) {
  return new Response(JSON.stringify({ access_token: accessToken, expires_in: expiresIn }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function providerOptions(overrides = {}) {
  return {
    appId: "wx-d45-test",
    appSecret: "wechat-app-secret",
    redis: createFakeRedis(),
    fetchImpl: async () => tokenResponse("fresh-token"),
    now: () => 1_000_000,
    sleep: async () => {},
    ...overrides
  };
}

function createManualTimers() {
  const timers = new Map();
  let nextId = 0;
  return {
    setTimeoutFn(callback, milliseconds) {
      const id = ++nextId;
      timers.set(id, { callback, milliseconds });
      return id;
    },
    clearTimeoutFn(id) {
      timers.delete(id);
    },
    fireNext(milliseconds) {
      const entry = [...timers.entries()].find(([, timer]) => timer.milliseconds === milliseconds);
      assert.ok(entry, `expected timer with ${milliseconds}ms deadline`);
      const [id, timer] = entry;
      timers.delete(id);
      timer.callback();
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("default Redis cache connection has a bounded deadline, disconnects, and cannot poison a later retry", async () => {
  const timers = createManualTimers();
  const firstConnect = deferred();
  const created = [];
  const createClientOptions = [];
  const resolver = createDefaultRedisClientResolver({
    enabled: () => true,
    url: () => "redis://cache.example.test:6379",
    connectDeadlineMs: 7,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    createRedisClient: (options) => {
      createClientOptions.push(options);
      const state = { connectCalls: 0, disconnects: 0 };
      const client = {
        on() {},
        connect: () => {
          state.connectCalls += 1;
          return created.length === 0 ? firstConnect.promise : Promise.resolve();
        },
        disconnect: () => { state.disconnects += 1; }
      };
      created.push({ client, state });
      return client;
    }
  });

  const first = resolver();
  await Promise.resolve();
  assert.equal(created[0].state.connectCalls, 1);
  timers.fireNext(7);
  await assert.rejects(first, {
    code: "WECHAT_ACCESS_TOKEN_CACHE_UNAVAILABLE"
  });
  assert.equal(created[0].state.disconnects, 1);
  assert.deepEqual(createClientOptions[0], {
    url: "redis://cache.example.test:6379",
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 7,
      reconnectStrategy: false
    }
  });

  const recovered = await resolver();
  assert.equal(created.length, 2);
  firstConnect.resolve();
  await Promise.resolve();
  assert.equal(await resolver(), recovered);
  assert.equal(created.length, 2, "a late first connect must not replace the recovered client");
});

test("a token operation deadline covers a hanging Redis command, resets it, and permits a later retry", async () => {
  const timers = createManualTimers();
  const hangingRead = deferred();
  const fallbackRedis = createFakeRedis();
  const resetClients = [];
  let redisAttempts = 0;
  const hangingRedis = {
    ...createFakeRedis(),
    get: async () => hangingRead.promise,
    disconnect() {}
  };
  const provider = createWechatAccessTokenProvider(providerOptions({
    redis: null,
    getRedis: async () => {
      redisAttempts += 1;
      return redisAttempts === 1 ? hangingRedis : fallbackRedis;
    },
    resetRedis: (client) => { resetClients.push(client); },
    operationTimeoutMs: 9,
    fetchTimeoutMs: 5,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn
  }));

  const first = provider.getAccessToken();
  await Promise.resolve();
  timers.fireNext(9);
  await assert.rejects(first, {
    code: "WECHAT_ACCESS_TOKEN_CACHE_UNAVAILABLE"
  });
  assert.deepEqual(resetClients, [hangingRedis]);

  assert.equal(await provider.getAccessToken(), "fresh-token");
  assert.equal(redisAttempts, 2);
  hangingRead.resolve(null);
});

test("token invalidation also bounds a queued Redis delete and releases the cache client for retry", async () => {
  const timers = createManualTimers();
  const hangingDelete = deferred();
  const fallbackRedis = createFakeRedis();
  const resetClients = [];
  let redisAttempts = 0;
  let deleteStarted = false;
  const hangingRedis = {
    ...createFakeRedis(),
    del: async () => {
      deleteStarted = true;
      return hangingDelete.promise;
    },
    disconnect() {}
  };
  const provider = createWechatAccessTokenProvider(providerOptions({
    redis: null,
    getRedis: async () => {
      redisAttempts += 1;
      return redisAttempts === 1 ? hangingRedis : fallbackRedis;
    },
    resetRedis: (client) => { resetClients.push(client); },
    operationTimeoutMs: 9,
    fetchTimeoutMs: 5,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn
  }));

  const first = provider.invalidate();
  for (let attempt = 0; attempt < 10 && !deleteStarted; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(deleteStarted, true);
  timers.fireNext(9);
  await assert.rejects(first, {
    code: "WECHAT_ACCESS_TOKEN_CACHE_UNAVAILABLE"
  });
  assert.deepEqual(resetClients, [hangingRedis]);

  await provider.invalidate();
  assert.equal(redisAttempts, 2);
  hangingDelete.resolve(1);
});

test("default WeChat token and content-security budgets stay strictly below the 90-second moderation lease", () => {
  assert.ok(WECHAT_REDIS_CONNECT_DEADLINE_MS < WECHAT_ACCESS_TOKEN_OPERATION_TIMEOUT_MS);
  assert.ok(WECHAT_ACCESS_TOKEN_OPERATION_TIMEOUT_MS < MODERATION_RETRY_LEASE_MIN_MS);
  assert.ok(
    3 * WECHAT_ACCESS_TOKEN_OPERATION_TIMEOUT_MS +
      2 * WECHAT_CONTENT_SECURITY_REQUEST_TIMEOUT_LIMIT_MS <
      MODERATION_RETRY_LEASE_MIN_MS,
    "get + request + invalidate + forced get + request must finish before one initial lease"
  );
});

test("access token uses Redis cache until the refresh margin", async () => {
  const now = () => 1_000_000;
  const redis = createFakeRedis();
  const tokenKey = "wechat:access-token:wx-d45-test";
  await redis.set(tokenKey, JSON.stringify({ accessToken: "cached-token", expiresAt: now() + 60_001 }));
  let fetchCalls = 0;
  const cachedProvider = createWechatAccessTokenProvider(providerOptions({
    now,
    redis,
    fetchImpl: async () => {
      fetchCalls += 1;
      return tokenResponse("unexpected-token");
    }
  }));

  assert.equal(await cachedProvider.getAccessToken(), "cached-token");
  assert.equal(fetchCalls, 0);

  const nearExpiryRedis = createFakeRedis();
  await nearExpiryRedis.set(
    tokenKey,
    JSON.stringify({ accessToken: "near-expiry-token", expiresAt: now() + 60_000 })
  );
  const refreshedProvider = createWechatAccessTokenProvider(providerOptions({
    now,
    redis: nearExpiryRedis,
    fetchImpl: async () => {
      fetchCalls += 1;
      return tokenResponse("refreshed-token");
    }
  }));

  assert.equal(await refreshedProvider.getAccessToken(), "refreshed-token");
  assert.equal(fetchCalls, 1);
});

test("access token refresh is single-flight within one process", async () => {
  let releaseFetch;
  let fetchCalls = 0;
  const provider = createWechatAccessTokenProvider(providerOptions({
    fetchImpl: async () => {
      fetchCalls += 1;
      await new Promise((resolve) => {
        releaseFetch = resolve;
      });
      return tokenResponse("single-flight-token");
    }
  }));

  const first = provider.getAccessToken();
  const second = provider.getAccessToken();
  for (let attempt = 0; attempt < 10 && fetchCalls === 0; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(fetchCalls, 1);

  releaseFetch();
  assert.deepEqual(await Promise.all([first, second]), ["single-flight-token", "single-flight-token"]);
});

test("access token waits for another Redis lock owner and preserves that lock", async () => {
  const redis = createFakeRedis();
  const tokenKey = "wechat:access-token:wx-d45-test";
  const lockKey = "wechat:access-token-lock:wx-d45-test";
  await redis.set(lockKey, "other-worker");
  let fetchCalls = 0;
  const provider = createWechatAccessTokenProvider(providerOptions({
    redis,
    waitTimeoutMs: 100,
    sleep: async () => {
      await redis.set(tokenKey, JSON.stringify({ accessToken: "other-worker-token", expiresAt: 2_000_000 }));
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return tokenResponse("should-not-be-requested");
    }
  }));

  assert.equal(await provider.getAccessToken(), "other-worker-token");
  assert.equal(fetchCalls, 0);
  assert.equal(redis.value(lockKey), "other-worker");
});

test("access token release does not delete a lock replaced by another worker", async () => {
  const redis = createFakeRedis();
  const lockKey = "wechat:access-token-lock:wx-d45-test";
  const provider = createWechatAccessTokenProvider(providerOptions({
    redis,
    fetchImpl: async () => {
      await redis.set(lockKey, "new-lock-owner");
      return tokenResponse("fresh-token");
    }
  }));

  await assert.rejects(provider.getAccessToken(), {
    code: "WECHAT_ACCESS_TOKEN_LOCK_LOST"
  });
  assert.equal(redis.value(lockKey), "new-lock-owner");
});

test("hanging token fetch is aborted before its Redis lock can expire", async () => {
  const redis = createFakeRedis();
  const lockKey = "wechat:access-token-lock:wx-d45-test";
  let receivedSignal = null;
  const provider = createWechatAccessTokenProvider(providerOptions({
    redis,
    lockTtlMs: 30,
    fetchTimeoutMs: 5,
    fetchImpl: async (_url, { signal } = {}) => {
      receivedSignal = signal ?? null;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(tokenResponse("too-late-token")), 50);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason);
        }, { once: true });
      });
    }
  }));

  await assert.rejects(provider.getAccessToken(), {
    code: "WECHAT_ACCESS_TOKEN_REQUEST_FAILED"
  });
  assert.equal(receivedSignal?.aborted, true);
  assert.equal(redis.value(lockKey), null);
});

test("a delayed token response cannot overwrite a newer token from another worker", async () => {
  const redis = createFakeRedis();
  const tokenKey = "wechat:access-token:wx-d45-test";
  const lockKey = "wechat:access-token-lock:wx-d45-test";
  const firstWorker = createWechatAccessTokenProvider(providerOptions({
    redis,
    lockTtlMs: 10,
    fetchTimeoutMs: 5,
    randomUUID: () => "first-worker",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: () => new Promise((resolve) => {
        setTimeout(() => resolve(JSON.stringify({ access_token: "stale-token", expires_in: 7200 })), 40);
      })
    })
  }));
  const firstOutcome = firstWorker.getAccessToken().then(
    (value) => ({ value }),
    (error) => ({ error })
  );

  await new Promise((resolve) => setTimeout(resolve, 12));
  await redis.del(lockKey);
  const secondWorker = createWechatAccessTokenProvider(providerOptions({
    redis,
    lockTtlMs: 10,
    fetchTimeoutMs: 5,
    randomUUID: () => "second-worker",
    fetchImpl: async () => tokenResponse("newer-token")
  }));
  assert.equal(await secondWorker.getAccessToken(), "newer-token");

  const first = await firstOutcome;
  assert.equal(first.error?.code, "WECHAT_ACCESS_TOKEN_REQUEST_FAILED");
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(JSON.parse(redis.value(tokenKey)).accessToken, "newer-token");
});

test("token cache write is conditional on the current Redis lock owner", async () => {
  const redis = createFakeRedis();
  const originalEval = redis.eval.bind(redis);
  redis.eval = async (script, options) => {
    if (options.keys.length === 2) {
      await redis.set(options.keys[0], "replacement-worker");
    }
    return originalEval(script, options);
  };
  const provider = createWechatAccessTokenProvider(providerOptions({
    redis,
    randomUUID: () => "first-worker"
  }));

  await assert.rejects(provider.getAccessToken(), {
    code: "WECHAT_ACCESS_TOKEN_LOCK_LOST"
  });
  assert.equal(redis.value("wechat:access-token:wx-d45-test"), null);
});

test("token fetch timeout must be strictly shorter than the Redis lock TTL", () => {
  assert.throws(
    () => createWechatAccessTokenProvider(providerOptions({ fetchTimeoutMs: 10, lockTtlMs: 10 })),
    /fetchTimeoutMs must be shorter than lockTtlMs/
  );
});

test("token-invalid responses cause exactly one forced refresh and retry", async () => {
  const getCalls = [];
  const invalidated = [];
  const tokenProvider = {
    async getAccessToken(options) {
      getCalls.push(options ?? null);
      return getCalls.length === 1 ? "expired-token" : "fresh-token";
    },
    async invalidate(token) {
      invalidated.push(token);
    }
  };
  const requestTokens = [];

  const result = await requestWithWechatAccessTokenRetry({
    tokenProvider,
    request: async (token) => {
      requestTokens.push(token);
      return token === "expired-token" ? { errcode: 40001 } : { errcode: 0, value: "ok" };
    }
  });

  assert.deepEqual(result, { errcode: 0, value: "ok" });
  assert.deepEqual(requestTokens, ["expired-token", "fresh-token"]);
  assert.deepEqual(getCalls, [null, { forceRefresh: true }]);
  assert.deepEqual(invalidated, ["expired-token"]);
});

test("access token errors never expose the configured app secret", async () => {
  const provider = createWechatAccessTokenProvider(providerOptions({
    appSecret: "do-not-leak-this-secret",
    fetchImpl: async () => new Response(JSON.stringify({ errcode: 40125, errmsg: "bad secret" }), { status: 200 })
  }));

  await assert.rejects(provider.getAccessToken(), (error) => {
    assert.equal(error.code, "WECHAT_ACCESS_TOKEN_REQUEST_FAILED");
    assert.equal(error.message.includes("do-not-leak-this-secret"), false);
    assert.equal(JSON.stringify(error).includes("do-not-leak-this-secret"), false);
    return true;
  });
});

test("subscription messages use the shared access token provider rather than a private cache", () => {
  const source = fs.readFileSync(
    new URL("../src/modules/wechat/subscribe-message.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /getWechatAccessToken/);
  assert.equal(source.includes("cachedToken"), false);
  assert.equal(source.includes("function fetchAccessToken"), false);
});

test("subscription message retries exactly once after a WeChat token-invalid response", async () => {
  const requestTokens = [];
  const getCalls = [];
  const invalidated = [];
  let requestCount = 0;
  const result = await sendSubscribeMessage(
    {
      scene: "signup_created",
      touser: "openid-1",
      templateId: "template-1",
      page: "/pages/session/manage?id=session-1",
      data: { thing1: { value: "拼车" } }
    },
    {
      runtimeConfig: {
        nodeEnv: "production",
        subscribeMessage: { enabled: true },
        wechat: { appId: "wx-d45-test", appSecret: "wechat-app-secret" }
      },
      tokenProvider: {
        async getAccessToken(options) {
          getCalls.push(options ?? null);
          return getCalls.length === 1 ? "expired-token" : "fresh-token";
        },
        async invalidate(token) {
          invalidated.push(token);
        }
      },
      fetchImpl: async (url) => {
        requestTokens.push(new URL(url).searchParams.get("access_token"));
        requestCount += 1;
        return new Response(JSON.stringify(
          requestCount === 1 ? { errcode: 40014, errmsg: "invalid token" } : { errcode: 0, msgid: "msg-1" }
        ), { status: 200 });
      }
    }
  );

  assert.deepEqual(result, {
    ok: true,
    skipped: false,
    scene: "signup_created",
    msgid: "msg-1"
  });
  assert.deepEqual(requestTokens, ["expired-token", "fresh-token"]);
  assert.deepEqual(getCalls, [null, { forceRefresh: true }]);
  assert.deepEqual(invalidated, ["expired-token"]);
});
