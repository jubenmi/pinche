import test from "node:test";
import assert from "node:assert/strict";

import {
  BEIJING_TIME_ZONE,
  beijingDayUtcRange,
  beijingDateKey,
  beijingTimeText,
  beijingWallTimeToIso,
  businessDateTimeToPickerValue,
  formatBeijingDateTime,
  formatBeijingShortDateTime,
  isBusinessDateTimeReached,
  parseBusinessDateTime
} from "../src/beijingTime.js";

let freshImportSequence = 0;

function importFreshBeijingTime(scenario) {
  freshImportSequence += 1;
  return import(`../src/beijingTime.js?${scenario}-${Date.now()}-${freshImportSequence}`);
}

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

test("formats Beijing calendar values when Intl is unavailable at module startup", async () => {
  const originalIntl = globalThis.Intl;
  try {
    globalThis.Intl = undefined;
    const module = await importFreshBeijingTime("without-intl");
    assert.equal(module.beijingDateKey("2026-07-17T16:30:00.000Z"), "2026-07-18");
    assert.equal(module.beijingTimeText("2026-07-18T05:00:00.000Z"), "13:00");
  } finally {
    globalThis.Intl = originalIntl;
  }
});

test("formats Beijing date time when Intl.DateTimeFormat is incomplete", async () => {
  const originalIntl = globalThis.Intl;
  try {
    globalThis.Intl = { DateTimeFormat: class DateTimeFormat {} };
    const module = await importFreshBeijingTime("incomplete-intl");
    assert.equal(
      module.formatBeijingDateTime("2026-07-18T05:00:00.000Z"),
      "2026-07-18 13:00"
    );
  } finally {
    globalThis.Intl = originalIntl;
  }
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

test("converts business date times to picker values", () => {
  const pickerValue = { date: "2026-07-28", time: "15:00" };
  assert.deepEqual(businessDateTimeToPickerValue("2026-07-28T07:00:00.000Z"), pickerValue);
  assert.deepEqual(businessDateTimeToPickerValue("2026-07-28 15:00:00"), pickerValue);
  assert.equal(businessDateTimeToPickerValue("not-a-date"), null);
});

test("formats compact Beijing date times", () => {
  assert.equal(formatBeijingShortDateTime("2026-07-28T07:00:00.000Z"), "07-28 15:00");
  assert.equal(formatBeijingShortDateTime("not-a-date", ""), "");
});

test("checks whether business date times have been reached", () => {
  const now = Date.parse("2026-07-28T07:00:00.000Z");
  assert.equal(isBusinessDateTimeReached("2026-07-28T07:00:00.000Z", now), true);
  assert.equal(isBusinessDateTimeReached("2026-07-28 15:00:01", now), false);
  assert.equal(isBusinessDateTimeReached("not-a-date", now), false);
});

test("returns UTC boundaries for a Beijing calendar day", () => {
  const range = beijingDayUtcRange("2026-07-29");
  assert.equal(range.start.toISOString(), "2026-07-28T16:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-07-29T16:00:00.000Z");
  assert.equal(beijingDayUtcRange("2026-02-30"), null);
});
