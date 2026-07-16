import test from "node:test";
import assert from "node:assert/strict";

import {
  BEIJING_TIME_ZONE,
  beijingDateKey,
  beijingTimeText,
  beijingWallTimeToIso,
  formatBeijingDateTime,
  parseBusinessDateTime
} from "../src/beijingTime.js";

test("formats absolute timestamps in Beijing time", () => {
  assert.equal(BEIJING_TIME_ZONE, "Asia/Shanghai");
  assert.equal(formatBeijingDateTime("2026-07-18T05:00:00.000Z"), "2026-07-18 13:00");
  assert.equal(formatBeijingDateTime("2026-07-18T13:00:00+08:00"), "2026-07-18 13:00");
  assert.equal(formatBeijingDateTime("2026-07-18T01:00:00-04:00"), "2026-07-18 13:00");
});

test("treats legacy timezone-free timestamps as Beijing wall time", () => {
  assert.equal(
    parseBusinessDateTime("2026-07-18 13:00:00").toISOString(),
    "2026-07-18T05:00:00.000Z"
  );
});

test("uses Beijing calendar parts independent of process timezone", () => {
  assert.equal(beijingDateKey("2026-07-17T16:30:00.000Z"), "2026-07-18");
  assert.equal(beijingTimeText("2026-07-18T05:00:00.000Z"), "13:00");
});

test("converts Beijing wall input to UTC transport", () => {
  assert.equal(beijingWallTimeToIso("2026-07-18 13:00"), "2026-07-18T05:00:00.000Z");
});

test("rejects invalid calendar values instead of normalizing them", () => {
  assert.equal(parseBusinessDateTime("2026-02-30 13:00:00"), null);
  assert.equal(parseBusinessDateTime("not-a-date"), null);
  assert.equal(beijingWallTimeToIso("2026-02-30 13:00"), null);
  assert.equal(formatBeijingDateTime("not-a-date"), "时间待定");
});
