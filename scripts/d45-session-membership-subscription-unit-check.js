import assert from "node:assert/strict";
import {
  isConfirmedSessionMember,
  normalizeUserId,
  requestSubscriptionAfterConfirmedJoin,
  shouldRequestRescheduleSubscription
} from "../apps/miniprogram/src/utils/sessionMembership.js";

const session = {
  organizer_user_id: 99,
  seats: [
    { status: "confirmed", confirmed_user_id: 7 },
    { status: "locked", confirmed_user_id: "8" },
    { status: "applied", confirmed_user_id: 9 },
    { status: "confirmed", confirmed_user_id: "007" }
  ],
  session_npc_roles: [
    { status: "active", bound_user_id: 10 },
    { status: "inactive", bound_user_id: 11 },
    { status: "active", pending_user_id: 12 }
  ]
};

assert.equal(isConfirmedSessionMember(session, 7), true, "confirmed seat member is eligible");
assert.equal(isConfirmedSessionMember(session, "8"), true, "locked seat member is eligible");
assert.equal(isConfirmedSessionMember(session, 10), true, "active bound NPC member is eligible");
assert.equal(isConfirmedSessionMember(session, 9), false, "pending seat identity is not eligible");
assert.equal(isConfirmedSessionMember(session, 11), false, "inactive NPC binding is not eligible");
assert.equal(isConfirmedSessionMember(session, 12), false, "pending NPC identity is not eligible");
assert.equal(isConfirmedSessionMember(session, 99), false, "organizer-only identity is not eligible");
assert.equal(isConfirmedSessionMember(session, "0007"), true, "numeric duplicate identity matches once");
assert.equal(isConfirmedSessionMember(session, ""), false, "missing identity is not eligible");
assert.equal(normalizeUserId("0007"), "7", "digit ids normalize without numeric conversion");
assert.equal(normalizeUserId("9007199254740993"), "9007199254740993");
assert.equal(normalizeUserId("9007199254740992"), "9007199254740992");
assert.notEqual(normalizeUserId("9007199254740993"), normalizeUserId("9007199254740992"));
for (const invalidId of ["", " 7", "7 ", "7.0", "1e3", "-7", 7.5, null, undefined]) {
  assert.equal(normalizeUserId(invalidId), "", `invalid user id ${String(invalidId)} is rejected`);
}

assert.equal(
  shouldRequestRescheduleSubscription(false, "joined"),
  true,
  "explicit first join requests authorization"
);
assert.equal(shouldRequestRescheduleSubscription(true, "joined"), false, "member switch does not prompt");
assert.equal(shouldRequestRescheduleSubscription(false, "pending_review"), false);
assert.equal(shouldRequestRescheduleSubscription(false, undefined), false);
assert.equal(shouldRequestRescheduleSubscription(false, ""), false);
assert.equal(
  await requestSubscriptionAfterConfirmedJoin(false, "joined", "joined", async () => {
    throw new Error("subscription rejected");
  }),
  null,
  "subscription rejection never replaces join success"
);
let existingMemberRequests = 0;
await requestSubscriptionAfterConfirmedJoin(true, "joined", "joined", async () => {
  existingMemberRequests += 1;
});
assert.equal(existingMemberRequests, 0, "existing-member switches never request again");

console.log("D45 session membership subscription unit checks passed");
