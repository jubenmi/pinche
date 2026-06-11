import { withDatabaseConnection } from "../../db/mysql.js";

export function publicUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    openid: row.open_id,
    unionid: row.union_id,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    phoneVerifiedAt: row.phone_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function ensureRole(connection, userId, role) {
  await connection.query(
    `
      INSERT INTO user_roles (user_id, role, status)
      VALUES (?, ?, 'active')
      ON DUPLICATE KEY UPDATE status = 'active'
    `,
    [userId, role]
  );
}

export async function rolesForUser(connection, userId) {
  const [rows] = await connection.query(
    "SELECT role FROM user_roles WHERE user_id = ? AND status = 'active' ORDER BY role",
    [userId]
  );

  return rows.map((row) => row.role);
}

export async function getUserWithRolesById(userId) {
  return withDatabaseConnection(async (connection) => {
    const [rows] = await connection.query("SELECT * FROM users WHERE id = ?", [userId]);
    const user = rows[0];
    if (!user) {
      return null;
    }

    return {
      user: publicUser(user),
      roles: await rolesForUser(connection, user.id)
    };
  });
}

export async function upsertWechatUser(connection, identity, bootstrapAdminOpenids) {
  await connection.query(
    `
      INSERT INTO users (open_id, union_id)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
        union_id = COALESCE(VALUES(union_id), union_id),
        updated_at = CURRENT_TIMESTAMP
    `,
    [identity.openid, identity.unionid]
  );

  const [rows] = await connection.query("SELECT * FROM users WHERE open_id = ?", [
    identity.openid
  ]);
  const user = rows[0];

  await ensureRole(connection, user.id, "player");
  if (bootstrapAdminOpenids.includes(identity.openid)) {
    await ensureRole(connection, user.id, "system_admin");
  }

  return {
    user: publicUser(user),
    roles: await rolesForUser(connection, user.id)
  };
}

export async function updateUserPhone(userId, phoneEncrypted) {
  return withDatabaseConnection(async (connection) => {
    await connection.query(
      `
        UPDATE users
        SET phone_encrypted = ?, phone_verified_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [phoneEncrypted, userId]
    );

    const [rows] = await connection.query("SELECT * FROM users WHERE id = ?", [userId]);
    return publicUser(rows[0]);
  });
}
