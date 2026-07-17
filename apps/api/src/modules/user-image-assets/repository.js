import { MODERATION_MEDIA_VISIBLE_STATUSES } from "../content-moderation/constants.js";

const USER_IMAGE_CLEANUP_SAFE_MODERATION_STATUSES = new Set([
  "approved",
  "approved_legacy",
  "rejected"
]);

function lockClause(forUpdate) {
  return forUpdate ? " FOR UPDATE" : "";
}

export async function insertUserImageAsset(connection, input) {
  const [result] = await connection.query(
    `INSERT INTO user_image_assets
      (owner_user_id, kind, asset_path, object_key, object_version, moderation_status, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    [
      Number(input.ownerUserId),
      String(input.kind),
      String(input.path),
      input.objectKey ? String(input.objectKey) : null,
      String(input.objectVersion),
      String(input.moderationStatus)
    ]
  );
  return findUserImageAssetById(connection, result.insertId);
}

export async function findUserImageAssetById(
  connection,
  assetId,
  { forUpdate = false } = {}
) {
  const [rows] = await connection.query(
    `SELECT * FROM user_image_assets WHERE id = ? LIMIT 1${lockClause(forUpdate)}`,
    [Number(assetId)]
  );
  return rows[0] || null;
}

export async function findUserImageAssetByPath(
  connection,
  assetPath,
  { forUpdate = false } = {}
) {
  const [rows] = await connection.query(
    `SELECT * FROM user_image_assets WHERE asset_path = ? LIMIT 1${lockClause(forUpdate)}`,
    [String(assetPath)]
  );
  return rows[0] || null;
}

export async function findPublishedUserImageAssetByPath(connection, assetPath) {
  const placeholders = MODERATION_MEDIA_VISIBLE_STATUSES.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `SELECT * FROM user_image_assets
     WHERE asset_path = ? AND status = 'active'
       AND moderation_status IN (${placeholders})
     ORDER BY id LIMIT 1`,
    [String(assetPath), ...MODERATION_MEDIA_VISIBLE_STATUSES]
  );
  return rows[0] || null;
}

export async function findUserImageAssetReadStateByPath(connection, assetPath) {
  const placeholders = MODERATION_MEDIA_VISIBLE_STATUSES.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `SELECT id, status, moderation_status,
       (status = 'active' AND moderation_status IN (${placeholders})) AS is_published
     FROM user_image_assets
     WHERE asset_path = ?
     ORDER BY is_published DESC, id
     LIMIT 1`,
    [...MODERATION_MEDIA_VISIBLE_STATUSES, String(assetPath)]
  );
  const row = rows[0];
  return {
    known: Boolean(row),
    published: Boolean(row?.is_published)
  };
}

export async function findUserImageAssetByOwnerPath(
  connection,
  { ownerUserId, path },
  { forUpdate = false } = {}
) {
  const [rows] = await connection.query(
    `SELECT * FROM user_image_assets
     WHERE owner_user_id = ? AND asset_path = ? LIMIT 1${lockClause(forUpdate)}`,
    [Number(ownerUserId), String(path)]
  );
  return rows[0] || null;
}

export async function findOwnedUserImageAssetById(
  connection,
  { ownerUserId, assetId },
  { forUpdate = false } = {}
) {
  const [rows] = await connection.query(
    `SELECT * FROM user_image_assets
     WHERE id = ? AND owner_user_id = ? LIMIT 1${lockClause(forUpdate)}`,
    [Number(assetId), Number(ownerUserId)]
  );
  return rows[0] || null;
}

export async function findUserImageAssetByUploadOperation(connection, input) {
  const [rows] = await connection.query(
    `SELECT asset.* FROM user_image_upload_operations AS operation
     JOIN user_image_assets AS asset ON asset.id = operation.user_image_asset_id
     WHERE operation.owner_user_id = ? AND operation.kind = ?
       AND operation.scope_key = ? AND operation.operation_id = ?
     LIMIT 1`,
    [
      Number(input.ownerUserId),
      String(input.kind),
      String(input.scopeKey),
      String(input.operationId)
    ]
  );
  return rows[0] || null;
}

export async function bindUserImageUploadOperation(connection, input) {
  await connection.query(
    `INSERT INTO user_image_upload_operations
      (owner_user_id, kind, scope_key, operation_id, user_image_asset_id)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [
      Number(input.ownerUserId),
      String(input.kind),
      String(input.scopeKey),
      String(input.operationId),
      Number(input.assetId)
    ]
  );
  const [rows] = await connection.query(
    `SELECT user_image_asset_id FROM user_image_upload_operations
     WHERE owner_user_id = ? AND kind = ? AND scope_key = ? AND operation_id = ?
     LIMIT 1 FOR UPDATE`,
    [
      Number(input.ownerUserId),
      String(input.kind),
      String(input.scopeKey),
      String(input.operationId)
    ]
  );
  return Number(rows[0]?.user_image_asset_id || 0) === Number(input.assetId);
}

export async function findOwnedPublishedUserImageAsset(
  connection,
  { ownerUserId, kind, path },
  { forUpdate = false } = {}
) {
  const placeholders = MODERATION_MEDIA_VISIBLE_STATUSES.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `SELECT * FROM user_image_assets
     WHERE owner_user_id = ? AND kind = ? AND asset_path = ? AND status = 'active'
       AND moderation_status IN (${placeholders})
     LIMIT 1${lockClause(forUpdate)}`,
    [Number(ownerUserId), String(kind), String(path), ...MODERATION_MEDIA_VISIBLE_STATUSES]
  );
  return rows[0] || null;
}

export async function transitionUserImageAssetModeration(
  connection,
  { assetId, fromStatuses, toStatus }
) {
  const placeholders = fromStatuses.map(() => "?").join(", ");
  const [result] = await connection.query(
    `UPDATE user_image_assets SET moderation_status = ?
     WHERE id = ? AND status = 'active' AND moderation_status IN (${placeholders})`,
    [String(toStatus), Number(assetId), ...fromStatuses.map(String)]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function enqueueUserImageAssetCleanup(connection, input) {
  const [result] = await connection.query(
    `INSERT INTO user_image_asset_cleanup_jobs
      (user_image_asset_id, owner_user_id, asset_path, object_key, storage_kind,
       status, cleanup_not_before)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id),
       user_image_asset_id = COALESCE(VALUES(user_image_asset_id), user_image_asset_id),
       object_key = VALUES(object_key), storage_kind = VALUES(storage_kind),
       status = 'pending', cleanup_not_before = VALUES(cleanup_not_before),
       completed_at = NULL, updated_at = CURRENT_TIMESTAMP`,
    [
      input.assetId ? Number(input.assetId) : null,
      Number(input.ownerUserId),
      String(input.path),
      String(input.objectKey),
      String(input.storageKind),
      input.cleanupNotBefore || new Date()
    ]
  );
  return Number(result.insertId);
}

export async function enqueueUserImageUploadCleanup(connection, input) {
  return enqueueUserImageAssetCleanup(connection, {
    ...input,
    cleanupNotBefore: input.cleanupNotBefore || new Date(Date.now() + 60 * 60 * 1000)
  });
}

export async function protectUserImageUploadCleanup(
  connection,
  { ownerUserId, path, assetId }
) {
  const [result] = await connection.query(
    `UPDATE user_image_asset_cleanup_jobs
     SET user_image_asset_id = ?, status = 'pending', completed_at = NULL,
         lease_token = NULL, lease_expires_at = NULL, next_retry_at = NULL,
         last_error_code = NULL
     WHERE owner_user_id = ? AND asset_path = ?
       AND status IN ('pending', 'retry', 'retained', 'leased')`,
    [Number(assetId), Number(ownerUserId), String(path)]
  );
  return Number(result.affectedRows || 0) > 0;
}

export async function scheduleUserImageAssetCleanup(
  connection,
  { assetId, storageKind, cleanupNotBefore = new Date() }
) {
  const normalizedStorageKind = String(storageKind || "");
  if (!new Set(["cos", "local"]).has(normalizedStorageKind)) {
    throw new TypeError("user image cleanup storage kind is required");
  }
  const [result] = await connection.query(
    `INSERT INTO user_image_asset_cleanup_jobs
      (user_image_asset_id, owner_user_id, asset_path, object_key, storage_kind,
       status, cleanup_not_before)
     SELECT asset.id, asset.owner_user_id, asset.asset_path,
            COALESCE(asset.object_key, TRIM(LEADING '/' FROM asset.asset_path)),
            ?, 'pending', ?
     FROM user_image_assets AS asset WHERE asset.id = ?
     ON DUPLICATE KEY UPDATE status = 'pending', cleanup_not_before = VALUES(cleanup_not_before),
       completed_at = NULL, lease_token = NULL, lease_expires_at = NULL,
       next_retry_at = NULL, last_error_code = NULL, updated_at = CURRENT_TIMESTAMP`,
    [normalizedStorageKind, cleanupNotBefore, Number(assetId)]
  );
  return Number(result.affectedRows || 0) > 0 || Number(result.insertId || 0) > 0;
}

export async function enqueueUserImageObjectCleanup(connection, input) {
  const storageKind = String(input.storageKind || "");
  if (!new Set(["cos", "local"]).has(storageKind)) {
    throw new TypeError("user image object cleanup storage kind is required");
  }
  const [result] = await connection.query(
    `INSERT INTO user_image_object_cleanup_jobs
      (asset_path, object_key, storage_kind, status, cleanup_not_before)
     VALUES (?, ?, ?, 'pending', ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id),
       asset_path = VALUES(asset_path), status = 'pending',
       cleanup_not_before = VALUES(cleanup_not_before), completed_at = NULL,
       lease_token = NULL, lease_expires_at = NULL, next_retry_at = NULL,
       last_error_code = NULL, updated_at = CURRENT_TIMESTAMP`,
    [
      String(input.path),
      String(input.objectKey),
      storageKind,
      input.cleanupNotBefore || new Date()
    ]
  );
  return Number(result.insertId || 0);
}

export async function prepareUserImageCleanupDeletion(
  connection,
  { jobId, leaseToken, assetId = null, ownerUserId, assetPath, deferUntil }
) {
  const claimedAssetId = assetId ? Number(assetId) : null;
  const claimedOwnerUserId = Number(ownerUserId);
  const claimedAssetPath = String(assetPath || "");
  if ((!claimedAssetId && !claimedAssetPath) ||
      !Number.isSafeInteger(claimedOwnerUserId) || claimedOwnerUserId <= 0) {
    throw new TypeError("user image cleanup asset locator is required");
  }

  let asset = null;
  if (claimedAssetId) {
    asset = await findUserImageAssetById(connection, claimedAssetId, { forUpdate: true });
  } else {
    asset = await findUserImageAssetByOwnerPath(connection, {
      ownerUserId: claimedOwnerUserId,
      path: claimedAssetPath
    }, { forUpdate: true });
  }

  const [jobRows] = await connection.query(
    `SELECT * FROM user_image_asset_cleanup_jobs
     WHERE id = ? AND status = 'leased' AND lease_token = ?
     LIMIT 1 FOR UPDATE`,
    [Number(jobId), String(leaseToken)]
  );
  const job = jobRows[0];
  if (!job) return { action: "stale" };
  if (Number(job.owner_user_id) !== claimedOwnerUserId ||
      String(job.asset_path) !== claimedAssetPath ||
      (claimedAssetId && Number(job.user_image_asset_id || 0) !== claimedAssetId) ||
      (asset && Number(asset.owner_user_id) !== claimedOwnerUserId) ||
      (asset && String(asset.asset_path) !== claimedAssetPath)) {
    return { action: "stale" };
  }
  if (!claimedAssetId && job.user_image_asset_id &&
      Number(job.user_image_asset_id) !== Number(asset?.id || 0)) {
    return { action: "stale" };
  }
  if (asset && !job.user_image_asset_id) {
    await connection.query(
      `UPDATE user_image_asset_cleanup_jobs SET user_image_asset_id = ? WHERE id = ?`,
      [Number(asset.id), Number(job.id)]
    );
    job.user_image_asset_id = asset.id;
  }

  if (asset && String(asset.status) !== "deleted") {
    if (String(asset.status) !== "active" ||
        !USER_IMAGE_CLEANUP_SAFE_MODERATION_STATUSES.has(String(asset.moderation_status))) {
      await connection.query(
        `UPDATE user_image_asset_cleanup_jobs
         SET status = 'retry', next_retry_at = ?, lease_token = NULL, lease_expires_at = NULL,
             last_error_code = 'USER_IMAGE_CLEANUP_NOT_TERMINAL'
         WHERE id = ? AND status = 'leased' AND lease_token = ?`,
        [deferUntil, Number(job.id), String(leaseToken)]
      );
      return { action: "deferred" };
    }
  }

  const references = await userImageCleanupReferences(connection, job);
  if (references.businessReferenced) {
    await connection.query(
      `UPDATE user_image_asset_cleanup_jobs
       SET status = 'retained', completed_at = CURRENT_TIMESTAMP,
           lease_token = NULL, lease_expires_at = NULL, next_retry_at = NULL,
           last_error_code = NULL
       WHERE id = ? AND status = 'leased' AND lease_token = ?`,
      [Number(job.id), String(leaseToken)]
    );
    return { action: "retained" };
  }

  if (asset && String(asset.status) !== "deleted") {
    const [assetResult] = await connection.query(
      `UPDATE user_image_assets SET status = 'deleted'
       WHERE id = ? AND status = 'active'`,
      [Number(asset.id)]
    );
    if (Number(assetResult.affectedRows || 0) !== 1) return { action: "stale" };
  }

  if (references.physicalLive) {
    await enqueueUserImageObjectCleanup(connection, {
      path: job.asset_path,
      objectKey: job.object_key,
      storageKind: job.storage_kind,
      cleanupNotBefore: deferUntil
    });
    await connection.query(
      `UPDATE user_image_asset_cleanup_jobs
       SET status = 'retained', completed_at = CURRENT_TIMESTAMP,
           lease_token = NULL, lease_expires_at = NULL, next_retry_at = NULL,
           last_error_code = NULL
       WHERE id = ? AND status = 'leased' AND lease_token = ?`,
      [Number(job.id), String(leaseToken)]
    );
    return { action: "retained" };
  }

  const [jobResult] = await connection.query(
    `UPDATE user_image_asset_cleanup_jobs SET status = 'deleting'
     WHERE id = ? AND status = 'leased' AND lease_token = ?`,
    [Number(job.id), String(leaseToken)]
  );
  return Number(jobResult.affectedRows || 0) === 1
    ? { action: "delete" }
    : { action: "stale" };
}

export async function claimUserImageCleanupJobs(
  connection,
  { leaseToken, now, leaseExpiresAt, limit }
) {
  const [rows] = await connection.query(
    `SELECT * FROM user_image_asset_cleanup_jobs
     WHERE (status IN ('pending', 'retry')
       OR (status IN ('leased', 'deleting') AND lease_expires_at <= ?))
       AND cleanup_not_before <= ?
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY created_at LIMIT ? FOR UPDATE SKIP LOCKED`,
    [now, now, now, Number(limit)]
  );
  for (const row of rows) {
    await connection.query(
      `UPDATE user_image_asset_cleanup_jobs
       SET status = 'leased', lease_token = ?, lease_expires_at = ? WHERE id = ?`,
      [leaseToken, leaseExpiresAt, row.id]
    );
  }
  return rows;
}

export async function claimUserImageObjectCleanupJobs(
  connection,
  { leaseToken, now, leaseExpiresAt, limit }
) {
  const [rows] = await connection.query(
    `SELECT * FROM user_image_object_cleanup_jobs
     WHERE (status IN ('pending', 'retry')
       OR (status IN ('leased', 'deleting') AND lease_expires_at <= ?))
       AND cleanup_not_before <= ?
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY created_at LIMIT ? FOR UPDATE SKIP LOCKED`,
    [now, now, now, Number(limit)]
  );
  for (const row of rows) {
    await connection.query(
      `UPDATE user_image_object_cleanup_jobs
       SET status = 'leased', lease_token = ?, lease_expires_at = ? WHERE id = ?`,
      [leaseToken, leaseExpiresAt, row.id]
    );
  }
  return rows;
}

export async function prepareUserImageObjectCleanupDeletion(
  connection,
  { jobId, leaseToken, assetPath, objectKey, storageKind, deferUntil }
) {
  const claimedPath = String(assetPath || "");
  const claimedKey = String(objectKey || "");
  const claimedStorageKind = String(storageKind || "");
  if (!claimedPath || !claimedKey || !new Set(["cos", "local"]).has(claimedStorageKind)) {
    throw new TypeError("user image object cleanup locator is required");
  }

  // Global lock order: matching assets first, then the object cleanup job.
  const [assets] = await connection.query(
    `SELECT id, status FROM user_image_assets
     WHERE asset_path = ? OR object_key = ?
     ORDER BY id FOR UPDATE`,
    [claimedPath, claimedKey]
  );
  const [jobRows] = await connection.query(
    `SELECT * FROM user_image_object_cleanup_jobs
     WHERE id = ? AND status = 'leased' AND lease_token = ?
     LIMIT 1 FOR UPDATE`,
    [Number(jobId), String(leaseToken)]
  );
  const job = jobRows[0];
  if (!job || String(job.asset_path) !== claimedPath ||
      String(job.object_key) !== claimedKey ||
      String(job.storage_kind) !== claimedStorageKind) {
    return { action: "stale" };
  }
  if (assets.some((asset) => String(asset.status) === "active")) {
    await connection.query(
      `UPDATE user_image_object_cleanup_jobs
       SET status = 'retry', next_retry_at = ?, lease_token = NULL,
           lease_expires_at = NULL, last_error_code = 'USER_IMAGE_CLEANUP_SHARED_LIVE'
       WHERE id = ? AND status = 'leased' AND lease_token = ?`,
      [deferUntil, Number(job.id), String(leaseToken)]
    );
    return { action: "deferred" };
  }
  const [result] = await connection.query(
    `UPDATE user_image_object_cleanup_jobs SET status = 'deleting'
     WHERE id = ? AND status = 'leased' AND lease_token = ?`,
    [Number(job.id), String(leaseToken)]
  );
  return Number(result.affectedRows || 0) === 1
    ? { action: "delete" }
    : { action: "stale" };
}

export async function completeUserImageObjectCleanup(
  connection,
  { jobId, leaseToken, status = "cleaned" }
) {
  const [result] = await connection.query(
    `UPDATE user_image_object_cleanup_jobs
     SET status = ?, completed_at = CURRENT_TIMESTAMP, lease_token = NULL,
         lease_expires_at = NULL, next_retry_at = NULL, last_error_code = NULL
     WHERE id = ? AND status = 'deleting' AND lease_token = ?`,
    [String(status), Number(jobId), String(leaseToken)]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function failUserImageObjectCleanup(
  connection,
  { jobId, leaseToken, attempts, nextRetryAt, errorCode }
) {
  const [result] = await connection.query(
    `UPDATE user_image_object_cleanup_jobs
     SET status = 'retry', attempts = ?, next_retry_at = ?, last_error_code = ?,
         lease_token = NULL, lease_expires_at = NULL
     WHERE id = ? AND status IN ('leased', 'deleting') AND lease_token = ?`,
    [Number(attempts), nextRetryAt, String(errorCode), Number(jobId), String(leaseToken)]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function userImageCleanupReferences(connection, row) {
  const [rows] = await connection.query(
    `SELECT (
       EXISTS(SELECT 1 FROM users WHERE avatar_image_asset_id = ?)
       OR EXISTS(SELECT 1 FROM session_review_photos WHERE image_asset_id = ?)
     ) AS business_referenced,
     EXISTS(
         SELECT 1 FROM user_image_assets AS asset
         WHERE asset.id <> ? AND asset.status = 'active'
           AND (asset.asset_path = ? OR asset.object_key = ?)
     ) AS physical_live`,
    [
      row.user_image_asset_id || null,
      row.user_image_asset_id || null,
      Number(row.user_image_asset_id || 0),
      String(row.asset_path),
      String(row.object_key)
    ]
  );
  return {
    businessReferenced: Boolean(rows[0]?.business_referenced),
    physicalLive: Boolean(rows[0]?.physical_live)
  };
}

export async function userImageCleanupReferenceExists(connection, row) {
  const references = await userImageCleanupReferences(connection, row);
  return references.businessReferenced || references.physicalLive;
}

export async function completeUserImageCleanup(
  connection,
  { jobId, leaseToken, status = "cleaned" }
) {
  const [result] = await connection.query(
    `UPDATE user_image_asset_cleanup_jobs
     SET status = ?, completed_at = CURRENT_TIMESTAMP, lease_token = NULL,
         lease_expires_at = NULL, next_retry_at = NULL, last_error_code = NULL
     WHERE id = ? AND status = 'deleting' AND lease_token = ?`,
    [String(status), Number(jobId), String(leaseToken)]
  );
  if (Number(result.affectedRows || 0) !== 1) return false;
  return true;
}

export async function failUserImageCleanup(
  connection,
  { jobId, leaseToken, attempts, nextRetryAt, errorCode }
) {
  const [result] = await connection.query(
    `UPDATE user_image_asset_cleanup_jobs
     SET status = 'retry', attempts = ?, next_retry_at = ?, last_error_code = ?,
         lease_token = NULL, lease_expires_at = NULL
     WHERE id = ? AND status IN ('leased', 'deleting') AND lease_token = ?`,
    [Number(attempts), nextRetryAt, String(errorCode), Number(jobId), String(leaseToken)]
  );
  return Number(result.affectedRows || 0) === 1;
}
