import assert from "node:assert/strict";
import test from "node:test";

import {
  flowToQuery,
  queryToFlow,
  readCreateFlow,
  writeCreateFlow
} from "../src/utils/createFlow.js";
import { authorPrivateSessionItem } from "../src/utils/authorPrivateText.js";
import {
  HISTORICAL_PINNED_PLACEHOLDER,
  TIME_PICKER_END,
  TIME_PICKER_START,
  clearPendingHistoricalDraftState,
  createHistoricalCreationKey,
  createOrRecoverHistoricalDraft,
  createSessionSetupSubmissionController,
  historicalCreateSettings,
  historicalDraftFingerprint,
  historicalPendingMatchesDescriptor,
  historicalPrimaryActionEnabled,
  historicalPinnedMessage,
  historicalSetupDescriptor,
  missingSeatPayloads,
  persistPendingHistoricalDraftState,
  sessionSetupSubmissionMatches,
  seatInitializationKey,
  selectedSessionPurpose,
  submitPurposeChanged
} from "../src/utils/sessionSetup.js";

const NOW = new Date("2026-07-31T09:00:00.000Z");

const ROLE_A = {
  name: "阿梨",
  seatType: "normal",
  roleName: "侦探",
  roleGender: "female",
  basePrice: 198,
  adjustment: 0
};

const ROLE_B = {
  name: "陈默",
  seatType: "normal",
  roleName: "记者",
  roleGender: "male",
  basePrice: 198,
  adjustment: 0
};

test("time picker uses a fixed full-day anchor and classifies Shanghai wall time", () => {
  assert.equal(TIME_PICKER_START, "2000-01-01 00:00:00");
  assert.equal(TIME_PICKER_END, "2000-01-01 23:59:59");
  assert.equal(selectedSessionPurpose("2026-08-03", "13:00", NOW), "future_carpool");
  assert.equal(selectedSessionPurpose("2026-07-31", "13:00", NOW), "historical_record");
  assert.equal(selectedSessionPurpose("2026-02-30", "13:00", NOW), null);
  assert.equal(selectedSessionPurpose("2026-07-31", "25:00", NOW), null);
  assert.equal(selectedSessionPurpose("", "", NOW), null);
});

test("submit detects when a future selection has become historical", () => {
  assert.equal(
    submitPurposeChanged(
      "future_carpool",
      "2026-07-31 17:00:00",
      new Date("2026-07-31T09:00:01.000Z")
    ),
    true
  );
  assert.equal(
    submitPurposeChanged(
      "historical_record",
      "2026-07-31 17:00:00",
      new Date("2026-07-31T09:00:01.000Z")
    ),
    false
  );
});

test("historical creation settings and copy cannot enable recruitment semantics", () => {
  assert.deepEqual(historicalCreateSettings(), {
    visibility: "share_only",
    joinPolicy: "review_required",
    joinPhoneRequired: false,
    npcJoinEnabled: false
  });
  assert.equal(historicalPinnedMessage("  当天临时换了角色  "), "当天临时换了角色");
  assert.equal(historicalPinnedMessage("   "), "");
  assert.match(HISTORICAL_PINNED_PLACEHOLDER, /补录/);
  assert.doesNotMatch(HISTORICAL_PINNED_PLACEHOLDER, /集合/);
});

test("seat initialization keys normalize API rows and reconcile duplicate roles as a multiset", () => {
  const existingRoleA = {
    name: " 阿梨 ",
    seat_type: "normal",
    role_name: "侦探",
    role_gender: "female",
    base_price: "198",
    adjustment: "0"
  };
  assert.equal(seatInitializationKey(ROLE_A), seatInitializationKey(existingRoleA));

  assert.deepEqual(missingSeatPayloads([ROLE_A, ROLE_B], [existingRoleA]), [ROLE_B]);
  assert.deepEqual(missingSeatPayloads([ROLE_A, ROLE_A, ROLE_B], [existingRoleA]), [
    ROLE_A,
    ROLE_B
  ]);
  assert.deepEqual(missingSeatPayloads([ROLE_A], [existingRoleA, existingRoleA]), []);
});

test("historical draft fingerprint covers every identity dimension", () => {
  const base = {
    storeId: 7,
    scriptId: 9,
    startAt: "2026-07-30 19:30:00",
    sessionPurpose: "historical_record",
    pinnedMessageText: "  当时换了角色  ",
    seatPayloads: [ROLE_A, ROLE_B],
    selectedSeatKey: seatInitializationKey(ROLE_A),
    selectedSeatOccurrence: 0
  };
  const fingerprint = historicalDraftFingerprint(base);
  assert.equal(fingerprint, historicalDraftFingerprint({ ...base }));

  for (const changed of [
    { ...base, storeId: 8 },
    { ...base, scriptId: 10 },
    { ...base, startAt: "2026-07-30 20:00:00" },
    { ...base, sessionPurpose: "future_carpool" },
    { ...base, pinnedMessageText: "补录另一段说明" },
    { ...base, seatPayloads: [ROLE_B, ROLE_A] },
    {
      ...base,
      selectedSeatKey: seatInitializationKey(ROLE_B),
      selectedSeatOccurrence: 0
    },
    { ...base, selectedSeatOccurrence: 1 }
  ]) {
    assert.notEqual(historicalDraftFingerprint(changed), fingerprint);
  }
  assert.equal(
    historicalDraftFingerprint({ ...base, pinnedMessageText: "当时换了角色" }),
    fingerprint
  );
});

test("create flow retains session purpose in storage and share-query round trips", () => {
  const originalUni = globalThis.uni;
  let stored = {};
  globalThis.uni = {
    getStorageSync() {
      return stored;
    },
    setStorageSync(_key, value) {
      stored = value;
    }
  };

  try {
    const pendingHistoricalDraft = { sessionId: 71, fingerprint: "draft-71" };
    writeCreateFlow({
      sessionPurpose: "historical_record",
      pendingHistoricalDraft
    });
    assert.equal(readCreateFlow().sessionPurpose, "historical_record");
    assert.deepEqual(readCreateFlow().pendingHistoricalDraft, pendingHistoricalDraft);

    const query = flowToQuery({ sessionPurpose: "historical_record" });
    const options = Object.fromEntries(new URLSearchParams(query.slice(1)));
    assert.equal(queryToFlow(options).sessionPurpose, "historical_record");
  } finally {
    globalThis.uni = originalUni;
  }
});

test("author-private session projections retain historical purpose", () => {
  const projection = {
    draft_id: 81,
    content_ref: "text-proposal:81",
    publication_state: "author_only",
    moderation_status: "review",
    moderation_message: "仅自己可见 · 进一步审核",
    content: {
      is_draft: true,
      startAt: "2026-07-30 19:30:00",
      sessionPurpose: "historical_record"
    },
    can_edit: false,
    can_delete: true,
    can_resubmit: false
  };
  assert.equal(authorPrivateSessionItem(projection).session_purpose, "historical_record");
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function historicalSnapshot(overrides = {}) {
  const store = { id: 7, name: "测试门店" };
  const script = { id: 9, name: "测试剧本", price_per_player: 198 };
  const roleOptions = [
    { id: "role-a", name: "阿梨", note: "侦探", roleGender: "female" },
    { id: "role-b", name: "陈默", note: "记者", roleGender: "male" }
  ];
  return {
    store,
    script,
    role: roleOptions[0],
    roleOptions,
    selectedRoles: roleOptions,
    dateValue: "2026-07-30",
    timeValue: "19:30",
    startAt: "2026-07-30 19:30:00",
    startText: "2026-07-30 19:30",
    sessionPurpose: "historical_record",
    pinnedMessageText: "当天临时换了角色",
    joinPolicy: "review_required",
    joinPhoneRequired: false,
    npcJoinEnabled: false,
    cityVisible: false,
    ...overrides
  };
}

function pendingFromSnapshot(snapshot, overrides = {}) {
  const descriptor = historicalSetupDescriptor(snapshot);
  return {
    historicalCreationKey: "hs_0123456789abcdef0123456789abcdef0123456789abcdef",
    sessionId: null,
    fingerprint: descriptor.fingerprint,
    snapshot,
    selectedSeatKey: descriptor.selectedSeatKey,
    selectedSeatOccurrence: descriptor.selectedSeatOccurrence,
    ...overrides
  };
}

test("setup submission is single-flight before deferred login and runs one create/initialize", async () => {
  const login = deferred();
  const calls = { login: 0, create: 0, initialize: 0 };
  const controller = createSessionSetupSubmissionController();
  const operation = {
    prepare() {
      return { purpose: "historical_record" };
    },
    async ensureAuthenticated() {
      calls.login += 1;
      return login.promise;
    },
    async createSession() {
      calls.create += 1;
      return { id: 101 };
    },
    async initializeSession(session) {
      calls.initialize += 1;
      return session.id;
    }
  };

  const first = controller.submit(operation);
  const second = controller.submit(operation);
  await Promise.resolve();
  assert.deepEqual(calls, { login: 1, create: 0, initialize: 0 });

  login.resolve({ user: { id: 7 } });
  assert.equal(await first, 101);
  assert.equal(await second, 101);
  assert.deepEqual(calls, { login: 1, create: 1, initialize: 1 });
});

test("prepared setup must still match the form after deferred authentication", () => {
  const descriptor = historicalSetupDescriptor(historicalSnapshot());
  assert.equal(
    sessionSetupSubmissionMatches({
      preparedPurpose: "historical_record",
      currentPurpose: "historical_record",
      preparedDescriptor: descriptor,
      currentDescriptor: { ...descriptor }
    }),
    true
  );
  assert.equal(
    sessionSetupSubmissionMatches({
      preparedPurpose: "historical_record",
      currentPurpose: "future_carpool",
      preparedDescriptor: descriptor,
      currentDescriptor: descriptor
    }),
    false
  );
  assert.equal(
    sessionSetupSubmissionMatches({
      preparedPurpose: "historical_record",
      currentPurpose: "historical_record",
      preparedDescriptor: descriptor,
      currentDescriptor: { ...descriptor, fingerprint: "changed-during-login" }
    }),
    false
  );
});

test("historical creation persists a stable key before POST and reuses it after response loss", async () => {
  const snapshot = historicalSnapshot();
  const descriptor = historicalSetupDescriptor(snapshot);
  const state = { pendingHistoricalDraft: null };
  const persisted = [];
  const postedKeys = [];
  const serverSessions = new Map();
  let keyFactoryCalls = 0;
  let loseFirstResponse = true;
  const createKey = () => {
    keyFactoryCalls += 1;
    return "hs_0123456789abcdef0123456789abcdef0123456789abcdef";
  };
  const persistPending = (pending) => {
    persistPendingHistoricalDraftState(state, pending, (value) => persisted.push(value));
  };
  const createSession = async ({ historicalCreationKey, idempotencyKey }) => {
    assert.equal(idempotencyKey, historicalCreationKey);
    postedKeys.push(historicalCreationKey);
    if (!serverSessions.has(historicalCreationKey)) {
      serverSessions.set(historicalCreationKey, { id: 101 });
    }
    if (loseFirstResponse) {
      loseFirstResponse = false;
      throw new Error("response lost after commit");
    }
    return serverSessions.get(historicalCreationKey);
  };

  await assert.rejects(
    () => createOrRecoverHistoricalDraft({
      pendingHistoricalDraft: state.pendingHistoricalDraft,
      descriptor,
      createKey,
      persistPending,
      createSession,
      recoverSession: async () => assert.fail("must POST while sessionId is null")
    }),
    /response lost/
  );
  assert.equal(state.pendingHistoricalDraft.sessionId, null);

  const recovered = await createOrRecoverHistoricalDraft({
    pendingHistoricalDraft: state.pendingHistoricalDraft,
    descriptor,
    createKey,
    persistPending,
    createSession,
    recoverSession: async () => assert.fail("must replay POST while sessionId is null")
  });
  assert.equal(recovered.session.id, 101);
  assert.equal(recovered.pendingHistoricalDraft.sessionId, 101);
  assert.equal(keyFactoryCalls, 1);
  assert.deepEqual(postedKeys, [postedKeys[0], postedKeys[0]]);
  assert.equal(serverSessions.size, 1);
  assert.equal(persisted[0].sessionId, null, "marker must be written before the first POST");
});

test("pending storage prewrite failure prevents historical POST while retaining in-memory key", async () => {
  const snapshot = historicalSnapshot();
  const descriptor = historicalSetupDescriptor(snapshot);
  const state = { pendingHistoricalDraft: null };
  let posts = 0;

  await assert.rejects(
    () => createOrRecoverHistoricalDraft({
      pendingHistoricalDraft: null,
      descriptor,
      createKey: () => "hs_0123456789abcdef0123456789abcdef0123456789abcdef",
      persistPending(pending) {
        persistPendingHistoricalDraftState(state, pending, () => {
          throw new Error("storage unavailable");
        });
      },
      async createSession() {
        posts += 1;
        return { id: 101 };
      },
      recoverSession: async () => null
    }),
    /storage unavailable/
  );

  assert.equal(posts, 0);
  assert.equal(state.pendingHistoricalDraft.sessionId, null);
  assert.match(state.pendingHistoricalDraft.historicalCreationKey, /^hs_/);
});

test("pending cleanup clears memory first and storage failure cannot block redirect", () => {
  const state = { pendingHistoricalDraft: { sessionId: 101 } };
  let redirects = 0;
  clearPendingHistoricalDraftState(state, () => {
    assert.equal(state.pendingHistoricalDraft, null);
    throw new Error("storage unavailable");
  }, () => {
    redirects += 1;
  });

  assert.equal(state.pendingHistoricalDraft, null);
  assert.equal(redirects, 1);
});

test("pending marker role fields and fingerprint must match its snapshot descriptor", () => {
  const snapshot = historicalSnapshot();
  const descriptor = historicalSetupDescriptor(snapshot);
  const pending = pendingFromSnapshot(snapshot);
  assert.equal(historicalPendingMatchesDescriptor(pending, descriptor), true);
  assert.equal(
    historicalPendingMatchesDescriptor(
      { ...pending, selectedSeatKey: seatInitializationKey(ROLE_B) },
      descriptor
    ),
    false
  );
  assert.equal(
    historicalPendingMatchesDescriptor(
      { ...pending, selectedSeatOccurrence: 1 },
      descriptor
    ),
    false
  );
  assert.equal(
    historicalPendingMatchesDescriptor({ ...pending, fingerprint: "tampered" }, descriptor),
    false
  );
  const tamperedSnapshot = {
    ...snapshot,
    role: snapshot.roleOptions[1]
  };
  assert.equal(
    historicalPendingMatchesDescriptor({ ...pending, snapshot: tamperedSnapshot }, descriptor),
    false
  );
  assert.equal(
    historicalPendingMatchesDescriptor({
      ...pending,
      snapshot: {
        ...snapshot,
        role: null,
        roleOptions: [null],
        selectedRoles: [null]
      }
    }),
    false,
    "corrupt role arrays must fail closed instead of crashing recovery"
  );
});

test("pending snapshot recovery enables CTA independently of invalid current store/script", () => {
  const validPending = pendingFromSnapshot(historicalSnapshot());
  assert.equal(
    historicalPrimaryActionEnabled({
      canSubmitCurrent: false,
      hasPendingMismatch: true,
      pendingHistoricalDraft: validPending
    }),
    true
  );
  assert.equal(
    historicalPrimaryActionEnabled({
      canSubmitCurrent: false,
      hasPendingMismatch: true,
      pendingHistoricalDraft: { ...validPending, snapshot: { sessionPurpose: "historical_record" } }
    }),
    false
  );
  assert.equal(
    historicalPrimaryActionEnabled({
      canSubmitCurrent: true,
      hasPendingMismatch: false,
      pendingHistoricalDraft: null
    }),
    true
  );
});

test("historical creation keys are high-entropy-shaped and deterministic with injected bytes", () => {
  const bytes = Uint8Array.from({ length: 24 }, (_, index) => index);
  const key = createHistoricalCreationKey({
    now: () => 1_722_422_400_000,
    randomBytes: () => bytes
  });
  assert.equal(key, createHistoricalCreationKey({
    now: () => 1_722_422_400_000,
    randomBytes: () => bytes
  }));
  assert.match(key, /^[A-Za-z0-9_-]{32,128}$/);
});
