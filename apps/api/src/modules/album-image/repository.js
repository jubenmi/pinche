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
