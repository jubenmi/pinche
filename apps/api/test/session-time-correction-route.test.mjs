import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createApp } from "../src/server.js";

function dispatch(app, body) {
  return new Promise((resolve) => {
    const request = Readable.from([body]);
    request.method = "POST";
    request.url = "/api/sessions/42/start-time-corrections";
    request.headers = { "content-type": "application/json" };
    const response = {
      statusCode: 0,
      writeHead(statusCode) {
        this.statusCode = statusCode;
      },
      end(payload = "") {
        resolve({ statusCode: this.statusCode, payload: JSON.parse(String(payload)) });
      }
    };
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
