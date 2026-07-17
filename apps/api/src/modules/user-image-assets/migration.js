export const USER_IMAGE_ASSETS_MIGRATION = "0031_user_image_assets.sql";

const ASSET_COLUMNS = Object.freeze({
  id: ["bigint unsigned", "NO"],
  owner_user_id: ["bigint unsigned", "NO"],
  kind: ["varchar(32)", "NO"],
  asset_path: ["varchar(512)", "NO"],
  object_key: ["varchar(512)", "YES"],
  object_version: ["varchar(128)", "NO"],
  moderation_status: ["varchar(32)", "NO"],
  status: ["varchar(32)", "NO"],
  created_at: ["datetime(3)", "NO"]
});

const CLEANUP_COLUMNS = Object.freeze({
  id: ["bigint unsigned", "NO"],
  user_image_asset_id: ["bigint unsigned", "YES"],
  owner_user_id: ["bigint unsigned", "NO"],
  asset_path: ["varchar(512)", "NO"],
  object_key: ["varchar(512)", "NO"],
  storage_kind: ["varchar(16)", "NO"],
  status: ["varchar(32)", "NO"],
  attempts: ["int unsigned", "NO"],
  cleanup_not_before: ["datetime", "NO"],
  next_retry_at: ["datetime", "YES"],
  last_error_code: ["varchar(64)", "YES"],
  lease_token: ["char(36)", "YES"],
  lease_expires_at: ["datetime", "YES"],
  created_at: ["datetime", "NO"],
  updated_at: ["datetime", "NO"],
  completed_at: ["datetime", "YES"]
});

const OBJECT_CLEANUP_COLUMNS = Object.freeze({
  id: ["bigint unsigned", "NO"],
  asset_path: ["varchar(512)", "NO"],
  object_key: ["varchar(512)", "NO"],
  storage_kind: ["varchar(16)", "NO"],
  status: ["varchar(32)", "NO"],
  attempts: ["int unsigned", "NO"],
  cleanup_not_before: ["datetime", "NO"],
  next_retry_at: ["datetime", "YES"],
  last_error_code: ["varchar(64)", "YES"],
  lease_token: ["char(36)", "YES"],
  lease_expires_at: ["datetime", "YES"],
  created_at: ["datetime", "NO"],
  updated_at: ["datetime", "NO"],
  completed_at: ["datetime", "YES"]
});

const UPLOAD_OPERATION_COLUMNS = Object.freeze({
  id: ["bigint unsigned", "NO"],
  owner_user_id: ["bigint unsigned", "NO"],
  kind: ["varchar(32)", "NO"],
  scope_key: ["varchar(256)", "NO"],
  operation_id: ["varchar(128)", "NO"],
  user_image_asset_id: ["bigint unsigned", "NO"],
  created_at: ["datetime", "NO"]
});

const ASSET_COLUMN_SEMANTICS = Object.freeze({
  id: [null, "auto_increment", "BIGINT UNSIGNED NOT NULL AUTO_INCREMENT"],
  owner_user_id: [null, "", "BIGINT UNSIGNED NOT NULL"],
  kind: [null, "", "VARCHAR(32) NOT NULL"],
  asset_path: [null, "", "VARCHAR(512) NOT NULL"],
  object_key: [null, "", "VARCHAR(512) NULL"],
  object_version: [null, "", "VARCHAR(128) NOT NULL"],
  moderation_status: ["approved_legacy", "", "VARCHAR(32) NOT NULL DEFAULT 'approved_legacy'"],
  status: ["active", "", "VARCHAR(32) NOT NULL DEFAULT 'active'"],
  created_at: ["current_timestamp(3)", "", "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)"]
});

const CLEANUP_COLUMN_SEMANTICS = Object.freeze({
  id: [null, "auto_increment", "BIGINT UNSIGNED NOT NULL AUTO_INCREMENT"],
  user_image_asset_id: [null, "", "BIGINT UNSIGNED NULL"],
  owner_user_id: [null, "", "BIGINT UNSIGNED NOT NULL"],
  asset_path: [null, "", "VARCHAR(512) NOT NULL"],
  object_key: [null, "", "VARCHAR(512) NOT NULL"],
  storage_kind: [null, "", "VARCHAR(16) NOT NULL"],
  status: ["pending", "", "VARCHAR(32) NOT NULL DEFAULT 'pending'"],
  attempts: ["0", "", "INT UNSIGNED NOT NULL DEFAULT 0"],
  cleanup_not_before: [null, "", "DATETIME NOT NULL"],
  next_retry_at: [null, "", "DATETIME NULL"],
  last_error_code: [null, "", "VARCHAR(64) NULL"],
  lease_token: [null, "", "CHAR(36) NULL"],
  lease_expires_at: [null, "", "DATETIME NULL"],
  created_at: ["current_timestamp", "", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
  updated_at: [
    "current_timestamp",
    "on update current_timestamp",
    "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
  ],
  completed_at: [null, "", "DATETIME NULL"]
});

const OBJECT_CLEANUP_COLUMN_SEMANTICS = Object.freeze({
  id: [null, "auto_increment", "BIGINT UNSIGNED NOT NULL AUTO_INCREMENT"],
  asset_path: [null, "", "VARCHAR(512) NOT NULL"],
  object_key: [null, "", "VARCHAR(512) NOT NULL"],
  storage_kind: [null, "", "VARCHAR(16) NOT NULL"],
  status: ["pending", "", "VARCHAR(32) NOT NULL DEFAULT 'pending'"],
  attempts: ["0", "", "INT UNSIGNED NOT NULL DEFAULT 0"],
  cleanup_not_before: [null, "", "DATETIME NOT NULL"],
  next_retry_at: [null, "", "DATETIME NULL"],
  last_error_code: [null, "", "VARCHAR(64) NULL"],
  lease_token: [null, "", "CHAR(36) NULL"],
  lease_expires_at: [null, "", "DATETIME NULL"],
  created_at: ["current_timestamp", "", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
  updated_at: [
    "current_timestamp",
    "on update current_timestamp",
    "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
  ],
  completed_at: [null, "", "DATETIME NULL"]
});

const UPLOAD_OPERATION_COLUMN_SEMANTICS = Object.freeze({
  id: [null, "auto_increment", "BIGINT UNSIGNED NOT NULL AUTO_INCREMENT"],
  owner_user_id: [null, "", "BIGINT UNSIGNED NOT NULL"],
  kind: [null, "", "VARCHAR(32) NOT NULL"],
  scope_key: [null, "", "VARCHAR(256) NOT NULL"],
  operation_id: [null, "", "VARCHAR(128) NOT NULL"],
  user_image_asset_id: [null, "", "BIGINT UNSIGNED NOT NULL"],
  created_at: ["current_timestamp", "", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"]
});

function migrationError(scope, details = {}) {
  const error = new Error(`user image asset migration schema mismatch: ${scope}`);
  error.code = "USER_IMAGE_ASSET_MIGRATION_SCHEMA_MISMATCH";
  error.details = { scope, ...details };
  return error;
}

async function inspectTable(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME AS table_name, ENGINE AS engine
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
    [tableName]
  );
  const row = rows[0];
  if (row && String(row.engine || "").toUpperCase() !== "INNODB") {
    throw migrationError(`${tableName}.engine`, { actual: row.engine });
  }
  return row || null;
}

async function inspectColumns(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME AS column_name, COLUMN_TYPE AS column_type,
            IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default,
            EXTRA AS extra
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ?
     ORDER BY ORDINAL_POSITION`,
    [tableName]
  );
  return new Map(rows.map((row) => [String(row.column_name), row]));
}

function normalizedColumnDefault(value) {
  if (value == null) return null;
  return String(value).trim().toLowerCase().replace(/^'(.*)'$/, "$1");
}

function normalizedColumnExtra(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/default_generated/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function reconcileColumnSemantics(connection, tableName, columns, semantics) {
  for (const [name, [expectedDefault, expectedExtra, definition]] of Object.entries(semantics)) {
    const row = columns.get(name);
    const actualDefault = normalizedColumnDefault(row?.column_default);
    const actualExtra = normalizedColumnExtra(row?.extra);
    const normalizedExpectedDefault = normalizedColumnDefault(expectedDefault);
    const normalizedExpectedExtra = normalizedColumnExtra(expectedExtra);
    const missingDefault = actualDefault == null && normalizedExpectedDefault != null;
    const missingExtra = !actualExtra && Boolean(normalizedExpectedExtra);
    if (actualDefault !== normalizedExpectedDefault && !missingDefault) {
      throw migrationError(`${tableName}.${name}.default`, {
        actual: row?.column_default ?? null,
        expected: expectedDefault
      });
    }
    if (actualExtra !== normalizedExpectedExtra && !missingExtra) {
      throw migrationError(`${tableName}.${name}.extra`, {
        actual: row?.extra || "",
        expected: expectedExtra
      });
    }
    if (missingDefault || missingExtra) {
      await connection.query(`ALTER TABLE ${tableName} MODIFY COLUMN ${name} ${definition}`);
    }
  }
}

function validateColumns(tableName, columns, expected) {
  for (const [name, [type, nullable]] of Object.entries(expected)) {
    const row = columns.get(name);
    if (!row || String(row.column_type).toLowerCase() !== type ||
        String(row.is_nullable).toUpperCase() !== nullable) {
      throw migrationError(`${tableName}.${name}`, {
        expected: { type, nullable },
        actual: row || null
      });
    }
  }
}

async function inspectIndex(connection, tableName, indexName) {
  const [rows] = await connection.query(
    `SELECT NON_UNIQUE AS non_unique, COLUMN_NAME AS column_name,
            SEQ_IN_INDEX AS seq_in_index, SUB_PART AS sub_part
     FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
     ORDER BY SEQ_IN_INDEX`,
    [tableName, indexName]
  );
  return rows;
}

function exactIndex(rows, { unique, columns }) {
  return rows.length === columns.length && rows.every((row, index) =>
    Number(row.non_unique) === (unique ? 0 : 1) &&
    String(row.column_name) === columns[index] &&
    Number(row.seq_in_index) === index + 1 && row.sub_part == null
  );
}

async function ensureIndex(connection, tableName, indexName, expected, ddl) {
  const rows = await inspectIndex(connection, tableName, indexName);
  if (rows.length === 0) {
    await connection.query(ddl);
    return;
  }
  if (!exactIndex(rows, expected)) {
    throw migrationError(`${tableName}.${indexName}`, { actual: rows, expected });
  }
}

async function inspectForeignKey(connection, tableName, constraintName) {
  const [rows] = await connection.query(
    `SELECT kcu.COLUMN_NAME AS column_name,
            kcu.REFERENCED_TABLE_NAME AS referenced_table_name,
            kcu.REFERENCED_COLUMN_NAME AS referenced_column_name,
            rc.DELETE_RULE AS delete_rule
     FROM information_schema.key_column_usage kcu
     JOIN information_schema.referential_constraints rc
       ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
      AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      AND rc.TABLE_NAME = kcu.TABLE_NAME
     WHERE kcu.CONSTRAINT_SCHEMA = DATABASE() AND kcu.TABLE_NAME = ?
       AND kcu.CONSTRAINT_NAME = ?`,
    [tableName, constraintName]
  );
  return rows[0] || null;
}

async function ensureForeignKey(connection, tableName, constraintName, expected, ddl) {
  const row = await inspectForeignKey(connection, tableName, constraintName);
  if (!row) {
    await connection.query(ddl);
    return;
  }
  if (String(row.column_name) !== expected.column ||
      String(row.referenced_table_name) !== expected.referencedTable ||
      String(row.referenced_column_name) !== "id" ||
      String(row.delete_rule).toUpperCase() !== expected.deleteRule) {
    throw migrationError(`${tableName}.${constraintName}`, { actual: row, expected });
  }
}

async function inspectCheckConstraint(connection, tableName, constraintName) {
  const [rows] = await connection.query(
    `SELECT cc.CHECK_CLAUSE AS check_clause
     FROM information_schema.table_constraints AS tc
     JOIN information_schema.check_constraints AS cc
       ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
      AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
     WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
       AND tc.TABLE_NAME = ? AND tc.CONSTRAINT_NAME = ?
       AND tc.CONSTRAINT_TYPE = 'CHECK'`,
    [tableName, constraintName]
  );
  return rows[0] || null;
}

function normalizeCheckClause(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/_(?:utf8mb4|utf8mb3|latin1)/g, "")
    .replace(/[\s()]/g, "");
}

async function ensureCheckConstraint(
  connection,
  tableName,
  constraintName,
  expectedClause,
  ddl
) {
  const row = await inspectCheckConstraint(connection, tableName, constraintName);
  if (!row) {
    await connection.query(ddl);
    return;
  }
  if (normalizeCheckClause(row.check_clause) !== normalizeCheckClause(expectedClause)) {
    throw migrationError(`${tableName}.${constraintName}`, {
      actual: row,
      expected: expectedClause
    });
  }
}

const CREATE_ASSETS = `CREATE TABLE user_image_assets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(32) NOT NULL,
  asset_path VARCHAR(512) NOT NULL,
  object_key VARCHAR(512) NULL,
  object_version VARCHAR(128) NOT NULL,
  moderation_status VARCHAR(32) NOT NULL DEFAULT 'approved_legacy',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_user_image_asset_owner_path (owner_user_id, asset_path),
  KEY idx_user_image_asset_path (asset_path),
  KEY idx_user_image_asset_object_key (object_key),
  KEY idx_user_image_asset_owner_kind (owner_user_id, kind, status, moderation_status),
  KEY idx_user_image_asset_moderation (moderation_status, status, created_at),
  CONSTRAINT fk_user_image_asset_owner FOREIGN KEY (owner_user_id)
    REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_user_image_asset_kind CHECK (kind IN ('avatar', 'review')),
  CONSTRAINT chk_user_image_asset_status CHECK (status IN ('active', 'deleted')),
  CONSTRAINT chk_user_image_asset_moderation CHECK (
    moderation_status IN ('pending', 'approved', 'approved_legacy', 'review', 'rejected', 'error')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const CREATE_CLEANUP = `CREATE TABLE user_image_asset_cleanup_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_image_asset_id BIGINT UNSIGNED NULL,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  asset_path VARCHAR(512) NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  storage_kind VARCHAR(16) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  cleanup_not_before DATETIME NOT NULL,
  next_retry_at DATETIME NULL, last_error_code VARCHAR(64) NULL,
  lease_token CHAR(36) NULL, lease_expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  UNIQUE KEY uniq_user_image_cleanup_asset (user_image_asset_id),
  UNIQUE KEY uniq_user_image_cleanup_owner_path (owner_user_id, asset_path),
  KEY idx_user_image_cleanup_claim (status, cleanup_not_before, next_retry_at, lease_expires_at),
  CONSTRAINT fk_user_image_cleanup_asset FOREIGN KEY (user_image_asset_id)
    REFERENCES user_image_assets(id) ON DELETE SET NULL,
  CONSTRAINT fk_user_image_cleanup_owner FOREIGN KEY (owner_user_id)
    REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_user_image_cleanup_storage CHECK (storage_kind IN ('cos', 'local')),
  CONSTRAINT chk_user_image_cleanup_status CHECK (
    status IN ('pending', 'leased', 'deleting', 'retry', 'cleaned', 'retained')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const CREATE_OBJECT_CLEANUP = `CREATE TABLE user_image_object_cleanup_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  asset_path VARCHAR(512) NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  storage_kind VARCHAR(16) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  cleanup_not_before DATETIME NOT NULL,
  next_retry_at DATETIME NULL, last_error_code VARCHAR(64) NULL,
  lease_token CHAR(36) NULL, lease_expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  UNIQUE KEY uniq_user_image_object_cleanup (storage_kind, object_key),
  KEY idx_user_image_object_cleanup_claim
    (status, cleanup_not_before, next_retry_at, lease_expires_at),
  CONSTRAINT chk_user_image_object_cleanup_storage CHECK (storage_kind IN ('cos', 'local')),
  CONSTRAINT chk_user_image_object_cleanup_status CHECK (
    status IN ('pending', 'leased', 'deleting', 'retry', 'cleaned')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const CREATE_UPLOAD_OPERATIONS = `CREATE TABLE user_image_upload_operations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(32) NOT NULL,
  scope_key VARCHAR(256) NOT NULL,
  operation_id VARCHAR(128) NOT NULL,
  user_image_asset_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_image_upload_operation
    (owner_user_id, kind, scope_key, operation_id),
  KEY idx_user_image_upload_operation_asset (user_image_asset_id),
  CONSTRAINT fk_user_image_upload_operation_owner FOREIGN KEY (owner_user_id)
    REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_user_image_upload_operation_asset FOREIGN KEY (user_image_asset_id)
    REFERENCES user_image_assets(id) ON DELETE RESTRICT,
  CONSTRAINT chk_user_image_upload_operation_kind CHECK (kind IN ('avatar', 'review'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const BACKFILL_AVATARS = `INSERT INTO user_image_assets
  (owner_user_id, kind, asset_path, object_key, object_version, moderation_status, status)
 SELECT user.id, 'avatar', user.avatar_url, TRIM(LEADING '/' FROM user.avatar_url),
        CONCAT('legacy:', SHA2(user.avatar_url, 256)), 'approved_legacy', 'active'
 FROM users AS user
 WHERE user.avatar_url REGEXP '^/uploads/avatars/[A-Za-z0-9._-]+$'
 ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`;

const BACKFILL_REVIEWS = `INSERT INTO user_image_assets
  (owner_user_id, kind, asset_path, object_key, object_version, moderation_status, status)
 SELECT review.user_id, 'review', photo.photo_url, TRIM(LEADING '/' FROM photo.photo_url),
        CONCAT('legacy:', SHA2(CONCAT(review.user_id, ':', photo.photo_url), 256)),
        'approved_legacy', 'active'
 FROM session_review_photos AS photo
 JOIN session_reviews AS review ON review.id = photo.review_id
 WHERE photo.photo_url REGEXP '^/uploads/session-reviews/[A-Za-z0-9._-]+$'
 GROUP BY review.user_id, photo.photo_url
 ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`;

export async function reconcileUserImageAssetsMigration(connection) {
  const assetTable = await inspectTable(connection, "user_image_assets");
  if (!assetTable) {
    await connection.query(CREATE_ASSETS);
  } else {
    const columns = await inspectColumns(connection, "user_image_assets");
    validateColumns("user_image_assets", columns, ASSET_COLUMNS);
    await ensureIndex(
      connection,
      "user_image_assets",
      "PRIMARY",
      { unique: true, columns: ["id"] },
      "ALTER TABLE user_image_assets ADD PRIMARY KEY (id)"
    );
    await reconcileColumnSemantics(
      connection,
      "user_image_assets",
      columns,
      ASSET_COLUMN_SEMANTICS
    );
    const oldIndex = await inspectIndex(connection, "user_image_assets", "uniq_user_image_asset_path");
    if (oldIndex.length > 0) {
      if (!exactIndex(oldIndex, { unique: true, columns: ["asset_path"] })) {
        throw migrationError("user_image_assets.uniq_user_image_asset_path", { actual: oldIndex });
      }
      await connection.query("ALTER TABLE user_image_assets DROP INDEX uniq_user_image_asset_path");
    }
    await ensureIndex(
      connection,
      "user_image_assets",
      "uniq_user_image_asset_owner_path",
      { unique: true, columns: ["owner_user_id", "asset_path"] },
      `ALTER TABLE user_image_assets ADD UNIQUE KEY uniq_user_image_asset_owner_path
        (owner_user_id, asset_path)`
    );
    await ensureIndex(
      connection,
      "user_image_assets",
      "idx_user_image_asset_path",
      { unique: false, columns: ["asset_path"] },
      `ALTER TABLE user_image_assets ADD KEY idx_user_image_asset_path (asset_path)`
    );
    await ensureIndex(
      connection,
      "user_image_assets",
      "idx_user_image_asset_object_key",
      { unique: false, columns: ["object_key"] },
      `ALTER TABLE user_image_assets ADD KEY idx_user_image_asset_object_key (object_key)`
    );
    await ensureIndex(
      connection,
      "user_image_assets",
      "idx_user_image_asset_owner_kind",
      { unique: false, columns: ["owner_user_id", "kind", "status", "moderation_status"] },
      `ALTER TABLE user_image_assets ADD KEY idx_user_image_asset_owner_kind
       (owner_user_id, kind, status, moderation_status)`
    );
    await ensureIndex(
      connection,
      "user_image_assets",
      "idx_user_image_asset_moderation",
      { unique: false, columns: ["moderation_status", "status", "created_at"] },
      `ALTER TABLE user_image_assets ADD KEY idx_user_image_asset_moderation
       (moderation_status, status, created_at)`
    );
    await ensureForeignKey(
      connection,
      "user_image_assets",
      "fk_user_image_asset_owner",
      { column: "owner_user_id", referencedTable: "users", deleteRule: "RESTRICT" },
      `ALTER TABLE user_image_assets ADD CONSTRAINT fk_user_image_asset_owner
       FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT`
    );
    await ensureCheckConstraint(
      connection,
      "user_image_assets",
      "chk_user_image_asset_kind",
      "kind IN ('avatar', 'review')",
      `ALTER TABLE user_image_assets ADD CONSTRAINT chk_user_image_asset_kind
       CHECK (kind IN ('avatar', 'review'))`
    );
    await ensureCheckConstraint(
      connection,
      "user_image_assets",
      "chk_user_image_asset_status",
      "status IN ('active', 'deleted')",
      `ALTER TABLE user_image_assets ADD CONSTRAINT chk_user_image_asset_status
       CHECK (status IN ('active', 'deleted'))`
    );
    await ensureCheckConstraint(
      connection,
      "user_image_assets",
      "chk_user_image_asset_moderation",
      "moderation_status IN ('pending', 'approved', 'approved_legacy', 'review', 'rejected', 'error')",
      `ALTER TABLE user_image_assets ADD CONSTRAINT chk_user_image_asset_moderation
       CHECK (moderation_status IN
         ('pending', 'approved', 'approved_legacy', 'review', 'rejected', 'error'))`
    );
  }

  const userColumns = await inspectColumns(connection, "users");
  const avatarColumn = userColumns.get("avatar_image_asset_id");
  if (!avatarColumn) {
    await connection.query(
      `ALTER TABLE users ADD COLUMN avatar_image_asset_id BIGINT UNSIGNED NULL AFTER avatar_url,
       ADD KEY idx_users_avatar_image_asset (avatar_image_asset_id)`
    );
  } else {
    if (String(avatarColumn.column_type).toLowerCase() !== "bigint unsigned" ||
        String(avatarColumn.is_nullable).toUpperCase() !== "YES" ||
        avatarColumn.column_default != null || normalizedColumnExtra(avatarColumn.extra)) {
      throw migrationError("users.avatar_image_asset_id", { actual: avatarColumn });
    }
    await ensureIndex(
      connection,
      "users",
      "idx_users_avatar_image_asset",
      { unique: false, columns: ["avatar_image_asset_id"] },
      "ALTER TABLE users ADD KEY idx_users_avatar_image_asset (avatar_image_asset_id)"
    );
  }

  const reviewColumns = await inspectColumns(connection, "session_review_photos");
  const reviewColumn = reviewColumns.get("image_asset_id");
  if (!reviewColumn) {
    await connection.query(
      `ALTER TABLE session_review_photos
       ADD COLUMN image_asset_id BIGINT UNSIGNED NULL AFTER photo_url,
       ADD KEY idx_session_review_photo_asset (image_asset_id)`
    );
  } else {
    if (String(reviewColumn.column_type).toLowerCase() !== "bigint unsigned" ||
        !["YES", "NO"].includes(String(reviewColumn.is_nullable).toUpperCase()) ||
        reviewColumn.column_default != null || normalizedColumnExtra(reviewColumn.extra)) {
      throw migrationError("session_review_photos.image_asset_id", { actual: reviewColumn });
    }
    await ensureIndex(
      connection,
      "session_review_photos",
      "idx_session_review_photo_asset",
      { unique: false, columns: ["image_asset_id"] },
      `ALTER TABLE session_review_photos
       ADD KEY idx_session_review_photo_asset (image_asset_id)`
    );
  }

  await connection.query(BACKFILL_AVATARS);
  await connection.query(
    `UPDATE users AS user JOIN user_image_assets AS asset
       ON asset.owner_user_id = user.id AND asset.kind = 'avatar'
      AND asset.asset_path = user.avatar_url
     SET user.avatar_image_asset_id = asset.id
     WHERE user.avatar_url IS NOT NULL`
  );
  const [missingAvatarRows] = await connection.query(
    `SELECT COUNT(*) AS historical_avatar_missing_count
     FROM users AS user
     WHERE NULLIF(TRIM(user.avatar_url), '') IS NOT NULL
       AND user.avatar_image_asset_id IS NULL`
  );
  const missingAvatarCount = Number(
    missingAvatarRows[0]?.historical_avatar_missing_count || 0
  );
  if (missingAvatarCount > 0) {
    const error = new Error("historical avatar assets could not all be bound");
    error.code = "USER_IMAGE_ASSET_MIGRATION_UNBOUND_AVATAR";
    error.details = { missingCount: missingAvatarCount };
    throw error;
  }
  await connection.query(BACKFILL_REVIEWS);
  await connection.query(
    `UPDATE session_review_photos AS photo
     JOIN session_reviews AS review ON review.id = photo.review_id
     JOIN user_image_assets AS asset ON asset.owner_user_id = review.user_id
      AND asset.kind = 'review' AND asset.asset_path = photo.photo_url
     SET photo.image_asset_id = asset.id`
  );
  const [missingRows] = await connection.query(
    `SELECT COUNT(*) AS missing_count FROM session_review_photos
     WHERE image_asset_id IS NULL`
  );
  if (Number(missingRows[0]?.missing_count || 0) > 0) {
    const error = new Error("historical review photo assets could not all be bound");
    error.code = "USER_IMAGE_ASSET_MIGRATION_UNBOUND_REVIEW";
    error.details = { missingCount: Number(missingRows[0].missing_count) };
    throw error;
  }
  if (!reviewColumn || String(reviewColumn.is_nullable).toUpperCase() === "YES") {
    await connection.query(
      "ALTER TABLE session_review_photos MODIFY COLUMN image_asset_id BIGINT UNSIGNED NOT NULL"
    );
  }

  await ensureForeignKey(
    connection,
    "users",
    "fk_users_avatar_image_asset",
    { column: "avatar_image_asset_id", referencedTable: "user_image_assets", deleteRule: "SET NULL" },
    `ALTER TABLE users ADD CONSTRAINT fk_users_avatar_image_asset
     FOREIGN KEY (avatar_image_asset_id) REFERENCES user_image_assets(id) ON DELETE SET NULL`
  );
  await ensureForeignKey(
    connection,
    "session_review_photos",
    "fk_session_review_photo_asset",
    { column: "image_asset_id", referencedTable: "user_image_assets", deleteRule: "RESTRICT" },
    `ALTER TABLE session_review_photos ADD CONSTRAINT fk_session_review_photo_asset
     FOREIGN KEY (image_asset_id) REFERENCES user_image_assets(id) ON DELETE RESTRICT`
  );

  const cleanupTable = await inspectTable(connection, "user_image_asset_cleanup_jobs");
  if (!cleanupTable) {
    await connection.query(CREATE_CLEANUP);
  } else {
    const columns = await inspectColumns(connection, "user_image_asset_cleanup_jobs");
    validateColumns(
      "user_image_asset_cleanup_jobs",
      columns,
      CLEANUP_COLUMNS
    );
    await ensureIndex(
      connection,
      "user_image_asset_cleanup_jobs",
      "PRIMARY",
      { unique: true, columns: ["id"] },
      "ALTER TABLE user_image_asset_cleanup_jobs ADD PRIMARY KEY (id)"
    );
    await reconcileColumnSemantics(
      connection,
      "user_image_asset_cleanup_jobs",
      columns,
      CLEANUP_COLUMN_SEMANTICS
    );
    await ensureIndex(
      connection,
      "user_image_asset_cleanup_jobs",
      "uniq_user_image_cleanup_asset",
      { unique: true, columns: ["user_image_asset_id"] },
      `ALTER TABLE user_image_asset_cleanup_jobs
       ADD UNIQUE KEY uniq_user_image_cleanup_asset (user_image_asset_id)`
    );
    await ensureIndex(
      connection,
      "user_image_asset_cleanup_jobs",
      "uniq_user_image_cleanup_owner_path",
      { unique: true, columns: ["owner_user_id", "asset_path"] },
      "ALTER TABLE user_image_asset_cleanup_jobs ADD UNIQUE KEY uniq_user_image_cleanup_owner_path (owner_user_id, asset_path)"
    );
    await ensureIndex(
      connection,
      "user_image_asset_cleanup_jobs",
      "idx_user_image_cleanup_claim",
      { unique: false, columns: ["status", "cleanup_not_before", "next_retry_at", "lease_expires_at"] },
      `ALTER TABLE user_image_asset_cleanup_jobs ADD KEY idx_user_image_cleanup_claim
       (status, cleanup_not_before, next_retry_at, lease_expires_at)`
    );
    await ensureForeignKey(
      connection,
      "user_image_asset_cleanup_jobs",
      "fk_user_image_cleanup_asset",
      { column: "user_image_asset_id", referencedTable: "user_image_assets", deleteRule: "SET NULL" },
      `ALTER TABLE user_image_asset_cleanup_jobs ADD CONSTRAINT fk_user_image_cleanup_asset
       FOREIGN KEY (user_image_asset_id) REFERENCES user_image_assets(id) ON DELETE SET NULL`
    );
    await ensureForeignKey(
      connection,
      "user_image_asset_cleanup_jobs",
      "fk_user_image_cleanup_owner",
      { column: "owner_user_id", referencedTable: "users", deleteRule: "RESTRICT" },
      `ALTER TABLE user_image_asset_cleanup_jobs ADD CONSTRAINT fk_user_image_cleanup_owner
       FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT`
    );
    await ensureCheckConstraint(
      connection,
      "user_image_asset_cleanup_jobs",
      "chk_user_image_cleanup_storage",
      "storage_kind IN ('cos', 'local')",
      `ALTER TABLE user_image_asset_cleanup_jobs ADD CONSTRAINT chk_user_image_cleanup_storage
       CHECK (storage_kind IN ('cos', 'local'))`
    );
    await ensureCheckConstraint(
      connection,
      "user_image_asset_cleanup_jobs",
      "chk_user_image_cleanup_status",
      "status IN ('pending', 'leased', 'deleting', 'retry', 'cleaned', 'retained')",
      `ALTER TABLE user_image_asset_cleanup_jobs ADD CONSTRAINT chk_user_image_cleanup_status
       CHECK (status IN ('pending', 'leased', 'deleting', 'retry', 'cleaned', 'retained'))`
    );
  }

  const objectCleanupTable = await inspectTable(connection, "user_image_object_cleanup_jobs");
  if (!objectCleanupTable) {
    await connection.query(CREATE_OBJECT_CLEANUP);
  } else {
    const columns = await inspectColumns(connection, "user_image_object_cleanup_jobs");
    validateColumns(
      "user_image_object_cleanup_jobs",
      columns,
      OBJECT_CLEANUP_COLUMNS
    );
    await ensureIndex(
      connection,
      "user_image_object_cleanup_jobs",
      "PRIMARY",
      { unique: true, columns: ["id"] },
      "ALTER TABLE user_image_object_cleanup_jobs ADD PRIMARY KEY (id)"
    );
    await reconcileColumnSemantics(
      connection,
      "user_image_object_cleanup_jobs",
      columns,
      OBJECT_CLEANUP_COLUMN_SEMANTICS
    );
    await ensureIndex(
      connection,
      "user_image_object_cleanup_jobs",
      "uniq_user_image_object_cleanup",
      { unique: true, columns: ["storage_kind", "object_key"] },
      `ALTER TABLE user_image_object_cleanup_jobs
       ADD UNIQUE KEY uniq_user_image_object_cleanup (storage_kind, object_key)`
    );
    await ensureIndex(
      connection,
      "user_image_object_cleanup_jobs",
      "idx_user_image_object_cleanup_claim",
      { unique: false, columns: ["status", "cleanup_not_before", "next_retry_at", "lease_expires_at"] },
      `ALTER TABLE user_image_object_cleanup_jobs
       ADD KEY idx_user_image_object_cleanup_claim
       (status, cleanup_not_before, next_retry_at, lease_expires_at)`
    );
    await ensureCheckConstraint(
      connection,
      "user_image_object_cleanup_jobs",
      "chk_user_image_object_cleanup_storage",
      "storage_kind IN ('cos', 'local')",
      `ALTER TABLE user_image_object_cleanup_jobs
       ADD CONSTRAINT chk_user_image_object_cleanup_storage
       CHECK (storage_kind IN ('cos', 'local'))`
    );
    await ensureCheckConstraint(
      connection,
      "user_image_object_cleanup_jobs",
      "chk_user_image_object_cleanup_status",
      "status IN ('pending', 'leased', 'deleting', 'retry', 'cleaned')",
      `ALTER TABLE user_image_object_cleanup_jobs
       ADD CONSTRAINT chk_user_image_object_cleanup_status
      CHECK (status IN ('pending', 'leased', 'deleting', 'retry', 'cleaned'))`
    );
  }

  const uploadOperationTable = await inspectTable(connection, "user_image_upload_operations");
  if (!uploadOperationTable) {
    await connection.query(CREATE_UPLOAD_OPERATIONS);
  } else {
    const columns = await inspectColumns(connection, "user_image_upload_operations");
    validateColumns(
      "user_image_upload_operations",
      columns,
      UPLOAD_OPERATION_COLUMNS
    );
    await ensureIndex(
      connection,
      "user_image_upload_operations",
      "PRIMARY",
      { unique: true, columns: ["id"] },
      "ALTER TABLE user_image_upload_operations ADD PRIMARY KEY (id)"
    );
    await reconcileColumnSemantics(
      connection,
      "user_image_upload_operations",
      columns,
      UPLOAD_OPERATION_COLUMN_SEMANTICS
    );
    await ensureIndex(
      connection,
      "user_image_upload_operations",
      "uniq_user_image_upload_operation",
      { unique: true, columns: ["owner_user_id", "kind", "scope_key", "operation_id"] },
      `ALTER TABLE user_image_upload_operations
       ADD UNIQUE KEY uniq_user_image_upload_operation
       (owner_user_id, kind, scope_key, operation_id)`
    );
    await ensureIndex(
      connection,
      "user_image_upload_operations",
      "idx_user_image_upload_operation_asset",
      { unique: false, columns: ["user_image_asset_id"] },
      `ALTER TABLE user_image_upload_operations
       ADD KEY idx_user_image_upload_operation_asset (user_image_asset_id)`
    );
    await ensureForeignKey(
      connection,
      "user_image_upload_operations",
      "fk_user_image_upload_operation_owner",
      { column: "owner_user_id", referencedTable: "users", deleteRule: "RESTRICT" },
      `ALTER TABLE user_image_upload_operations
       ADD CONSTRAINT fk_user_image_upload_operation_owner
       FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT`
    );
    await ensureForeignKey(
      connection,
      "user_image_upload_operations",
      "fk_user_image_upload_operation_asset",
      { column: "user_image_asset_id", referencedTable: "user_image_assets", deleteRule: "RESTRICT" },
      `ALTER TABLE user_image_upload_operations
       ADD CONSTRAINT fk_user_image_upload_operation_asset
       FOREIGN KEY (user_image_asset_id) REFERENCES user_image_assets(id) ON DELETE RESTRICT`
    );
    await ensureCheckConstraint(
      connection,
      "user_image_upload_operations",
      "chk_user_image_upload_operation_kind",
      "kind IN ('avatar', 'review')",
      `ALTER TABLE user_image_upload_operations
       ADD CONSTRAINT chk_user_image_upload_operation_kind
       CHECK (kind IN ('avatar', 'review'))`
    );
  }
  return { skipStatements: true, reconciledUserImageAssets: true };
}

export async function prepareUserImageAssetsMigration(connection, filename) {
  if (filename !== USER_IMAGE_ASSETS_MIGRATION) return null;
  return reconcileUserImageAssetsMigration(connection);
}
