import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createSessionWithConnection,
  publishSessionWithConnection
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

function compactSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
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
        return [[currentSession]];
      }
      if (
        normalized ===
        "SELECT * FROM session_seats WHERE session_id = ? ORDER BY id FOR UPDATE"
      ) {
        return [[...currentSeats].sort((left, right) => Number(left.id) - Number(right.id))];
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
