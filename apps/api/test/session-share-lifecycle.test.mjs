import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSessionJoinInviteTokenAllowed,
  createSessionJoinInviteToken,
  sessionHasStarted
} from "../src/modules/core/service.js";

const now = Date.parse("2026-07-24T12:00:00.000Z");

test("session lifecycle reports whether the configured start time has passed", () => {
  assert.equal(sessionHasStarted({ start_at: "2026-07-24T11:59:59Z" }, now), true);
  assert.equal(sessionHasStarted({ start_at: "2026-07-24T12:00:00Z" }, now), true);
  assert.equal(sessionHasStarted({ start_at: "2026-07-24T12:00:01Z" }, now), false);
});

test("session lifecycle fails closed when start_at is missing or invalid", () => {
  assert.equal(sessionHasStarted({}, now), false);
  assert.equal(sessionHasStarted({ start_at: "not-a-date" }, now), false);
});

test("cancelled sessions cannot authorize join-invite token creation", () => {
  assert.throws(
    () => assertSessionJoinInviteTokenAllowed({ id: 42, status: "cancelled" }),
    (error) =>
      error?.statusCode === 409 &&
      error?.code === "CONFLICT" &&
      /cancelled/i.test(error.message)
  );
  assert.equal(
    assertSessionJoinInviteTokenAllowed({ id: 42, status: "recruiting" }).id,
    42
  );
});

test("join-invite signing rechecks a concurrent cancellation under the transaction lock", async () => {
  const membershipLookupStarted = deferred();
  const finishMembershipLookup = deferred();
  const events = [];
  let sessionStatus = "recruiting";
  let signerCalls = 0;
  const connection = {
    async query(sql) {
      const normalizedSql = String(sql).replace(/\s+/g, " ").trim();
      if (normalizedSql.startsWith("SELECT * FROM sessions WHERE id = ?")) {
        events.push(normalizedSql.endsWith("FOR UPDATE") ? "locked-read" : "initial-read");
        return [
          [
            {
              id: 42,
              organizer_user_id: 1,
              dm_user_id: null,
              npc_user_id: null,
              status: sessionStatus
            }
          ]
        ];
      }
      if (normalizedSql.includes("FROM session_seats")) {
        events.push("membership-started");
        membershipLookupStarted.resolve();
        await finishMembershipLookup.promise;
        events.push("membership-finished");
        return [[{ id: 7 }]];
      }
      throw new Error(`unexpected query: ${normalizedSql}`);
    }
  };
  const withTransaction = async (work) => {
    events.push("begin");
    try {
      const result = await work(connection);
      events.push("commit");
      return result;
    } catch (error) {
      events.push("rollback");
      throw error;
    }
  };

  const tokenPromise = createSessionJoinInviteToken(
    { user: { id: 7 } },
    42,
    () => {
      signerCalls += 1;
      events.push("sign");
      return { token: "must-not-exist" };
    },
    { withTransaction }
  );
  await membershipLookupStarted.promise;
  events.push("cancel");
  sessionStatus = "cancelled";
  finishMembershipLookup.resolve();

  await assert.rejects(
    tokenPromise,
    (error) => error?.statusCode === 409 && error?.code === "CONFLICT"
  );
  assert.equal(signerCalls, 0, "the signer must not run after cancellation wins the race");
  assert.deepEqual(events, [
    "begin",
    "initial-read",
    "membership-started",
    "cancel",
    "membership-finished",
    "locked-read",
    "rollback"
  ]);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
