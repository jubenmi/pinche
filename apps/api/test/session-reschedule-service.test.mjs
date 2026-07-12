import assert from "node:assert/strict";
import test from "node:test";

import { rescheduleSessionInTransaction } from "../src/modules/core/service.js";
import { sessionRescheduleResponse } from "../src/modules/core/session-reschedule.js";

const organizer = { user: { id: 7 }, roles: ["organizer"] };
const futureStart = new Date(Date.now() + 3_600_000);
const requestedStart = new Date(Date.now() + 7_200_000).toISOString();

function fakeConnection({
  organizerUserId = 7,
  recipients = [],
  notificationError,
  sessionStarted = 0
} = {}) {
  const calls = [];
  const connection = {
    calls,
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, values });
      if (normalized.includes("CURRENT_TIMESTAMP) AS session_started")) {
        return [[{
          id: 42,
          organizer_user_id: organizerUserId,
          script_name_snapshot: "测试剧本",
          start_at: futureStart,
          session_started: sessionStarted
        }]];
      }
      if (normalized.startsWith("SELECT id FROM session_seats")) return [[]];
      if (normalized.startsWith("SELECT id FROM session_npc_roles")) return [[]];
      if (normalized.startsWith("SELECT DISTINCT member.user_id")) return [recipients];
      if (normalized.startsWith("UPDATE sessions SET start_at")) return [{ affectedRows: 1 }];
      if (normalized.startsWith("INSERT INTO user_notifications")) {
        if (notificationError) throw notificationError;
        return [{ insertId: 1 }];
      }
      if (normalized === "SELECT * FROM sessions WHERE id = ?") {
        return [[{ id: 42, start_at: values[0] }]];
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    }
  };
  return connection;
}

test("unauthorized reschedule rejects before locks or mutation", async () => {
  const connection = fakeConnection({ organizerUserId: 99 });
  await assert.rejects(
    rescheduleSessionInTransaction(connection, organizer, 42, { startAt: requestedStart }),
    { code: "FORBIDDEN" }
  );
  assert.equal(connection.calls.length, 1);
});

test("uses the database lifecycle flag before child locks or mutation", async () => {
  const connection = fakeConnection({ sessionStarted: 1 });
  await assert.rejects(
    rescheduleSessionInTransaction(connection, organizer, 42, { startAt: requestedStart }),
    { code: "CONFLICT" }
  );
  assert.equal(connection.calls.length, 1);
});

test("member confirmation conflict performs no update or notification", async () => {
  const connection = fakeConnection({ recipients: [{ user_id: 8, open_id: "openid-8" }] });
  await assert.rejects(
    rescheduleSessionInTransaction(connection, organizer, 42, { startAt: requestedStart }),
    { code: "CONFLICT" }
  );
  assert.equal(connection.calls.some(({ sql }) => sql.startsWith("UPDATE sessions")), false);
  assert.equal(
    connection.calls.some(({ sql }) => sql.startsWith("INSERT INTO user_notifications")),
    false
  );
});

test("deduplicates seat and NPC membership and locks session, seats, then NPC roles", async () => {
  const connection = fakeConnection({
    recipients: [
      { user_id: 8, open_id: "openid-8" },
      { user_id: 8, open_id: "openid-8" }
    ]
  });
  const result = await rescheduleSessionInTransaction(connection, organizer, 42, {
    startAt: requestedStart,
    membersConfirmed: true
  });
  assert.deepEqual(result.recipients, [{ userId: 8, openid: "openid-8" }]);
  assert.equal(
    connection.calls.filter(({ sql }) => sql.startsWith("INSERT INTO user_notifications")).length,
    1
  );
  const updateCall = connection.calls.find(({ sql }) => sql.startsWith("UPDATE sessions"));
  assert.equal(updateCall.values[0] instanceof Date, true);
  assert.equal(updateCall.values[0].getUTCMilliseconds(), 0);
  const lockSql = connection.calls.slice(0, 3).map(({ sql }) => sql);
  assert.match(lockSql[0], /sessions .* FOR UPDATE$/);
  assert.match(lockSql[1], /session_seats .* FOR UPDATE$/);
  assert.match(lockSql[2], /session_npc_roles .* FOR UPDATE$/);
  assert.deepEqual(sessionRescheduleResponse(result), result.session);
  assert.equal("recipients" in sessionRescheduleResponse(result), false);
});

test("notification insert failure rejects the transaction work", async () => {
  const failure = new Error("notification insert failed");
  const connection = fakeConnection({
    recipients: [{ user_id: 8, open_id: "openid-8" }],
    notificationError: failure
  });
  await assert.rejects(
    rescheduleSessionInTransaction(connection, organizer, 42, {
      startAt: requestedStart,
      membersConfirmed: true
    }),
    failure
  );
});
