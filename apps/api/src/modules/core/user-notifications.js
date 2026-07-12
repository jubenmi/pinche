import { notFound } from "../../http/errors.js";

export const USER_NOTIFICATION_TYPES = Object.freeze({
  SIGNUP_REVIEWED: "signup_reviewed",
  SESSION_RESCHEDULED: "session_rescheduled"
});

function parsePayload(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function insertUserNotification(connection, input) {
  await connection.query(
    `INSERT INTO user_notifications
      (user_id, type, session_id, title, payload_json, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [
      input.userId,
      input.type,
      input.sessionId,
      input.title,
      JSON.stringify(input.payload || {}),
      input.dedupeKey
    ]
  );
}

export function userNotificationResponse(row) {
  return {
    id: row.id,
    type: row.type,
    session_id: row.session_id,
    title: row.title,
    payload: parsePayload(row.payload_json),
    read_at: row.read_at,
    created_at: row.created_at
  };
}

export async function listMyNotifications(connection, userId, requestedLimit = 50) {
  const parsedLimit = Number.parseInt(requestedLimit, 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 50;
  const [rows] = await connection.query(
    `SELECT id, type, session_id, title, payload_json, read_at, created_at
     FROM user_notifications
     WHERE user_id = ?
     ORDER BY (read_at IS NULL) DESC, created_at DESC, id DESC
     LIMIT ${limit}`,
    [userId]
  );
  const [countRows] = await connection.query(
    `SELECT COUNT(*) AS unread_count
     FROM user_notifications
     WHERE user_id = ? AND read_at IS NULL`,
    [userId]
  );
  return {
    items: rows.map(userNotificationResponse),
    unread_count: Number(countRows[0]?.unread_count || 0)
  };
}

export async function markMyNotificationRead(connection, userId, notificationId) {
  await connection.query(
    `UPDATE user_notifications
     SET read_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
    [notificationId, userId]
  );
  const [rows] = await connection.query(
    `SELECT id, type, session_id, title, payload_json, read_at, created_at
     FROM user_notifications
     WHERE id = ? AND user_id = ?`,
    [notificationId, userId]
  );
  if (!rows[0]) {
    throw notFound("Notification not found");
  }
  return userNotificationResponse(rows[0]);
}
