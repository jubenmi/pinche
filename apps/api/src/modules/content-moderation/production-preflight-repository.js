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
  await connection.execute(
    `UPDATE content_moderation_production_preflight_runs
     SET state = ?,
         result_category = ?,
         cleanup_status = ?,
         elapsed_ms = ?,
         failure_code = ?,
         failure_message = ?,
         completed_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [state, resultCategory, cleanupStatus, elapsedMs, failureCode, failureMessage, runId]
  );
}

export async function markProductionPreflightRunAwaitingCallback({
  connection,
  runId,
  resultCategory = "submitted",
  cleanupStatus = "pending",
  elapsedMs
}) {
  await connection.execute(
    `UPDATE content_moderation_production_preflight_runs
     SET state = 'awaiting_callback',
         result_category = ?,
         cleanup_status = ?,
         elapsed_ms = ?,
         failure_code = NULL,
         failure_message = NULL,
         completed_at = NULL
     WHERE id = ?`,
    [resultCategory, cleanupStatus, elapsedMs, runId]
  );
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
