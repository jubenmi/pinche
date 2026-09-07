import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { publishSession, publishSessionWithConnection } from "../src/modules/core/service.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../src/http/errors.js";
import { assertFutureSessionStartAt, readSessionDatabaseNow } from "../src/modules/core/session-creation-time.js";

function harness({ status = "draft", startAt = "2026-09-07T11:30:00Z", databaseNow = "2026-09-07T11:30:00Z", ownerId = 7, expiresBeforeUpdate = false } = {}) {
  const session = { id: 10, organizer_user_id: ownerId, status, start_at: new Date(startAt), database_now: new Date(databaseNow) };
  let writes = 0;
  const connection = { async query(sql) {
    if (sql.startsWith("SELECT CURRENT_TIMESTAMP")) return [[{ database_now: session.database_now }]];
    if (sql.includes("FROM sessions")) return [[session]];
    if (sql.includes("FROM session_seats")) return [[{ adjustment: 0, payable_price: 100 }]];
    if (sql.includes("UPDATE sessions")) {
      if (expiresBeforeUpdate) {
        assert.match(sql, /start_at > CURRENT_TIMESTAMP/, "final update must enforce the clock after validation");
        return [{ affectedRows: 0 }];
      }
      writes++; session.status = "recruiting"; return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const context = vm.createContext({
    withTransaction: (work) => work(connection), requireSessionOwner: async () => session,
    findById: async () => session, isAdmin: () => false, assertFutureSessionStartAt, readSessionDatabaseNow, AppError, badRequest, conflict, forbidden, notFound
  });
  vm.runInContext(publishSessionWithConnection.toString() + "\n" + publishSession.toString(), context);
  return { publish: () => context.publishSession({ user: { id: 7 }, roles: [] }, 10), writes: () => writes };
}

for (const startAt of ["2026-09-07T11:29:59Z", "2026-09-07T11:30:00Z"]) {
  test(`draft cannot publish at or after its start time: ${startAt}`, async () => {
    const state = harness({ startAt });
    await assert.rejects(state.publish(), { code: "SESSION_START_AT_NOT_FUTURE" });
    assert.equal(state.writes(), 0);
  });
}
for (const status of ["cancelled", "locked"]) {
  test(`publish cannot reopen a ${status} session`, async () => {
    const state = harness({ status, startAt: "2026-09-07T11:31:00Z" });
    await assert.rejects(state.publish(), { statusCode: 409 });
    assert.equal(state.writes(), 0);
  });
}
test("future draft publishes using the database clock even when the app clock is ahead", async (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-09-08T00:00:00Z"));
  const state = harness({ startAt: "2026-09-07T11:31:00Z" });
  assert.equal((await state.publish()).status, "recruiting");
  assert.equal(state.writes(), 1);
});

test("publishing rechecks the current organizer on the locked session", async () => {
  const state = harness({ ownerId: 8, startAt: "2026-09-07T11:31:00Z" });
  await assert.rejects(state.publish(), { statusCode: 403 });
  assert.equal(state.writes(), 0);
});

test("crossing start time between validation and update cannot publish", async () => {
  const state = harness({ startAt: "2026-09-07T11:31:00Z", expiresBeforeUpdate: true });
  await assert.rejects(state.publish(), { code: "SESSION_START_AT_NOT_FUTURE" });
  assert.equal(state.writes(), 0);
});
