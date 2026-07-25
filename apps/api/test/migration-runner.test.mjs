import assert from "node:assert/strict";
import test from "node:test";

test("SQL statement parsing ignores semicolons in values and comments", async () => {
  const { splitSqlStatements } = await import("../src/infra/db/sql-statements.js");
  const sql = `
    INSERT INTO examples (value) VALUES ('one;two');
    -- this comment contains a semicolon;
    /* and this block comment; does too */
    UPDATE examples SET value = "three;four" WHERE id = 1;
  `;

  assert.deepEqual(splitSqlStatements(sql), [
    "INSERT INTO examples (value) VALUES ('one;two')",
    "UPDATE examples SET value = \"three;four\" WHERE id = 1"
  ]);
});

test("SQL parser preserves escaped quotes and backtick identifiers", async () => {
  const { splitSqlStatements } = await import("../src/infra/db/sql-statements.js");
  const statements = splitSqlStatements(`
    INSERT INTO \`odd;table\` (value) VALUES ('it''s;safe');
    # ignored; comment
    SET @prepared_sql = "SELECT ';' AS value";
    PREPARE statement_name FROM @prepared_sql;
  `);
  assert.deepEqual(statements, [
    "INSERT INTO `odd;table` (value) VALUES ('it''s;safe')",
    "SET @prepared_sql = \"SELECT ';' AS value\"",
    "PREPARE statement_name FROM @prepared_sql"
  ]);
});

test("SQL parser rejects unterminated quotes instead of executing a fragment", async () => {
  const { splitSqlStatements } = await import("../src/infra/db/sql-statements.js");
  assert.throws(
    () => splitSqlStatements("INSERT INTO example VALUES ('unterminated);"),
    (error) => error?.code === "MIGRATION_SQL_PARSE_ERROR"
  );
});

test("migration checksum drift closes instead of silently skipping", async () => {
  const { migrationChecksum, verifyAppliedMigration } = await import("../src/infra/db/migrate.js");
  const originalSql = "CREATE TABLE example (id BIGINT PRIMARY KEY);";
  const applied = {
    version: "0033_example.sql",
    checksum: migrationChecksum(originalSql)
  };

  assert.doesNotThrow(() => verifyAppliedMigration(applied, originalSql));
  assert.throws(
    () => verifyAppliedMigration(applied, `${originalSql}\n-- changed`),
    (error) => error?.code === "MIGRATION_CHECKSUM_MISMATCH"
  );
});

test("migration lock acquisition is bounded and always released", async () => {
  const { withMigrationLock } = await import("../src/infra/db/migration-lock.js");
  const queries = [];
  const connection = {
    async query(sql, values) {
      queries.push([sql, values]);
      if (/GET_LOCK/.test(sql)) return [[{ acquired: 1 }]];
      if (/RELEASE_LOCK/.test(sql)) return [[{ released: 1 }]];
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  await assert.rejects(
    withMigrationLock(
      connection,
      { database: "pinche_d51_test", timeoutSeconds: 1 },
      async () => {
        throw new Error("migration failed");
      }
    ),
    /migration failed/
  );

  assert.equal(queries.filter(([sql]) => /GET_LOCK/.test(sql)).length, 1);
  assert.equal(queries.filter(([sql]) => /RELEASE_LOCK/.test(sql)).length, 1);
});

test("migration lock timeout prevents any migration work", async () => {
  const { withMigrationLock } = await import("../src/infra/db/migration-lock.js");
  let worked = false;
  await assert.rejects(
    withMigrationLock(
      { query: async () => [[{ acquired: 0 }]] },
      { database: "pinche_d51_test", timeoutSeconds: 1 },
      async () => { worked = true; }
    ),
    (error) => error?.code === "MIGRATION_LOCK_UNAVAILABLE"
  );
  assert.equal(worked, false);
});

test("migration registry owns exact filenames and rejects duplicate handlers", async () => {
  const { createMigrationRegistry } = await import("../src/infra/db/migration-registry.js");
  const calls = [];
  const registry = createMigrationRegistry();
  registry.register("0034_schema_migration_checksums.sql", {
    before: async (...args) => calls.push(["before", ...args]),
    reconcile: async (...args) => calls.push(["reconcile", ...args]),
    skipSql: true
  });
  assert.throws(
    () => registry.register("0034_schema_migration_checksums.sql", {}),
    (error) => error?.code === "MIGRATION_HANDLER_CONFLICT"
  );

  const connection = { marker: "connection" };
  assert.deepEqual(
    await registry.prepare(connection, "0034_schema_migration_checksums.sql"),
    { skipStatements: true }
  );
  assert.deepEqual(calls, [
    ["before", connection, "0034_schema_migration_checksums.sql"],
    ["reconcile", connection, "0034_schema_migration_checksums.sql"]
  ]);
  assert.deepEqual(
    await registry.prepare(connection, "0035_plain.sql"),
    { skipStatements: false }
  );
});

test("historical duplicate prefixes are fixed while every new prefix is unique", async () => {
  const { validateMigrationFilenames } = await import("../../../scripts/d51-architecture-hardening-check.js");
  const historicalDuplicates = new Set(["0021", "0022", "0024", "0030", "0032", "0033"]);

  assert.deepEqual(
    validateMigrationFilenames(
      ["0033_old_a.sql", "0033_old_b.sql", "0034_checksum.sql"],
      { historicalDuplicates }
    ),
    []
  );
  assert.deepEqual(
    validateMigrationFilenames(
      ["0034_checksum.sql", "0034_new_duplicate.sql"],
      { historicalDuplicates }
    ).map((finding) => finding.code),
    ["DUPLICATE_NEW_MIGRATION_PREFIX"]
  );
});
