import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";

import { createApp } from "../src/server.js";

const JSON_LIMIT_BYTES = 1024 * 1024;

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function requestJson(
  port,
  { body, contentLength = true, declaredContentLength, writeBody = true }
) {
  return new Promise((resolve, reject) => {
    let responseStarted = false;
    const headers = { "content-type": "application/json" };
    if (contentLength) {
      headers["content-length"] = String(declaredContentLength ?? Buffer.byteLength(body));
    }

    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/api/d51/body-boundary-probe",
        headers
      },
      (response) => {
        responseStarted = true;
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: raw ? JSON.parse(raw) : null
          });
        });
      }
    );
    request.once("error", (error) => {
      if (responseStarted && error?.code === "ECONNRESET") return;
      reject(error);
    });

    if (!writeBody) {
      request.end();
      return;
    }
    if (contentLength) {
      request.end(body);
      return;
    }

    const midpoint = Math.floor(body.length / 2);
    request.write(body.slice(0, midpoint));
    request.end(body.slice(midpoint));
  });
}

async function withApp(callback) {
  const server = createApp();
  const port = await listen(server);
  try {
    return await callback(port);
  } finally {
    await close(server);
  }
}

test("rejects an explicit Content-Length above the JSON limit with 413", async () => {
  const marker = "d51-explicit-content-length";
  const body = JSON.stringify({ marker });
  const response = await withApp((port) => requestJson(port, {
    body,
    declaredContentLength: JSON_LIMIT_BYTES + 1,
    writeBody: false
  }));

  assert.equal(response.statusCode, 413);
  assert.equal(response.body?.error?.code, "PAYLOAD_TOO_LARGE");
  assert.doesNotMatch(JSON.stringify(response.body), new RegExp(marker));
});

test("rejects a chunked JSON body above the limit with the same 413 contract", async () => {
  const marker = "d51-chunked-content";
  const body = JSON.stringify({ marker, value: "y".repeat(JSON_LIMIT_BYTES) });
  const response = await withApp((port) => requestJson(port, {
    body,
    contentLength: false
  }));

  assert.equal(response.statusCode, 413);
  assert.equal(response.body?.error?.code, "PAYLOAD_TOO_LARGE");
  assert.doesNotMatch(JSON.stringify(response.body), new RegExp(marker));
});

test("keeps malformed JSON separate from payload overflow", async () => {
  const response = await withApp((port) => requestJson(port, { body: "{not-json" }));

  assert.equal(response.statusCode, 400);
  assert.equal(response.body?.error?.code, "INVALID_JSON");
});

test("keeps the stricter callback reader outside the generic JSON policy", async () => {
  const marker = "d51-callback-body-must-not-echo";
  const body = JSON.stringify({ marker, value: "z".repeat(300 * 1024) });
  const response = await new Promise(async (resolve, reject) => {
    const server = createApp({ logger: { info() {} } });
    let port;
    try {
      port = await listen(server);
      const outgoing = http.request({
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/api/internal/content-moderation/wechat-image/callback",
        headers: {
          connection: "close",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body)
        }
      }, (incoming) => {
        const chunks = [];
        incoming.on("data", (chunk) => chunks.push(chunk));
        incoming.on("end", async () => {
          try {
            await close(server);
            resolve({
              statusCode: incoming.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
            });
          } catch (error) {
            reject(error);
          }
        });
      });
      outgoing.once("error", reject);
      outgoing.end(body);
    } catch (error) {
      if (server.listening) await close(server);
      reject(error);
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, "BAD_REQUEST");
  assert.notEqual(response.body.error.code, "PAYLOAD_TOO_LARGE");
  assert.doesNotMatch(JSON.stringify(response.body), new RegExp(marker));
});

test("reuses only a valid upstream request ID and emits low-cardinality logs", async () => {
  const logs = [];
  const marker = "authorization-secret-must-not-log";
  const server = createApp({
    logger: { info: (entry) => logs.push(entry) }
  });
  const port = await listen(server);
  try {
    const valid = await new Promise((resolve, reject) => {
      const request = http.request({
        host: "127.0.0.1",
        port,
        method: "GET",
        path: "/api/d51/items/123?token=query-secret",
        headers: {
          authorization: `Bearer ${marker}`,
          "x-request-id": "d51-valid.request-id"
        }
      }, (response) => {
        response.resume();
        response.on("end", () => resolve(response));
      });
      request.once("error", reject);
      request.end();
    });
    assert.equal(valid.headers["x-request-id"], "d51-valid.request-id");

    const invalid = await new Promise((resolve, reject) => {
      const request = http.get({
        host: "127.0.0.1",
        port,
        path: "/api/d51/items/456",
        headers: { "x-request-id": "bad value with spaces" }
      }, (response) => {
        response.resume();
        response.on("end", () => resolve(response));
      });
      request.once("error", reject);
    });
    assert.match(String(invalid.headers["x-request-id"]), /^[0-9a-f-]{36}$/);

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(logs.length, 2);
    assert.equal(logs[0].requestId, "d51-valid.request-id");
    assert.equal(logs[0].route, "/api/d51/items/:id");
    assert.equal(logs[0].method, "GET");
    assert.equal(logs[0].status, 404);
    assert.equal(typeof logs[0].durationMs, "number");
    assert.doesNotMatch(JSON.stringify(logs), /query-secret|authorization-secret|Bearer/);
  } finally {
    await close(server);
  }
});

test("health responses expose booleans without database or Redis internals", async () => {
  const server = createApp({
    logger: { info() {} },
    checkDatabaseReadiness: async () => ({
      ok: false,
      connected: false,
      schemaReady: false,
      missingTables: ["private_table_name"],
      error: "connect ECONNREFUSED mysql.internal.example:3306 token=secret"
    })
  });
  const port = await listen(server);
  try {
    for (const path of ["/health", "/health/db"]) {
      const response = await new Promise((resolve, reject) => {
        const request = http.get({ host: "127.0.0.1", port, path }, (incoming) => {
          const chunks = [];
          incoming.on("data", (chunk) => chunks.push(chunk));
          incoming.on("end", () => resolve({
            statusCode: incoming.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
          }));
        });
        request.once("error", reject);
      });
      assert.equal(response.statusCode, 503);
      const serialized = JSON.stringify(response.body);
      assert.doesNotMatch(serialized, /mysql\.internal|private_table_name|ECONNREFUSED|token|secret/i);
      assert.equal(typeof (response.body.database?.connected ?? response.body.connected), "boolean");
      assert.equal(typeof (response.body.database?.schemaReady ?? response.body.schemaReady), "boolean");
    }
  } finally {
    await close(server);
  }
});

test("terminates a request that stops sending its declared body", async () => {
  const server = createApp({
    logger: { info() {} },
    timeouts: {
      headersTimeoutMs: 200,
      requestTimeoutMs: 80,
      keepAliveTimeoutMs: 100
    }
  });
  const port = await listen(server);
  try {
    const closed = await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("slow request was not terminated"));
      }, 1000);
      socket.once("connect", () => {
        socket.write(
          "POST /api/d51/body-boundary-probe HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Content-Type: application/json\r\n" +
          "Content-Length: 10\r\n\r\n{"
        );
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.once("close", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    assert.equal(closed, true);
  } finally {
    await close(server);
  }
});
