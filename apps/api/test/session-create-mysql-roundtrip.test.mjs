import assert from "node:assert/strict";
import test from "node:test";
import { formatBeijingDateTime } from "@pinche/shared";
import { normalizeSessionCreationStartAt } from "../src/modules/core/session-create-time.js";

function assertIsolatedMysqlEnvironment(env = process.env) {
  assert.equal(
    env.D51_INTEGRATION_ISOLATED,
    "1",
    "real MySQL round trip requires the isolated integration flag"
  );
  assert.equal(
    String(env.NODE_ENV || "").trim().toLowerCase(),
    "test",
    "real MySQL round trip requires NODE_ENV=test"
  );
  assert.equal(env.MYSQL_HOST, "mysql", "real MySQL round trip requires the Compose MySQL host");
  assert.equal(
    env.MYSQL_DATABASE,
    "pinche_d51_test",
    "real MySQL round trip requires the isolated test database"
  );
}

test("creation wall time survives a UTC DATETIME round trip", async () => {
  assertIsolatedMysqlEnvironment();
  const { withDatabaseConnection } = await import("../src/db/mysql.js");
  await withDatabaseConnection(async (connection) => {
    await connection.query(
      "CREATE TEMPORARY TABLE business_time_roundtrip (start_at DATETIME NOT NULL)"
    );
    const normalized = normalizeSessionCreationStartAt("2026-07-28 15:00:00");
    await connection.query(
      "INSERT INTO business_time_roundtrip (start_at) VALUES (?)",
      [normalized]
    );
    const [rows] = await connection.query(
      "SELECT start_at FROM business_time_roundtrip LIMIT 1"
    );
    assert.equal(rows[0].start_at instanceof Date, true);
    assert.equal(rows[0].start_at.toISOString(), "2026-07-28T07:00:00.000Z");
    assert.equal(
      JSON.parse(JSON.stringify(rows[0])).start_at,
      "2026-07-28T07:00:00.000Z"
    );
    assert.equal(formatBeijingDateTime(rows[0].start_at), "2026-07-28 15:00");
  });
});
