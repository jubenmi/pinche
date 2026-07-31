import assert from "node:assert/strict";
import test from "node:test";
import {
  FUTURE_CARPOOL,
  HISTORICAL_RECORD,
  isHistoricalSession,
  normalizeSessionPurpose,
  sessionPurposeOf,
  sessionPurposeForStartAt
} from "../src/sessionPurpose.js";

const NOW = new Date("2026-07-31T09:00:00.000Z");

test("future dates may use an earlier clock time", () => {
  assert.equal(sessionPurposeForStartAt("2026-08-03 13:00:00", NOW), FUTURE_CARPOOL);
});

test("equal and past instants are historical while one second later is future", () => {
  assert.equal(sessionPurposeForStartAt("2026-07-31 17:00:00", NOW), HISTORICAL_RECORD);
  assert.equal(sessionPurposeForStartAt("2026-07-31 16:59:59", NOW), HISTORICAL_RECORD);
  assert.equal(sessionPurposeForStartAt("2026-07-31 17:00:01", NOW), FUTURE_CARPOOL);
});

test("invalid dates fail closed", () => {
  assert.equal(sessionPurposeForStartAt("2026-02-30 13:00:00", NOW), null);
  assert.equal(sessionPurposeForStartAt("", NOW), null);
});

test("stored purpose is explicit and backward compatible", () => {
  assert.equal(normalizeSessionPurpose(), FUTURE_CARPOOL);
  assert.equal(normalizeSessionPurpose(undefined), FUTURE_CARPOOL);
  assert.equal(normalizeSessionPurpose(HISTORICAL_RECORD), HISTORICAL_RECORD);
  assert.equal(normalizeSessionPurpose(""), null);
  assert.equal(normalizeSessionPurpose(null), null);
  assert.equal(normalizeSessionPurpose("unknown"), null);
  assert.equal(isHistoricalSession({ session_purpose: HISTORICAL_RECORD }), true);
  assert.equal(isHistoricalSession({ sessionPurpose: HISTORICAL_RECORD }), true);
  assert.equal(isHistoricalSession({}), false);
});

test("normalization rejects explicit non-string values", () => {
  assert.equal(normalizeSessionPurpose([FUTURE_CARPOOL]), null);
  assert.equal(normalizeSessionPurpose({ toString: () => FUTURE_CARPOOL }), null);
  assert.equal(normalizeSessionPurpose(1), null);
  assert.equal(normalizeSessionPurpose(true), null);
});

test("stored purpose fails closed for invalid containers", () => {
  assert.equal(sessionPurposeOf(null), null);
  assert.equal(sessionPurposeOf("historical_record"), null);
  assert.equal(sessionPurposeOf(1), null);
});

test("stored purpose distinguishes omission from explicit null", () => {
  assert.equal(sessionPurposeOf(), FUTURE_CARPOOL);
  assert.equal(sessionPurposeOf({}), FUTURE_CARPOOL);
  assert.equal(
    sessionPurposeOf({ session_purpose: null, sessionPurpose: HISTORICAL_RECORD }),
    null
  );
  assert.equal(sessionPurposeOf({ sessionPurpose: null }), null);
  assert.equal(sessionPurposeOf({ session_purpose: HISTORICAL_RECORD }), HISTORICAL_RECORD);
  assert.equal(sessionPurposeOf({ sessionPurpose: HISTORICAL_RECORD }), HISTORICAL_RECORD);
});
