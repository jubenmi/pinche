import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.equal(rows[0].lease_token, "lease");
  assert.equal(rows[0].lease_expires_at.getTime(), 61_000);
});

test("claim SQL can restrict a worker to its supported provider and subject type", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (/^\s*SELECT/.test(sql)) return [[]];
      return [{ affectedRows: 1 }];
    }
  };
  await claimModerationRetryJobs(connection, {
    leaseToken: "lease",
    now: new Date(1_000),
    leaseExpiresAt: new Date(61_000),
    retryLimit: 8,
    limit: 10,
    providers: ["tencent_ci_video"],
    subjectTypes: ["album_video"]
  });

  assert.match(calls[0].sql, /job\.provider IN \(\?\)/);
  assert.match(calls[0].sql, /job\.subject_type IN \(\?\)/);
  assert.deepEqual(calls[0].params.slice(-3), ["tencent_ci_video", "album_video", 10]);
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

test("current retry worker claims only Tencent album videos and leaves pending or error WeChat images untouched", async () => {
  const candidates = [
    { id: 11, provider: "wechat_sec_check", subject_type: "album_image", status: "pending" },
    { id: 12, provider: "wechat_sec_check", subject_type: "album_image", status: "error" },
    { id: 13, provider: "tencent_ci_video", subject_type: "album_video", status: "error" }
  ];
  const state = { claim: null, processed: [], failed: [] };
  const repository = {
    claimModerationRetryJobs: async (_connection, input) => {
      state.claim = input;
      return candidates.filter((job) => (
        input.providers.includes(job.provider) && input.subjectTypes.includes(job.subject_type)
      ));
    },
    failModerationJob: async (_connection, input) => state.failed.push(input)
  };

  const result = await runContentModerationRetryBatch({
    repository,
    withTransaction: async (run) => run({}),
    processJob: async (job) => { state.processed.push(job.id); },
    claimFilter: {
      providers: ["tencent_ci_video"],
      subjectTypes: ["album_video"]
    },
    now: () => 1_000,
    randomUUID: () => "lease",
    emit: () => {}
  });

  assert.deepEqual(state.claim.providers, ["tencent_ci_video"]);
  assert.deepEqual(state.claim.subjectTypes, ["album_video"]);
  assert.deepEqual(state.processed, [13]);
  assert.deepEqual(state.failed, []);
  assert.deepEqual(result, { claimed: 1, failed: 0 });
});

test("retry submission rolls over provider attempts inside one transaction", async () => {
  const source = await readFile(
    new URL("../src/jobs/content-moderation-retry.js", import.meta.url),
    "utf8"
  );

  assert.match(source, /const recorded = await withTransaction\(/);
  assert.match(source, /return repository\.recordModerationSubmission/);
  assert.match(source, /if \(!recorded\)[\s\S]*CONTENT_MODERATION_SUBMISSION_STALE/);
  assert.match(source, /provider: "tencent_ci_video"/);
  assert.match(source, /leaseToken: job\.lease_token/);
  assert.match(source, /claimFilter:\s*\{[\s\S]*providers:\s*\["tencent_ci_video"\]/);
  assert.match(source, /subjectTypes:\s*\["album_video"\]/);
});
