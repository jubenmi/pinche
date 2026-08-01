function positiveIdentifier(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function inviteQuery({ mode = "normal", token = "" } = {}) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return "";
  }
  const parameter = mode === "historical" ? "historicalInviteToken" : "inviteToken";
  return `?${parameter}=${encodeURIComponent(normalizedToken)}`;
}

export function inviteTokenState(options = {}) {
  const hasInviteToken = Object.prototype.hasOwnProperty.call(options, "inviteToken");
  const hasHistoricalInviteToken = Object.prototype.hasOwnProperty.call(
    options,
    "historicalInviteToken"
  );
  const inviteToken = String(options.inviteToken || "").trim();
  const historicalInviteToken = String(options.historicalInviteToken || "").trim();
  return {
    inviteToken,
    historicalInviteToken,
    historicalCapabilitySupplied: hasHistoricalInviteToken,
    invalid:
      (hasInviteToken && hasHistoricalInviteToken) ||
      (hasHistoricalInviteToken && !historicalInviteToken)
  };
}

export function authPrincipalOf(auth = {}, authenticated = undefined) {
  const hasCredential = authenticated === undefined
    ? Boolean(String(auth?.token || "").trim())
    : typeof authenticated === "boolean"
      ? authenticated
      : Boolean(String(authenticated || "").trim());
  const userId = auth?.user?.id;
  const normalizedUserId = String(userId ?? "").trim();
  return hasCredential && normalizedUserId ? `user:${normalizedUserId}` : "guest";
}

export function identitySafeCreateFlow({ sessionId = "", sessionPurpose = "" } = {}) {
  return {
    store: null,
    script: null,
    role: null,
    roleOptions: [],
    selectedRoles: [],
    sessionId,
    sessionPurpose,
    startAt: "",
    startText: "",
    note: "",
    pendingHistoricalDraft: null,
    pinnedMessageText: "",
    joinPolicy: "review_required",
    joinPhoneRequired: true,
    npcJoinEnabled: true,
    cityVisible: true
  };
}

export function historicalInviteRecoveryAllowed({
  malformedInviteLink = false,
  sessionLoaded = false,
  organizerTokenMinted = false,
  historicalInviteToken = ""
} = {}) {
  if (malformedInviteLink) {
    return false;
  }
  const hasHistoricalCapability = Boolean(
    String(historicalInviteToken || "").trim()
  );
  return hasHistoricalCapability && (sessionLoaded || organizerTokenMinted);
}

export function sessionShareReady({
  sessionId,
  sessionLoadReady = false,
  invalidInviteLink = false,
  isHistorical = false,
  historicalInviteToken = "",
  accessScope = "",
  inviteToken = ""
} = {}) {
  if (invalidInviteLink) {
    return false;
  }
  if (!sessionId) {
    return true;
  }
  if (!sessionLoadReady) {
    return false;
  }
  if (isHistorical) {
    return Boolean(String(historicalInviteToken || "").trim());
  }
  if (accessScope === "member") {
    return Boolean(String(inviteToken || "").trim());
  }
  return true;
}

function nonNegativeRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

export function pageRequestSnapshot(state = {}) {
  return Object.freeze({
    pageActive: state.pageActive === true,
    pageGeneration: nonNegativeRevision(state.pageGeneration),
    authRevision: nonNegativeRevision(state.authRevision)
  });
}

export function pageRequestIsCurrent(state = {}, snapshot = {}) {
  return Boolean(
    state.pageActive === true &&
    snapshot.pageActive === true &&
    nonNegativeRevision(state.pageGeneration) === snapshot.pageGeneration &&
    nonNegativeRevision(state.authRevision) === snapshot.authRevision
  );
}

export function beginRoleSelectionOperation(state = {}) {
  if (
    state.roleSelectionSubmitting === true ||
    nonNegativeRevision(state.activeRoleSelectionOperationId) > 0
  ) {
    return null;
  }
  const previousOperationId = nonNegativeRevision(state.roleSelectionOperationId);
  const operationId = previousOperationId < Number.MAX_SAFE_INTEGER
    ? previousOperationId + 1
    : 1;
  return Object.freeze({
    operationId,
    sessionId: String(state.sessionId || ""),
    originPrincipal: String(state.currentAuthPrincipal || "guest"),
    entrySnapshot: pageRequestSnapshot(state)
  });
}

export function rebaseRoleSelectionOperation({
  operation,
  state = {},
  returnedPrincipal = "guest",
  actualPrincipal = "guest"
} = {}) {
  const entrySnapshot = operation?.entrySnapshot;
  const operationId = nonNegativeRevision(operation?.operationId);
  const currentPrincipal = String(state.currentAuthPrincipal || "guest");
  const samePageAndOwner = Boolean(
    operationId > 0 &&
    entrySnapshot?.pageActive === true &&
    state.pageActive === true &&
    nonNegativeRevision(state.pageGeneration) === entrySnapshot.pageGeneration &&
    String(state.sessionId || "") === String(operation?.sessionId || "") &&
    nonNegativeRevision(state.activeRoleSelectionOperationId) === operationId &&
    state.roleSelectionSubmitting === true
  );
  if (
    !samePageAndOwner ||
    returnedPrincipal !== actualPrincipal ||
    actualPrincipal !== currentPrincipal ||
    currentPrincipal === "guest"
  ) {
    return null;
  }

  const entryRevision = nonNegativeRevision(entrySnapshot.authRevision);
  const currentRevision = nonNegativeRevision(state.authRevision);
  const originPrincipal = String(operation.originPrincipal || "guest");
  const validIdentityTransition = originPrincipal === "guest"
    ? currentRevision === entryRevision + 1
    : currentPrincipal === originPrincipal && currentRevision === entryRevision;
  if (!validIdentityTransition) {
    return null;
  }

  return Object.freeze({
    ...operation,
    principal: currentPrincipal,
    snapshot: pageRequestSnapshot(state)
  });
}

export function roleSelectionOperationIsCurrent(state = {}, operation = {}) {
  const operationId = nonNegativeRevision(operation?.operationId);
  const snapshot = operation?.snapshot;
  return Boolean(
    operationId > 0 &&
    snapshot &&
    state.roleSelectionSubmitting === true &&
    nonNegativeRevision(state.activeRoleSelectionOperationId) === operationId &&
    String(state.sessionId || "") === String(operation.sessionId || "") &&
    String(operation.principal || "") === String(state.currentAuthPrincipal || "guest") &&
    pageRequestIsCurrent(state, snapshot)
  );
}

export function finishRoleSelectionOperation(state = {}, operationId = 0) {
  if (
    nonNegativeRevision(operationId) > 0 &&
    nonNegativeRevision(state.activeRoleSelectionOperationId) ===
      nonNegativeRevision(operationId)
  ) {
    return {
      activeRoleSelectionOperationId: 0,
      roleSelectionSubmitting: false
    };
  }
  return {
    activeRoleSelectionOperationId: nonNegativeRevision(
      state.activeRoleSelectionOperationId
    ),
    roleSelectionSubmitting: state.roleSelectionSubmitting === true
  };
}

export async function runLatestAuthRefresh({ capture, isCurrent, refresh } = {}) {
  if (
    typeof capture !== "function" ||
    typeof isCurrent !== "function" ||
    typeof refresh !== "function"
  ) {
    throw new TypeError("Latest auth refresh requires capture, freshness, and refresh callbacks");
  }
  const initial = capture();
  const pageGeneration = initial.pageGeneration;
  if (!initial.pageActive) {
    return false;
  }
  while (true) {
    const snapshot = capture();
    if (!snapshot.pageActive || snapshot.pageGeneration !== pageGeneration) {
      return false;
    }
    const result = await refresh(snapshot);
    if (isCurrent(snapshot)) {
      return result;
    }
    const latest = capture();
    if (!latest.pageActive || latest.pageGeneration !== pageGeneration) {
      return false;
    }
  }
}

export async function drainLatestAuthRefresh({
  capture,
  getActive,
  setActive,
  refresh
} = {}) {
  if (
    typeof capture !== "function" ||
    typeof getActive !== "function" ||
    typeof setActive !== "function" ||
    typeof refresh !== "function"
  ) {
    throw new TypeError("Auth refresh drain requires state, active-promise, and refresh callbacks");
  }
  const entry = capture();
  const pageGeneration = nonNegativeRevision(entry.pageGeneration);
  const sessionId = String(entry.sessionId || "");
  if (!entry.pageActive) {
    return false;
  }

  while (true) {
    const current = capture();
    if (
      !current.pageActive ||
      nonNegativeRevision(current.pageGeneration) !== pageGeneration ||
      String(current.sessionId || "") !== sessionId
    ) {
      return false;
    }

    let activePromise = getActive();
    if (!activePromise) {
      const snapshot = Object.freeze({
        ...pageRequestSnapshot(current),
        sessionId
      });
      activePromise = Promise.resolve().then(async () => ({
        snapshot,
        result: await refresh(snapshot)
      }));
      setActive(activePromise);
    }

    let outcome;
    try {
      outcome = await activePromise;
    } finally {
      if (getActive() === activePromise) {
        setActive(null);
      }
    }

    const latest = capture();
    if (
      !latest.pageActive ||
      nonNegativeRevision(latest.pageGeneration) !== pageGeneration ||
      String(latest.sessionId || "") !== sessionId
    ) {
      return false;
    }
    if (
      outcome?.snapshot?.pageActive === true &&
      outcome.snapshot.pageGeneration === nonNegativeRevision(latest.pageGeneration) &&
      outcome.snapshot.authRevision === nonNegativeRevision(latest.authRevision) &&
      String(outcome.snapshot.sessionId || "") === String(latest.sessionId || "")
    ) {
      return outcome.result;
    }
  }
}

export function historicalClaimRequest({ sessionId, inviteToken, role } = {}) {
  const normalizedSessionId = positiveIdentifier(sessionId);
  const normalizedInviteToken = String(inviteToken || "").trim();
  if (!normalizedSessionId || !normalizedInviteToken || !role || typeof role !== "object") {
    throw new TypeError("Historical claim requires a session, invitation, and role");
  }

  const seatId = role.boardType === "seat" ? positiveIdentifier(role.seatId) : null;
  const hasNpcRoleId = Object.prototype.hasOwnProperty.call(role, "npcRoleId");
  const explicitNpcRoleId = role.boardType === "npc" && hasNpcRoleId
    ? positiveIdentifier(role.npcRoleId)
    : null;
  const localNpcRoleId = role.boardType === "npc" ? positiveIdentifier(role.id) : null;
  const npcRoleId = hasNpcRoleId ? explicitNpcRoleId : localNpcRoleId;
  const hasConflictingTarget =
    (role.boardType === "seat" && role.npcRoleId !== undefined) ||
    (role.boardType === "npc" && role.seatId !== undefined) ||
    (role.boardType === "npc" &&
      hasNpcRoleId &&
      localNpcRoleId &&
      explicitNpcRoleId !== localNpcRoleId);
  if (hasConflictingTarget || Boolean(seatId) === Boolean(npcRoleId)) {
    throw new TypeError("Historical claim role must identify exactly one target");
  }

  return {
    url: `/api/sessions/${normalizedSessionId}/historical-claims`,
    method: "POST",
    data: {
      inviteToken: normalizedInviteToken,
      ...(seatId ? { seatId } : { npcRoleId })
    }
  };
}

export function historicalRoleClaimable({
  hasHistoricalToken,
  invalidInviteLink,
  malformedInviteLink,
  occupied,
  viewerHasRole,
  viewerIsOrganizer
} = {}) {
  return Boolean(
    hasHistoricalToken &&
    !invalidInviteLink &&
    !malformedInviteLink &&
    !occupied &&
    !viewerHasRole &&
    !viewerIsOrganizer
  );
}
