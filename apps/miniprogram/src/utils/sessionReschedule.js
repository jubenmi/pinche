const SHANGHAI_OFFSET = "+08:00";
const DATABASE_DATE_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

function wholeSeconds(value) {
  return Math.floor(value.getTime() / 1000);
}

export function parseSessionStartAt(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const text = value.trim();
  const databaseMatch = text.match(DATABASE_DATE_TIME);
  const normalized = databaseMatch
    ? `${databaseMatch[1]}T${databaseMatch[2]}:${databaseMatch[3] || "00"}${
        databaseMatch[4] ? `.${databaseMatch[4].padEnd(3, "0")}` : ""
      }${SHANGHAI_OFFSET}`
    : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatSessionStartAt(value) {
  const date = parseSessionStartAt(value);
  if (!date) {
    return "时间待定";
  }
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

export function canRescheduleSession(startAt, now = new Date()) {
  const start = parseSessionStartAt(startAt);
  const current = parseSessionStartAt(now);
  return Boolean(start && current && wholeSeconds(start) > wholeSeconds(current));
}

export function validateRescheduleSelection(selectedStartAt, currentStartAt, now = new Date()) {
  const selected = parseSessionStartAt(selectedStartAt);
  const current = parseSessionStartAt(currentStartAt);
  const currentTime = parseSessionStartAt(now);
  if (!selected || !current || !currentTime) {
    return { valid: false, reason: "invalid", message: "请选择有效的新时间。" };
  }
  const selectedSeconds = wholeSeconds(selected);
  if (selectedSeconds <= wholeSeconds(currentTime)) {
    return { valid: false, reason: "past", message: "新时间必须晚于当前时间。" };
  }
  if (selectedSeconds === wholeSeconds(current)) {
    return { valid: false, reason: "unchanged", message: "新时间与当前时间相同，请重新选择。" };
  }
  return {
    valid: true,
    startAt: new Date(selectedSeconds * 1000).toISOString()
  };
}

export function buildRescheduleConfirmation({ memberCount = 0, oldStartAt, newStartAt }) {
  const oldTime = formatSessionStartAt(oldStartAt);
  const newTime = formatSessionStartAt(newStartAt);
  const count = Math.max(0, Number(memberCount) || 0);
  if (count > 0) {
    return `确认将车局时间从 ${oldTime} 改为 ${newTime} 吗？共有 ${count} 位其他已上车成员，确认后通知将发送给他们。`;
  }
  return `确认将车局时间从 ${oldTime} 改为 ${newTime} 吗？`;
}

export function rescheduleErrorRequiresRefresh(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.statusCode === 409 && /past|started/.test(message);
}

export function rescheduleErrorText(error) {
  const message = String(error?.message || "").toLowerCase();
  if (error?.statusCode === 409 && /confirmation/.test(message)) {
    return "已上车成员发生变化，请重新确认改期和通知人数。";
  }
  if (error?.statusCode === 409 && /past|started/.test(message)) {
    return "车局已经开始，不能再改期；页面已刷新。";
  }
  if (/future|past/.test(message)) {
    return "新时间必须晚于当前时间，请重新选择。";
  }
  if (/change|unchanged/.test(message)) {
    return "新时间与当前时间相同，请重新选择。";
  }
  if (/startat|timezone|timestamp|valid/.test(message)) {
    return "所选时间无效，请重新选择。";
  }
  return "改期失败，请保留当前选择后重试。";
}
