import assert from "node:assert/strict";
import test from "node:test";

import {
  acquireProductionPreflightRun,
  finishProductionPreflightRun,
  findProductionPreflightAttemptByAssociation,
  productionPreflightReferenceHmac,
  recordProductionPreflightAssociation,
  releaseProductionPreflightLock
} from "../src/modules/content-moderation/production-preflight-repository.js";

function createFakePreflightConnection() {
  const state = {
    locks: new Map(),
    runs: new Map(),
    attempts: new Map(),
    tx: [],
    sql: []
  };
  return {
    state,
    async beginTransaction() {
      state.tx.push("begin");
    },
    async commit() {
      state.tx.push("commit");
    },
    async rollback() {
      state.tx.push("rollback");
    },
    async execute(sql, params = []) {
      state.sql.push(sql.replace(/\s+/g, " ").trim());
      if (sql.includes("INSERT INTO content_moderation_production_preflight_provider_locks")) {
        const [provider] = params;
        if (!state.locks.has(provider)) {
          state.locks.set(provider, { provider, last_started_at: null, active_run_id: null });
        }
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("SELECT provider, last_started_at, active_run_id")) {
        const [provider] = params;
        const row = state.locks.get(provider);
        return [row ? [row] : []];
      }
      if (sql.includes("INSERT INTO content_moderation_production_preflight_runs")) {
        const [id, caseId, provider, runState, operatorUserId, configFingerprint, assetFingerprint] = params;
        state.runs.set(id, {
          id,
          case_id: caseId,
          provider,
          state: runState,
          operator_user_id: operatorUserId,
          config_fingerprint: configFingerprint,
          asset_fingerprint: assetFingerprint
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("UPDATE content_moderation_production_preflight_provider_locks") && sql.includes("active_run_id = NULL")) {
        const [provider, runId] = params;
        const lock = state.locks.get(provider);
        if (lock?.active_run_id === runId) {
          state.locks.set(provider, { ...lock, active_run_id: null });
        }
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("UPDATE content_moderation_production_preflight_provider_locks") && sql.includes("active_run_id = ?")) {
        const [lastStartedAt, runId, provider] = params;
        const dateValue = new Date(`${lastStartedAt.replace(" ", "T")}Z`);
        state.locks.set(provider, { provider, last_started_at: dateValue, active_run_id: runId });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("INSERT INTO content_moderation_production_preflight_attempts")) {
        const [runId, provider, kind, hmac] = params;
        state.attempts.set(`${provider}:${kind}:${hmac}`, {
          run_id: runId,
          provider,
          association_kind: kind,
          association_hmac: hmac
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("SELECT run_id, provider, association_kind, association_hmac")) {
        const [provider, kind, hmac] = params;
        const row = state.attempts.get(`${provider}:${kind}:${hmac}`);
        return [row ? [row] : []];
      }
      if (sql.includes("UPDATE content_moderation_production_preflight_runs")) {
        const [runState, resultCategory, cleanupStatus, elapsedMs, failureCode, failureMessage, runId] = params;
        state.runs.set(runId, {
          ...(state.runs.get(runId) || { id: runId }),
          state: runState,
          result_category: resultCategory,
          cleanup_status: cleanupStatus,
          elapsed_ms: elapsedMs,
          failure_code: failureCode,
          failure_message: failureMessage
        });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
}

test("HMAC is deterministic, domain separated, and redacted", () => {
  const key = "01234567890123456789012345678901";
  const hmac = productionPreflightReferenceHmac({
    key,
    provider: "wechat_image",
    kind: "trace_id",
    value: "raw-trace"
  });
  const other = productionPreflightReferenceHmac({
    key,
    provider: "wechat_image",
    kind: "job_id",
    value: "raw-trace"
  });
  assert.match(hmac, /^[0-9a-f]{64}$/);
  assert.notEqual(hmac, other);
  assert.equal(hmac.includes("raw-trace"), false);
});

test("repository acquires one active provider run and rejects concurrent activity", async () => {
  const connection = createFakePreflightConnection();
  const run = await acquireProductionPreflightRun({
    connection,
    provider: "wechat_text",
    caseId: "wechat-text-v1",
    operatorUserId: 42,
    configFingerprint: "cfg",
    assetFingerprint: "text-v1",
    now: new Date("2026-07-13T00:00:00.000Z")
  });

  assert.match(run.id, /^[0-9a-f-]{36}$/);
  assert.equal(connection.state.tx.join(","), "begin,commit");

  await assert.rejects(
    acquireProductionPreflightRun({
      connection,
      provider: "wechat_text",
      caseId: "wechat-text-v1",
      operatorUserId: 42,
      configFingerprint: "cfg",
      assetFingerprint: "text-v1",
      now: new Date("2026-07-13T00:01:00.000Z")
    }),
    /already active/
  );
});

test("repository rejects provider cooldown after a released run", async () => {
  const connection = createFakePreflightConnection();
  const run = await acquireProductionPreflightRun({
    connection,
    provider: "tencent_video",
    caseId: "tencent-video-v1",
    operatorUserId: 42,
    configFingerprint: "cfg",
    assetFingerprint: "video-v1",
    now: new Date("2026-07-13T00:00:00.000Z")
  });
  await releaseProductionPreflightLock({ connection, provider: "tencent_video", runId: run.id });

  await assert.rejects(
    acquireProductionPreflightRun({
      connection,
      provider: "tencent_video",
      caseId: "tencent-video-v1",
      operatorUserId: 42,
      configFingerprint: "cfg",
      assetFingerprint: "video-v1",
      now: new Date("2026-07-13T00:14:59.000Z")
    }),
    /cooldown/
  );
});

test("associations store and find only HMAC values", async () => {
  const connection = createFakePreflightConnection();
  await recordProductionPreflightAssociation({
    connection,
    runId: "run-1",
    provider: "wechat_image",
    kind: "trace_id",
    hmac: "a".repeat(64)
  });

  const found = await findProductionPreflightAttemptByAssociation({
    connection,
    provider: "wechat_image",
    kind: "trace_id",
    hmac: "a".repeat(64)
  });

  assert.equal(found.runId, "run-1");
  assert.equal(JSON.stringify(connection.state).includes("raw-trace"), false);
});

test("finish and release only update preflight tables", async () => {
  const connection = createFakePreflightConnection();
  await finishProductionPreflightRun({
    connection,
    runId: "run-1",
    state: "passed",
    resultCategory: "pass",
    cleanupStatus: "not_required",
    elapsedMs: 10
  });
  await releaseProductionPreflightLock({ connection, provider: "wechat_text", runId: "run-1" });

  assert.ok(connection.state.sql.every((sql) => sql.includes("production_preflight")));
});
