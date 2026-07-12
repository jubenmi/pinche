import {
  assertModerationTransition,
  assertTextProposalTransition
} from "./state-machine.js";
import { projectSafeTextAppliedResult } from "./text-applied-result.js";

function lockClause(forUpdate) {
  return forUpdate ? " FOR UPDATE" : "";
}

function idempotencyConflict(message) {
  const error = new Error(message);
  error.code = "CONTENT_MODERATION_IDEMPOTENCY_CONFLICT";
  error.statusCode = 409;
  return error;
}

function duplicateKeyError(error) {
  return error?.code === "ER_DUP_ENTRY" || Number(error?.errno) === 1062;
}

function safeAppliedResultJson(result) {
  const safe = projectSafeTextAppliedResult(result);
  return safe ? JSON.stringify(safe) : null;
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

export async function findModerationAttemptByProviderJobId(
  connection,
  provider,
  providerJobId,
  { forUpdate = false } = {}
) {
  const [rows] = await connection.query(
    `SELECT * FROM content_moderation_provider_attempts
     WHERE provider = ? AND provider_job_id = ? LIMIT 1${lockClause(forUpdate)}`,
    [String(provider), String(providerJobId)]
  );
  return rows[0] || null;
}

export async function findCurrentModerationAttempt(
  connection,
  jobId,
  { forUpdate = false } = {}
) {
  const [rows] = await connection.query(
    `SELECT * FROM content_moderation_provider_attempts
     WHERE moderation_job_id = ? AND is_current = 1 LIMIT 1${lockClause(forUpdate)}`,
    [Number(jobId)]
  );
  return rows[0] || null;
}

export async function retireCurrentModerationAttempt(connection, { jobId }) {
  const [result] = await connection.query(
    `UPDATE content_moderation_provider_attempts
     SET is_current = 0
     WHERE moderation_job_id = ? AND is_current = 1`,
    [Number(jobId)]
  );
  return Number(result.affectedRows || 0);
}

export async function createModerationAttempt(connection, input) {
  const [result] = await connection.query(
    `INSERT INTO content_moderation_provider_attempts
      (moderation_job_id, provider, provider_job_id, attempt_no, is_current, response_summary_json)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [
      Number(input.jobId),
      String(input.provider),
      String(input.providerJobId),
      Number(input.attemptNo),
      input.responseSummary ? JSON.stringify(input.responseSummary) : null
    ]
  );
  return {
    id: Number(result.insertId),
    moderation_job_id: Number(input.jobId),
    provider: String(input.provider),
    provider_job_id: String(input.providerJobId),
    attempt_no: Number(input.attemptNo),
    is_current: 1
  };
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
  {
    jobId,
    provider: requestedProvider,
    providerJobId,
    fromStatus = "pending",
    leaseToken = null,
    responseSummary = null
  }
) {
  const job = await findModerationJobById(connection, jobId, { forUpdate: true });
  const provider = String(requestedProvider || job?.provider || "");
  const normalizedProviderJobId = String(providerJobId || "").trim();
  if (
    !job ||
    !provider ||
    !normalizedProviderJobId ||
    String(job.provider) !== provider ||
    String(job.status) !== String(fromStatus) ||
    job.decided_by_admin_user_id !== null
  ) {
    return false;
  }
  if (leaseToken !== null && String(job.lease_token || "") !== String(leaseToken)) {
    return false;
  }

  await retireCurrentModerationAttempt(connection, { jobId: job.id });
  await createModerationAttempt(connection, {
    jobId: job.id,
    provider,
    providerJobId: normalizedProviderJobId,
    attemptNo: Number(job.attempt_count || 0) + 1,
    responseSummary
  });
  const [result] = await connection.query(
    `UPDATE content_moderation_jobs
     SET status = 'processing', provider_job_id = ?, submitted_at = CURRENT_TIMESTAMP,
         attempt_count = attempt_count + 1, last_error_code = NULL,
         next_retry_at = NULL, lease_token = NULL, lease_expires_at = NULL
     WHERE id = ? AND status = ? AND decided_by_admin_user_id IS NULL
       AND (? IS NULL OR lease_token = ?)`,
    [normalizedProviderJobId, Number(jobId), fromStatus, leaseToken, leaseToken]
  );
  if (Number(result.affectedRows || 0) !== 1) {
    const error = new Error("moderation submission changed concurrently");
    error.code = "CONTENT_MODERATION_SUBMISSION_STALE";
    throw error;
  }
  return true;
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
  const byIdempotency = await findTextProposalByIdempotency(connection, input, { forUpdate: true });
  if (byIdempotency) return compatibleTextProposalId(byIdempotency, input);

  const byJob = await findTextProposalByJobId(connection, input.jobId, { forUpdate: true });
  if (byJob) return compatibleTextProposalId(byJob, input);

  try {
    const [result] = await connection.query(
      `INSERT INTO content_moderation_text_proposals
        (moderation_job_id, subject_type, subject_id, base_version, action,
         normalized_payload_json, payload_digest, idempotency_key, status, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        Number(input.jobId),
        String(input.subjectType),
        String(input.subjectId),
        String(input.baseVersion),
        String(input.action),
        JSON.stringify(input.normalizedPayload),
        String(input.payloadDigest),
        String(input.idempotencyKey),
        Number(input.userId)
      ]
    );
    return result.insertId;
  } catch (error) {
    if (!duplicateKeyError(error)) throw error;
    const concurrentProposal = await findTextProposalByIdempotency(connection, input, { forUpdate: true }) ||
      await findTextProposalByJobId(connection, input.jobId, { forUpdate: true });
    if (concurrentProposal) return compatibleTextProposalId(concurrentProposal, input);
    throw idempotencyConflict("text proposal idempotency conflict");
  }
}

function compatibleTextProposalId(proposal, input) {
  if (
    Number(proposal.moderation_job_id) !== Number(input.jobId) ||
    String(proposal.action) !== String(input.action) ||
    String(proposal.idempotency_key) !== String(input.idempotencyKey)
  ) {
    throw idempotencyConflict("text proposal idempotency key belongs to another request");
  }
  if (String(proposal.payload_digest) !== String(input.payloadDigest)) {
    if (input.allowStaleIdempotencyReplay === true && proposal.status === "stale") {
      return Number(proposal.id);
    }
    throw idempotencyConflict("text proposal idempotency key belongs to another request");
  }
  return Number(proposal.id);
}

export async function findTextProposalByIdempotency(
  connection,
  input,
  { forUpdate = false } = {}
) {
  const [rows] = await connection.query(
    `SELECT * FROM content_moderation_text_proposals
     WHERE created_by_user_id = ? AND action = ? AND idempotency_key = ?
     LIMIT 1${lockClause(forUpdate)}`,
    [Number(input.userId), String(input.action), String(input.idempotencyKey)]
  );
  return rows[0] || null;
}

export async function markTextProposalStatus(
  connection,
  { jobId, fromStatus, toStatus, appliedResult = null }
) {
  assertTextProposalTransition(fromStatus, toStatus);
  const appliedResultJson = safeAppliedResultJson(appliedResult);
  const [result] = await connection.query(
    `UPDATE content_moderation_text_proposals
     SET status = ?, applied_at = IF(? = 'approved', CURRENT_TIMESTAMP, applied_at),
         applied_result_json = IF(? = 'approved', ?, applied_result_json)
     WHERE moderation_job_id = ? AND status = ?`,
    [toStatus, toStatus, toStatus, appliedResultJson, Number(jobId), fromStatus]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function markTextProposalStale(connection, { jobId, fromStatus = "pending" }) {
  assertTextProposalTransition(fromStatus, "stale");
  const [result] = await connection.query(
    `UPDATE content_moderation_text_proposals
     SET status = 'stale'
     WHERE moderation_job_id = ? AND status = ?`,
    [Number(jobId), fromStatus]
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

export async function claimModerationRetryJobs(connection, input) {
  const providers = Array.isArray(input.providers)
    ? [...new Set(input.providers.map((value) => String(value || "").trim()).filter(Boolean))]
    : [];
  const subjectTypes = Array.isArray(input.subjectTypes)
    ? [...new Set(input.subjectTypes.map((value) => String(value || "").trim()).filter(Boolean))]
    : [];
  const providerFilter = providers.length > 0
    ? ` AND job.provider IN (${providers.map(() => "?").join(", ")})`
    : "";
  const subjectTypeFilter = subjectTypes.length > 0
    ? ` AND job.subject_type IN (${subjectTypes.map(() => "?").join(", ")})`
    : "";
  const [rows] = await connection.query(
    `SELECT job.*,
            media.object_key AS media_object_key,
            media.source_url AS media_source_url,
            proposal.normalized_payload_json AS proposal_payload_json
     FROM content_moderation_jobs job
     LEFT JOIN session_album_photos media
       ON job.subject_type IN ('album_image', 'album_video')
      AND media.id = CAST(job.subject_id AS UNSIGNED)
     LEFT JOIN content_moderation_text_proposals proposal
       ON proposal.moderation_job_id = job.id
     WHERE job.status IN ('pending', 'error')
       AND job.attempt_count < ?
       AND job.decided_by_admin_user_id IS NULL
       AND (job.next_retry_at IS NULL OR job.next_retry_at <= ?)
       AND (job.lease_expires_at IS NULL OR job.lease_expires_at <= ?)
       ${providerFilter}
       ${subjectTypeFilter}
     ORDER BY job.created_at
     LIMIT ? FOR UPDATE SKIP LOCKED`,
    [
      Number(input.retryLimit), input.now, input.now,
      ...providers, ...subjectTypes,
      Number(input.limit)
    ]
  );
  for (const row of rows) {
    await connection.query(
      `UPDATE content_moderation_jobs
       SET lease_token = ?, lease_expires_at = ?
       WHERE id = ? AND decided_by_admin_user_id IS NULL`,
      [input.leaseToken, input.leaseExpiresAt, row.id]
    );
    row.lease_token = input.leaseToken;
    row.lease_expires_at = input.leaseExpiresAt;
  }
  return rows;
}

export async function failModerationJob(connection, input) {
  const [result] = await connection.query(
    `UPDATE content_moderation_jobs
     SET status = 'error', attempt_count = ?, next_retry_at = ?,
         last_error_code = ?, lease_token = NULL, lease_expires_at = NULL
     WHERE id = ? AND lease_token = ? AND decided_by_admin_user_id IS NULL`,
    [
      Number(input.attempts),
      input.exhausted ? null : input.nextRetryAt,
      String(input.errorCode || "CONTENT_MODERATION_UNAVAILABLE").slice(0, 128),
      Number(input.jobId),
      input.leaseToken
    ]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function findTextProposalByJobId(
  connection,
  jobId,
  { forUpdate = false } = {}
) {
  const [rows] = await connection.query(
    `SELECT * FROM content_moderation_text_proposals
     WHERE moderation_job_id = ? LIMIT 1${lockClause(forUpdate)}`,
    [Number(jobId)]
  );
  return rows[0] || null;
}

export async function requeueModerationJob(connection, { jobId, fromStatus = "error" }) {
  const [result] = await connection.query(
    `UPDATE content_moderation_jobs
     SET status = 'pending', next_retry_at = CURRENT_TIMESTAMP,
         lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL
     WHERE id = ? AND status = ? AND decided_by_admin_user_id IS NULL`,
    [Number(jobId), fromStatus]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function listAdminModerationJobs(
  connection,
  { status, subjectType, label, dateFrom, dateTo, limit = 100 } = {}
) {
  const where = ["job.status IN ('review', 'error')"];
  const values = [];
  if (status) { where.push("job.status = ?"); values.push(String(status)); }
  if (subjectType) { where.push("job.subject_type = ?"); values.push(String(subjectType)); }
  if (label) { where.push("job.label = ?"); values.push(String(label)); }
  if (dateFrom) { where.push("job.created_at >= ?"); values.push(dateFrom); }
  if (dateTo) { where.push("job.created_at <= ?"); values.push(dateTo); }
  values.push(Math.max(1, Math.min(200, Number(limit) || 100)));
  const [rows] = await connection.query(
    `SELECT job.*, proposal.normalized_payload_json, proposal.base_version,
            media.session_id, media.uploader_user_id, media.media_type,
            media.processing_status, media.moderation_status
     FROM content_moderation_jobs job
     LEFT JOIN content_moderation_text_proposals proposal
       ON proposal.moderation_job_id = job.id
     LEFT JOIN session_album_photos media
       ON job.subject_type IN ('album_image', 'album_video')
      AND media.id = CAST(job.subject_id AS UNSIGNED)
     WHERE ${where.join(" AND ")}
     ORDER BY job.created_at DESC LIMIT ?`,
    values
  );
  return rows;
}

export async function getAdminModerationJob(connection, jobId) {
  const [rows] = await connection.query(
    `SELECT job.*, proposal.normalized_payload_json, proposal.base_version,
            proposal.status AS proposal_status, proposal.created_by_user_id,
            media.session_id, media.uploader_user_id, media.media_type,
            media.processing_status, media.moderation_status,
            media.object_key, media.source_url, media.display_url, media.cover_url
     FROM content_moderation_jobs job
     LEFT JOIN content_moderation_text_proposals proposal
       ON proposal.moderation_job_id = job.id
     LEFT JOIN session_album_photos media
       ON job.subject_type IN ('album_image', 'album_video')
      AND media.id = CAST(job.subject_id AS UNSIGNED)
     WHERE job.id = ? LIMIT 1`,
    [Number(jobId)]
  );
  return rows[0] || null;
}
