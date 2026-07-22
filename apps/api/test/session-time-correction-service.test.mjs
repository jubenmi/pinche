import assert from "node:assert/strict";
import test from "node:test";

import { correctHistoricalSessionStartTimeInTransaction } from "../src/modules/core/service.js";

const organizer = { user: { id: 7 }, roles: ["organizer"] };
const adminNonOrganizer = { user: { id: 99 }, roles: ["system_admin"] };
const oldStart = new Date("2026-06-20T10:30:00.000Z");
const correctedStart = new Date("2026-06-20T11:30:00.000Z");
const databaseNow = new Date("2026-07-22T08:00:00.000Z");

function fakeConnection({ exists = true, organizerUserId = 7, sessionStarted = 1, auditError } = {}) {
  const calls = [];
  let storedStart = oldStart;
  return {
    calls,
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, values });
      if (normalized.includes("AS session_started") && normalized.endsWith("FOR UPDATE")) {
        return [exists
          ? [{
              id: 42,
              organizer_user_id: organizerUserId,
              start_at: storedStart,
              database_now: databaseNow,
              session_started: sessionStarted
            }]
          : []];
      }
      if (normalized.startsWith("UPDATE sessions SET start_at")) {
        storedStart = values[0];
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("INSERT INTO session_start_time_corrections")) {
        if (auditError) throw auditError;
        return [{ insertId: 9 }];
      }
      if (normalized === "SELECT * FROM sessions WHERE id = ?") {
        return [[{ id: 42, organizer_user_id: organizerUserId, start_at: storedStart }]];
      }
      if (normalized === "SELECT * FROM session_start_time_corrections WHERE id = ?") {
        return [[{
          id: 9,
          session_id: 42,
          changed_by_user_id: 7,
          old_start_at: oldStart,
          new_start_at: storedStart
        }]];
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    }
  };
}

test("rejects a missing session before mutation", async () => {
  const connection = fakeConnection({ exists: false });
  await assert.rejects(
    correctHistoricalSessionStartTimeInTransaction(connection, organizer, 42, {
      startAt: "2026-06-20T19:30:00+08:00"
    }),
    { code: "NOT_FOUND" }
  );
  assert.equal(connection.calls.length, 1);
});

test("rejects every non-organizer including an administrator before mutation", async () => {
  const connection = fakeConnection();
  await assert.rejects(
    correctHistoricalSessionStartTimeInTransaction(connection, adminNonOrganizer, 42, {
      startAt: "2026-06-20T19:30:00+08:00"
    }),
    { code: "FORBIDDEN" }
  );
  assert.equal(connection.calls.length, 1);
});

test("rejects a session that is not historical with a stable code", async () => {
  const connection = fakeConnection({ sessionStarted: 0 });
  await assert.rejects(
    correctHistoricalSessionStartTimeInTransaction(connection, organizer, 42, {
      startAt: "2026-06-20T19:30:00+08:00"
    }),
    { code: "SESSION_NOT_HISTORICAL", statusCode: 409 }
  );
  assert.equal(connection.calls.length, 1);
});

test("preserves a stable code when the corrected time is not past", async () => {
  const connection = fakeConnection();
  await assert.rejects(
    correctHistoricalSessionStartTimeInTransaction(connection, organizer, 42, {
      startAt: "2026-07-22T08:00:00Z"
    }),
    { code: "CORRECTION_START_AT_NOT_PAST", statusCode: 400 }
  );
  assert.equal(connection.calls.length, 1);
});

test("locks the session, updates only start_at, and appends one audit row", async () => {
  const connection = fakeConnection();
  const result = await correctHistoricalSessionStartTimeInTransaction(connection, organizer, 42, {
    startAt: "2026-06-20T19:30:00+08:00"
  });

  assert.match(connection.calls[0].sql, /FROM sessions WHERE id = \? FOR UPDATE$/);
  const update = connection.calls.find(({ sql }) => sql.startsWith("UPDATE sessions SET start_at"));
  const audit = connection.calls.find(({ sql }) =>
    sql.startsWith("INSERT INTO session_start_time_corrections")
  );
  assert.deepEqual(update.values, [correctedStart, 42]);
  assert.deepEqual(audit.values, [42, 7, oldStart, correctedStart]);
  assert.equal(connection.calls.some(({ sql }) => sql.includes("user_notifications")), false);
  assert.equal(result.session.start_at.toISOString(), correctedStart.toISOString());
  assert.equal(result.correction.id, 9);
});

test("surfaces an audit insert failure after the update so the outer transaction can roll back", async () => {
  const failure = new Error("audit insert failed");
  const connection = fakeConnection({ auditError: failure });
  await assert.rejects(
    correctHistoricalSessionStartTimeInTransaction(connection, organizer, 42, {
      startAt: "2026-06-20T19:30:00+08:00"
    }),
    failure
  );
  assert.deepEqual(
    connection.calls
      .filter(({ sql }) =>
        sql.startsWith("UPDATE sessions") ||
        sql.startsWith("INSERT INTO session_start_time_corrections")
      )
      .map(({ sql }) => sql.split(" ")[0]),
    ["UPDATE", "INSERT"]
  );
});
