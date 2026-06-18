import { withDatabaseConnection } from "../../db/mysql.js";
import { badRequest } from "../../http/errors.js";

const AVATAR_UPLOAD_PREFIX = "/uploads/avatars/";

function normalizeUserGender(value) {
  const gender = String(value || "").trim();
  if (!["male", "female"].includes(gender)) {
    throw badRequest("gender must be male or female");
  }
  return gender;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeUserNickname(value) {
  const nickname = String(value || "").trim();
  if (!nickname) {
    return null;
  }
  if (nickname.length > 32) {
    throw badRequest("nickname must be 32 characters or less");
  }
  return nickname;
}

function normalizeUserAvatarUrl(value) {
  const avatarUrl = String(value || "").trim();
  if (!avatarUrl) {
    return null;
  }
  if (avatarUrl.length > 512) {
    throw badRequest("avatarUrl must be 512 characters or less");
  }
  if (
    !avatarUrl.startsWith(AVATAR_UPLOAD_PREFIX) ||
    !/^\/uploads\/avatars\/[A-Za-z0-9._-]+$/.test(avatarUrl)
  ) {
    throw badRequest("avatarUrl must be an uploaded avatar path");
  }
  return avatarUrl;
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

export async function updateUserProfile(userId, patch = {}) {
  const assignments = [];
  const values = [];

  if (hasOwn(patch, "nickname")) {
    assignments.push("nickname = ?");
    values.push(normalizeUserNickname(patch.nickname));
  }

  if (hasOwn(patch, "avatarUrl")) {
    assignments.push("avatar_url = ?");
    values.push(normalizeUserAvatarUrl(patch.avatarUrl));
  }

  if (hasOwn(patch, "gender")) {
    assignments.push("gender = ?");
    values.push(normalizeUserGender(patch.gender));
  }

  if (assignments.length === 0) {
    throw badRequest("at least one profile field is required");
  }

  return withDatabaseConnection(async (connection) => {
    await connection.query(
      `
        UPDATE users
        SET ${assignments.join(", ")}
        WHERE id = ?
      `,
      [...values, userId]
    );

    const [rows] = await connection.query("SELECT * FROM users WHERE id = ?", [userId]);
    return publicUser(rows[0]);
  });
}

export async function updateUserGender(userId, gender) {
  return updateUserProfile(userId, { gender });
}
