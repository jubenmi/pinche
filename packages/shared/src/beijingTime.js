export const BEIJING_TIME_ZONE = "Asia/Shanghai";

const WALL_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;
const EXPLICIT_TIME_ZONE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})$/i;

const beijingFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: BEIJING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

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
  const values = Object.fromEntries(
    beijingFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  return {
    year,
    month,
    day,
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay()
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
