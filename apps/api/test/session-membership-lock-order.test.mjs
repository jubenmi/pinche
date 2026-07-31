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
  kickSessionSeat,
  lockSeat,
  publishSessionWithConnection,
  rejectSignup,
  updateSeat
} from "../src/modules/core/service.js";

// These connection doubles verify SQL statement and table-lock ordering only.
// They do not model InnoDB lock coverage or replace a two-connection MySQL test.

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
const SEAT_RANGE_LOCK =
  "SELECT id FROM session_seats WHERE session_id = ? ORDER BY id FOR UPDATE";
const NPC_RANGE_LOCK =
  "SELECT id FROM session_npc_roles WHERE session_id = ? ORDER BY id FOR UPDATE";
const SIGNUP_RANGE_LOCK =
  "SELECT id FROM signups WHERE session_id = ? ORDER BY id FOR UPDATE";
const CANONICAL_PREFIX = [
  SESSION_LOCK,
  SEAT_RANGE_LOCK,
  NPC_RANGE_LOCK,
  SIGNUP_RANGE_LOCK
];

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
  assert.deepEqual(locks.slice(0, CANONICAL_PREFIX.length), CANONICAL_PREFIX, label);
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
    if (sql === SEAT_RANGE_LOCK) return [[{ id: 11 }]];
    if (sql === NPC_RANGE_LOCK) return [[{ id: 31 }]];
    if (sql === SIGNUP_RANGE_LOCK) return [[{ id: 41 }]];
    if (
      sql ===
      "SELECT (start_at <= CURRENT_TIMESTAMP) AS session_started FROM sessions WHERE id = ?"
    ) {
      return [[{ session_started: 0 }]];
    }
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
      sql ===
        "SELECT (start_at <= CURRENT_TIMESTAMP) AS session_started FROM sessions WHERE id = ?"
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
      sql ===
        "SELECT (start_at <= CURRENT_TIMESTAMP) AS session_started FROM sessions WHERE id = ?"
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
  if (sql === SESSION_LOCK || sql === "SELECT id FROM sessions WHERE id = ? FOR UPDATE") {
    return [[SESSION]];
  }
  if (sql.includes("FROM session_seats") && !/FOR UPDATE/.test(sql)) return [[]];
  if (sql.includes("FROM session_npc_roles") && !/FOR UPDATE/.test(sql)) return [[]];
  if (sql.includes("FROM session_album_photos")) return [[{ count: 0 }]];
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
    if (sql === "SELECT * FROM sessions WHERE id = ?" || sql === SESSION_LOCK) {
      return [[SESSION]];
    }
    if (sql === SEAT_RANGE_LOCK) return [[{ id: 11 }]];
    if (sql === NPC_RANGE_LOCK) return [[{ id: 31 }]];
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
    if (sql === SESSION_LOCK) {
      return [[{
        ...SESSION,
        status: "locked",
        start_at: new Date("2000-01-01T00:00:00.000Z")
      }]];
    }
    if (
      sql ===
      "SELECT (start_at <= CURRENT_TIMESTAMP) AS session_started FROM sessions WHERE id = ?"
    ) {
      return [[{ session_started: 0 }]];
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
  assertCanonicalPrefix(connection, "createSignup DB clock");
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
      if (sql === SESSION_LOCK) return [[SESSION]];
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
      SESSION_LOCK,
      SEAT_RANGE_LOCK,
      "SELECT * FROM session_seats WHERE id = ? AND session_id = ? FOR UPDATE"
    ]);
  }
});
