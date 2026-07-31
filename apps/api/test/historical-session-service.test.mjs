import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import mysql from "mysql2/promise";

import {
  approveSignup,
  assertSessionJoinInviteAllowed,
  claimSessionNpcRole,
  claimSessionSeat,
  createSessionNpcRole,
  createSessionNpcRoleWithConnection,
  createSessionWithConnection,
  createSignup,
  publishSessionWithConnection,
  updateSession,
  updateSessionNpcRole,
  updateSessionNpcRoleWithConnection,
  updateSessionWithConnection
} from "../src/modules/core/service.js";
import { buildTextModerationDescriptor } from "../src/modules/content-moderation/text-boundaries.js";
import {
  createProductionTextProposalHandlers,
  expectedTextCreationBase
} from "../src/modules/content-moderation/text-proposal-handlers.js";
import { createTextProposalApplicator } from "../src/modules/content-moderation/text-proposal-applicator.js";
import {
  textCreationTargetSubjectId,
  textOperationSubjectId
} from "../src/modules/content-moderation/text-request-identity.js";

const ACTOR = {
  user: {
    id: 7,
    phoneVerifiedAt: new Date("2026-01-01T00:00:00.000Z")
  },
  roles: ["organizer"]
};

const ADMIN = {
  user: {
    id: 99,
    phoneVerifiedAt: new Date("2026-01-01T00:00:00.000Z")
  },
  roles: ["system_admin"]
};

function compactSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

const HISTORICAL_CLAIM_ERROR = {
  statusCode: 403,
  code: "HISTORICAL_ROLE_CLAIM_INVITE_REQUIRED",
  message: "Historical sessions require a historical role-claim invitation"
};

const HISTORICAL_PREBIND_ERROR = {
  statusCode: 400,
  code: "HISTORICAL_MEMBER_PREBIND_FORBIDDEN",
  message: "Historical members must claim a role through a historical invitation"
};

async function withMockMysqlConnection(connection, work) {
  const originalCreateConnection = mysql.createConnection;
  mysql.createConnection = async () => connection;
  try {
    return await work();
  } finally {
    mysql.createConnection = originalCreateConnection;
  }
}

function recruitmentGuardConnection(queryResult) {
  const state = { mutations: [], queries: [] };
  return {
    state,
    async query(sql, values = []) {
      const normalized = compactSql(sql);
      state.queries.push({ sql: normalized, values });
      if (normalized === "SET time_zone = '+00:00'") return [{ affectedRows: 0 }];
      if (/^(INSERT|UPDATE|DELETE) /i.test(normalized)) {
        state.mutations.push({ sql: normalized, values });
      }
      return queryResult(normalized, values);
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async end() {}
  };
}

function historicalRoleManagementConnection(options = {}) {
  const session = {
    id: 101,
    organizer_user_id: ACTOR.user.id,
    session_purpose: "historical_record",
    status: "locked",
    visibility: "share_only",
    join_policy: "review_required",
    join_phone_required: 0,
    npc_join_enabled: 0,
    dm_user_id: 8,
    npc_user_id: 9,
    ...(options.session || {})
  };
  const role = {
    id: 31,
    session_id: session.id,
    organizer_user_id: session.organizer_user_id,
    session_purpose: session.session_purpose,
    name: "NPC",
    status: "active",
    bound_user_id: 8,
    ...(options.role || {})
  };
  role.organizer_user_id = session.organizer_user_id;
  role.session_purpose = session.session_purpose;
  const state = { events: [], mutations: [], session, role };
  return {
    state,
    async query(sql, values = []) {
      const normalized = compactSql(sql);
      state.events.push(normalized);
      if (normalized === "SET time_zone = '+00:00'") return [{ affectedRows: 0 }];
      if (/^(INSERT|UPDATE|DELETE) /i.test(normalized)) {
        state.mutations.push({ sql: normalized, values });
      }
      if (normalized === "SELECT session_id FROM session_npc_roles WHERE id = ?") {
        return [[{ session_id: role.session_id }]];
      }
      if (
        normalized ===
        "SELECT * FROM session_npc_roles WHERE id = ? AND session_id = ? FOR UPDATE"
      ) {
        return [[role]];
      }
      if (normalized === "SELECT * FROM sessions WHERE id = ?") return [[session]];
      if (normalized.includes("SELECT role.*, session.organizer_user_id")) return [[role]];
      if (normalized.startsWith("INSERT INTO session_npc_roles")) {
        role.bound_user_id = values[6];
        return [{ insertId: role.id }];
      }
      if (
        normalized.includes("FROM session_npc_roles role") &&
        normalized.includes("WHERE role.session_id = ?")
      ) {
        return [[role]];
      }
      if (normalized.startsWith("UPDATE session_npc_roles SET")) {
        role.bound_user_id = values[0];
        return [{ affectedRows: 1 }];
      }
      if (normalized === "SELECT * FROM session_npc_roles WHERE id = ?") return [[role]];
      if (
        normalized.includes("FROM session_npc_roles role") &&
        normalized.includes("WHERE role.id = ?")
      ) {
        return [[role]];
      }
      if (normalized.startsWith("UPDATE sessions SET")) {
        if (normalized.includes("status = ?")) session.status = values[0];
        return [{ affectedRows: 1 }];
      }
      if (normalized === "SELECT * FROM sessions WHERE id = ? FOR UPDATE") return [[session]];
      throw new Error(`Unexpected query: ${normalized}`);
    },
    async beginTransaction() {
      state.events.push("BEGIN");
    },
    async commit() {
      state.events.push("COMMIT");
    },
    async rollback() {
      state.events.push("ROLLBACK");
    },
    async end() {
      state.events.push("END");
    }
  };
}

function transferredOwnerConnection() {
  const staleSession = {
    id: 101,
    organizer_user_id: ACTOR.user.id,
    session_purpose: "future_carpool",
    status: "recruiting",
    visibility: "public",
    join_policy: "direct",
    join_phone_required: 1,
    npc_join_enabled: 1,
    note: "stale"
  };
  const lockedSession = {
    ...staleSession,
    organizer_user_id: 88,
    session_purpose: "historical_record",
    status: "locked",
    visibility: "share_only",
    join_policy: "review_required",
    join_phone_required: 0,
    npc_join_enabled: 0,
    note: "current"
  };
  const role = {
    id: 31,
    session_id: 101,
    organizer_user_id: ACTOR.user.id,
    session_purpose: "future_carpool",
    name: "NPC",
    status: "active",
    bound_user_id: null
  };
  const signup = {
    id: 41,
    session_id: 101,
    organizer_user_id: ACTOR.user.id,
    session_purpose: "future_carpool",
    status: "rejected",
    signup_type: "seat",
    seat_id: 11,
    user_id: 12
  };
  const state = { lifecycle: [], lockedRead: false, mutations: [], queries: [] };
  return {
    state,
    async query(sql, values = []) {
      const normalized = compactSql(sql);
      state.queries.push({ sql: normalized, values });
      if (normalized === "SET time_zone = '+00:00'") return [{ affectedRows: 0 }];
      if (/^(INSERT|UPDATE|DELETE) /i.test(normalized)) {
        state.mutations.push({ sql: normalized, values });
      }
      if (normalized === "SELECT * FROM sessions WHERE id = ? FOR UPDATE") {
        state.lockedRead = true;
        return [[lockedSession]];
      }
      if (normalized === "SELECT * FROM sessions WHERE id = ?") {
        return [[state.lockedRead ? lockedSession : staleSession]];
      }
      if (normalized === "SELECT session_id FROM session_npc_roles WHERE id = ?") {
        return [[{ session_id: role.session_id }]];
      }
      if (normalized.includes("SELECT role.*, session.organizer_user_id")) return [[role]];
      if (
        normalized ===
        "SELECT * FROM session_npc_roles WHERE id = ? AND session_id = ? FOR UPDATE"
      ) {
        return [[role]];
      }
      if (normalized === "SELECT session_id FROM signups WHERE id = ?") {
        return [[{ session_id: signup.session_id }]];
      }
      if (normalized.includes("SELECT signup.*, session.organizer_user_id")) return [[signup]];
      if (normalized === "SELECT * FROM signups WHERE id = ? AND session_id = ? FOR UPDATE") {
        return [[signup]];
      }
      if (normalized.startsWith("INSERT INTO session_npc_roles")) return [{ insertId: role.id }];
      if (
        normalized.includes("FROM session_npc_roles role") &&
        normalized.includes("WHERE role.session_id = ?")
      ) {
        return [[role]];
      }
      if (normalized.startsWith("UPDATE session_npc_roles SET")) return [{ affectedRows: 1 }];
      if (normalized === "SELECT * FROM session_npc_roles WHERE id = ?") return [[role]];
      if (
        normalized.includes("FROM session_npc_roles role") &&
        normalized.includes("WHERE role.id = ?")
      ) {
        return [[role]];
      }
      if (normalized.startsWith("UPDATE sessions SET")) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected query: ${normalized}`);
    },
    async beginTransaction() {
      state.lifecycle.push("BEGIN");
    },
    async commit() {
      state.lifecycle.push("COMMIT");
    },
    async rollback() {
      state.lifecycle.push("ROLLBACK");
    },
    async end() {
      state.lifecycle.push("END");
    }
  };
}

function insertColumns(sql) {
  const match = compactSql(sql).match(/INSERT INTO sessions \((.*?)\) VALUES/i);
  assert.ok(match, "session INSERT columns");
  return match[1].split(",").map((column) => column.trim());
}

function sessionInsertValues(insert) {
  return Object.fromEntries(insertColumns(insert.sql).map((column, index) => [
    column,
    insert.values[index]
  ]));
}

function createConnection() {
  const state = {
    sessionInsert: null,
    sessionNpcRoleInserts: [],
    nextInsertId: 100
  };

  return {
    state,
    async query(sql, values = []) {
      const normalized = compactSql(sql);

      if (normalized === "SELECT * FROM stores WHERE id = ?") {
        return [[{ id: 3, name: "测试门店", visibility: "public", review_status: "approved", status: "active" }]];
      }
      if (normalized === "SELECT * FROM scripts WHERE id = ?") {
        return [[{ id: 4, name: "测试剧本", visibility: "public", review_status: "approved", status: "active" }]];
      }
      if (normalized.startsWith("INSERT INTO user_roles")) {
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("INSERT INTO sessions")) {
        state.sessionInsert = { sql, values };
        return [{ insertId: 101 }];
      }
      if (normalized === "SELECT * FROM sessions WHERE id = ?") {
        const persisted = state.sessionInsert ? sessionInsertValues(state.sessionInsert) : {};
        return [[{
          id: 101,
          organizer_user_id: persisted.organizer_user_id,
          script_id: persisted.script_id,
          script_name_snapshot: persisted.script_name_snapshot,
          store_id: persisted.store_id,
          store_name_snapshot: persisted.store_name_snapshot,
          start_at: persisted.start_at,
          session_purpose: persisted.session_purpose
        }]];
      }
      if (normalized.startsWith("SELECT * FROM script_npc_roles")) {
        return [[]];
      }
      if (normalized.startsWith("INSERT INTO session_npc_roles")) {
        state.sessionNpcRoleInserts.push({ sql, values });
        return [{ insertId: state.nextInsertId++ }];
      }
      if (normalized === "SELECT * FROM session_chat_rooms WHERE session_id = ? LIMIT 1") {
        return [[]];
      }
      if (normalized.startsWith("INSERT INTO session_chat_rooms")) {
        return [{ insertId: 201 }];
      }
      if (normalized.startsWith("INSERT INTO session_messages")) {
        return [{ insertId: 301 }];
      }
      if (normalized.startsWith("UPDATE session_chat_rooms")) {
        return [{ affectedRows: 1 }];
      }
      if (normalized.includes("FROM session_messages message")) {
        return [[]];
      }

      throw new Error(`Unexpected query: ${normalized}`);
    }
  };
}

function createPublishConnection({
  session = {},
  sessionExists = true,
  seats = [],
  seatUpdateAffectedRows = 1
} = {}) {
  const currentSession = {
    id: 101,
    organizer_user_id: ACTOR.user.id,
    status: "draft",
    session_purpose: "historical_record",
    visibility: "share_only",
    join_policy: "review_required",
    join_phone_required: 0,
    npc_join_enabled: 0,
    ...session
  };
  const currentSeats = seats.map((seat) => ({
    session_id: currentSession.id,
    adjustment: 0,
    payable_price: 100,
    status: "open",
    confirmed_user_id: null,
    ...seat
  }));
  const state = {
    queries: [],
    mutations: [],
    session: currentSession,
    seats: currentSeats
  };

  return {
    state,
    async query(sql, values = []) {
      const normalized = compactSql(sql);
      state.queries.push({ sql: normalized, values });
      if (/^(INSERT|UPDATE|DELETE) /i.test(normalized)) {
        state.mutations.push({ sql: normalized, values });
      }

      if (normalized === "SELECT * FROM sessions WHERE id = ? FOR UPDATE") {
        return [sessionExists ? [currentSession] : []];
      }
      if (
        normalized ===
        "SELECT * FROM session_seats WHERE session_id = ? ORDER BY id FOR UPDATE"
      ) {
        return [[...currentSeats].sort((left, right) => Number(left.id) - Number(right.id))];
      }
      if (
        normalized ===
          "SELECT * FROM session_npc_roles WHERE session_id = ? ORDER BY id FOR UPDATE" ||
        normalized ===
          "SELECT * FROM signups WHERE session_id = ? ORDER BY id FOR UPDATE"
      ) {
        return [[]];
      }
      if (
        normalized ===
        "UPDATE session_seats SET status = 'confirmed', confirmed_user_id = ? WHERE id = ? AND session_id = ? AND status = 'open' AND confirmed_user_id IS NULL"
      ) {
        if (seatUpdateAffectedRows === 1) {
          const target = currentSeats.find((seat) =>
            Number(seat.id) === Number(values[1]) &&
            Number(seat.session_id) === Number(values[2]) &&
            seat.status === "open" &&
            seat.confirmed_user_id === null
          );
          if (target) {
            target.status = "confirmed";
            target.confirmed_user_id = values[0];
          }
        }
        return [{ affectedRows: seatUpdateAffectedRows }];
      }
      if (
        normalized ===
        "INSERT INTO signups (session_id, seat_id, session_npc_role_id, signup_type, user_id, note, status, review_eligible_at) VALUES (?, ?, NULL, 'seat', ?, '车头创建历史补录时选择角色', 'approved', CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE status = 'approved', review_eligible_at = COALESCE(review_eligible_at, CURRENT_TIMESTAMP), user_hidden_at = NULL"
      ) {
        return [{ affectedRows: 1 }];
      }
      if (
        normalized ===
        "UPDATE sessions SET status = 'locked', visibility = 'share_only', join_policy = 'review_required', join_phone_required = 0, npc_join_enabled = 0 WHERE id = ?"
      ) {
        Object.assign(currentSession, {
          status: "locked",
          visibility: "share_only",
          join_policy: "review_required",
          join_phone_required: 0,
          npc_join_enabled: 0
        });
        return [{ affectedRows: 1 }];
      }
      if (normalized === "UPDATE sessions SET status = 'recruiting' WHERE id = ?") {
        currentSession.status = "recruiting";
        return [{ affectedRows: 1 }];
      }
      if (normalized === "SELECT * FROM sessions WHERE id = ?") {
        return [[currentSession]];
      }

      throw new Error(`Unexpected query: ${normalized}`);
    }
  };
}

function baseBody(overrides = {}) {
  return {
    storeId: 3,
    scriptId: 4,
    startAt: "2020-01-01 13:00:00",
    sessionPurpose: "historical_record",
    ...overrides
  };
}

function applyApprovedSessionProposal(connection, body, idempotencyKey) {
  const targetSubjectId = textCreationTargetSubjectId({
    action: "create_session",
    actorUserId: ACTOR.user.id
  });
  const unused = async () => null;
  const handlers = createProductionTextProposalHandlers({
    currentActorTextSnapshot: unused,
    currentSessionCreateTextBase: async () => expectedTextCreationBase(ACTOR.user.id),
    currentSessionTextBase: unused,
    currentNpcRoleTextBase: unused,
    currentReviewTextBase: unused,
    currentMessageTextBase: unused,
    currentPinnedTextBase: unused,
    updateUserProfileWithConnection: unused,
    createPrivateStoreWithConnection: unused,
    createPrivateScriptWithConnection: unused,
    createSessionWithConnection,
    updateSessionWithConnection: unused,
    createSessionNpcRoleWithConnection: unused,
    updateSessionNpcRoleWithConnection: unused,
    upsertMySessionReviewWithConnection: unused,
    createSessionMessageWithConnection: unused,
    updateSessionPinnedMessageWithConnection: unused
  });
  const applicator = createTextProposalApplicator({
    loadActor: async () => ACTOR,
    handlers
  });
  const proposal = {
    action: "create_session",
    created_by_user_id: ACTOR.user.id,
    target_subject_id: targetSubjectId,
    base_version: expectedTextCreationBase(ACTOR.user.id),
    idempotency_key: idempotencyKey,
    normalized_payload_json: JSON.stringify({
      body,
      context: { targetSubjectId }
    })
  };
  return applicator.apply(connection, {
    job: {
      subject_id: textOperationSubjectId({
        action: proposal.action,
        actorUserId: ACTOR.user.id,
        idempotencyKey: proposal.idempotency_key
      })
    },
    proposal
  });
}

test("historical creation binds normalized purpose and time with share-only reviewed joining", async () => {
  const connection = createConnection();

  await createSessionWithConnection(connection, ACTOR, baseBody({
    visibility: "public",
    joinPolicy: "direct",
    joinPhoneRequired: true,
    npcJoinEnabled: true
  }));

  const values = sessionInsertValues(connection.state.sessionInsert);
  assert.equal(values.session_purpose, "historical_record");
  assert.deepEqual(values.start_at, new Date("2020-01-01T05:00:00.000Z"));
  assert.equal(values.visibility, "share_only");
  assert.equal(values.join_policy, "review_required");
  assert.equal(values.join_phone_required, 0);
  assert.equal(values.npc_join_enabled, 0);
});

test("future creation retains requested public visibility and recruitment settings", async () => {
  const connection = createConnection();

  await createSessionWithConnection(connection, ACTOR, baseBody({
    startAt: "2099-01-01 13:00:00",
    sessionPurpose: "future_carpool",
    visibility: "public",
    joinPolicy: "direct",
    joinPhoneRequired: true,
    npcJoinEnabled: true
  }));

  const values = sessionInsertValues(connection.state.sessionInsert);
  assert.equal(values.session_purpose, "future_carpool");
  assert.deepEqual(values.start_at, new Date("2099-01-01T05:00:00.000Z"));
  assert.equal(values.visibility, "public");
  assert.equal(values.join_policy, "direct");
  assert.equal(values.join_phone_required, 1);
  assert.equal(values.npc_join_enabled, 1);
});

test("publish validation failures stop at the expected lock boundary without mutation", async (t) => {
  const sessionLock = "SELECT * FROM sessions WHERE id = ? FOR UPDATE";
  const seatsLock =
    "SELECT * FROM session_seats WHERE session_id = ? ORDER BY id FOR UPDATE";
  const cases = [
    {
      name: "missing session",
      connection: { sessionExists: false },
      statusCode: 404,
      queries: [sessionLock]
    },
    {
      name: "unauthorized non-admin actor",
      connection: { session: { organizer_user_id: 8 }, seats: [{ id: 11 }] },
      statusCode: 403,
      queries: [sessionLock]
    },
    {
      name: "zero seats",
      connection: { seats: [] },
      statusCode: 400,
      queries: [sessionLock, seatsLock]
    },
    {
      name: "nonzero adjustment total",
      connection: { seats: [{ id: 11, adjustment: 1 }] },
      statusCode: 400,
      queries: [sessionLock, seatsLock]
    },
    {
      name: "negative payable price",
      connection: { seats: [{ id: 11, payable_price: -1 }] },
      statusCode: 400,
      queries: [sessionLock, seatsLock]
    }
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const connection = createPublishConnection(entry.connection);

      await assert.rejects(
        () => publishSessionWithConnection(connection, ACTOR, 101, { creatorSeatId: 11 }),
        { statusCode: entry.statusCode }
      );

      assert.deepEqual(
        connection.state.queries.map((query) => query.sql),
        entry.queries
      );
      assert.deepEqual(connection.state.mutations, []);
    });
  }
});

test("historical publish requires creatorSeatId before any mutation", async () => {
  const connection = createPublishConnection({ seats: [{ id: 11 }] });

  await assert.rejects(
    () => publishSessionWithConnection(connection, ACTOR, 101),
    { statusCode: 400 }
  );

  assert.deepEqual(
    connection.state.queries.slice(0, 2).map((query) => query.sql),
    [
      "SELECT * FROM sessions WHERE id = ? FOR UPDATE",
      "SELECT * FROM session_seats WHERE session_id = ? ORDER BY id FOR UPDATE"
    ]
  );
  assert.deepEqual(connection.state.mutations, []);
});

test("historical publish rejects creatorSeatId outside the locked session seats", async () => {
  const connection = createPublishConnection({ seats: [{ id: 11 }, { id: 12 }] });

  await assert.rejects(
    () => publishSessionWithConnection(connection, ACTOR, 101, { creatorSeatId: 99 }),
    { statusCode: 400 }
  );

  assert.deepEqual(connection.state.mutations, []);
});

test("historical publish rejects an occupied or non-open creator seat before mutation", async (t) => {
  const cases = [
    ["occupied", { id: 11, confirmed_user_id: 8 }],
    ["non-open", { id: 11, status: "applied" }]
  ];

  for (const [name, seat] of cases) {
    await t.test(name, async () => {
      const connection = createPublishConnection({ seats: [seat] });

      await assert.rejects(
        () => publishSessionWithConnection(connection, ACTOR, 101, { creatorSeatId: 11 }),
        { statusCode: 409 }
      );

      assert.deepEqual(connection.state.mutations, []);
    });
  }
});

test("historical publish stops after a lost creator-seat update race", async () => {
  const connection = createPublishConnection({
    seats: [{ id: 11 }],
    seatUpdateAffectedRows: 0
  });

  await assert.rejects(
    () => publishSessionWithConnection(connection, ACTOR, 101, { creatorSeatId: 11 }),
    { statusCode: 409 }
  );

  assert.equal(connection.state.mutations.length, 1);
  assert.equal(
    connection.state.mutations[0].sql,
    "UPDATE session_seats SET status = 'confirmed', confirmed_user_id = ? WHERE id = ? AND session_id = ? AND status = 'open' AND confirmed_user_id IS NULL"
  );
  assert.deepEqual(connection.state.mutations[0].values, [ACTOR.user.id, 11, 101]);
});

test("historical publish atomically binds organizer signup and locks safe settings", async () => {
  const connection = createPublishConnection({
    seats: [{ id: 12, adjustment: -20 }, { id: 11, adjustment: 20 }]
  });

  const session = await publishSessionWithConnection(connection, ACTOR, 101, {
    creatorSeatId: 11
  });

  assert.deepEqual(
    connection.state.queries.slice(0, 2).map((query) => query.sql),
    [
      "SELECT * FROM sessions WHERE id = ? FOR UPDATE",
      "SELECT * FROM session_seats WHERE session_id = ? ORDER BY id FOR UPDATE"
    ]
  );
  assert.deepEqual(
    connection.state.mutations,
    [
      {
        sql: "UPDATE session_seats SET status = 'confirmed', confirmed_user_id = ? WHERE id = ? AND session_id = ? AND status = 'open' AND confirmed_user_id IS NULL",
        values: [ACTOR.user.id, 11, 101]
      },
      {
        sql: "INSERT INTO signups (session_id, seat_id, session_npc_role_id, signup_type, user_id, note, status, review_eligible_at) VALUES (?, ?, NULL, 'seat', ?, '车头创建历史补录时选择角色', 'approved', CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE status = 'approved', review_eligible_at = COALESCE(review_eligible_at, CURRENT_TIMESTAMP), user_hidden_at = NULL",
        values: [101, 11, ACTOR.user.id]
      },
      {
        sql: "UPDATE sessions SET status = 'locked', visibility = 'share_only', join_policy = 'review_required', join_phone_required = 0, npc_join_enabled = 0 WHERE id = ?",
        values: [101]
      }
    ]
  );
  assert.equal(connection.state.seats[1].status, "confirmed");
  assert.equal(connection.state.seats[1].confirmed_user_id, ACTOR.user.id);
  assert.equal(session.status, "locked");
  assert.equal(session.visibility, "share_only");
  assert.equal(session.join_policy, "review_required");
  assert.equal(session.join_phone_required, 0);
  assert.equal(session.npc_join_enabled, 0);
});

test("admin historical publish binds the locked session organizer instead of the admin", async () => {
  const organizerUserId = 7;
  const connection = createPublishConnection({
    session: { organizer_user_id: organizerUserId },
    seats: [{ id: 11 }]
  });

  await publishSessionWithConnection(connection, ADMIN, 101, { creatorSeatId: 11 });

  assert.deepEqual(connection.state.mutations[0].values, [organizerUserId, 11, 101]);
  assert.deepEqual(connection.state.mutations[1].values, [101, 11, organizerUserId]);
  assert.equal(connection.state.seats[0].confirmed_user_id, organizerUserId);
});

test("future publish retains recruiting behavior without creatorSeatId", async () => {
  const connection = createPublishConnection({
    session: { session_purpose: "future_carpool" },
    seats: [{ id: 11 }]
  });

  const session = await publishSessionWithConnection(connection, ACTOR, 101);

  assert.equal(session.status, "recruiting");
  assert.deepEqual(connection.state.mutations, [{
    sql: "UPDATE sessions SET status = 'recruiting' WHERE id = ?",
    values: [101]
  }]);
});

test("future publish rejects creatorSeatId before mutation", async () => {
  const connection = createPublishConnection({
    session: { session_purpose: "future_carpool" },
    seats: [{ id: 11 }]
  });

  await assert.rejects(
    () => publishSessionWithConnection(connection, ACTOR, 101, { creatorSeatId: 11 }),
    { statusCode: 400 }
  );

  assert.deepEqual(connection.state.mutations, []);
});

test("published session cannot be published twice", async () => {
  const connection = createPublishConnection({
    session: { session_purpose: "future_carpool" },
    seats: [{ id: 11 }]
  });

  await publishSessionWithConnection(connection, ACTOR, 101);
  await assert.rejects(
    () => publishSessionWithConnection(connection, ACTOR, 101),
    { statusCode: 409 }
  );

  assert.equal(connection.state.mutations.length, 1);
  assert.equal(
    connection.state.queries.at(-1).sql,
    "SELECT * FROM sessions WHERE id = ? FOR UPDATE"
  );
});

test("historical creation rejects every direct-member and pre-bound NPC alias before session INSERT", async (t) => {
  const cases = [
    ["dmUserId", { dmUserId: 8 }],
    ["dm_user_id", { dm_user_id: 8 }],
    ["npcUserId", { npcUserId: 8 }],
    ["npc_user_id", { npc_user_id: 8 }],
    ["extra boundUserId", { extraNpcRoles: [{ name: "NPC", boundUserId: 8 }] }],
    ["extra bound_user_id", { extraNpcRoles: [{ name: "NPC", bound_user_id: 8 }] }],
    ["extra userId", { extra_npc_roles: [{ name: "NPC", userId: 8 }] }],
    ["extra user_id", { extra_npc_roles: [{ name: "NPC", user_id: 8 }] }]
  ];

  for (const [name, overrides] of cases) {
    await t.test(name, async () => {
      const connection = createConnection();
      await assert.rejects(
        () => createSessionWithConnection(connection, ACTOR, baseBody(overrides)),
        {
          statusCode: 400,
          code: "HISTORICAL_MEMBER_PREBIND_FORBIDDEN",
          message: "Historical members must claim a role through a historical invitation"
        }
      );
      assert.equal(connection.state.sessionInsert, null);
    });
  }
});

test("historical creation accepts an unbound extra NPC role", async () => {
  const connection = createConnection();

  await createSessionWithConnection(connection, ACTOR, baseBody({
    extra_npc_roles: [{ name: "待认领 NPC", bound_user_id: null }]
  }));

  assert.ok(connection.state.sessionInsert);
  assert.equal(connection.state.sessionNpcRoleInserts.length, 1);
  assert.equal(connection.state.sessionNpcRoleInserts[0].values[6], null);
});

test("historical moderation rejects raw member aliases before NPC normalization", () => {
  const cases = [
    ["dm_user_id direct", { dm_user_id: 8 }],
    ["npc_user_id direct", { npc_user_id: 8 }],
    ["boundUserId empty", { extraNpcRoles: [{ name: "NPC", boundUserId: "" }] }],
    ["bound_user_id", { extra_npc_roles: [{ name: "NPC", bound_user_id: 8 }] }],
    ["userId", { extraNpcRoles: [{ name: "NPC", userId: 8 }] }],
    ["user_id", { extra_npc_roles: [{ name: "NPC", user_id: 8 }] }],
    ["nameless", { extraNpcRoles: [{ user_id: 8 }] }],
    ["conflicting", { extraNpcRoles: [{ name: "NPC", boundUserId: "", user_id: 8 }] }]
  ];

  for (const [name, overrides] of cases) {
    assert.throws(
      () => buildTextModerationDescriptor({
        action: "create_session",
        actorUserId: ACTOR.user.id,
        openid: "openid-7",
        subjectId: "creation:create_session:7",
        baseVersion: "v1",
        idempotencyKey: `historical-raw-alias-${name}`,
        body: baseBody({
          note: "这是一条需要审核的历史记录说明",
          ...overrides
        })
      }),
      {
        statusCode: 400,
        code: "HISTORICAL_MEMBER_PREBIND_FORBIDDEN",
        message: "Historical members must claim a role through a historical invitation"
      },
      name
    );
  }
});

test("moderation accepts future prebinding and null historical role aliases", () => {
  const future = buildTextModerationDescriptor({
    action: "create_session",
    actorUserId: ACTOR.user.id,
    openid: "openid-7",
    subjectId: "creation:create_session:7",
    baseVersion: "v1",
    idempotencyKey: "future-raw-alias",
    body: baseBody({
      startAt: "2099-01-01 13:00:00",
      sessionPurpose: "future_carpool",
      note: "未来拼车说明",
      extraNpcRoles: [{ name: "NPC", user_id: 8 }]
    })
  });
  assert.equal(future.payload.body.extraNpcRoles[0].boundUserId, 8);

  const historical = buildTextModerationDescriptor({
    action: "create_session",
    actorUserId: ACTOR.user.id,
    openid: "openid-7",
    subjectId: "creation:create_session:7",
    baseVersion: "v1",
    idempotencyKey: "historical-null-aliases",
    body: baseBody({
      note: "历史记录说明",
      extra_npc_roles: [{
        name: "待认领 NPC",
        boundUserId: null,
        bound_user_id: null,
        userId: null,
        user_id: null
      }]
    })
  });
  assert.equal(historical.payload.body.extraNpcRoles[0].boundUserId, null);
});

test("approved raw proposal bypassing moderation descriptor still rejects before session INSERT", async () => {
  const connection = createConnection();

  await assert.rejects(
    () => applyApprovedSessionProposal(
      connection,
      baseBody({ extraNpcRoles: [{ user_id: 8 }] }),
      "historical-raw-approved-proposal"
    ),
    {
      statusCode: 400,
      code: "HISTORICAL_MEMBER_PREBIND_FORBIDDEN",
      message: "Historical members must claim a role through a historical invitation"
    }
  );
  assert.equal(connection.state.sessionInsert, null);
});

test("historical sessions reject every ordinary recruitment path before mutation", async (t) => {
  const cases = [
    [
      "createSignup",
      () => createSignup(ACTOR, { seatId: 11 }),
      (sql) => {
        if (sql === "SELECT session_id FROM session_seats WHERE id = ?") {
          return [[{ session_id: 101 }]];
        }
        if (
          sql ===
          "SELECT *, (start_at <= CURRENT_TIMESTAMP) AS session_started FROM sessions WHERE id = ? FOR UPDATE"
        ) {
          return [[{
            id: 101,
            session_purpose: "historical_record",
            status: "locked"
          }]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    ],
    [
      "claimSessionSeat",
      () => claimSessionSeat(ACTOR, 11),
      (sql) => {
        if (sql === "SELECT session_id FROM session_seats WHERE id = ?") {
          return [[{ session_id: 101 }]];
        }
        if (
          sql ===
          "SELECT *, (start_at <= CURRENT_TIMESTAMP) AS session_started FROM sessions WHERE id = ? FOR UPDATE"
        ) {
          return [[{
            id: 101,
            session_purpose: "historical_record",
            status: "locked"
          }]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    ],
    [
      "claimSessionNpcRole",
      () => claimSessionNpcRole(ACTOR, 31),
      (sql) => {
        if (sql === "SELECT session_id FROM session_npc_roles WHERE id = ?") {
          return [[{ session_id: 101 }]];
        }
        if (
          sql ===
          "SELECT *, (start_at <= CURRENT_TIMESTAMP) AS session_started FROM sessions WHERE id = ? FOR UPDATE"
        ) {
          return [[{
            id: 101,
            session_purpose: "historical_record",
            status: "locked"
          }]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    ],
    [
      "approveSignup",
      () => approveSignup(ACTOR, 41),
      (sql) => {
        if (sql === "SELECT session_id FROM signups WHERE id = ?") {
          return [[{ session_id: 101 }]];
        }
        if (sql === "SELECT * FROM sessions WHERE id = ? FOR UPDATE") {
          return [[{
            id: 101,
            organizer_user_id: ACTOR.user.id,
            session_purpose: "historical_record",
            status: "locked"
          }]];
        }
        if (
          sql === "SELECT * FROM session_seats WHERE session_id = ? ORDER BY id FOR UPDATE" ||
          sql === "SELECT * FROM session_npc_roles WHERE session_id = ? ORDER BY id FOR UPDATE" ||
          sql === "SELECT * FROM signups WHERE session_id = ? ORDER BY id FOR UPDATE"
        ) {
          return [[]];
        }
        if (sql === "SELECT * FROM signups WHERE id = ? AND session_id = ? FOR UPDATE") {
          return [[{
            id: 41,
            session_id: 101,
            status: "rejected"
          }]];
        }
        if (sql.includes("SELECT signup.*, session.organizer_user_id")) {
          return [[{
            id: 41,
            session_id: 101,
            session_purpose: "historical_record",
            organizer_user_id: ACTOR.user.id,
            status: "rejected"
          }]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    ],
    [
      "assertSessionJoinInviteAllowed",
      () => assertSessionJoinInviteAllowed(ACTOR, 101),
      (sql) => {
        if (sql === "SELECT * FROM sessions WHERE id = ?") {
          return [[{
            id: 101,
            organizer_user_id: ACTOR.user.id,
            session_purpose: "historical_record",
            status: "locked"
          }]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    ]
  ];

  for (const [name, invoke, queryResult] of cases) {
    await t.test(name, async () => {
      const connection = recruitmentGuardConnection(queryResult);
      await withMockMysqlConnection(connection, () =>
        assert.rejects(invoke, HISTORICAL_CLAIM_ERROR)
      );
      assert.deepEqual(connection.state.mutations, []);
    });
  }
});

test("locked session ownership rejects stale organizers before Task 5 mutations", async (t) => {
  const cases = [
    [
      "generic PATCH",
      (connection) => updateSessionWithConnection(connection, ACTOR, 101, { note: "stale write" }),
      "Only the session organizer can perform this action"
    ],
    [
      "NPC create",
      (connection) => createSessionNpcRoleWithConnection(
        connection,
        ACTOR,
        101,
        { name: "stale role" }
      ),
      "Only the session organizer can perform this action"
    ],
    [
      "NPC update",
      (connection) => updateSessionNpcRoleWithConnection(
        connection,
        ACTOR,
        31,
        { name: "stale role" }
      ),
      "Only the session organizer can manage NPC roles"
    ],
    [
      "signup approval",
      (connection) => withMockMysqlConnection(connection, () => approveSignup(ACTOR, 41)),
      "Only the session organizer can perform this action"
    ]
  ];

  for (const [name, invoke, message] of cases) {
    await t.test(name, async () => {
      const connection = transferredOwnerConnection();
      await assert.rejects(
        () => invoke(connection),
        { statusCode: 403, code: "FORBIDDEN", message }
      );
      assert.deepEqual(connection.state.mutations, []);
    });
  }
});

test("generic PATCH lifecycle uses the locked current status instead of a stale pre-read", async () => {
  const connection = transferredOwnerConnection();

  const session = await updateSessionWithConnection(connection, ADMIN, 101, {
    status: "locked"
  });

  assert.equal(session.status, "locked");
  assert.equal(session.note, "current");
  assert.deepEqual(connection.state.mutations, []);
  assert.equal(
    connection.state.queries[0].sql,
    "SELECT * FROM sessions WHERE id = ? FOR UPDATE"
  );
});

test("child-id mutation paths lock session before re-locking the child", async (t) => {
  await t.test("NPC update", async () => {
    const connection = historicalRoleManagementConnection();
    await assert.rejects(
      () => updateSessionNpcRoleWithConnection(connection, ACTOR, 31, { boundUserId: 12 }),
      HISTORICAL_PREBIND_ERROR
    );

    const sessionLock = connection.state.events.indexOf(
      "SELECT * FROM sessions WHERE id = ? FOR UPDATE"
    );
    const childLock = connection.state.events.indexOf(
      "SELECT * FROM session_npc_roles WHERE id = ? AND session_id = ? FOR UPDATE"
    );
    assert.ok(sessionLock >= 0);
    assert.ok(childLock > sessionLock);
    assert.deepEqual(connection.state.mutations, []);
  });

  await t.test("signup approval", async () => {
    const signup = {
      id: 41,
      session_id: 101,
      organizer_user_id: ACTOR.user.id,
      session_purpose: "historical_record",
      status: "rejected"
    };
    const connection = recruitmentGuardConnection((sql) => {
      if (sql === "SELECT session_id FROM signups WHERE id = ?") {
        return [[{ session_id: signup.session_id }]];
      }
      if (sql === "SELECT * FROM sessions WHERE id = ? FOR UPDATE") {
        return [[{
          id: 101,
          organizer_user_id: ACTOR.user.id,
          session_purpose: "historical_record",
          status: "locked"
        }]];
      }
      if (
        sql === "SELECT * FROM session_seats WHERE session_id = ? ORDER BY id FOR UPDATE" ||
        sql === "SELECT * FROM session_npc_roles WHERE session_id = ? ORDER BY id FOR UPDATE" ||
        sql === "SELECT * FROM signups WHERE session_id = ? ORDER BY id FOR UPDATE"
      ) {
        return [[]];
      }
      if (sql === "SELECT * FROM signups WHERE id = ? AND session_id = ? FOR UPDATE") {
        return [[signup]];
      }
      if (sql.includes("SELECT signup.*, session.organizer_user_id")) return [[signup]];
      throw new Error(`Unexpected query: ${sql}`);
    });
    await withMockMysqlConnection(connection, () =>
      assert.rejects(() => approveSignup(ACTOR, 41), HISTORICAL_CLAIM_ERROR)
    );

    const sessionLock = connection.state.queries.findIndex(
      ({ sql }) => sql === "SELECT * FROM sessions WHERE id = ? FOR UPDATE"
    );
    const childLock = connection.state.queries.findIndex(
      ({ sql }) => sql === "SELECT * FROM signups WHERE id = ? AND session_id = ? FOR UPDATE"
    );
    assert.ok(sessionLock >= 0);
    assert.equal(childLock, -1, "historical purpose guard must run before target signup locking");
    assert.deepEqual(
      connection.state.queries
        .map(({ sql }) => sql)
        .filter((sql) => /FOR UPDATE/.test(sql))
        .slice(0, 4),
      [
        "SELECT * FROM sessions WHERE id = ? FOR UPDATE",
        "SELECT * FROM session_seats WHERE session_id = ? ORDER BY id FOR UPDATE",
        "SELECT * FROM session_npc_roles WHERE session_id = ? ORDER BY id FOR UPDATE",
        "SELECT * FROM signups WHERE session_id = ? ORDER BY id FOR UPDATE"
      ]
    );
    assert.deepEqual(connection.state.mutations, []);
  });
});

test("public Task 5 mutation wrappers open transactions around their row locks", async (t) => {
  await t.test("generic PATCH", async () => {
    const connection = historicalRoleManagementConnection({
      session: { session_purpose: "future_carpool", status: "recruiting" }
    });
    await withMockMysqlConnection(connection, () =>
      updateSession(ACTOR, 101, { note: "transactional" })
    );
    assert.ok(connection.state.events.indexOf("BEGIN") >= 0);
    assert.ok(
      connection.state.events.indexOf("SELECT * FROM sessions WHERE id = ? FOR UPDATE") >
      connection.state.events.indexOf("BEGIN")
    );
    assert.ok(connection.state.events.indexOf("COMMIT") > connection.state.events.indexOf("BEGIN"));
  });

  await t.test("NPC update", async () => {
    const connection = historicalRoleManagementConnection({
      session: { session_purpose: "future_carpool", status: "recruiting" }
    });
    await withMockMysqlConnection(connection, () =>
      updateSessionNpcRole(ACTOR, 31, { name: "transactional NPC" })
    );
    assert.ok(connection.state.events.indexOf("BEGIN") >= 0);
    assert.ok(
      connection.state.events.indexOf("SELECT * FROM sessions WHERE id = ? FOR UPDATE") >
      connection.state.events.indexOf("BEGIN")
    );
    assert.ok(connection.state.events.indexOf("COMMIT") > connection.state.events.indexOf("BEGIN"));
  });
});

test("future NPC binding normalization preserves legacy alias precedence", async (t) => {
  const cases = [
    ["preferred empty unbinds", { boundUserId: "", user_id: 12 }, null],
    ["preferred null falls through", { boundUserId: null, user_id: 12 }, 12]
  ];

  for (const [name, body, expected] of cases) {
    await t.test(`create: ${name}`, async () => {
      const connection = historicalRoleManagementConnection({
        session: { session_purpose: "future_carpool", status: "recruiting" }
      });
      await createSessionNpcRoleWithConnection(connection, ACTOR, 101, {
        name: "NPC",
        ...body
      });
      assert.equal(connection.state.mutations[0].values[6], expected);
    });

    await t.test(`update: ${name}`, async () => {
      const connection = historicalRoleManagementConnection({
        session: { session_purpose: "future_carpool", status: "recruiting" }
      });
      await updateSessionNpcRoleWithConnection(connection, ACTOR, 31, body);
      assert.equal(connection.state.mutations[0].values[0], expected);
    });
  }
});

test("historical NPC role creation rejects every non-null binding alias before mutation", async (t) => {
  const cases = [
    ...["boundUserId", "bound_user_id", "userId", "user_id"].map((field) => [field, { [field]: 12 }]),
    ["conflicting aliases", { boundUserId: "", user_id: 12 }]
  ];
  for (const [name, binding] of cases) {
    await t.test(name, async () => {
      const connection = historicalRoleManagementConnection();
      await assert.rejects(
        () => createSessionNpcRoleWithConnection(
          connection,
          ACTOR,
          101,
          { name: "NPC", ...binding }
        ),
        HISTORICAL_PREBIND_ERROR
      );
      assert.deepEqual(connection.state.mutations, []);
    });
  }
});

test("historical NPC role creation rejects raw empty, malformed, and undefined aliases", async (t) => {
  const values = [["empty", ""], ["malformed", "abc"], ["undefined", undefined]];
  for (const field of ["boundUserId", "bound_user_id", "userId", "user_id"]) {
    for (const [label, value] of values) {
      await t.test(`${field} ${label}`, async () => {
        const connection = historicalRoleManagementConnection();
        await assert.rejects(
          () => createSessionNpcRoleWithConnection(
            connection,
            ACTOR,
            101,
            { name: "NPC", [field]: value }
          ),
          HISTORICAL_PREBIND_ERROR
        );
        assert.deepEqual(connection.state.mutations, []);
      });
    }
  }
});

test("historical NPC role creation permits an explicitly unbound role", async () => {
  const connection = historicalRoleManagementConnection();

  await createSessionNpcRoleWithConnection(connection, ACTOR, 101, {
    name: "待认领 NPC",
    bound_user_id: null
  });

  assert.equal(connection.state.mutations.length, 1);
  assert.equal(connection.state.mutations[0].values[6], null);
});

test("historical NPC role update rejects every non-null binding alias before mutation", async (t) => {
  for (const field of ["boundUserId", "bound_user_id", "userId", "user_id"]) {
    await t.test(field, async () => {
      const connection = historicalRoleManagementConnection();
      await assert.rejects(
        () => updateSessionNpcRoleWithConnection(connection, ACTOR, 31, { [field]: 12 }),
        HISTORICAL_PREBIND_ERROR
      );
      assert.deepEqual(connection.state.mutations, []);
    });
  }
});

test("historical NPC role update rejects raw empty, malformed, and undefined aliases", async (t) => {
  const values = [["empty", ""], ["malformed", "abc"], ["undefined", undefined]];
  for (const field of ["boundUserId", "bound_user_id", "userId", "user_id"]) {
    for (const [label, value] of values) {
      await t.test(`${field} ${label}`, async () => {
        const connection = historicalRoleManagementConnection();
        await assert.rejects(
          () => updateSessionNpcRoleWithConnection(connection, ACTOR, 31, { [field]: value }),
          HISTORICAL_PREBIND_ERROR
        );
        assert.deepEqual(connection.state.mutations, []);
      });
    }
  }
});

test("historical NPC role update permits explicit null unbinding through every alias", async (t) => {
  for (const field of ["boundUserId", "bound_user_id", "userId", "user_id"]) {
    await t.test(field, async () => {
      const connection = historicalRoleManagementConnection();
      await updateSessionNpcRoleWithConnection(connection, ACTOR, 31, { [field]: null });
      assert.equal(connection.state.mutations.length, 1);
      assert.equal(connection.state.mutations[0].values[0], null);
    });
  }
});

test("historical generic PATCH rejects every non-null direct-member alias before mutation", async (t) => {
  for (const field of ["dmUserId", "dm_user_id", "npcUserId", "npc_user_id"]) {
    await t.test(field, async () => {
      const connection = historicalRoleManagementConnection();
      await assert.rejects(
        () => updateSessionWithConnection(connection, ACTOR, 101, { [field]: 12 }),
        HISTORICAL_PREBIND_ERROR
      );
      assert.deepEqual(connection.state.mutations, []);
    });
  }
});

test("locked historical generic PATCH cannot reset status or reopen publish", async (t) => {
  for (const status of ["draft", "recruiting"]) {
    await t.test(status, async () => {
      const connection = historicalRoleManagementConnection();
      await assert.rejects(
        () => updateSessionWithConnection(connection, ACTOR, 101, { status }),
        { statusCode: 400 }
      );
      assert.equal(connection.state.session.status, "locked");
      assert.deepEqual(connection.state.mutations, []);
      await assert.rejects(
        () => publishSessionWithConnection(connection, ACTOR, 101),
        { statusCode: 409 }
      );
      assert.deepEqual(connection.state.mutations, []);
    });
  }
});

test("historical stale snapshots select immutable purpose for NPC-role and pinned-message paths", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const paths = [
    ["async function currentNpcRoleTextBase", "async function currentReviewTextBase"],
    ["async function currentPinnedTextBase", "async function captureTextModerationBase"]
  ];

  for (const [startMarker, endMarker] of paths) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    const helper = source.slice(start, end);
    assert.match(helper, /session\.session_purpose/);
    assert.match(helper, /sessionTextSnapshot/);
  }
});

test("publish route forwards the parsed request body", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const routeStart = source.indexOf(
    "const publishSessionId = idMatch(url.pathname, /^\\/api\\/sessions\\/(\\d+)\\/publish$/);"
  );
  const routeEnd = source.indexOf("const sessionSeatSessionId", routeStart);
  const route = source.slice(routeStart, routeEnd);

  assert.match(route, /publishSession\(user, publishSessionId, body\)/);
});

test("publish wrapper delegates the connection-bound call inside withTransaction", async () => {
  const source = await readFile(
    new URL("../src/modules/core/service.js", import.meta.url),
    "utf8"
  );
  const wrapperStart = source.indexOf(
    "export async function publishSession(user, sessionId, body = {})"
  );
  const wrapperEnd = source.indexOf("async function signupNotificationPayload", wrapperStart);
  const wrapper = source.slice(wrapperStart, wrapperEnd).replace(/\s+/g, "");

  assert.equal(
    wrapper,
    "exportasyncfunctionpublishSession(user,sessionId,body={}){returnwithTransaction((connection)=>publishSessionWithConnection(connection,user,sessionId,body));}"
  );
});
