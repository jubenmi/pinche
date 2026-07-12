export function normalizeUserId(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : "";
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return "";
  }
  const normalized = value.replace(/^0+/, "");
  return normalized || "";
}

function sameUser(left, right) {
  const leftId = normalizeUserId(left);
  const rightId = normalizeUserId(right);
  return Boolean(leftId) && leftId === rightId;
}

export function shouldRequestRescheduleSubscription(
  wasConfirmedMember,
  joinResult,
  confirmedResult = "joined"
) {
  return !wasConfirmedMember && joinResult === confirmedResult;
}

export async function requestSubscriptionAfterConfirmedJoin(
  wasConfirmedMember,
  joinResult,
  confirmedResult,
  requestSubscription
) {
  if (!shouldRequestRescheduleSubscription(wasConfirmedMember, joinResult, confirmedResult)) {
    return null;
  }
  try {
    return await requestSubscription();
  } catch (error) {
    return null;
  }
}

export function isConfirmedSessionMember(session = {}, userId) {
  if (!userId) {
    return false;
  }
  const hasSeat = (session.seats || []).some(
    (seat) =>
      ["confirmed", "locked"].includes(seat.status) &&
      sameUser(seat.confirmed_user_id, userId)
  );
  if (hasSeat) {
    return true;
  }
  return (session.session_npc_roles || []).some(
    (role) => role.status === "active" && sameUser(role.bound_user_id, userId)
  );
}
