import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRescheduleConfirmation,
  canRescheduleSession,
  formatSessionStartAt,
  parseSessionStartAt,
  rescheduleErrorRequiresRefresh,
  rescheduleErrorText,
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

test("normalized 409 started errors trigger refresh and direct guidance", () => {
  const error = Object.assign(new Error("Past or started sessions cannot be rescheduled"), {
    statusCode: 409,
    code: "CONFLICT"
  });
  assert.equal(rescheduleErrorRequiresRefresh(error), true);
  assert.equal(rescheduleErrorText(error), "车局已经开始，不能再改期；页面已刷新。");
});

test("normalized confirmation and time errors map to direct guidance", () => {
  const confirmation = Object.assign(
    new Error("Member confirmation is required before rescheduling"),
    { statusCode: 409, code: "CONFLICT" }
  );
  const past = Object.assign(new Error("startAt must be in the future"), {
    statusCode: 400,
    code: "BAD_REQUEST"
  });
  const unchanged = Object.assign(new Error("startAt must change by at least one second"), {
    statusCode: 400,
    code: "BAD_REQUEST"
  });
  assert.equal(
    rescheduleErrorText(confirmation),
    "已上车成员发生变化，请重新确认改期和通知人数。"
  );
  assert.equal(rescheduleErrorText(past), "新时间必须晚于当前时间，请重新选择。");
  assert.equal(rescheduleErrorText(unchanged), "新时间与当前时间相同，请重新选择。");
});
