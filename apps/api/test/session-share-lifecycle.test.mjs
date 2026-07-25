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

test("join-invite signing locks only the session before fresh membership authorization", async () => {
  const events = [];
  const queries = [];
  const connection = {
    async query(sql) {
      const normalizedSql = String(sql).replace(/\s+/g, " ").trim();
      queries.push(normalizedSql);
      if (normalizedSql.startsWith("SELECT * FROM sessions WHERE id = ?")) {
        events.push("session-read");
        return [[{
          id: 42,
          organizer_user_id: 1,
          dm_user_id: null,
          npc_user_id: null,
          status: "recruiting"
        }]];
      }
      if (normalizedSql.includes("FROM session_seats")) {
        events.push("membership-read");
        return [[{ id: 7 }]];
      }
      throw new Error(`unexpected query: ${normalizedSql}`);
    }
  };
  const result = await createSessionJoinInviteToken(
    { user: { id: 7 } },
    42,
    () => {
      events.push("sign");
      return { token: "member-token" };
    },
    {
      withTransaction: async (work) => {
        events.push("begin");
        const value = await work(connection);
        events.push("commit");
        return value;
      }
    }
  );

  assert.deepEqual(result, { token: "member-token" });
  assert.deepEqual(events, [
    "begin",
    "session-read",
    "membership-read",
    "sign",
    "commit"
  ]);
  assert.match(queries[0], /SELECT \* FROM sessions WHERE id = \? FOR UPDATE$/);
  assert.doesNotMatch(
    queries[1],
    /FOR UPDATE/,
    "membership authorization must not wait on child locks"
  );
  assert.equal(queries.length, 2, "authorization must not use stale preliminary reads");
});

test("join-invite signing serializes before a cancellation that arrives during membership", async () => {
  const membershipLookupStarted = deferred();
  const finishMembershipLookup = deferred();
  const events = [];
  let sessionStatus = "recruiting";
  let releaseTokenLock = null;
  let sessionLockTail = Promise.resolve();
  const acquireSessionLock = async (owner) => {
    const previousLock = sessionLockTail;
    let release;
    sessionLockTail = new Promise((resolve) => {
      release = resolve;
    });
    await previousLock;
    events.push(`${owner}-lock`);
    return () => {
      events.push(`${owner}-unlock`);
      release();
    };
  };
  const connection = {
    async query(sql) {
      const normalizedSql = String(sql).replace(/\s+/g, " ").trim();
      if (normalizedSql.startsWith("SELECT * FROM sessions WHERE id = ?")) {
        if (normalizedSql.endsWith("FOR UPDATE")) {
          releaseTokenLock = await acquireSessionLock("token");
          events.push("locked-read");
        } else {
          events.push("initial-read");
        }
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
      releaseTokenLock?.();
      return result;
    } catch (error) {
      events.push("rollback");
      releaseTokenLock?.();
      throw error;
    }
  };

  const tokenPromise = createSessionJoinInviteToken(
    { user: { id: 7 } },
    42,
    () => {
      events.push("sign");
      return { token: "serialized-token" };
    },
    { withTransaction }
  );
  await membershipLookupStarted.promise;
  const cancellationPromise = (async () => {
    events.push("cancel-request");
    const releaseCancellationLock = await acquireSessionLock("cancel");
    sessionStatus = "cancelled";
    events.push("cancel-write");
    releaseCancellationLock();
  })();
  await Promise.resolve();
  finishMembershipLookup.resolve();

  assert.deepEqual(await tokenPromise, { token: "serialized-token" });
  await cancellationPromise;
  assert.ok(events.indexOf("token-lock") < events.indexOf("membership-started"));
  assert.ok(events.indexOf("sign") < events.indexOf("commit"));
  assert.ok(events.indexOf("commit") < events.indexOf("cancel-lock"));
  assert.ok(events.indexOf("sign") < events.indexOf("cancel-write"));
  assert.equal(sessionStatus, "cancelled");
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
