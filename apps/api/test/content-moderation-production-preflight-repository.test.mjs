import assert from "node:assert/strict";
import test from "node:test";

import {
  acquireProductionPreflightRun,
  finalizeProductionPreflightRun,
  finishProductionPreflightRun,
  findProductionPreflightAttemptByAssociation,
  listTimedOutProductionPreflightRuns,
  markProductionPreflightRunAwaitingCallback,
  markProductionPreflightRunSubmitting,
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
    sql: [],
    params: []
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
      state.params.push(params);
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
      if (sql.includes("SELECT id, provider, case_id, state, started_at") && sql.includes("FOR UPDATE")) {
        const [runId, provider] = params;
        const run = state.runs.get(runId);
        return [run && run.provider === provider ? [run] : []];
      }
      if (sql.includes("SELECT id, provider, case_id") && sql.includes("updated_at <=")) {
        const [cutoff] = params;
        const limit = Number(sql.match(/LIMIT (\d+)/)?.[1]);
        const cutoffAt = new Date(`${cutoff.replace(" ", "T")}Z`).getTime();
        const rows = [...state.runs.values()]
          .filter((run) =>
            ["submitting", "awaiting_callback", ...(sql.includes("'started'") ? ["started"] : [])].includes(run.state) &&
            new Date(run.updated_at).getTime() <= cutoffAt
          )
          .slice(0, limit);
        return [rows];
      }
      if (sql.includes("SET state = 'submitting'")) {
        const [runId] = params;
        const run = state.runs.get(runId);
        if (run?.state !== "started") return [{ affectedRows: 0 }];
        state.runs.set(runId, { ...run, state: "submitting" });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("SET state = 'awaiting_callback'")) {
        const [resultCategory, cleanupStatus, elapsedMs, runId] = params;
        const run = state.runs.get(runId);
        if (run?.state !== "submitting") return [{ affectedRows: 0 }];
        state.runs.set(runId, {
          ...run,
          state: "awaiting_callback",
          result_category: resultCategory,
          cleanup_status: cleanupStatus,
          elapsed_ms: elapsedMs
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("WHERE id = ? AND state = ?")) {
        const [runState, resultCategory, cleanupStatus, elapsedMs, failureCode, failureMessage, runId, expectedState] = params;
        const run = state.runs.get(runId);
        if (run?.state !== expectedState) return [{ affectedRows: 0 }];
        state.runs.set(runId, {
          ...run,
          state: runState,
          result_category: resultCategory,
          cleanup_status: cleanupStatus,
          elapsed_ms: elapsedMs,
          failure_code: failureCode,
          failure_message: failureMessage
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("WHERE id = ? AND state IN ('started', 'submitting')")) {
        const [runState, resultCategory, cleanupStatus, elapsedMs, failureCode, failureMessage, runId] = params;
        const run = state.runs.get(runId);
        if (!["started", "submitting"].includes(run?.state)) return [{ affectedRows: 0 }];
        state.runs.set(runId, {
          ...run,
          state: runState,
          result_category: resultCategory,
          cleanup_status: cleanupStatus,
          elapsed_ms: elapsedMs,
          failure_code: failureCode,
          failure_message: failureMessage
        });
        return [{ affectedRows: 1 }];
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

test("async preflight run transitions only advance from their expected state", async () => {
  const connection = createFakePreflightConnection();
  connection.state.runs.set("run-1", { id: "run-1", state: "started" });

  assert.equal(
    await markProductionPreflightRunSubmitting({ connection, runId: "run-1" }),
    true
  );
  assert.equal(
    await markProductionPreflightRunAwaitingCallback({
      connection,
      runId: "run-1",
      elapsedMs: 10
    }),
    true
  );
  assert.equal(
    await markProductionPreflightRunAwaitingCallback({
      connection,
      runId: "run-1",
      elapsedMs: 20
    }),
    false
  );
  assert.equal(connection.state.runs.get("run-1").state, "awaiting_callback");
});

test("callback finalization records cleanup failure and releases the provider lock", async () => {
  const connection = createFakePreflightConnection();
  connection.state.runs.set("run-1", {
    id: "run-1",
    provider: "wechat_image",
    case_id: "wechat-image-v1",
    state: "awaiting_callback",
    started_at: new Date("2026-07-13T00:00:00.000Z")
  });
  connection.state.locks.set("wechat_image", {
    provider: "wechat_image",
    last_started_at: new Date("2026-07-13T00:00:00.000Z"),
    active_run_id: "run-1"
  });

  const result = await finalizeProductionPreflightRun({
    connection,
    runId: "run-1",
    provider: "wechat_image",
    resultCategory: "pass",
    cleanupObject: async () => {
      throw new Error("private COS delete failed");
    },
    now: new Date("2026-07-13T00:01:00.000Z")
  });

  assert.deepEqual(result, {
    finalized: true,
    state: "failed",
    resultCategory: "error",
    cleanupStatus: "cleanup_failed"
  });
  assert.equal(connection.state.runs.get("run-1").state, "failed");
  assert.equal(connection.state.runs.get("run-1").cleanup_status, "cleanup_failed");
  assert.equal(connection.state.locks.get("wechat_image").active_run_id, null);
  assert.equal(JSON.stringify(connection.state).includes("private COS delete failed"), false);
});

test("callback finalization is idempotent and does not clean a terminal run twice", async () => {
  const connection = createFakePreflightConnection();
  connection.state.runs.set("run-1", {
    id: "run-1",
    provider: "tencent_video",
    case_id: "tencent-video-v1",
    state: "awaiting_callback",
    started_at: new Date("2026-07-13T00:00:00.000Z")
  });
  connection.state.locks.set("tencent_video", {
    provider: "tencent_video",
    last_started_at: new Date("2026-07-13T00:00:00.000Z"),
    active_run_id: "run-1"
  });
  let cleanupCount = 0;
  const input = {
    connection,
    runId: "run-1",
    provider: "tencent_video",
    resultCategory: "pass",
    cleanupObject: async () => {
      cleanupCount += 1;
    }
  };

  const first = await finalizeProductionPreflightRun(input);
  const duplicate = await finalizeProductionPreflightRun(input);

  assert.equal(first.finalized, true);
  assert.deepEqual(duplicate, { finalized: false, state: "passed" });
  assert.equal(cleanupCount, 1);
});

test("runner finish cannot overwrite a terminal preflight result", async () => {
  const connection = createFakePreflightConnection();
  connection.state.runs.set("run-1", { id: "run-1", state: "passed" });

  const finished = await finishProductionPreflightRun({
    connection,
    runId: "run-1",
    state: "failed",
    resultCategory: "error",
    cleanupStatus: "not_required",
    elapsedMs: 10,
    failureCode: "PRODUCTION_PREFLIGHT_FAILED",
    failureMessage: "submission failed"
  });

  assert.equal(finished, false);
  assert.equal(connection.state.runs.get("run-1").state, "passed");
});

test("repository lists only expired asynchronous preflight runs", async () => {
  const connection = createFakePreflightConnection();
  connection.state.runs.set("old", {
    id: "old",
    provider: "wechat_image",
    case_id: "wechat-image-v1",
    state: "awaiting_callback",
    config_fingerprint: "old-cfg",
    updated_at: new Date("2026-07-13T00:00:00.000Z")
  });
  connection.state.runs.set("recent", {
    id: "recent",
    provider: "tencent_video",
    case_id: "tencent-video-v1",
    state: "awaiting_callback",
    config_fingerprint: "recent-cfg",
    updated_at: new Date("2026-07-13T00:14:00.000Z")
  });
  connection.state.runs.set("done", {
    id: "done",
    provider: "wechat_image",
    case_id: "wechat-image-v1",
    state: "passed",
    config_fingerprint: "done-cfg",
    updated_at: new Date("2026-07-13T00:00:00.000Z")
  });

  const runs = await listTimedOutProductionPreflightRuns({
    connection,
    cutoff: new Date("2026-07-13T00:10:00.000Z"),
    limit: 10
  });

  assert.deepEqual(runs, [{
    id: "old",
    provider: "wechat_image",
    caseId: "wechat-image-v1",
    configFingerprint: "old-cfg"
  }]);
  const listQuery = connection.state.sql.find((sql) => sql.includes("SELECT id, provider, case_id"));
  assert.match(listQuery, /LIMIT 10$/);
  assert.doesNotMatch(listQuery, /LIMIT \?/);
  const listQueryIndex = connection.state.sql.indexOf(listQuery);
  assert.deepEqual(connection.state.params[listQueryIndex], ["2026-07-13 00:10:00.000"]);
});

test("repository also lists an expired started preflight for recovery", async () => {
  const connection = createFakePreflightConnection();
  connection.state.runs.set("started", {
    id: "started",
    provider: "tencent_video",
    case_id: "tencent-video-v1",
    state: "started",
    config_fingerprint: "started-cfg",
    updated_at: new Date("2026-07-13T00:00:00.000Z")
  });

  const runs = await listTimedOutProductionPreflightRuns({
    connection,
    cutoff: new Date("2026-07-13T00:10:00.000Z"),
    limit: 10
  });

  assert.deepEqual(runs, [{
    id: "started",
    provider: "tencent_video",
    caseId: "tencent-video-v1",
    configFingerprint: "started-cfg"
  }]);
});
