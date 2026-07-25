import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { rateLimited } from "../src/http/errors.js";
import {
  createAuthRateLimiter,
  createMemoryRateLimitStore
} from "../src/modules/auth/rate-limit.js";
import { createRedisRateLimitStore } from "../src/infra/redis/rate-limit-store.js";
import { createApp } from "../src/server.js";

test("memory and limiter semantics isolate scopes and expose bounded retry time", async () => {
  let nowMs = 10_000;
  const limiter = createAuthRateLimiter({
    store: createMemoryRateLimitStore({ now: () => nowMs })
  });

  await limiter.consume({ scope: "wechat-login", key: "client-a", limit: 2, windowSeconds: 10 });
  await limiter.consume({ scope: "wechat-login", key: "client-a", limit: 2, windowSeconds: 10 });
  await assert.rejects(
    limiter.consume({ scope: "wechat-login", key: "client-a", limit: 2, windowSeconds: 10 }),
    (error) => (
      error?.statusCode === 429 &&
      error?.code === "RATE_LIMITED" &&
      error?.retryAfter >= 1 &&
      error?.retryAfter <= 10
    )
  );

  await assert.doesNotReject(
    limiter.consume({ scope: "admin-ticket-poll", key: "client-a", limit: 2, windowSeconds: 10 })
  );
  nowMs += 10_001;
  await assert.doesNotReject(
    limiter.consume({ scope: "wechat-login", key: "client-a", limit: 2, windowSeconds: 10 })
  );
});

test("rate limiter fails closed when its shared store is unavailable", async () => {
  const limiter = createAuthRateLimiter({
    store: { consume: async () => { throw new Error("redis password must stay private"); } }
  });

  await assert.rejects(
    limiter.consume({ scope: "wechat-login", key: "client", limit: 1, windowSeconds: 60 }),
    (error) => (
      error?.statusCode === 503 &&
      error?.code === "RATE_LIMIT_UNAVAILABLE" &&
      !JSON.stringify(error).includes("redis password")
    )
  );
});

test("Redis store uses one atomic operation and normalizes its result", async () => {
  const calls = [];
  const store = createRedisRateLimitStore({
    client: {
      async eval(script, options) {
        calls.push({ script, options });
        return [3, 7];
      }
    },
    keyPrefix: "d51"
  });

  assert.deepEqual(
    await store.consume({ key: "wechat-login:client-a", limit: 2, windowSeconds: 10 }),
    { allowed: false, count: 3, remaining: 0, retryAfter: 7 }
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options.keys, ["d51:wechat-login:client-a"]);
  assert.deepEqual(calls[0].options.arguments, ["10"]);
});

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function request(port, { method, path, body, authorization }) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      host: "127.0.0.1",
      port,
      method,
      path,
      headers: {
        ...(raw ? {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(raw)
        } : {}),
        ...(authorization ? { authorization } : {})
      }
    }, (incoming) => {
      const chunks = [];
      incoming.on("data", (chunk) => chunks.push(chunk));
      incoming.on("end", () => resolve({
        statusCode: incoming.statusCode,
        headers: incoming.headers,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
      }));
    });
    outgoing.once("error", reject);
    outgoing.end(raw);
  });
}

test("all sensitive auth routes consume a scoped client key before business work", async () => {
  const consumed = [];
  const businessCalls = [];
  const server = createApp({
    logger: { info() {} },
    rateLimiter: {
      async consume(input) {
        consumed.push(input);
      }
    },
    auth: {
      loginWithWechatCode: async () => { businessCalls.push("login"); return { token: "safe" }; },
      createAdminWebLoginTicket: async () => { businessCalls.push("create"); return { ticketId: "id" }; },
      pollAdminWebLoginTicket: async () => { businessCalls.push("poll"); return { status: "pending" }; },
      approveAdminWebLoginTicket: async () => { businessCalls.push("approve"); return { status: "approved" }; },
      verifyBusinessToken: async () => ({ user: { id: 42 }, roles: ["system_admin"] })
    }
  });
  const port = await listen(server);
  try {
    assert.equal((await request(port, {
      method: "POST",
      path: "/api/auth/wechat/login",
      body: { code: "safe-code" }
    })).statusCode, 200);
    assert.equal((await request(port, {
      method: "POST",
      path: "/api/admin/web-login/tickets",
      body: {}
    })).statusCode, 201);
    assert.equal((await request(port, {
      method: "GET",
      path: "/api/admin/web-login/tickets/ticket-id?secret=query-secret"
    })).statusCode, 200);
    assert.equal((await request(port, {
      method: "POST",
      path: "/api/admin/web-login/tickets/ticket-id/approve",
      authorization: "Bearer safe-token",
      body: { secret: "body-secret" }
    })).statusCode, 200);

    assert.deepEqual(consumed.map(({ scope }) => scope), [
      "wechat-login",
      "admin-ticket-create",
      "admin-ticket-poll",
      "admin-ticket-approve"
    ]);
    assert.deepEqual(businessCalls, ["login", "create", "poll", "approve"]);
    assert.ok(consumed.every(({ key }) => key.includes("127.0.0.1")));
    assert.doesNotMatch(JSON.stringify(consumed), /query-secret|body-secret|safe-token|ticket-id/);
  } finally {
    await close(server);
  }
});

test("HTTP 429 includes Retry-After and never invokes the sensitive handler", async () => {
  let businessCalls = 0;
  const server = createApp({
    logger: { info() {} },
    rateLimiter: { consume: async () => { throw rateLimited(7); } },
    auth: {
      loginWithWechatCode: async () => {
        businessCalls += 1;
        return {};
      }
    }
  });
  const port = await listen(server);
  try {
    const response = await request(port, {
      method: "POST",
      path: "/api/auth/wechat/login",
      body: { code: "never-used" }
    });
    assert.equal(response.statusCode, 429);
    assert.equal(response.headers["retry-after"], "7");
    assert.equal(response.body.error.code, "RATE_LIMITED");
    assert.equal(businessCalls, 0);
  } finally {
    await close(server);
  }
});

test("HTTP fails closed with a low-sensitivity 503 when the rate-limit store fails", async () => {
  let businessCalls = 0;
  const server = createApp({
    logger: { info() {} },
    rateLimiter: createAuthRateLimiter({
      store: { consume: async () => { throw new Error("redis://user:password@private-host"); } }
    }),
    auth: {
      loginWithWechatCode: async () => {
        businessCalls += 1;
        return {};
      }
    }
  });
  const port = await listen(server);
  try {
    const response = await request(port, {
      method: "POST",
      path: "/api/auth/wechat/login",
      body: { code: "never-used" }
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.error.code, "RATE_LIMIT_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(response.body), /redis|password|private-host/i);
    assert.equal(businessCalls, 0);
  } finally {
    await close(server);
  }
});
