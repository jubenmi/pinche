import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_TIME_AUDIT_QUERY,
  projectSessionTimeAuditRow
} from "../src/modules/core/session-time-audit.js";

test("audit SQL is SELECT-only", () => {
  assert.match(SESSION_TIME_AUDIT_QUERY.trim(), /^SELECT\b/i);
  assert.doesNotMatch(
    SESSION_TIME_AUDIT_QUERY,
    /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|TRUNCATE|CREATE)\b/i
  );
  assert.match(SESSION_TIME_AUDIT_QUERY, /LEFT JOIN session_start_time_corrections correction/i);
  assert.match(SESSION_TIME_AUDIT_QUERY, /SELECT MAX\(candidate\.id\)/i);
  assert.match(SESSION_TIME_AUDIT_QUERY, /candidate\.session_id = session\.id/i);
  assert.match(SESSION_TIME_AUDIT_QUERY, /correction\.old_start_at AS correction_old_start_at/i);
  assert.match(SESSION_TIME_AUDIT_QUERY, /LEFT JOIN user_notifications notification/i);
  assert.match(SESSION_TIME_AUDIT_QUERY, /SELECT MAX\(notification_candidate\.id\)/i);
  assert.match(SESSION_TIME_AUDIT_QUERY, /notification_candidate\.session_id = session\.id/i);
  assert.match(
    SESSION_TIME_AUDIT_QUERY,
    /notification_candidate\.type = 'session_rescheduled'/i
  );
  assert.match(SESSION_TIME_AUDIT_QUERY, /notification\.id AS notification_id/i);
  assert.match(
    SESSION_TIME_AUDIT_QUERY,
    /notification\.payload_json AS notification_payload_json/i
  );
  assert.match(
    SESSION_TIME_AUDIT_QUERY,
    /notification\.created_at AS notification_created_at/i
  );
});

test("an exact latest correction reports cross-Beijing-day evidence", () => {
  const correctionCreatedAt = new Date("2026-07-28T16:31:00.000Z");
  const report = projectSessionTimeAuditRow({
    id: 42,
    start_at: new Date("2026-07-28T16:30:00.000Z"),
    correction_old_start_at: new Date("2026-07-28T15:30:00.000Z"),
    corrected_start_at: new Date("2026-07-28T16:30:00.000Z"),
    correction_id: 9,
    correction_created_at: correctionCreatedAt,
    created_at: new Date("2026-07-20T01:00:00.000Z"),
    updated_at: new Date("2026-07-28T01:00:00.000Z")
  });
  assert.equal(report.classification, "evidence_correct");
  assert.equal(report.current_utc, "2026-07-28T16:30:00.000Z");
  assert.equal(report.current_beijing, "2026-07-29 00:30");
  assert.equal(report.correction_id, 9);
  assert.equal(report.correction_created_at, correctionCreatedAt);
  assert.deepEqual(report.correction_evidence, {
    id: 9,
    old_utc: "2026-07-28T15:30:00.000Z",
    new_utc: "2026-07-28T16:30:00.000Z",
    created_at: correctionCreatedAt,
    matches_current: true,
    crosses_beijing_day: true
  });
  assert.deepEqual(report.cross_day_impact, {
    correction: true,
    notification: null
  });
});

test("latest notification object or JSON evidence can prove the current value", () => {
  const payload = {
    old_start_at: "2026-07-28T15:30:00.000Z",
    new_start_at: "2026-07-28T16:30:00.000Z"
  };
  const notificationCreatedAt = new Date("2026-07-28T16:32:00.000Z");

  for (const notificationPayload of [payload, JSON.stringify(payload)]) {
    const report = projectSessionTimeAuditRow({
      id: 43,
      start_at: new Date("2026-07-28T16:30:00.000Z"),
      correction_id: null,
      notification_id: 12,
      notification_payload_json: notificationPayload,
      notification_created_at: notificationCreatedAt
    });

    assert.equal(report.classification, "evidence_correct");
    assert.deepEqual(report.notification_evidence, {
      id: 12,
      old_utc: "2026-07-28T15:30:00.000Z",
      new_utc: "2026-07-28T16:30:00.000Z",
      created_at: notificationCreatedAt,
      matches_current: true,
      crosses_beijing_day: true
    });
    assert.deepEqual(report.cross_day_impact, {
      correction: null,
      notification: true
    });
  }
});

test("a newer correction mismatch overrides matching notification evidence", () => {
  const report = projectSessionTimeAuditRow({
    id: 44,
    start_at: new Date("2026-07-28T15:30:00.000Z"),
    correction_id: 20,
    correction_old_start_at: new Date("2026-07-28T15:30:00.000Z"),
    corrected_start_at: new Date("2026-07-28T16:30:00.000Z"),
    notification_id: 19,
    notification_payload_json: {
      old_start_at: "2026-07-28T14:30:00.000Z",
      new_start_at: "2026-07-28T15:30:00.000Z"
    }
  });

  assert.equal(report.classification, "indeterminate");
  assert.equal(report.correction_evidence.matches_current, false);
  assert.equal(report.notification_evidence.matches_current, true);
  assert.deepEqual(report.cross_day_impact, {
    correction: true,
    notification: false
  });
});

test("a malformed correction record blocks matching notification classification", () => {
  const report = projectSessionTimeAuditRow({
    id: 45,
    start_at: new Date("2026-07-28T15:30:00.000Z"),
    correction_id: 21,
    correction_old_start_at: "malformed",
    corrected_start_at: new Date("2026-07-28T16:30:00.000Z"),
    notification_id: 19,
    notification_payload_json: JSON.stringify({
      old_start_at: "2026-07-28T14:30:00.000Z",
      new_start_at: "2026-07-28T15:30:00.000Z"
    })
  });

  assert.equal(report.classification, "indeterminate");
  assert.equal(report.correction_id, 21);
  assert.equal(report.correction_evidence, null);
  assert.equal(report.notification_evidence.matches_current, true);
  assert.deepEqual(report.cross_day_impact, {
    correction: null,
    notification: false
  });
});

test("malformed or mismatched evidence remains indeterminate", () => {
  const malformed = projectSessionTimeAuditRow({
    id: 46,
    start_at: new Date("2026-07-28T16:30:00.000Z"),
    correction_id: null,
    notification_id: 13,
    notification_payload_json: "{malformed"
  });
  assert.equal(malformed.classification, "indeterminate");
  assert.equal(malformed.notification_evidence, null);
  assert.equal(malformed.cross_day_impact.notification, null);
  assert.equal(Object.hasOwn(malformed, "suggested_update"), false);

  const incompleteCorrection = projectSessionTimeAuditRow({
    id: 47,
    start_at: new Date("2026-07-28T17:30:00.000Z"),
    correction_id: 14,
    correction_old_start_at: new Date("2026-07-28T15:30:00.000Z"),
    corrected_start_at: "invalid"
  });
  assert.equal(incompleteCorrection.classification, "indeterminate");
  assert.equal(incompleteCorrection.correction_evidence, null);
  assert.equal(incompleteCorrection.cross_day_impact.correction, null);
  assert.equal(Object.hasOwn(incompleteCorrection, "suggested_update"), false);

  const mismatched = projectSessionTimeAuditRow({
    id: 48,
    start_at: new Date("2026-07-28T17:30:00.000Z"),
    correction_id: 15,
    correction_old_start_at: new Date("2026-07-28T15:30:00.000Z"),
    corrected_start_at: new Date("2026-07-28T16:30:00.000Z")
  });
  assert.equal(mismatched.classification, "indeterminate");
  assert.equal(mismatched.correction_evidence.matches_current, false);
  assert.equal(mismatched.cross_day_impact.correction, true);
  assert.equal(Object.hasOwn(mismatched, "suggested_update"), false);
});

test("rows without provenance remain indeterminate", () => {
  const report = projectSessionTimeAuditRow({
    id: 49,
    start_at: new Date("2026-07-28T15:00:00.000Z"),
    correction_id: null,
    corrected_start_at: null
  });
  assert.equal(report.classification, "indeterminate");
  assert.equal(report.correction_evidence, null);
  assert.equal(report.notification_evidence, null);
  assert.deepEqual(report.cross_day_impact, {
    correction: null,
    notification: null
  });
  assert.equal(Object.hasOwn(report, "suggested_update"), false);
});
