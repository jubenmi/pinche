import { MODERATION_PROVIDERS, MODERATION_RETRY_ROUTES } from "./constants.js";

const SUBJECT_TYPES = new Set(MODERATION_RETRY_ROUTES.map((route) => route.subjectType));
const OUTCOMES = new Set([
  "pending",
  "processing",
  "approved",
  "review",
  "rejected",
  "error",
  "pass",
  "block",
  "retry_scheduled",
  "operator_required",
  "unpublished",
  "unauthorized",
  "invalid",
  "cos_unreferenced",
  "media_object_missing",
  "media_without_job",
  "media_job_mismatch",
  "job_media_missing",
  "job_media_mismatch",
  "job_missing_current_attempt",
  "scan_failed"
]);
const SAFE_ERROR_CODES = new Set([
  "WECHAT_CONTENT_SECURITY_TOKEN_INVALID",
  "WECHAT_CONTENT_SECURITY_TOKEN_UNAVAILABLE",
  "WECHAT_CONTENT_SECURITY_PERMISSION_DENIED",
  "WECHAT_CONTENT_SECURITY_QUOTA_EXHAUSTED",
  "WECHAT_CONTENT_SECURITY_NETWORK_ERROR",
  "WECHAT_CONTENT_SECURITY_TIMEOUT",
  "WECHAT_CONTENT_SECURITY_RATE_LIMITED",
  "WECHAT_CONTENT_SECURITY_UPSTREAM_5XX",
  "WECHAT_CONTENT_SECURITY_RESPONSE_INVALID",
  "CONTENT_MODERATION_OPENID_REQUIRED",
  "CONTENT_MODERATION_RETRY_FACTS_INVALID",
  "CONTENT_MODERATION_CALLBACK_UNAUTHORIZED",
  "CONTENT_MODERATION_INVALID_CALLBACK",
  "CONTENT_MODERATION_INVALID_RESPONSE",
  "CONTENT_MODERATION_UNAVAILABLE",
  "CONTENT_MODERATION_UNKNOWN_ERROR",
  "CONTENT_MODERATION_QUEUE_AGE_EXCEEDED",
  "CONTENT_MODERATION_QUEUE_SNAPSHOT_FAILED",
  "CONTENT_MODERATION_AUTHOR_PRIVATE_RETENTION_SNAPSHOT_FAILED",
  "CONTENT_MODERATION_ORPHAN_SCAN_FAILED",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CLEANUP_FAILED",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CALLBACK_TIMEOUT",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_GUARD_FAILED",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TIMEOUT_WORKER_FAILED",
  "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_FINALIZATION_FAILED",
  "TENCENT_CI_VIDEO_NETWORK_ERROR",
  "TENCENT_CI_VIDEO_TIMEOUT",
  "TENCENT_CI_VIDEO_RATE_LIMITED",
  "TENCENT_CI_VIDEO_UPSTREAM_5XX",
  "RequestLimitExceeded",
  "COS_OBJECT_NOT_FOUND",
  "COS_NETWORK_ERROR",
  "COS_REQUEST_TIMEOUT",
  "COS_UPSTREAM_ERROR",
  "COS_INVALID_LIST_RESPONSE",
  "AuthFailure",
  "UnauthorizedOperation",
  "CIRoleNotExist",
  "AccessDenied",
  "InvalidArgument",
  "InvalidParameter.BizType",
  "LimitExceeded",
  "ResourceUnavailable",
  "FailedOperation.BalanceNotEnough"
]);

const EVENT_DEFINITIONS = Object.freeze({
  moderation_job_created: {
    metric: "content_moderation_jobs_total",
    metricKind: "counter"
  },
  moderation_submission_success: {
    metric: "content_moderation_submissions_total",
    metricKind: "counter"
  },
  moderation_submission_failure: {
    metric: "content_moderation_submissions_total",
    metricKind: "counter"
  },
  moderation_retry_scheduled: {
    metric: "content_moderation_retries_total",
    metricKind: "counter"
  },
  moderation_retry_exhausted: {
    metric: "content_moderation_retries_total",
    metricKind: "counter"
  },
  moderation_decision_pass: {
    metric: "content_moderation_results_total",
    metricKind: "counter"
  },
  moderation_decision_review: {
    metric: "content_moderation_results_total",
    metricKind: "counter"
  },
  moderation_decision_block: {
    metric: "content_moderation_results_total",
    metricKind: "counter"
  },
  moderation_decision_error: {
    metric: "content_moderation_results_total",
    metricKind: "counter"
  },
  moderation_latency: {
    metric: "content_moderation_latency_ms",
    metricKind: "histogram"
  },
  moderation_access_denied: {
    metric: "content_moderation_access_denied_total",
    metricKind: "counter"
  },
  moderation_callback_failure: {
    metric: "content_moderation_callback_failures_total",
    metricKind: "counter"
  },
  moderation_token_refresh_failure: {
    metric: "content_moderation_token_refresh_failures_total",
    metricKind: "counter"
  },
  moderation_queue_snapshot: {
    metric: "content_moderation_queue_depth",
    metricKind: "gauge"
  },
  moderation_queue_oldest_age: {
    metric: "content_moderation_queue_oldest_age_seconds",
    metricKind: "gauge"
  },
  moderation_orphan_detected: {
    metric: "content_moderation_orphans_total",
    metricKind: "counter"
  },
  moderation_orphan_cleaned: {
    metric: "content_moderation_orphans_cleaned_total",
    metricKind: "counter"
  },
  moderation_operational_alert: {
    metric: "content_moderation_operational_alerts_total",
    metricKind: "counter"
  },
  author_private_created: {
    metric: "content_moderation_author_private_events_total",
    metricKind: "counter"
  },
  author_private_read: {
    metric: "content_moderation_author_private_events_total",
    metricKind: "counter"
  },
  author_private_cancelled: {
    metric: "content_moderation_author_private_events_total",
    metricKind: "counter"
  },
  author_private_superseded: {
    metric: "content_moderation_author_private_events_total",
    metricKind: "counter"
  },
  author_private_approved: {
    metric: "content_moderation_author_private_events_total",
    metricKind: "counter"
  },
  author_private_rejected: {
    metric: "content_moderation_author_private_events_total",
    metricKind: "counter"
  },
  author_private_purged: {
    metric: "content_moderation_author_private_events_total",
    metricKind: "counter"
  },
  author_private_access_denied: {
    metric: "content_moderation_author_private_access_denied_total",
    metricKind: "counter"
  },
  author_private_public_leak: {
    metric: "content_moderation_author_private_public_leaks_total",
    metricKind: "counter"
  },
  author_private_retained_object_count: {
    metric: "content_moderation_author_private_retained_objects",
    metricKind: "gauge"
  },
  author_private_retained_bytes: {
    metric: "content_moderation_author_private_retained_bytes",
    metricKind: "gauge"
  },
  author_private_long_lived_count: {
    metric: "content_moderation_author_private_long_lived_objects",
    metricKind: "gauge"
  },
  author_private_retention_alert: {
    metric: "content_moderation_author_private_retention_alerts_total",
    metricKind: "counter"
  }
});

const AUTHOR_PRIVATE_ROUTE_KINDS = new Set([
  "session_public_share",
  "session_discovery",
  "public_calendar",
  "public_review",
  "public_media",
  "author_text",
  "author_image",
  "author_video",
  "admin_purge"
]);
const AUTHOR_PRIVATE_REASON_CODES = new Set([
  "policy_denied",
  "not_author",
  "gate_disabled",
  "version_mismatch",
  "draft_id",
  "content_ref",
  "author_private",
  "publication_state",
  "message_type",
  "author_media_url",
  "scan_limit",
  "object_count",
  "bytes",
  "long_lived_count"
]);

const ALERT_TYPE_BY_ERROR_CODE = new Map([
  ["WECHAT_CONTENT_SECURITY_TOKEN_INVALID", "wechat_token"],
  ["WECHAT_CONTENT_SECURITY_TOKEN_UNAVAILABLE", "wechat_token"],
  ["WECHAT_CONTENT_SECURITY_PERMISSION_DENIED", "wechat_permission"],
  ["WECHAT_CONTENT_SECURITY_QUOTA_EXHAUSTED", "wechat_quota"],
  ["AuthFailure", "tencent_video_cam"],
  ["UnauthorizedOperation", "tencent_video_cam"],
  ["CIRoleNotExist", "tencent_video_cam"],
  ["AccessDenied", "tencent_video_cam"],
  ["InvalidArgument", "tencent_video_policy"],
  ["InvalidParameter.BizType", "tencent_video_policy"],
  ["LimitExceeded", "tencent_video_quota"],
  ["ResourceUnavailable", "tencent_video_quota"],
  ["TENCENT_CI_VIDEO_RATE_LIMITED", "tencent_video_quota"],
  ["RequestLimitExceeded", "tencent_video_quota"],
  ["FailedOperation.BalanceNotEnough", "tencent_video_billing"],
  ["CONTENT_MODERATION_QUEUE_AGE_EXCEEDED", "queue_oldest_age"],
  ["CONTENT_MODERATION_AUTHOR_PRIVATE_RETENTION_SNAPSHOT_FAILED", "author_private_retention"]
]);

function validInteger(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function safeProvider(value) {
  const provider = String(value || "");
  return MODERATION_PROVIDERS.includes(provider) ? provider : "unknown";
}

function safeSubjectType(value) {
  const subjectType = String(value || "");
  return SUBJECT_TYPES.has(subjectType) ? subjectType : "unknown";
}

function safeOutcome(value) {
  const outcome = String(value || "");
  return OUTCOMES.has(outcome) ? outcome : "unknown";
}

function safeErrorCode(value) {
  const code = String(value || "");
  return SAFE_ERROR_CODES.has(code) ? code : "CONTENT_MODERATION_UNKNOWN_ERROR";
}

function safeAuthorPrivateDimension(value, allowed) {
  const normalized = String(value || "");
  return allowed.has(normalized) ? normalized : "unknown";
}

function alertTypeFor(event, errorCode) {
  if (event === "moderation_retry_exhausted") return "retry_exhausted";
  if (event === "moderation_token_refresh_failure") return "wechat_token";
  return ALERT_TYPE_BY_ERROR_CODE.get(errorCode) || null;
}

function asIsoTimestamp(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function metricValue(event, fields) {
  if (event === "moderation_latency") {
    return validInteger(fields.latencyMs, {
      minimum: 0,
      maximum: 30 * 24 * 60 * 60 * 1000
    }) ?? 0;
  }
  if (event === "moderation_queue_snapshot") {
    return validInteger(fields.queueDepth, { maximum: 10_000_000 }) ?? 0;
  }
  if (event === "moderation_queue_oldest_age") {
    return validInteger(fields.oldestAgeSeconds, {
      maximum: 365 * 24 * 60 * 60
    }) ?? 0;
  }
  if (["moderation_orphan_detected", "moderation_orphan_cleaned"].includes(event)) {
    return validInteger(fields.orphanCount, { minimum: 1, maximum: 10_000_000 }) ?? 1;
  }
  if (event === "author_private_retained_object_count") {
    return validInteger(fields.retainedObjectCount, { maximum: 10_000_000 }) ?? 0;
  }
  if (event === "author_private_retained_bytes") {
    return validInteger(fields.retainedBytes, { maximum: Number.MAX_SAFE_INTEGER }) ?? 0;
  }
  if (event === "author_private_long_lived_count") {
    return validInteger(fields.longLivedCount, { maximum: 10_000_000 }) ?? 0;
  }
  return validInteger(fields.value, { minimum: 1, maximum: 10_000_000 }) ?? 1;
}

export function buildContentModerationTelemetryRecord(event, fields = {}, now = () => new Date()) {
  const definition = EVENT_DEFINITIONS[event];
  if (!definition) throw new TypeError("unsupported content moderation telemetry event");
  const record = {
    type: "content_moderation",
    event,
    metric: definition.metric,
    metricKind: definition.metricKind,
    value: metricValue(event, fields),
    at: asIsoTimestamp(now)
  };

  if (fields.provider !== undefined) record.provider = safeProvider(fields.provider);
  if (fields.subjectType !== undefined) record.subjectType = safeSubjectType(fields.subjectType);
  if (fields.outcome !== undefined) record.outcome = safeOutcome(fields.outcome);
  if (fields.errorCode !== undefined) record.errorCode = safeErrorCode(fields.errorCode);
  if (fields.priority === "high") record.priority = "high";
  if (fields.routeKind !== undefined) {
    record.routeKind = safeAuthorPrivateDimension(fields.routeKind, AUTHOR_PRIVATE_ROUTE_KINDS);
  }
  if (fields.reasonCode !== undefined) {
    record.reasonCode = safeAuthorPrivateDimension(fields.reasonCode, AUTHOR_PRIVATE_REASON_CODES);
  }

  const attempt = validInteger(fields.attempt, { minimum: 0, maximum: 100 });
  if (attempt !== null) record.attempt = attempt;
  const latencyMs = validInteger(fields.latencyMs, { maximum: 30 * 24 * 60 * 60 * 1000 });
  if (latencyMs !== null) record.latencyMs = latencyMs;
  const queueDepth = validInteger(fields.queueDepth, { maximum: 10_000_000 });
  if (queueDepth !== null) record.queueDepth = queueDepth;
  const oldestAgeSeconds = validInteger(fields.oldestAgeSeconds, { maximum: 365 * 24 * 60 * 60 });
  if (oldestAgeSeconds !== null) record.oldestAgeSeconds = oldestAgeSeconds;
  const orphanCount = validInteger(fields.orphanCount, { minimum: 1, maximum: 10_000_000 });
  if (orphanCount !== null) record.orphanCount = orphanCount;
  const retainedObjectCount = validInteger(fields.retainedObjectCount, { maximum: 10_000_000 });
  if (retainedObjectCount !== null) record.retainedObjectCount = retainedObjectCount;
  const retainedBytes = validInteger(fields.retainedBytes, { maximum: Number.MAX_SAFE_INTEGER });
  if (retainedBytes !== null) record.retainedBytes = retainedBytes;
  const longLivedCount = validInteger(fields.longLivedCount, { maximum: 10_000_000 });
  if (longLivedCount !== null) record.longLivedCount = longLivedCount;

  const alertType = alertTypeFor(event, record.errorCode);
  if (alertType) record.alertType = alertType;
  return record;
}

export function createContentModerationTelemetry({ sink = console.info, now = () => new Date() } = {}) {
  if (typeof sink !== "function" || typeof now !== "function") {
    throw new TypeError("content moderation telemetry requires sink and now functions");
  }
  return {
    emit(event, fields = {}) {
      const record = buildContentModerationTelemetryRecord(event, fields, now);
      try {
        sink(JSON.stringify(record));
      } catch {
        // Observability must not change a moderation decision or HTTP response.
      }
      return record;
    }
  };
}

export function emitModerationSubmissionFailure({
  emit,
  provider,
  subjectType,
  errorCode,
  attempt,
  retryScheduled = false,
  retryExhausted = false,
  alert = false
} = {}) {
  if (typeof emit !== "function") {
    throw new TypeError("content moderation submission failure emitter is required");
  }
  const fields = {
    provider,
    subjectType,
    outcome: retryScheduled ? "retry_scheduled" : "operator_required",
    errorCode,
    attempt,
    ...(alert || retryExhausted ? { priority: "high" } : {})
  };
  emit("moderation_submission_failure", fields);
  if (retryScheduled) emit("moderation_retry_scheduled", fields);
  if (retryExhausted) emit("moderation_retry_exhausted", fields);
  if (alert) emit("moderation_operational_alert", fields);
}

const defaultTelemetry = createContentModerationTelemetry();

export function emitContentModerationEvent(event, fields = {}) {
  return defaultTelemetry.emit(event, fields);
}

export function emitModerationQueueSnapshots({ telemetry, rows = [], alertAgeSeconds = 900 } = {}) {
  if (!telemetry || typeof telemetry.emit !== "function") {
    throw new TypeError("content moderation telemetry emitter is required");
  }
  const threshold = validInteger(alertAgeSeconds, { minimum: 60, maximum: 7 * 24 * 60 * 60 });
  if (threshold === null) throw new TypeError("queue alert age must be a safe number of seconds");
  for (const row of rows) {
    const queueDepth = validInteger(row?.queue_depth, { minimum: 0, maximum: 10_000_000 });
    const oldestAgeSeconds = validInteger(row?.oldest_age_seconds, {
      minimum: 0,
      maximum: 365 * 24 * 60 * 60
    });
    if (queueDepth === null || oldestAgeSeconds === null) continue;
    const fields = {
      provider: row?.provider,
      subjectType: row?.subject_type,
      outcome: row?.status,
      queueDepth,
      oldestAgeSeconds
    };
    telemetry.emit("moderation_queue_snapshot", fields);
    telemetry.emit("moderation_queue_oldest_age", fields);
    if (queueDepth > 0 && oldestAgeSeconds > threshold) {
      telemetry.emit("moderation_operational_alert", {
        provider: row?.provider,
        subjectType: row?.subject_type,
        outcome: row?.status,
        errorCode: "CONTENT_MODERATION_QUEUE_AGE_EXCEEDED",
        priority: "high"
      });
    }
  }
}

export function emitAuthorPrivateRetentionSnapshot({
  telemetry,
  stats = {},
  thresholds = {}
} = {}) {
  if (!telemetry || typeof telemetry.emit !== "function") {
    throw new TypeError("content moderation telemetry emitter is required");
  }
  const retainedObjectCount = validInteger(stats.retained_object_count, { maximum: 10_000_000 });
  const retainedBytes = validInteger(stats.retained_bytes, { maximum: Number.MAX_SAFE_INTEGER });
  const longLivedCount = validInteger(stats.long_lived_count, { maximum: 10_000_000 });
  if (retainedObjectCount === null || retainedBytes === null || longLivedCount === null) {
    throw new TypeError("author-private retention stats must be non-negative safe integers");
  }
  const objectCountThreshold = validInteger(thresholds.objectCount ?? 10_000, {
    minimum: 1,
    maximum: 10_000_000
  });
  const bytesThreshold = validInteger(thresholds.bytes ?? 50 * 1024 * 1024 * 1024, {
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER
  });
  const longLivedThreshold = validInteger(thresholds.longLivedCount ?? 1, {
    minimum: 1,
    maximum: 10_000_000
  });
  if (objectCountThreshold === null || bytesThreshold === null || longLivedThreshold === null) {
    throw new TypeError("author-private retention thresholds must be positive safe integers");
  }

  telemetry.emit("author_private_retained_object_count", { retainedObjectCount });
  telemetry.emit("author_private_retained_bytes", { retainedBytes });
  telemetry.emit("author_private_long_lived_count", { longLivedCount });
  for (const [exceeded, reasonCode] of [
    [retainedObjectCount >= objectCountThreshold, "object_count"],
    [retainedBytes >= bytesThreshold, "bytes"],
    [longLivedCount >= longLivedThreshold, "long_lived_count"]
  ]) {
    if (exceeded) {
      telemetry.emit("author_private_retention_alert", { reasonCode, priority: "high" });
    }
  }
}
