import crypto from "node:crypto";
import {
  createDatabaseConnection,
  withDatabaseConnection,
  withTransaction
} from "../../db/mysql.js";
import { AppError, badRequest, forbidden } from "../../http/errors.js";
import { getUserWithRolesById } from "./users.js";
import { issueBusinessToken } from "./wechat.js";

const TICKET_TTL_MS = 5 * 60 * 1000;

function hashSecret(secret) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function ticketQrText(id, secret) {
  return `pinche-admin-login://ticket/${id}?secret=${encodeURIComponent(secret)}`;
}

function assertSecret(ticket, secret) {
  if (!secret || !safeEqual(ticket.secret_hash, hashSecret(secret))) {
    throw badRequest("Invalid ticket secret");
  }
}

function ticketStatus(row) {
  if (row.status === "pending" && new Date(row.expires_at).getTime() <= Date.now()) {
    return "expired";
  }
  return row.status;
}

async function findTicket(connection, id, lock = false) {
  const [rows] = await connection.query(
    `SELECT * FROM admin_web_login_tickets WHERE id = ? ${lock ? "FOR UPDATE" : ""}`,
    [id]
  );
  if (!rows[0]) {
    throw new AppError(404, "NOT_FOUND", "Login ticket not found");
  }
  return rows[0];
}

export async function createAdminWebLoginTicket(body = {}) {
  const id = crypto.randomUUID();
  const secret = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + TICKET_TTL_MS);

  await withDatabaseConnection((connection) =>
    connection.query(
      `
        INSERT INTO admin_web_login_tickets (id, secret_hash, expires_at, user_agent)
        VALUES (?, ?, ?, ?)
      `,
      [
        id,
        hashSecret(secret),
        expiresAt,
        String(body.userAgent || "").slice(0, 255) || null
      ]
    )
  );

  return {
    ticketId: id,
    ticketSecret: secret,
    qrText: ticketQrText(id, secret),
    expiresAt: expiresAt.toISOString()
  };
}

export async function approveAdminWebLoginTicket(user, id, body = {}) {
  if (!user.roles.includes("system_admin")) {
    throw forbidden("system_admin role required");
  }

  return withTransaction(async (connection) => {
    const ticket = await findTicket(connection, id, true);
    assertSecret(ticket, body.secret);
    const status = ticketStatus(ticket);
    if (status !== "pending") {
      throw new AppError(409, "LOGIN_TICKET_NOT_PENDING", "Login ticket is not pending", {
        status
      });
    }

    await connection.query(
      `
        UPDATE admin_web_login_tickets
        SET status = 'approved',
            approved_by_user_id = ?,
            approved_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [user.user.id, id]
    );

    return { status: "approved" };
  });
}

export async function pollAdminWebLoginTicket(id, secret) {
  const connection = await createDatabaseConnection();
  try {
    await connection.beginTransaction();
    const ticket = await findTicket(connection, id, true);
    assertSecret(ticket, secret);
    const status = ticketStatus(ticket);

    if (status === "approved") {
      const auth = await getUserWithRolesById(ticket.approved_by_user_id);
      if (!auth || !auth.roles.includes("system_admin")) {
        throw forbidden("system_admin role required");
      }
      const issued = issueBusinessToken(auth.user, auth.roles);
      await connection.query(
        `
          UPDATE admin_web_login_tickets
          SET status = 'consumed',
              consumed_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [id]
      );
      await connection.commit();
      return {
        status: "approved",
        user: auth.user,
        roles: auth.roles,
        token: issued.token,
        expiresAt: issued.expiresAt
      };
    }

    if (status === "expired" && ticket.status !== "expired") {
      await connection.query(
        "UPDATE admin_web_login_tickets SET status = 'expired' WHERE id = ?",
        [id]
      );
    }

    await connection.commit();
    return { status };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}
