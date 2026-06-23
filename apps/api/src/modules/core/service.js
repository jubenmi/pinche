import { withDatabaseConnection, withTransaction } from "../../db/mysql.js";
import {
  AppError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  phoneRequired
} from "../../http/errors.js";
import { ensureRole } from "../auth/users.js";
import { isAdmin, requireSessionOwner } from "./session-access.js";
import { runSessionExtensionHook } from "../extensions/registry.js";

function requireValue(body, key) {
  const value = body[key];
  if (value === undefined || value === null || value === "") {
    throw badRequest(`${key} is required`);
  }
  return value;
}

function intValue(value, fallback = 0) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw badRequest("Expected integer value");
  }
  return parsed;
}

function optionalText(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
}

function jsonText(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return Array.isArray(value) ? JSON.stringify(value) : String(value);
}

function jsonColumn(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "string") {
    try {
      JSON.parse(value);
    } catch (error) {
      throw badRequest("Expected valid JSON value");
    }
    return value;
  }

  return JSON.stringify(value);
}

function likeKeyword(value) {
  return `%${String(value).trim()}%`;
}

function limitValue(value, fallback = 50) {
  const parsed = intValue(value, fallback);
  return Math.min(Math.max(parsed, 1), 100);
}

function positiveId(value, label = "id") {
  const parsed = intValue(value);
  if (parsed <= 0) {
    throw badRequest(`${label} must be a positive integer`);
  }
  return parsed;
}

function uniquePositiveIds(values, label = "ids") {
  if (!Array.isArray(values)) {
    throw badRequest(`${label} must be an array`);
  }

  const seen = new Set();
  const ids = [];
  for (const value of values) {
    const id = positiveId(value, label);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

async function countRows(connection, sql, values) {
  const [rows] = await connection.query(sql, values);
  return Number(rows[0]?.count || rows[0]?.COUNT || 0);
}

function normalizeRequestType(value) {
  if (!["store", "script"].includes(value)) {
    throw badRequest("requestType must be store or script");
  }
  return value;
}

function normalizeEntityType(value) {
  if (!["store", "script"].includes(value)) {
    throw badRequest("entityType must be store or script");
  }
  return value;
}

function normalizeRoleGender(value) {
  const roleGender = String(value || "unlimited").trim();
  if (!["male", "female", "unlimited"].includes(roleGender)) {
    throw badRequest("roleGender must be male, female, or unlimited");
  }
  return roleGender;
}

function nonNegativeIntValue(value, label) {
  const parsed = intValue(value, 0);
  if (parsed < 0) {
    throw badRequest(`${label} cannot be negative`);
  }
  return parsed;
}

function parseRoleTemplate(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (error) {
      throw badRequest("defaultSeatTemplate must be a valid JSON array");
    }
  }

  throw badRequest("defaultSeatTemplate must be an array");
}

function normalizeRoleTemplateItem(role = {}, index = 0) {
  const name = String(
    role.name || role.roleName || role.role_name || `角色${index + 1}`
  ).trim();
  const description = String(
    role.description ||
      role.roleDescription ||
      role.role_description ||
      role.roleName ||
      role.role_name ||
      ""
  ).trim();

  return {
    ...(role.id ? { id: String(role.id) } : {}),
    name: name || `角色${index + 1}`,
    description,
    roleGender: normalizeRoleGender(role.roleGender || role.role_gender)
  };
}

function roleTemplateJson(value) {
  const parsed = parseRoleTemplate(value);
  if (parsed === null) {
    return null;
  }
  return JSON.stringify(parsed.map(normalizeRoleTemplateItem));
}

function assertPayable(basePrice, adjustment) {
  const payablePrice = basePrice + adjustment;
  if (payablePrice < 0) {
    throw badRequest("payable_price cannot be negative");
  }
  return payablePrice;
}

function requireVerifiedPhone(user) {
  if (!user?.user?.phoneVerifiedAt) {
    throw phoneRequired();
  }
}

const PUBLIC_TEXT_REPLACEMENTS = [
  ["恋陪位", "情感沉浸位"],
  ["恋陪", "沉浸"],
  ["爱D", "指定DM/NPC"],
  ["主陪位", "主线互动位"]
];
const PUBLIC_TEXT_RISK_WORDS = [
  "红包",
  "返现",
  "提现",
  "现金奖励",
  "分享奖励",
  "拉人奖励",
  "拉新奖励",
  "抽奖",
  "优先锁座",
  "现实陪伴",
  "线下陪伴",
  "联系方式",
  "手机号",
  "微信号",
  "加微信",
  "牵手",
  "小黑屋",
  "恋陪",
  "爱D"
];
const MESSAGE_TEXT_RISK_WORDS = [
  "红包",
  "返现",
  "提现",
  "现金奖励",
  "分享奖励",
  "拉人奖励",
  "拉新奖励",
  "抽奖",
  "收款码",
  "平台代收"
];
const MAX_SESSION_REVIEW_PHOTOS = 9;
const SESSION_REVIEW_PHOTO_PREFIX = "/uploads/session-reviews/";

function reviewRating(value) {
  const rating = intValue(value);
  if (rating < 1 || rating > 5) {
    throw badRequest("rating must be between 1 and 5");
  }
  return rating;
}

function reviewContent(value) {
  const content = optionalText(value);
  if (content && content.length > 500) {
    throw badRequest("content must be 500 characters or fewer");
  }
  assertPublicTextSafe("content", content);
  return content;
}

function assertSessionReviewPhotoUrls(photoUrls) {
  const urls = photoUrls === undefined ? [] : photoUrls;
  if (!Array.isArray(urls)) {
    throw badRequest("photoUrls must be an array");
  }
  if (urls.length > MAX_SESSION_REVIEW_PHOTOS) {
    throw badRequest(`photoUrls cannot contain more than ${MAX_SESSION_REVIEW_PHOTOS} photos`);
  }
  return urls.map((url) => {
    const text = String(url || "").trim();
    if (!text.startsWith(SESSION_REVIEW_PHOTO_PREFIX)) {
      throw badRequest("photoUrls must contain uploaded session review photos");
    }
    if (!/^\/uploads\/session-reviews\/[A-Za-z0-9._-]+$/.test(text)) {
      throw badRequest("photoUrls contains an invalid file path");
    }
    return text;
  });
}

function booleanValue(value, fallback = true) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (value === true || value === 1 || value === "1") {
    return true;
  }
  if (value === false || value === 0 || value === "0") {
    return false;
  }
  const text = String(value).trim().toLowerCase();
  if (["true", "yes", "on"].includes(text)) {
    return true;
  }
  if (["false", "no", "off"].includes(text)) {
    return false;
  }
  throw badRequest("Expected boolean value");
}

function sessionAlbumPhotoUrl(sessionId, userId, value) {
  const text = String(value || "").trim();
  const sessionIdText = String(positiveId(sessionId, "sessionId"));
  const userIdText = String(positiveId(userId, "userId"));
  const pattern = new RegExp(
    `^\\/uploads\\/session-album\\/album-${sessionIdText}-${userIdText}-\\d+-[a-f0-9]{16}\\.(?:jpg|jpeg|png)$`
  );
  if (!pattern.test(text)) {
    throw badRequest("photoUrl must contain an uploaded session album photo");
  }
  return text;
}

function albumPrivacy(row = {}) {
  return {
    allow_uploaded_visible: row.allow_uploaded_visible !== undefined
      ? Boolean(Number(row.allow_uploaded_visible))
      : true,
    allow_tagged_visible: row.allow_tagged_visible !== undefined
      ? Boolean(Number(row.allow_tagged_visible))
      : true
  };
}

function publicText(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return PUBLIC_TEXT_REPLACEMENTS.reduce(
    (text, [from, to]) => text.replaceAll(from, to),
    String(value)
  );
}

function sanitizePublicValue(item) {
  if (typeof item === "string") {
    return publicText(item);
  }
  if (Array.isArray(item)) {
    return item.map(sanitizePublicValue);
  }
  if (item && typeof item === "object") {
    return Object.fromEntries(
      Object.entries(item).map(([key, entryValue]) => [
        key,
        sanitizePublicValue(entryValue)
      ])
    );
  }
  return item;
}

function publicJsonText(value) {
  if (value === undefined || value === null || value === "") {
    return value;
  }
  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(sanitizePublicValue(value));
  }

  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(sanitizePublicValue(parsed));
  } catch (error) {
    return publicText(value);
  }
}

function publicScriptRow(row) {
  return {
    ...row,
    type_tags: publicJsonText(row.type_tags),
    summary_no_spoiler: publicText(row.summary_no_spoiler),
    default_seat_template_json: publicJsonText(row.default_seat_template_json)
  };
}

function publicTextRiskWord(value) {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  const text = String(value);
  const keyword = PUBLIC_TEXT_RISK_WORDS.find((word) => text.includes(word));
  if (keyword) {
    return keyword;
  }
  if (/(^|[^\d])1[3-9]\d{9}($|[^\d])/.test(text)) {
    return "手机号";
  }
  return "";
}

function assertPublicTextSafe(label, value) {
  const riskWord = publicTextRiskWord(value);
  if (riskWord) {
    throw badRequest(`${label} contains public risk text: ${riskWord}`);
  }
}

function assertMessageTextSafe(label, value) {
  if (value === undefined || value === null || value === "") {
    return;
  }
  const text = String(value);
  const riskWord = MESSAGE_TEXT_RISK_WORDS.find((word) => text.includes(word));
  if (riskWord) {
    throw badRequest(`${label} contains transaction risk text: ${riskWord}`);
  }
}

async function findById(connection, table, id) {
  const [rows] = await connection.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  return rows[0] || null;
}

async function selectInserted(connection, table, insertResult) {
  return findById(connection, table, insertResult.insertId);
}

async function updateAllowed(connection, table, id, body, fields) {
  const sets = [];
  const values = [];

  for (const [bodyKey, column] of fields) {
    if (body[bodyKey] !== undefined) {
      sets.push(`${column} = ?`);
      values.push(body[bodyKey]);
    }
  }

  if (sets.length === 0) {
    return findById(connection, table, id);
  }

  values.push(id);
  await connection.query(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`, values);
  return findById(connection, table, id);
}

async function requireSeatOwner(connection, seatId, user) {
  const [rows] = await connection.query(
    `
      SELECT seat.*, session.organizer_user_id
      FROM session_seats seat
      JOIN sessions session ON session.id = seat.session_id
      WHERE seat.id = ?
    `,
    [seatId]
  );
  const seat = rows[0];
  if (!seat) {
    throw notFound("Seat not found");
  }
  if (!isAdmin(user) && Number(seat.organizer_user_id) !== Number(user.user.id)) {
    throw forbidden("Only the session organizer can perform this action");
  }
  return seat;
}

async function requireSignupOwner(connection, signupId, user) {
  const [rows] = await connection.query(
    `
      SELECT signup.*, session.organizer_user_id
      FROM signups signup
      JOIN sessions session ON session.id = signup.session_id
      WHERE signup.id = ?
    `,
    [signupId]
  );
  const signup = rows[0];
  if (!signup) {
    throw notFound("Signup not found");
  }
  if (!isAdmin(user) && Number(signup.organizer_user_id) !== Number(user.user.id)) {
    throw forbidden("Only the session organizer can perform this action");
  }
  return signup;
}

async function lockSessionSeats(connection, sessionId) {
  await connection.query(
    `
      SELECT id
      FROM session_seats
      WHERE session_id = ?
      ORDER BY id
      FOR UPDATE
    `,
    [sessionId]
  );
}

async function releaseUserOtherConfirmedSeats(
  connection,
  sessionId,
  userId,
  seatId
) {
  const [lockedRows] = await connection.query(
    `
      SELECT id, name
      FROM session_seats
      WHERE session_id = ?
        AND confirmed_user_id = ?
        AND id <> ?
        AND status = 'locked'
      LIMIT 1
    `,
    [sessionId, userId, seatId]
  );
  if (lockedRows.length > 0) {
    throw conflict("User already has a locked seat in this session", {
      seatId: lockedRows[0].id,
      seatName: lockedRows[0].name
    });
  }

  const [confirmedRows] = await connection.query(
    `
      SELECT id, name
      FROM session_seats
      WHERE session_id = ?
        AND confirmed_user_id = ?
        AND id <> ?
        AND status = 'confirmed'
    `,
    [sessionId, userId, seatId]
  );
  if (confirmedRows.length === 0) {
    return [];
  }

  await connection.query(
    `
      UPDATE signups
      SET status = 'cancelled'
      WHERE user_id = ?
        AND status IN ('pending', 'approved')
        AND seat_id IN (
          SELECT id
          FROM session_seats
          WHERE session_id = ?
            AND confirmed_user_id = ?
            AND id <> ?
            AND status = 'confirmed'
        )
    `,
    [userId, sessionId, userId, seatId]
  );
  for (const confirmedRow of confirmedRows) {
    await clearPreStartReviewEligibilityForSeat(connection, confirmedRow.id);
  }
  await connection.query(
    `
      UPDATE session_seats
      SET status = 'open',
          confirmed_user_id = NULL
      WHERE session_id = ?
        AND confirmed_user_id = ?
        AND id <> ?
        AND status = 'confirmed'
    `,
    [sessionId, userId, seatId]
  );

  return confirmedRows;
}

function reviewWindowSql() {
  return `
    session.start_at <= CURRENT_TIMESTAMP
    AND (
      session.status <> 'cancelled'
      OR session.cancelled_at IS NULL
      OR session.cancelled_at >= session.start_at
    )
  `;
}

async function currentEligibleSignup(connection, sessionId, userId) {
  const [rows] = await connection.query(
    `
      SELECT
        signup.*,
        seat.name AS seat_name,
        seat.role_name AS seat_role_name,
        session.start_at,
        session.status AS session_status,
        session.cancelled_at
      FROM signups signup
      JOIN sessions session ON session.id = signup.session_id
      LEFT JOIN session_seats seat ON seat.id = signup.seat_id
      WHERE signup.session_id = ?
        AND signup.user_id = ?
        AND signup.review_eligible_at IS NOT NULL
        AND ${reviewWindowSql()}
      ORDER BY signup.review_eligible_at DESC, signup.id DESC
      LIMIT 1
    `,
    [sessionId, userId]
  );
  return rows[0] || null;
}

async function requireSessionAlbumOpen(connection, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  const [rows] = await connection.query(
    `
      SELECT session.*
      FROM sessions session
      WHERE session.id = ?
        AND ${reviewWindowSql()}
      LIMIT 1
    `,
    [id]
  );
  if (rows[0]) {
    return rows[0];
  }

  const session = await findById(connection, "sessions", id);
  if (!session) {
    throw notFound("Session not found");
  }
  throw forbidden("Session album opens after the session starts");
}

async function isSessionAlbumMember(connection, session, userId) {
  const id = Number(userId);
  if (!id) {
    return false;
  }
  if (
    Number(session.organizer_user_id) === id ||
    Number(session.dm_user_id || 0) === id ||
    Number(session.npc_user_id || 0) === id
  ) {
    return true;
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
    [session.id, id]
  );
  return rows.length > 0;
}

async function requireSessionAlbumMember(connection, session, user) {
  if (!(await isSessionAlbumMember(connection, session, user.user.id))) {
    throw forbidden("Only session members can use the session album");
  }
}

async function getAlbumPrivacy(connection, sessionId, userId) {
  const [rows] = await connection.query(
    `
      SELECT *
      FROM session_album_privacy
      WHERE session_id = ?
        AND user_id = ?
      LIMIT 1
    `,
    [sessionId, userId]
  );
  return albumPrivacy(rows[0] || {});
}

async function albumPrivacyMap(connection, sessionId, userIds) {
  const ids = [...new Set(userIds.map(Number).filter(Boolean))];
  const privacyByUser = new Map(ids.map((id) => [id, albumPrivacy()]));
  if (ids.length === 0) {
    return privacyByUser;
  }
  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `
      SELECT *
      FROM session_album_privacy
      WHERE session_id = ?
        AND user_id IN (${placeholders})
    `,
    [sessionId, ...ids]
  );
  for (const row of rows) {
    privacyByUser.set(Number(row.user_id), albumPrivacy(row));
  }
  return privacyByUser;
}

async function sessionAlbumPeople(connection, session) {
  const [seatRows] = await connection.query(
    `
      SELECT
        seat.id,
        seat.name,
        seat.role_name,
        seat.seat_type,
        seat.confirmed_user_id,
        user.nickname AS user_nickname,
        user.open_id AS user_open_id
      FROM session_seats seat
      LEFT JOIN users user ON user.id = seat.confirmed_user_id
      WHERE seat.session_id = ?
      ORDER BY seat.id
    `,
    [session.id]
  );

  const sessionUserIds = [
    session.dm_user_id,
    session.npc_user_id
  ]
    .map(Number)
    .filter(Boolean);
  const userNamesById = new Map();
  if (sessionUserIds.length > 0) {
    const placeholders = sessionUserIds.map(() => "?").join(", ");
    const [userRows] = await connection.query(
      `
        SELECT id, nickname, open_id
        FROM users
        WHERE id IN (${placeholders})
      `,
      sessionUserIds
    );
    for (const row of userRows) {
      userNamesById.set(Number(row.id), row.nickname || row.open_id || "");
    }
  }

  const people = [];
  const addPerson = (person) => {
    if (!person.key || people.some((item) => item.key === person.key)) {
      return;
    }
    people.push(person);
  };

  for (const seat of seatRows) {
    const label = seat.user_nickname || seat.role_name || seat.name || "车友";
    const note = [seat.name, seat.role_name].filter(Boolean).join(" · ") || "车友位";
    addPerson({
      key: `seat:${seat.id}`,
      tag_type: "seat",
      seat_id: Number(seat.id),
      user_id: seat.confirmed_user_id ? Number(seat.confirmed_user_id) : null,
      label,
      note
    });
  }

  if (session.dm_user_id || session.dm_name_snapshot) {
    addPerson({
      key: "dm:session",
      tag_type: "dm",
      seat_id: null,
      user_id: session.dm_user_id ? Number(session.dm_user_id) : null,
      label:
        session.dm_name_snapshot ||
        userNamesById.get(Number(session.dm_user_id)) ||
        "DM",
      note: "DM"
    });
  }

  if (session.npc_user_id || session.npc_name_snapshot) {
    addPerson({
      key: "npc:session",
      tag_type: "npc",
      seat_id: null,
      user_id: session.npc_user_id ? Number(session.npc_user_id) : null,
      label:
        session.npc_name_snapshot ||
        userNamesById.get(Number(session.npc_user_id)) ||
        "NPC",
      note: "NPC"
    });
  }

  return people;
}

function normalizeAlbumTagKeys(body = {}) {
  const raw = Array.isArray(body.tagKeys)
    ? body.tagKeys
    : Array.isArray(body.tags)
      ? body.tags.map((tag) => tag.key || tag.tagKey || tag.id || tag)
      : [];
  const seen = new Set();
  const keys = [];
  for (const item of raw) {
    const key = String(item || "").trim();
    if (!key || seen.has(key)) {
      continue;
    }
    if (!/^(seat:\d+|dm:session|npc:session)$/.test(key)) {
      throw badRequest("tags contains an invalid person key");
    }
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function tagsByPhotoId(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const photoId = Number(row.photo_id);
    const list = map.get(photoId) || [];
    list.push({
      id: Number(row.id),
      key: row.tag_type === "seat" && row.seat_id
        ? `seat:${row.seat_id}`
        : ["organizer", "dm", "npc"].includes(row.tag_type)
          ? `${row.tag_type}:session`
          : `${row.tag_type}:${row.id}`,
      tag_type: row.tag_type,
      seat_id: row.seat_id ? Number(row.seat_id) : null,
      user_id: row.user_id ? Number(row.user_id) : null,
      label: row.label
    });
    map.set(photoId, list);
  }
  return map;
}

async function albumTagsForPhotos(connection, photoIds) {
  if (photoIds.length === 0) {
    return new Map();
  }
  const placeholders = photoIds.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `
      SELECT *
      FROM session_album_photo_tags
      WHERE photo_id IN (${placeholders})
      ORDER BY photo_id, sort_order, id
    `,
    photoIds
  );
  return tagsByPhotoId(rows);
}

function isAlbumPhotoVisibleToUser(photo, tags, privacyByUser, userId) {
  const currentUserId = Number(userId);
  const uploaderUserId = Number(photo.uploader_user_id);
  if (uploaderUserId === currentUserId) {
    return true;
  }

  const taggedUserIds = tags.map((tag) => Number(tag.user_id || 0)).filter(Boolean);
  if (taggedUserIds.includes(currentUserId)) {
    return true;
  }
  if (tags.length === 0) {
    return false;
  }

  const uploaderPrivacy = privacyByUser.get(uploaderUserId) || albumPrivacy();
  if (!uploaderPrivacy.allow_uploaded_visible) {
    return false;
  }

  for (const taggedUserId of taggedUserIds) {
    const taggedPrivacy = privacyByUser.get(taggedUserId) || albumPrivacy();
    if (!taggedPrivacy.allow_tagged_visible) {
      return false;
    }
  }
  return true;
}

async function markSignupReviewEligible(connection, signupId) {
  await connection.query(
    `
      UPDATE signups
      SET review_eligible_at = COALESCE(review_eligible_at, CURRENT_TIMESTAMP)
      WHERE id = ?
    `,
    [signupId]
  );
}

async function clearPreStartReviewEligibilityForSeat(connection, seatId) {
  await connection.query(
    `
      UPDATE signups signup
      JOIN sessions session ON session.id = signup.session_id
      SET signup.review_eligible_at = NULL
      WHERE signup.seat_id = ?
        AND session.start_at > CURRENT_TIMESTAMP
    `,
    [seatId]
  );
}

async function clearPreStartReviewEligibilityForSession(connection, sessionId) {
  await connection.query(
    `
      UPDATE signups signup
      JOIN sessions session ON session.id = signup.session_id
      SET signup.review_eligible_at = NULL
      WHERE signup.session_id = ?
        AND session.start_at > CURRENT_TIMESTAMP
    `,
    [sessionId]
  );
}

export async function listActiveStores(filters = {}) {
  return withDatabaseConnection(async (connection) => {
    const where = ["status = 'active'"];
    const values = [];

    if (filters.keyword) {
      where.push("(name LIKE ? OR city LIKE ? OR district LIKE ?)");
      const keyword = likeKeyword(filters.keyword);
      values.push(keyword, keyword, keyword);
    }
    if (filters.city) {
      where.push("city = ?");
      values.push(String(filters.city));
    }

    const [rows] = await connection.query(
      `SELECT * FROM stores WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ${limitValue(filters.limit)} `,
      values
    );
    return rows;
  });
}

export async function listActiveScripts(filters = {}) {
  return withDatabaseConnection(async (connection) => {
    const where = ["scripts.status = 'active'"];
    const values = [];
    let from = "scripts";
    let select = "scripts.*";

    if (filters.storeId !== undefined && filters.storeId !== null && filters.storeId !== "") {
      from = "scripts INNER JOIN store_scripts ss ON ss.script_id = scripts.id";
      select = "scripts.*, ss.price_per_player";
      where.push("ss.store_id = ?");
      values.push(positiveId(filters.storeId, "storeId"));
    }

    if (filters.keyword) {
      where.push("(scripts.name LIKE ? OR scripts.type_tags LIKE ?)");
      const keyword = likeKeyword(filters.keyword);
      values.push(keyword, keyword);
    }

    const [rows] = await connection.query(
      `SELECT ${select} FROM ${from} WHERE ${where.join(" AND ")} ORDER BY scripts.id DESC LIMIT ${limitValue(filters.limit)} `,
      values
    );
    return rows.map(publicScriptRow);
  });
}

export async function listAdminStores(filters = {}) {
  return withDatabaseConnection(async (connection) => {
    const where = ["1 = 1"];
    const values = [];

    if (filters.status) {
      where.push("status = ?");
      values.push(String(filters.status));
    }
    if (filters.keyword) {
      where.push("(name LIKE ? OR city LIKE ? OR district LIKE ? OR address LIKE ?)");
      const keyword = likeKeyword(filters.keyword);
      values.push(keyword, keyword, keyword, keyword);
    }

    const [rows] = await connection.query(
      `SELECT * FROM stores WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ${limitValue(filters.limit)} `,
      values
    );
    return rows;
  });
}

export async function listAdminScripts(filters = {}) {
  return withDatabaseConnection(async (connection) => {
    const where = ["1 = 1"];
    const values = [];

    if (filters.status) {
      where.push("status = ?");
      values.push(String(filters.status));
    }
    if (filters.keyword) {
      where.push("(name LIKE ? OR type_tags LIKE ?)");
      const keyword = likeKeyword(filters.keyword);
      values.push(keyword, keyword);
    }

    const [rows] = await connection.query(
      `SELECT * FROM scripts WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ${limitValue(filters.limit)} `,
      values
    );
    return rows;
  });
}

function normalizeStoreScriptLinks(body = {}) {
  const sourceLinks =
    body.scriptLinks !== undefined
      ? body.scriptLinks
      : body.scripts !== undefined
        ? body.scripts
        : (body.scriptIds ?? []).map((scriptId) => ({ scriptId, pricePerPlayer: 0 }));

  if (!Array.isArray(sourceLinks)) {
    throw badRequest("scriptLinks must be an array");
  }

  const seen = new Set();
  const links = [];
  for (const sourceLink of sourceLinks) {
    const isObject = sourceLink && typeof sourceLink === "object";
    const scriptId = positiveId(
      isObject ? sourceLink.scriptId ?? sourceLink.id : sourceLink,
      "scriptId"
    );
    if (seen.has(scriptId)) {
      continue;
    }
    seen.add(scriptId);
    links.push({
      scriptId,
      pricePerPlayer: nonNegativeIntValue(
        isObject ? sourceLink.pricePerPlayer ?? sourceLink.price_per_player : 0,
        "pricePerPlayer"
      )
    });
  }

  return links;
}

export async function listStoreScripts(storeId) {
  const id = positiveId(storeId, "storeId");
  return withDatabaseConnection(async (connection) => {
    const store = await findById(connection, "stores", id);
    if (!store) {
      throw notFound("Store not found");
    }

    const [rows] = await connection.query(
      `
        SELECT scripts.*, store_scripts.price_per_player
        FROM store_scripts
          INNER JOIN scripts ON scripts.id = store_scripts.script_id
        WHERE store_scripts.store_id = ?
          AND scripts.status = 'active'
        ORDER BY scripts.id DESC
      `,
      [id]
    );
    return rows;
  });
}

export async function replaceStoreScripts(storeId, body = {}) {
  const id = positiveId(storeId, "storeId");
  const scriptLinks = normalizeStoreScriptLinks(body);
  const scriptIds = scriptLinks.map((scriptLink) => scriptLink.scriptId);

  return withTransaction(async (connection) => {
    const store = await findById(connection, "stores", id);
    if (!store) {
      throw notFound("Store not found");
    }

    if (scriptIds.length > 0) {
      const placeholders = scriptIds.map(() => "?").join(", ");
      const [rows] = await connection.query(
        `SELECT id FROM scripts WHERE id IN (${placeholders}) AND status = 'active'`,
        scriptIds
      );
      const existingIds = new Set(rows.map((row) => Number(row.id)));
      const missingIds = scriptIds.filter((scriptId) => !existingIds.has(scriptId));
      if (missingIds.length > 0) {
        throw badRequest(`Unknown or inactive scriptIds: ${missingIds.join(", ")}`);
      }
    }

    await connection.query("DELETE FROM store_scripts WHERE store_id = ?", [id]);

    if (scriptIds.length > 0) {
      const values = scriptLinks.flatMap((scriptLink) => [
        id,
        scriptLink.scriptId,
        scriptLink.pricePerPlayer
      ]);
      const placeholders = scriptLinks.map(() => "(?, ?, ?)").join(", ");
      await connection.query(
        `INSERT INTO store_scripts (store_id, script_id, price_per_player) VALUES ${placeholders}`,
        values
      );
    }

    return { storeId: id, scriptIds, scriptLinks };
  });
}

export async function createStore(user, body) {
  return withDatabaseConnection(async (connection) => {
    const [result] = await connection.query(
      `
        INSERT INTO stores
          (name, city, district, address, contact_note, status, claim_status, created_by_admin_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        requireValue(body, "name"),
        requireValue(body, "city"),
        optionalText(body.district),
        optionalText(body.address),
        optionalText(body.contactNote),
        body.status || "active",
        body.claimStatus || "unclaimed",
        user.user.id
      ]
    );
    return selectInserted(connection, "stores", result);
  });
}

export async function updateStore(id, body) {
  return withDatabaseConnection(async (connection) =>
    updateAllowed(connection, "stores", id, body, [
      ["name", "name"],
      ["city", "city"],
      ["district", "district"],
      ["address", "address"],
      ["contactNote", "contact_note"],
      ["status", "status"],
      ["claimStatus", "claim_status"]
    ])
  );
}

async function hardDeleteCatalogEntity(
  connection,
  deleteSql,
  id,
  referenceSql,
  label,
  cleanupSqls = []
) {
  const entityId = positiveId(id, `${label} id`);
  const references = await countRows(connection, referenceSql, [entityId]);
  if (references > 0) {
    throw new AppError(409, "RESOURCE_IN_USE", `${label} is used by existing sessions`, {
      sessionCount: references
    });
  }

  for (const cleanupSql of cleanupSqls) {
    await connection.query(cleanupSql, [entityId]);
  }

  const [result] = await connection.query(deleteSql, [entityId]);
  if (result.affectedRows === 0) {
    throw notFound(`${label} not found`);
  }

  return { id: entityId, deleted: true };
}

export async function deleteStore(id) {
  return withTransaction((connection) =>
    hardDeleteCatalogEntity(
      connection,
      "DELETE FROM stores WHERE id = ?",
      id,
      "SELECT COUNT(*) AS count FROM sessions WHERE store_id = ?",
      "Store",
      ["DELETE FROM store_scripts WHERE store_id = ?"]
    )
  );
}

export async function createScript(user, body) {
  return withDatabaseConnection(async (connection) => {
    const [result] = await connection.query(
      `
        INSERT INTO scripts
          (
            name, type_tags, player_count, summary_no_spoiler,
            default_seat_template_json, status, claim_status, created_by_admin_user_id
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        requireValue(body, "name"),
        jsonText(body.typeTags),
        intValue(body.playerCount, 0),
        optionalText(body.summaryNoSpoiler),
        roleTemplateJson(body.defaultSeatTemplate ?? body.defaultSeatTemplateJson),
        body.status || "active",
        body.claimStatus || "unclaimed",
        user.user.id
      ]
    );
    return selectInserted(connection, "scripts", result);
  });
}

export async function updateScript(id, body) {
  const normalized = {
    ...body,
    typeTags: body.typeTags === undefined ? undefined : jsonText(body.typeTags),
    defaultSeatTemplateJson:
      body.defaultSeatTemplate === undefined && body.defaultSeatTemplateJson === undefined
        ? undefined
        : roleTemplateJson(body.defaultSeatTemplate ?? body.defaultSeatTemplateJson),
    playerCount:
      body.playerCount === undefined ? undefined : intValue(body.playerCount, 0)
  };

  return withDatabaseConnection(async (connection) =>
    updateAllowed(connection, "scripts", id, normalized, [
      ["name", "name"],
      ["typeTags", "type_tags"],
      ["playerCount", "player_count"],
      ["summaryNoSpoiler", "summary_no_spoiler"],
      ["defaultSeatTemplateJson", "default_seat_template_json"],
      ["status", "status"],
      ["claimStatus", "claim_status"]
    ])
  );
}

export async function deleteScript(id) {
  return withTransaction((connection) =>
    hardDeleteCatalogEntity(
      connection,
      "DELETE FROM scripts WHERE id = ?",
      id,
      "SELECT COUNT(*) AS count FROM sessions WHERE script_id = ?",
      "Script",
      ["DELETE FROM store_scripts WHERE script_id = ?"]
    )
  );
}

export async function createCatalogRequest(user, body) {
  return withDatabaseConnection(async (connection) => {
    const [result] = await connection.query(
      `
        INSERT INTO catalog_requests
          (request_type, requested_by_user_id, name, city, district, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        normalizeRequestType(requireValue(body, "requestType")),
        user.user.id,
        requireValue(body, "name"),
        optionalText(body.city),
        optionalText(body.district),
        optionalText(body.description)
      ]
    );
    return selectInserted(connection, "catalog_requests", result);
  });
}

export async function listCatalogRequests(filters = {}) {
  return withDatabaseConnection(async (connection) => {
    const where = ["1 = 1"];
    const values = [];

    if (filters.status) {
      where.push("status = ?");
      values.push(String(filters.status));
    }
    if (filters.requestType) {
      where.push("request_type = ?");
      values.push(normalizeRequestType(filters.requestType));
    }
    if (filters.keyword) {
      where.push("(name LIKE ? OR city LIKE ? OR district LIKE ? OR description LIKE ?)");
      const keyword = likeKeyword(filters.keyword);
      values.push(keyword, keyword, keyword, keyword);
    }

    const [rows] = await connection.query(
      `SELECT * FROM catalog_requests WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ${limitValue(filters.limit)} `,
      values
    );
    return rows;
  });
}

export async function reviewCatalogRequest(admin, id, body) {
  const status = requireValue(body, "status");
  if (!["approved", "rejected"].includes(status)) {
    throw badRequest("status must be approved or rejected");
  }

  return withTransaction(async (connection) => {
    const [rows] = await connection.query(
      "SELECT * FROM catalog_requests WHERE id = ? FOR UPDATE",
      [id]
    );
    const request = rows[0];
    if (!request) {
      throw notFound("Catalog request not found");
    }

    let createdEntityId = request.created_entity_id;
    if (status === "approved" && !createdEntityId) {
      if (request.request_type === "store") {
        const [result] = await connection.query(
          `
            INSERT INTO stores
              (name, city, district, address, contact_note, created_by_admin_user_id)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            request.name,
            request.city || body.city || "北京",
            request.district || body.district || null,
            body.address || null,
            request.description,
            admin.user.id
          ]
        );
        createdEntityId = result.insertId;
      } else {
        const [result] = await connection.query(
          `
            INSERT INTO scripts
              (
                name, type_tags, player_count, summary_no_spoiler,
                default_seat_template_json, created_by_admin_user_id
              )
            VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            request.name,
            jsonText(body.typeTags),
            intValue(body.playerCount, 0),
            request.description,
            roleTemplateJson(body.defaultSeatTemplate ?? body.defaultSeatTemplateJson),
            admin.user.id
          ]
        );
        createdEntityId = result.insertId;
      }
    }

    await connection.query(
      `
        UPDATE catalog_requests
        SET status = ?,
            reviewed_by_admin_user_id = ?,
            review_note = ?,
            created_entity_id = ?,
            reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [status, admin.user.id, optionalText(body.reviewNote), createdEntityId, id]
    );

    return findById(connection, "catalog_requests", id);
  });
}

export async function upsertPerformerProfile(user, body) {
  return withTransaction(async (connection) => {
    await ensureRole(connection, user.user.id, "performer");
    await connection.query(
      `
        INSERT INTO performer_profiles (user_id, display_name, city, bio)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          display_name = VALUES(display_name),
          city = VALUES(city),
          bio = VALUES(bio),
          status = 'active'
      `,
      [
        user.user.id,
        requireValue(body, "displayName"),
        optionalText(body.city),
        optionalText(body.bio)
      ]
    );

    const [rows] = await connection.query(
      "SELECT * FROM performer_profiles WHERE user_id = ?",
      [user.user.id]
    );
    return rows[0];
  });
}

export async function createEntityClaim(user, body) {
  return withDatabaseConnection(async (connection) => {
    const [result] = await connection.query(
      `
        INSERT INTO entity_claims (entity_type, entity_id, requested_by_user_id, note)
        VALUES (?, ?, ?, ?)
      `,
      [
        normalizeEntityType(requireValue(body, "entityType")),
        intValue(requireValue(body, "entityId")),
        user.user.id,
        optionalText(body.note)
      ]
    );
    return selectInserted(connection, "entity_claims", result);
  });
}

export async function createSession(user, body) {
  requireVerifiedPhone(user);

  return withTransaction(async (connection) => {
    assertPublicTextSafe("dmNameSnapshot", body.dmNameSnapshot);
    assertPublicTextSafe("npcNameSnapshot", body.npcNameSnapshot);

    const store = await findById(connection, "stores", requireValue(body, "storeId"));
    const script = await findById(connection, "scripts", requireValue(body, "scriptId"));
    if (!store || store.status !== "active") {
      throw badRequest("Active store is required");
    }
    if (!script || script.status !== "active") {
      throw badRequest("Active script is required");
    }

    await ensureRole(connection, user.user.id, "organizer");

    const [result] = await connection.query(
      `
        INSERT INTO sessions
          (
            organizer_user_id, script_id, script_name_snapshot, store_id,
            store_name_snapshot, start_at, dm_user_id, dm_name_snapshot,
            npc_user_id, npc_name_snapshot, deposit_amount, visibility, note
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        user.user.id,
        script.id,
        script.name,
        store.id,
        store.name,
        requireValue(body, "startAt"),
        body.dmUserId || null,
        optionalText(body.dmNameSnapshot),
        body.npcUserId || null,
        optionalText(body.npcNameSnapshot),
        intValue(body.depositAmount, 0),
        body.visibility || "share_only",
        optionalText(body.note)
      ]
    );

    const session = await findById(connection, "sessions", result.insertId);
    await runSessionExtensionHook("afterSessionCreated", {
      connection,
      session,
      pinnedMessageText: body.pinnedMessageText
    });
    return session;
  });
}

export async function getSession(id) {
  return withDatabaseConnection(async (connection) => {
    const session = await findById(connection, "sessions", id);
    if (!session) {
      throw notFound("Session not found");
    }

    const [seats] = await connection.query(
      "SELECT * FROM session_seats WHERE session_id = ? ORDER BY id",
      [id]
    );
    const { note, cancelled_by_user_id: _cancelledByUserId, ...publicSession } = session;
    return { ...publicSession, seats };
  });
}

export async function getSessionShareStats(sessionId) {
  return withDatabaseConnection(async (connection) => {
    const session = await findById(connection, "sessions", sessionId);
    if (!session) {
      throw notFound("Session not found");
    }

    const [eventRows] = await connection.query(
      `
        SELECT
          SUM(CASE WHEN event_type = 'view' THEN 1 ELSE 0 END) AS view_count,
          SUM(CASE WHEN event_type = 'convert' THEN 1 ELSE 0 END) AS convert_count,
          COUNT(DISTINCT CASE WHEN converted_signup_id IS NOT NULL THEN converted_signup_id END) AS converted_signup_count
        FROM share_events
        WHERE session_id = ?
      `,
      [sessionId]
    );
    const [signupRows] = await connection.query(
      `
        SELECT
          COUNT(*) AS signup_count,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_signup_count,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved_signup_count
        FROM signups
        WHERE session_id = ?
      `,
      [sessionId]
    );
    const [seatRows] = await connection.query(
      `
        SELECT
          seat.id,
          seat.name,
          seat.status,
          COALESCE(event_stats.view_count, 0) AS view_count,
          COALESCE(event_stats.convert_count, 0) AS convert_count,
          COALESCE(signup_stats.signup_count, 0) AS signup_count
        FROM session_seats seat
        LEFT JOIN (
          SELECT
            seat_id,
            SUM(CASE WHEN event_type = 'view' THEN 1 ELSE 0 END) AS view_count,
            SUM(CASE WHEN event_type = 'convert' THEN 1 ELSE 0 END) AS convert_count
          FROM share_events
          WHERE session_id = ?
          GROUP BY seat_id
        ) event_stats ON event_stats.seat_id = seat.id
        LEFT JOIN (
          SELECT seat_id, COUNT(*) AS signup_count
          FROM signups
          WHERE session_id = ?
          GROUP BY seat_id
        ) signup_stats ON signup_stats.seat_id = seat.id
        WHERE seat.session_id = ?
        ORDER BY seat.id
      `,
      [sessionId, sessionId, sessionId]
    );

    const eventStats = eventRows[0] || {};
    const signupStats = signupRows[0] || {};

    return {
      session_id: Number(sessionId),
      view_count: Number(eventStats.view_count || 0),
      convert_count: Number(eventStats.convert_count || 0),
      converted_signup_count: Number(eventStats.converted_signup_count || 0),
      signup_count: Number(signupStats.signup_count || 0),
      pending_signup_count: Number(signupStats.pending_signup_count || 0),
      approved_signup_count: Number(signupStats.approved_signup_count || 0),
      seats: seatRows.map((seat) => ({
        ...seat,
        view_count: Number(seat.view_count || 0),
        convert_count: Number(seat.convert_count || 0),
        signup_count: Number(seat.signup_count || 0)
      }))
    };
  });
}

export async function listMySessions(user, filters = {}) {
  return withDatabaseConnection(async (connection) => {
    const where = [
      "session.organizer_user_id = ?",
      "session.organizer_hidden_at IS NULL"
    ];
    const values = [user.user.id];

    if (filters.status) {
      where.push("session.status = ?");
      values.push(String(filters.status));
    }

    const [rows] = await connection.query(
      `
        SELECT
          session.*,
          COUNT(DISTINCT seat.id) AS seat_count,
          COUNT(DISTINCT signup.id) AS signup_count,
          COUNT(DISTINCT CASE WHEN signup.status = 'pending' THEN signup.id END) AS pending_signup_count
        FROM sessions session
        LEFT JOIN session_seats seat ON seat.session_id = session.id
        LEFT JOIN signups signup ON signup.session_id = session.id
        WHERE ${where.join(" AND ")}
        GROUP BY session.id
        ORDER BY session.start_at DESC, session.id DESC
        LIMIT ${limitValue(filters.limit)}
      `,
      values
    );
    return rows;
  });
}

export async function hideMyOrganizedSession(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withDatabaseConnection(async (connection) => {
    const session = await findById(connection, "sessions", id);
    if (!session) {
      throw notFound("Session not found");
    }
    if (Number(session.organizer_user_id) !== Number(user.user.id)) {
      throw forbidden("Only the session organizer can hide this session membership");
    }
    await connection.query(
      "UPDATE sessions SET organizer_hidden_at = CURRENT_TIMESTAMP WHERE id = ?",
      [id]
    );
    return findById(connection, "sessions", id);
  });
}

async function sessionOrganizerCandidates(connection, session, excludeUserId = null) {
  const excluded = Number(excludeUserId || 0);
  const seen = new Set();
  const candidates = [];

  function addCandidate(candidate) {
    const userId = Number(candidate.user_id || 0);
    if (!userId || userId === excluded || seen.has(userId)) {
      return;
    }
    seen.add(userId);
    candidates.push({
      ...candidate,
      user_id: userId
    });
  }

  const [seatRows] = await connection.query(
    `
      SELECT
        confirmed_user_id AS user_id,
        id AS seat_id,
        name,
        role_name
      FROM session_seats
      WHERE session_id = ?
        AND confirmed_user_id IS NOT NULL
        AND status IN ('confirmed', 'locked')
      ORDER BY id
    `,
    [session.id]
  );
  for (const seat of seatRows) {
    addCandidate({
      user_id: seat.user_id,
      source: "seat",
      label: seat.name || seat.role_name || "车友",
      seat_id: seat.seat_id
    });
  }

  addCandidate({
    user_id: session.npc_user_id,
    source: "npc",
    label: session.npc_name_snapshot || "NPC",
    seat_id: null
  });
  addCandidate({
    user_id: session.dm_user_id,
    source: "dm",
    label: session.dm_name_snapshot || "DM",
    seat_id: null
  });

  return candidates;
}

async function findSessionForOrganizerChange(connection, sessionId) {
  const [rows] = await connection.query("SELECT * FROM sessions WHERE id = ? FOR UPDATE", [
    sessionId
  ]);
  return rows[0] || null;
}

async function updateSessionOrganizer(connection, sessionId, targetUserId) {
  await ensureRole(connection, targetUserId, "organizer");
  await connection.query(
    `
      UPDATE sessions
      SET organizer_user_id = ?,
          organizer_hidden_at = NULL
      WHERE id = ?
    `,
    [targetUserId, sessionId]
  );
  return findById(connection, "sessions", sessionId);
}

export async function transferSessionOrganizer(user, sessionId, body = {}) {
  const id = positiveId(sessionId, "sessionId");
  const targetUserId = positiveId(
    body.targetUserId ?? body.target_user_id,
    "targetUserId"
  );

  return withTransaction(async (connection) => {
    const session = await findSessionForOrganizerChange(connection, id);
    if (!session) {
      throw notFound("Session not found");
    }
    if (!isAdmin(user) && Number(session.organizer_user_id) !== Number(user.user.id)) {
      throw forbidden("Only the session organizer can transfer this session");
    }
    if (Number(session.organizer_user_id) === targetUserId) {
      throw badRequest("targetUserId is already the session organizer");
    }

    const candidates = await sessionOrganizerCandidates(connection, session);
    if (!candidates.some((candidate) => candidate.user_id === targetUserId)) {
      throw forbidden("Only onboard session members can become organizer");
    }

    return updateSessionOrganizer(connection, id, targetUserId);
  });
}

export async function leaveSessionOrganizer(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");

  return withTransaction(async (connection) => {
    const session = await findSessionForOrganizerChange(connection, id);
    if (!session) {
      throw notFound("Session not found");
    }
    if (Number(session.organizer_user_id) !== Number(user.user.id)) {
      throw forbidden("Only the current session organizer can leave as organizer");
    }

    const candidates = await sessionOrganizerCandidates(connection, session, user.user.id);
    if (candidates.length === 0) {
      throw conflict("No onboard session member can become organizer");
    }

    return updateSessionOrganizer(connection, id, candidates[0].user_id);
  });
}

export async function relinkMySessionMembership(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withTransaction(async (connection) => {
    const session = await findById(connection, "sessions", id);
    if (!session) {
      throw notFound("Session not found");
    }

    const organizerRelinked = Number(session.organizer_user_id) === Number(user.user.id);
    if (organizerRelinked) {
      await connection.query(
        "UPDATE sessions SET organizer_hidden_at = NULL WHERE id = ?",
        [id]
      );
    }

    const [signupRows] = await connection.query(
      `
        SELECT id
        FROM signups
        WHERE session_id = ?
          AND user_id = ?
      `,
      [id, user.user.id]
    );
    const signupRelinked = signupRows.length > 0;
    if (signupRelinked) {
      await connection.query(
        `
          UPDATE signups
          SET user_hidden_at = NULL
          WHERE session_id = ?
            AND user_id = ?
        `,
        [id, user.user.id]
      );
    }

    if (!organizerRelinked && !signupRelinked) {
      throw forbidden("Only existing session members can relink this session");
    }

    return {
      session_id: id,
      organizer_relinked: organizerRelinked,
      signup_relinked: signupRelinked
    };
  });
}

export async function updateSession(user, id, body) {
  return withDatabaseConnection(async (connection) => {
    await requireSessionOwner(connection, id, user);
    assertPublicTextSafe("dmNameSnapshot", body.dmNameSnapshot);
    assertPublicTextSafe("npcNameSnapshot", body.npcNameSnapshot);
    return updateAllowed(connection, "sessions", id, body, [
      ["startAt", "start_at"],
      ["dmUserId", "dm_user_id"],
      ["dmNameSnapshot", "dm_name_snapshot"],
      ["npcUserId", "npc_user_id"],
      ["npcNameSnapshot", "npc_name_snapshot"],
      ["depositAmount", "deposit_amount"],
      ["visibility", "visibility"],
      ["note", "note"],
      ["status", "status"]
    ]);
  });
}

export async function createSeat(user, sessionId, body) {
  return withDatabaseConnection(async (connection) => {
    await requireSessionOwner(connection, sessionId, user);
    assertPublicTextSafe("seatName", body.name);
    assertPublicTextSafe("roleName", body.roleName);
    const basePrice = intValue(body.basePrice, 0);
    const adjustment = intValue(body.adjustment, 0);
    const payablePrice = assertPayable(basePrice, adjustment);

    const [result] = await connection.query(
      `
        INSERT INTO session_seats
          (
            session_id, name, seat_type, role_name, role_gender,
            base_price, adjustment, payable_price
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        sessionId,
        requireValue(body, "name"),
        body.seatType || "normal",
        optionalText(body.roleName),
        normalizeRoleGender(body.roleGender),
        basePrice,
        adjustment,
        payablePrice
      ]
    );
    return selectInserted(connection, "session_seats", result);
  });
}

export async function updateSeat(user, seatId, body) {
  return withDatabaseConnection(async (connection) => {
    const current = await requireSeatOwner(connection, seatId, user);
    assertPublicTextSafe("seatName", body.name);
    assertPublicTextSafe("roleName", body.roleName);
    const basePrice =
      body.basePrice === undefined ? current.base_price : intValue(body.basePrice, 0);
    const adjustment =
      body.adjustment === undefined ? current.adjustment : intValue(body.adjustment, 0);
    const payablePrice = assertPayable(basePrice, adjustment);

    return updateAllowed(
      connection,
      "session_seats",
      seatId,
      {
        ...body,
        basePrice,
        adjustment,
        payablePrice,
        roleGender:
          body.roleGender === undefined ? undefined : normalizeRoleGender(body.roleGender)
      },
      [
        ["name", "name"],
        ["seatType", "seat_type"],
        ["roleName", "role_name"],
        ["roleGender", "role_gender"],
        ["basePrice", "base_price"],
        ["adjustment", "adjustment"],
        ["payablePrice", "payable_price"],
        ["status", "status"]
      ]
    );
  });
}

export async function publishSession(user, sessionId) {
  return withTransaction(async (connection) => {
    await requireSessionOwner(connection, sessionId, user);
    const [seats] = await connection.query(
      "SELECT * FROM session_seats WHERE session_id = ? FOR UPDATE",
      [sessionId]
    );
    if (seats.length === 0) {
      throw badRequest("At least one seat is required before publish");
    }

    const adjustmentSum = seats.reduce((sum, seat) => sum + Number(seat.adjustment), 0);
    if (adjustmentSum !== 0) {
      throw badRequest("Seat adjustments must sum to 0");
    }

    const negativeSeat = seats.find((seat) => Number(seat.payable_price) < 0);
    if (negativeSeat) {
      throw badRequest("Seat payable price cannot be negative");
    }

    await connection.query(
      "UPDATE sessions SET status = 'recruiting' WHERE id = ?",
      [sessionId]
    );
    return findById(connection, "sessions", sessionId);
  });
}

export async function createSignup(user, body) {
  return withTransaction(async (connection) => {
    const seatId = requireValue(body, "seatId");
    const [rows] = await connection.query(
      `
        SELECT seat.*, session.status AS session_status
        FROM session_seats seat
        JOIN sessions session ON session.id = seat.session_id
        WHERE seat.id = ?
        FOR UPDATE
      `,
      [seatId]
    );
    const seat = rows[0];
    if (!seat) {
      throw notFound("Seat not found");
    }
    if (seat.session_status !== "recruiting") {
      throw badRequest("Session is not recruiting");
    }
    if (["confirmed", "locked", "cancelled"].includes(seat.status)) {
      throw conflict("Seat is not open for signup");
    }

    const [result] = await connection.query(
      `
        INSERT INTO signups (session_id, seat_id, user_id, contact_text, note)
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        seat.session_id,
        seat.id,
        user.user.id,
        optionalText(body.contactText),
        optionalText(body.note)
      ]
    );

    if (seat.status === "open") {
      await connection.query("UPDATE session_seats SET status = 'applied' WHERE id = ?", [
        seat.id
      ]);
    }

    return findById(connection, "signups", result.insertId);
  });
}

export async function claimSessionSeat(user, seatId, body = {}) {
  requireVerifiedPhone(user);

  return withTransaction(async (connection) => {
    const [seatRefs] = await connection.query(
      "SELECT session_id FROM session_seats WHERE id = ?",
      [seatId]
    );
    const seatRef = seatRefs[0];
    if (!seatRef) {
      throw notFound("Seat not found");
    }

    await lockSessionSeats(connection, seatRef.session_id);

    const [rows] = await connection.query(
      `
        SELECT
          seat.*,
          session.status AS session_status,
          (session.start_at <= CURRENT_TIMESTAMP) AS session_started
        FROM session_seats seat
        JOIN sessions session ON session.id = seat.session_id
        WHERE seat.id = ?
      `,
      [seatId]
    );
    const seat = rows[0];
    if (!seat) {
      throw notFound("Seat not found");
    }
    const canClaimStartedOpenSeat =
      seat.session_status === "locked" &&
      Number(seat.session_started || 0) === 1 &&
      seat.status === "open";
    const isCurrentUserSeat =
      seat.confirmed_user_id &&
      Number(seat.confirmed_user_id) === Number(user.user.id);
    if (
      seat.session_status !== "recruiting" &&
      !canClaimStartedOpenSeat &&
      !isCurrentUserSeat
    ) {
      throw badRequest("Session is not recruiting");
    }
    if (seat.status === "cancelled") {
      throw conflict("Seat is not open for claim");
    }
    if (
      seat.confirmed_user_id &&
      Number(seat.confirmed_user_id) !== Number(user.user.id)
    ) {
      throw conflict("Seat already has a confirmed user");
    }
    if (seat.status === "locked") {
      throw conflict("Seat is locked");
    }
    await releaseUserOtherConfirmedSeats(
      connection,
      seat.session_id,
      user.user.id,
      seat.id
    );

    await connection.query(
      `
        INSERT INTO signups
          (session_id, seat_id, user_id, contact_text, note, status, review_eligible_at)
        VALUES (?, ?, ?, ?, ?, 'approved', CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          status = 'approved',
          contact_text = VALUES(contact_text),
          note = VALUES(note),
          review_eligible_at = COALESCE(review_eligible_at, CURRENT_TIMESTAMP)
      `,
      [
        seat.session_id,
        seat.id,
        user.user.id,
        optionalText(body.contactText),
        optionalText(body.note)
      ]
    );
    await connection.query(
      `
        UPDATE signups
        SET status = 'rejected'
        WHERE seat_id = ?
          AND user_id <> ?
          AND status = 'pending'
      `,
      [seat.id, user.user.id]
    );
    await connection.query(
      `
        UPDATE session_seats
        SET status = 'confirmed',
            confirmed_user_id = ?
        WHERE id = ?
      `,
      [user.user.id, seat.id]
    );

    return findById(connection, "session_seats", seat.id);
  });
}

export async function listMySignups(user) {
  return withDatabaseConnection(async (connection) => {
    const [rows] = await connection.query(
      `
        SELECT
          signup.*,
          session.script_name_snapshot,
          session.store_name_snapshot,
          session.start_at,
          session.status AS session_status,
          session.cancelled_at,
          seat.name AS seat_name,
          seat.role_name AS seat_role_name,
          seat.status AS seat_status,
          EXISTS (
            SELECT 1
            FROM session_reviews review
            WHERE review.session_id = signup.session_id
              AND review.user_id = signup.user_id
              AND review.status = 'active'
          ) AS has_review,
          (
            signup.review_eligible_at IS NOT NULL
            AND ${reviewWindowSql()}
          ) AS can_review
        FROM signups signup
        JOIN sessions session ON session.id = signup.session_id
        LEFT JOIN session_seats seat ON seat.id = signup.seat_id
        WHERE signup.user_id = ?
          AND signup.user_hidden_at IS NULL
        ORDER BY session.start_at DESC, signup.id DESC
      `,
      [user.user.id]
    );
    return rows.map((row) => ({
      ...row,
      can_review: Boolean(row.can_review),
      has_review: Boolean(row.has_review)
    }));
  });
}

export async function hideMySignup(user, signupId) {
  const id = positiveId(signupId, "signupId");
  return withDatabaseConnection(async (connection) => {
    const signup = await findById(connection, "signups", id);
    if (!signup) {
      throw notFound("Signup not found");
    }
    if (Number(signup.user_id) !== Number(user.user.id)) {
      throw forbidden("Only the signup user can hide this session membership");
    }

    await connection.query(
      "UPDATE signups SET user_hidden_at = CURRENT_TIMESTAMP WHERE id = ?",
      [id]
    );

    return {
      id,
      session_id: Number(signup.session_id),
      hidden: true
    };
  });
}

export async function listSessionSignups(user, sessionId) {
  return withDatabaseConnection(async (connection) => {
    await requireSessionOwner(connection, sessionId, user);
    const [rows] = await connection.query(
      "SELECT * FROM signups WHERE session_id = ? ORDER BY id DESC",
      [sessionId]
    );
    return rows;
  });
}

export async function approveSignup(user, signupId) {
  return withTransaction(async (connection) => {
    const signup = await requireSignupOwner(connection, signupId, user);
    if (signup.status !== "pending") {
      throw badRequest("Only pending signup can be approved");
    }

    await lockSessionSeats(connection, signup.session_id);

    const [seatRows] = await connection.query(
      "SELECT * FROM session_seats WHERE id = ?",
      [signup.seat_id]
    );
    const seat = seatRows[0];
    if (!seat) {
      throw notFound("Seat not found");
    }
    if (seat.confirmed_user_id && Number(seat.confirmed_user_id) !== Number(signup.user_id)) {
      throw conflict("Seat already has a confirmed user");
    }
    await releaseUserOtherConfirmedSeats(
      connection,
      signup.session_id,
      signup.user_id,
      signup.seat_id
    );

    await connection.query(
      `
        UPDATE signups
        SET status = 'rejected'
        WHERE seat_id = ? AND id <> ? AND status = 'pending'
      `,
      [signup.seat_id, signupId]
    );
    await connection.query("UPDATE signups SET status = 'approved' WHERE id = ?", [
      signupId
    ]);
    await markSignupReviewEligible(connection, signupId);
    await connection.query(
      `
        UPDATE session_seats
        SET status = 'confirmed', confirmed_user_id = ?
        WHERE id = ?
      `,
      [signup.user_id, signup.seat_id]
    );

    return findById(connection, "signups", signupId);
  });
}

export async function rejectSignup(user, signupId) {
  return withTransaction(async (connection) => {
    const signup = await requireSignupOwner(connection, signupId, user);
    await connection.query("UPDATE signups SET status = 'rejected' WHERE id = ?", [
      signupId
    ]);

    const [activeRows] = await connection.query(
      `
        SELECT COUNT(*) AS active_count
        FROM signups
        WHERE seat_id = ? AND status IN ('pending', 'approved')
      `,
      [signup.seat_id]
    );
    if (Number(activeRows[0]?.active_count || 0) === 0) {
      await connection.query(
        `
          UPDATE session_seats
          SET status = 'open'
          WHERE id = ? AND status = 'applied'
        `,
        [signup.seat_id]
      );
    }

    return findById(connection, "signups", signupId);
  });
}

export async function updateDeposit(user, signupId, body) {
  const status = requireValue(body, "depositStatus");
  if (!["unpaid", "pending_confirm", "confirmed", "refunded"].includes(status)) {
    throw badRequest("Invalid depositStatus");
  }

  return withDatabaseConnection(async (connection) => {
    await requireSignupOwner(connection, signupId, user);
    await connection.query("UPDATE signups SET deposit_status = ? WHERE id = ?", [
      status,
      signupId
    ]);
    return findById(connection, "signups", signupId);
  });
}

export async function lockSeat(user, seatId) {
  return withTransaction(async (connection) => {
    const seat = await requireSeatOwner(connection, seatId, user);
    if (seat.status !== "confirmed") {
      throw badRequest("Only confirmed seat can be locked");
    }

    await connection.query("UPDATE session_seats SET status = 'locked' WHERE id = ?", [
      seatId
    ]);
    return findById(connection, "session_seats", seatId);
  });
}

export async function kickSessionSeat(user, seatId, body = {}) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query(
      `
        SELECT seat.*, session.organizer_user_id, session.status AS session_status
        FROM session_seats seat
        JOIN sessions session ON session.id = seat.session_id
        WHERE seat.id = ?
        FOR UPDATE
      `,
      [seatId]
    );
    const seat = rows[0];
    if (!seat) {
      throw notFound("Seat not found");
    }
    if (!isAdmin(user) && Number(seat.organizer_user_id) !== Number(user.user.id)) {
      throw forbidden("Only the session organizer can perform this action");
    }

    await connection.query(
      `
        UPDATE signups
        SET status = 'cancelled'
        WHERE seat_id = ? AND status IN ('pending', 'approved')
      `,
      [seatId]
    );
    await clearPreStartReviewEligibilityForSeat(connection, seatId);
    const nextSeatStatus = seat.session_status === "cancelled" ? "cancelled" : "open";
    await connection.query(
      `
        UPDATE session_seats
        SET status = ?,
            confirmed_user_id = NULL
        WHERE id = ?
      `,
      [nextSeatStatus, seatId]
    );

    const reason = optionalText(body.reason);
    const content = reason
      ? `车头已释放「${seat.name}」：${reason}`
      : `车头已释放「${seat.name}」`;
    assertMessageTextSafe("reason", reason);
    await runSessionExtensionHook("afterSessionSeatKicked", {
      connection,
      sessionId: seat.session_id,
      senderUserId: user.user.id,
      content
    });

    return findById(connection, "session_seats", seatId);
  });
}

export async function cancelSession(user, sessionId, body = {}) {
  return withTransaction(async (connection) => {
    const session = await requireSessionOwner(connection, sessionId, user);
    if (session.status === "cancelled") {
      return session;
    }

    const reason = optionalText(body.reason);
    assertMessageTextSafe("reason", reason);
    await connection.query(
      `
        UPDATE sessions
        SET status = 'cancelled',
            cancelled_by_user_id = ?,
            cancelled_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [user.user.id, sessionId]
    );
    await connection.query(
      "UPDATE session_seats SET status = 'cancelled' WHERE session_id = ?",
      [sessionId]
    );
    await connection.query(
      `
        UPDATE signups
        SET status = 'cancelled'
        WHERE session_id = ? AND status IN ('pending', 'approved')
      `,
      [sessionId]
    );
    await clearPreStartReviewEligibilityForSession(connection, sessionId);
    const content = reason ? `车头已取消本车：${reason}` : "车头已取消本车";
    await runSessionExtensionHook("afterSessionCancelled", {
      connection,
      sessionId,
      senderUserId: user.user.id,
      content
    });
    return findById(connection, "sessions", sessionId);
  });
}

export async function assertSessionAlbumUploadAllowed(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withDatabaseConnection(async (connection) => {
    const session = await requireSessionAlbumOpen(connection, id);
    await requireSessionAlbumMember(connection, session, user);
    return session;
  });
}

export async function getMySessionAlbumPrivacy(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withDatabaseConnection(async (connection) => {
    const session = await requireSessionAlbumOpen(connection, id);
    await requireSessionAlbumMember(connection, session, user);
    return {
      session_id: id,
      user_id: user.user.id,
      ...(await getAlbumPrivacy(connection, id, user.user.id))
    };
  });
}

export async function updateMySessionAlbumPrivacy(user, sessionId, body = {}) {
  const id = positiveId(sessionId, "sessionId");
  const allowUploadedVisible = booleanValue(
    body.allowUploadedVisible ?? body.allow_uploaded_visible,
    true
  );
  const allowTaggedVisible = booleanValue(
    body.allowTaggedVisible ?? body.allow_tagged_visible,
    true
  );
  return withTransaction(async (connection) => {
    const session = await requireSessionAlbumOpen(connection, id);
    await requireSessionAlbumMember(connection, session, user);
    await connection.query(
      `
        INSERT INTO session_album_privacy
          (session_id, user_id, allow_uploaded_visible, allow_tagged_visible)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          allow_uploaded_visible = VALUES(allow_uploaded_visible),
          allow_tagged_visible = VALUES(allow_tagged_visible)
      `,
      [
        id,
        user.user.id,
        allowUploadedVisible ? 1 : 0,
        allowTaggedVisible ? 1 : 0
      ]
    );
    return {
      session_id: id,
      user_id: user.user.id,
      allow_uploaded_visible: allowUploadedVisible,
      allow_tagged_visible: allowTaggedVisible
    };
  });
}

export async function listSessionAlbumPeople(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withDatabaseConnection(async (connection) => {
    const session = await requireSessionAlbumOpen(connection, id);
    await requireSessionAlbumMember(connection, session, user);
    return {
      session_id: id,
      people: await sessionAlbumPeople(connection, session)
    };
  });
}

export async function listSessionAlbum(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withDatabaseConnection(async (connection) => {
    const session = await requireSessionAlbumOpen(connection, id);
    const canUpload = await isSessionAlbumMember(connection, session, user.user.id);
    const privacy = canUpload
      ? await getAlbumPrivacy(connection, id, user.user.id)
      : albumPrivacy();
    const [photoRows] = await connection.query(
      `
        SELECT
          photo.*,
          user.nickname AS uploader_nickname,
          user.open_id AS uploader_open_id
        FROM session_album_photos photo
        JOIN users user ON user.id = photo.uploader_user_id
        WHERE photo.session_id = ?
          AND photo.status = 'active'
        ORDER BY photo.created_at DESC, photo.id DESC
      `,
      [id]
    );
    const photoIds = photoRows.map((photo) => Number(photo.id));
    const tagsMap = await albumTagsForPhotos(connection, photoIds);
    const privacyUserIds = [];
    for (const photo of photoRows) {
      privacyUserIds.push(photo.uploader_user_id);
      for (const tag of tagsMap.get(Number(photo.id)) || []) {
        if (tag.user_id) {
          privacyUserIds.push(tag.user_id);
        }
      }
    }
    const privacyByUser = await albumPrivacyMap(connection, id, privacyUserIds);
    const photos = [];
    let hiddenCount = 0;
    let untaggedCount = 0;
    for (const photo of photoRows) {
      const tags = tagsMap.get(Number(photo.id)) || [];
      if (tags.length === 0) {
        untaggedCount += 1;
      }
      if (!isAlbumPhotoVisibleToUser(photo, tags, privacyByUser, user.user.id)) {
        hiddenCount += 1;
        continue;
      }
      photos.push({
        id: Number(photo.id),
        session_id: Number(photo.session_id),
        uploader_user_id: Number(photo.uploader_user_id),
        uploader_name: photo.uploader_nickname || photo.uploader_open_id || "车友",
        is_mine: Number(photo.uploader_user_id) === Number(user.user.id),
        can_tag: Number(photo.uploader_user_id) === Number(user.user.id),
        created_at: photo.created_at,
        tags
      });
    }
    return {
      session_id: id,
      can_upload: canUpload,
      privacy,
      visible_count: photos.length,
      hidden_count: hiddenCount,
      untagged_count: untaggedCount,
      photos
    };
  });
}

export async function createSessionAlbumPhoto(user, sessionId, body = {}) {
  const id = positiveId(sessionId, "sessionId");
  const photoUrl = sessionAlbumPhotoUrl(id, user.user.id, body.photoUrl || body.photo_url);
  return withTransaction(async (connection) => {
    const session = await requireSessionAlbumOpen(connection, id);
    await requireSessionAlbumMember(connection, session, user);
    const [result] = await connection.query(
      `
        INSERT INTO session_album_photos (session_id, uploader_user_id, photo_url, status)
        VALUES (?, ?, ?, 'active')
      `,
      [id, user.user.id, photoUrl]
    );
    const photo = await findById(connection, "session_album_photos", result.insertId);
    return {
      id: Number(photo.id),
      session_id: Number(photo.session_id),
      uploader_user_id: Number(photo.uploader_user_id),
      is_mine: true,
      can_tag: true,
      created_at: photo.created_at,
      tags: []
    };
  });
}

export async function updateSessionAlbumPhotoTags(user, photoId, body = {}) {
  const id = positiveId(photoId, "photoId");
  const tagKeys = normalizeAlbumTagKeys(body);
  return withTransaction(async (connection) => {
    const photo = await findById(connection, "session_album_photos", id);
    if (!photo || photo.status !== "active") {
      throw notFound("Album photo not found");
    }
    if (Number(photo.uploader_user_id) !== Number(user.user.id)) {
      throw forbidden("Only the photo uploader can tag this photo");
    }
    const session = await requireSessionAlbumOpen(connection, photo.session_id);
    const people = await sessionAlbumPeople(connection, session);
    const peopleByKey = new Map(people.map((person) => [person.key, person]));
    const tags = tagKeys.map((key) => {
      const person = peopleByKey.get(key);
      if (!person) {
        throw badRequest("tags contains a person outside this session");
      }
      return person;
    });

    await connection.query("DELETE FROM session_album_photo_tags WHERE photo_id = ?", [id]);
    for (const [index, tag] of tags.entries()) {
      await connection.query(
        `
          INSERT INTO session_album_photo_tags
            (photo_id, tag_type, seat_id, user_id, label, sort_order)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          id,
          tag.tag_type,
          tag.seat_id || null,
          tag.user_id || null,
          tag.label,
          index
        ]
      );
    }

    return {
      id,
      tags: tags.map((tag) => ({
        key: tag.key,
        tag_type: tag.tag_type,
        seat_id: tag.seat_id,
        user_id: tag.user_id,
        label: tag.label
      }))
    };
  });
}

export async function deleteSessionAlbumPhoto(user, photoId) {
  const id = positiveId(photoId, "photoId");
  return withTransaction(async (connection) => {
    const photo = await findById(connection, "session_album_photos", id);
    if (!photo || photo.status !== "active") {
      throw notFound("Album photo not found");
    }
    if (Number(photo.uploader_user_id) !== Number(user.user.id)) {
      throw forbidden("Only the photo uploader can delete this photo");
    }
    await connection.query(
      "UPDATE session_album_photos SET status = 'deleted' WHERE id = ?",
      [id]
    );
    return { id, status: "deleted" };
  });
}

export async function getVisibleSessionAlbumPhotoForMedia(userId, photoId) {
  const id = positiveId(photoId, "photoId");
  const currentUserId = positiveId(userId, "userId");
  return withDatabaseConnection(async (connection) => {
    const photo = await findById(connection, "session_album_photos", id);
    if (!photo || photo.status !== "active") {
      throw notFound("Album photo not found");
    }
    await requireSessionAlbumOpen(connection, photo.session_id);
    const tagsMap = await albumTagsForPhotos(connection, [id]);
    const tags = tagsMap.get(id) || [];
    const privacyByUser = await albumPrivacyMap(
      connection,
      photo.session_id,
      [
        photo.uploader_user_id,
        ...tags.map((tag) => tag.user_id).filter(Boolean)
      ]
    );
    if (!isAlbumPhotoVisibleToUser(photo, tags, privacyByUser, currentUserId)) {
      throw forbidden("Album photo is not visible");
    }
    return photo;
  });
}

async function reviewPhotos(connection, reviewIds) {
  if (reviewIds.length === 0) {
    return new Map();
  }
  const placeholders = reviewIds.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `
      SELECT review_id, photo_url
      FROM session_review_photos
      WHERE review_id IN (${placeholders})
      ORDER BY review_id, sort_order, id
    `,
    reviewIds
  );
  const photosByReview = new Map();
  for (const row of rows) {
    const list = photosByReview.get(Number(row.review_id)) || [];
    list.push(row.photo_url);
    photosByReview.set(Number(row.review_id), list);
  }
  return photosByReview;
}

export async function listSessionReviews(sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withDatabaseConnection(async (connection) => {
    const session = await findById(connection, "sessions", id);
    if (!session) {
      throw notFound("Session not found");
    }
    const [rows] = await connection.query(
      `
        SELECT
          review.*,
          user.nickname AS user_nickname,
          user.avatar_url AS user_avatar_url,
          user.open_id AS user_open_id,
          seat.name AS seat_name,
          seat.role_name AS seat_role_name
        FROM session_reviews review
        JOIN users user ON user.id = review.user_id
        LEFT JOIN session_seats seat ON seat.id = review.seat_id
        WHERE review.session_id = ?
          AND review.status = 'active'
        ORDER BY review.updated_at DESC, review.id DESC
      `,
      [id]
    );
    const photosByReview = await reviewPhotos(connection, rows.map((row) => Number(row.id)));
    return rows.map((row) => ({
      ...row,
      photos: photosByReview.get(Number(row.id)) || []
    }));
  });
}

export async function getMySessionReview(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withDatabaseConnection(async (connection) => {
    const eligibleSignup = await currentEligibleSignup(connection, id, user.user.id);
    const [rows] = await connection.query(
      `
        SELECT *
        FROM session_reviews
        WHERE session_id = ?
          AND user_id = ?
          AND status = 'active'
        LIMIT 1
      `,
      [id, user.user.id]
    );
    const review = rows[0] || null;
    const photosByReview = review
      ? await reviewPhotos(connection, [Number(review.id)])
      : new Map();
    return {
      can_review: Boolean(eligibleSignup),
      review: review
        ? {
            ...review,
            photos: photosByReview.get(Number(review.id)) || []
          }
        : null
    };
  });
}

export async function upsertMySessionReview(user, sessionId, body = {}) {
  const id = positiveId(sessionId, "sessionId");
  const rating = reviewRating(body.rating);
  const content = reviewContent(body.content);
  const photoUrls = assertSessionReviewPhotoUrls(body.photoUrls);

  return withTransaction(async (connection) => {
    const eligibleSignup = await currentEligibleSignup(connection, id, user.user.id);
    if (!eligibleSignup) {
      throw forbidden("Only eligible session participants can write a review after start time");
    }

    await connection.query(
      `
        INSERT INTO session_reviews
          (session_id, user_id, seat_id, rating, content, status)
        VALUES (?, ?, ?, ?, ?, 'active')
        ON DUPLICATE KEY UPDATE
          seat_id = VALUES(seat_id),
          rating = VALUES(rating),
          content = VALUES(content),
          status = 'active'
      `,
      [id, user.user.id, eligibleSignup.seat_id || null, rating, content]
    );

    const [reviewRows] = await connection.query(
      `
        SELECT *
        FROM session_reviews
        WHERE session_id = ?
          AND user_id = ?
        LIMIT 1
      `,
      [id, user.user.id]
    );
    const review = reviewRows[0];
    await connection.query("DELETE FROM session_review_photos WHERE review_id = ?", [
      review.id
    ]);
    for (const [index, photoUrl] of photoUrls.entries()) {
      await connection.query(
        `
          INSERT INTO session_review_photos (review_id, photo_url, sort_order)
          VALUES (?, ?, ?)
        `,
        [review.id, photoUrl, index]
      );
    }
    return {
      ...review,
      rating,
      content,
      photos: photoUrls
    };
  });
}

export async function createShareEvent(eventType, body) {
  return withDatabaseConnection(async (connection) => {
    const [result] = await connection.query(
      `
        INSERT INTO share_events
          (
            session_id, inviter_user_id, share_code, source, event_type, path,
            seat_id, viewed_user_id, converted_signup_id, raw_payload_json
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        body.sessionId || null,
        body.inviterUserId || null,
        optionalText(body.shareCode),
        optionalText(body.source),
        eventType,
        optionalText(body.path),
        body.seatId || null,
        body.viewedUserId || null,
        body.convertedSignupId || null,
        JSON.stringify(body.rawPayload || body)
      ]
    );
    return selectInserted(connection, "share_events", result);
  });
}

export async function createSubscriptionRequest(user, body) {
  return withDatabaseConnection(async (connection) => {
    const [result] = await connection.query(
      `
        INSERT INTO subscription_requests
          (user_id, template_id, scene, accepted, raw_result_json)
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        user.user.id,
        optionalText(body.templateId),
        optionalText(body.scene),
        body.accepted ? 1 : 0,
        JSON.stringify(body.rawResult || body)
      ]
    );
    return selectInserted(connection, "subscription_requests", result);
  });
}
