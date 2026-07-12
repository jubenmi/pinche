import { assertModerationTransition } from "./state-machine.js";

function lockClause(forUpdate) {
  return forUpdate ? " FOR UPDATE" : "";
}

export async function findModerationJobById(connection, id, { forUpdate = false } = {}) {
  const [rows] = await connection.query(
    `SELECT * FROM content_moderation_jobs WHERE id = ? LIMIT 1${lockClause(forUpdate)}`,
    [Number(id)]
  );
  return rows[0] || null;
}

export async function findModerationJobByDataId(
  connection,
  dataId,
  { forUpdate = false } = {}
) {
  const [rows] = await connection.query(
    `SELECT * FROM content_moderation_jobs WHERE data_id = ? LIMIT 1${lockClause(forUpdate)}`,
    [String(dataId)]
  );
  return rows[0] || null;
}

export async function findModerationJobByProviderJobId(
  connection,
  provider,
  providerJobId,
  { forUpdate = false } = {}
) {
  const [rows] = await connection.query(
    `SELECT * FROM content_moderation_jobs
     WHERE provider = ? AND provider_job_id = ? LIMIT 1${lockClause(forUpdate)}`,
    [String(provider), String(providerJobId)]
  );
  return rows[0] || null;
}

export async function createModerationJob(connection, input) {
  const [result] = await connection.query(
    `INSERT INTO content_moderation_jobs
      (subject_type, subject_id, subject_version, provider, data_id, policy_id, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [
      String(input.subjectType),
      String(input.subjectId),
      String(input.subjectVersion),
      String(input.provider),
      String(input.dataId),
      input.policyId ? String(input.policyId) : null
    ]
  );
  return findModerationJobById(connection, result.insertId);
}

export async function recordModerationSubmission(
  connection,
  { jobId, providerJobId, fromStatus = "pending" }
) {
  const [result] = await connection.query(
    `UPDATE content_moderation_jobs
     SET status = 'processing', provider_job_id = ?, submitted_at = CURRENT_TIMESTAMP,
         attempt_count = attempt_count + 1, last_error_code = NULL,
         next_retry_at = NULL, lease_token = NULL, lease_expires_at = NULL
     WHERE id = ? AND status = ? AND decided_by_admin_user_id IS NULL`,
    [providerJobId ? String(providerJobId) : null, Number(jobId), fromStatus]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function transitionModerationJob(connection, input) {
  assertModerationTransition(input.fromStatus, input.toStatus, {
    source: input.source,
    decidedByAdminUserId: input.decidedByAdminUserId
  });
  if (input.fromStatus === input.toStatus) return false;
  const providerGuard = input.source === "admin" ? "" : " AND decided_by_admin_user_id IS NULL";
  const adminUserId = input.source === "admin" ? Number(input.adminUserId) : null;
  const completed = ["approved", "rejected"].includes(input.toStatus);
  const [result] = await connection.query(
    `UPDATE content_moderation_jobs
     SET status = ?, suggestion = ?, label = ?, sub_label = ?, score = ?,
         response_summary_json = ?, last_error_code = ?,
         decided_by_admin_user_id = COALESCE(?, decided_by_admin_user_id),
         decision_reason = COALESCE(?, decision_reason),
         completed_at = ${completed ? "CURRENT_TIMESTAMP" : "completed_at"},
         lease_token = NULL, lease_expires_at = NULL
     WHERE id = ? AND status = ?${providerGuard}`,
    [
      input.toStatus,
      input.result?.suggestion || null,
      input.result?.label || null,
      input.result?.subLabel || null,
      Number.isFinite(Number(input.result?.score)) ? Number(input.result.score) : null,
      input.responseSummary ? JSON.stringify(input.responseSummary) : null,
      input.errorCode || null,
      adminUserId,
      input.reason || null,
      Number(input.jobId),
      input.fromStatus
    ]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function createTextProposal(connection, input) {
  const [result] = await connection.query(
    `INSERT INTO content_moderation_text_proposals
      (moderation_job_id, subject_type, subject_id, base_version,
       normalized_payload_json, payload_digest, status, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [
      Number(input.jobId),
      String(input.subjectType),
      String(input.subjectId),
      String(input.baseVersion),
      JSON.stringify(input.normalizedPayload),
      String(input.payloadDigest),
      Number(input.userId)
    ]
  );
  return result.insertId;
}

export async function markTextProposalStatus(connection, { jobId, fromStatus, toStatus }) {
  const [result] = await connection.query(
    `UPDATE content_moderation_text_proposals
     SET status = ?, applied_at = IF(? = 'approved', CURRENT_TIMESTAMP, applied_at)
     WHERE moderation_job_id = ? AND status = ?`,
    [toStatus, toStatus, Number(jobId), fromStatus]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function createAuditLog(connection, input) {
  const [result] = await connection.query(
    `INSERT INTO content_moderation_audit_logs
      (moderation_job_id, admin_user_id, action, previous_status, next_status, reason)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      Number(input.jobId),
      Number(input.adminUserId),
      String(input.action),
      String(input.previousStatus),
      String(input.nextStatus),
      input.reason ? String(input.reason) : null
    ]
  );
  return result.insertId;
}

export async function findModerationMedia(connection, job, { forUpdate = false } = {}) {
  if (!String(job?.subject_type || "").startsWith("album_")) return null;
  const [rows] = await connection.query(
    `SELECT * FROM session_album_photos WHERE id = ? LIMIT 1${lockClause(forUpdate)}`,
    [Number(job.subject_id)]
  );
  return rows[0] || null;
}

export async function transitionMediaModeration(
  connection,
  { mediaId, fromStatuses, toStatus }
) {
  const placeholders = fromStatuses.map(() => "?").join(", ");
  const [result] = await connection.query(
    `UPDATE session_album_photos SET moderation_status = ?
     WHERE id = ? AND status = 'active' AND moderation_status IN (${placeholders})`,
    [toStatus, Number(mediaId), ...fromStatuses]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function enqueueRejectedMediaCleanup(connection, media) {
  const mediaType = media.media_type === "video" ? "video" : "image";
  let storageKind = "cos";
  let objectKey = null;
  let localPath = null;
  let objectUrls = null;
  if (mediaType === "image") {
    if (media.object_key) objectKey = String(media.object_key);
    else {
      storageKind = "local";
      localPath = String(media.photo_url || "");
    }
  } else {
    storageKind = "multi";
    objectUrls = [...new Set([
      media.source_url,
      media.display_url,
      media.cover_url
    ].filter(Boolean))].map((value) => ({
      storageKind: String(value).startsWith("/uploads/") ? "cos" : "cos",
      objectKey: String(value).replace(/^\//, "")
    }));
  }
  const [result] = await connection.query(
    `INSERT INTO session_album_object_cleanup_jobs
      (media_id, session_id, storage_kind, object_key, local_path, object_urls_json, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [
      Number(media.id),
      Number(media.session_id),
      storageKind,
      objectKey,
      localPath,
      objectUrls ? JSON.stringify(objectUrls) : null
    ]
  );
  return result.insertId;
}
