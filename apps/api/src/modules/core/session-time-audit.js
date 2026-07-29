import {
  beijingDateKey,
  formatBeijingDateTime,
  parseBusinessDateTime
} from "@pinche/shared";

export const SESSION_TIME_AUDIT_QUERY = `
  SELECT session.id, session.start_at, session.created_at, session.updated_at,
         correction.id AS correction_id,
         correction.old_start_at AS correction_old_start_at,
         correction.new_start_at AS corrected_start_at,
         correction.created_at AS correction_created_at,
         notification.id AS notification_id,
         notification.payload_json AS notification_payload_json,
         notification.created_at AS notification_created_at
  FROM sessions session
  LEFT JOIN session_start_time_corrections correction
    ON correction.id = (
      SELECT MAX(candidate.id)
      FROM session_start_time_corrections candidate
      WHERE candidate.session_id = session.id
    )
  LEFT JOIN user_notifications notification
    ON notification.id = (
      SELECT MAX(notification_candidate.id)
      FROM user_notifications notification_candidate
      WHERE notification_candidate.session_id = session.id
        AND notification_candidate.type = 'session_rescheduled'
    )
  ORDER BY session.id DESC
  LIMIT ?
`;

function notificationPayload(value) {
  let payload = value;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : null;
}

function projectEvidence({ id, oldValue, newValue, createdAt, current }) {
  if (!id) return null;
  const oldTime = parseBusinessDateTime(oldValue);
  const newTime = parseBusinessDateTime(newValue);
  if (!oldTime || !newTime) return null;
  const matchesCurrent = Boolean(current && current.getTime() === newTime.getTime());
  const crossesBeijingDay = beijingDateKey(oldTime) !== beijingDateKey(newTime);
  return {
    id: Number(id),
    old_utc: oldTime?.toISOString() || null,
    new_utc: newTime?.toISOString() || null,
    created_at: createdAt || null,
    matches_current: matchesCurrent,
    crosses_beijing_day: crossesBeijingDay
  };
}

export function projectSessionTimeAuditRow(row) {
  const current = parseBusinessDateTime(row.start_at);
  const correctionEvidence = projectEvidence({
    id: row.correction_id,
    oldValue: row.correction_old_start_at,
    newValue: row.corrected_start_at,
    createdAt: row.correction_created_at,
    current
  });
  const payload = notificationPayload(row.notification_payload_json);
  const notificationEvidence = projectEvidence({
    id: row.notification_id,
    oldValue: payload?.old_start_at,
    newValue: payload?.new_start_at,
    createdAt: row.notification_created_at,
    current
  });
  const matchesAuthoritativeEvidence = row.correction_id
    ? correctionEvidence?.matches_current
    : notificationEvidence?.matches_current;
  return {
    session_id: Number(row.id),
    current_utc: current?.toISOString() || null,
    current_beijing: formatBeijingDateTime(row.start_at, "时间无效"),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    correction_id: row.correction_id ? Number(row.correction_id) : null,
    correction_created_at: row.correction_created_at || null,
    correction_evidence: correctionEvidence,
    notification_evidence: notificationEvidence,
    cross_day_impact: {
      correction: correctionEvidence?.crosses_beijing_day ?? null,
      notification: notificationEvidence?.crosses_beijing_day ?? null
    },
    classification: matchesAuthoritativeEvidence
      ? "evidence_correct"
      : "indeterminate"
  };
}
