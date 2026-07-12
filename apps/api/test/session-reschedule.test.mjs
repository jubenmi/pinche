import assert from "node:assert/strict";
import test from "node:test";

import {
  createSessionRescheduleDedupeKey,
  normalizeSessionRescheduleStartAt
} from "../src/modules/core/session-reschedule.js";

const NOW = Date.parse("2026-07-12T04:00:00.500Z");
const CURRENT = new Date("2026-07-12T05:00:00.000Z");

test("normalizes explicit Z and offset timestamps to MySQL second precision", () => {
  assert.deepEqual(
    normalizeSessionRescheduleStartAt("2026-07-12T13:30:45.987+08:00", CURRENT, NOW),
    {
      date: new Date("2026-07-12T05:30:45.000Z"),
      canonical: "2026-07-12T05:30:45.000Z"
    }
  );
});

test("rejects timestamps without an explicit ISO timezone", () => {
  assert.throws(
    () => normalizeSessionRescheduleStartAt("2026-07-12T13:30:45", CURRENT, NOW),
    { code: "INVALID_START_AT" }
  );
});

test("rejects invalid and past timestamps", () => {
  assert.throws(
    () => normalizeSessionRescheduleStartAt("not-a-date", CURRENT, NOW),
    { code: "INVALID_START_AT" }
  );
  assert.throws(
    () => normalizeSessionRescheduleStartAt("2026-02-30T05:00:00Z", CURRENT, NOW),
    { code: "INVALID_START_AT" }
  );
  assert.throws(
    () => normalizeSessionRescheduleStartAt("2026-07-12T13:30:45+14:01", CURRENT, NOW),
    { code: "INVALID_START_AT" }
  );
  assert.throws(
    () => normalizeSessionRescheduleStartAt("2026-07-12T04:00:00Z", CURRENT, NOW),
    { code: "PAST_START_AT" }
  );
});

test("rejects unchanged and sub-second-only changes after normalization", () => {
  assert.throws(
    () => normalizeSessionRescheduleStartAt("2026-07-12T05:00:00Z", CURRENT, NOW),
    { code: "UNCHANGED_START_AT" }
  );
  assert.throws(
    () => normalizeSessionRescheduleStartAt("2026-07-12T05:00:00.999Z", CURRENT, NOW),
    { code: "UNCHANGED_START_AT" }
  );
});

test("creates one operation key reusable for every recipient but unique per operation", () => {
  const first = createSessionRescheduleDedupeKey(42);
  const second = createSessionRescheduleDedupeKey(42);
  assert.match(first, /^session-rescheduled:42:[0-9a-f-]{36}$/);
  assert.notEqual(first, second);
});
