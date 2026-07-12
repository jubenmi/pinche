import assert from "node:assert/strict";
import { isConfirmedSessionMember } from "../apps/miniprogram/src/utils/sessionMembership.js";

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

console.log("D45 session membership subscription unit checks passed");
