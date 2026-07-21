import assert from "node:assert/strict";
import http from "node:http";
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

async function requestJson(port, { body, contentLength = true }) {
  return new Promise((resolve, reject) => {
    const headers = { "content-type": "application/json" };
    if (contentLength) {
      headers["content-length"] = String(Buffer.byteLength(body));
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
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve({
            statusCode: response.statusCode,
            body: raw ? JSON.parse(raw) : null
          });
        });
      }
    );
    request.once("error", reject);

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
  const body = JSON.stringify({ marker, value: "x".repeat(JSON_LIMIT_BYTES) });
  const response = await withApp((port) => requestJson(port, { body }));

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
