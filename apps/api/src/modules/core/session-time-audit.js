import { formatBeijingDateTime, parseBusinessDateTime } from "@pinche/shared";

export const SESSION_TIME_AUDIT_QUERY = `
  SELECT session.id, session.start_at, session.created_at, session.updated_at,
         correction.id AS correction_id,
         correction.new_start_at AS corrected_start_at,
         correction.created_at AS correction_created_at
  FROM sessions session
  LEFT JOIN session_start_time_corrections correction
    ON correction.id = (
      SELECT MAX(candidate.id)
      FROM session_start_time_corrections candidate
      WHERE candidate.session_id = session.id
    )
  ORDER BY session.id DESC
  LIMIT ?
`;

export function projectSessionTimeAuditRow(row) {
  const current = parseBusinessDateTime(row.start_at);
  const corrected = parseBusinessDateTime(row.corrected_start_at);
  const correctionMatches = Boolean(
    row.correction_id && current && corrected && current.getTime() === corrected.getTime()
  );
  return {
    session_id: Number(row.id),
    current_utc: current?.toISOString() || null,
    current_beijing: formatBeijingDateTime(row.start_at, "时间无效"),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    correction_id: row.correction_id ? Number(row.correction_id) : null,
    correction_created_at: row.correction_created_at || null,
    classification: correctionMatches ? "evidence_correct" : "indeterminate"
  };
}
