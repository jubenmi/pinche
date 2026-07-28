export const BEIJING_TIME_ZONE = "Asia/Shanghai";

const BEIJING_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000;
const BEIJING_DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const WALL_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;
const EXPLICIT_TIME_ZONE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})$/i;

function calendarParts(match) {
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] || 0),
    minute: Number(match[5] || 0),
    second: Number(match[6] || 0),
    millisecond: Number(String(match[7] || "0").padEnd(3, "0"))
  };
}

function validCalendarParts(parts) {
  const calendar = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond
    )
  );
  return (
    calendar.getUTCFullYear() === parts.year &&
    calendar.getUTCMonth() === parts.month - 1 &&
    calendar.getUTCDate() === parts.day &&
    calendar.getUTCHours() === parts.hour &&
    calendar.getUTCMinutes() === parts.minute &&
    calendar.getUTCSeconds() === parts.second &&
    calendar.getUTCMilliseconds() === parts.millisecond
  );
}

function pad(value, size = 2) {
  return String(value).padStart(size, "0");
}

function beijingWallTimeIso(parts) {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(
    parts.minute
  )}:${pad(parts.second)}.${pad(parts.millisecond, 3)}+08:00`;
}

export function parseBusinessDateTime(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const text = value.trim();
  const explicitMatch = text.match(EXPLICIT_TIME_ZONE_PATTERN);
  if (explicitMatch) {
    const parts = calendarParts(explicitMatch);
    if (!validCalendarParts(parts)) {
      return null;
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const wallMatch = text.match(WALL_TIME_PATTERN);
  if (!wallMatch) {
    return null;
  }
  const parts = calendarParts(wallMatch);
  if (!validCalendarParts(parts)) {
    return null;
  }
  return new Date(beijingWallTimeIso(parts));
}

export function beijingDateParts(value) {
  const date = parseBusinessDateTime(value);
  if (!date) {
    return null;
  }
  const beijingDate = new Date(date.getTime() + BEIJING_OFFSET_MILLISECONDS);
  return {
    year: beijingDate.getUTCFullYear(),
    month: beijingDate.getUTCMonth() + 1,
    day: beijingDate.getUTCDate(),
    hour: beijingDate.getUTCHours(),
    minute: beijingDate.getUTCMinutes(),
    second: beijingDate.getUTCSeconds(),
    weekday: beijingDate.getUTCDay()
  };
}

export function formatBeijingDateTime(value, fallback = "时间待定") {
  const parts = beijingDateParts(value);
  if (!parts) {
    return fallback;
  }
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(
    parts.minute
  )}`;
}

export function beijingDateKey(value) {
  const parts = beijingDateParts(value);
  if (!parts) {
    return "";
  }
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function beijingTimeText(value, fallback = "时间待定") {
  const parts = beijingDateParts(value);
  return parts ? `${pad(parts.hour)}:${pad(parts.minute)}` : fallback;
}

export function beijingWallTimeToIso(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match = value.trim().match(WALL_TIME_PATTERN);
  if (!match) {
    return null;
  }
  const parts = calendarParts(match);
  if (!validCalendarParts(parts)) {
    return null;
  }
  return new Date(beijingWallTimeIso(parts)).toISOString();
}

export function businessDateTimeToPickerValue(value) {
  const date = parseBusinessDateTime(value);
  if (!date) return null;
  return {
    date: beijingDateKey(date),
    time: beijingTimeText(date, "")
  };
}

export function formatBeijingShortDateTime(value, fallback = "时间待定") {
  const parts = beijingDateParts(value);
  return parts
    ? `${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`
    : fallback;
}

export function isBusinessDateTimeReached(value, now = Date.now()) {
  const date = parseBusinessDateTime(value);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  return Boolean(date && Number.isFinite(nowMs) && date.getTime() <= nowMs);
}

export function beijingDayUtcRange(value) {
  if (typeof value !== "string") return null;
  const key = value.trim();
  const start = parseBusinessDateTime(`${key} 00:00:00`);
  if (!start || beijingDateKey(start) !== key) return null;
  return {
    start,
    end: new Date(start.getTime() + BEIJING_DAY_MILLISECONDS)
  };
}
