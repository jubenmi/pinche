import assert from "node:assert/strict";
import test from "node:test";

async function idempotencyModule() {
  try {
    return await import("../src/modules/core/session-creation-idempotency.js");
  } catch (error) {
    return {};
  }
}

function connectionWithRows(rowsByCall) {
  let call = 0;
  return {
    async query() {
      const rows = rowsByCall[Math.min(call, rowsByCall.length - 1)] || [];
      call += 1;
      return [rows];
    }
  };
}

test("session creation idempotency keys are normalized and bounded", async () => {
  const module = await idempotencyModule();
  assert.equal(typeof module.normalizeSessionCreationIdempotencyKey, "function");
  assert.equal(module.normalizeSessionCreationIdempotencyKey({ idempotencyKey: " create-7 " }), "create-7");
  assert.equal(module.normalizeSessionCreationIdempotencyKey({}), "");
  assert.throws(
    () => module.normalizeSessionCreationIdempotencyKey({ idempotencyKey: "x".repeat(129) }),
    /128/
  );
});

test("an existing session replays without creating again", async () => {
  const module = await idempotencyModule();
  assert.equal(typeof module.replaySessionCreation, "function");
  let createCalls = 0;
  const result = await module.replaySessionCreation(
    connectionWithRows([[{ id: 9 }]]),
    7,
    "same-operation",
    async () => {
      createCalls += 1;
      return { id: 10 };
    }
  );
  assert.equal(result.id, 9);
  assert.equal(createCalls, 0);
});

test("a concurrent duplicate replays the winning session", async () => {
  const module = await idempotencyModule();
  assert.equal(typeof module.replaySessionCreation, "function");
  const result = await module.replaySessionCreation(
    connectionWithRows([[], [{ id: 9 }]]),
    7,
    "same-operation",
    async () => {
      throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
    }
  );
  assert.equal(result.id, 9);
});

test("non-duplicate creation errors are preserved", async () => {
  const module = await idempotencyModule();
  assert.equal(typeof module.replaySessionCreation, "function");
  const expected = Object.assign(new Error("database offline"), { code: "ECONNRESET" });
  await assert.rejects(
    module.replaySessionCreation(
      connectionWithRows([[]]),
      7,
      "same-operation",
      async () => {
        throw expected;
      }
    ),
    (error) => error === expected
  );
});
