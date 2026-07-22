import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createApp } from "../src/app/create-app.js";
import { jsonResponse } from "../src/http/response.js";
import { createRouter } from "../src/http/router.js";

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

async function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      host: "127.0.0.1",
      port,
      path: pathname,
      method: options.method || "GET",
      headers: options.body ? {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(options.body),
      } : {},
    }, (incoming) => {
      const chunks = [];
      incoming.on("data", (chunk) => chunks.push(chunk));
      incoming.on("end", () => resolve({
        statusCode: incoming.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      }));
    });
    outgoing.once("error", reject);
    outgoing.end(options.body);
  });
}

async function withApp(options, work) {
  const server = createApp({ logger: { info() {} }, ...options });
  const port = await listen(server);
  try {
    return await work(port);
  } finally {
    await close(server);
  }
}

test("a registered module route executes once and never falls through to legacy", async () => {
  const counts = { module: 0, legacy: 0 };
  const router = createRouter();
  router.register({
    method: "POST",
    path: "/api/routed/:id",
    name: "test.routed",
    body: { kind: "json", maxBytes: 128 },
    auth: "none",
    handler({ response, params, body }) {
      counts.module += 1;
      jsonResponse(response, 200, { ok: true, data: { id: params.id, body } });
    },
  });

  const response = await withApp({
    moduleRouters: [router],
    legacyRoute: async () => {
      counts.legacy += 1;
      return true;
    },
  }, (port) => request(port, "/api/routed/7", {
    method: "POST",
    body: JSON.stringify({ value: "one" }),
  }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data, { id: "7", body: { value: "one" } });
  assert.deepEqual(counts, { module: 1, legacy: 0 });
});

test("extension precedes legacy, legacy precedes 404, and each path runs once", async () => {
  const counts = { extension: 0, legacy: 0 };
  const extension = await withApp({
    extensionRoute: async ({ response, url }) => {
      counts.extension += 1;
      if (url.pathname !== "/extension") return false;
      jsonResponse(response, 200, { ok: true, data: "extension" });
      return true;
    },
    legacyRoute: async ({ response, url }) => {
      counts.legacy += 1;
      if (url.pathname !== "/legacy") return false;
      jsonResponse(response, 200, { ok: true, data: "legacy" });
      return true;
    },
  }, async (port) => ({
    extension: await request(port, "/extension"),
    legacy: await request(port, "/legacy"),
    missing: await request(port, "/missing"),
  }));

  assert.equal(extension.extension.body.data, "extension");
  assert.equal(extension.legacy.body.data, "legacy");
  assert.equal(extension.missing.statusCode, 404);
  assert.deepEqual(counts, { extension: 3, legacy: 2 });
});

test("foundation health routes never enter extension or legacy", async () => {
  const counts = { extension: 0, legacy: 0 };
  const responses = await withApp({
    dependencies: {
      checkDatabaseReadiness: async () => ({ ok: true, connected: true, schemaReady: true }),
      publicConfig: () => ({ production: false }),
    },
    extensionRoute: async () => {
      counts.extension += 1;
      return false;
    },
    legacyRoute: async () => {
      counts.legacy += 1;
      return false;
    },
  }, async (port) => ({
    health: await request(port, "/health"),
    database: await request(port, "/health/db"),
  }));

  assert.equal(responses.health.body.database.schemaReady, true);
  assert.deepEqual(responses.database.body, {
    ok: true,
    connected: true,
    schemaReady: true,
  });
  assert.deepEqual(counts, { extension: 0, legacy: 0 });
});
