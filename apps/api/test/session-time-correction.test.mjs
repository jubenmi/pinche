import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSessionTimeCorrectionStartAt } from "../src/modules/core/session-time-correction.js";

const NOW = new Date("2026-07-22T08:00:00.500Z");
const CURRENT = new Date("2026-06-20T10:30:00.000Z");

test("normalizes a past explicit-offset timestamp to MySQL second precision", () => {
  assert.deepEqual(
    normalizeSessionTimeCorrectionStartAt("2026-06-20T19:30:45.987+08:00", CURRENT, NOW),
    {
      date: new Date("2026-06-20T11:30:45.000Z"),
      canonical: "2026-06-20T11:30:45.000Z"
    }
  );
});

test("rejects missing timezone, invalid calendar values, and invalid offsets", () => {
  for (const value of [
    "2026-06-20T19:30:00",
    "2026-02-30T19:30:00+08:00",
    "2026-06-20T19:30:00+14:01"
  ]) {
    assert.throws(
      () => normalizeSessionTimeCorrectionStartAt(value, CURRENT, NOW),
      { code: "INVALID_START_AT" }
    );
  }
});

test("rejects a target that is not past and a second-precision no-op", () => {
  assert.throws(
    () => normalizeSessionTimeCorrectionStartAt("2026-07-22T08:00:00.500Z", CURRENT, NOW),
    { code: "CORRECTION_START_AT_NOT_PAST" }
  );
  assert.throws(
    () => normalizeSessionTimeCorrectionStartAt("2026-06-20T10:30:00.999Z", CURRENT, NOW),
    { code: "UNCHANGED_START_AT" }
  );
});
