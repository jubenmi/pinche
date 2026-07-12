import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  classifyModerationError,
  MODERATION_RETRY_ROUTES,
  moderationRetryAt,
  runContentModerationRetryBatch
} from "../src/modules/content-moderation/retry.js";
import { claimModerationRetryJobs } from "../src/modules/content-moderation/repository.js";

test("retry classifier separates transient failures from operational alerts", () => {
  for (const code of [
    "WECHAT_CONTENT_SECURITY_NETWORK_ERROR",
    "WECHAT_CONTENT_SECURITY_TIMEOUT",
    "WECHAT_CONTENT_SECURITY_RATE_LIMITED",
    "TENCENT_CI_VIDEO_UPSTREAM_5XX"
  ]) {
    assert.equal(classifyModerationError({ code }).retryable, true, code);
  }
  assert.deepEqual(classifyModerationError({ code: "TENCENT_CI_VIDEO_RATE_LIMITED" }), {
    retryable: true,
    alert: true,
    code: "TENCENT_CI_VIDEO_RATE_LIMITED"
  });
  for (const code of [
    "WECHAT_CONTENT_SECURITY_TOKEN_INVALID",
    "WECHAT_CONTENT_SECURITY_PERMISSION_DENIED",
    "WECHAT_CONTENT_SECURITY_QUOTA_EXHAUSTED",
    "CONTENT_MODERATION_OPENID_REQUIRED",
    "CONTENT_MODERATION_RETRY_FACTS_INVALID",
    "AuthFailure",
    "UnauthorizedOperation",
    "FailedOperation.BalanceNotEnough",
    "InvalidParameter.BizType",
    "LimitExceeded",
    "ResourceUnavailable"
  ]) {
    const result = classifyModerationError({ code });
    assert.equal(result.retryable, false, code);
    assert.equal(result.alert, true, code);
    assert.equal(result.code, code, code);
  }
  assert.deepEqual(classifyModerationError({ code: "UNRECOGNIZED_PROVIDER_ERROR" }), {
    retryable: false,
    alert: true,
    code: "CONTENT_MODERATION_UNKNOWN_ERROR"
  });
});

test("mixed retry routes enumerate only legal provider and subject-type pairs", () => {
  assert.equal(Object.isFrozen(MODERATION_RETRY_ROUTES), true);
  assert.equal(
    MODERATION_RETRY_ROUTES.some((route) => (
      route.provider === "wechat_sec_check" && route.subjectType === "user_nickname"
    )),
    true
  );
  assert.equal(
    MODERATION_RETRY_ROUTES.some((route) => (
      route.provider === "wechat_sec_check" && route.subjectType === "album_image"
    )),
    true
  );
  assert.equal(
    MODERATION_RETRY_ROUTES.some((route) => (
      route.provider === "tencent_ci_video" && route.subjectType === "album_video"
    )),
    true
  );
  assert.equal(
    MODERATION_RETRY_ROUTES.some((route) => (
      route.provider === "wechat_sec_check" && route.subjectType === "album_video"
    )),
    false
  );
  assert.equal(
    MODERATION_RETRY_ROUTES.some((route) => (
      route.provider === "tencent_ci_video" && route.subjectType === "user_nickname"
    )),
    false
  );
});
test("bounded exponential backoff uses deterministic jitter", () => {
  assert.equal(moderationRetryAt(1_000, 1, () => 0).getTime(), 31_000);
  assert.equal(moderationRetryAt(1_000, 2, () => 0).getTime(), 61_000);
  assert.ok(moderationRetryAt(1_000, 20, () => 1).getTime() <= 1_000 + 6 * 60 * 60 * 1000);
});

test("retry batch rejects a lease shorter than the bounded WeChat refresh-and-retry chain", async () => {
  await assert.rejects(runContentModerationRetryBatch({
    repository: {},
    withTransaction: async () => assert.fail("an unsafe lease must fail before any claim"),
    processJob: async () => {},
    leaseMs: 89_999
  }), /at least 90000 milliseconds/);
});

test("claim SQL leases due jobs with skip locked, terminal exclusion, and strict routes", async () => {
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
    limit: 1,
    routes: [
      { provider: "wechat_sec_check", subjectType: "album_image" },
      { provider: "tencent_ci_video", subjectType: "album_video" }
    ]
  });
  assert.equal(rows.length, 2);
  assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(calls[0].sql, /attempt_count < \?/);
  assert.match(calls[0].sql, /retry_exhausted_at IS NULL/);
  assert.match(calls[0].sql, /job\.provider = \? AND job\.subject_type = \?/);
  assert.doesNotMatch(calls[0].sql, /job\.provider IN/);
  assert.doesNotMatch(calls[0].sql, /job\.subject_type IN \(\?\)/);
  assert.match(calls[1].sql, /lease_token = \?/);
  assert.equal(rows[0].lease_token, "lease");
  assert.equal(rows[0].lease_expires_at.getTime(), 61_000);
});

test("claim SQL never cross-products independently listed providers and subject types", async () => {
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
    routes: [
      { provider: "wechat_sec_check", subjectType: "album_image" },
      { provider: "tencent_ci_video", subjectType: "album_video" }
    ]
  });

  assert.match(
    calls[0].sql,
    /\(job\.provider = \? AND job\.subject_type = \?\) OR \(job\.provider = \? AND job\.subject_type = \?\)/
  );
  assert.deepEqual(calls[0].params.slice(-5), [
    "wechat_sec_check", "album_image", "tencent_ci_video", "album_video", 10
  ]);
});

test("retry batch processes each lease and persists failures without auto-approval", async () => {
  const state = { failures: [], processed: [] };
  const jobs = [
    { id: 1, attempt_count: 0, provider: "wechat_sec_check", subject_type: "album_image" },
    { id: 2, attempt_count: 7, provider: "tencent_ci_video", subject_type: "album_video" }
  ];
  const repository = {
    claimModerationRetryJobs: async (_connection, input) => {
      assert.equal(input.limit, 1);
      const job = jobs.shift();
      return job ? [{ ...job, lease_token: input.leaseToken }] : [];
    },
    failModerationJob: async (_connection, input) => {
      state.failures.push(input);
      return true;
    }
  };
  const result = await runContentModerationRetryBatch({
    repository,
    withTransaction: async (run) => run({}),
    processJob: async (job) => {
      state.processed.push(job.id);
      throw Object.assign(new Error("timeout"), { code: "COS_REQUEST_TIMEOUT" });
    },
    now: () => 1_000,
    randomUUID: (() => {
      let count = 0;
      return () => `lease-${++count}`;
    })(),
    random: () => 0,
    retryLimit: 8,
    emit: () => {}
  });
  assert.deepEqual(state.processed, [1, 2]);
  assert.equal(state.failures[0].leaseToken, "lease-1");
  assert.equal(state.failures[1].leaseToken, "lease-2");
  assert.equal(state.failures[0].nextRetryAt.getTime(), 31_000);
  assert.equal(state.failures[1].exhausted, true);
  assert.deepEqual(result, { claimed: 2, failed: 2 });
});

test("retry batch stops claiming and submitting after its in-flight job requests shutdown", async () => {
  const controller = new AbortController();
  const jobs = [
    { id: 31, attempt_count: 0, provider: "wechat_sec_check", subject_type: "album_image" },
    { id: 32, attempt_count: 0, provider: "tencent_ci_video", subject_type: "album_video" }
  ];
  const claims = [];
  const submissions = [];

  const result = await runContentModerationRetryBatch({
    repository: {
      claimModerationRetryJobs: async (_connection, input) => {
        claims.push(input.leaseToken);
        const job = jobs.shift();
        return job ? [{ ...job, lease_token: input.leaseToken }] : [];
      },
      failModerationJob: async () => assert.fail("the first job completes successfully")
    },
    withTransaction: async (run) => run({}),
    processJob: async (job) => {
      submissions.push(job.id);
      controller.abort();
    },
    signal: controller.signal,
    isStopping: () => controller.signal.aborted,
    now: () => 1_000,
    randomUUID: (() => {
      let count = 0;
      return () => `shutdown-lease-${++count}`;
    })(),
    limit: 2,
    emit: () => {}
  });

  assert.deepEqual(result, { claimed: 1, failed: 0 });
  assert.deepEqual(claims, ["shutdown-lease-1"]);
  assert.deepEqual(submissions, [31]);
});

test("retry batch stops after an in-flight failed job even when its stale lease cannot persist", async () => {
  const controller = new AbortController();
  const jobs = [
    { id: 41, attempt_count: 0, provider: "wechat_sec_check", subject_type: "album_image" },
    { id: 42, attempt_count: 0, provider: "tencent_ci_video", subject_type: "album_video" }
  ];
  const claims = [];
  const submissions = [];

  const result = await runContentModerationRetryBatch({
    repository: {
      claimModerationRetryJobs: async (_connection, input) => {
        claims.push(input.leaseToken);
        const job = jobs.shift();
        return job ? [{ ...job, lease_token: input.leaseToken }] : [];
      },
      failModerationJob: async () => false
    },
    withTransaction: async (run) => run({}),
    processJob: async (job) => {
      submissions.push(job.id);
      controller.abort();
      throw Object.assign(new Error("lease changed"), { code: "WECHAT_CONTENT_SECURITY_TIMEOUT" });
    },
    signal: controller.signal,
    isStopping: () => controller.signal.aborted,
    now: () => 1_000,
    randomUUID: (() => {
      let count = 0;
      return () => `stale-shutdown-lease-${++count}`;
    })(),
    limit: 2,
    emit: () => {}
  });

  assert.deepEqual(result, { claimed: 1, failed: 1 });
  assert.deepEqual(claims, ["stale-shutdown-lease-1"]);
  assert.deepEqual(submissions, [41]);
});

test("retry batch dispatches all three legal categories without cross-provider processing", async () => {
  const candidates = [
    { id: 10, provider: "wechat_sec_check", subject_type: "user_nickname", status: "error" },
    { id: 11, provider: "wechat_sec_check", subject_type: "album_image", status: "pending" },
    { id: 12, provider: "wechat_sec_check", subject_type: "album_image", status: "error" },
    { id: 13, provider: "tencent_ci_video", subject_type: "album_video", status: "error" },
    { id: 14, provider: "wechat_sec_check", subject_type: "album_video", status: "error" },
    { id: 15, provider: "tencent_ci_video", subject_type: "session_message", status: "error" }
  ];
  const state = { claim: null, processed: [], failed: [] };
  const repository = {
    claimModerationRetryJobs: async (_connection, input) => {
      state.claim = input;
      const index = candidates.findIndex((job) => input.routes.some((route) => (
        route.provider === job.provider && route.subjectType === job.subject_type
      )));
      if (index < 0) return [];
      const [job] = candidates.splice(index, 1);
      return job ? [{ ...job, lease_token: input.leaseToken }] : [];
    },
    failModerationJob: async (_connection, input) => { state.failed.push(input); return true; }
  };

  const result = await runContentModerationRetryBatch({
    repository,
    withTransaction: async (run) => run({}),
    processJob: async (job) => { state.processed.push(job.id); },
    now: () => 1_000,
    randomUUID: (() => {
      let count = 0;
      return () => `lease-${++count}`;
    })(),
    emit: () => {}
  });

  assert.deepEqual(state.claim.routes, MODERATION_RETRY_ROUTES);
  assert.deepEqual(state.processed, [10, 11, 12, 13]);
  assert.deepEqual(state.failed, []);
  assert.deepEqual(result, { claimed: 4, failed: 0 });
});

test("operational failures persist once, raise a high-priority alert, and do not schedule a retry", async () => {
  const events = [];
  const failures = [];
  let claimed = false;
  const result = await runContentModerationRetryBatch({
    repository: {
      claimModerationRetryJobs: async (_connection, input) => {
        if (claimed) return [];
        claimed = true;
        return [{
          id: 20,
          attempt_count: 1,
          provider: "wechat_sec_check",
          subject_type: "album_image",
          lease_token: input.leaseToken
        }];
      },
      failModerationJob: async (_connection, input) => {
        failures.push(input);
        return true;
      }
    },
    withTransaction: async (run) => run({}),
    processJob: async () => {
      throw Object.assign(new Error("quota exhausted"), {
        code: "WECHAT_CONTENT_SECURITY_QUOTA_EXHAUSTED"
      });
    },
    now: () => 1_000,
    randomUUID: () => "lease",
    emit: (event, fields) => events.push({ event, fields })
  });

  assert.equal(failures.length, 1);
  assert.equal(failures[0].exhausted, true);
  const fields = {
    provider: "wechat_sec_check",
    subjectType: "album_image",
    outcome: "operator_required",
    errorCode: "WECHAT_CONTENT_SECURITY_QUOTA_EXHAUSTED",
    attempt: 2,
    priority: "high"
  };
  assert.deepEqual(events, [
    { event: "moderation_submission_failure", fields },
    { event: "moderation_operational_alert", fields }
  ]);
  assert.deepEqual(result, { claimed: 1, failed: 1 });
});

test("token infrastructure unavailability keeps backoff while raising a high-priority operational alert", async () => {
  const events = [];
  const failures = [];
  let claimed = false;
  await runContentModerationRetryBatch({
    repository: {
      claimModerationRetryJobs: async (_connection, input) => {
        if (claimed) return [];
        claimed = true;
        return [{
          id: 23,
          attempt_count: 1,
          provider: "wechat_sec_check",
          subject_type: "session_update",
          lease_token: input.leaseToken
        }];
      },
      failModerationJob: async (_connection, input) => {
        failures.push(input);
        return true;
      }
    },
    withTransaction: async (run) => run({}),
    processJob: async () => {
      throw Object.assign(new Error("token refresh infrastructure failed"), {
        code: "WECHAT_CONTENT_SECURITY_TOKEN_UNAVAILABLE"
      });
    },
    now: () => 1_000,
    randomUUID: () => "lease-token-unavailable",
    random: () => 0,
    emit: (event, fields) => events.push({ event, fields })
  });

  assert.equal(failures[0].exhausted, false);
  assert.equal(failures[0].nextRetryAt.getTime(), 61_000);
  const fields = {
    provider: "wechat_sec_check",
    subjectType: "session_update",
    outcome: "retry_scheduled",
    errorCode: "WECHAT_CONTENT_SECURITY_TOKEN_UNAVAILABLE",
    attempt: 2,
    priority: "high"
  };
  assert.deepEqual(events, [
    { event: "moderation_submission_failure", fields },
    { event: "moderation_retry_scheduled", fields },
    { event: "moderation_operational_alert", fields }
  ]);
});

test("retry-limit exhaustion raises a high-priority alert even for a transient upstream failure", async () => {
  const events = [];
  let claimed = false;
  await runContentModerationRetryBatch({
    repository: {
      claimModerationRetryJobs: async (_connection, input) => {
        if (claimed) return [];
        claimed = true;
        return [{
          id: 22,
          attempt_count: 7,
          provider: "tencent_ci_video",
          subject_type: "album_video",
          lease_token: input.leaseToken
        }];
      },
      failModerationJob: async () => true
    },
    withTransaction: async (run) => run({}),
    processJob: async () => { throw Object.assign(new Error("upstream"), { code: "TENCENT_CI_VIDEO_UPSTREAM_5XX" }); },
    now: () => 1_000,
    randomUUID: () => "lease",
    emit: (event, fields) => events.push({ event, fields })
  });

  const fields = {
    provider: "tencent_ci_video",
    subjectType: "album_video",
    outcome: "operator_required",
    errorCode: "TENCENT_CI_VIDEO_UPSTREAM_5XX",
    attempt: 8,
    priority: "high"
  };
  assert.deepEqual(events, [
    { event: "moderation_submission_failure", fields },
    { event: "moderation_retry_exhausted", fields }
  ]);
});

test("a stale or expired lease never emits a duplicate failure or alert", async () => {
  const events = [];
  let claimed = false;
  await runContentModerationRetryBatch({
    repository: {
      claimModerationRetryJobs: async (_connection, input) => {
        if (claimed) return [];
        claimed = true;
        return [{
          id: 21,
          attempt_count: 0,
          provider: "tencent_ci_video",
          subject_type: "album_video",
          lease_token: input.leaseToken
        }];
      },
      failModerationJob: async () => false
    },
    withTransaction: async (run) => run({}),
    processJob: async () => { throw Object.assign(new Error("timeout"), { code: "TENCENT_CI_VIDEO_TIMEOUT" }); },
    now: () => 1_000,
    randomUUID: () => "lease",
    emit: (event, fields) => events.push({ event, fields })
  });

  assert.deepEqual(events, []);
});

test("retry job reuses the controlled mixed moderation runtime instead of copying provider wiring", async () => {
  const source = await readFile(
    new URL("../src/jobs/content-moderation-retry.js", import.meta.url),
    "utf8"
  );

  assert.match(source, /import \{ contentModeration \} from "\.\.\/server\.js"/);
  assert.match(source, /createContentModerationRetryProcessor/);
  assert.match(source, /routes: MODERATION_RETRY_ROUTES/);
  assert.match(source, /leaseMs: retryLeaseMs/);
  assert.match(source, /runContentModerationRetryLoop/);
  assert.doesNotMatch(source, /createTencentVideoModerationClient/);
  assert.doesNotMatch(source, /buildWechatImageModerationUrl/);
});
