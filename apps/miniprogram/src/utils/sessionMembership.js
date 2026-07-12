function sameUser(left, right) {
  const leftId = Number(left);
  const rightId = Number(right);
  return Boolean(left) && Boolean(right) && Number.isFinite(leftId) && leftId === rightId;
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
