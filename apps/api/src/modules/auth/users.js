import { withDatabaseConnection } from "../../db/mysql.js";
import { badRequest } from "../../http/errors.js";

function normalizeUserGender(value) {
  const gender = String(value || "").trim();
  if (!["male", "female"].includes(gender)) {
    throw badRequest("gender must be male or female");
  }
  return gender;
}

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
    gender: row.gender || "",
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

async function findWechatIdentityUser(connection, identity) {
  const [identityRows] = await connection.query(
    `
      SELECT users.*
      FROM wechat_identities
      INNER JOIN users ON users.id = wechat_identities.user_id
      WHERE wechat_identities.app_id = ?
        AND wechat_identities.open_id = ?
      LIMIT 1
    `,
    [identity.appId, identity.openid]
  );
  if (identityRows[0]) {
    return identityRows[0];
  }

  const [openIdRows] = await connection.query("SELECT * FROM users WHERE open_id = ?", [
    identity.openid
  ]);
  if (openIdRows[0]) {
    return openIdRows[0];
  }

  if (!identity.unionid) {
    return null;
  }

  const [unionIdRows] = await connection.query(
    "SELECT * FROM users WHERE union_id = ? ORDER BY id LIMIT 1",
    [identity.unionid]
  );
  return unionIdRows[0] || null;
}

async function upsertWechatIdentity(connection, userId, identity) {
  await connection.query(
    `
      INSERT INTO wechat_identities (user_id, app_id, open_id, union_id)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        user_id = VALUES(user_id),
        union_id = COALESCE(VALUES(union_id), union_id),
        updated_at = CURRENT_TIMESTAMP
    `,
    [userId, identity.appId, identity.openid, identity.unionid]
  );
}

export async function upsertWechatUser(
  connection,
  identity,
  bootstrapAdminOpenids,
  bootstrapAdminUnionids = []
) {
  const appId = identity.appId || "unknown";
  const normalizedIdentity = { ...identity, appId };
  let user = await findWechatIdentityUser(connection, normalizedIdentity);

  if (user) {
    await connection.query(
      `
        UPDATE users
        SET union_id = COALESCE(?, union_id),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [normalizedIdentity.unionid, user.id]
    );
  } else {
    await connection.query(
      `
        INSERT INTO users (open_id, union_id)
        VALUES (?, ?)
      `,
      [normalizedIdentity.openid, normalizedIdentity.unionid]
    );
  }

  const [rows] = await connection.query("SELECT * FROM users WHERE open_id = ?", [
    user ? user.open_id : normalizedIdentity.openid
  ]);
  user = rows[0];

  await ensureRole(connection, user.id, "player");
  await upsertWechatIdentity(connection, user.id, normalizedIdentity);
  if (
    bootstrapAdminOpenids.includes(normalizedIdentity.openid) ||
    (normalizedIdentity.unionid &&
      bootstrapAdminUnionids.includes(normalizedIdentity.unionid))
  ) {
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

export async function updateUserGender(userId, gender) {
  const normalizedGender = normalizeUserGender(gender);
  return withDatabaseConnection(async (connection) => {
    await connection.query(
      `
        UPDATE users
        SET gender = ?
        WHERE id = ?
      `,
      [normalizedGender, userId]
    );

    const [rows] = await connection.query("SELECT * FROM users WHERE id = ?", [userId]);
    return publicUser(rows[0]);
  });
}
