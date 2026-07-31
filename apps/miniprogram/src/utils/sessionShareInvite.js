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
  occupied,
  viewerHasRole,
  viewerIsOrganizer
} = {}) {
  return Boolean(
    hasHistoricalToken &&
    !occupied &&
    !viewerHasRole &&
    !viewerIsOrganizer
  );
}
