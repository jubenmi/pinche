import { sessionPurposeForStartAt } from "@pinche/shared";

export const TIME_PICKER_START = "2000-01-01 00:00:00";
export const TIME_PICKER_END = "2000-01-01 23:59:59";
export const HISTORICAL_PINNED_PLACEHOLDER = "可选：补录当时的角色分配或其他说明";

export function selectedSessionPurpose(dateValue, timeValue, now = new Date()) {
  const date = String(dateValue || "").trim();
  const time = String(timeValue || "").trim();
  if (!date || !time) return null;
  return sessionPurposeForStartAt(`${date} ${time}:00`, now);
}

export function submitPurposeChanged(previousPurpose, startAt, now = new Date()) {
  const currentPurpose = sessionPurposeForStartAt(startAt, now);
  return currentPurpose !== null && currentPurpose !== previousPurpose;
}

export function historicalCreateSettings() {
  return {
    visibility: "share_only",
    joinPolicy: "review_required",
    joinPhoneRequired: false,
    npcJoinEnabled: false
  };
}

export function historicalPinnedMessage(value) {
  return String(value || "").trim();
}

function textDimension(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function numericDimension(value, fallback = 0) {
  const normalized = value === undefined || value === null || value === "" ? fallback : Number(value);
  return Number.isFinite(normalized) ? normalized : textDimension(value);
}

export function seatInitializationKey(payload = {}) {
  return JSON.stringify([
    textDimension(payload.name),
    textDimension(payload.seatType ?? payload.seat_type, "normal"),
    textDimension(payload.roleName ?? payload.role_name),
    textDimension(payload.roleGender ?? payload.role_gender, "unlimited"),
    numericDimension(payload.basePrice ?? payload.base_price),
    numericDimension(payload.adjustment)
  ]);
}

export function missingSeatPayloads(desiredPayloads = [], existingSeats = []) {
  const existingCounts = new Map();
  for (const seat of Array.isArray(existingSeats) ? existingSeats : []) {
    const key = seatInitializationKey(seat);
    existingCounts.set(key, (existingCounts.get(key) || 0) + 1);
  }

  const missing = [];
  for (const payload of Array.isArray(desiredPayloads) ? desiredPayloads : []) {
    const key = seatInitializationKey(payload);
    const available = existingCounts.get(key) || 0;
    if (available > 0) {
      existingCounts.set(key, available - 1);
    } else {
      missing.push(payload);
    }
  }
  return missing;
}

export function historicalDraftFingerprint(value = {}) {
  const selectedSeatOccurrence = Number(value.selectedSeatOccurrence);
  return JSON.stringify({
    storeId: textDimension(value.storeId),
    scriptId: textDimension(value.scriptId),
    startAt: textDimension(value.startAt),
    sessionPurpose: textDimension(value.sessionPurpose),
    pinnedMessageText: textDimension(value.pinnedMessageText),
    seatKeys: (Array.isArray(value.seatPayloads) ? value.seatPayloads : []).map(
      seatInitializationKey
    ),
    selectedSeatKey: textDimension(value.selectedSeatKey),
    selectedSeatOccurrence:
      Number.isSafeInteger(selectedSeatOccurrence) && selectedSeatOccurrence >= 0
        ? selectedSeatOccurrence
        : -1
  });
}
