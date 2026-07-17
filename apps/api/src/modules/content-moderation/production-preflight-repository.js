import crypto from "node:crypto";

const PROVIDERS = new Set(["wechat_text", "wechat_image", "tencent_video"]);
const COOLDOWN_MS = 15 * 60 * 1000;

function assertProvider(provider) {
  if (!PROVIDERS.has(provider)) {
    throw new Error(`unsupported production preflight provider: ${provider}`);
  }
}

function assertHmac(hmac) {
  if (!/^[0-9a-f]{64}$/.test(hmac)) {
    throw new Error("invalid production preflight association hmac");
  }
}

function toSqlDateTime(date) {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

export function productionPreflightReferenceHmac({ key, provider, kind, value }) {
  assertProvider(provider);
  if (typeof kind !== "string" || kind.length === 0) {
    throw new Error("production preflight reference kind is required");
  }
  if (typeof key !== "string" || key.length < 32) {
    throw new Error("production preflight HMAC key must be at least 32 characters");
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("production preflight reference value is required");
  }
  return crypto.createHmac("sha256", key).update(`${provider}:${kind}:${value}`, "utf8").digest("hex");
}

export async function acquireProductionPreflightRun({
  connection,
  provider,
  caseId,
  operatorUserId,
  configFingerprint,
  assetFingerprint,
  now = new Date()
}) {
  assertProvider(provider);
  const id = crypto.randomUUID();
  await connection.beginTransaction();
  try {
    await connection.execute(
      `INSERT INTO content_moderation_production_preflight_provider_locks (provider)
       VALUES (?)
       ON DUPLICATE KEY UPDATE provider = VALUES(provider)`,
      [provider]
    );
    const [lockRows] = await connection.execute(
      `SELECT provider, last_started_at, active_run_id
       FROM content_moderation_production_preflight_provider_locks
       WHERE provider = ?
       FOR UPDATE`,
      [provider]
    );
    const lock = lockRows[0];
    if (lock?.active_run_id) {
      throw new Error(`production preflight already active for ${provider}`);
    }
    if (lock?.last_started_at) {
      const elapsedMs = now.getTime() - new Date(lock.last_started_at).getTime();
      if (elapsedMs < COOLDOWN_MS) {
        throw new Error(`production preflight cooldown for ${provider}`);
      }
    }

    await connection.execute(
      `INSERT INTO content_moderation_production_preflight_runs
       (id, case_id, provider, state, operator_user_id, config_fingerprint, asset_fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, caseId, provider, "started", operatorUserId, configFingerprint, assetFingerprint]
    );
    await connection.execute(
      `UPDATE content_moderation_production_preflight_provider_locks
       SET last_started_at = ?, active_run_id = ?
       WHERE provider = ?`,
      [toSqlDateTime(now), id, provider]
    );
    await connection.commit();
    return { id, provider, caseId };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

export async function recordProductionPreflightAssociation({ connection, runId, provider, kind, hmac }) {
  assertProvider(provider);
  assertHmac(hmac);
  await connection.execute(
    `INSERT INTO content_moderation_production_preflight_attempts
     (run_id, provider, association_kind, association_hmac)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3)`,
    [runId, provider, kind, hmac]
  );
}

export async function findProductionPreflightAttemptByAssociation({ connection, provider, kind, hmac }) {
  assertProvider(provider);
  assertHmac(hmac);
  const [rows] = await connection.execute(
    `SELECT run_id, provider, association_kind, association_hmac
     FROM content_moderation_production_preflight_attempts
     WHERE provider = ? AND association_kind = ? AND association_hmac = ?
     LIMIT 1`,
    [provider, kind, hmac]
  );
  const row = rows[0];
  return row
    ? {
        runId: row.run_id,
        provider: row.provider,
        kind: row.association_kind,
        hmac: row.association_hmac
      }
    : null;
}

export async function findProductionPreflightRun({ connection, runId }) {
  const [rows] = await connection.execute(
    `SELECT id, case_id, provider, state, config_fingerprint, started_at, updated_at
     FROM content_moderation_production_preflight_runs
     WHERE id = ?
     LIMIT 1`,
    [runId]
  );
  const row = rows[0];
  return row
    ? {
        id: row.id,
        caseId: row.case_id,
        provider: row.provider,
        state: row.state,
        configFingerprint: row.config_fingerprint,
        startedAt: row.started_at,
        updatedAt: row.updated_at
      }
    : null;
}

export async function hasActiveProductionPreflightWechatImageRun({ connection }) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM content_moderation_production_preflight_runs
     WHERE provider = 'wechat_image'
       AND state IN ('submitting', 'awaiting_callback')
     LIMIT 1`
  );
  return rows.length > 0;
}

export async function listTimedOutProductionPreflightRuns({ connection, cutoff, now, limit }) {
  const cutoffAt = new Date(cutoff);
  const nowAt = new Date(now);
  const batchSize = Number(limit);
  const timeoutMs = nowAt.getTime() - cutoffAt.getTime();
  if (
    !Number.isFinite(cutoffAt.getTime()) ||
    !Number.isFinite(nowAt.getTime()) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 60_000 ||
    timeoutMs > 60 * 60 * 1000
  ) {
    throw new TypeError("production preflight timeout cutoff is invalid");
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new TypeError("production preflight timeout batch size is invalid");
  }
  const [rows] = await connection.execute(
    `SELECT id, provider, case_id, config_fingerprint
     FROM content_moderation_production_preflight_runs
     WHERE state IN ('started', 'submitting', 'awaiting_callback')
       AND updated_at <= TIMESTAMPADD(MICROSECOND, ?, CURRENT_TIMESTAMP(3))
     ORDER BY updated_at ASC
     LIMIT ${batchSize}`,
    [-timeoutMs * 1000]
  );
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    caseId: row.case_id,
    configFingerprint: row.config_fingerprint
  }));
}

export async function finishProductionPreflightRun({
  connection,
  runId,
  state,
  resultCategory,
  cleanupStatus,
  elapsedMs,
  failureCode = null,
  failureMessage = null
}) {
  const [result] = await connection.execute(
    `UPDATE content_moderation_production_preflight_runs
     SET state = ?,
         result_category = ?,
         cleanup_status = ?,
         elapsed_ms = ?,
         failure_code = ?,
         failure_message = ?,
         completed_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND state IN ('started', 'submitting')`,
    [state, resultCategory, cleanupStatus, elapsedMs, failureCode, failureMessage, runId]
  );
  return result.affectedRows === 1;
}

export async function finalizeProductionPreflightRun({
  connection,
  runId,
  provider,
  resultCategory,
  cleanupObject,
  failureCode = null,
  expectedStates = ["awaiting_callback"],
  now = new Date()
}) {
  assertProvider(provider);
  const allowedStates = Array.isArray(expectedStates) && expectedStates.length > 0
    ? new Set(expectedStates.map((state) => String(state)))
    : new Set(["awaiting_callback"]);
  await connection.beginTransaction();
  try {
    const [rows] = await connection.execute(
      `SELECT id, provider, case_id, state, started_at
       FROM content_moderation_production_preflight_runs
       WHERE id = ? AND provider = ?
       FOR UPDATE`,
      [runId, provider]
    );
    const run = rows[0];
    if (!run || !allowedStates.has(run.state)) {
      await connection.commit();
      return { finalized: false, state: run?.state || "missing" };
    }

    let finalResultCategory = normalizedPreflightResultCategory(resultCategory);
    let finalState = finalResultCategory === "pass" ? "passed" : "failed";
    let cleanupStatus = "not_required";
    let finalFailureCode = finalState === "passed"
      ? null
      : failureCode || "PRODUCTION_PREFLIGHT_NON_PASS";
    let failureMessage = finalState === "passed"
      ? null
      : `provider returned ${finalResultCategory}`;

    try {
      if (typeof cleanupObject === "function") {
        await cleanupObject({
          runId,
          provider,
          caseId: run.case_id,
          state: finalState
        });
        cleanupStatus = "deleted";
      }
    } catch {
      finalResultCategory = "error";
      finalState = "failed";
      cleanupStatus = "cleanup_failed";
      finalFailureCode = "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CLEANUP_FAILED";
      failureMessage = "production preflight cleanup failed";
    }

    const [updated] = await connection.execute(
      `UPDATE content_moderation_production_preflight_runs
       SET state = ?,
           result_category = ?,
           cleanup_status = ?,
           elapsed_ms = ?,
           failure_code = ?,
           failure_message = ?,
           completed_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND state = ?`,
      [
        finalState,
        finalResultCategory,
        cleanupStatus,
        elapsedMilliseconds(run.started_at, now),
        finalFailureCode,
        failureMessage,
        runId,
        run.state
      ]
    );
    if (updated.affectedRows !== 1) {
      throw new Error("production preflight finalization state transition failed");
    }
    await connection.execute(
      `UPDATE content_moderation_production_preflight_provider_locks
       SET active_run_id = NULL
       WHERE provider = ? AND active_run_id = ?`,
      [provider, runId]
    );
    await connection.commit();
    return {
      finalized: true,
      state: finalState,
      resultCategory: finalResultCategory,
      cleanupStatus
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

function normalizedPreflightResultCategory(value) {
  const category = String(value || "").trim().toLowerCase();
  return ["pass", "review", "block", "error"].includes(category) ? category : "error";
}

function elapsedMilliseconds(startedAt, now) {
  const started = new Date(startedAt).getTime();
  const ended = new Date(now).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return 0;
  return Math.max(0, ended - started);
}

export async function markProductionPreflightRunSubmitting({ connection, runId }) {
  const [result] = await connection.execute(
    `UPDATE content_moderation_production_preflight_runs
     SET state = 'submitting',
         result_category = NULL,
         cleanup_status = 'pending',
         elapsed_ms = NULL,
         failure_code = NULL,
         failure_message = NULL,
         completed_at = NULL
     WHERE id = ? AND state = 'started'`,
    [runId]
  );
  return result.affectedRows === 1;
}

export async function markProductionPreflightRunAwaitingCallback({
  connection,
  runId,
  resultCategory = "submitted",
  cleanupStatus = "pending",
  elapsedMs
}) {
  const [result] = await connection.execute(
    `UPDATE content_moderation_production_preflight_runs
     SET state = 'awaiting_callback',
         result_category = ?,
         cleanup_status = ?,
         elapsed_ms = ?,
         failure_code = NULL,
         failure_message = NULL,
         completed_at = NULL
     WHERE id = ? AND state = 'submitting'`,
    [resultCategory, cleanupStatus, elapsedMs, runId]
  );
  return result.affectedRows === 1;
}

export async function releaseProductionPreflightLock({ connection, provider, runId }) {
  assertProvider(provider);
  await connection.execute(
    `UPDATE content_moderation_production_preflight_provider_locks
     SET active_run_id = NULL
     WHERE provider = ? AND active_run_id = ?`,
    [provider, runId]
  );
}
