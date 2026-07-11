function positiveMediaCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export function sessionCalendarStripeTone({
  failed = false,
  postStart = false,
  albumMediaCount = 0
} = {}) {
  if (failed) {
    return "red";
  }
  if (!postStart) {
    return "amber";
  }
  return positiveMediaCount(albumMediaCount) > 0 ? "green" : "red";
}
