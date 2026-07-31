import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import mysql from "mysql2/promise";

import {
  approveSignup,
  assertHistoricalSessionInviteAllowed,
  assertSessionJoinInviteAllowed,
  claimHistoricalSessionRole,
  claimHistoricalSessionRoleWithConnection,
  claimSessionNpcRole,
  claimSessionSeat,
  createSessionNpcRole,
  createSessionNpcRoleWithConnection,
  createSessionWithConnection,
  createSignup,
  getSessionForViewer,
  kickSessionSeat,
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

const CLAIMANT = {
  user: {
    id: 12
  },
  roles: ["player"]
};

const HISTORICAL_INVITE_CLAIMS = {
  purpose: "historical_session_claim",
  sessionPurpose: "historical_record",
  sessionId: 101,
  inviterUserId: ACTOR.user.id,
  exp: 4_102_444_800
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
  const signups = (options.signups || [{
    id: 81,
    session_id: session.id,
    session_npc_role_id: role.id,
    signup_type: "session_npc_role",
    user_id: role.bound_user_id,
    status: "approved",
    review_eligible_at: new Date("2026-01-01T00:00:00.000Z")
  }]).map((signup) => ({ ...signup }));
  const state = { events: [], mutations: [], session, role, signups };
  let transactionSnapshot = null;
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
      if (
        normalized ===
        "SELECT * FROM signups WHERE session_id = ? ORDER BY id FOR UPDATE"
      ) {
        return [[...signups]];
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
        if (options.failRoleUpdate) {
          throw new Error("NPC_ROLE_UPDATE_FAILED");
        }
        if (normalized.includes("bound_user_id = ?")) {
          role.bound_user_id = values[0];
        }
        if (normalized.includes("status = ?")) {
          role.status = values[0];
        }
        return [{ affectedRows: 1 }];
      }
      if (
        normalized ===
        "UPDATE signups SET status = 'cancelled', review_eligible_at = NULL WHERE session_id = ? AND session_npc_role_id = ? AND user_id = ? AND status IN ('pending', 'approved')"
      ) {
        let affectedRows = 0;
        for (const signup of signups) {
          if (
            Number(signup.session_id) === Number(values[0]) &&
            Number(signup.session_npc_role_id) === Number(values[1]) &&
            Number(signup.user_id) === Number(values[2]) &&
            ["pending", "approved"].includes(signup.status)
          ) {
            signup.status = "cancelled";
            signup.review_eligible_at = null;
            affectedRows += 1;
          }
        }
        return [{ affectedRows }];
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
      transactionSnapshot = {
        role: { ...role },
        signups: signups.map((signup) => ({ ...signup }))
      };
    },
    async commit() {
      state.events.push("COMMIT");
      transactionSnapshot = null;
    },
    async rollback() {
      state.events.push("ROLLBACK");
      if (transactionSnapshot) {
        Object.assign(role, transactionSnapshot.role);
        signups.splice(
          0,
          signups.length,
          ...transactionSnapshot.signups.map((signup) => ({ ...signup }))
        );
      }
      transactionSnapshot = null;
    },
    async end() {
      state.events.push("END");
    }
  };
}

function historicalClaimConnection(options = {}) {
  const session = {
    id: 101,
    organizer_user_id: ACTOR.user.id,
    session_purpose: "historical_record",
    status: "locked",
    cancelled_by_user_id: null,
    visibility: "share_only",
    join_policy: "review_required",
    join_phone_required: 0,
    npc_join_enabled: 0,
    dm_user_id: null,
    npc_user_id: null,
    ...(options.session || {})
  };
  const seats = (options.seats || [{
    id: 11,
    session_id: session.id,
    name: "角色 A",
    status: "open",
    confirmed_user_id: null
  }]).map((seat) => ({ session_id: session.id, ...seat }));
  const npcRoles = (options.npcRoles || [{
    id: 31,
    session_id: session.id,
    name: "NPC A",
    status: "active",
    bound_user_id: null
  }]).map((role) => ({ session_id: session.id, ...role }));
  const activeSignups = (options.activeSignups || []).map((signup, index) => ({
    id: 80 + index,
    session_id: session.id,
    user_id: CLAIMANT.user.id,
    status: "approved",
    ...signup
  }));
  const state = { queries: [], mutations: [], session, seats, npcRoles, activeSignups };
  return {
    state,
    async query(sql, values = []) {
      const normalized = compactSql(sql);
      state.queries.push({ sql: normalized, values });
      if (normalized === "SET time_zone = '+00:00'") return [{ affectedRows: 0 }];
      if (/^(INSERT|UPDATE|DELETE) /i.test(normalized)) {
        state.mutations.push({ sql: normalized, values });
      }
      if (
        normalized ===
        "SELECT *, (start_at <= CURRENT_TIMESTAMP) AS session_started FROM sessions WHERE id = ? FOR UPDATE" ||
        normalized === "SELECT * FROM sessions WHERE id = ? FOR UPDATE"
      ) {
        return options.sessionExists === false ? [[]] : [[session]];
      }
      if (normalized === "SELECT * FROM session_seats WHERE session_id = ? ORDER BY id FOR UPDATE") {
        return [seats];
      }
      if (
        normalized ===
        "SELECT * FROM session_npc_roles WHERE session_id = ? ORDER BY id FOR UPDATE"
      ) {
        return [npcRoles];
      }
      if (
        normalized ===
        "SELECT * FROM signups WHERE session_id = ? AND user_id = ? AND status IN ('pending', 'approved') ORDER BY id FOR UPDATE"
      ) {
        return [activeSignups];
      }
      if (normalized.startsWith("SELECT id FROM session_member_removal_reports")) {
        return options.blockRejoin ? [[{ id: 501 }]] : [[]];
      }
      if (normalized.startsWith("UPDATE session_seats SET")) {
        const seat = seats.find((candidate) => Number(candidate.id) === Number(values[1]));
        if (seat) {
          seat.status = "confirmed";
          seat.confirmed_user_id = values[0];
        }
        return [{ affectedRows: options.targetUpdateAffectedRows ?? 1 }];
      }
      if (normalized.startsWith("UPDATE session_npc_roles SET")) {
        const role = npcRoles.find((candidate) => Number(candidate.id) === Number(values[1]));
        if (role) role.bound_user_id = values[0];
        return [{ affectedRows: options.targetUpdateAffectedRows ?? 1 }];
      }
      if (normalized.startsWith("INSERT INTO signups")) {
        return [{ insertId: 91, affectedRows: 1 }];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async end() {}
  };
}

function seatKickConnection(sessionPurpose) {
  const session = {
    id: 101,
    organizer_user_id: ACTOR.user.id,
    session_purpose: sessionPurpose,
    status: "locked",
    start_at: new Date("2020-01-01T05:00:00.000Z"),
    session_started: 1
  };
  const seat = {
    id: 11,
    session_id: session.id,
    name: "角色 A",
    status: "confirmed",
    confirmed_user_id: CLAIMANT.user.id
  };
  return recruitmentGuardConnection((sql) => {
    if (sql === "SELECT session_id FROM session_seats WHERE id = ?") {
      return [[{ session_id: session.id }]];
    }
    if (
      sql ===
      "SELECT *, (start_at <= CURRENT_TIMESTAMP) AS session_started FROM sessions WHERE id = ? FOR UPDATE"
    ) {
      return [[session]];
    }
    if (sql === "SELECT * FROM session_seats WHERE session_id = ? ORDER BY id FOR UPDATE") {
      return [[seat]];
    }
    if (
      sql === "SELECT * FROM session_npc_roles WHERE session_id = ? ORDER BY id FOR UPDATE"
    ) {
      return [[]];
    }
    if (sql === "SELECT * FROM signups WHERE session_id = ? ORDER BY id FOR UPDATE") {
      return [[{
        id: 81,
        session_id: session.id,
        seat_id: seat.id,
        signup_type: "seat",
        user_id: CLAIMANT.user.id,
        status: "approved",
        review_eligible_at: new Date("2026-01-01T00:00:00.000Z")
      }]];
    }
    if (sql === "SELECT * FROM session_seats WHERE id = ? AND session_id = ? FOR UPDATE") {
      return [[seat]];
    }
    if (sql.startsWith("UPDATE session_seats SET status = ?")) {
      seat.status = "open";
      seat.confirmed_user_id = null;
      return [{ affectedRows: 1 }];
    }
    if (/^UPDATE signups /.test(sql)) return [{ affectedRows: 1 }];
    if (sql === "SELECT * FROM session_chat_rooms WHERE session_id = ? LIMIT 1") {
      return [[{ id: 201, session_id: session.id, status: "active" }]];
    }
    if (sql.startsWith("INSERT INTO session_messages")) {
      return [{ insertId: 301, affectedRows: 1 }];
    }
    if (sql.includes("FROM session_messages message")) {
      return [[{
        id: 301,
        room_id: 201,
        session_id: session.id,
        sender_user_id: ACTOR.user.id,
        message_type: "system",
        content: "removed"
      }]];
    }
    if (sql === "SELECT * FROM session_seats WHERE id = ?") return [[seat]];
    throw new Error(`Unexpected query: ${sql}`);
  });
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
    operations: new Map(),
    sessionInsert: null,
    sessionNpcRoleInserts: [],
    nextInsertId: 100
  };

  return {
    state,
    async query(sql, values = []) {
      const normalized = compactSql(sql);

      if (
        normalized ===
        "SELECT id, nickname, avatar_url, gender, phone_verified_at FROM users WHERE id = ? LIMIT 1 FOR SHARE"
      ) {
        return [[{
          id: Number(values[0]),
          nickname: "测试用户",
          avatar_url: null,
          gender: "",
          phone_verified_at: ACTOR.user.phoneVerifiedAt
        }]];
      }
      if (
        normalized ===
        "SELECT role, status FROM user_roles WHERE user_id = ? ORDER BY role FOR UPDATE"
      ) {
        return [[{ role: "organizer", status: "active" }]];
      }
      if (
        normalized ===
        "SELECT id, name, status, visibility, review_status, created_by_user_id FROM stores WHERE id = ? LIMIT 1 FOR SHARE"
      ) {
        return [[{ id: 3, name: "测试门店", visibility: "public", review_status: "approved", status: "active" }]];
      }
      if (normalized === "SELECT * FROM stores WHERE id = ?") {
        return [[{ id: 3, name: "测试门店", visibility: "public", review_status: "approved", status: "active" }]];
      }
      if (
        normalized ===
        "SELECT id, name, status, visibility, review_status, created_by_user_id FROM scripts WHERE id = ? LIMIT 1 FOR SHARE"
      ) {
        return [[{ id: 4, name: "测试剧本", visibility: "public", review_status: "approved", status: "active" }]];
      }
      if (normalized === "SELECT * FROM scripts WHERE id = ?") {
        return [[{ id: 4, name: "测试剧本", visibility: "public", review_status: "approved", status: "active" }]];
      }
      if (normalized.startsWith("INSERT INTO user_roles")) {
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("INSERT INTO historical_session_creation_operations")) {
        const id = `${values[0]}:${Buffer.from(values[1]).toString("hex")}`;
        if (!state.operations.has(id)) {
          state.operations.set(id, {
            organizer_user_id: Number(values[0]),
            payload_hash: Buffer.from(values[2]),
            session_id: null
          });
        }
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("SELECT organizer_user_id, HEX(payload_hash)")) {
        const id = `${values[0]}:${Buffer.from(values[1]).toString("hex")}`;
        const operation = state.operations.get(id);
        return [operation ? [{
          organizer_user_id: operation.organizer_user_id,
          payload_hash_hex: operation.payload_hash.toString("hex").toUpperCase(),
          session_id: operation.session_id
        }] : []];
      }
      if (normalized.startsWith("UPDATE historical_session_creation_operations SET session_id = ?")) {
        const id = `${values[1]}:${Buffer.from(values[2]).toString("hex")}`;
        const operation = state.operations.get(id);
        if (!operation || operation.session_id !== null) return [{ affectedRows: 0 }];
        operation.session_id = Number(values[0]);
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
      if (normalized === "SELECT * FROM sessions WHERE id = ? FOR UPDATE") {
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
      if (normalized.includes("FROM script_npc_roles")) {
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

function idempotentHistoricalCreationConnection() {
  const state = {
    operations: new Map(),
    sessions: new Map(),
    events: [],
    sessionInsertCount: 0,
    sessionNpcRoleInsertCount: 0,
    userRoleInsertCount: 0,
    chatRoomInsertCount: 0,
    messageInsertCount: 0,
    nextSessionId: 101
  };

  function operationId(userId, keyHash) {
    return `${Number(userId)}:${Buffer.from(keyHash).toString("hex")}`;
  }

  return {
    state,
    async query(sql, values = []) {
      const normalized = compactSql(sql);
      if (
        normalized ===
        "SELECT id, nickname, avatar_url, gender, phone_verified_at FROM users WHERE id = ? LIMIT 1 FOR SHARE"
      ) {
        state.events.push("user_share");
        return [[{
          id: Number(values[0]),
          nickname: "测试用户",
          avatar_url: null,
          gender: "",
          phone_verified_at: ACTOR.user.phoneVerifiedAt
        }]];
      }
      if (
        normalized ===
        "SELECT role, status FROM user_roles WHERE user_id = ? ORDER BY role FOR UPDATE"
      ) {
        state.events.push("user_roles_update");
        return [[{ role: "organizer", status: "active" }]];
      }
      if (
        normalized ===
        "SELECT id, name, status, visibility, review_status, created_by_user_id FROM stores WHERE id = ? LIMIT 1 FOR SHARE"
      ) {
        state.events.push("store_share");
        return [[{ id: Number(values[0]), name: "测试门店", visibility: "public", review_status: "approved", status: "active" }]];
      }
      if (normalized === "SELECT * FROM stores WHERE id = ?") {
        return [[{ id: Number(values[0]), name: "测试门店", visibility: "public", review_status: "approved", status: "active" }]];
      }
      if (
        normalized ===
        "SELECT id, name, status, visibility, review_status, created_by_user_id FROM scripts WHERE id = ? LIMIT 1 FOR SHARE"
      ) {
        state.events.push("script_share");
        return [[{ id: Number(values[0]), name: "测试剧本", visibility: "public", review_status: "approved", status: "active" }]];
      }
      if (normalized === "SELECT * FROM scripts WHERE id = ?") {
        return [[{ id: Number(values[0]), name: "测试剧本", visibility: "public", review_status: "approved", status: "active" }]];
      }
      if (normalized.startsWith("INSERT INTO user_roles")) {
        state.userRoleInsertCount += 1;
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("INSERT INTO historical_session_creation_operations")) {
        const id = operationId(values[0], values[1]);
        if (!state.operations.has(id)) {
          state.operations.set(id, {
            organizer_user_id: Number(values[0]),
            creation_key_hash: Buffer.from(values[1]),
            payload_hash: Buffer.from(values[2]),
            session_id: null
          });
          return [{ affectedRows: 1 }];
        }
        return [{ affectedRows: 0 }];
      }
      if (
        normalized ===
        "SELECT organizer_user_id, HEX(payload_hash) AS payload_hash_hex, session_id FROM historical_session_creation_operations WHERE organizer_user_id = ? AND creation_key_hash = ? FOR UPDATE"
      ) {
        state.events.push("operation");
        const operation = state.operations.get(operationId(values[0], values[1]));
        return [operation ? [{
          organizer_user_id: operation.organizer_user_id,
          payload_hash_hex: operation.payload_hash.toString("hex").toUpperCase(),
          session_id: operation.session_id
        }] : []];
      }
      if (normalized.startsWith("UPDATE historical_session_creation_operations SET session_id = ?")) {
        const operation = state.operations.get(operationId(values[1], values[2]));
        if (!operation || operation.session_id !== null) return [{ affectedRows: 0 }];
        operation.session_id = Number(values[0]);
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("INSERT INTO sessions")) {
        const id = state.nextSessionId++;
        const insert = { sql, values };
        state.sessions.set(id, { id, ...sessionInsertValues(insert) });
        state.sessionInsertCount += 1;
        return [{ insertId: id }];
      }
      if (normalized === "SELECT * FROM sessions WHERE id = ?") {
        const session = state.sessions.get(Number(values[0]));
        return [session ? [session] : []];
      }
      if (normalized === "SELECT * FROM sessions WHERE id = ? FOR UPDATE") {
        state.events.push("session");
        const session = state.sessions.get(Number(values[0]));
        return [session ? [session] : []];
      }
      if (normalized.includes("FROM script_npc_roles")) {
        if (normalized.endsWith("FOR SHARE")) state.events.push("script_npc_roles_share");
        return [[]];
      }
      if (normalized.startsWith("INSERT INTO session_npc_roles")) {
        state.sessionNpcRoleInsertCount += 1;
        return [{ insertId: 401 + state.sessionNpcRoleInsertCount }];
      }
      if (normalized === "SELECT * FROM session_chat_rooms WHERE session_id = ? LIMIT 1") {
        return [[]];
      }
      if (normalized.startsWith("INSERT INTO session_chat_rooms")) {
        state.chatRoomInsertCount += 1;
        return [{ insertId: 201 + state.chatRoomInsertCount }];
      }
      if (normalized.startsWith("INSERT INTO session_messages")) {
        state.messageInsertCount += 1;
        return [{ insertId: 301 + state.messageInsertCount }];
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
  const body = {
    storeId: 3,
    scriptId: 4,
    startAt: "2020-01-01 13:00:00",
    sessionPurpose: "historical_record",
    ...overrides
  };
  if (
    body.sessionPurpose === "historical_record" &&
    !Object.prototype.hasOwnProperty.call(overrides, "historicalCreationKey") &&
    !Object.prototype.hasOwnProperty.call(overrides, "historicalCreationKeyHash")
  ) {
    body.historicalCreationKey =
      "hs_default0123456789abcdef0123456789abcdef0123456789";
  }
  return body;
}

function applyApprovedSessionProposal(connection, body, idempotencyKey) {
  const targetSubjectId = textCreationTargetSubjectId({
    action: "create_session",
    actorUserId: ACTOR.user.id
  });
  const unused = async () => null;
  const handlers = createProductionTextProposalHandlers({
    currentActorTextSnapshot: unused,
    currentSessionCreateTextBase: async () => {
      connection.state?.events?.push("approved_baseline");
      return expectedTextCreationBase(ACTOR.user.id);
    },
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

test("historical creation key replay returns one session without repeating creation side effects", async () => {
  const connection = idempotentHistoricalCreationConnection();
  const body = baseBody({
    historicalCreationKey: "hs_0123456789abcdef0123456789abcdef0123456789abcdef",
    pinnedMessageText: "补录说明"
  });

  const first = await createSessionWithConnection(connection, ACTOR, body);
  const replay = await createSessionWithConnection(connection, ACTOR, body);

  assert.equal(replay.id, first.id);
  assert.equal(connection.state.sessionInsertCount, 1);
  assert.equal(connection.state.chatRoomInsertCount, 1);
  assert.equal(connection.state.messageInsertCount, 1);
  assert.equal(connection.state.operations.size, 1);
});

test("historical creation locks operation then dependencies in one deadlock-safe order", async () => {
  const connection = idempotentHistoricalCreationConnection();
  await createSessionWithConnection(connection, ACTOR, baseBody({
    historicalCreationKey: "hs_0123456789abcdef0123456789abcdef0123456789abcdef"
  }));

  assert.deepEqual(connection.state.events.slice(0, 6), [
    "operation",
    "user_share",
    "user_roles_update",
    "store_share",
    "script_share",
    "script_npc_roles_share"
  ]);
  assert.equal(connection.state.userRoleInsertCount, 0);
});

test("different keys for one organizer never request a users lock upgrade", async () => {
  const connection = idempotentHistoricalCreationConnection();
  await createSessionWithConnection(connection, ACTOR, baseBody({
    historicalCreationKey: "hs_first0123456789abcdef0123456789abcdef0123456789"
  }));
  await createSessionWithConnection(connection, ACTOR, baseBody({
    historicalCreationKey: "hs_second123456789abcdef0123456789abcdef0123456789"
  }));

  assert.equal(connection.state.events.filter((event) => event === "user_share").length, 2);
  assert.equal(connection.state.events.some((event) => event === "user_update"), false);
  assert.equal(connection.state.userRoleInsertCount, 0);
});

test("a deleted historical session leaves an operation tombstone and can never be recreated", async () => {
  const connection = idempotentHistoricalCreationConnection();
  const body = baseBody({
    historicalCreationKey: "hs_0123456789abcdef0123456789abcdef0123456789abcdef"
  });
  const created = await createSessionWithConnection(connection, ACTOR, body);
  connection.state.sessions.delete(created.id);

  await assert.rejects(
    () => createSessionWithConnection(connection, ACTOR, body),
    {
      statusCode: 409,
      code: "HISTORICAL_SESSION_CREATION_OPERATION_INVALID"
    }
  );
  assert.equal(connection.state.operations.size, 1);
  assert.equal(connection.state.sessionInsertCount, 1);
});

test("historical creation key replay with a changed payload conflicts before side effects", async () => {
  const connection = idempotentHistoricalCreationConnection();
  const historicalCreationKey =
    "hs_0123456789abcdef0123456789abcdef0123456789abcdef";

  await createSessionWithConnection(connection, ACTOR, baseBody({
    historicalCreationKey,
    note: "第一次补录"
  }));
  await assert.rejects(
    () => createSessionWithConnection(connection, ACTOR, baseBody({
      historicalCreationKey,
      note: "被更改的补录"
    })),
    {
      statusCode: 409,
      code: "HISTORICAL_SESSION_CREATION_KEY_REUSED"
    }
  );

  assert.equal(connection.state.sessionInsertCount, 1);
  assert.equal(connection.state.operations.size, 1);
});

test("historical creation keys are isolated by authenticated organizer", async () => {
  const connection = idempotentHistoricalCreationConnection();
  const historicalCreationKey =
    "hs_0123456789abcdef0123456789abcdef0123456789abcdef";
  const secondActor = {
    user: { id: 8, phoneVerifiedAt: ACTOR.user.phoneVerifiedAt },
    roles: ["organizer"]
  };

  const first = await createSessionWithConnection(connection, ACTOR, baseBody({
    historicalCreationKey
  }));
  const second = await createSessionWithConnection(connection, secondActor, baseBody({
    historicalCreationKey
  }));

  assert.notEqual(first.id, second.id);
  assert.equal(connection.state.sessionInsertCount, 2);
  assert.equal(connection.state.operations.size, 2);
});

test("historical creation key validation is strict and future creation never enters operation storage", async (t) => {
  for (const historicalCreationKey of ["short", "hs_has spaces_012345678901234567890123456789", "x".repeat(129)]) {
    await t.test(`rejects ${JSON.stringify(historicalCreationKey)}`, async () => {
      const connection = idempotentHistoricalCreationConnection();
      await assert.rejects(
        () => createSessionWithConnection(connection, ACTOR, baseBody({ historicalCreationKey })),
        { statusCode: 400 }
      );
      assert.equal(connection.state.sessionInsertCount, 0);
      assert.equal(connection.state.operations.size, 0);
    });
  }

  const futureConnection = idempotentHistoricalCreationConnection();
  await assert.rejects(
    () => createSessionWithConnection(futureConnection, ACTOR, baseBody({
      startAt: "2099-01-01 13:00:00",
      sessionPurpose: "future_carpool",
      historicalCreationKey: "hs_0123456789abcdef0123456789abcdef0123456789abcdef"
    })),
    { statusCode: 400 }
  );
  assert.equal(futureConnection.state.operations.size, 0);
});

test("historical creation requires an operation identity before any domain lock or insert", async () => {
  const connection = idempotentHistoricalCreationConnection();
  await assert.rejects(
    () => createSessionWithConnection(connection, ACTOR, {
      storeId: 3,
      scriptId: 4,
      startAt: "2020-01-01 13:00:00",
      sessionPurpose: "historical_record"
    }),
    {
      statusCode: 400,
      code: "HISTORICAL_SESSION_CREATION_KEY_REQUIRED"
    }
  );
  assert.deepEqual(connection.state.events, []);
  assert.equal(connection.state.sessionInsertCount, 0);
});

test("core rejects a body hash unless it matches the trusted proposal option", async () => {
  const historicalCreationKeyHash = crypto
    .createHash("sha256")
    .update("hs_0123456789abcdef0123456789abcdef0123456789abcdef")
    .digest("hex");
  const connection = idempotentHistoricalCreationConnection();

  await assert.rejects(
    () => createSessionWithConnection(connection, ACTOR, baseBody({
      historicalCreationKeyHash
    })),
    { statusCode: 400 }
  );
  assert.equal(connection.state.sessionInsertCount, 0);
  assert.equal(connection.state.operations.size, 0);
});

test("direct raw key and approved hash proposal replay one historical creation", async () => {
  const historicalCreationKey =
    "hs_0123456789abcdef0123456789abcdef0123456789abcdef";
  const historicalCreationKeyHash = crypto
    .createHash("sha256")
    .update(historicalCreationKey)
    .digest("hex");
  const moderationIdentity = `hsc_${historicalCreationKeyHash}`;
  const descriptor = buildTextModerationDescriptor({
    action: "create_session",
    subjectId: "session-create:7",
    actorUserId: ACTOR.user.id,
    openid: "openid-7",
    baseVersion: expectedTextCreationBase(ACTOR.user.id),
    idempotencyKey: moderationIdentity,
    idempotencyExplicit: true,
    body: baseBody({
      historicalCreationKey,
      note: "审核中的补录",
      pinnedMessageText: "补录说明",
      extraNpcRoles: [{
        id: 9988,
        name: "待认领 NPC",
        description: "现场补录",
        roleGender: "unlimited"
      }]
    })
  });

  assert.equal(descriptor.idempotencyKey, moderationIdentity);
  assert.equal(descriptor.payload.body.historicalCreationKey, undefined);
  assert.equal(
    descriptor.payload.body.historicalCreationKeyHash,
    historicalCreationKeyHash
  );
  assert.equal(JSON.stringify(descriptor).includes(historicalCreationKey), false);
  assert.equal(descriptor.payload.body.extraNpcRoles[0].id, undefined);

  const connection = idempotentHistoricalCreationConnection();
  const created = await createSessionWithConnection(
    connection,
    ACTOR,
    baseBody({
      historicalCreationKey,
      note: "审核中的补录",
      pinnedMessageText: "补录说明",
      extraNpcRoles: [{
        id: 9988,
        name: "待认领 NPC",
        description: "现场补录",
        roleGender: "unlimited"
      }]
    })
  );
  connection.state.events.length = 0;
  const replay = await applyApprovedSessionProposal(
    connection,
    descriptor.payload.body,
    moderationIdentity
  );
  assert.equal(replay.id, created.id);
  assert.equal(connection.state.sessionInsertCount, 1);
  assert.equal(connection.state.chatRoomInsertCount, 1);
  assert.equal(connection.state.messageInsertCount, 1);
  assert.equal(connection.state.sessionNpcRoleInsertCount, 1);
  assert.equal(connection.state.operations.size, 1);
  assert.deepEqual(connection.state.events, [
    "operation",
    "session"
  ]);
});

test("an unbound approved operation validates its baseline once after canonical snapshot locks", async () => {
  const historicalCreationKey =
    "hs_0123456789abcdef0123456789abcdef0123456789abcdef";
  const historicalCreationKeyHash = crypto
    .createHash("sha256")
    .update(historicalCreationKey)
    .digest("hex");
  const descriptor = buildTextModerationDescriptor({
    action: "create_session",
    subjectId: "session-create:7",
    actorUserId: ACTOR.user.id,
    openid: "openid-7",
    baseVersion: expectedTextCreationBase(ACTOR.user.id),
    idempotencyKey: `hsc_${historicalCreationKeyHash}`,
    idempotencyExplicit: true,
    body: baseBody({ historicalCreationKey, note: "首次审核补录" })
  });
  const connection = idempotentHistoricalCreationConnection();

  await applyApprovedSessionProposal(
    connection,
    descriptor.payload.body,
    descriptor.idempotencyKey
  );

  assert.deepEqual(connection.state.events.slice(0, 7), [
    "operation",
    "user_share",
    "user_roles_update",
    "store_share",
    "script_share",
    "script_npc_roles_share",
    "approved_baseline"
  ]);
  assert.equal(
    connection.state.events.filter((event) => event === "approved_baseline").length,
    1
  );
});

test("direct payload A then approved payload B closes the moderation proposal as stale", async () => {
  const historicalCreationKey =
    "hs_0123456789abcdef0123456789abcdef0123456789abcdef";
  const historicalCreationKeyHash = crypto
    .createHash("sha256")
    .update(historicalCreationKey)
    .digest("hex");
  const moderationIdentity = `hsc_${historicalCreationKeyHash}`;
  const connection = idempotentHistoricalCreationConnection();

  await createSessionWithConnection(connection, ACTOR, baseBody({
    historicalCreationKey,
    note: "直连版本 A"
  }));
  await assert.rejects(
    () => applyApprovedSessionProposal(
      connection,
      baseBody({
        historicalCreationKeyHash,
        note: "审核版本 B"
      }),
      moderationIdentity
    ),
    { code: "CONTENT_MODERATION_PROPOSAL_STALE" }
  );
  assert.equal(connection.state.sessionInsertCount, 1);
});

test("approved historical proposal rejects a moderation identity that mismatches its payload hash", async () => {
  const historicalCreationKey =
    "hs_0123456789abcdef0123456789abcdef0123456789abcdef";
  const descriptor = buildTextModerationDescriptor({
    action: "create_session",
    subjectId: "session-create:7",
    actorUserId: ACTOR.user.id,
    openid: "openid-7",
    baseVersion: expectedTextCreationBase(ACTOR.user.id),
    idempotencyKey: "hsc_placeholder",
    idempotencyExplicit: true,
    body: baseBody({ historicalCreationKey, note: "审核中的补录" })
  });

  await assert.rejects(
    () => applyApprovedSessionProposal(
      idempotentHistoricalCreationConnection(),
      descriptor.payload.body,
      `hsc_${"0".repeat(64)}`
    ),
    { code: "CONTENT_MODERATION_PROPOSAL_STALE" }
  );
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
      assert.equal(connection.state.mutations.length, 2);
      assert.match(connection.state.mutations[0].sql, /^UPDATE signups SET/);
      assert.deepEqual(connection.state.mutations[0].values, [101, 31, 8]);
      assert.equal(connection.state.signups[0].status, "cancelled");
      assert.equal(connection.state.signups[0].review_eligible_at, null);
      assert.equal(connection.state.mutations[1].values[0], null);
    });
  }
});

test("historical NPC unbinding locks signups, cancels the exact claim, and permits a new claim", async () => {
  const connection = historicalRoleManagementConnection({
    role: { bound_user_id: CLAIMANT.user.id },
    signups: [{
      id: 81,
      session_id: 101,
      session_npc_role_id: 31,
      signup_type: "session_npc_role",
      user_id: CLAIMANT.user.id,
      status: "approved",
      review_eligible_at: new Date("2026-01-01T00:00:00.000Z")
    }]
  });

  await updateSessionNpcRoleWithConnection(connection, ACTOR, 31, { boundUserId: null });

  assert.equal(connection.state.role.bound_user_id, null);
  assert.equal(connection.state.signups[0].status, "cancelled");
  assert.equal(connection.state.signups[0].review_eligible_at, null);
  const sessionLock = connection.state.events.indexOf(
    "SELECT * FROM sessions WHERE id = ? FOR UPDATE"
  );
  const roleLock = connection.state.events.indexOf(
    "SELECT * FROM session_npc_roles WHERE id = ? AND session_id = ? FOR UPDATE"
  );
  const signupLock = connection.state.events.indexOf(
    "SELECT * FROM signups WHERE session_id = ? ORDER BY id FOR UPDATE"
  );
  const cleanup = connection.state.events.indexOf(
    "UPDATE signups SET status = 'cancelled', review_eligible_at = NULL WHERE session_id = ? AND session_npc_role_id = ? AND user_id = ? AND status IN ('pending', 'approved')"
  );
  assert.ok(sessionLock >= 0);
  assert.ok(roleLock > sessionLock);
  assert.ok(signupLock > roleLock);
  assert.ok(cleanup > signupLock);

  const reclaimConnection = historicalClaimConnection({
    npcRoles: [
      { id: 31, status: "active", bound_user_id: null },
      { id: 32, status: "active", bound_user_id: null }
    ],
    activeSignups: connection.state.signups.filter((signup) =>
      ["pending", "approved"].includes(signup.status)
    )
  });
  const claim = await claimHistoricalSessionRoleWithConnection(
    reclaimConnection,
    CLAIMANT,
    101,
    { npcRoleId: 32 },
    HISTORICAL_INVITE_CLAIMS
  );
  assert.equal(claim.claim_type, "npc_role");
  assert.equal(reclaimConnection.state.npcRoles[1].bound_user_id, CLAIMANT.user.id);
});

test("historical NPC unbinding rolls back signup cleanup when role mutation fails", async () => {
  const connection = historicalRoleManagementConnection({
    role: { bound_user_id: CLAIMANT.user.id },
    signups: [{
      id: 81,
      session_id: 101,
      session_npc_role_id: 31,
      signup_type: "session_npc_role",
      user_id: CLAIMANT.user.id,
      status: "approved",
      review_eligible_at: new Date("2026-01-01T00:00:00.000Z")
    }],
    failRoleUpdate: true
  });

  await withMockMysqlConnection(connection, () =>
    assert.rejects(
      () => updateSessionNpcRole(ACTOR, 31, { boundUserId: null }),
      { message: "NPC_ROLE_UPDATE_FAILED" }
    )
  );

  assert.ok(connection.state.events.includes("ROLLBACK"));
  assert.equal(connection.state.role.bound_user_id, CLAIMANT.user.id);
  assert.equal(connection.state.signups[0].status, "approved");
  assert.notEqual(connection.state.signups[0].review_eligible_at, null);
  assert.equal(
    connection.state.mutations.some(({ sql }) => sql.startsWith("UPDATE signups SET")),
    true
  );
});

test("historical NPC generic PATCH rejects every explicit status before mutation", async (t) => {
  for (const status of ["inactive", "active"]) {
    await t.test(status, async () => {
      const connection = historicalRoleManagementConnection();
      await assert.rejects(
        () => updateSessionNpcRoleWithConnection(connection, ACTOR, 31, { status }),
        { statusCode: 400, code: "BAD_REQUEST" }
      );
      assert.equal(connection.state.role.status, "active");
      assert.deepEqual(connection.state.mutations, []);
    });
  }
});

test("future NPC unbinding preserves the existing role-only mutation", async () => {
  const connection = historicalRoleManagementConnection({
    session: { session_purpose: "future_carpool", status: "recruiting" }
  });
  await updateSessionNpcRoleWithConnection(connection, ACTOR, 31, { boundUserId: null });
  assert.equal(connection.state.mutations.length, 1);
  assert.match(connection.state.mutations[0].sql, /^UPDATE session_npc_roles SET/);
  assert.equal(connection.state.signups[0].status, "approved");
  assert.notEqual(connection.state.signups[0].review_eligible_at, null);
});

test("future NPC generic PATCH still permits status changes", async () => {
  const connection = historicalRoleManagementConnection({
    session: { session_purpose: "future_carpool", status: "recruiting" }
  });
  await updateSessionNpcRoleWithConnection(connection, ACTOR, 31, { status: "inactive" });
  assert.equal(connection.state.role.status, "inactive");
  assert.equal(connection.state.mutations.length, 1);
  assert.match(connection.state.mutations[0].sql, /^UPDATE session_npc_roles SET status = \?/);
});

test("historical seat removal revokes review eligibility in both active cancellation ranges", async () => {
  const connection = seatKickConnection("historical_record");
  await withMockMysqlConnection(connection, () => kickSessionSeat(ACTOR, 11));

  const cancellationUpdates = connection.state.mutations.filter(({ sql }) =>
    sql.startsWith("UPDATE signups SET status = 'cancelled'")
  );
  assert.equal(cancellationUpdates.length, 2);
  assert.equal(
    cancellationUpdates.every(({ sql }) => /review_eligible_at = NULL/.test(sql)),
    true
  );
});

test("future seat removal preserves review eligibility in its active cancellation ranges", async () => {
  const connection = seatKickConnection("future_carpool");
  await withMockMysqlConnection(connection, () => kickSessionSeat(ACTOR, 11));

  const cancellationUpdates = connection.state.mutations.filter(({ sql }) =>
    sql.startsWith("UPDATE signups SET status = 'cancelled'")
  );
  assert.equal(cancellationUpdates.length, 2);
  assert.equal(
    cancellationUpdates.every(({ sql }) => !/review_eligible_at = NULL/.test(sql)),
    true
  );
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

test("historical invitation issuance is limited to the current organizer of a locked record", async (t) => {
  const allowedConnection = recruitmentGuardConnection((sql) => {
    if (sql === "SELECT * FROM sessions WHERE id = ?") {
      return [[{
        id: 101,
        organizer_user_id: ACTOR.user.id,
        session_purpose: "historical_record",
        status: "locked",
        cancelled_by_user_id: null
      }]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const allowed = await withMockMysqlConnection(allowedConnection, () =>
    assertHistoricalSessionInviteAllowed(ACTOR, 101)
  );
  assert.deepEqual(allowed, { sessionId: 101, organizerUserId: ACTOR.user.id });

  const cases = [
    ["system admin who is not organizer", ADMIN, {}],
    ["ordinary member", CLAIMANT, {}],
    ["draft historical session", ACTOR, { status: "draft" }],
    ["future session", ACTOR, { session_purpose: "future_carpool" }],
    ["cancelled session", ACTOR, { status: "cancelled", cancelled_by_user_id: ACTOR.user.id }]
  ];
  for (const [name, user, sessionOverride] of cases) {
    await t.test(name, async () => {
      const connection = recruitmentGuardConnection((sql) => {
        if (sql === "SELECT * FROM sessions WHERE id = ?") {
          return [[{
            id: 101,
            organizer_user_id: ACTOR.user.id,
            session_purpose: "historical_record",
            status: "locked",
            cancelled_by_user_id: null,
            ...sessionOverride
          }]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      });
      await withMockMysqlConnection(connection, () =>
        assert.rejects(
          () => assertHistoricalSessionInviteAllowed(user, 101),
          { statusCode: 403 }
        )
      );
      assert.deepEqual(connection.state.mutations, []);
    });
  }
});

test("historical claims require exactly one positive seatId or npcRoleId", async (t) => {
  for (const [name, body] of [
    ["neither target", {}],
    ["both targets", { seatId: 11, npcRoleId: 31 }],
    ["invalid seat", { seatId: 0 }],
    ["invalid npc role", { npcRoleId: "nope" }]
  ]) {
    await t.test(name, async () => {
      const connection = historicalClaimConnection();
      await assert.rejects(
        () => claimHistoricalSessionRoleWithConnection(
          connection,
          CLAIMANT,
          101,
          body,
          HISTORICAL_INVITE_CLAIMS
        ),
        { statusCode: 400 }
      );
      assert.deepEqual(connection.state.mutations, []);
    });
  }
});

test("mismatched historical claims are rejected before target validation or session lookup", async (t) => {
  const cases = [
    ["existing path", historicalClaimConnection(), { seatId: 11 }],
    ["nonexistent path", historicalClaimConnection({ sessionExists: false }), { seatId: 11 }],
    ["invalid target body", historicalClaimConnection(), {}]
  ];
  for (const [name, connection, body] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        () => claimHistoricalSessionRoleWithConnection(
          connection,
          CLAIMANT,
          102,
          body,
          HISTORICAL_INVITE_CLAIMS
        ),
        { statusCode: 403, code: "FORBIDDEN" }
      );
      assert.deepEqual(connection.state.queries, []);
      assert.deepEqual(connection.state.mutations, []);
    });
  }
});

test("historical claims reject invalid lifecycle and stale invitation claims before mutation", async (t) => {
  const cases = [
    ["session is not historical", { session: { session_purpose: "future_carpool" } }, HISTORICAL_INVITE_CLAIMS],
    ["session is not locked", { session: { status: "draft" } }, HISTORICAL_INVITE_CLAIMS],
    ["session is cancelled", { session: { status: "cancelled", cancelled_by_user_id: 7 } }, HISTORICAL_INVITE_CLAIMS],
    ["token path mismatch", {}, { ...HISTORICAL_INVITE_CLAIMS, sessionId: 102 }],
    ["inviter is no longer organizer", { session: { organizer_user_id: 88 } }, HISTORICAL_INVITE_CLAIMS],
    ["wrong token purpose", {}, { ...HISTORICAL_INVITE_CLAIMS, purpose: "session_join_invite" }],
    ["wrong token session purpose", {}, { ...HISTORICAL_INVITE_CLAIMS, sessionPurpose: "future_carpool" }]
  ];
  for (const [name, connectionOptions, claims] of cases) {
    await t.test(name, async () => {
      const connection = historicalClaimConnection(connectionOptions);
      await assert.rejects(
        () => claimHistoricalSessionRoleWithConnection(
          connection,
          CLAIMANT,
          101,
          { seatId: 11 },
          claims
        ),
        { statusCode: 403 }
      );
      assert.deepEqual(connection.state.mutations, []);
    });
  }
});

test("historical claims reject cross-session, occupied, and second-role targets", async (t) => {
  const cases = [
    ["seat outside locked session", {}, { seatId: 999 }, 404],
    ["NPC outside locked session", {}, { npcRoleId: 999 }, 404],
    ["occupied seat", { seats: [{ id: 11, status: "confirmed", confirmed_user_id: 88 }] }, { seatId: 11 }, 409],
    ["occupied NPC", { npcRoles: [{ id: 31, status: "active", bound_user_id: 88 }] }, { npcRoleId: 31 }, 409],
    [
      "claimant already owns another seat",
      { seats: [
        { id: 11, status: "open", confirmed_user_id: null },
        { id: 12, status: "confirmed", confirmed_user_id: CLAIMANT.user.id }
      ] },
      { seatId: 11 },
      409
    ],
    [
      "claimant already owns another NPC role",
      { npcRoles: [
        { id: 31, status: "active", bound_user_id: null },
        { id: 32, status: "active", bound_user_id: CLAIMANT.user.id }
      ] },
      { npcRoleId: 31 },
      409
    ],
    [
      "claimant has another active signup",
      { activeSignups: [{ seat_id: 12, session_npc_role_id: null, signup_type: "seat" }] },
      { seatId: 11 },
      409
    ]
  ];
  for (const [name, connectionOptions, body, statusCode] of cases) {
    await t.test(name, async () => {
      const connection = historicalClaimConnection(connectionOptions);
      await assert.rejects(
        () => claimHistoricalSessionRoleWithConnection(
          connection,
          CLAIMANT,
          101,
          body,
          HISTORICAL_INVITE_CLAIMS
        ),
        { statusCode }
      );
      assert.deepEqual(connection.state.mutations, []);
    });
  }
});

test("removed historical member cannot reuse an invitation and causes no writes", async () => {
  const connection = historicalClaimConnection({ blockRejoin: true });
  await assert.rejects(
    () => claimHistoricalSessionRoleWithConnection(
      connection,
      CLAIMANT,
      101,
      { seatId: 11 },
      HISTORICAL_INVITE_CLAIMS
    ),
    { statusCode: 403, code: "FORBIDDEN" }
  );
  assert.deepEqual(connection.state.mutations, []);
  assert.equal(
    connection.state.queries.some(({ sql }) => /^(UPDATE|INSERT) /.test(sql)),
    false
  );
});

test("historical claim locks the whole role namespace before the claimant signups", async () => {
  const connection = historicalClaimConnection();
  await claimHistoricalSessionRoleWithConnection(
    connection,
    CLAIMANT,
    101,
    { seatId: 11 },
    HISTORICAL_INVITE_CLAIMS
  );
  assert.deepEqual(
    connection.state.queries
      .map(({ sql }) => sql)
      .filter((sql) => /FOR UPDATE/.test(sql))
      .slice(0, 4),
    [
      "SELECT *, (start_at <= CURRENT_TIMESTAMP) AS session_started FROM sessions WHERE id = ? FOR UPDATE",
      "SELECT * FROM session_seats WHERE session_id = ? ORDER BY id FOR UPDATE",
      "SELECT * FROM session_npc_roles WHERE session_id = ? ORDER BY id FOR UPDATE",
      "SELECT * FROM signups WHERE session_id = ? AND user_id = ? AND status IN ('pending', 'approved') ORDER BY id FOR UPDATE"
    ]
  );
});

test("historical seat claims approve review-eligible membership and are replay-safe", async (t) => {
  await t.test("new claim", async () => {
    const connection = historicalClaimConnection();
    const result = await claimHistoricalSessionRoleWithConnection(
      connection,
      CLAIMANT,
      101,
      { seatId: 11 },
      HISTORICAL_INVITE_CLAIMS
    );
    assert.equal(result.claim_result, "historical_claimed");
    assert.equal(result.claim_type, "seat");
    assert.equal(
      connection.state.queries.some((call) =>
        /review_eligible_at/.test(call.sql) && call.values.includes(CLAIMANT.user.id)
      ),
      true
    );
    const signupInsert = connection.state.mutations.find(({ sql }) =>
      sql.startsWith("INSERT INTO signups")
    );
    assert.match(signupInsert.sql, /ON DUPLICATE KEY UPDATE[\s\S]*session_npc_role_id = NULL/);
    assert.equal(connection.state.seats[0].confirmed_user_id, CLAIMANT.user.id);
  });

  await t.test("same seat replay", async () => {
    const connection = historicalClaimConnection({
      seats: [{ id: 11, status: "confirmed", confirmed_user_id: CLAIMANT.user.id }],
      activeSignups: [{ seat_id: 11, session_npc_role_id: null, signup_type: "seat" }]
    });
    const result = await claimHistoricalSessionRoleWithConnection(
      connection,
      CLAIMANT,
      101,
      { seatId: 11 },
      HISTORICAL_INVITE_CLAIMS
    );
    assert.equal(result.claim_result, "historical_claimed");
    assert.equal(result.claim_type, "seat");
    assert.equal(
      connection.state.mutations.some(({ sql }) => sql.startsWith("UPDATE session_seats")),
      false
    );
  });
});

test("historical NPC claims bind the user and approve a session_npc_role signup", async (t) => {
  await t.test("new claim", async () => {
    const connection = historicalClaimConnection();
    const result = await claimHistoricalSessionRoleWithConnection(
      connection,
      CLAIMANT,
      101,
      { npcRoleId: 31 },
      HISTORICAL_INVITE_CLAIMS
    );
    assert.equal(result.claim_result, "historical_claimed");
    assert.equal(result.claim_type, "npc_role");
    assert.equal(connection.state.npcRoles[0].bound_user_id, CLAIMANT.user.id);
    const signupInsert = connection.state.mutations.find(({ sql }) =>
      sql.startsWith("INSERT INTO signups")
    );
    assert.ok(signupInsert);
    assert.match(signupInsert.sql, /'session_npc_role'/);
    assert.match(signupInsert.sql, /review_eligible_at/);
    assert.match(signupInsert.sql, /ON DUPLICATE KEY UPDATE[\s\S]*seat_id = NULL/);
    assert.equal(signupInsert.values.includes(CLAIMANT.user.id), true);
  });

  await t.test("same NPC replay", async () => {
    const connection = historicalClaimConnection({
      npcRoles: [{ id: 31, status: "active", bound_user_id: CLAIMANT.user.id }],
      activeSignups: [{ seat_id: null, session_npc_role_id: 31, signup_type: "session_npc_role" }]
    });
    const result = await claimHistoricalSessionRoleWithConnection(
      connection,
      CLAIMANT,
      101,
      { npcRoleId: 31 },
      HISTORICAL_INVITE_CLAIMS
    );
    assert.equal(result.claim_result, "historical_claimed");
    assert.equal(result.claim_type, "npc_role");
    assert.equal(
      connection.state.mutations.some(({ sql }) => sql.startsWith("UPDATE session_npc_roles")),
      false
    );
  });
});

test("historical claim wrapper owns the transaction", async () => {
  const connection = historicalClaimConnection();
  await withMockMysqlConnection(connection, () =>
    claimHistoricalSessionRole(
      CLAIMANT,
      101,
      { seatId: 11 },
      HISTORICAL_INVITE_CLAIMS
    )
  );
  assert.equal(connection.state.mutations.length > 0, true);
});

function historicalPreviewConnection(sessionOverride = {}) {
  const session = {
    id: 101,
    organizer_user_id: ACTOR.user.id,
    session_purpose: "historical_record",
    status: "locked",
    visibility: "share_only",
    start_at: new Date("2026-07-01T05:00:00.000Z"),
    session_started: 1,
    dm_user_id: 8,
    npc_user_id: 9,
    note: "private organizer note",
    ...sessionOverride
  };
  return recruitmentGuardConnection((sql) => {
    if (
      sql ===
      "SELECT *, (start_at <= CURRENT_TIMESTAMP) AS session_started FROM sessions WHERE id = ? FOR UPDATE"
    ) {
      return [[session]];
    }
    if (sql === "SELECT seat.* FROM session_seats seat WHERE seat.session_id = ? ORDER BY seat.id") {
      return [[{
        id: 11,
        session_id: 101,
        name: "A",
        status: "confirmed",
        confirmed_user_id: 88,
        confirmed_user_nickname: "private player"
      }]];
    }
    if (sql.includes("FROM session_npc_roles role")) {
      return [[{
        id: 31,
        session_id: 101,
        name: "NPC",
        status: "active",
        bound_user_id: 89,
        bound_user_name: "private NPC player",
        pending_signup_id: 90
      }]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
}

test("historical invitation preview is dedicated, locked-only, and sanitized", async (t) => {
  const connection = historicalPreviewConnection();
  const preview = await withMockMysqlConnection(connection, () =>
    getSessionForViewer(101, { historicalInviteClaims: HISTORICAL_INVITE_CLAIMS })
  );
  assert.equal(preview.access_scope, "historical_invite_preview");
  for (const privateField of [
    "organizer_user_id",
    "dm_user_id",
    "npc_user_id",
    "note",
    "join_policy",
    "join_phone_required",
    "npc_join_enabled",
    "album",
    "reviews"
  ]) {
    assert.equal(Object.hasOwn(preview, privateField), false);
  }
  assert.equal(Object.hasOwn(preview.seats[0], "confirmed_user_id"), false);
  assert.equal(Object.hasOwn(preview.session_npc_roles[0], "bound_user_id"), false);
  assert.equal(Object.hasOwn(preview.session_npc_roles[0], "pending_signup_id"), false);

  const denied = [
    ["ordinary token on historical", {}, { inviteClaims: { sessionId: 101 } }],
    ["historical token on future", { session_purpose: "future_carpool" }, { historicalInviteClaims: HISTORICAL_INVITE_CLAIMS }],
    ["historical session is not locked", { status: "recruiting" }, { historicalInviteClaims: HISTORICAL_INVITE_CLAIMS }],
    ["path id does not match", {}, { historicalInviteClaims: { ...HISTORICAL_INVITE_CLAIMS, sessionId: 102 } }],
    ["inviter is no longer organizer", { organizer_user_id: 88 }, { historicalInviteClaims: HISTORICAL_INVITE_CLAIMS }]
  ];
  for (const [name, sessionOverride, viewOptions] of denied) {
    await t.test(name, async () => {
      const deniedConnection = historicalPreviewConnection(sessionOverride);
      await withMockMysqlConnection(deniedConnection, () =>
        assert.rejects(
          () => getSessionForViewer(101, viewOptions),
          { statusCode: 404, message: "Session not found" }
        )
      );
    });
  }
});

test("public session availability requires a future carpool", async () => {
  const source = await readFile(
    new URL("../src/modules/core/service.js", import.meta.url),
    "utf8"
  );
  const helperStart = source.indexOf("function publicSessionAvailable(session)");
  const helperEnd = source.indexOf("function publicSeatResponse", helperStart);
  const helper = source.slice(helperStart, helperEnd);

  assert.match(helper, /session\.session_purpose === "future_carpool"/);
  assert.match(helper, /session\.visibility === "public"/);
  assert.match(helper, /session\.status === "recruiting"/);
  assert.match(helper, /startAt > Date\.now\(\)/);
});

test("discoverable session SQL requires a public recruiting future carpool", async () => {
  const source = await readFile(
    new URL("../src/modules/core/service.js", import.meta.url),
    "utf8"
  );
  const listStart = source.indexOf("export async function listDiscoverableSessions");
  const listEnd = source.indexOf("export async function listPublicUpcomingSessions", listStart);
  const list = source.slice(listStart, listEnd);

  assert.match(list, /session\.session_purpose = 'future_carpool'/);
  assert.match(list, /session\.visibility = 'public'/);
  assert.match(list, /session\.status = 'recruiting'/);
  assert.match(list, /session\.start_at > CURRENT_TIMESTAMP/);
});

test("public upcoming session SQL requires a public recruiting future carpool", async () => {
  const source = await readFile(
    new URL("../src/modules/core/service.js", import.meta.url),
    "utf8"
  );
  const listStart = source.indexOf("export async function listPublicUpcomingSessions");
  const listEnd = source.indexOf("export async function listAdminSessions", listStart);
  const list = source.slice(listStart, listEnd);

  assert.match(list, /session\.session_purpose = 'future_carpool'/);
  assert.match(list, /session\.visibility = 'public'/);
  assert.match(list, /session\.status = 'recruiting'/);
  assert.match(list, /session\.start_at > CURRENT_TIMESTAMP/);
});
