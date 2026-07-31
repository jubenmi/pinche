import { parseBusinessDateTime } from "./beijingTime.js";

export const FUTURE_CARPOOL = "future_carpool";
export const HISTORICAL_RECORD = "historical_record";
export const SESSION_PURPOSES = Object.freeze([FUTURE_CARPOOL, HISTORICAL_RECORD]);

export function normalizeSessionPurpose(value = FUTURE_CARPOOL) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return SESSION_PURPOSES.includes(normalized) ? normalized : null;
}

export function sessionPurposeForStartAt(startAt, now = new Date()) {
  const start = parseBusinessDateTime(startAt);
  const current = parseBusinessDateTime(now);
  if (!start || !current) return null;
  return start.getTime() > current.getTime() ? FUTURE_CARPOOL : HISTORICAL_RECORD;
}

export function sessionPurposeOf(session = {}) {
  if (!session || typeof session !== "object") return null;
  const value =
    session.session_purpose !== undefined ? session.session_purpose : session.sessionPurpose;
  return normalizeSessionPurpose(value);
}

export function isHistoricalSession(session = {}) {
  return sessionPurposeOf(session) === HISTORICAL_RECORD;
}
