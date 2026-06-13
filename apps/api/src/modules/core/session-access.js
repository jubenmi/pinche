import { forbidden, notFound } from "../../http/errors.js";

export function isAdmin(user) {
  return user.roles.includes("system_admin");
}

export async function findSessionById(connection, sessionId) {
  const [rows] = await connection.query("SELECT * FROM sessions WHERE id = ?", [
    sessionId
  ]);
  return rows[0] || null;
}

export async function requireSessionOwner(connection, sessionId, user) {
  const session = await findSessionById(connection, sessionId);
  if (!session) {
    throw notFound("Session not found");
  }
  if (!isAdmin(user) && Number(session.organizer_user_id) !== Number(user.user.id)) {
    throw forbidden("Only the session organizer can perform this action");
  }
  return session;
}

export async function requireSessionParticipant(connection, sessionId, user) {
  const session = await findSessionById(connection, sessionId);
  if (!session) {
    throw notFound("Session not found");
  }
  if (isAdmin(user) || Number(session.organizer_user_id) === Number(user.user.id)) {
    return session;
  }

  const [rows] = await connection.query(
    `
      SELECT id
      FROM session_seats
      WHERE session_id = ?
        AND confirmed_user_id = ?
        AND status IN ('confirmed', 'locked')
      LIMIT 1
    `,
    [sessionId, user.user.id]
  );
  if (rows.length === 0) {
    throw forbidden("Only onboard players can use session messages");
  }
  return session;
}
