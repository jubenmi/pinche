import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRescheduleConfirmation,
  canRescheduleSession,
  formatSessionStartAt,
  parseSessionStartAt,
  validateRescheduleSelection
} from "../src/utils/sessionReschedule.js";

test("parseSessionStartAt accepts ISO and database timestamps", () => {
  assert.equal(parseSessionStartAt("2026-07-12T02:30:45.123Z").toISOString(), "2026-07-12T02:30:45.123Z");
  assert.equal(parseSessionStartAt("2026-07-12 02:30:45").toISOString(), "2026-07-11T18:30:45.000Z");
});

test("parseSessionStartAt rejects invalid or empty values", () => {
  assert.equal(parseSessionStartAt("not-a-date"), null);
  assert.equal(parseSessionStartAt(""), null);
  assert.equal(parseSessionStartAt(null), null);
});

test("formatSessionStartAt displays Asia/Shanghai local minute precision", () => {
  assert.equal(formatSessionStartAt("2026-07-12T02:30:45Z"), "2026-07-12 10:30");
  assert.equal(formatSessionStartAt("invalid"), "时间待定");
});

test("canRescheduleSession only permits an unstarted session", () => {
  const now = "2026-07-12T02:30:45.500Z";
  assert.equal(canRescheduleSession("2026-07-12T02:30:46Z", now), true);
  assert.equal(canRescheduleSession("2026-07-12T02:30:45.999Z", now), false);
  assert.equal(canRescheduleSession("invalid", now), false);
});

test("validateRescheduleSelection rejects invalid and past selections", () => {
  assert.deepEqual(
    validateRescheduleSelection("invalid", "2026-07-12T03:30:00Z", "2026-07-12T02:30:00Z"),
    { valid: false, reason: "invalid", message: "请选择有效的新时间。" }
  );
  assert.deepEqual(
    validateRescheduleSelection("2026-07-12T02:30:00Z", "2026-07-12T03:30:00Z", "2026-07-12T02:30:00Z"),
    { valid: false, reason: "past", message: "新时间必须晚于当前时间。" }
  );
});

test("validateRescheduleSelection compares whole seconds like the backend", () => {
  assert.deepEqual(
    validateRescheduleSelection(
      "2026-07-12T03:30:00.999Z",
      "2026-07-12T03:30:00.001Z",
      "2026-07-12T02:30:00Z"
    ),
    { valid: false, reason: "unchanged", message: "新时间与当前时间相同，请重新选择。" }
  );
  const result = validateRescheduleSelection(
    "2026-07-12T03:30:01.999Z",
    "2026-07-12T03:30:00.001Z",
    "2026-07-12T02:30:00Z"
  );
  assert.equal(result.valid, true);
  assert.equal(result.startAt, "2026-07-12T03:30:01.000Z");
});

test("buildRescheduleConfirmation includes recipient count and old/new times", () => {
  const confirmation = buildRescheduleConfirmation({
    memberCount: 2,
    oldStartAt: "2026-07-12T02:30:00Z",
    newStartAt: "2026-07-13T05:45:00Z"
  });
  assert.match(confirmation, /2 位/);
  assert.match(confirmation, /2026-07-12 10:30/);
  assert.match(confirmation, /2026-07-13 13:45/);
  assert.match(confirmation, /通知/);
});

test("buildRescheduleConfirmation uses ordinary copy without recipients", () => {
  const confirmation = buildRescheduleConfirmation({
    memberCount: 0,
    oldStartAt: "2026-07-12T02:30:00Z",
    newStartAt: "2026-07-13T05:45:00Z"
  });
  assert.doesNotMatch(confirmation, /通知将发送/);
  assert.match(confirmation, /确认将车局时间从/);
});
