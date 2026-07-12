import {
  assertModerationTransition,
  assertTextProposalTransition
} from "./state-machine.js";
import { MODERATION_RETRY_LEASE_MIN_MS, MODERATION_RETRY_ROUTES } from "./constants.js";
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

const RETRY_IMAGE_OBJECT_KEY = /^uploads\/session-album\/display\/[A-Za-z0-9._-]+$/;
const RETRY_VIDEO_OBJECT_KEY = /^uploads\/session-album\/videos\/source\/[A-Za-z0-9._-]+\.mp4$/;
const RETRY_ROUTE_KEYS = new Set(MODERATION_RETRY_ROUTES.map((route) => (
  `${route.provider}:${route.subjectType}`
)));

function supportedRetryRoute(job) {
  return RETRY_ROUTE_KEYS.has(`${job?.provider}:${job?.subject_type}`);
}

function invalidRetryFacts() {
  const error = new Error("content moderation retry facts are no longer valid");
  error.code = "CONTENT_MODERATION_RETRY_FACTS_INVALID";
  return error;
}

function currentRetryMediaFacts(job, media) {
  const kind = String(job?.subject_type || "");
  const subjectVersion = String(job?.subject_version || "");
  const expectedMediaType = kind === "album_image" ? "image" : kind === "album_video" ? "video" : "";
  const objectKey = String(kind === "album_image" ? media?.object_key : media?.source_url || "")
    .replace(/^\//, "");
  const validObjectKey = kind === "album_image"
    ? RETRY_IMAGE_OBJECT_KEY.test(objectKey)
    : RETRY_VIDEO_OBJECT_KEY.test(objectKey);
  const uploaderUserId = Number(media?.uploader_user_id);
  if (
    !expectedMediaType ||
    !media ||
    Number(media.id) !== Number(job?.subject_id) ||
    String(media.status) !== "active" ||
    String(media.media_type) !== expectedMediaType ||
    !["pending", "error"].includes(String(media.moderation_status)) ||
    String(media.moderation_object_version || "") !== subjectVersion ||
    (kind === "album_image" && String(media.object_etag || "") !== subjectVersion) ||
    !validObjectKey ||
    !Number.isInteger(uploaderUserId) || uploaderUserId <= 0
  ) {
    return null;
  }
  return {
    kind,
    mediaId: Number(media.id),
    subjectVersion,
    objectKey,
    uploaderUserId
  };
}

export async function findModerationJobById(
  connection,
  id,
  { forUpdate = false, leaseToken = null } = {}
) {
  const hasLeaseToken = leaseToken !== null && leaseToken !== undefined;
  const leaseClause = hasLeaseToken
    ? " AND lease_token = ? AND lease_expires_at > CURRENT_TIMESTAMP"
    : "";
  const [rows] = await connection.query(
    `SELECT * FROM content_moderation_jobs WHERE id = ?${leaseClause} LIMIT 1${lockClause(forUpdate)}`,
    [Number(id), ...(hasLeaseToken ? [String(leaseToken)] : [])]
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

async function nextModerationAttemptNo(connection, jobId) {
  // recordModerationSubmission holds the moderation job row FOR UPDATE before
  // reaching this query. Every attempt writer takes that same job lock, so the
  // aggregate cannot race another attempt insert for this job. This deliberately
  // decouples immutable provider-attempt numbering from retry attempt_count,
  // which an administrator may decrement to allow one more claim.
  const [rows] = await connection.query(
    `SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no
     FROM content_moderation_provider_attempts
     WHERE moderation_job_id = ?`,
    [Number(jobId)]
  );
  const attemptNo = Number(rows[0]?.attempt_no);
  return Number.isInteger(attemptNo) && attemptNo > 0 ? attemptNo : 1;
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

export async function claimInitialModerationLease(
  connection,
  { jobId, leaseToken, leaseExpiresAt } = {}
) {
  const token = String(leaseToken || "").trim();
  if (!Number.isInteger(Number(jobId)) || Number(jobId) <= 0 || !token || !(leaseExpiresAt instanceof Date)) {
    return false;
  }
  const [result] = await connection.query(
    `UPDATE content_moderation_jobs
     SET lease_token = ?, lease_expires_at = ?
     WHERE id = ? AND status = 'pending' AND attempt_count = 0
       AND lease_token IS NULL AND lease_expires_at IS NULL
       AND decided_by_admin_user_id IS NULL`,
    [token, leaseExpiresAt, Number(jobId)]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function renewModerationLease(
  connection,
  { jobId, leaseToken, fromStatus, leaseDurationMs = MODERATION_RETRY_LEASE_MIN_MS } = {}
) {
  const token = String(leaseToken || "").trim();
  const status = String(fromStatus || "").trim();
  const durationMs = Number(leaseDurationMs);
  if (
    !Number.isInteger(Number(jobId)) || Number(jobId) <= 0 ||
    !token || !["pending", "error"].includes(status) ||
    !Number.isFinite(durationMs) || durationMs < MODERATION_RETRY_LEASE_MIN_MS
  ) {
    return false;
  }
  const durationMicroseconds = Math.round(durationMs * 1_000);
  const [result] = await connection.query(
    `UPDATE content_moderation_jobs
     SET lease_expires_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MICROSECOND)
     WHERE id = ? AND lease_token = ? AND lease_expires_at > CURRENT_TIMESTAMP
       AND status = ? AND status IN ('pending', 'error')
       AND retry_exhausted_at IS NULL AND decided_by_admin_user_id IS NULL`,
    [durationMicroseconds, Number(jobId), token, status]
  );
  return Number(result.affectedRows || 0) === 1;
}

async function retrySubmissionFactsMatch(connection, job, retryFacts) {
  if (!retryFacts) return true;
  if (
    String(retryFacts.kind || "") !== String(job?.subject_type || "") ||
    Number(retryFacts.mediaId) !== Number(job?.subject_id) ||
    String(retryFacts.subjectVersion || "") !== String(job?.subject_version || "")
  ) {
    return false;
  }
  const media = await findModerationMedia(connection, job, { forUpdate: true });
  const current = currentRetryMediaFacts(job, media);
  return Boolean(
    current &&
    current.kind === String(retryFacts.kind) &&
    current.mediaId === Number(retryFacts.mediaId) &&
    current.subjectVersion === String(retryFacts.subjectVersion) &&
    current.objectKey === String(retryFacts.objectKey || "") &&
    current.uploaderUserId === Number(retryFacts.uploaderUserId)
  );
}

export async function recordModerationSubmission(
  connection,
  {
    jobId,
    provider: requestedProvider,
    providerJobId,
    fromStatus = "pending",
    leaseToken = null,
    responseSummary = null,
    retryFacts = null
  }
) {
  const normalizedLeaseToken = String(leaseToken || "").trim();
  if (!normalizedLeaseToken) return false;
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
  if (String(job.lease_token || "") !== normalizedLeaseToken) {
    return false;
  }
  if (!(await retrySubmissionFactsMatch(connection, job, retryFacts))) return false;

  const [result] = await connection.query(
    `UPDATE content_moderation_jobs
     SET status = 'processing', provider_job_id = ?, submitted_at = CURRENT_TIMESTAMP,
         attempt_count = attempt_count + 1, last_error_code = NULL,
         next_retry_at = NULL, retry_exhausted_at = NULL,
         lease_token = NULL, lease_expires_at = NULL
     WHERE id = ? AND status = ? AND decided_by_admin_user_id IS NULL
       AND (? IS NULL OR (lease_token = ? AND lease_expires_at > CURRENT_TIMESTAMP))`,
    [normalizedProviderJobId, Number(jobId), fromStatus, normalizedLeaseToken, normalizedLeaseToken]
  );
  if (Number(result.affectedRows || 0) !== 1) return false;
  await retireCurrentModerationAttempt(connection, { jobId: job.id });
  await createModerationAttempt(connection, {
    jobId: job.id,
    provider,
    providerJobId: normalizedProviderJobId,
    attemptNo: await nextModerationAttemptNo(connection, job.id),
    responseSummary
  });
  return true;
}

export async function transitionModerationJob(connection, input) {
  assertModerationTransition(input.fromStatus, input.toStatus, {
    source: input.source,
    decidedByAdminUserId: input.decidedByAdminUserId
  });
  if (input.fromStatus === input.toStatus) return false;
  const providerGuard = input.source === "admin" ? "" : " AND decided_by_admin_user_id IS NULL";
  const leaseGuard = input.leaseToken === undefined || input.leaseToken === null
    ? ""
    : " AND lease_token = ? AND lease_expires_at > CURRENT_TIMESTAMP";
  const retry = input.toStatus === "error" && input.retry && typeof input.retry === "object"
    ? {
      exhausted: input.retry.exhausted === true,
      nextRetryAt: input.retry.exhausted === true ? null : input.retry.nextRetryAt,
      attempts: input.retry.attempts === undefined ? null : Number(input.retry.attempts)
    }
    : null;
  if (retry && !retry.exhausted && !(retry.nextRetryAt instanceof Date)) {
    throw new TypeError("retry.nextRetryAt must be a Date when a moderation error is retryable");
  }
  if (retry && retry.attempts !== null && (!Number.isInteger(retry.attempts) || retry.attempts < 1)) {
    throw new TypeError("retry.attempts must be a positive integer when supplied");
  }
  const retrySet = retry
    ? `${retry.attempts === null ? "" : ", attempt_count = ?"}, next_retry_at = ?, retry_exhausted_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END`
    : "";
  const adminUserId = input.source === "admin" ? Number(input.adminUserId) : null;
  const completed = ["approved", "rejected"].includes(input.toStatus);
  const [result] = await connection.query(
    `UPDATE content_moderation_jobs
     SET status = ?, suggestion = ?, label = ?, sub_label = ?, score = ?,
         response_summary_json = ?, last_error_code = ?${retrySet},
         decided_by_admin_user_id = COALESCE(?, decided_by_admin_user_id),
         decision_reason = COALESCE(?, decision_reason),
         completed_at = ${completed ? "CURRENT_TIMESTAMP" : "completed_at"},
         lease_token = NULL, lease_expires_at = NULL
     WHERE id = ? AND status = ?${providerGuard}${leaseGuard}`,
    [
      input.toStatus,
      input.result?.suggestion || null,
      input.result?.label || null,
      input.result?.subLabel || null,
      Number.isFinite(Number(input.result?.score)) ? Number(input.result.score) : null,
      input.responseSummary ? JSON.stringify(input.responseSummary) : null,
      input.errorCode || null,
      ...(retry ? [
        ...(retry.attempts === null ? [] : [retry.attempts]),
        retry.nextRetryAt,
        retry.exhausted ? 1 : 0
      ] : []),
      adminUserId,
      input.reason || null,
      Number(input.jobId),
      input.fromStatus,
      ...(leaseGuard ? [String(input.leaseToken)] : [])
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

export async function rehydrateModerationRetryJob(connection, { jobId, leaseToken } = {}) {
  const token = String(leaseToken || "");
  if (!Number.isInteger(Number(jobId)) || Number(jobId) <= 0 || !token) return null;
  const [jobs] = await connection.query(
    `SELECT * FROM content_moderation_jobs
     WHERE id = ?
       AND status IN ('pending', 'error')
       AND lease_token = ?
       AND lease_expires_at > CURRENT_TIMESTAMP
       AND retry_exhausted_at IS NULL
       AND decided_by_admin_user_id IS NULL
     LIMIT 1 FOR UPDATE`,
    [Number(jobId), token]
  );
  const job = jobs[0] || null;
  if (!job) return null;
  if (!supportedRetryRoute(job)) throw invalidRetryFacts();

  if (String(job.subject_type).startsWith("album_")) {
    const media = await findModerationMedia(connection, job, { forUpdate: true });
    const retryFacts = currentRetryMediaFacts(job, media);
    if (!retryFacts) throw invalidRetryFacts();
    return {
      kind: retryFacts.kind === "album_image" ? "wechat_image" : "tencent_video",
      job,
      objectKey: retryFacts.objectKey,
      uploaderUserId: retryFacts.uploaderUserId,
      retryFacts
    };
  }

  const proposal = await findTextProposalByJobId(connection, job.id, { forUpdate: true });
  if (
    !proposal ||
    String(proposal.status) !== "pending" ||
    Number(proposal.moderation_job_id) !== Number(job.id) ||
    String(proposal.subject_type || "") !== String(job.subject_type) ||
    String(proposal.subject_id || "") !== String(job.subject_id) ||
    !String(proposal.action || "").trim() ||
    !String(proposal.base_version || "").trim() ||
    !String(proposal.idempotency_key || "").trim() ||
    !String(proposal.payload_digest || "").trim() ||
    !Number.isInteger(Number(proposal.created_by_user_id)) ||
    Number(proposal.created_by_user_id) <= 0
  ) {
    throw invalidRetryFacts();
  }
  const [users] = await connection.query(
    "SELECT id, open_id FROM users WHERE id = ? LIMIT 1 FOR UPDATE",
    [Number(proposal.created_by_user_id)]
  );
  const actorOpenid = String(users[0]?.open_id || "").trim();
  if (!actorOpenid) throw invalidRetryFacts();
  return { kind: "text", job, proposal, actorOpenid };
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

function normalizeCleanupObjectEntry(entry) {
  const storageKind = String(entry?.storageKind || "").trim();
  if (storageKind === "cos") {
    const objectKey = String(entry?.objectKey || "").trim().replace(/^\//, "");
    return objectKey ? { storageKind, objectKey } : null;
  }
  if (storageKind === "local") {
    const localPath = String(entry?.localPath || "").trim();
    return localPath ? { storageKind, localPath } : null;
  }
  return null;
}

function cleanupObjectEntries(value) {
  let entries = value;
  if (typeof entries === "string") {
    try {
      entries = JSON.parse(entries);
    } catch {
      entries = [];
    }
  }
  if (!Array.isArray(entries)) return [];
  return entries.map(normalizeCleanupObjectEntry).filter(Boolean);
}

function cleanupObjectEntryKey(entry) {
  return entry.storageKind === "cos"
    ? `cos:${entry.objectKey}`
    : `local:${entry.localPath}`;
}

function mergeCleanupObjectEntries(...groups) {
  const unique = new Map();
  for (const group of groups) {
    for (const entry of cleanupObjectEntries(group)) {
      const key = cleanupObjectEntryKey(entry);
      if (!unique.has(key)) unique.set(key, entry);
    }
  }
  return [...unique.values()];
}

async function findRejectedMediaCleanupJob(connection, mediaId) {
  const [rows] = await connection.query(
    `SELECT * FROM session_album_object_cleanup_jobs
     WHERE media_id = ? LIMIT 1 FOR UPDATE`,
    [Number(mediaId)]
  );
  return rows[0] || null;
}

async function insertRejectedMediaCleanupJob(
  connection,
  { media, storageKind, objectKey, localPath, objectUrls }
) {
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
  return result;
}

async function enqueueRejectedVideoCleanup(
  connection,
  media,
  objectUrls,
  { lateOutputEvent = false } = {}
) {
  let cleanupJob = await findRejectedMediaCleanupJob(connection, media.id);
  if (!cleanupJob) {
    const result = await insertRejectedMediaCleanupJob(connection, {
      media,
      storageKind: "multi",
      objectKey: null,
      localPath: null,
      objectUrls
    });
    // Always re-read after the idempotent insert. Depending on MySQL client
    // flags, affectedRows cannot safely distinguish a fresh insert from the
    // duplicate-key no-op used to retrieve an existing job id.
    cleanupJob = await findRejectedMediaCleanupJob(connection, media.id);
    if (!cleanupJob) return result.insertId;
  }

  const existingObjectUrls = mergeCleanupObjectEntries(cleanupJob.object_urls_json);
  const mergedObjectUrls = mergeCleanupObjectEntries(existingObjectUrls, objectUrls);
  const cleanupChanged =
    cleanupJob.storage_kind !== "multi" ||
    JSON.stringify(existingObjectUrls) !== JSON.stringify(mergedObjectUrls);
  if (!cleanupChanged && !lateOutputEvent) return cleanupJob.id;

  // A validated late callback means CI observed an output event. Requeue even
  // when it reused the same deterministic key: a worker may have already
  // deleted the earlier object or still hold its old snapshot. Keep attempts,
  // error history, and all prior object entries.
  await connection.query(
    `UPDATE session_album_object_cleanup_jobs
     SET storage_kind = 'multi', object_key = NULL, local_path = NULL,
         object_urls_json = ?, status = 'pending', next_retry_at = NULL,
         lease_token = NULL, lease_expires_at = NULL, completed_at = NULL
     WHERE id = ?`,
    [JSON.stringify(mergedObjectUrls), Number(cleanupJob.id)]
  );
  return cleanupJob.id;
}

export async function enqueueRejectedMediaCleanup(
  connection,
  media,
  { lateOutputEvent = false } = {}
) {
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
    const objectUrlsForCleanup = [...new Set([
      media.source_url,
      media.display_url,
      media.cover_url
    ].filter(Boolean))];
    const localVideo = String(media.moderation_object_version || "").startsWith("local:");
    objectUrls = objectUrlsForCleanup.map((value) => localVideo
      ? { storageKind: "local", localPath: String(value) }
      : { storageKind: "cos", objectKey: String(value).replace(/^\//, "") }
    );
    return enqueueRejectedVideoCleanup(connection, media, objectUrls, { lateOutputEvent });
  }
  const result = await insertRejectedMediaCleanupJob(connection, {
    media,
    storageKind,
    objectKey,
    localPath,
    objectUrls
  });
  return result.insertId;
}

export async function claimModerationRetryJobs(connection, input) {
  const allowedRoutes = new Set(MODERATION_RETRY_ROUTES.map((route) => (
    `${route.provider}:${route.subjectType}`
  )));
  const routes = Array.isArray(input.routes)
    ? input.routes.map((route) => ({
      provider: String(route?.provider || "").trim(),
      subjectType: String(route?.subjectType || "").trim()
    }))
    : [];
  if (
    routes.length === 0 ||
    routes.some((route) => !allowedRoutes.has(`${route.provider}:${route.subjectType}`))
  ) {
    throw new TypeError("moderation retry routes must be explicit supported provider and subject-type pairs");
  }
  const uniqueRoutes = [...new Map(routes.map((route) => [
    `${route.provider}:${route.subjectType}`,
    route
  ])).values()];
  const routeFilter = ` AND (${uniqueRoutes.map(() => (
    "(job.provider = ? AND job.subject_type = ?)"
  )).join(" OR ")})`;
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
       AND job.retry_exhausted_at IS NULL
       AND job.decided_by_admin_user_id IS NULL
       AND (job.next_retry_at IS NULL OR job.next_retry_at <= ?)
       AND (job.lease_expires_at IS NULL OR job.lease_expires_at <= ?)
       ${routeFilter}
     ORDER BY job.created_at
     LIMIT ? FOR UPDATE SKIP LOCKED`,
    [
      Number(input.retryLimit), input.now, input.now,
      ...uniqueRoutes.flatMap((route) => [route.provider, route.subjectType]),
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
         retry_exhausted_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,
         last_error_code = ?, lease_token = NULL, lease_expires_at = NULL
     WHERE id = ? AND lease_token = ? AND lease_expires_at > CURRENT_TIMESTAMP
       AND retry_exhausted_at IS NULL AND decided_by_admin_user_id IS NULL`,
    [
      Number(input.attempts),
      input.exhausted ? null : input.nextRetryAt,
      input.exhausted === true ? 1 : 0,
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
         retry_exhausted_at = NULL, attempt_count = GREATEST(attempt_count - 1, 0),
         lease_token = NULL, lease_expires_at = NULL,
         last_error_code = NULL
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
