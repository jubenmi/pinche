import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";

import { createApp } from "../src/server.js";

function dispatch(app, body) {
  return new Promise((resolve) => {
    const request = Readable.from([body]);
    request.method = "POST";
    request.url = "/api/sessions/42/start-time-corrections";
    request.headers = { "content-type": "application/json" };
    const response = Object.assign(new EventEmitter(), {
      statusCode: 0,
      headers: new Map(),
      setHeader(name, value) {
        this.headers.set(String(name).toLowerCase(), value);
      },
      getHeader(name) {
        return this.headers.get(String(name).toLowerCase());
      },
      writeHead(statusCode) {
        this.statusCode = statusCode;
        this.headersSent = true;
      },
      end(payload = "") {
        this.writableEnded = true;
        this.emit("finish");
        resolve({ statusCode: this.statusCode, payload: JSON.parse(String(payload)) });
      }
    });
    app.emit("request", request, response);
  });
}

test("historical time correction authenticates before accepting any request body", async () => {
  const app = createApp();

  for (const body of [JSON.stringify({ startAt: "2026-06-20T11:30:00Z" }), "{"]) {
    const response = await dispatch(app, body);
    assert.equal(response.statusCode, 401);
    assert.equal(response.payload.error.code, "UNAUTHORIZED");
  }
});
