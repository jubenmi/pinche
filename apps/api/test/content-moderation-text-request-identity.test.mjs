import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  createTextMutationIdentity,
  textOperationSubjectId,
  textMutationSubjectVersion
} from "../src/modules/content-moderation/text-request-identity.js";
import { buildTextProposalPayload } from "../src/modules/content-moderation/text-boundaries.js";

function fallbackIdentity({ body, context = {}, baseVersion = "v1" } = {}) {
  return createTextMutationIdentity({
    action: "create_session_npc_role",
    actorUserId: 7,
    subjectId: "",
    baseVersion,
    rawBody: body,
    payload: buildTextProposalPayload("create_session_npc_role", { body, context })
  });
}

test("fallback identity uses canonical payload so unrelated fields do not create a second write", () => {
  const first = fallbackIdentity({
    body: { roleName: "NPC", roleDescription: "说明", adminNote: "a" },
    context: { sessionId: 12 }
  });
  const second = fallbackIdentity({
    body: { name: "NPC", description: "说明", signedUrl: "https://private.example/x" },
    context: { sessionId: 12 }
  });

  assert.equal(first.explicit, false);
  assert.equal(second.explicit, false);
  assert.equal(first.idempotencyKey, second.idempotencyKey);
});

test("fallback identity includes context and base identity for NPC and stale resubmission isolation", () => {
  const firstSession = fallbackIdentity({
    body: { name: "NPC", description: "说明" },
    context: { sessionId: 12 },
    baseVersion: "v1:session"
  });
  const secondSession = fallbackIdentity({
    body: { name: "NPC", description: "说明" },
    context: { sessionId: 13 },
    baseVersion: "v1:session"
  });
  const changedBase = fallbackIdentity({
    body: { name: "NPC", description: "说明" },
    context: { sessionId: 12 },
    baseVersion: "v1:changed"
  });

  assert.notEqual(firstSession.idempotencyKey, secondSession.idempotencyKey);
  assert.notEqual(firstSession.idempotencyKey, changedBase.idempotencyKey);
  assert.equal(
    textMutationSubjectVersion({
      normalizedText: "[name]NPC",
      baseVersion: "v1:session"
    }),
    textMutationSubjectVersion({
      normalizedText: "[name]NPC",
      baseVersion: "v1:changed"
    })
  );
});

test("an explicit idempotency key remains stable across baseline changes", () => {
  const first = createTextMutationIdentity({
    request: { headers: { "idempotency-key": "same-operation" } },
    rawBody: { name: "NPC" },
    action: "create_session_npc_role",
    actorUserId: 7,
    subjectId: "",
    baseVersion: "v1",
    payload: { body: { name: "NPC" }, context: { sessionId: 12 } }
  });
  const second = createTextMutationIdentity({
    rawBody: { idempotencyKey: "same-operation", name: "NPC" },
    action: "create_session_npc_role",
    actorUserId: 7,
    subjectId: "",
    baseVersion: "v2",
    payload: { body: { name: "NPC" }, context: { sessionId: 12 } }
  });

  assert.deepEqual(first, { idempotencyKey: "same-operation", explicit: true });
  assert.deepEqual(second, { idempotencyKey: "same-operation", explicit: true });
  assert.equal(
    textMutationSubjectVersion({ normalizedText: "[name]NPC", baseVersion: "v1", explicit: true }),
    textMutationSubjectVersion({ normalizedText: "[name]NPC", baseVersion: "v2", explicit: true })
  );
});

test("historical session identity ignores raw explicit keys and namespaces the canonical hash", () => {
  const historicalCreationKey =
    "hs_0123456789abcdef0123456789abcdef0123456789abcdef";
  const historicalCreationKeyHash = crypto
    .createHash("sha256")
    .update(historicalCreationKey)
    .digest("hex");
  const payload = buildTextProposalPayload("create_session", {
    body: {
      storeId: 3,
      scriptId: 4,
      startAt: "2020-01-01 13:00:00",
      sessionPurpose: "historical_record",
      historicalCreationKey,
      note: "历史补录"
    }
  });

  const identity = createTextMutationIdentity({
    request: { headers: { "idempotency-key": historicalCreationKey } },
    rawBody: { historicalCreationKey, idempotencyKey: historicalCreationKey },
    action: "create_session",
    actorUserId: 7,
    subjectId: "",
    baseVersion: "v1",
    payload
  });

  assert.deepEqual(identity, {
    idempotencyKey: `hsc_${historicalCreationKeyHash}`,
    explicit: true
  });
  assert.equal(identity.idempotencyKey.includes(historicalCreationKey), false);
});

test("operation subject identity separates new keys while retaining a pure text subject version", () => {
  const first = textOperationSubjectId({
    action: "update_session",
    actorUserId: 7,
    targetSubjectId: "12",
    idempotencyKey: "first-operation"
  });
  const retry = textOperationSubjectId({
    action: "update_session",
    actorUserId: 7,
    targetSubjectId: "12",
    idempotencyKey: "first-operation"
  });
  const replacement = textOperationSubjectId({
    action: "update_session",
    actorUserId: 7,
    targetSubjectId: "12",
    idempotencyKey: "second-operation"
  });

  assert.equal(first, retry);
  assert.notEqual(first, replacement);
  assert.match(first, /^text-op:[a-f0-9]{64}$/);
  assert.equal(
    textMutationSubjectVersion({
      normalizedText: "[note]同一段文本",
      baseVersion: "v1",
      explicit: true
    }),
    textMutationSubjectVersion({
      normalizedText: "[note]同一段文本",
      baseVersion: "v2",
      explicit: false
    })
  );
});
