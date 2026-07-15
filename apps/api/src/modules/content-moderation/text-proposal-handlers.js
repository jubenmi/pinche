import { AppError } from "../../http/errors.js";
import { createTextBaseline } from "./text-baseline.js";
import {
  profilePatchFromProposalBody,
  profileTextSnapshot
} from "./text-profile-patch.js";
import {
  textCreationTargetSubjectId,
  textOperationSubjectId,
  textSessionNpcRoleTargetSubjectId
} from "./text-request-identity.js";

export const PRODUCTION_TEXT_PROPOSAL_ACTIONS = Object.freeze([
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
]);

function proposalStale(message) {
  return new AppError(409, "CONTENT_MODERATION_PROPOSAL_STALE", message);
}

function proposalSessionId(payload) {
  const sessionId = Number(payload?.context?.sessionId);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw proposalStale("text moderation session target changed");
  }
  return sessionId;
}

function assertProposalBase(proposal, actual) {
  if (!actual || String(proposal?.base_version) !== String(actual)) {
    throw proposalStale("text moderation proposal base version changed");
  }
}

function assertProposalOperationTarget({ action, actor, job, proposal, payload, targetSubjectId }) {
  const target = String(targetSubjectId || "").trim();
  if (!target || String(payload?.targetSubjectId || "") !== target) {
    throw proposalStale("text moderation proposal target changed");
  }
  const expectedSubjectId = textOperationSubjectId({
    action,
    actorUserId: actor?.user?.id,
    idempotencyKey: proposal?.idempotency_key
  });
  if (String(job?.subject_id || "") !== expectedSubjectId) {
    throw proposalStale("text moderation proposal operation changed");
  }
}

export function expectedTextCreationBase(actorUserId) {
  return createTextBaseline({ kind: "creation", actor_id: Number(actorUserId) });
}

function requireFunctions(dependencies, names) {
  for (const name of names) {
    if (typeof dependencies?.[name] !== "function") {
      throw new TypeError(`production text proposal dependency ${name} is required`);
    }
  }
}

export function createProductionTextProposalHandlers(dependencies = {}) {
  requireFunctions(dependencies, [
    "currentActorTextSnapshot",
    "currentSessionCreateTextBase",
    "currentSessionTextBase",
    "currentNpcRoleTextBase",
    "currentReviewTextBase",
    "currentMessageTextBase",
    "currentPinnedTextBase",
    "updateUserProfileWithConnection",
    "createPrivateStoreWithConnection",
    "createPrivateScriptWithConnection",
    "createSessionWithConnection",
    "updateSessionWithConnection",
    "createSessionNpcRoleWithConnection",
    "updateSessionNpcRoleWithConnection",
    "upsertMySessionReviewWithConnection",
    "createSessionMessageWithConnection",
    "updateSessionPinnedMessageWithConnection"
  ]);

  function assertCreationProposal({ action, actor, job, proposal, payload }) {
    assertProposalOperationTarget({
      action,
      actor,
      job,
      proposal,
      payload,
      targetSubjectId: textCreationTargetSubjectId({ action, actorUserId: actor.user.id })
    });
    assertProposalBase(proposal, expectedTextCreationBase(actor.user.id));
  }

  return {
    async update_nickname(connection, { actor, job, proposal, payload }) {
      assertProposalOperationTarget({
        action: "update_nickname",
        actor,
        job,
        proposal,
        payload,
        targetSubjectId: String(actor.user.id)
      });
      const currentActor = await dependencies.currentActorTextSnapshot(
        connection,
        actor.user.id,
        { forUpdate: true }
      );
      assertProposalBase(proposal, currentActor
        ? createTextBaseline({
          kind: "user_profile",
          profile: profileTextSnapshot(currentActor)
        })
        : "");
      return dependencies.updateUserProfileWithConnection(
        connection,
        actor.user.id,
        profilePatchFromProposalBody(payload.body)
      );
    },

    async create_private_store(connection, input) {
      assertCreationProposal({ action: "create_private_store", ...input });
      return dependencies.createPrivateStoreWithConnection(
        connection,
        input.actor,
        input.payload.body
      );
    },

    async create_private_script(connection, input) {
      assertCreationProposal({ action: "create_private_script", ...input });
      return dependencies.createPrivateScriptWithConnection(
        connection,
        input.actor,
        input.payload.body
      );
    },

    async create_session(connection, { actor, job, proposal, payload }) {
      assertProposalOperationTarget({
        action: "create_session",
        actor,
        job,
        proposal,
        payload,
        targetSubjectId: textCreationTargetSubjectId({
          action: "create_session",
          actorUserId: actor.user.id
        })
      });
      assertProposalBase(
        proposal,
        await dependencies.currentSessionCreateTextBase(
          connection,
          actor.user.id,
          payload.body,
          { forUpdate: true }
        )
      );
      return dependencies.createSessionWithConnection(connection, actor, payload.body);
    },

    async update_session(connection, { actor, job, proposal, payload }) {
      const sessionId = proposalSessionId(payload);
      assertProposalOperationTarget({
        action: "update_session",
        actor,
        job,
        proposal,
        payload,
        targetSubjectId: String(sessionId)
      });
      assertProposalBase(
        proposal,
        await dependencies.currentSessionTextBase(
          connection,
          sessionId,
          actor.user.id,
          { forUpdate: true }
        )
      );
      return dependencies.updateSessionWithConnection(
        connection,
        actor,
        sessionId,
        payload.body
      );
    },

    async create_session_npc_role(connection, { actor, job, proposal, payload }) {
      const sessionId = proposalSessionId(payload);
      assertProposalOperationTarget({
        action: "create_session_npc_role",
        actor,
        job,
        proposal,
        payload,
        targetSubjectId: textSessionNpcRoleTargetSubjectId(sessionId)
      });
      assertProposalBase(
        proposal,
        await dependencies.currentSessionTextBase(
          connection,
          sessionId,
          actor.user.id,
          { forUpdate: true }
        )
      );
      return dependencies.createSessionNpcRoleWithConnection(
        connection,
        actor,
        sessionId,
        payload.body
      );
    },

    async update_session_npc_role(connection, { actor, job, proposal, payload }) {
      const npcRoleId = Number(payload?.targetSubjectId);
      if (!Number.isInteger(npcRoleId) || npcRoleId <= 0) {
        throw proposalStale("text moderation NPC role target changed");
      }
      assertProposalOperationTarget({
        action: "update_session_npc_role",
        actor,
        job,
        proposal,
        payload,
        targetSubjectId: String(npcRoleId)
      });
      assertProposalBase(
        proposal,
        await dependencies.currentNpcRoleTextBase(
          connection,
          npcRoleId,
          actor.user.id,
          { forUpdate: true }
        )
      );
      return dependencies.updateSessionNpcRoleWithConnection(
        connection,
        actor,
        npcRoleId,
        payload.body
      );
    },

    async upsert_session_review(connection, { actor, job, proposal, payload }) {
      const sessionId = proposalSessionId(payload);
      assertProposalOperationTarget({
        action: "upsert_session_review",
        actor,
        job,
        proposal,
        payload,
        targetSubjectId: String(sessionId)
      });
      assertProposalBase(
        proposal,
        await dependencies.currentReviewTextBase(
          connection,
          sessionId,
          actor.user.id,
          { forUpdate: true }
        )
      );
      return dependencies.upsertMySessionReviewWithConnection(
        connection,
        actor,
        sessionId,
        payload.body
      );
    },

    async create_session_message(connection, { actor, job, proposal, payload }) {
      const sessionId = proposalSessionId(payload);
      assertProposalOperationTarget({
        action: "create_session_message",
        actor,
        job,
        proposal,
        payload,
        targetSubjectId: String(sessionId)
      });
      assertProposalBase(
        proposal,
        await dependencies.currentMessageTextBase(
          connection,
          sessionId,
          actor.user.id,
          { forUpdate: true }
        )
      );
      return dependencies.createSessionMessageWithConnection(
        connection,
        actor,
        sessionId,
        payload.body
      );
    },

    async update_session_pinned_message(connection, { actor, job, proposal, payload }) {
      const sessionId = proposalSessionId(payload);
      assertProposalOperationTarget({
        action: "update_session_pinned_message",
        actor,
        job,
        proposal,
        payload,
        targetSubjectId: String(sessionId)
      });
      assertProposalBase(
        proposal,
        await dependencies.currentPinnedTextBase(
          connection,
          sessionId,
          actor.user.id,
          { forUpdate: true }
        )
      );
      const result = await dependencies.updateSessionPinnedMessageWithConnection(
        connection,
        actor,
        sessionId,
        payload.body
      );
      return {
        id: result?.pinnedMessage?.id,
        kind: "session_pinned_message"
      };
    }
  };
}
