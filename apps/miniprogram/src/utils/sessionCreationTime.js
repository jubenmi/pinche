import {
  beijingDateKey,
  beijingWallTimeToIso,
  businessDateTimeToPickerValue
} from "@pinche/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

export function sessionCreationWallTime(date, time) {
  return `${String(date || "")} ${String(time || "")}:00`;
}

export function sessionCreationTransportStartAt(date, time) {
  return beijingWallTimeToIso(sessionCreationWallTime(date, time));
}

export function sessionCreationPickerValue(value) {
  return businessDateTimeToPickerValue(value);
}

export function sessionCreationDefaults(now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  return {
    today: beijingDateKey(new Date(nowMs)),
    date: beijingDateKey(new Date(nowMs + DAY_MS)),
    time: "14:00"
  };
}
