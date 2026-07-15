import { AppError, notFound } from "../../http/errors.js";

const CANCELLABLE_PENDING_JOB_STATUSES = new Set([
  "pending",
  "processing",
  "review",
  "error"
]);

function conflict(message) {
  return new AppError(409, "CONTENT_MODERATION_AUTHOR_DRAFT_CONFLICT", message);
}

function positiveId(value, label) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^[1-9]\d*$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError(400, "BAD_REQUEST", `${label} must be a positive integer`);
  }
  return parsed;
}

function requireAuthorVisibilityDraft(draft) {
  if (!draft || Number(draft.author_visibility_version) !== 1) {
    throw notFound("Author draft not found");
  }
  return draft;
}

function cancellablePair(draft) {
  const proposalStatus = String(draft.proposal_status || draft.status || "");
  const jobStatus = String(draft.job_status || "");
  if (proposalStatus === "pending" && CANCELLABLE_PENDING_JOB_STATUSES.has(jobStatus)) {
    return { proposalStatus, jobStatus };
  }
  if (proposalStatus === "rejected" && jobStatus === "rejected") {
    return { proposalStatus, jobStatus };
  }
  return null;
}

export function createAuthorDraftService({ transaction, repository, emit = () => {} } = {}) {
  if (typeof transaction !== "function") throw new TypeError("author draft transaction is required");
  if (typeof emit !== "function") throw new TypeError("author draft telemetry emitter is required");
  for (const method of [
    "findAuthorTextDraftById",
    "cancelTextProposalByAuthor",
    "cancelModerationJobByUser",
    "retireCurrentModerationAttempt",
    "supersedeRejectedTextProposal"
  ]) {
    if (typeof repository?.[method] !== "function") {
      throw new TypeError(`author draft repository.${method} is required`);
    }
  }

  async function cancel({ user, draftId } = {}) {
    const userId = positiveId(user?.user?.id, "user id");
    const normalizedDraftId = positiveId(draftId, "draft id");
    const outcome = await transaction(async (connection) => {
      const draft = requireAuthorVisibilityDraft(
        await repository.findAuthorTextDraftById(connection, {
          draftId: normalizedDraftId,
          userId,
          forUpdate: true
        })
      );
      const proposalStatus = String(draft.proposal_status || draft.status || "");
      const jobStatus = String(draft.job_status || "");
      if (proposalStatus === "cancelled" && jobStatus === "cancelled") {
        return {
          result: { draft_id: normalizedDraftId, status: "cancelled" },
          subjectType: String(draft.subject_type || "")
        };
      }

      const pair = cancellablePair(draft);
      if (!pair) throw conflict("Author draft state changed; refresh and try again");
      const proposalCancelled = await repository.cancelTextProposalByAuthor(connection, {
        proposalId: normalizedDraftId,
        userId,
        fromStatus: pair.proposalStatus
      });
      if (!proposalCancelled) throw conflict("Author draft state changed; refresh and try again");
      const jobCancelled = await repository.cancelModerationJobByUser(connection, {
        jobId: Number(draft.moderation_job_id),
        fromStatus: pair.jobStatus
      });
      if (!jobCancelled) throw conflict("Author draft job changed; refresh and try again");
      await repository.retireCurrentModerationAttempt(connection, {
        jobId: Number(draft.moderation_job_id)
      });
      return {
        result: { draft_id: normalizedDraftId, status: "cancelled" },
        subjectType: String(draft.subject_type || "")
      };
    });
    emit("author_private_cancelled", {
      subjectType: outcome.subjectType,
      outcome: "unpublished"
    });
    return outcome.result;
  }

  async function supersedeRejected(connection, input = {}) {
    const userId = positiveId(input.userId, "user id");
    const draftId = positiveId(input.draftId, "draft id");
    const newProposalId = positiveId(input.newProposalId, "new proposal id");
    if (draftId === newProposalId) throw conflict("Replacement draft must be new");
    const orderedIds = [draftId, newProposalId].sort((left, right) => left - right);
    const locked = new Map();
    for (const id of orderedIds) {
      locked.set(id, await repository.findAuthorTextDraftById(connection, {
        draftId: id,
        userId,
        forUpdate: true
      }));
    }
    const draft = locked.get(draftId);
    const replacement = locked.get(newProposalId);
    requireAuthorVisibilityDraft(draft);
    requireAuthorVisibilityDraft(replacement);
    const action = String(input.action || "");
    const targetSubjectId = String(input.targetSubjectId || "");
    const replacementMatches = (
      String(replacement.proposal_status || replacement.status || "") === "pending" &&
      ["pending", "processing"].includes(String(replacement.job_status || "")) &&
      String(draft.action || "") === action &&
      String(replacement.action || "") === action &&
      String(draft.target_subject_id || "") === targetSubjectId &&
      String(replacement.target_subject_id || "") === targetSubjectId
    );
    if (
      String(draft.proposal_status || draft.status || "") === "superseded" &&
      Number(draft.superseded_by_proposal_id) === newProposalId &&
      replacementMatches
    ) {
      return {
        draft_id: draftId,
        status: "superseded",
        superseded_by_draft_id: newProposalId
      };
    }
    if (
      String(draft.proposal_status || draft.status || "") !== "rejected" ||
      String(draft.job_status || "") !== "rejected" ||
      !replacementMatches
    ) {
      throw conflict("Replacement draft does not match the rejected draft");
    }
    const changed = await repository.supersedeRejectedTextProposal(connection, {
      proposalId: draftId,
      newProposalId,
      userId,
      action,
      targetSubjectId
    });
    if (!changed) throw conflict("Rejected draft changed before replacement");
    return {
      draft_id: draftId,
      status: "superseded",
      superseded_by_draft_id: newProposalId
    };
  }

  return { cancel, supersedeRejected };
}
