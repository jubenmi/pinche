import assert from "node:assert/strict";
import test from "node:test";

import { createSessionWithConnection } from "../src/modules/core/service.js";
import { buildTextModerationDescriptor } from "../src/modules/content-moderation/text-boundaries.js";
import { projectAuthorTextProposal } from "../src/modules/content-moderation/text-author-projection.js";
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

function baseBody(overrides = {}) {
  return {
    storeId: 3,
    scriptId: 4,
    startAt: "2020-01-01 13:00:00",
    sessionPurpose: "historical_record",
    ...overrides
  };
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

test("moderated historical creation preserves snake member aliases through approved application", async () => {
  const targetSubjectId = textCreationTargetSubjectId({
    action: "create_session",
    actorUserId: ACTOR.user.id
  });
  const descriptor = buildTextModerationDescriptor({
    action: "create_session",
    actorUserId: ACTOR.user.id,
    openid: "openid-7",
    subjectId: targetSubjectId,
    baseVersion: expectedTextCreationBase(ACTOR.user.id),
    idempotencyKey: "historical-snake-member-aliases",
    body: baseBody({
      dm_user_id: 8,
      npc_user_id: 9,
      note: "这是一条需要审核的历史记录说明"
    }),
    context: { targetSubjectId }
  });

  assert.equal(descriptor.payload.body.dm_user_id, 8);
  assert.equal(descriptor.payload.body.npc_user_id, 9);
  const authorProjection = projectAuthorTextProposal({
    action: "create_session",
    targetSubjectId,
    body: descriptor.payload.body
  });
  assert.equal(authorProjection.content.dm_user_id, 8);
  assert.equal(authorProjection.content.npc_user_id, 9);

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
    idempotency_key: "historical-snake-member-aliases",
    normalized_payload_json: JSON.stringify(descriptor.payload)
  };

  await assert.rejects(
    () => applicator.apply(createConnection(), {
      job: {
        subject_id: textOperationSubjectId({
          action: proposal.action,
          actorUserId: ACTOR.user.id,
          idempotencyKey: proposal.idempotency_key
        })
      },
      proposal
    }),
    {
      statusCode: 400,
      code: "HISTORICAL_MEMBER_PREBIND_FORBIDDEN",
      message: "Historical members must claim a role through a historical invitation"
    }
  );
});
