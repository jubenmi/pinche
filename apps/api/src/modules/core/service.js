import { withDatabaseConnection, withTransaction } from "../../db/mysql.js";
import { badRequest, conflict, forbidden, notFound } from "../../http/errors.js";
import { ensureRole } from "../auth/users.js";

function isAdmin(user) {
  return user.roles.includes("system_admin");
}

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

function assertPayable(basePrice, adjustment) {
  const payablePrice = basePrice + adjustment;
  if (payablePrice < 0) {
    throw badRequest("payable_price cannot be negative");
  }
  return payablePrice;
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

async function requireSessionOwner(connection, sessionId, user) {
  const session = await findById(connection, "sessions", sessionId);
  if (!session) {
    throw notFound("Session not found");
  }
  if (!isAdmin(user) && Number(session.organizer_user_id) !== Number(user.user.id)) {
    throw forbidden("Only the session organizer can perform this action");
  }
  return session;
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
    const where = ["status = 'active'"];
    const values = [];

    if (filters.keyword) {
      where.push("(name LIKE ? OR type_tags LIKE ?)");
      const keyword = likeKeyword(filters.keyword);
      values.push(keyword, keyword);
    }

    const [rows] = await connection.query(
      `SELECT * FROM scripts WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ${limitValue(filters.limit)} `,
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
        jsonColumn(body.defaultSeatTemplate ?? body.defaultSeatTemplateJson),
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
        : jsonColumn(body.defaultSeatTemplate ?? body.defaultSeatTemplateJson),
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
            jsonColumn(body.defaultSeatTemplate ?? body.defaultSeatTemplateJson),
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

    return findById(connection, "sessions", result.insertId);
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
    const { note, ...publicSession } = session;
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
    const where = ["session.organizer_user_id = ?"];
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
          SUM(CASE WHEN signup.status = 'pending' THEN 1 ELSE 0 END) AS pending_signup_count
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
          (session_id, name, seat_type, role_name, base_price, adjustment, payable_price)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        sessionId,
        requireValue(body, "name"),
        body.seatType || "normal",
        optionalText(body.roleName),
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
        payablePrice
      },
      [
        ["name", "name"],
        ["seatType", "seat_type"],
        ["roleName", "role_name"],
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

export async function listMySignups(user) {
  return withDatabaseConnection(async (connection) => {
    const [rows] = await connection.query(
      "SELECT * FROM signups WHERE user_id = ? ORDER BY id DESC",
      [user.user.id]
    );
    return rows;
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

    const [seatRows] = await connection.query(
      "SELECT * FROM session_seats WHERE id = ? FOR UPDATE",
      [signup.seat_id]
    );
    const seat = seatRows[0];
    if (!seat) {
      throw notFound("Seat not found");
    }
    if (seat.confirmed_user_id && Number(seat.confirmed_user_id) !== Number(signup.user_id)) {
      throw conflict("Seat already has a confirmed user");
    }

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
