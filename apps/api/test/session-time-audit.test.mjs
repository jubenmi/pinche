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
});

test("an exact latest correction is evidence of a correct current value", () => {
  const report = projectSessionTimeAuditRow({
    id: 42,
    start_at: new Date("2026-07-28T07:00:00.000Z"),
    corrected_start_at: new Date("2026-07-28T07:00:00.000Z"),
    correction_id: 9,
    created_at: new Date("2026-07-20T01:00:00.000Z"),
    updated_at: new Date("2026-07-28T01:00:00.000Z")
  });
  assert.equal(report.classification, "evidence_correct");
  assert.equal(report.current_beijing, "2026-07-28 15:00");
});

test("rows without provenance remain indeterminate", () => {
  const report = projectSessionTimeAuditRow({
    id: 43,
    start_at: new Date("2026-07-28T15:00:00.000Z"),
    correction_id: null,
    corrected_start_at: null
  });
  assert.equal(report.classification, "indeterminate");
  assert.equal(report.suggested_update, undefined);
});
