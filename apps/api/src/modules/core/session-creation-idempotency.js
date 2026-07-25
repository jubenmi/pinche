import { badRequest } from "../../http/errors.js";

export function normalizeSessionCreationIdempotencyKey(body = {}) {
  const key = String(body.idempotencyKey || body.idempotency_key || "").trim();
  if (key.length > 128) {
    throw badRequest("idempotencyKey must be 128 characters or fewer");
  }
  return key;
}

async function findSessionByCreationKey(connection, organizerUserId, key) {
  const [rows] = await connection.query(
    `
      SELECT *
      FROM sessions
      WHERE organizer_user_id = ?
        AND creation_idempotency_key = ?
      LIMIT 1
    `,
    [organizerUserId, key]
  );
  return rows[0] || null;
}

export async function replaySessionCreation(
  connection,
  organizerUserId,
  key,
  createSession
) {
  if (!key) {
    return createSession();
  }
  const existing = await findSessionByCreationKey(connection, organizerUserId, key);
  if (existing) {
    return existing;
  }
  try {
    return await createSession();
  } catch (error) {
    if (error?.code !== "ER_DUP_ENTRY") {
      throw error;
    }
    const replayed = await findSessionByCreationKey(connection, organizerUserId, key);
    if (!replayed) {
      throw error;
    }
    return replayed;
  }
}
