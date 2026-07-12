import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyModerationError,
  moderationRetryAt,
  runContentModerationRetryBatch
} from "../src/modules/content-moderation/retry.js";
import { claimModerationRetryJobs } from "../src/modules/content-moderation/repository.js";

test("retry classifier separates transient failures from operational alerts", () => {
  for (const code of ["COS_NETWORK_ERROR", "COS_REQUEST_TIMEOUT", "RequestLimitExceeded", "InternalError"] ) {
    assert.equal(classifyModerationError({ code }).retryable, true, code);
  }
  for (const code of ["AuthFailure", "UnauthorizedOperation", "FailedOperation.BalanceNotEnough", "InvalidParameter.BizType"] ) {
    const result = classifyModerationError({ code });
    assert.equal(result.retryable, false, code);
    assert.equal(result.alert, true, code);
  }
});
test("bounded exponential backoff uses deterministic jitter", () => {
  assert.equal(moderationRetryAt(1_000, 1, () => 0).getTime(), 31_000);
  assert.equal(moderationRetryAt(1_000, 2, () => 0).getTime(), 61_000);
  assert.ok(moderationRetryAt(1_000, 20, () => 1).getTime() <= 1_000 + 6 * 60 * 60 * 1000);
});

test("claim SQL leases due jobs with skip locked and respects retry limit", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (/^\s*SELECT/.test(sql)) return [[{ id: 1 }, { id: 2 }]];
      return [{ affectedRows: 1 }];
    }
  };
  const rows = await claimModerationRetryJobs(connection, {
    leaseToken: "lease",
    now: new Date(1_000),
    leaseExpiresAt: new Date(61_000),
    retryLimit: 8,
    limit: 10
  });
  assert.equal(rows.length, 2);
  assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(calls[0].sql, /attempt_count < \?/);
  assert.match(calls[1].sql, /lease_token = \?/);
});

test("retry batch processes each lease and persists failures without auto-approval", async () => {
  const state = { failures: [], processed: [] };
  const repository = {
    claimModerationRetryJobs: async () => [
      { id: 1, attempt_count: 0 }, { id: 2, attempt_count: 7 }
    ],
    failModerationJob: async (_connection, input) => state.failures.push(input)
  };
  const result = await runContentModerationRetryBatch({
    repository,
    withTransaction: async (run) => run({}),
    processJob: async (job) => {
      state.processed.push(job.id);
      throw Object.assign(new Error("timeout"), { code: "COS_REQUEST_TIMEOUT" });
    },
    now: () => 1_000,
    randomUUID: () => "lease",
    random: () => 0,
    retryLimit: 8,
    emit: () => {}
  });
  assert.deepEqual(state.processed, [1, 2]);
  assert.equal(state.failures[0].nextRetryAt.getTime(), 31_000);
  assert.equal(state.failures[1].exhausted, true);
  assert.deepEqual(result, { claimed: 2, failed: 2 });
});
