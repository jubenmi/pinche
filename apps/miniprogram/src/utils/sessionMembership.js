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

export function otherOnboardSeatMemberCount(session = {}) {
  const organizerId = normalizeUserId(session.organizer_user_id);
  const userIds = new Set();
  for (const seat of session.seats || []) {
    const userId = normalizeUserId(seat.confirmed_user_id);
    if (
      ["confirmed", "locked"].includes(seat.status) &&
      userId &&
      userId !== organizerId
    ) {
      userIds.add(userId);
    }
  }
  if (Object.prototype.hasOwnProperty.call(session, "seats")) {
    return userIds.size;
  }
  return Number(session.other_onboard_member_count || 0);
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

export function canRequestRescheduleReminder(session = {}, userId) {
  return (
    !sameUser(session.organizer_user_id, userId) &&
    isConfirmedSessionMember(session, userId)
  );
}
