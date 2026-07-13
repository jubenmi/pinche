import assert from "node:assert/strict";
import test from "node:test";

import {
  createContentModerationTelemetry,
  emitModerationQueueSnapshots
} from "../src/modules/content-moderation/telemetry.js";

test("content moderation telemetry keeps only low-cardinality safe fields", () => {
  const records = [];
  const telemetry = createContentModerationTelemetry({
    now: () => new Date("2026-07-12T08:00:00.000Z"),
    sink: (line) => records.push(JSON.parse(line))
  });

  telemetry.emit("moderation_submission_success", {
    provider: "wechat_sec_check",
    subjectType: "album_image",
    outcome: "processing",
    content: "这是不应进入日志的完整私密文本",
    appSecret: "wx-secret-value",
    accessToken: "access-token-value",
    signedUrl: "https://cos.example/private.jpg?signature=reusable",
    objectKey: "uploads/session-album/display/private.jpg",
    openid: "openid-private",
    jobId: 123
  });

  assert.deepEqual(records, [{
    type: "content_moderation",
    event: "moderation_submission_success",
    metric: "content_moderation_submissions_total",
    metricKind: "counter",
    value: 1,
    at: "2026-07-12T08:00:00.000Z",
    provider: "wechat_sec_check",
    subjectType: "album_image",
    outcome: "processing"
  }]);

  const serialized = JSON.stringify(records[0]);
  for (const secret of [
    "完整私密文本",
    "wx-secret-value",
    "access-token-value",
    "signature=reusable",
    "private.jpg",
    "openid-private",
    "123"
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test("submission failures count in the submissions metric with a bounded outcome", () => {
  const records = [];
  const telemetry = createContentModerationTelemetry({
    now: () => new Date("2026-07-12T08:00:00.000Z"),
    sink: (line) => records.push(JSON.parse(line))
  });

  telemetry.emit("moderation_submission_failure", {
    provider: "tencent_ci_video",
    subjectType: "album_video",
    outcome: "operator_required",
    errorCode: "FailedOperation.BalanceNotEnough",
    attempt: 3,
    priority: "high"
  });

  assert.deepEqual(records[0], {
    type: "content_moderation",
    event: "moderation_submission_failure",
    metric: "content_moderation_submissions_total",
    metricKind: "counter",
    value: 1,
    at: "2026-07-12T08:00:00.000Z",
    provider: "tencent_ci_video",
    subjectType: "album_video",
    outcome: "operator_required",
    errorCode: "FailedOperation.BalanceNotEnough",
    attempt: 3,
    priority: "high",
    alertType: "tencent_video_billing"
  });
});

test("scheduled retries retain their own retry metric after submission failures are counted separately", () => {
  const records = [];
  const telemetry = createContentModerationTelemetry({
    now: () => new Date("2026-07-12T08:00:00.000Z"),
    sink: (line) => records.push(JSON.parse(line))
  });

  telemetry.emit("moderation_retry_scheduled", {
    provider: "wechat_sec_check",
    subjectType: "album_image",
    outcome: "retry_scheduled",
    errorCode: "WECHAT_CONTENT_SECURITY_TIMEOUT",
    attempt: 1
  });

  assert.deepEqual(records[0], {
    type: "content_moderation",
    event: "moderation_retry_scheduled",
    metric: "content_moderation_retries_total",
    metricKind: "counter",
    value: 1,
    at: "2026-07-12T08:00:00.000Z",
    provider: "wechat_sec_check",
    subjectType: "album_image",
    outcome: "retry_scheduled",
    errorCode: "WECHAT_CONTENT_SECURITY_TIMEOUT",
    attempt: 1
  });
});

test("decision latency is emitted as an independent bounded histogram metric", () => {
  const records = [];
  const telemetry = createContentModerationTelemetry({
    now: () => new Date("2026-07-12T08:00:00.000Z"),
    sink: (line) => records.push(JSON.parse(line))
  });

  telemetry.emit("moderation_latency", {
    provider: "wechat_sec_check",
    subjectType: "session_message",
    outcome: "approved",
    latencyMs: 1_234
  });

  assert.deepEqual(records[0], {
    type: "content_moderation",
    event: "moderation_latency",
    metric: "content_moderation_latency_ms",
    metricKind: "histogram",
    value: 1_234,
    at: "2026-07-12T08:00:00.000Z",
    provider: "wechat_sec_check",
    subjectType: "session_message",
    outcome: "approved",
    latencyMs: 1_234
  });
});

test("queue oldest age is emitted as an independent bounded gauge", () => {
  const records = [];
  const telemetry = createContentModerationTelemetry({
    now: () => new Date("2026-07-12T08:00:00.000Z"),
    sink: (line) => records.push(JSON.parse(line))
  });

  telemetry.emit("moderation_queue_oldest_age", {
    provider: "tencent_ci_video",
    subjectType: "album_video",
    outcome: "error",
    oldestAgeSeconds: 901
  });

  assert.deepEqual(records[0], {
    type: "content_moderation",
    event: "moderation_queue_oldest_age",
    metric: "content_moderation_queue_oldest_age_seconds",
    metricKind: "gauge",
    value: 901,
    at: "2026-07-12T08:00:00.000Z",
    provider: "tencent_ci_video",
    subjectType: "album_video",
    outcome: "error",
    oldestAgeSeconds: 901
  });
});

test("operational alerts map WeChat and Tencent failures to stable high-priority categories", () => {
  const records = [];
  const telemetry = createContentModerationTelemetry({
    now: () => new Date("2026-07-12T08:00:00.000Z"),
    sink: (line) => records.push(JSON.parse(line))
  });

  telemetry.emit("moderation_operational_alert", {
    provider: "wechat_sec_check",
    subjectType: "album_image",
    outcome: "operator_required",
    errorCode: "WECHAT_CONTENT_SECURITY_QUOTA_EXHAUSTED",
    priority: "high"
  });
  telemetry.emit("moderation_operational_alert", {
    provider: "tencent_ci_video",
    subjectType: "album_video",
    outcome: "operator_required",
    errorCode: "FailedOperation.BalanceNotEnough",
    priority: "high"
  });
  telemetry.emit("moderation_retry_exhausted", {
    provider: "tencent_ci_video",
    subjectType: "album_video",
    outcome: "operator_required",
    errorCode: "CONTENT_MODERATION_UNAVAILABLE",
    priority: "high"
  });

  assert.deepEqual(records.map((record) => ({
    event: record.event,
    provider: record.provider,
    alertType: record.alertType,
    priority: record.priority,
    errorCode: record.errorCode
  })), [
    {
      event: "moderation_operational_alert",
      provider: "wechat_sec_check",
      alertType: "wechat_quota",
      priority: "high",
      errorCode: "WECHAT_CONTENT_SECURITY_QUOTA_EXHAUSTED"
    },
    {
      event: "moderation_operational_alert",
      provider: "tencent_ci_video",
      alertType: "tencent_video_billing",
      priority: "high",
      errorCode: "FailedOperation.BalanceNotEnough"
    },
    {
      event: "moderation_retry_exhausted",
      provider: "tencent_ci_video",
      alertType: "retry_exhausted",
      priority: "high",
      errorCode: "CONTENT_MODERATION_UNAVAILABLE"
    }
  ]);
});

test("all required provider permission, quota, CAM, policy, and billing alerts retain high priority", () => {
  const records = [];
  const telemetry = createContentModerationTelemetry({
    sink: (line) => records.push(JSON.parse(line))
  });
  const cases = [
    ["wechat_sec_check", "album_image", "WECHAT_CONTENT_SECURITY_TOKEN_UNAVAILABLE", "wechat_token"],
    ["wechat_sec_check", "album_image", "WECHAT_CONTENT_SECURITY_PERMISSION_DENIED", "wechat_permission"],
    ["wechat_sec_check", "album_image", "WECHAT_CONTENT_SECURITY_QUOTA_EXHAUSTED", "wechat_quota"],
    ["tencent_ci_video", "album_video", "AuthFailure", "tencent_video_cam"],
    ["tencent_ci_video", "album_video", "InvalidParameter.BizType", "tencent_video_policy"],
    ["tencent_ci_video", "album_video", "LimitExceeded", "tencent_video_quota"],
    ["tencent_ci_video", "album_video", "TENCENT_CI_VIDEO_RATE_LIMITED", "tencent_video_quota"],
    ["tencent_ci_video", "album_video", "FailedOperation.BalanceNotEnough", "tencent_video_billing"]
  ];

  for (const [provider, subjectType, errorCode] of cases) {
    telemetry.emit("moderation_operational_alert", {
      provider,
      subjectType,
      outcome: "operator_required",
      errorCode,
      priority: "high"
    });
  }

  assert.deepEqual(records.map((record) => [record.errorCode, record.alertType, record.priority]), cases.map(
    ([, , errorCode, alertType]) => [errorCode, alertType, "high"]
  ));
});

test("queue snapshots publish bounded depth and oldest-age gauges and alert on overdue work", () => {
  const events = [];
  const telemetry = {
    emit(event, fields) {
      events.push({ event, fields });
    }
  };

  emitModerationQueueSnapshots({
    telemetry,
    rows: [
      {
        provider: "wechat_sec_check",
        subject_type: "album_image",
        status: "pending",
        queue_depth: 3,
        oldest_age_seconds: 901
      },
      {
        provider: "tencent_ci_video",
        subject_type: "album_video",
        status: "processing",
        queue_depth: 1,
        oldest_age_seconds: 12
      }
    ],
    alertAgeSeconds: 900
  });

  assert.deepEqual(events, [
    {
      event: "moderation_queue_snapshot",
      fields: {
        provider: "wechat_sec_check",
        subjectType: "album_image",
        outcome: "pending",
        queueDepth: 3,
        oldestAgeSeconds: 901
      }
    },
    {
      event: "moderation_queue_oldest_age",
      fields: {
        provider: "wechat_sec_check",
        subjectType: "album_image",
        outcome: "pending",
        queueDepth: 3,
        oldestAgeSeconds: 901
      }
    },
    {
      event: "moderation_operational_alert",
      fields: {
        provider: "wechat_sec_check",
        subjectType: "album_image",
        outcome: "pending",
        errorCode: "CONTENT_MODERATION_QUEUE_AGE_EXCEEDED",
        priority: "high"
      }
    },
    {
      event: "moderation_queue_snapshot",
      fields: {
        provider: "tencent_ci_video",
        subjectType: "album_video",
        outcome: "processing",
        queueDepth: 1,
        oldestAgeSeconds: 12
      }
    },
    {
      event: "moderation_queue_oldest_age",
      fields: {
        provider: "tencent_ci_video",
        subjectType: "album_video",
        outcome: "processing",
        queueDepth: 1,
        oldestAgeSeconds: 12
      }
    }
  ]);
});

test("telemetry rejects unknown event names and collapses unknown dimensions", () => {
  const records = [];
  const telemetry = createContentModerationTelemetry({
    sink: (line) => records.push(JSON.parse(line))
  });

  assert.throws(() => telemetry.emit("moderation_private_payload", {}), /unsupported content moderation telemetry event/);
  telemetry.emit("moderation_access_denied", {
    provider: "unbounded-provider-name",
    subjectType: "unbounded-subject",
    outcome: "unbounded-outcome",
    errorCode: "CUSTOM_ERROR_123"
  });

  assert.deepEqual(records[0], {
    type: "content_moderation",
    event: "moderation_access_denied",
    metric: "content_moderation_access_denied_total",
    metricKind: "counter",
    value: 1,
    at: records[0].at,
    provider: "unknown",
    subjectType: "unknown",
    outcome: "unknown",
    errorCode: "CONTENT_MODERATION_UNKNOWN_ERROR"
  });
});

test("a failed telemetry sink cannot alter a moderation operation", () => {
  const telemetry = createContentModerationTelemetry({
    sink: () => { throw new Error("log destination unavailable"); }
  });
  assert.doesNotThrow(() => telemetry.emit("moderation_access_denied", {
    provider: "wechat_sec_check",
    subjectType: "album_image",
    outcome: "unpublished"
  }));
});
