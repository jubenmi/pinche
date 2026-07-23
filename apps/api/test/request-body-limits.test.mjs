import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { JSON_BODY_MAX_BYTES, bodyFor } from "../src/server.js";

function jsonRequest(body) {
  const request = Readable.from([Buffer.from(body)]);
  request.method = "POST";
  request.headers = {};
  return request;
}

test("generic JSON accepts a large selected-media payload below the byte limit", async () => {
  const mediaIds = Array.from({ length: 100_000 }, (_, index) => index + 1);
  const body = JSON.stringify({ mediaIds });
  assert.ok(Buffer.byteLength(body) < JSON_BODY_MAX_BYTES);

  assert.deepEqual(await bodyFor(jsonRequest(body)), { mediaIds });
});

test("generic JSON rejects an oversized body with BAD_REQUEST rather than INVALID_JSON", async () => {
  const request = jsonRequest(" ".repeat(JSON_BODY_MAX_BYTES + 1));

  await assert.rejects(
    () => bodyFor(request),
    (error) =>
      error?.statusCode === 400 &&
      error.code === "BAD_REQUEST" &&
      error.message === "request body is too large"
  );
});

test("generic JSON still reports malformed JSON as INVALID_JSON", async () => {
  await assert.rejects(
    () => bodyFor(jsonRequest("{")),
    (error) => error?.statusCode === 400 && error.code === "INVALID_JSON"
  );
});
