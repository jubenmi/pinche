import test from "node:test";
import assert from "node:assert/strict";

import {
  sessionCreationDefaults,
  sessionCreationPickerValue,
  sessionCreationTransportStartAt,
  sessionCreationWallTime
} from "../src/utils/sessionCreationTime.js";

test("formats session creation picker values as Beijing wall time", () => {
  assert.equal(sessionCreationWallTime("2026-07-28", "15:00"), "2026-07-28 15:00:00");
  assert.deepEqual(sessionCreationPickerValue("2026-07-28T07:00:00.000Z"), {
    date: "2026-07-28",
    time: "15:00"
  });
  assert.equal(sessionCreationPickerValue("not-a-date"), null);
});

test("serializes session creation wall time as an explicit UTC instant", () => {
  assert.equal(
    sessionCreationTransportStartAt("2026-07-28", "15:00"),
    "2026-07-28T07:00:00.000Z"
  );
  assert.equal(sessionCreationTransportStartAt("2026-02-30", "15:00"), null);
});

test("defaults creation to tomorrow at 14:00 in Beijing", () => {
  assert.deepEqual(sessionCreationDefaults(Date.parse("2026-07-28T16:30:00.000Z")), {
    today: "2026-07-29",
    date: "2026-07-30",
    time: "14:00"
  });
});
