export async function insertAlbumImageIntent(connection, intent) {
  await connection.query(
    `INSERT INTO session_album_upload_intents
      (id, user_id, session_id, kind, object_key, source_content_type,
       source_byte_size, max_source_byte_size, status, upload_expires_at,
       finalize_deadline_at, cleanup_not_before)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      intent.id,
      intent.userId,
      intent.sessionId,
      intent.kind,
      intent.objectKey,
      intent.sourceContentType,
      intent.sourceByteSize,
      intent.maxSourceByteSize,
      intent.uploadExpiresAt,
      intent.finalizeDeadlineAt,
      intent.cleanupNotBefore
    ]
  );
  return findAlbumImageIntent(connection, intent.id);
}

export async function findAlbumImageIntent(
  connection,
  uploadId,
  { forUpdate = false } = {}
) {
  const [rows] = await connection.query(
    `SELECT * FROM session_album_upload_intents
     WHERE id = ? LIMIT 1 ${forUpdate ? "FOR UPDATE" : ""}`,
    [String(uploadId)]
  );
  return rows[0] || null;
}

export async function findAlbumImageIntentByObjectKey(
  connection,
  { userId, objectKey },
  { forUpdate = false } = {}
) {
  const [rows] = await connection.query(
    `SELECT * FROM session_album_upload_intents
     WHERE user_id = ? AND object_key = ?
     LIMIT 1 ${forUpdate ? "FOR UPDATE" : ""}`,
    [Number(userId), String(objectKey)]
  );
  return rows[0] || null;
}

export async function bindLegacyIntentByteSize(connection, { uploadId, byteSize }) {
  const [result] = await connection.query(
    `UPDATE session_album_upload_intents
     SET source_byte_size = COALESCE(source_byte_size, ?)
     WHERE id = ?
       AND status = 'pending'
       AND (source_byte_size IS NULL OR source_byte_size = ?)`,
    [Number(byteSize), String(uploadId), Number(byteSize)]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function recordAlbumImageAuthorization(
  connection,
  { uploadId, authorizationExpiresAt, cleanupNotBefore }
) {
  const [result] = await connection.query(
    `UPDATE session_album_upload_intents
     SET last_authorization_expires_at = GREATEST(
           COALESCE(last_authorization_expires_at, ?), ?
         ),
         cleanup_not_before = GREATEST(cleanup_not_before, ?)
     WHERE id = ? AND status = 'pending'`,
    [authorizationExpiresAt, authorizationExpiresAt, cleanupNotBefore, String(uploadId)]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function markAlbumImageIntentState(
  connection,
  { uploadId, fromStatuses, toStatus, errorCode = null }
) {
  const parameterMarks = fromStatuses.map(() => "?").join(", ");
  const [result] = await connection.query(
    `UPDATE session_album_upload_intents
     SET status = ?, last_error_code = ?
     WHERE id = ? AND status IN (${parameterMarks})`,
    [toStatus, errorCode, String(uploadId), ...fromStatuses]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function expireOverdueAlbumImageIntents(connection, now) {
  const [result] = await connection.query(
    `UPDATE session_album_upload_intents
     SET status = 'expired', last_error_code = 'UPLOAD_INTENT_EXPIRED'
     WHERE status IN ('pending', 'processing')
       AND finalize_deadline_at <= ?`,
    [now]
  );
  return Number(result.affectedRows || 0);
}

export async function claimExpiredAlbumImageIntents(
  connection,
  { leaseToken, now, leaseExpiresAt, limit }
) {
  const [rows] = await connection.query(
    `SELECT * FROM session_album_upload_intents
     WHERE (
       status IN ('expired', 'rejected', 'cleanup_failed')
       OR (status = 'cleanup_pending' AND lease_expires_at <= ?)
     )
       AND cleanup_not_before <= ?
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY cleanup_not_before, created_at
     LIMIT ? FOR UPDATE SKIP LOCKED`,
    [now, now, now, Number(limit)]
  );
  for (const row of rows) {
    await connection.query(
      `UPDATE session_album_upload_intents
       SET status = 'cleanup_pending', lease_token = ?, lease_expires_at = ?
       WHERE id = ?`,
      [leaseToken, leaseExpiresAt, row.id]
    );
  }
  return rows;
}

export async function claimAlbumObjectCleanupJobs(
  connection,
  { leaseToken, now, leaseExpiresAt, limit }
) {
  const [rows] = await connection.query(
    `SELECT * FROM session_album_object_cleanup_jobs
     WHERE (
       status IN ('pending', 'retry')
       OR (status = 'leased' AND lease_expires_at <= ?)
     )
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY created_at
     LIMIT ? FOR UPDATE SKIP LOCKED`,
    [now, now, Number(limit)]
  );
  for (const row of rows) {
    await connection.query(
      `UPDATE session_album_object_cleanup_jobs
       SET status = 'leased', lease_token = ?, lease_expires_at = ?
       WHERE id = ?`,
      [leaseToken, leaseExpiresAt, row.id]
    );
  }
  return rows;
}

export async function claimAllCleanup(connection, input) {
  const intents = await claimExpiredAlbumImageIntents(connection, input);
  const remaining = Math.max(0, Number(input.limit) - intents.length);
  const media = remaining > 0
    ? await claimAlbumObjectCleanupJobs(connection, { ...input, limit: remaining })
    : [];
  return [
    ...intents.map((row) => ({ type: "intent", row })),
    ...media.map((row) => ({ type: "media", row }))
  ];
}

export async function completeIntentCleanup(connection, { id, leaseToken }) {
  const [result] = await connection.query(
    `UPDATE session_album_upload_intents
     SET status = 'cleaned', lease_token = NULL, lease_expires_at = NULL,
         next_retry_at = NULL, last_error_code = NULL
     WHERE id = ? AND status = 'cleanup_pending' AND lease_token = ?`,
    [id, leaseToken]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function failIntentCleanup(
  connection,
  { id, leaseToken, attempts, nextRetryAt, errorCode }
) {
  const [result] = await connection.query(
    `UPDATE session_album_upload_intents
     SET status = 'cleanup_failed', cleanup_attempts = ?, next_retry_at = ?,
         last_error_code = ?, lease_token = NULL, lease_expires_at = NULL
     WHERE id = ? AND status = 'cleanup_pending' AND lease_token = ?`,
    [attempts, nextRetryAt, errorCode, id, leaseToken]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function completeMediaCleanup(
  connection,
  { jobId, mediaId, leaseToken }
) {
  const [jobs] = await connection.query(
    `SELECT * FROM session_album_object_cleanup_jobs
     WHERE id = ? AND status = 'leased' AND lease_token = ?
     LIMIT 1 FOR UPDATE`,
    [jobId, leaseToken]
  );
  if (!jobs[0] || Number(jobs[0].media_id) !== Number(mediaId)) return false;
  const [mediaRows] = await connection.query(
    "SELECT * FROM session_album_photos WHERE id = ? LIMIT 1 FOR UPDATE",
    [mediaId]
  );
  if (mediaRows[0]) {
    await connection.query("DELETE FROM session_album_photo_tags WHERE photo_id = ?", [mediaId]);
    await connection.query("DELETE FROM session_album_photos WHERE id = ? AND status = 'deleting'", [mediaId]);
  }
  const [result] = await connection.query(
    `UPDATE session_album_object_cleanup_jobs
     SET status = 'cleaned', completed_at = CURRENT_TIMESTAMP,
         lease_token = NULL, lease_expires_at = NULL, next_retry_at = NULL,
         last_error_code = NULL
     WHERE id = ? AND status = 'leased' AND lease_token = ?`,
    [jobId, leaseToken]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function failMediaCleanup(
  connection,
  { jobId, leaseToken, attempts, nextRetryAt, errorCode }
) {
  const [result] = await connection.query(
    `UPDATE session_album_object_cleanup_jobs
     SET status = 'retry', attempts = ?, next_retry_at = ?, last_error_code = ?,
         lease_token = NULL, lease_expires_at = NULL
     WHERE id = ? AND status = 'leased' AND lease_token = ?`,
    [attempts, nextRetryAt, errorCode, jobId, leaseToken]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function listBackfillCandidates(connection, { afterId = 0, limit = 100 } = {}) {
  const [rows] = await connection.query(
    `SELECT id, photo_url
     FROM session_album_photos
     WHERE id > ? AND media_type = 'image' AND status = 'active'
       AND object_key IS NULL
     ORDER BY id LIMIT ?`,
    [Number(afterId), Number(limit)]
  );
  return rows;
}

export async function updateBackfilledObject(
  connection,
  { id, objectKey, objectEtag, photoUrl }
) {
  const [result] = await connection.query(
    `UPDATE session_album_photos
     SET object_key = ?, object_etag = ?
     WHERE id = ? AND object_key IS NULL AND photo_url = ?`,
    [objectKey, objectEtag, Number(id), photoUrl]
  );
  return Number(result.affectedRows || 0) === 1;
}
