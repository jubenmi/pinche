import { parseBusinessDateTime } from "./beijingTime.js";

export const FUTURE_CARPOOL = "future_carpool";
export const HISTORICAL_RECORD = "historical_record";
export const SESSION_PURPOSES = Object.freeze([FUTURE_CARPOOL, HISTORICAL_RECORD]);

export function normalizeSessionPurpose(value = FUTURE_CARPOOL) {
  const normalized = String(value ?? "").trim();
  return SESSION_PURPOSES.includes(normalized) ? normalized : null;
}

export function sessionPurposeForStartAt(startAt, now = new Date()) {
  const start = parseBusinessDateTime(startAt);
  const current = parseBusinessDateTime(now);
  if (!start || !current) return null;
  return start.getTime() > current.getTime() ? FUTURE_CARPOOL : HISTORICAL_RECORD;
}

export function sessionPurposeOf(session = {}) {
  return normalizeSessionPurpose(session.session_purpose ?? session.sessionPurpose);
}

export function isHistoricalSession(session = {}) {
  return sessionPurposeOf(session) === HISTORICAL_RECORD;
}
