import {
  assertModerationTransition,
  assertTextProposalTransition
} from "./state-machine.js";
import {
  MODERATION_IMAGE_SUBJECT_TYPES,
  MODERATION_RETRY_LEASE_MIN_MS,
  MODERATION_RETRY_ROUTES
} from "./constants.js";
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

function textProposalAuthorVisibilityFacts(input) {
  const version = input?.authorVisibilityVersion === undefined
    ? 0
    : Number(input.authorVisibilityVersion);
  if (![0, 1].includes(version) || !Number.isInteger(version)) {
    throw new TypeError("authorVisibilityVersion must be 0 or 1");
  }
  if (version === 0) {
    return { targetSubjectId: null, authorVisibilityVersion: 0 };
  }
  const targetSubjectId = String(input?.targetSubjectId || "").trim();
  if (!targetSubjectId || targetSubjectId.length > 128) {
    throw new TypeError("targetSubjectId is required for author-private proposals");
  }
  return { targetSubjectId, authorVisibilityVersion: 1 };
}

function safeAppliedResultJson(result) {
  const safe = projectSafeTextAppliedResult(result);
  return safe ? JSON.stringify(safe) : null;
}

const RETRY_IMAGE_OBJECT_KEY = /^uploads\/session-album\/display\/[A-Za-z0-9._-]+$/;
const RETRY_AVATAR_OBJECT_KEY = /^uploads\/avatars\/[A-Za-z0-9._-]+$/;
const RETRY_REVIEW_OBJECT_KEY = /^uploads\/session-reviews\/[A-Za-z0-9._-]+$/;
const RETRY_VIDEO_OBJECT_KEY = /^uploads\/session-album\/videos\/source\/[A-Za-z0-9._-]+\.mp4$/;
const ORPHAN_SCAN_OBJECT_KEY = /^uploads\/session-album\/(?:display\/[A-Za-z0-9._-]+|videos\/(?:source|display|cover)\/[A-Za-z0-9._-]+)$/;
const ORPHAN_SCAN_NAMES = new Set([
  "cos_session_album",
  "media_session_album",
  "job_session_album"
]);
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

function boundedPositiveInteger(value, maximum, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new TypeError(`${name} must be an integer from 1 to ${maximum}`);
  }
  return parsed;
}

function validDate(value, name) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${name} must be a valid Date`);
  }
  return value;
}

function validOrphanScanName(value) {
  const name = String(value || "");
  if (!ORPHAN_SCAN_NAMES.has(name)) throw new TypeError("unsupported orphan scan name");
  return name;
}

function validOrphanScanLeaseToken(value) {
  const token = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) {
    throw new TypeError("invalid orphan scan lease token");
  }
  return token;
}

function normalizeOrphanScanCursor(value) {
  if (value === undefined || value === null || value === "") return null;
  const cursor = String(value);
  if (
    !/^(?:\d+|uploads\/session-album\/[A-Za-z0-9._/-]{1,1000})$/.test(cursor) ||
    cursor.includes("..") ||
    cursor.includes("\\")
  ) {
    throw new TypeError("invalid orphan scan cursor");
  }
  return cursor;
}

function normalizeOrphanScanObjectKey(value) {
  const key = String(value || "").replace(/^\//, "");
  return ORPHAN_SCAN_OBJECT_KEY.test(key) ? key : null;
}

function currentRetryMediaFacts(job, media) {
  const kind = String(job?.subject_type || "");
  const subjectVersion = String(job?.subject_version || "");
  const imageSubject = MODERATION_IMAGE_SUBJECT_TYPES.includes(kind);
  const expectedMediaType = imageSubject ? "image" : kind === "album_video" ? "video" : "";
  const objectKey = String(imageSubject ? media?.object_key : media?.source_url || "")
    .replace(/^\//, "");
  const validObjectKey = kind === "album_image"
    ? RETRY_IMAGE_OBJECT_KEY.test(objectKey)
    : kind === "avatar_image"
      ? RETRY_AVATAR_OBJECT_KEY.test(objectKey)
      : kind === "review_image"
        ? RETRY_REVIEW_OBJECT_KEY.test(objectKey)
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
  const authorVisibility = textProposalAuthorVisibilityFacts(input);
  const byIdempotency = await findTextProposalByIdempotency(connection, input, { forUpdate: true });
  if (byIdempotency) return compatibleTextProposalId(byIdempotency, input);

  const byJob = await findTextProposalByJobId(connection, input.jobId, { forUpdate: true });
  if (byJob) return compatibleTextProposalId(byJob, input);

  try {
    const [result] = await connection.query(
      `INSERT INTO content_moderation_text_proposals
        (moderation_job_id, subject_type, subject_id, target_subject_id, base_version, action,
         normalized_payload_json, payload_digest, idempotency_key, status, created_by_user_id,
         author_visibility_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        Number(input.jobId),
        String(input.subjectType),
        String(input.subjectId),
        authorVisibility.targetSubjectId,
        String(input.baseVersion),
        String(input.action),
        JSON.stringify(input.normalizedPayload),
        String(input.payloadDigest),
        String(input.idempotencyKey),
        Number(input.userId),
        authorVisibility.authorVisibilityVersion
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

export async function findLatestAuthorTextProposal(
  connection,
  { userId, action, targetSubjectId, forUpdate = false }
) {
  const [rows] = await connection.query(
    `SELECT proposal.*, proposal.status AS proposal_status, job.status AS job_status
     FROM content_moderation_text_proposals AS proposal
     INNER JOIN content_moderation_jobs AS job
       ON job.id = proposal.moderation_job_id
     WHERE proposal.created_by_user_id = ?
       AND proposal.action = ?
       AND proposal.target_subject_id = ?
       AND proposal.author_visibility_version = 1
       AND proposal.status IN ('pending', 'rejected')
       AND job.status IN ('pending', 'processing', 'review', 'error', 'rejected')
     ORDER BY proposal.updated_at DESC, proposal.id DESC
     LIMIT 1${lockClause(forUpdate)}`,
    [Number(userId), String(action), String(targetSubjectId)]
  );
  return rows[0] || null;
}

export async function findAuthorTextDraftById(
  connection,
  { draftId, userId, forUpdate = false }
) {
  const [rows] = await connection.query(
    `SELECT proposal.*, proposal.status AS proposal_status, job.status AS job_status
     FROM content_moderation_text_proposals AS proposal
     INNER JOIN content_moderation_jobs AS job
       ON job.id = proposal.moderation_job_id
     WHERE proposal.id = ?
       AND proposal.created_by_user_id = ?
     LIMIT 1${lockClause(forUpdate)}`,
    [Number(draftId), Number(userId)]
  );
  return rows[0] || null;
}

export async function cancelTextProposalByAuthor(
  connection,
  { proposalId, userId, fromStatus }
) {
  assertTextProposalTransition(fromStatus, "cancelled");
  const [result] = await connection.query(
    `UPDATE content_moderation_text_proposals
     SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND created_by_user_id = ?
       AND status = ?
       AND author_visibility_version = 1`,
    [Number(proposalId), Number(userId), String(fromStatus)]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function cancelModerationJobByUser(
  connection,
  { jobId, fromStatus }
) {
  assertModerationTransition(fromStatus, "cancelled", { source: "user" });
  const [result] = await connection.query(
    `UPDATE content_moderation_jobs
     SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP,
         next_retry_at = NULL, lease_token = NULL, lease_expires_at = NULL
     WHERE id = ? AND status = ?`,
    [Number(jobId), String(fromStatus)]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function cancelMediaModerationJobsForDeletion(connection, media) {
  const mediaId = Number(media?.id);
  const mediaType = String(media?.media_type || "");
  const subjectVersion = String(media?.moderation_object_version || "");
  if (!Number.isSafeInteger(mediaId) || mediaId <= 0) {
    throw new TypeError("media id must be a positive safe integer");
  }
  if (!["image", "video"].includes(mediaType)) {
    throw new TypeError("media type must be image or video");
  }
  if (!subjectVersion) return [];

  const subjectType = mediaType === "video" ? "album_video" : "album_image";
  const [jobs] = await connection.query(
    `SELECT id, status FROM content_moderation_jobs
     WHERE subject_type = ? AND subject_id = ? AND subject_version = ?
       AND status IN ('pending', 'processing', 'review', 'error', 'rejected')
     ORDER BY id FOR UPDATE`,
    [subjectType, String(mediaId), subjectVersion]
  );
  const cancelled = [];
  for (const job of jobs) {
    const changed = await cancelModerationJobByUser(connection, {
      jobId: job.id,
      fromStatus: job.status
    });
    if (!changed) continue;
    await retireCurrentModerationAttempt(connection, { jobId: job.id });
    cancelled.push({ id: Number(job.id), previousStatus: String(job.status) });
  }
  return cancelled;
}

export async function supersedeRejectedTextProposal(
  connection,
  { proposalId, newProposalId, userId, action, targetSubjectId }
) {
  assertTextProposalTransition("rejected", "superseded");
  const previousId = Number(proposalId);
  const replacementId = Number(newProposalId);
  if (
    !Number.isSafeInteger(previousId) || previousId <= 0 ||
    !Number.isSafeInteger(replacementId) || replacementId <= 0 ||
    previousId === replacementId
  ) {
    throw new TypeError("proposal replacement ids must be distinct positive integers");
  }
  const [result] = await connection.query(
    `UPDATE content_moderation_text_proposals
     SET status = 'superseded', superseded_by_proposal_id = ?
     WHERE id = ?
       AND created_by_user_id = ?
       AND action = ?
       AND target_subject_id = ?
       AND status = 'rejected'
       AND author_visibility_version = 1`,
    [replacementId, previousId, Number(userId), String(action), String(targetSubjectId)]
  );
  return Number(result.affectedRows || 0) === 1;
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

export async function findModerationAuditLogByAction(
  connection,
  { jobId, action, forUpdate = false }
) {
  const [rows] = await connection.query(
    `SELECT id, moderation_job_id, admin_user_id, action, previous_status,
            next_status, reason, created_at
     FROM content_moderation_audit_logs
     WHERE moderation_job_id = ? AND action = ?
     ORDER BY id LIMIT 1${lockClause(forUpdate)}`,
    [Number(jobId), String(action)]
  );
  return rows[0] || null;
}

export async function findModerationMedia(connection, job, { forUpdate = false } = {}) {
  const subjectType = String(job?.subject_type || "");
  if (MODERATION_IMAGE_SUBJECT_TYPES.includes(subjectType) && subjectType !== "album_image") {
    const expectedKind = subjectType === "avatar_image" ? "avatar" : "review";
    const [rows] = await connection.query(
      `SELECT asset.*, asset.owner_user_id AS uploader_user_id,
              'image' AS media_type, asset.object_version AS moderation_object_version
       FROM user_image_assets asset
       WHERE asset.id = ? AND asset.kind = ? LIMIT 1${lockClause(forUpdate)}`,
      [Number(job.subject_id), expectedKind]
    );
    const asset = rows[0];
    return asset ? {
      ...asset,
      uploader_user_id: asset.uploader_user_id ?? asset.owner_user_id,
      media_type: "image",
      moderation_object_version: asset.moderation_object_version ?? asset.object_version
    } : null;
  }
  if (!subjectType.startsWith("album_")) return null;
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

  if ([...MODERATION_IMAGE_SUBJECT_TYPES, "album_video"].includes(String(job.subject_type))) {
    const media = await findModerationMedia(connection, job, { forUpdate: true });
    const retryFacts = currentRetryMediaFacts(job, media);
    if (!retryFacts) throw invalidRetryFacts();
    return {
      kind: MODERATION_IMAGE_SUBJECT_TYPES.includes(retryFacts.kind)
        ? "wechat_image"
        : "tencent_video",
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
  { subjectType = "album_image", mediaId, fromStatuses, toStatus }
) {
  const placeholders = fromStatuses.map(() => "?").join(", ");
  const table = ["avatar_image", "review_image"].includes(String(subjectType))
    ? "user_image_assets"
    : "session_album_photos";
  const [result] = await connection.query(
    `UPDATE ${table} SET moderation_status = ?
     WHERE id = ? AND status = 'active' AND moderation_status IN (${placeholders})`,
    [toStatus, Number(mediaId), ...fromStatuses]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function enqueueUserImageAssetCleanup(connection, media) {
  const [result] = await connection.query(
    `INSERT INTO user_image_asset_cleanup_jobs
      (user_image_asset_id, owner_user_id, asset_path, object_key, storage_kind,
       status, cleanup_not_before)
     VALUES (?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), status = 'pending',
       cleanup_not_before = CURRENT_TIMESTAMP, completed_at = NULL,
       updated_at = CURRENT_TIMESTAMP`,
    [
      Number(media.id),
      Number(media.owner_user_id ?? media.uploader_user_id),
      String(media.asset_path),
      String(media.object_key),
      media.storage_kind ? String(media.storage_kind) : "cos"
    ]
  );
  return Number(result.insertId);
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
  { lateOutputEvent = false, deletionRequested = false } = {}
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
  if (!cleanupChanged && !lateOutputEvent && !deletionRequested) return cleanupJob.id;

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
  { lateOutputEvent = false, deletionRequested = false } = {}
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
    return enqueueRejectedVideoCleanup(connection, media, objectUrls, {
      lateOutputEvent,
      deletionRequested
    });
  }
  if (deletionRequested) {
    let cleanupJob = await findRejectedMediaCleanupJob(connection, media.id);
    if (!cleanupJob) {
      const result = await insertRejectedMediaCleanupJob(connection, {
        media,
        storageKind,
        objectKey,
        localPath,
        objectUrls
      });
      cleanupJob = await findRejectedMediaCleanupJob(connection, media.id);
      if (!cleanupJob) return Number(result.insertId);
    }
    await connection.query(
      `UPDATE session_album_object_cleanup_jobs
       SET storage_kind = ?, object_key = ?, local_path = ?, object_urls_json = NULL,
           status = 'pending', next_retry_at = NULL, lease_token = NULL,
           lease_expires_at = NULL, completed_at = NULL
       WHERE id = ?`,
      [storageKind, objectKey, localPath, Number(cleanupJob.id)]
    );
    return Number(cleanupJob.id);
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

export async function getModerationQueueStats(connection, { now = new Date() } = {}) {
  const snapshotAt = validDate(now, "queue snapshot time");
  const [rows] = await connection.query(
    `SELECT provider, subject_type, status,
            COUNT(*) AS queue_depth,
            GREATEST(TIMESTAMPDIFF(SECOND, MIN(created_at), ?), 0) AS oldest_age_seconds
     FROM content_moderation_jobs
     WHERE status IN ('pending', 'processing', 'review', 'error')
     GROUP BY provider, subject_type, status`,
    [snapshotAt]
  );
  return rows;
}

export async function getAuthorPrivateRetentionStats(
  connection,
  { longLivedDays = 30 } = {}
) {
  const days = Number(longLivedDays);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    throw new TypeError("author-private retention age must be from 1 to 3650 days");
  }
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS retained_object_count,
            COALESCE(SUM(
              CASE
                WHEN media_type = 'image' THEN COALESCE(image_byte_size, 0)
                WHEN media_type = 'video' THEN COALESCE(video_byte_size, 0)
                ELSE 0
              END
            ), 0) AS retained_bytes,
            COALESCE(SUM(
              CASE WHEN created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY) THEN 1 ELSE 0 END
            ), 0) AS long_lived_count
     FROM session_album_photos
     WHERE author_visibility_version = 1
       AND status = 'active'
       AND moderation_status = 'rejected'
       AND media_type IN ('image', 'video')`,
    [days]
  );
  const row = rows[0] || {};
  const safeCount = (value) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  };
  return {
    retained_object_count: safeCount(row.retained_object_count),
    retained_bytes: safeCount(row.retained_bytes),
    long_lived_count: safeCount(row.long_lived_count)
  };
}

export async function claimOrphanScanState(
  connection,
  { scanName, leaseToken, now, leaseExpiresAt } = {}
) {
  const normalizedName = validOrphanScanName(scanName);
  const normalizedToken = validOrphanScanLeaseToken(leaseToken);
  const claimTime = validDate(now, "orphan scan claim time");
  const expiry = validDate(leaseExpiresAt, "orphan scan lease expiry");
  if (expiry.getTime() <= claimTime.getTime()) {
    throw new TypeError("orphan scan lease expiry must be after its claim time");
  }
  await connection.query(
    `INSERT INTO content_moderation_orphan_scan_state (scan_name, cursor_value)
     VALUES (?, NULL)
     ON DUPLICATE KEY UPDATE scan_name = VALUES(scan_name)`,
    [normalizedName]
  );
  const [rows] = await connection.query(
    `SELECT scan_name, cursor_value, lease_expires_at
     FROM content_moderation_orphan_scan_state
     WHERE scan_name = ? LIMIT 1 FOR UPDATE`,
    [normalizedName]
  );
  const state = rows[0];
  if (!state) return null;
  const existingLeaseExpiry = state.lease_expires_at ? new Date(state.lease_expires_at) : null;
  if (existingLeaseExpiry && !Number.isNaN(existingLeaseExpiry.getTime()) && existingLeaseExpiry > claimTime) {
    return null;
  }
  const [result] = await connection.query(
    `UPDATE content_moderation_orphan_scan_state
     SET lease_token = ?, lease_expires_at = ?
     WHERE scan_name = ?`,
    [normalizedToken, expiry, normalizedName]
  );
  if (Number(result.affectedRows || 0) !== 1) return null;
  return { cursor_value: normalizeOrphanScanCursor(state.cursor_value) };
}

export async function completeOrphanScanState(
  connection,
  { scanName, leaseToken, cursorValue, now } = {}
) {
  const completedAt = validDate(now, "orphan scan completion time");
  const [result] = await connection.query(
    `UPDATE content_moderation_orphan_scan_state
     SET cursor_value = ?, lease_token = NULL, lease_expires_at = NULL
     WHERE scan_name = ? AND lease_token = ? AND lease_expires_at > ?`,
    [
      normalizeOrphanScanCursor(cursorValue),
      validOrphanScanName(scanName),
      validOrphanScanLeaseToken(leaseToken),
      completedAt
    ]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function renewOrphanScanState(
  connection,
  { scanName, leaseToken, now, leaseExpiresAt } = {}
) {
  const renewedAt = validDate(now, "orphan scan renewal time");
  const expiry = validDate(leaseExpiresAt, "orphan scan renewal expiry");
  if (expiry.getTime() <= renewedAt.getTime()) {
    throw new TypeError("orphan scan renewal expiry must be after its renewal time");
  }
  const [result] = await connection.query(
    `UPDATE content_moderation_orphan_scan_state
     SET lease_expires_at = ?
     WHERE scan_name = ? AND lease_token = ? AND lease_expires_at > ?`,
    [
      expiry,
      validOrphanScanName(scanName),
      validOrphanScanLeaseToken(leaseToken),
      renewedAt
    ]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function releaseOrphanScanState(connection, { scanName, leaseToken } = {}) {
  const [result] = await connection.query(
    `UPDATE content_moderation_orphan_scan_state
     SET lease_token = NULL, lease_expires_at = NULL
     WHERE scan_name = ? AND lease_token = ?`,
    [validOrphanScanName(scanName), validOrphanScanLeaseToken(leaseToken)]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function findContentModerationObjectReferences(connection, { objectKeys = [] } = {}) {
  const keys = [...new Set((Array.isArray(objectKeys) ? objectKeys : [])
    .map(normalizeOrphanScanObjectKey)
    .filter(Boolean))];
  if (keys.length === 0) return [];
  const placeholders = keys.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `SELECT object_key
     FROM session_album_photos
     WHERE status IN ('active', 'deleting') AND object_key IN (${placeholders})
     UNION ALL
     SELECT TRIM(LEADING '/' FROM photo_url) AS object_key
     FROM session_album_photos
     WHERE status IN ('active', 'deleting')
       AND TRIM(LEADING '/' FROM photo_url) IN (${placeholders})
     UNION ALL
     SELECT TRIM(LEADING '/' FROM source_url) AS object_key
     FROM session_album_photos
     WHERE status IN ('active', 'deleting')
       AND TRIM(LEADING '/' FROM source_url) IN (${placeholders})
     UNION ALL
     SELECT TRIM(LEADING '/' FROM display_url) AS object_key
     FROM session_album_photos
     WHERE status IN ('active', 'deleting')
       AND TRIM(LEADING '/' FROM display_url) IN (${placeholders})
     UNION ALL
     SELECT TRIM(LEADING '/' FROM cover_url) AS object_key
     FROM session_album_photos
     WHERE status IN ('active', 'deleting')
       AND TRIM(LEADING '/' FROM cover_url) IN (${placeholders})
     UNION ALL
     SELECT object_key
     FROM session_album_upload_intents
     WHERE status <> 'cleaned' AND object_key IN (${placeholders})
     UNION ALL
     SELECT object_key
     FROM session_album_object_cleanup_jobs
     WHERE status IN ('pending', 'retry', 'leased') AND object_key IN (${placeholders})
     UNION ALL
     SELECT cleanup_object.object_key
     FROM session_album_object_cleanup_jobs cleanup
     JOIN JSON_TABLE(
       COALESCE(cleanup.object_urls_json, JSON_ARRAY()),
       '$[*]' COLUMNS(object_key VARCHAR(512) PATH '$.objectKey' NULL ON EMPTY)
     ) AS cleanup_object ON TRUE
     WHERE cleanup.status IN ('pending', 'retry', 'leased')
       AND cleanup_object.object_key IN (${placeholders})`,
    [...keys, ...keys, ...keys, ...keys, ...keys, ...keys, ...keys, ...keys]
  );
  return [...new Set(rows.map((row) => normalizeOrphanScanObjectKey(row.object_key)).filter(Boolean))];
}

export async function listModerationMediaForReconciliation(
  connection,
  { afterId = 0, limit = 100 } = {}
) {
  const cursor = Number(afterId);
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new TypeError("media reconciliation cursor must be non-negative");
  const batchLimit = boundedPositiveInteger(limit, 1000, "media reconciliation limit");
  const [mediaRows] = await connection.query(
    `SELECT id, media_type, status, moderation_status, moderation_object_version,
            author_visibility_version,
            object_key, source_url, display_url, cover_url
     FROM session_album_photos
     WHERE id > ? AND media_type IN ('image', 'video') AND status IN ('active', 'deleting')
     ORDER BY id LIMIT ?`,
    [cursor, batchLimit]
  );
  if (mediaRows.length === 0) return [];
  const mediaIds = mediaRows.map((row) => Number(row.id));
  const [jobRows] = await connection.query(
    `SELECT id, provider, subject_type, subject_id, subject_version, status
     FROM content_moderation_jobs
     WHERE subject_type IN ('album_image', 'album_video')
       AND CAST(subject_id AS UNSIGNED) IN (${mediaIds.map(() => "?").join(", ")})`,
    mediaIds
  );
  const jobsByMediaId = new Map();
  for (const job of jobRows) {
    const mediaId = Number(job.subject_id);
    if (!jobsByMediaId.has(mediaId)) jobsByMediaId.set(mediaId, []);
    jobsByMediaId.get(mediaId).push(job);
  }
  return mediaRows.map((media) => ({
    ...media,
    moderation_jobs: jobsByMediaId.get(Number(media.id)) || []
  }));
}

export async function listMediaModerationJobsForReconciliation(
  connection,
  { afterId = 0, limit = 100 } = {}
) {
  const cursor = Number(afterId);
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new TypeError("job reconciliation cursor must be non-negative");
  const batchLimit = boundedPositiveInteger(limit, 1000, "job reconciliation limit");
  const [rows] = await connection.query(
    `SELECT job.id, job.provider, job.subject_type, job.subject_id, job.subject_version, job.status,
            media.id AS media_id, media.media_type, media.status AS media_status,
            media.moderation_object_version AS media_moderation_object_version,
            attempt.id AS current_attempt_id
     FROM content_moderation_jobs job
     LEFT JOIN session_album_photos media
       ON job.subject_type IN ('album_image', 'album_video')
      AND media.id = CAST(job.subject_id AS UNSIGNED)
     LEFT JOIN content_moderation_provider_attempts attempt
       ON attempt.moderation_job_id = job.id AND attempt.is_current = 1
     WHERE job.id > ?
       AND job.subject_type IN ('album_image', 'album_video')
       AND job.status IN ('pending', 'processing', 'review', 'error')
     ORDER BY job.id LIMIT ?`,
    [cursor, batchLimit]
  );
  return rows;
}

export async function listAdminModerationJobs(
  connection,
  { provider, status, subjectType, label, dateFrom, dateTo, limit = 100 } = {}
) {
  const where = ["job.status IN ('review', 'error', 'rejected')"];
  const values = [];
  if (provider) { where.push("job.provider = ?"); values.push(String(provider)); }
  if (subjectType) { where.push("job.subject_type = ?"); values.push(String(subjectType)); }
  if (status) { where.push("job.status = ?"); values.push(String(status)); }
  if (label) { where.push("job.label = ?"); values.push(String(label)); }
  if (dateFrom) { where.push("job.created_at >= ?"); values.push(dateFrom); }
  if (dateTo) { where.push("job.created_at < DATE_ADD(?, INTERVAL 1 DAY)"); values.push(dateTo); }
  values.push(Math.max(1, Math.min(200, Number(limit) || 100)));
  const [rows] = await connection.query(
    `SELECT job.*, proposal.created_by_user_id,
            COALESCE(media.id, user_media.id) AS media_id,
            media.session_id,
            COALESCE(media.uploader_user_id, user_media.owner_user_id) AS uploader_user_id,
            COALESCE(media.media_type, IF(user_media.id IS NULL, NULL, 'image')) AS media_type,
            COALESCE(media.status, user_media.status) AS media_record_status,
            media.processing_status,
            COALESCE(media.moderation_status, user_media.moderation_status) AS moderation_status,
            media.author_visibility_version
     FROM content_moderation_jobs job
     LEFT JOIN content_moderation_text_proposals proposal
       ON proposal.moderation_job_id = job.id
     LEFT JOIN session_album_photos media
       ON job.subject_type IN ('album_image', 'album_video')
      AND media.id = CAST(job.subject_id AS UNSIGNED)
     LEFT JOIN user_image_assets user_media
       ON job.subject_type IN ('avatar_image', 'review_image')
      AND user_media.id = CAST(job.subject_id AS UNSIGNED)
     WHERE ${where.join(" AND ")}
     ORDER BY job.created_at DESC LIMIT ?`,
    values
  );
  return rows;
}

export async function getAdminModerationJob(connection, jobId) {
  const [rows] = await connection.query(
    `SELECT job.*, proposal.normalized_payload_json, proposal.base_version,
            proposal.status AS proposal_status, proposal.action AS proposal_action,
            proposal.created_by_user_id, proposal.idempotency_key,
            media.id AS media_id, media.session_id, media.uploader_user_id,
            media.media_type, media.status AS media_record_status,
            media.processing_status, media.moderation_status, media.moderation_object_version,
            media.author_visibility_version,
            media.object_key, media.source_url, media.display_url, media.cover_url,
            user_media.id AS user_media_id,
            user_media.owner_user_id AS user_media_owner_user_id,
            user_media.status AS user_media_record_status,
            user_media.moderation_status AS user_media_moderation_status,
            user_media.object_version AS user_media_object_version,
            user_media.object_key AS user_media_object_key
     FROM content_moderation_jobs job
     LEFT JOIN content_moderation_text_proposals proposal
       ON proposal.moderation_job_id = job.id
     LEFT JOIN session_album_photos media
       ON job.subject_type IN ('album_image', 'album_video')
      AND media.id = CAST(job.subject_id AS UNSIGNED)
     LEFT JOIN user_image_assets user_media
       ON job.subject_type IN ('avatar_image', 'review_image')
      AND user_media.id = CAST(job.subject_id AS UNSIGNED)
     WHERE job.id = ? AND job.status IN ('review', 'error', 'rejected') LIMIT 1`,
    [Number(jobId)]
  );
  const row = rows[0];
  if (!row || !row.user_media_id) return row || null;
  return {
    ...row,
    media_id: row.user_media_id,
    uploader_user_id: row.user_media_owner_user_id,
    media_type: "image",
    media_record_status: row.user_media_record_status,
    moderation_status: row.user_media_moderation_status,
    moderation_object_version: row.user_media_object_version,
    object_key: row.user_media_object_key
  };
}
