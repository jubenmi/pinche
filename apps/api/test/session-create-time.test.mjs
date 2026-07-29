import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSessionCreationStartAt } from "../src/modules/core/session-create-time.js";
import { createSessionWithConnection } from "../src/modules/core/service.js";

test("normalizes supported session creation timestamps to UTC second precision", () => {
  const cases = [
    ["2026-07-28T07:00:00.987Z", "2026-07-28T07:00:00.000Z"],
    ["2026-07-28T15:00:00+08:00", "2026-07-28T07:00:00.000Z"],
    ["2026-07-28 15:00:00", "2026-07-28T07:00:00.000Z"]
  ];

  for (const [input, expected] of cases) {
    const normalized = normalizeSessionCreationStartAt(input);
    assert.ok(normalized instanceof Date);
    assert.equal(normalized.toISOString(), expected);
  }
});

test("rejects missing and invalid session creation timestamps", () => {
  for (const input of [undefined, null, "", "2026-02-30 15:00:00", "not-a-date"]) {
    assert.throws(() => normalizeSessionCreationStartAt(input), {
      code: "INVALID_START_AT"
    });
  }
});

test("rejects an invalid creation timestamp before any connection query", async () => {
  const queries = [];
  const connection = {
    async query(sql, params) {
      queries.push({ sql, params });
      throw new Error("connection must not be queried for an invalid startAt");
    }
  };

  await assert.rejects(
    createSessionWithConnection(
      connection,
      {
        user: { id: 7, phoneVerifiedAt: "2026-07-28T00:00:00.000Z" },
        roles: []
      },
      { storeId: 1, scriptId: 2, startAt: "not-a-date" }
    ),
    {
      statusCode: 400,
      code: "BAD_REQUEST",
      message: "startAt must be a valid business date time"
    }
  );
  assert.equal(queries.length, 0);
});
