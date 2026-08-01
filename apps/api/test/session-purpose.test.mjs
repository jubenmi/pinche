import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSessionCreationStartAt } from "../src/modules/core/session-purpose.js";

const NOW = new Date("2026-07-31T09:00:00.500Z");

test("normalizes Shanghai wall time and defaults an omitted purpose to future carpool", () => {
  assert.deepEqual(normalizeSessionCreationStartAt("2026-08-03 13:00:00", undefined, NOW), {
    date: new Date("2026-08-03T05:00:00.000Z"),
    canonical: "2026-08-03T05:00:00.000Z",
    sessionPurpose: "future_carpool"
  });
  assert.equal(
    normalizeSessionCreationStartAt("2099-08-03 13:00:00").sessionPurpose,
    "future_carpool"
  );
});

test("accepts a historical start for the historical purpose at whole-second precision", () => {
  assert.deepEqual(
    normalizeSessionCreationStartAt("2026-07-31T09:00:00.999Z", "historical_record", NOW),
    {
      date: new Date("2026-07-31T09:00:00.000Z"),
      canonical: "2026-07-31T09:00:00.000Z",
      sessionPurpose: "historical_record"
    }
  );
});

test("rejects a purpose that does not match the normalized start time", () => {
  for (const [startAt, sessionPurpose, expectedSessionPurpose] of [
    ["2026-07-31T08:59:59Z", "future_carpool", "historical_record"],
    ["2026-08-03T05:00:00Z", "historical_record", "future_carpool"]
  ]) {
    assert.throws(
      () => normalizeSessionCreationStartAt(startAt, sessionPurpose, NOW),
      {
        statusCode: 409,
        code: "SESSION_PURPOSE_TIME_MISMATCH",
        message: "startAt no longer matches sessionPurpose",
        details: { expectedSessionPurpose }
      }
    );
  }
});

test("rejects every explicit invalid purpose while omission defaults to future carpool", () => {
  for (const sessionPurpose of ["other", "", null]) {
    assert.throws(
      () => normalizeSessionCreationStartAt("2026-08-03T05:00:00Z", sessionPurpose, NOW),
      {
        statusCode: 400,
        code: "INVALID_SESSION_PURPOSE",
        message: "sessionPurpose is invalid"
      }
    );
  }

  assert.equal(
    normalizeSessionCreationStartAt("2026-08-03T05:00:00Z", undefined, NOW).sessionPurpose,
    "future_carpool"
  );
});

test("rejects an invalid calendar date", () => {
  assert.throws(
    () => normalizeSessionCreationStartAt("2026-02-30 13:00:00", "historical_record", NOW),
    {
      statusCode: 400,
      code: "INVALID_START_AT",
      message: "startAt must be a valid business timestamp"
    }
  );
});
