import test from "node:test";
import assert from "node:assert/strict";

import {
  configureConnectionTimeZone,
  databaseConnectionOptions,
  serverConnectionOptions
} from "../src/db/mysql.js";

test("configures mysql2 date conversion as UTC", () => {
  assert.equal(serverConnectionOptions().timezone, "Z");
  assert.equal(databaseConnectionOptions().timezone, "Z");
});

test("configures every MySQL session as UTC", async () => {
  const calls = [];
  await configureConnectionTimeZone({
    query: async (sql) => {
      calls.push(sql);
    }
  });
  assert.deepEqual(calls, ["SET time_zone = '+00:00'"]);
});
