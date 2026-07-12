import assert from "node:assert/strict";
import test from "node:test";

import {
  createTextBaseline,
  requireInitialTextModerationTarget
} from "../src/modules/content-moderation/text-baseline.js";

test("text baselines change when a row changes inside the same DATETIME second", () => {
  const before = createTextBaseline({
    id: 12,
    updated_at: "2026-07-12 12:00:00",
    organizer_user_id: 7,
    note: "原说明"
  });
  const after = createTextBaseline({
    id: 12,
    updated_at: "2026-07-12 12:00:00",
    organizer_user_id: 7,
    note: "新说明"
  });

  assert.notEqual(after, before);
  assert.match(before, /^v1:[a-f0-9]{64}$/);
});

test("text baselines are deterministic regardless of database field order", () => {
  const first = createTextBaseline({
    id: 3,
    session_id: 12,
    name: "NPC",
    description: "说明"
  });
  const second = createTextBaseline({
    description: "说明",
    name: "NPC",
    session_id: 12,
    id: 3
  });

  assert.equal(first, second);
});

test("initial text moderation targets keep their normal not-found response", () => {
  for (const label of ["Session", "Session NPC role", "Session chat room"]) {
    assert.throws(
      () => requireInitialTextModerationTarget(null, label),
      (error) => error?.code === "NOT_FOUND" && error?.statusCode === 404
    );
  }
});
