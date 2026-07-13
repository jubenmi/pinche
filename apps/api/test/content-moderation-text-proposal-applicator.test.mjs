import assert from "node:assert/strict";
import test from "node:test";

import { forbidden } from "../src/http/errors.js";
import { createTextProposalApplicator } from "../src/modules/content-moderation/text-proposal-applicator.js";

const ACTIONS = [
  "update_nickname",
  "create_private_store",
  "create_private_script",
  "create_session",
  "update_session",
  "create_session_npc_role",
  "update_session_npc_role",
  "upsert_session_review",
  "create_session_message",
  "update_session_pinned_message"
];

function proposal(action) {
  return {
    id: 42,
    action,
    created_by_user_id: 7,
    base_version: "v1",
    normalized_payload_json: JSON.stringify({
      body: { note: "safe payload" },
      context: { sessionId: 8, targetSubjectId: "8" },
      actor_user_id: 7
    })
  };
}

test("the unified proposal applicator dispatches every covered text action with a revalidated actor", async () => {
  const calls = [];
  const handlers = Object.fromEntries(ACTIONS.map((action) => [
    action,
    async (_connection, input) => {
      calls.push({ action, input });
      return { id: 88, kind: action };
    }
  ]));
  const applicator = createTextProposalApplicator({
    loadActor: async (_connection, actorUserId) => ({
      user: { id: actorUserId, openid: "openid-7" },
      roles: ["player"]
    }),
    handlers
  });

  for (const action of ACTIONS) {
    const result = await applicator.apply({}, {
      job: { id: 12, subject_type: "text" },
      proposal: proposal(action)
    });
    assert.deepEqual(result, { id: 88, kind: action });
  }

  assert.equal(calls.length, ACTIONS.length);
  assert.equal(calls.every(({ input }) => input.actor.user.id === 7), true);
  assert.equal(calls.every(({ input }) => input.payload.context.sessionId === 8), true);
  assert.equal(calls.every(({ input }) => input.payload.targetSubjectId === "8"), true);
});

test("the applicator rejects malformed, unsupported, or missing-actor proposals as stale", async () => {
  const applicator = createTextProposalApplicator({
    loadActor: async () => null,
    handlers: {}
  });

  await assert.rejects(applicator.apply({}, { job: {}, proposal: proposal("update_nickname") }), {
    code: "CONTENT_MODERATION_PROPOSAL_STALE"
  });
  await assert.rejects(applicator.apply({}, {
    job: {},
    proposal: { ...proposal("unknown"), normalized_payload_json: "not-json" }
  }), { code: "CONTENT_MODERATION_PROPOSAL_STALE" });
});

test("deterministic permission and domain failures become stale while system errors propagate", async () => {
  const actor = { user: { id: 7, openid: "openid-7" }, roles: ["player"] };
  const permissionApplicator = createTextProposalApplicator({
    loadActor: async () => actor,
    handlers: {
      create_session_message: async () => { throw forbidden("membership was revoked"); }
    }
  });
  await assert.rejects(
    permissionApplicator.apply({}, { job: {}, proposal: proposal("create_session_message") }),
    { code: "CONTENT_MODERATION_PROPOSAL_STALE" }
  );

  const systemFailure = new Error("database unavailable");
  const systemApplicator = createTextProposalApplicator({
    loadActor: async () => actor,
    handlers: {
      create_session_message: async () => { throw systemFailure; }
    }
  });
  await assert.rejects(
    systemApplicator.apply({}, { job: {}, proposal: proposal("create_session_message") }),
    (error) => error === systemFailure
  );
});
