import crypto from "node:crypto";
import { config } from "../../config/env.js";
import { badRequest, notFound } from "../../http/errors.js";

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

function cursorSignature(payload) {
  return crypto
    .createHmac("sha256", config.sessionSecret)
    .update(payload)
    .digest("base64url");
}

export function encodeNotificationCursor(userId, row) {
  const payload = Buffer.from(
    JSON.stringify({
      owner: Number(userId),
      unread: row.read_at === null || row.read_at === undefined ? 1 : 0,
      created_at: row.created_at,
      id: Number(row.id)
    })
  ).toString("base64url");
  return `${payload}.${cursorSignature(payload)}`;
}

function decodeNotificationCursor(cursor, userId) {
  if (typeof cursor !== "string" || !cursor) {
    return null;
  }
  try {
    const [payload, signature, extra] = cursor.split(".");
    const expected = cursorSignature(payload || "");
    if (
      extra !== undefined ||
      !payload ||
      !signature ||
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      throw new Error("invalid signature");
    }
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      Number(decoded.owner) !== Number(userId) ||
      ![0, 1].includes(decoded.unread) ||
      typeof decoded.created_at !== "string" ||
      !decoded.created_at ||
      !Number.isSafeInteger(decoded.id) ||
      decoded.id < 1
    ) {
      throw new Error("invalid payload");
    }
    return decoded;
  } catch {
    throw badRequest("Invalid notification cursor");
  }
}

export async function listMyNotifications(connection, userId, filters = {}) {
  const normalizedFilters =
    filters && typeof filters === "object" ? filters : { limit: filters };
  const parsedLimit = Number.parseInt(normalizedFilters.limit, 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 50;
  const cursor = decodeNotificationCursor(normalizedFilters.cursor, userId);
  const cursorClause = cursor
    ? `AND (
         (read_at IS NULL) < ?
         OR ((read_at IS NULL) = ? AND created_at < ?)
         OR ((read_at IS NULL) = ? AND created_at = ? AND id < ?)
       )`
    : "";
  const values = [userId, userId];
  if (cursor) {
    values.push(
      cursor.unread,
      cursor.unread,
      cursor.created_at,
      cursor.unread,
      cursor.created_at,
      cursor.id
    );
  }
  values.push(limit + 1);
  const [rows] = await connection.query(
    `SELECT inbox.*, counts.unread_count
     FROM (
       SELECT COUNT(*) AS unread_count
       FROM user_notifications
       WHERE user_id = ? AND read_at IS NULL
     ) counts
     LEFT JOIN (
       SELECT id, type, session_id, title, payload_json, read_at, created_at
       FROM user_notifications
       WHERE user_id = ?
       ${cursorClause}
       ORDER BY (read_at IS NULL) DESC, created_at DESC, id DESC
       LIMIT ?
     ) inbox ON TRUE
     ORDER BY (inbox.read_at IS NULL) DESC, inbox.created_at DESC, inbox.id DESC`,
    values
  );
  const notificationRows = rows.filter((row) => row.id !== null && row.id !== undefined);
  const hasMore = notificationRows.length > limit;
  const pageRows = notificationRows.slice(0, limit);
  return {
    items: pageRows.map(userNotificationResponse),
    unread_count: Number(rows[0]?.unread_count || 0),
    next_cursor: hasMore ? encodeNotificationCursor(userId, pageRows.at(-1)) : null,
    has_more: hasMore
  };
}

export async function markMyNotificationRead(connection, userId, notificationId) {
  await connection.query(
    `UPDATE user_notifications
     SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
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
