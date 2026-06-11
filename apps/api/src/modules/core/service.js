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

export async function listActiveStores() {
  return withDatabaseConnection(async (connection) => {
    const [rows] = await connection.query(
      "SELECT * FROM stores WHERE status = 'active' ORDER BY id DESC"
    );
    return rows;
  });
}

export async function listActiveScripts() {
  return withDatabaseConnection(async (connection) => {
    const [rows] = await connection.query(
      "SELECT * FROM scripts WHERE status = 'active' ORDER BY id DESC"
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
          (name, type_tags, player_count, summary_no_spoiler, status, claim_status, created_by_admin_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        requireValue(body, "name"),
        jsonText(body.typeTags),
        intValue(body.playerCount, 0),
        optionalText(body.summaryNoSpoiler),
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
    playerCount:
      body.playerCount === undefined ? undefined : intValue(body.playerCount, 0)
  };

  return withDatabaseConnection(async (connection) =>
    updateAllowed(connection, "scripts", id, normalized, [
      ["name", "name"],
      ["typeTags", "type_tags"],
      ["playerCount", "player_count"],
      ["summaryNoSpoiler", "summary_no_spoiler"],
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

export async function listCatalogRequests() {
  return withDatabaseConnection(async (connection) => {
    const [rows] = await connection.query(
      "SELECT * FROM catalog_requests ORDER BY id DESC"
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
              (name, type_tags, player_count, summary_no_spoiler, created_by_admin_user_id)
            VALUES (?, ?, ?, ?, ?)
          `,
          [
            request.name,
            jsonText(body.typeTags),
            intValue(body.playerCount, 0),
            request.description,
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
    return { ...session, seats };
  });
}

export async function updateSession(user, id, body) {
  return withDatabaseConnection(async (connection) => {
    await requireSessionOwner(connection, id, user);
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
  return withDatabaseConnection(async (connection) => {
    await requireSignupOwner(connection, signupId, user);
    await connection.query("UPDATE signups SET status = 'rejected' WHERE id = ?", [
      signupId
    ]);
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
