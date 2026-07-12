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
