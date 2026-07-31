import test from "node:test";
import assert from "node:assert/strict";
import { assertSessionPatchLifecycle } from "../src/modules/core/service.js";

const FUTURE_RECRUITING = {
  session_purpose: "future_carpool",
  status: "recruiting"
};

for (const lifecycle of ["future", "member", "started"]) {
  test(`legacy PATCH rejects startAt for a ${lifecycle} session`, () => {
    assert.throws(
      () => assertSessionPatchLifecycle(
        FUTURE_RECRUITING,
        { startAt: "2030-01-01T12:00:00Z" }
      ),
      (error) =>
        error?.statusCode === 400 &&
        error?.message.includes("POST /api/sessions/:id/reschedule")
    );
  });
}

test("legacy PATCH rejects snake-case start_at even when undefined", () => {
  assert.throws(
    () => assertSessionPatchLifecycle(FUTURE_RECRUITING, { start_at: undefined }),
    (error) => error?.statusCode === 400
  );
});

for (const field of ["sessionPurpose", "session_purpose"]) {
  test("legacy PATCH rejects immutable " + field, () => {
    assert.throws(
      () =>
        assertSessionPatchLifecycle(
          { session_purpose: "future_carpool", status: "recruiting" },
          { [field]: "historical_record" }
        ),
      { statusCode: 400 }
    );
  });
}

test("legacy PATCH rejects unknown status", () => {
  assert.throws(
    () => assertSessionPatchLifecycle(FUTURE_RECRUITING, { status: "unknown" }),
    { statusCode: 400 }
  );
});

test("legacy PATCH rejects draft to locked", () => {
  assert.throws(
    () => assertSessionPatchLifecycle(
      { session_purpose: "future_carpool", status: "draft" },
      { status: "locked" }
    ),
    { statusCode: 400 }
  );
});

test("legacy PATCH rejects cancelled transitions", () => {
  assert.throws(
    () => assertSessionPatchLifecycle(
      { session_purpose: "future_carpool", status: "cancelled" },
      { status: "recruiting" }
    ),
    { statusCode: 400 }
  );
  assert.throws(
    () => assertSessionPatchLifecycle(FUTURE_RECRUITING, { status: "cancelled" }),
    { statusCode: 400 }
  );
});

test("legacy PATCH allows future recruiting to locked", () => {
  assert.equal(assertSessionPatchLifecycle(FUTURE_RECRUITING, { status: "locked" }), "locked");
});

test("legacy PATCH allows omitted and unchanged status", () => {
  assert.equal(assertSessionPatchLifecycle(FUTURE_RECRUITING, { note: "bring dice" }), undefined);
  assert.equal(assertSessionPatchLifecycle(FUTURE_RECRUITING, { status: "recruiting" }), undefined);
});

test("legacy PATCH cannot reset or reopen a locked historical session", () => {
  const historical = { session_purpose: "historical_record", status: "locked" };
  for (const status of ["draft", "recruiting"]) {
    assert.throws(
      () => assertSessionPatchLifecycle(historical, { status }),
      { statusCode: 400 }
    );
  }
});

test("legacy PATCH rejects historical recruitment-setting changes", () => {
  const historical = {
    session_purpose: "historical_record",
    status: "locked",
    visibility: "share_only",
    join_policy: "review_required",
    join_phone_required: 0,
    npc_join_enabled: 0
  };
  const changes = [
    { visibility: "public" },
    { joinPolicy: "direct" },
    { join_policy: "direct" },
    { joinPhoneRequired: true },
    { join_phone_required: true },
    { npcJoinEnabled: true },
    { npc_join_enabled: true },
    { joinPolicy: "review_required", join_policy: "direct" }
  ];
  for (const body of changes) {
    assert.throws(() => assertSessionPatchLifecycle(historical, body), { statusCode: 400 });
  }
});

test("legacy PATCH permits historical explicit-null member unbinding", () => {
  const historical = { session_purpose: "historical_record", status: "locked" };
  assert.doesNotThrow(() => assertSessionPatchLifecycle(historical, {
    dmUserId: null,
    dm_user_id: null,
    npcUserId: null,
    npc_user_id: null
  }));
});
