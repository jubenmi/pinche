import assert from "node:assert/strict";
import test from "node:test";

import {
  assertModerationTransition,
  assertTextProposalTransition
} from "../src/modules/content-moderation/state-machine.js";
import { MODERATION_JOB_STATUSES } from "../src/modules/content-moderation/constants.js";

test("D46 user cancellation reaches a terminal job state from every cancellable state", () => {
  assert.equal(MODERATION_JOB_STATUSES.includes("cancelled"), true);
  for (const status of ["pending", "processing", "review", "error", "rejected"]) {
    assert.doesNotThrow(() => assertModerationTransition(status, "cancelled", { source: "user" }));
  }
  assert.doesNotThrow(() => assertModerationTransition("cancelled", "cancelled", { source: "user" }));
  assert.throws(
    () => assertModerationTransition("approved", "cancelled", { source: "user" }),
    { code: "CONTENT_MODERATION_INVALID_TRANSITION" }
  );
});

test("D46 cancelled jobs cannot be revived by late provider, admin, or retry results", () => {
  for (const source of ["provider", "admin", "user"]) {
    for (const next of ["pending", "processing", "approved", "review", "rejected", "error"]) {
      assert.throws(
        () => assertModerationTransition("cancelled", next, { source }),
        { code: "CONTENT_MODERATION_INVALID_TRANSITION" }
      );
    }
  }
});

test("D46 proposal cancellation and replacement are terminal and cannot publish late", () => {
  assert.doesNotThrow(() => assertTextProposalTransition("pending", "cancelled"));
  assert.doesNotThrow(() => assertTextProposalTransition("rejected", "cancelled"));
  assert.doesNotThrow(() => assertTextProposalTransition("rejected", "superseded"));
  assert.doesNotThrow(() => assertTextProposalTransition("cancelled", "cancelled"));
  assert.doesNotThrow(() => assertTextProposalTransition("superseded", "superseded"));

  for (const terminal of ["cancelled", "superseded"]) {
    for (const next of ["pending", "approved", "rejected", "stale"] ) {
      assert.throws(
        () => assertTextProposalTransition(terminal, next),
        { code: "CONTENT_MODERATION_INVALID_PROPOSAL_TRANSITION" }
      );
    }
  }
});

test("D46 state machine rejects unknown transition sources instead of treating them as providers", () => {
  assert.throws(
    () => assertModerationTransition("pending", "processing", { source: "worker_typo" }),
    { code: "CONTENT_MODERATION_INVALID_TRANSITION" }
  );
});
