import { MODERATION_ERROR_CODES } from "./constants.js";

function staleProposal(message) {
  const error = new Error(message);
  error.code = MODERATION_ERROR_CODES.proposalStale;
  error.statusCode = 409;
  return error;
}

const REVALIDATION_STALE_CODES = new Set([
  "FORBIDDEN",
  "NOT_FOUND",
  "PHONE_REQUIRED"
]);

export function proposalStaleForRevalidationError(error) {
  if (error?.code === MODERATION_ERROR_CODES.proposalStale) return error;
  if (!REVALIDATION_STALE_CODES.has(String(error?.code || ""))) return null;
  return staleProposal("text moderation proposal is no longer eligible");
}

function parsePayload(proposal) {
  const raw = proposal?.normalized_payload_json;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("payload must be an object");
    }
    const body = parsed.body && typeof parsed.body === "object" && !Array.isArray(parsed.body)
      ? parsed.body
      : {};
    const context = parsed.context && typeof parsed.context === "object" && !Array.isArray(parsed.context)
      ? parsed.context
      : {};
    return {
      body,
      context,
      targetSubjectId: String(context.targetSubjectId || "").trim()
    };
  } catch {
    throw staleProposal("text moderation proposal payload is stale");
  }
}

export function createTextProposalApplicator({ loadActor, handlers } = {}) {
  if (typeof loadActor !== "function") throw new TypeError("loadActor is required");
  if (!handlers || typeof handlers !== "object") throw new TypeError("handlers are required");

  return {
    async apply(connection, { job, proposal } = {}) {
      const action = String(proposal?.action || "").trim();
      const handler = handlers[action];
      if (!action || typeof handler !== "function") {
        throw staleProposal("text moderation proposal action is stale");
      }
      const actorUserId = Number(proposal?.created_by_user_id);
      if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
        throw staleProposal("text moderation proposal actor is stale");
      }
      const actor = await loadActor(connection, actorUserId);
      if (!actor?.user?.id || Number(actor.user.id) !== actorUserId) {
        throw staleProposal("text moderation proposal actor is stale");
      }
      try {
        return await handler(connection, {
          actor,
          job,
          proposal,
          payload: parsePayload(proposal)
        });
      } catch (error) {
        throw proposalStaleForRevalidationError(error) || error;
      }
    }
  };
}
