import { randomUUID } from "node:crypto";

const EXPLICIT_ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/i;

function rescheduleError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseExplicitIsoTimestamp(value) {
  if (typeof value !== "string") {
    throw rescheduleError("INVALID_START_AT", "startAt must include an explicit timezone");
  }
  const match = EXPLICIT_ISO_TIMESTAMP.exec(value);
  if (!match) {
    throw rescheduleError("INVALID_START_AT", "startAt must include an explicit timezone");
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ""] =
    match;
  const parts = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const [year, month, day, hour, minute, second] = parts;
  const calendarDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day ||
    calendarDate.getUTCHours() !== hour ||
    calendarDate.getUTCMinutes() !== minute ||
    calendarDate.getUTCSeconds() !== second
  ) {
    throw rescheduleError("INVALID_START_AT", "startAt must be a valid ISO-8601 timestamp");
  }

  const offsetHour = Number(match[10] || 0);
  const offsetMinute = Number(match[11] || 0);
  if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
    throw rescheduleError("INVALID_START_AT", "startAt has an invalid timezone offset");
  }
  const offsetSign = match[9] === "-" ? -1 : 1;
  const milliseconds = Number((fraction + "000").slice(0, 3));
  const timestamp =
    Date.UTC(year, month - 1, day, hour, minute, second, milliseconds) -
    offsetSign * (offsetHour * 60 + offsetMinute) * 60_000;
  if (!Number.isFinite(timestamp)) {
    throw rescheduleError("INVALID_START_AT", "startAt must be a valid ISO-8601 timestamp");
  }
  return timestamp;
}

export function normalizeSessionRescheduleStartAt(value, currentStartAt, now = Date.now()) {
  const inputTimestamp = parseExplicitIsoTimestamp(value);
  const normalizedTimestamp = Math.floor(inputTimestamp / 1000) * 1000;
  const currentTimestamp = Math.floor(new Date(currentStartAt).getTime() / 1000) * 1000;
  if (!Number.isFinite(currentTimestamp)) {
    throw rescheduleError("INVALID_CURRENT_START_AT", "Current session start time is invalid");
  }
  if (normalizedTimestamp <= now) {
    throw rescheduleError("PAST_START_AT", "startAt must be in the future");
  }
  if (normalizedTimestamp === currentTimestamp) {
    throw rescheduleError("UNCHANGED_START_AT", "startAt must change by at least one second");
  }

  const date = new Date(normalizedTimestamp);
  return { date, canonical: date.toISOString() };
}

export function createSessionRescheduleDedupeKey(sessionId) {
  return `session-rescheduled:${sessionId}:${randomUUID()}`;
}
