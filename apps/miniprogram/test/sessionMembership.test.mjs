import test from "node:test";
import assert from "node:assert/strict";
import { canRequestRescheduleReminder } from "../src/utils/sessionMembership.js";

test("organizer cannot request a member reschedule reminder through a seat", () => {
  assert.equal(
    canRequestRescheduleReminder(
      { organizer_user_id: 7, seats: [{ status: "confirmed", confirmed_user_id: 7 }] },
      7
    ),
    false
  );
});

test("organizer cannot request a member reschedule reminder through an NPC role", () => {
  assert.equal(
    canRequestRescheduleReminder(
      {
        organizer_user_id: "7",
        session_npc_roles: [{ status: "active", bound_user_id: "7" }]
      },
      "7"
    ),
    false
  );
});

test("confirmed non-organizer members remain eligible", () => {
  assert.equal(
    canRequestRescheduleReminder(
      { organizer_user_id: 7, seats: [{ status: "locked", confirmed_user_id: 8 }] },
      8
    ),
    true
  );
});
