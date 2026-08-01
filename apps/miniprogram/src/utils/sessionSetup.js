import {
  HISTORICAL_RECORD,
  createSingleFlight,
  sessionPurposeForStartAt
} from "@pinche/shared";

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

function isNumericId(value) {
  return /^\d+$/.test(String(value || "")) && Number(value) > 0;
}

function setupRoleInitialization(snapshot = {}) {
  const roles = Array.isArray(snapshot.roleOptions) && snapshot.roleOptions.length > 0
    ? snapshot.roleOptions
    : Array.isArray(snapshot.selectedRoles)
      ? snapshot.selectedRoles
      : [];
  const price = Number(snapshot.script?.price_per_player || snapshot.script?.pricePerPlayer || 0);
  const seatPayload = (role) => {
    const source = role && typeof role === "object" ? role : {};
    return {
      name: source.name,
      seatType: source.seatType || "normal",
      roleName: source.note || source.name,
      roleGender: source.roleGender || "unlimited",
      basePrice: Number.isFinite(price) ? price : 0,
      adjustment: 0
    };
  };
  const seatPayloads = roles.map(seatPayload);
  const selectedRole = snapshot.role || snapshot.selectedRoles?.[0] || null;
  const selectedRoleId = String(selectedRole?.id || "");
  let selectedRoleIndex = selectedRoleId
    ? roles.findIndex((role) => String(role?.id || "") === selectedRoleId)
    : -1;
  if (selectedRoleIndex < 0) {
    selectedRoleIndex = roles.findIndex((role) => role === selectedRole);
  }
  const selectedSeatKey = selectedRole
    ? seatInitializationKey(seatPayload(selectedRole))
    : "";
  if (selectedRoleIndex < 0 && selectedSeatKey) {
    selectedRoleIndex = seatPayloads.findIndex(
      (payload) => seatInitializationKey(payload) === selectedSeatKey
    );
  }
  const selectedSeatOccurrence = selectedRoleIndex < 0
    ? -1
    : seatPayloads
        .slice(0, selectedRoleIndex)
        .filter((payload) => seatInitializationKey(payload) === selectedSeatKey).length;
  return {
    roles,
    seatPayloads,
    selectedSeatKey,
    selectedSeatOccurrence
  };
}

export function historicalSetupDescriptor(snapshot = {}, now = new Date()) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const dateValue = String(snapshot.dateValue || "").trim();
  const timeValue = String(snapshot.timeValue || "").trim();
  const startAt = `${dateValue} ${timeValue}:00`;
  if (
    !isNumericId(snapshot.store?.id) ||
    !isNumericId(snapshot.script?.id) ||
    snapshot.sessionPurpose !== HISTORICAL_RECORD ||
    String(snapshot.startAt || "") !== startAt ||
    selectedSessionPurpose(dateValue, timeValue, now) !== HISTORICAL_RECORD
  ) {
    return null;
  }
  const initialization = setupRoleInitialization(snapshot);
  const descriptor = {
    ...initialization,
    snapshot,
    fingerprint: historicalDraftFingerprint({
      storeId: snapshot.store.id,
      scriptId: snapshot.script.id,
      startAt,
      sessionPurpose: snapshot.sessionPurpose,
      pinnedMessageText: historicalPinnedMessage(snapshot.pinnedMessageText),
      seatPayloads: initialization.seatPayloads,
      selectedSeatKey: initialization.selectedSeatKey,
      selectedSeatOccurrence: initialization.selectedSeatOccurrence
    })
  };
  return descriptor;
}

function defaultRandomBytes(length) {
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

export function createHistoricalCreationKey({
  now = () => Date.now(),
  randomBytes = defaultRandomBytes
} = {}) {
  const bytes = randomBytes(24);
  if (!(bytes instanceof Uint8Array) || bytes.length < 24) {
    throw new TypeError("historical creation randomBytes must return at least 24 bytes");
  }
  const randomHex = Array.from(bytes.slice(0, 24), (value) =>
    Number(value).toString(16).padStart(2, "0")
  ).join("");
  return `hs_${Number(now()).toString(36)}_${randomHex}`;
}

export function isHistoricalCreationKey(value) {
  return /^[A-Za-z0-9_-]{32,128}$/.test(String(value || ""));
}

export function historicalPendingMatchesDescriptor(pendingHistoricalDraft, descriptor = null) {
  if (!pendingHistoricalDraft || typeof pendingHistoricalDraft !== "object") return false;
  if (!isHistoricalCreationKey(pendingHistoricalDraft.historicalCreationKey)) return false;
  const sessionId = pendingHistoricalDraft.sessionId;
  if (sessionId !== null && (!Number.isSafeInteger(Number(sessionId)) || Number(sessionId) <= 0)) {
    return false;
  }
  const savedDescriptor = historicalSetupDescriptor(pendingHistoricalDraft.snapshot);
  if (!savedDescriptor || !savedDescriptor.selectedSeatKey || savedDescriptor.selectedSeatOccurrence < 0) {
    return false;
  }
  const markerMatchesSnapshot =
    pendingHistoricalDraft.fingerprint === savedDescriptor.fingerprint &&
    pendingHistoricalDraft.selectedSeatKey === savedDescriptor.selectedSeatKey &&
    Number(pendingHistoricalDraft.selectedSeatOccurrence) ===
      savedDescriptor.selectedSeatOccurrence;
  if (!markerMatchesSnapshot) return false;
  if (!descriptor) return true;
  return (
    descriptor.fingerprint === savedDescriptor.fingerprint &&
    descriptor.selectedSeatKey === savedDescriptor.selectedSeatKey &&
    Number(descriptor.selectedSeatOccurrence) === savedDescriptor.selectedSeatOccurrence
  );
}

export function historicalPrimaryActionEnabled({
  canSubmitCurrent,
  hasPendingMismatch,
  pendingHistoricalDraft
} = {}) {
  return Boolean(
    canSubmitCurrent ||
      (hasPendingMismatch && historicalPendingMatchesDescriptor(pendingHistoricalDraft))
  );
}

export function shouldClearPendingHistoricalDraftForAuthorPrivate(session = {}) {
  return Boolean(
    session &&
      typeof session === "object" &&
      session.moderation_status === "rejected" &&
      session.can_resubmit === true
  );
}

export function historicalAuthorPrivatePendingDisposition(session = {}) {
  const clearPending = shouldClearPendingHistoricalDraftForAuthorPrivate(session);
  return {
    clearPending,
    statusText: clearPending
      ? "补录内容未通过审核，请修改后重新创建。"
      : String(session?.moderation_message || "")
  };
}

export function historicalCreationOperationErrorDisposition(error = {}) {
  if (error?.code !== "HISTORICAL_SESSION_CREATION_OPERATION_INVALID") {
    return null;
  }
  return {
    clearPending: true,
    statusText: "之前的历史补录已不存在，请再次点击重新创建。"
  };
}

export function sessionSetupSubmissionMatches({
  preparedPurpose,
  currentPurpose,
  preparedDescriptor,
  currentDescriptor,
  preparedCreationData,
  currentCreationData
} = {}) {
  const creationDataMatches =
    (preparedCreationData === undefined && currentCreationData === undefined) ||
    stableSetupJson(preparedCreationData) === stableSetupJson(currentCreationData);
  return Boolean(
    preparedPurpose &&
      preparedPurpose === currentPurpose &&
      preparedDescriptor?.fingerprint &&
      preparedDescriptor.fingerprint === currentDescriptor?.fingerprint &&
      creationDataMatches
  );
}

function stableSetupJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableSetupJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableSetupJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function persistPendingHistoricalDraftState(state, pendingHistoricalDraft, persist) {
  state.pendingHistoricalDraft = pendingHistoricalDraft;
  persist(pendingHistoricalDraft);
  return pendingHistoricalDraft;
}

export function clearPendingHistoricalDraftState(state, persist, continueAfterClear) {
  state.pendingHistoricalDraft = null;
  try {
    persist(null);
  } catch {
    // Server state is authoritative after publish; stale storage converges on the next load.
  }
  return typeof continueAfterClear === "function" ? continueAfterClear() : undefined;
}

export async function createOrRecoverHistoricalDraft({
  pendingHistoricalDraft,
  descriptor,
  createKey = createHistoricalCreationKey,
  persistPending,
  createSession,
  recoverSession
}) {
  if (!descriptor || typeof descriptor !== "object") {
    throw new TypeError("historical descriptor is required");
  }
  let pending = pendingHistoricalDraft;
  if (pending) {
    if (!historicalPendingMatchesDescriptor(pending, descriptor)) {
      throw new Error("Historical pending marker does not match the setup descriptor");
    }
  } else {
    pending = {
      historicalCreationKey: createKey(),
      sessionId: null,
      fingerprint: descriptor.fingerprint,
      snapshot: descriptor.snapshot,
      selectedSeatKey: descriptor.selectedSeatKey,
      selectedSeatOccurrence: descriptor.selectedSeatOccurrence
    };
    if (!isHistoricalCreationKey(pending.historicalCreationKey)) {
      throw new TypeError("historical creation key is invalid");
    }
  }

  if (pending.sessionId !== null) {
    return {
      session: await recoverSession(pending),
      pendingHistoricalDraft: pending
    };
  }

  await persistPending(pending);
  const session = await createSession({
    historicalCreationKey: pending.historicalCreationKey,
    idempotencyKey: pending.historicalCreationKey
  });
  const sessionId = Number(session?.id);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    return { session, pendingHistoricalDraft: pending };
  }
  pending = { ...pending, sessionId };
  await persistPending(pending);
  return { session, pendingHistoricalDraft: pending };
}

export function createSessionSetupSubmissionController({ flight = createSingleFlight() } = {}) {
  return {
    get active() {
      return flight.active;
    },
    submit({ prepare, ensureAuthenticated, createSession, initializeSession }) {
      return flight.run(async () => {
        const prepared = prepare();
        if (!prepared) return null;
        const auth = await ensureAuthenticated(prepared);
        if (!auth) return null;
        const session = await createSession(prepared, auth);
        if (session === null || session === undefined) return session;
        return initializeSession(session, prepared, auth);
      });
    }
  };
}
