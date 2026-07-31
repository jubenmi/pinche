import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

import {
  approveSignup,
  cancelSession,
  claimSessionNpcRole,
  claimSessionSeat,
  createSeat,
  createSignup,
  deleteAdminSession,
  getSession,
  getSessionForViewer,
  kickSessionSeat,
  lockSeat,
  publishSessionWithConnection,
  rejectSignup,
  updateSeat
} from "../src/modules/core/service.js";

// These connection doubles distinguish snapshot-style and locking query results
// while verifying SQL/table-lock ordering and behavior. They do not model InnoDB
// lock coverage or replace a two-connection MySQL test.

const ACTOR = {
  user: {
    id: 7,
    phoneVerifiedAt: new Date("2026-01-01T00:00:00.000Z")
  },
  roles: ["organizer"]
};

const ADMIN = {
  user: { id: 99 },
  roles: ["system_admin"]
};

const MEMBER = {
  user: { id: 12 },
  roles: ["player"]
};

const SESSION = {
  id: 101,
  organizer_user_id: ACTOR.user.id,
  session_purpose: "future_carpool",
  status: "recruiting",
  start_at: new Date("2099-01-01T00:00:00.000Z"),
  join_policy: "direct",
  join_phone_required: 0,
  npc_join_enabled: 1,
  dm_user_id: null,
  npc_user_id: null
};

const SESSION_LOCK = "SELECT * FROM sessions WHERE id = ? FOR UPDATE";
const SESSION_STARTED_LOCK =
  "SELECT *, (start_at <= CURRENT_TIMESTAMP) AS session_started FROM sessions WHERE id = ? FOR UPDATE";
const SEAT_RANGE_LOCK =
  "SELECT * FROM session_seats WHERE session_id = ? ORDER BY id FOR UPDATE";
const NPC_RANGE_LOCK =
  "SELECT * FROM session_npc_roles WHERE session_id = ? ORDER BY id FOR UPDATE";
const SIGNUP_RANGE_LOCK =
  "SELECT * FROM signups WHERE session_id = ? ORDER BY id FOR UPDATE";
const PLAIN_SEAT_MEMBERSHIP =
  "SELECT id FROM session_seats WHERE session_id = ? AND confirmed_user_id = ? AND status IN ('confirmed', 'locked') LIMIT 1";
const LOCKED_SEAT_MEMBERSHIP = `${PLAIN_SEAT_MEMBERSHIP} FOR UPDATE`;
const LOCKED_NPC_MEMBERSHIP =
  "SELECT id FROM session_npc_roles WHERE session_id = ? AND bound_user_id = ? AND status = 'active' LIMIT 1 FOR UPDATE";
const ACTIVE_PHOTO_RANGE_LOCK =
  "SELECT id FROM session_album_photos WHERE session_id = ? AND status = 'active' AND moderation_status IN ('approved', 'approved_legacy') ORDER BY id FOR UPDATE";
const CHILD_LOCK_PREFIX = [SEAT_RANGE_LOCK, NPC_RANGE_LOCK, SIGNUP_RANGE_LOCK];

function compactSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

function traceConnection(resolver) {
  const state = { queries: [], mutations: [] };
  return {
    state,
    async query(sql, values = []) {
      const normalized = compactSql(sql);
      state.queries.push({ sql: normalized, values });
      if (normalized === "SET time_zone = '+00:00'") {
        return [{ affectedRows: 0 }];
      }
      if (/^(INSERT|UPDATE|DELETE) /i.test(normalized)) {
        state.mutations.push({ sql: normalized, values });
      }
      return resolver(normalized, values, state);
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async end() {}
  };
}

async function withMockMysqlConnection(connection, work) {
  const originalCreateConnection = mysql.createConnection;
  mysql.createConnection = async () => connection;
  try {
    return await work();
  } finally {
    mysql.createConnection = originalCreateConnection;
  }
}

function lockingQueries(connection) {
  return connection.state.queries
    .map(({ sql }) => sql)
    .filter((sql) => /\bFOR UPDATE\b/.test(sql));
}

function assertCanonicalPrefix(connection, label) {
  const locks = lockingQueries(connection);
  assert.ok(
    [SESSION_LOCK, SESSION_STARTED_LOCK].includes(locks[0]),
    `${label}: parent session must be the first locking read`
  );
  assert.deepEqual(locks.slice(1, 4), CHILD_LOCK_PREFIX, label);
  assert.equal(
    locks.some((sql) => /\bJOIN\b/.test(sql)),
    false,
    `${label}: joined FOR UPDATE must not establish cross-table order`
  );
}

function canonicalResolver({ targetTable, targetRow }) {
  return (sql) => {
    if (sql === `SELECT session_id FROM ${targetTable} WHERE id = ?`) {
      return [[{ session_id: SESSION.id }]];
    }
    if (sql === SESSION_LOCK) return [[SESSION]];
    if (sql === SESSION_STARTED_LOCK) return [[{ ...SESSION, session_started: 0 }]];
    if (sql === SEAT_RANGE_LOCK) return [[{ id: 11 }]];
    if (sql === NPC_RANGE_LOCK) return [[{ id: 31 }]];
    if (sql === SIGNUP_RANGE_LOCK) return [[{ id: 41 }]];
    if (
      sql ===
      `SELECT * FROM ${targetTable} WHERE id = ? AND session_id = ? FOR UPDATE`
    ) {
      return [[targetRow]];
    }
    if (sql.startsWith("SELECT id FROM session_member_removal_reports")) return [[]];
    throw new Error(`Unexpected query: ${sql}`);
  };
}

test("seat signup and seat approval acquire the same session membership prefix", async () => {
  const createConnection = traceConnection(canonicalResolver({
    targetTable: "session_seats",
    targetRow: {
      id: 11,
      session_id: SESSION.id,
      status: "cancelled",
      confirmed_user_id: null
    }
  }));
  await withMockMysqlConnection(createConnection, () =>
    assert.rejects(() => createSignup(ACTOR, { seatId: 11 }), { statusCode: 409 })
  );
  assertCanonicalPrefix(createConnection, "createSignup");
  assert.ok(
    createConnection.state.queries.some(({ sql }) =>
      sql === SESSION_STARTED_LOCK
    )
  );
  assert.deepEqual(createConnection.state.mutations, []);

  const approveConnection = traceConnection((sql) => {
    if (sql === "SELECT session_id FROM signups WHERE id = ?") {
      return [[{ session_id: SESSION.id }]];
    }
    if (sql === SESSION_LOCK) return [[SESSION]];
    if ([SEAT_RANGE_LOCK, NPC_RANGE_LOCK, SIGNUP_RANGE_LOCK].includes(sql)) return [[]];
    if (sql === "SELECT * FROM signups WHERE id = ? AND session_id = ? FOR UPDATE") {
      return [[{
        id: 41,
        session_id: SESSION.id,
        signup_type: "seat",
        seat_id: 11,
        user_id: 12,
        status: "pending"
      }]];
    }
    if (sql === "SELECT * FROM session_seats WHERE id = ? AND session_id = ? FOR UPDATE") {
      return [[{
        id: 11,
        session_id: SESSION.id,
        status: "confirmed",
        confirmed_user_id: 13
      }]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  await withMockMysqlConnection(approveConnection, () =>
    assert.rejects(() => approveSignup(ACTOR, 41), { statusCode: 409 })
  );
  assertCanonicalPrefix(approveConnection, "approveSignup seat");
  assert.deepEqual(approveConnection.state.mutations, []);
});

test("direct seat and NPC claims lock session, seats, roles, and signups before targets", async () => {
  const seatConnection = traceConnection(canonicalResolver({
    targetTable: "session_seats",
    targetRow: {
      id: 11,
      session_id: SESSION.id,
      status: "cancelled",
      confirmed_user_id: null
    }
  }));
  await withMockMysqlConnection(seatConnection, () =>
    assert.rejects(() => claimSessionSeat(ACTOR, 11), { statusCode: 409 })
  );
  assertCanonicalPrefix(seatConnection, "claimSessionSeat");
  assert.ok(
    seatConnection.state.queries.some(({ sql }) =>
      sql === SESSION_STARTED_LOCK
    )
  );

  const npcConnection = traceConnection(canonicalResolver({
    targetTable: "session_npc_roles",
    targetRow: {
      id: 31,
      session_id: SESSION.id,
      status: "inactive",
      bound_user_id: null
    }
  }));
  await withMockMysqlConnection(npcConnection, () =>
    assert.rejects(() => claimSessionNpcRole(ACTOR, 31), { statusCode: 409 })
  );
  assertCanonicalPrefix(npcConnection, "claimSessionNpcRole");
  assert.deepEqual(seatConnection.state.mutations, []);
  assert.deepEqual(npcConnection.state.mutations, []);
});

test("NPC approval locks every role before every signup target", async () => {
  const connection = traceConnection((sql) => {
    if (sql === "SELECT session_id FROM signups WHERE id = ?") {
      return [[{ session_id: SESSION.id }]];
    }
    if (sql === SESSION_LOCK) return [[SESSION]];
    if ([SEAT_RANGE_LOCK, NPC_RANGE_LOCK, SIGNUP_RANGE_LOCK].includes(sql)) return [[]];
    if (sql === "SELECT * FROM signups WHERE id = ? AND session_id = ? FOR UPDATE") {
      return [[{
        id: 41,
        session_id: SESSION.id,
        signup_type: "session_npc_role",
        session_npc_role_id: 31,
        user_id: 12,
        status: "pending"
      }]];
    }
    if (sql === "SELECT * FROM session_npc_roles WHERE id = ? AND session_id = ? FOR UPDATE") {
      return [[{
        id: 31,
        session_id: SESSION.id,
        status: "inactive",
        bound_user_id: null
      }]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  await withMockMysqlConnection(connection, () =>
    assert.rejects(() => approveSignup(ACTOR, 41), { statusCode: 409 })
  );

  assertCanonicalPrefix(connection, "approveSignup NPC");
  assert.ok(
    lockingQueries(connection).indexOf(NPC_RANGE_LOCK) <
      lockingQueries(connection).indexOf(
        "SELECT * FROM signups WHERE id = ? AND session_id = ? FOR UPDATE"
      )
  );
  assert.deepEqual(connection.state.mutations, []);
});

test("historical reject remains available while kick prelocks membership rows", async () => {
  const rejectConnection = traceConnection((sql) => {
    if (sql === "SELECT session_id FROM signups WHERE id = ?") {
      return [[{ session_id: SESSION.id }]];
    }
    if (sql === SESSION_LOCK) {
      return [[{ ...SESSION, session_purpose: "historical_record", status: "locked" }]];
    }
    if (sql === SEAT_RANGE_LOCK) return [[{ id: 11 }]];
    if (sql === NPC_RANGE_LOCK) return [[{ id: 31 }]];
    if (sql === SIGNUP_RANGE_LOCK) return [[{ id: 41 }]];
    if (sql === "SELECT * FROM signups WHERE id = ? AND session_id = ? FOR UPDATE") {
      return [[{
        id: 41,
        session_id: SESSION.id,
        signup_type: "seat",
        seat_id: 11,
        user_id: 12,
        status: "pending"
      }]];
    }
    if (sql === "UPDATE signups SET status = 'rejected' WHERE id = ?") {
      throw new Error("HISTORICAL_REJECT_REACHED_WRITE");
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  await withMockMysqlConnection(rejectConnection, () =>
    assert.rejects(
      () => rejectSignup(ACTOR, 41),
      { message: "HISTORICAL_REJECT_REACHED_WRITE" }
    )
  );
  assertCanonicalPrefix(rejectConnection, "rejectSignup");

  const kickConnection = traceConnection(canonicalResolver({
    targetTable: "session_seats",
    targetRow: {
      id: 11,
      session_id: SESSION.id,
      name: "A",
      status: "open",
      confirmed_user_id: null
    }
  }));
  await withMockMysqlConnection(kickConnection, () =>
    assert.rejects(
      () => kickSessionSeat(ACTOR, 11, { report: true, reasonType: "safety_other" }),
      { statusCode: 409 }
    )
  );
  assertCanonicalPrefix(kickConnection, "kickSessionSeat");
  assert.equal(rejectConnection.state.mutations.length, 1);
  assert.deepEqual(kickConnection.state.mutations, []);
});

test("historical publish locks roles and signups after its validated seat snapshot", async () => {
  const connection = traceConnection((sql) => {
    if (sql === SESSION_LOCK) {
      return [[{
        ...SESSION,
        status: "draft",
        session_purpose: "historical_record",
        visibility: "share_only"
      }]];
    }
    if (sql === "SELECT * FROM session_seats WHERE session_id = ? ORDER BY id FOR UPDATE") {
      return [[{
        id: 11,
        session_id: SESSION.id,
        status: "open",
        confirmed_user_id: null,
        adjustment: 0,
        payable_price: 100
      }]];
    }
    if (sql === NPC_RANGE_LOCK) return [[{ id: 31 }]];
    if (sql === SIGNUP_RANGE_LOCK) return [[{ id: 41 }]];
    if (sql.startsWith("UPDATE session_seats SET status = 'confirmed'")) {
      throw new Error("STOP_AFTER_PREFIX");
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  await assert.rejects(
    () => publishSessionWithConnection(connection, ACTOR, SESSION.id, { creatorSeatId: 11 }),
    { message: "STOP_AFTER_PREFIX" }
  );

  assert.deepEqual(lockingQueries(connection).slice(0, 4), [
    SESSION_LOCK,
    "SELECT * FROM session_seats WHERE session_id = ? ORDER BY id FOR UPDATE",
    NPC_RANGE_LOCK,
    SIGNUP_RANGE_LOCK
  ]);
});

function deleteResolver(sql) {
  if (
    sql === SESSION_LOCK ||
    sql === SESSION_STARTED_LOCK ||
    sql === "SELECT id FROM sessions WHERE id = ? FOR UPDATE"
  ) {
    return [[SESSION]];
  }
  if (sql.includes("FROM session_seats") && !/FOR UPDATE/.test(sql)) return [[]];
  if (sql.includes("FROM session_npc_roles") && !/FOR UPDATE/.test(sql)) return [[]];
  if (sql.includes("FROM session_album_photos")) {
    return /FOR UPDATE/.test(sql) ? [[]] : [[{ count: 0 }]];
  }
  if (sql === SEAT_RANGE_LOCK) return [[{ id: 11 }]];
  if (sql === NPC_RANGE_LOCK) return [[{ id: 31 }]];
  if (sql === SIGNUP_RANGE_LOCK) return [[{ id: 41 }]];
  if (/^(UPDATE|DELETE) /.test(sql)) throw new Error("STOP_BEFORE_DELETE");
  throw new Error(`Unexpected query: ${sql}`);
}

test("organizer cancel and admin delete prelock the full membership tree", async () => {
  for (const [label, invoke] of [
    ["cancelSession", () => cancelSession(ACTOR, SESSION.id)],
    ["deleteAdminSession", () => deleteAdminSession(SESSION.id)]
  ]) {
    const connection = traceConnection(deleteResolver);
    await withMockMysqlConnection(connection, () =>
      assert.rejects(invoke, { message: "STOP_BEFORE_DELETE" })
    );
    assertCanonicalPrefix(connection, label);
  }
});

test("member detail locks the parent and full membership before legacy cleanup writes", async () => {
  const connection = traceConnection((sql) => {
    if (
      sql === "SELECT * FROM sessions WHERE id = ?" ||
      sql === SESSION_LOCK ||
      sql === SESSION_STARTED_LOCK
    ) {
      return [[SESSION]];
    }
    if (sql === SEAT_RANGE_LOCK) {
      return [[{
        id: 11,
        session_id: SESSION.id,
        status: "confirmed",
        confirmed_user_id: MEMBER.user.id
      }]];
    }
    if (sql === NPC_RANGE_LOCK) {
      return [[{
        id: 31,
        session_id: SESSION.id,
        name: "NPC",
        status: "active",
        bound_user_id: MEMBER.user.id
      }]];
    }
    if (sql === SIGNUP_RANGE_LOCK) return [[{ id: 41 }]];
    if (sql.startsWith("SELECT DISTINCT confirmed_user_id AS user_id")) {
      return [[{ user_id: 12 }]];
    }
    if (sql.startsWith("SELECT id, name FROM session_npc_roles")) {
      return [[{ id: 31, name: "NPC" }]];
    }
    if (/^UPDATE /.test(sql)) throw new Error(`STOP_CLEANUP:${sql}`);
    throw new Error(`Unexpected query: ${sql}`);
  });

  await withMockMysqlConnection(connection, () =>
    assert.rejects(() => getSession(SESSION.id), /STOP_CLEANUP/)
  );

  assertCanonicalPrefix(connection, "memberSessionDetail");
  assert.match(
    connection.state.mutations[0].sql,
    /^UPDATE session_npc_roles SET bound_user_id = NULL/
  );
});

test("the locked DB clock controls started-seat eligibility", async () => {
  const connection = traceConnection((sql) => {
    if (sql === "SELECT session_id FROM session_seats WHERE id = ?") {
      return [[{ session_id: SESSION.id }]];
    }
    if (sql === SESSION_STARTED_LOCK) {
      return [[{
        ...SESSION,
        status: "locked",
        start_at: new Date("2000-01-01T00:00:00.000Z"),
        session_started: 0
      }]];
    }
    if (sql === SEAT_RANGE_LOCK) return [[{ id: 11 }]];
    if (sql === NPC_RANGE_LOCK) return [[{ id: 31 }]];
    if (sql === SIGNUP_RANGE_LOCK) return [[{ id: 41 }]];
    if (sql === "SELECT * FROM session_seats WHERE id = ? AND session_id = ? FOR UPDATE") {
      return [[{
        id: 11,
        session_id: SESSION.id,
        status: "open",
        confirmed_user_id: null
      }]];
    }
    if (sql.startsWith("SELECT id FROM session_member_removal_reports")) {
      throw new Error("APP_CLOCK_WOULD_HAVE_ACCEPTED");
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  await withMockMysqlConnection(connection, () =>
    assert.rejects(() => createSignup(ACTOR, { seatId: 11 }), {
      statusCode: 400,
      message: "Session is not recruiting"
    })
  );
  assert.deepEqual(lockingQueries(connection).slice(0, 4), [
    SESSION_STARTED_LOCK,
    SEAT_RANGE_LOCK,
    NPC_RANGE_LOCK,
    SIGNUP_RANGE_LOCK
  ]);
  assert.equal(
    connection.state.queries.some(({ sql }) =>
      sql ===
        "SELECT (start_at <= CURRENT_TIMESTAMP) AS session_started FROM sessions WHERE id = ?"
    ),
    false,
    "started state must come from the locking session read, not a stale snapshot query"
  );
});

test("a locking removal-report read blocks a join hidden by the repeatable-read snapshot", async () => {
  const connection = traceConnection((sql) => {
    if (sql === "SELECT session_id FROM session_seats WHERE id = ?") {
      return [[{ session_id: SESSION.id }]];
    }
    if (sql === SESSION_STARTED_LOCK) {
      return [[{ ...SESSION, session_started: 0 }]];
    }
    if (sql === SEAT_RANGE_LOCK) {
      return [[{
        id: 11,
        session_id: SESSION.id,
        status: "open",
        confirmed_user_id: null
      }]];
    }
    if (sql === NPC_RANGE_LOCK || sql === SIGNUP_RANGE_LOCK) return [[]];
    if (sql === "SELECT * FROM session_seats WHERE id = ? AND session_id = ? FOR UPDATE") {
      return [[{
        id: 11,
        session_id: SESSION.id,
        status: "open",
        confirmed_user_id: null
      }]];
    }
    if (sql.startsWith("SELECT id FROM session_member_removal_reports")) {
      return /FOR UPDATE$/.test(sql) ? [[{ id: 55 }]] : [[]];
    }
    throw new Error(`STALE_REMOVAL_REPORT_ALLOWED:${sql}`);
  });

  await withMockMysqlConnection(connection, () =>
    assert.rejects(() => createSignup(ACTOR, { seatId: 11 }), {
      statusCode: 403,
      message: "User has been removed from this session"
    })
  );
  assert.ok(
    connection.state.queries.some(({ sql }) =>
      sql.startsWith("SELECT id FROM session_member_removal_reports") &&
      /FOR UPDATE$/.test(sql)
    ),
    "the removal decision must use a current locking read"
  );
  assert.deepEqual(connection.state.mutations, []);
});

test("the current locked seat range blocks switching away from another locked seat", async () => {
  const targetSeat = {
    id: 11,
    session_id: SESSION.id,
    name: "A",
    status: "open",
    confirmed_user_id: null
  };
  const connection = traceConnection((sql) => {
    if (sql === "SELECT session_id FROM session_seats WHERE id = ?") {
      return [[{ session_id: SESSION.id }]];
    }
    if (sql === SESSION_STARTED_LOCK) return [[{ ...SESSION, session_started: 0 }]];
    if (sql === SEAT_RANGE_LOCK) {
      return [[
        targetSeat,
        {
          id: 12,
          session_id: SESSION.id,
          name: "Locked B",
          status: "locked",
          confirmed_user_id: ACTOR.user.id
        }
      ]];
    }
    if (sql === NPC_RANGE_LOCK || sql === SIGNUP_RANGE_LOCK) return [[]];
    if (sql === "SELECT * FROM session_seats WHERE id = ? AND session_id = ? FOR UPDATE") {
      return [[targetSeat]];
    }
    if (sql.startsWith("SELECT id FROM session_member_removal_reports")) return [[]];
    if (sql.startsWith("SELECT id, name FROM session_seats")) return [[]];
    throw new Error(`CURRENT_LOCKED_SEAT_MISSED:${sql}`);
  });

  await withMockMysqlConnection(connection, () =>
    assert.rejects(() => createSignup(ACTOR, { seatId: targetSeat.id }), {
      statusCode: 409,
      message: "User already has a locked seat in this session"
    })
  );

  assert.equal(
    connection.state.queries.some(({ sql }) =>
      sql.startsWith("SELECT id, name FROM session_seats")
    ),
    false,
    "the exclusivity decision must consume the current range, not a snapshot query"
  );
  assert.deepEqual(connection.state.mutations, []);
});

test("a blocked member cannot rejoin through an NPC claim", async () => {
  const role = {
    id: 31,
    session_id: SESSION.id,
    name: "NPC",
    status: "active",
    bound_user_id: null
  };
  const connection = traceConnection((sql) => {
    if (sql === "SELECT session_id FROM session_npc_roles WHERE id = ?") {
      return [[{ session_id: SESSION.id }]];
    }
    if (sql === SESSION_STARTED_LOCK) return [[{ ...SESSION, session_started: 0 }]];
    if (sql === SEAT_RANGE_LOCK || sql === SIGNUP_RANGE_LOCK) return [[]];
    if (sql === NPC_RANGE_LOCK) return [[role]];
    if (sql === "SELECT * FROM session_npc_roles WHERE id = ? AND session_id = ? FOR UPDATE") {
      return [[role]];
    }
    if (sql.startsWith("SELECT id FROM session_member_removal_reports")) {
      return /FOR UPDATE$/.test(sql) ? [[{ id: 56 }]] : [[]];
    }
    throw new Error(`BLOCKED_NPC_REJOIN_CONTINUED:${sql}`);
  });

  await withMockMysqlConnection(connection, () =>
    assert.rejects(() => claimSessionNpcRole(MEMBER, role.id), {
      statusCode: 403,
      message: "User has been removed from this session"
    })
  );
  assert.deepEqual(connection.state.mutations, []);
});

test("reject keeps an applied seat closed when the locked signup range has another active signup", async () => {
  const targetSignup = {
    id: 41,
    session_id: SESSION.id,
    seat_id: 11,
    session_npc_role_id: null,
    signup_type: "seat",
    user_id: MEMBER.user.id,
    status: "pending"
  };
  const connection = traceConnection((sql) => {
    if (sql === "SELECT session_id FROM signups WHERE id = ?") {
      return [[{ session_id: SESSION.id }]];
    }
    if (sql === SESSION_LOCK) return [[SESSION]];
    if (sql === SEAT_RANGE_LOCK) {
      return [[{ id: 11, session_id: SESSION.id, status: "applied" }]];
    }
    if (sql === NPC_RANGE_LOCK) return [[]];
    if (sql === SIGNUP_RANGE_LOCK) {
      return [[
        targetSignup,
        {
          id: 42,
          session_id: SESSION.id,
          seat_id: 11,
          signup_type: "seat",
          user_id: 13,
          status: "pending"
        }
      ]];
    }
    if (sql === "SELECT * FROM signups WHERE id = ? AND session_id = ? FOR UPDATE") {
      return [[targetSignup]];
    }
    if (sql === "UPDATE signups SET status = 'rejected' WHERE id = ?") {
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("SELECT COUNT(*) AS active_count FROM signups")) {
      return [[{ active_count: 0 }]];
    }
    if (sql.startsWith("UPDATE session_seats SET status = 'open'")) {
      throw new Error("STALE_COUNT_REOPENED_SEAT");
    }
    if (sql === "SELECT * FROM signups WHERE id = ?") {
      return [[{ ...targetSignup, status: "rejected" }]];
    }
    if (sql.startsWith("SELECT * FROM users WHERE id IN")) {
      throw new Error("LOCKED_SIGNUP_RANGE_PRESERVED_SEAT");
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  await withMockMysqlConnection(connection, () =>
    assert.rejects(
      () => rejectSignup(ACTOR, targetSignup.id),
      { message: "LOCKED_SIGNUP_RANGE_PRESERVED_SEAT" }
    )
  );
  assert.equal(
    connection.state.queries.some(({ sql }) =>
      sql.startsWith("SELECT COUNT(*) AS active_count FROM signups")
    ),
    false
  );
  assert.equal(
    connection.state.mutations.some(({ sql }) =>
      sql.startsWith("UPDATE session_seats SET status = 'open'")
    ),
    false
  );
});

test("cancel uses a current locked photo range instead of a stale aggregate", async () => {
  const connection = traceConnection((sql) => {
    if (sql === SESSION_LOCK) return [[SESSION]];
    if (sql === SEAT_RANGE_LOCK || sql === NPC_RANGE_LOCK || sql === SIGNUP_RANGE_LOCK) {
      return [[]];
    }
    if (sql === ACTIVE_PHOTO_RANGE_LOCK) return [[{ id: 71 }]];
    if (sql.startsWith("SELECT COUNT(*) AS count FROM session_album_photos")) {
      return [[{ count: 0 }]];
    }
    throw new Error(`CANCEL_CONTINUED_AFTER_CURRENT_PHOTO:${sql}`);
  });

  await withMockMysqlConnection(connection, () =>
    assert.rejects(() => cancelSession(ACTOR, SESSION.id), {
      statusCode: 409,
      code: "SESSION_HAS_ALBUM_PHOTOS"
    })
  );
  assert.ok(lockingQueries(connection).includes(ACTIVE_PHOTO_RANGE_LOCK));
  assert.equal(
    connection.state.queries.some(({ sql }) =>
      sql.startsWith("SELECT COUNT(*) AS count FROM session_album_photos")
    ),
    false
  );
  assert.deepEqual(connection.state.mutations, []);
});

test("signup notification identity comes from the locked session and current users", async () => {
  const organizerUserId = 88;
  const targetSeat = {
    id: 11,
    session_id: SESSION.id,
    name: "A",
    role_name: "Driver",
    status: "open",
    confirmed_user_id: null
  };
  const createdSignup = {
    id: 91,
    session_id: SESSION.id,
    seat_id: targetSeat.id,
    session_npc_role_id: null,
    signup_type: "seat",
    user_id: MEMBER.user.id,
    status: "pending"
  };
  const connection = traceConnection((sql, values) => {
    if (sql === "SELECT session_id FROM session_seats WHERE id = ?") {
      return [[{ session_id: SESSION.id }]];
    }
    if (sql === SESSION_STARTED_LOCK) {
      return [[{
        ...SESSION,
        organizer_user_id: organizerUserId,
        script_name_snapshot: "Current Script",
        store_name_snapshot: "Current Store",
        session_started: 0
      }]];
    }
    if (sql === SEAT_RANGE_LOCK) return [[targetSeat]];
    if (sql === NPC_RANGE_LOCK || sql === SIGNUP_RANGE_LOCK) return [[]];
    if (sql === "SELECT * FROM session_seats WHERE id = ? AND session_id = ? FOR UPDATE") {
      return [[targetSeat]];
    }
    if (sql.startsWith("SELECT id FROM session_member_removal_reports")) return [[]];
    if (sql === "SELECT * FROM signups WHERE seat_id = ? AND user_id = ? FOR UPDATE") {
      return [[]];
    }
    if (sql.startsWith("INSERT INTO signups")) {
      return [{ insertId: createdSignup.id, affectedRows: 1 }];
    }
    if (sql === "SELECT * FROM signups WHERE id = ?") return [[createdSignup]];
    if (/^UPDATE /.test(sql)) return [{ affectedRows: 1 }];
    if (sql.startsWith("SELECT * FROM users WHERE id IN")) {
      assert.deepEqual(values, [MEMBER.user.id, organizerUserId]);
      throw new Error("CURRENT_NOTIFICATION_USERS_LOCKED");
    }
    if (sql.includes("JOIN sessions session")) {
      throw new Error("STALE_JOINED_NOTIFICATION_USED");
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  await withMockMysqlConnection(connection, () =>
    assert.rejects(
      () => createSignup(MEMBER, { seatId: targetSeat.id }),
      { message: "CURRENT_NOTIFICATION_USERS_LOCKED" }
    )
  );
  assert.equal(
    connection.state.queries.some(({ sql }) => sql.includes("JOIN sessions session")),
    false
  );
});

test("direct NPC claim projects the role from current locked membership rows", async () => {
  const currentRole = {
    id: 31,
    session_id: SESSION.id,
    name: "NPC",
    description: "Current role",
    status: "active",
    bound_user_id: null,
    sort_order: 0
  };
  const connection = traceConnection((sql, values) => {
    if (sql === "SELECT session_id FROM session_npc_roles WHERE id = ?") {
      return [[{ session_id: SESSION.id }]];
    }
    if (sql === SESSION_STARTED_LOCK) {
      return [[{ ...SESSION, join_policy: "direct", session_started: 0 }]];
    }
    if (sql === SEAT_RANGE_LOCK || sql === SIGNUP_RANGE_LOCK) return [[]];
    if (sql === NPC_RANGE_LOCK) return [[currentRole]];
    if (sql === "SELECT * FROM session_npc_roles WHERE id = ? AND session_id = ? FOR UPDATE") {
      return [[currentRole]];
    }
    if (sql.startsWith("SELECT id FROM session_member_removal_reports")) return [[]];
    if (sql.startsWith("SELECT * FROM signups WHERE session_npc_role_id = ?")) {
      return [[]];
    }
    if (sql.startsWith("SELECT id FROM signups WHERE session_npc_role_id = ?")) {
      return [[]];
    }
    if (/^(INSERT|UPDATE) /.test(sql)) return [{ affectedRows: 1 }];
    if (sql.startsWith("SELECT * FROM users WHERE id IN")) {
      assert.deepEqual(values, [MEMBER.user.id]);
      return [[{
        id: MEMBER.user.id,
        nickname: "Current Member",
        open_id: "member-current"
      }]];
    }
    if (sql.includes("FROM session_npc_roles role")) {
      throw new Error("STALE_JOINED_NPC_ROLE_USED");
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  const result = await withMockMysqlConnection(connection, () =>
    claimSessionNpcRole(MEMBER, currentRole.id)
  );

  assert.equal(result.join_result, "npc_joined");
  assert.equal(result.npc_role.bound_user_id, MEMBER.user.id);
  assert.equal(result.npc_role.bound_user_name, "Current Member");
  assert.equal(
    connection.state.queries.some(({ sql }) => sql.includes("FROM session_npc_roles role")),
    false
  );
});

function staleViewerConnection({ visibility = "public", currentSeatRows = [] } = {}) {
  const currentSession = {
    ...SESSION,
    visibility,
    session_started: 0
  };
  return traceConnection((sql) => {
    if (sql === "SELECT * FROM sessions WHERE id = ?") return [[currentSession]];
    if (sql === PLAIN_SEAT_MEMBERSHIP) return [[{ id: 11 }]];
    if (sql === SESSION_STARTED_LOCK) return [[currentSession]];
    if (sql === SEAT_RANGE_LOCK) return [currentSeatRows];
    if (sql === NPC_RANGE_LOCK || sql === SIGNUP_RANGE_LOCK) return [[]];
    if (sql === LOCKED_SEAT_MEMBERSHIP || sql === LOCKED_NPC_MEMBERSHIP) return [[]];
    throw new Error(`STALE_MEMBER_REACHED_PRIVATE_PATH:${sql}`);
  });
}

test("stale membership falls back to the locked-current public preview without cleanup", async () => {
  const connection = staleViewerConnection();
  let authorReadCount = 0;
  const authorTextReader = {
    async find() {
      authorReadCount += 1;
      throw new Error("STALE_MEMBER_REACHED_AUTHOR_MERGE");
    }
  };

  const result = await withMockMysqlConnection(connection, () =>
    getSessionForViewer(SESSION.id, { viewer: MEMBER, authorTextReader })
  );

  assert.equal(result.access_scope, "public_preview");
  assert.deepEqual(result.seats, []);
  assert.deepEqual(result.session_npc_roles, []);
  assert.equal(authorReadCount, 0);
  assert.deepEqual(connection.state.mutations, []);
  assert.deepEqual(lockingQueries(connection).slice(0, 6), [
    SESSION_STARTED_LOCK,
    SEAT_RANGE_LOCK,
    NPC_RANGE_LOCK,
    SIGNUP_RANGE_LOCK,
    LOCKED_SEAT_MEMBERSHIP,
    LOCKED_NPC_MEMBERSHIP
  ]);
});

test("stale membership returns the normal not-found response for a locked-current private session", async () => {
  const connection = staleViewerConnection({ visibility: "share_only" });

  await withMockMysqlConnection(connection, () =>
    assert.rejects(() => getSessionForViewer(SESSION.id, { viewer: MEMBER }), {
      statusCode: 404,
      message: "Session not found"
    })
  );

  assert.deepEqual(connection.state.mutations, []);
  assert.ok(lockingQueries(connection).includes(LOCKED_NPC_MEMBERSHIP));
});

test("locked-current membership is revalidated before member cleanup starts", async () => {
  const currentSeat = {
    id: 11,
    session_id: SESSION.id,
    name: "A",
    status: "confirmed",
    confirmed_user_id: MEMBER.user.id
  };
  const connection = traceConnection((sql, _values, state) => {
    if (sql === "SELECT * FROM sessions WHERE id = ?") {
      return [[{ ...SESSION, visibility: "share_only" }]];
    }
    if (sql === PLAIN_SEAT_MEMBERSHIP) return [[{ id: currentSeat.id }]];
    if (sql === SESSION_STARTED_LOCK) {
      return [[{ ...SESSION, visibility: "share_only", session_started: 0 }]];
    }
    if (sql === SEAT_RANGE_LOCK) return [[currentSeat]];
    if (sql === NPC_RANGE_LOCK) {
      return [[{
        id: 31,
        session_id: SESSION.id,
        name: "NPC",
        status: "active",
        bound_user_id: MEMBER.user.id
      }]];
    }
    if (sql === SIGNUP_RANGE_LOCK) return [[]];
    if (sql === LOCKED_SEAT_MEMBERSHIP) return [[{ id: currentSeat.id }]];
    if (sql.startsWith("SELECT DISTINCT confirmed_user_id AS user_id")) {
      return [[{ user_id: MEMBER.user.id }]];
    }
    if (sql.startsWith("SELECT id, name FROM session_npc_roles")) {
      return [[{ id: 31, name: "NPC" }]];
    }
    if (/^UPDATE /.test(sql)) {
      const revalidated = state.queries.some(({ sql: query }) =>
        query === LOCKED_SEAT_MEMBERSHIP
      );
      throw new Error(
        revalidated
          ? "CLEANUP_AFTER_CURRENT_MEMBERSHIP"
          : "CLEANUP_BEFORE_CURRENT_MEMBERSHIP"
      );
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  await withMockMysqlConnection(connection, () =>
    assert.rejects(
      () => getSessionForViewer(SESSION.id, { viewer: MEMBER }),
      { message: "CLEANUP_AFTER_CURRENT_MEMBERSHIP" }
    )
  );

  const revalidationIndex = connection.state.queries.findIndex(
    ({ sql }) => sql === LOCKED_SEAT_MEMBERSHIP
  );
  const cleanupIndex = connection.state.queries.findIndex(({ sql }) => /^UPDATE /.test(sql));
  assert.ok(revalidationIndex >= 0 && revalidationIndex < cleanupIndex);
});

test("seat creation, update, and lock acquire parent before the seat range", async () => {
  const createConnection = traceConnection((sql) => {
    if (sql === SESSION_LOCK) return [[SESSION]];
    if (sql === SEAT_RANGE_LOCK) return [[{ id: 11 }]];
    if (sql.startsWith("INSERT INTO session_seats")) {
      throw new Error("CREATE_SEAT_REACHED_WRITE");
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  await withMockMysqlConnection(createConnection, () =>
    assert.rejects(
      () => createSeat(ACTOR, SESSION.id, { name: "B", basePrice: 100 }),
      { message: "CREATE_SEAT_REACHED_WRITE" }
    )
  );
  assert.deepEqual(lockingQueries(createConnection).slice(0, 2), [
    SESSION_LOCK,
    SEAT_RANGE_LOCK
  ]);

  for (const [label, invoke, writePrefix] of [
    ["updateSeat", () => updateSeat(ACTOR, 11, { name: "B" }), "UPDATE session_seats SET"],
    ["lockSeat", () => lockSeat(ACTOR, 11), "UPDATE session_seats SET status = 'locked'"]
  ]) {
    const connection = traceConnection((sql) => {
      if (sql === "SELECT session_id FROM session_seats WHERE id = ?") {
        return [[{ session_id: SESSION.id }]];
      }
      if (sql === SESSION_STARTED_LOCK) return [[{ ...SESSION, session_started: 0 }]];
      if (sql === SEAT_RANGE_LOCK) return [[{ id: 11 }]];
      if (sql === "SELECT * FROM session_seats WHERE id = ? AND session_id = ? FOR UPDATE") {
        return [[{
          id: 11,
          session_id: SESSION.id,
          name: "A",
          status: "confirmed",
          base_price: 100,
          adjustment: 0
        }]];
      }
      if (sql.startsWith(writePrefix)) throw new Error(`${label}_REACHED_WRITE`);
      throw new Error(`Unexpected query: ${sql}`);
    });
    await withMockMysqlConnection(connection, () =>
      assert.rejects(invoke, { message: `${label}_REACHED_WRITE` })
    );
    assert.deepEqual(lockingQueries(connection).slice(0, 3), [
      SESSION_STARTED_LOCK,
      SEAT_RANGE_LOCK,
      "SELECT * FROM session_seats WHERE id = ? AND session_id = ? FOR UPDATE"
    ]);
  }
});
