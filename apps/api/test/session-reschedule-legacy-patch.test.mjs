import test from "node:test";
import assert from "node:assert/strict";
import { assertSessionPatchDoesNotReschedule } from "../src/modules/core/service.js";

for (const lifecycle of ["future", "member", "started"]) {
  test(`legacy PATCH rejects startAt for a ${lifecycle} session`, () => {
    assert.throws(
      () => assertSessionPatchDoesNotReschedule({ startAt: "2030-01-01T12:00:00Z" }),
      (error) =>
        error?.statusCode === 400 &&
        error?.message.includes("POST /api/sessions/:id/reschedule")
    );
  });
}

test("legacy PATCH rejects snake-case start_at even when undefined", () => {
  assert.throws(
    () => assertSessionPatchDoesNotReschedule({ start_at: undefined }),
    (error) => error?.statusCode === 400
  );
});

test("legacy PATCH continues to accept management settings", () => {
  assert.doesNotThrow(() =>
    assertSessionPatchDoesNotReschedule({
      joinPolicy: "approval",
      joinPhoneRequired: true,
      npcJoinEnabled: false,
      note: "bring dice"
    })
  );
});
