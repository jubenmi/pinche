import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMigration,
  ensureMigrationsTable,
  migrationLockName,
  migrationLockTimeoutSeconds,
  reconcileMigrationChecksums,
  runMigrations,
  serializeMigrationError,
  sha256Checksum,
  withMigrationLock,
} from "../src/db/migrate.js";

function migrationPreparer(id, filename) {
  return {
    id,
    filenames: new Set([filename]),
    prepare: async () => ({ skipStatements: true }),
  };
}

test("migration runner rejects preparer conflicts before opening a database connection", async () => {
  let connectionCalls = 0;
  await assert.rejects(
    runMigrations({
      connectionFactory: async () => {
        connectionCalls += 1;
        throw new Error("connection must not be opened");
      },
      migrationPreparers: [
        migrationPreparer("first", "0042_conflict.sql"),
        migrationPreparer("second", "0042_conflict.sql"),
      ],
    }),
    { code: "MIGRATION_PREPARER_CONFLICT" },
  );
  assert.equal(connectionCalls, 0);
});

test("migration history schema creates or upgrades the nullable checksum column", async () => {
  const calls = [];
  const connection = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      calls.push(normalized);
      if (normalized.includes("FROM information_schema.columns")) return [[]];
      return [[]];
    },
  };
  await ensureMigrationsTable(connection);
  assert.match(calls[0], /checksum_sha256 CHAR\(64\) NULL/);
  assert.equal(
    calls.at(-1),
    "ALTER TABLE schema_migrations ADD COLUMN checksum_sha256 CHAR(64) NULL AFTER version",
  );
});

test("migration SQL checksum is the lowercase SHA-256 digest of exact file bytes", () => {
  assert.equal(
    sha256Checksum("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.notEqual(sha256Checksum("SELECT 1;\n"), sha256Checksum("SELECT 1;"));
});

test("checksum reconciliation accepts matches and backfills legacy null rows", async () => {
  const calls = [];
  const connection = {
    async query(sql, values) {
      calls.push([sql, values]);
      return [{ affectedRows: 1 }];
    },
  };
  const checksums = new Map([
    ["0001_first.sql", "a".repeat(64)],
    ["0002_second.sql", "b".repeat(64)],
  ]);
  const applied = await reconcileMigrationChecksums(connection, [
    { version: "0001_first.sql", checksum_sha256: "a".repeat(64) },
    { version: "0002_second.sql", checksum_sha256: null },
  ], checksums);

  assert.deepEqual([...applied], ["0001_first.sql", "0002_second.sql"]);
  assert.deepEqual(calls, [[
    "UPDATE schema_migrations SET checksum_sha256 = ? WHERE version = ? AND checksum_sha256 IS NULL",
    ["b".repeat(64), "0002_second.sql"],
  ]]);
});

test("checksum mismatch fails before any history backfill", async () => {
  let queryCalls = 0;
  await assert.rejects(
    reconcileMigrationChecksums(
      { query: async () => { queryCalls += 1; } },
      [
        { version: "0001_first.sql", checksum_sha256: null },
        { version: "0002_second.sql", checksum_sha256: "c".repeat(64) },
      ],
      new Map([
        ["0001_first.sql", "a".repeat(64)],
        ["0002_second.sql", "b".repeat(64)],
      ]),
    ),
    { code: "MIGRATION_CHECKSUM_MISMATCH" },
  );
  assert.equal(queryCalls, 0);
});

test("applied migration without a local SQL file fails closed", async () => {
  await assert.rejects(
    reconcileMigrationChecksums(
      { query: async () => { throw new Error("must not write"); } },
      [{ version: "0001_missing.sql", checksum_sha256: null }],
      new Map(),
    ),
    (error) => error.code === "MIGRATION_HISTORY_FILE_MISSING"
      && error.details.version === "0001_missing.sql",
  );
});

test("new migration history records include the exact checksum", async () => {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push(["begin"]); },
    async query(sql, values) {
      calls.push([sql.replace(/\s+/g, " ").trim(), values]);
      return [[]];
    },
    async commit() { calls.push(["commit"]); },
    async rollback() { calls.push(["rollback"]); },
  };
  const sql = "CREATE TABLE checksum_probe (id INT);";
  const checksum = sha256Checksum(sql);
  await applyMigration(connection, { file: "0099_checksum_probe.sql", sql, checksum });
  assert.deepEqual(calls.at(-2), [
    "INSERT INTO schema_migrations (version, checksum_sha256) VALUES (?, ?)",
    ["0099_checksum_probe.sql", checksum],
  ]);
  assert.deepEqual(calls.at(-1), ["commit"]);
});

test("migration lock name is stable, bounded, and readable for ordinary databases", () => {
  assert.equal(migrationLockName("pinche"), "pinche:migrate:pinche");
  assert.ok(Buffer.byteLength(migrationLockName("数".repeat(100)), "utf8") <= 64);
  assert.equal(migrationLockName("x".repeat(100)), migrationLockName("x".repeat(100)));
});

test("migration lock timeout is explicitly bounded for concurrent runners", () => {
  assert.equal(migrationLockTimeoutSeconds(undefined), 30);
  assert.equal(migrationLockTimeoutSeconds("1"), 1);
  assert.equal(migrationLockTimeoutSeconds("60"), 60);
  for (const invalid of ["0", "61", "1.5", "not-a-number"]) {
    assert.throws(
      () => migrationLockTimeoutSeconds(invalid),
      (error) => error?.code === "MIGRATION_LOCK_TIMEOUT_INVALID",
    );
  }
});

test("migration lock wraps work and releases in finally", async () => {
  const calls = [];
  const connection = {
    async query(sql, values) {
      calls.push([sql, values]);
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      return [[{ released: 1 }]];
    },
  };
  const result = await withMigrationLock(connection, "pinche", async () => {
    calls.push(["work"]);
    return 42;
  });
  assert.equal(result, 42);
  assert.deepEqual(calls, [
    ["SELECT GET_LOCK(?, ?) AS acquired", ["pinche:migrate:pinche", 30]],
    ["work"],
    ["SELECT RELEASE_LOCK(?) AS released", ["pinche:migrate:pinche"]],
  ]);
});

test("unavailable migration lock prevents migration work", async () => {
  let worked = false;
  const connection = {
    async query(sql) {
      assert.match(sql, /GET_LOCK/);
      return [[{ acquired: 0 }]];
    },
  };
  await assert.rejects(
    withMigrationLock(connection, "pinche", async () => { worked = true; }),
    { code: "MIGRATION_LOCK_UNAVAILABLE" },
  );
  assert.equal(worked, false);
});

test("release failure never replaces the primary migration error", async () => {
  const primary = new Error("primary migration failure");
  const connection = {
    async query(sql) {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      throw new Error("release transport failed");
    },
  };
  await assert.rejects(
    withMigrationLock(connection, "pinche", async () => { throw primary; }),
    (error) => error === primary
      && error.migrationLockReleaseError?.code === "MIGRATION_LOCK_RELEASE_FAILED",
  );
});

test("migration-specific serialization keeps stable codes and bounded details", () => {
  const error = new Error("internal message");
  error.code = "MIGRATION_CHECKSUM_MISMATCH";
  error.details = { version: "0001_first.sql", noisy: "x".repeat(10_000) };
  const serialized = serializeMigrationError(error);
  assert.equal(serialized.code, "MIGRATION_CHECKSUM_MISMATCH");
  assert.equal(serialized.details.version, "0001_first.sql");
  assert.ok(serialized.details.noisy.length < 10_000);
  assert.equal(serialized.message.includes("internal message"), false);
});
