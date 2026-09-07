import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2";
import { formatBeijingDateTime } from "@pinche/shared";
import { createSessionWithConnection } from "../src/modules/core/service.js";

const actor = { user: { id: 7, phoneVerifiedAt: "2026-01-01" }, roles: ["organizer"] };
const stop = new Error("captured session insert");
function captureConnection() {
  return {
    inserted: null,
    async query(sql, values = []) {
      const query = sql.replace(/\s+/g, " ").trim();
      if (query.startsWith("SELECT CURRENT_TIMESTAMP")) {
        return [[{ database_now: new Date("2026-09-07T00:00:00Z") }]];
      }
      if (query === "SELECT * FROM stores WHERE id = ?") return [[{ id: 1, name: "店家" }]];
      if (query === "SELECT * FROM scripts WHERE id = ?") return [[{ id: 2, name: "剧本" }]];
      if (query.startsWith("INSERT INTO user_roles")) return [{}];
      if (query.startsWith("INSERT INTO sessions")) {
        this.inserted = values;
        throw stop;
      }
      throw new Error(`Unexpected SQL: ${query}`);
    }
  };
}

for (const input of ["2026-09-07 19:30:00", "2026-09-07T19:30:00+08:00", "2026-09-07T11:30:00.123Z"]) {
  test(`creation binds an absolute UTC Date for ${input}`, async () => {
    const connection = captureConnection();
    await assert.rejects(createSessionWithConnection(connection, actor, {
      storeId: 1, scriptId: 2, startAt: input
    }), (error) => error === stop);
    const bound = connection.inserted[6];
    assert.ok(bound instanceof Date, "mysql2 must receive Date instead of unconverted wall text");
    assert.equal(bound.toISOString(), "2026-09-07T11:30:00.000Z");
    assert.equal(mysql.escape(bound, false, "Z"), "'2026-09-07 11:30:00.000'");
    assert.equal(formatBeijingDateTime(bound), "2026-09-07 19:30");
  });
}

for (const input of ["not-a-date", "2026-02-30 19:30:00", "2026-09-07T19:30:00+15:00", {}, "2026-09-06 19:30:00"]) {
  test(`creation rejects invalid or past time before insertion: ${JSON.stringify(input)}`, async () => {
    const connection = captureConnection();
    await assert.rejects(createSessionWithConnection(connection, actor, {
      storeId: 1, scriptId: 2, startAt: input
    }), (error) => ["INVALID_START_AT", "SESSION_PURPOSE_TIME_MISMATCH"].includes(error.code));
    assert.equal(connection.inserted, null);
  });
}
