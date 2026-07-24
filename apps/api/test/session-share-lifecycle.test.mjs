import assert from "node:assert/strict";
import test from "node:test";

import { sessionHasStarted } from "../src/modules/core/service.js";

const now = Date.parse("2026-07-24T12:00:00.000Z");

test("session lifecycle reports whether the configured start time has passed", () => {
  assert.equal(sessionHasStarted({ start_at: "2026-07-24T11:59:59Z" }, now), true);
  assert.equal(sessionHasStarted({ start_at: "2026-07-24T12:00:01Z" }, now), false);
});

test("session lifecycle fails closed when start_at is missing or invalid", () => {
  assert.equal(sessionHasStarted({}, now), false);
  assert.equal(sessionHasStarted({ start_at: "not-a-date" }, now), false);
});
