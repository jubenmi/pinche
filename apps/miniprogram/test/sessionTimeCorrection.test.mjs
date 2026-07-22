import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHistoricalTimeCorrectionConfirmation,
  canCorrectHistoricalSession,
  canCurrentOrganizerCorrectHistoricalSession,
  historicalTimeCorrectionErrorRequiresRefresh,
  historicalTimeCorrectionErrorText,
  mergeHistoricalTimeCorrectionSession,
  validateHistoricalTimeCorrection
} from "../src/utils/sessionTimeCorrection.js";

const now = "2026-07-22T08:00:00.500Z";

test("history correction is available only after the start second", () => {
  assert.equal(canCorrectHistoricalSession("2026-07-22T08:00:00.999Z", now), true);
  assert.equal(canCorrectHistoricalSession("2026-07-22T08:00:01Z", now), false);
  assert.equal(canCorrectHistoricalSession("invalid", now), false);
});

test("history correction entry requires the current organizer", () => {
  const session = {
    start_at: "2026-06-20T10:30:00Z",
    organizer_user_id: 7
  };
  assert.equal(canCurrentOrganizerCorrectHistoricalSession(session, 7, now), true);
  assert.equal(canCurrentOrganizerCorrectHistoricalSession(session, 8, now), false);
  assert.equal(
    canCurrentOrganizerCorrectHistoricalSession(
      { ...session, start_at: "2026-07-22T08:00:01Z" },
      7,
      now
    ),
    false
  );
});

test("successful correction response updates time without dropping loaded management data", () => {
  const currentSession = {
    id: 42,
    organizer_user_id: 7,
    start_at: "2026-06-20T10:30:00Z",
    seats: [{ id: 1, status: "confirmed" }]
  };
  assert.deepEqual(
    mergeHistoricalTimeCorrectionSession(currentSession, {
      session: {
        id: 42,
        organizer_user_id: 7,
        start_at: "2026-06-20T11:30:00Z"
      }
    }),
    {
      id: 42,
      organizer_user_id: 7,
      start_at: "2026-06-20T11:30:00Z",
      seats: [{ id: 1, status: "confirmed" }]
    }
  );
  assert.equal(
    mergeHistoricalTimeCorrectionSession(currentSession, {
      session: { id: 99, start_at: "2026-06-20T11:30:00Z" }
    }),
    null
  );
  assert.equal(mergeHistoricalTimeCorrectionSession(currentSession, {}), null);
});

test("accepts a changed Beijing wall time that is already past", () => {
  assert.deepEqual(
    validateHistoricalTimeCorrection(
      "2026-06-20 19:30",
      "2026-06-20T10:30:00Z",
      now
    ),
    { valid: true, startAt: "2026-06-20T11:30:00.000Z" }
  );
});

test("rejects invalid, non-past, and whole-second unchanged selections", () => {
  assert.deepEqual(
    validateHistoricalTimeCorrection("invalid", "2026-06-20T10:30:00Z", now),
    { valid: false, reason: "invalid", message: "请选择有效的历史时间。" }
  );
  assert.equal(
    validateHistoricalTimeCorrection(
      "2026-07-22 16:00",
      "2026-06-20T10:30:00Z",
      now
    ).reason,
    "not-past"
  );
  assert.equal(
    validateHistoricalTimeCorrection(
      "2026-06-20T10:30:00.999Z",
      "2026-06-20T10:30:00.001Z",
      now
    ).reason,
    "unchanged"
  );
});

test("confirmation shows old and new Beijing times and the no-relaunch warning", () => {
  const text = buildHistoricalTimeCorrectionConfirmation({
    oldStartAt: "2026-06-20T10:30:00Z",
    newStartAt: "2026-06-20T11:30:00Z"
  });
  assert.match(text, /2026-06-20 18:30/);
  assert.match(text, /2026-06-20 19:30/);
  assert.match(text, /仅修正历史记录，不会重新发车/);
});

test("lifecycle and ownership errors require refresh and use direct guidance", () => {
  const lifecycle = Object.assign(new Error("Session has not started"), {
    statusCode: 409,
    code: "SESSION_NOT_HISTORICAL"
  });
  const forbidden = Object.assign(new Error("Forbidden"), {
    statusCode: 403,
    code: "FORBIDDEN"
  });
  assert.equal(historicalTimeCorrectionErrorRequiresRefresh(lifecycle), true);
  assert.equal(historicalTimeCorrectionErrorRequiresRefresh(forbidden), true);
  assert.equal(historicalTimeCorrectionErrorText(lifecycle), "这辆车还没有开始，请使用改期。");
  assert.equal(
    historicalTimeCorrectionErrorText(forbidden),
    "你已不是本车车头，无法继续纠正时间。"
  );
});

test("target, unchanged, auth, missing, and generic errors map to stable copy", () => {
  assert.equal(
    historicalTimeCorrectionErrorText({ code: "CORRECTION_START_AT_NOT_PAST" }),
    "历史纠错只能选择已经过去的时间。"
  );
  assert.equal(
    historicalTimeCorrectionErrorText({ code: "UNCHANGED_START_AT" }),
    "新时间与原时间相同，请重新选择。"
  );
  assert.equal(
    historicalTimeCorrectionErrorText({ statusCode: 401 }),
    "登录已过期，请重新登录后再纠正时间。"
  );
  assert.equal(
    historicalTimeCorrectionErrorText({ statusCode: 404 }),
    "车局不存在或已被删除，请返回上一页。"
  );
  assert.equal(historicalTimeCorrectionErrorText({}), "时间纠错失败，请稍后重试。");
});
