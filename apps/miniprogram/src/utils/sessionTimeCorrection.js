import {
  beijingWallTimeToIso,
  formatBeijingDateTime,
  parseBusinessDateTime
} from "@pinche/shared";

function wholeSeconds(value) {
  return Math.floor(value.getTime() / 1000);
}

export function canCorrectHistoricalSession(startAt, now = new Date()) {
  const start = parseBusinessDateTime(startAt);
  const current = parseBusinessDateTime(now);
  return Boolean(start && current && wholeSeconds(start) <= wholeSeconds(current));
}

export function validateHistoricalTimeCorrection(selected, currentStartAt, now = new Date()) {
  const selectedDate = parseBusinessDateTime(selected);
  const current = parseBusinessDateTime(currentStartAt);
  const currentTime = parseBusinessDateTime(now);
  if (!selectedDate || !current || !currentTime) {
    return { valid: false, reason: "invalid", message: "请选择有效的历史时间。" };
  }

  const selectedSeconds = wholeSeconds(selectedDate);
  if (selectedSeconds >= wholeSeconds(currentTime)) {
    return {
      valid: false,
      reason: "not-past",
      message: "历史纠错只能选择已经过去的时间。"
    };
  }
  if (selectedSeconds === wholeSeconds(current)) {
    return {
      valid: false,
      reason: "unchanged",
      message: "新时间与原时间相同，请重新选择。"
    };
  }

  const startAt = beijingWallTimeToIso(selected) || new Date(selectedSeconds * 1000).toISOString();
  return { valid: true, startAt };
}

export function buildHistoricalTimeCorrectionConfirmation({ oldStartAt, newStartAt }) {
  return `原时间：${formatBeijingDateTime(oldStartAt)}\n新时间：${formatBeijingDateTime(newStartAt)}\n\n仅修正历史记录，不会重新发车。`;
}

export function historicalTimeCorrectionErrorRequiresRefresh(error) {
  return error?.code === "SESSION_NOT_HISTORICAL" || [403, 404].includes(error?.statusCode);
}

export function historicalTimeCorrectionErrorText(error) {
  if (error?.code === "SESSION_NOT_HISTORICAL") {
    return "这辆车还没有开始，请使用改期。";
  }
  if (error?.code === "CORRECTION_START_AT_NOT_PAST") {
    return "历史纠错只能选择已经过去的时间。";
  }
  if (error?.code === "UNCHANGED_START_AT") {
    return "新时间与原时间相同，请重新选择。";
  }
  if (error?.statusCode === 401) {
    return "登录已过期，请重新登录后再纠正时间。";
  }
  if (error?.statusCode === 403) {
    return "你已不是本车车头，无法继续纠正时间。";
  }
  if (error?.statusCode === 404) {
    return "车局不存在或已被删除，请返回上一页。";
  }
  return "时间纠错失败，请稍后重试。";
}
