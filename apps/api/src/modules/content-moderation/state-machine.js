const DECISION_STATUS = Object.freeze({
  pass: "approved",
  review: "review",
  block: "rejected",
  error: "error"
});

const PROVIDER_TRANSITIONS = Object.freeze({
  pending: new Set(["processing", "approved", "review", "rejected", "error"]),
  processing: new Set(["approved", "review", "rejected", "error"]),
  error: new Set(["pending", "processing", "approved", "review", "rejected"]),
  review: new Set(),
  approved: new Set(),
  rejected: new Set()
});

const ADMIN_TRANSITIONS = Object.freeze({
  review: new Set(["approved", "rejected"]),
  error: new Set(["pending", "approved", "rejected"]),
  pending: new Set(["rejected"]),
  processing: new Set(["rejected"]),
  approved: new Set(),
  rejected: new Set()
});

const PROPOSAL_TRANSITIONS = Object.freeze({
  pending: new Set(["approved", "rejected", "stale"]),
  approved: new Set(),
  rejected: new Set(),
  stale: new Set()
});

function invalidTransition(fromStatus, toStatus) {
  const error = new Error(`invalid moderation transition: ${fromStatus} -> ${toStatus}`);
  error.code = "CONTENT_MODERATION_INVALID_TRANSITION";
  return error;
}

function invalidProposalTransition(fromStatus, toStatus) {
  const error = new Error(`invalid moderation proposal transition: ${fromStatus} -> ${toStatus}`);
  error.code = "CONTENT_MODERATION_INVALID_PROPOSAL_TRANSITION";
  return error;
}

export function moderationStatusForDecision(decision) {
  const status = DECISION_STATUS[String(decision || "").toLowerCase()];
  if (!status) throw invalidTransition("decision", decision);
  return status;
}

export function assertModerationTransition(
  fromStatus,
  toStatus,
  { source = "provider", decidedByAdminUserId = null } = {}
) {
  if (fromStatus === toStatus) return true;
  if (source === "provider" && decidedByAdminUserId) {
    throw invalidTransition(fromStatus, toStatus);
  }
  const transitions = source === "admin" ? ADMIN_TRANSITIONS : PROVIDER_TRANSITIONS;
  if (!transitions[fromStatus]?.has(toStatus)) {
    throw invalidTransition(fromStatus, toStatus);
  }
  return true;
}

export function assertTextProposalTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  if (!PROPOSAL_TRANSITIONS[fromStatus]?.has(toStatus)) {
    throw invalidProposalTransition(fromStatus, toStatus);
  }
  return true;
}
