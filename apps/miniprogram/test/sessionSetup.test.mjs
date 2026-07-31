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
  historicalCreateSettings,
  historicalDraftFingerprint,
  historicalPinnedMessage,
  missingSeatPayloads,
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
