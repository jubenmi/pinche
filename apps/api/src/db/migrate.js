import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.js";
import {
  defaultMigrationPreparers,
  prepareRegisteredMigration,
  validateMigrationPreparerRegistry,
} from "./migration-registry.js";
import { createServerConnection } from "./mysql.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../../migrations");
const MIGRATION_LOCK_TIMEOUT_SECONDS = 30;

function migrationError(code, details = {}) {
  const error = new Error(`migration safety check failed: ${code}`);
  error.code = code;
  error.details = details;
  return error;
}

export function sha256Checksum(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function migrationLockName(database) {
  const prefix = "pinche:migrate:";
  const normalized = String(database || "");
  const readable = `${prefix}${normalized}`;
  if (/^[a-zA-Z0-9_.-]+$/.test(normalized) && Buffer.byteLength(readable, "utf8") <= 64) {
    return readable;
  }
  return `${prefix}${sha256Checksum(normalized).slice(0, 40)}`;
}

function lockReleaseError(lockName, cause) {
  return migrationError("MIGRATION_LOCK_RELEASE_FAILED", {
    lockName,
    ...(cause?.code ? { causeCode: String(cause.code).slice(0, 64) } : {}),
  });
}

export async function withMigrationLock(
  connection,
  database,
  work,
  { timeoutSeconds = MIGRATION_LOCK_TIMEOUT_SECONDS } = {},
) {
  const lockName = migrationLockName(database);
  let acquired = false;
  try {
    const [rows] = await connection.query(
      "SELECT GET_LOCK(?, ?) AS acquired",
      [lockName, timeoutSeconds],
    );
    acquired = Number(rows[0]?.acquired) === 1;
  } catch (error) {
    throw migrationError("MIGRATION_LOCK_UNAVAILABLE", {
      lockName,
      ...(error?.code ? { causeCode: String(error.code).slice(0, 64) } : {}),
    });
  }
  if (!acquired) {
    throw migrationError("MIGRATION_LOCK_UNAVAILABLE", { lockName });
  }

  let primaryError = null;
  try {
    return await work();
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      const [rows] = await connection.query(
        "SELECT RELEASE_LOCK(?) AS released",
        [lockName],
      );
      if (Number(rows[0]?.released) !== 1) throw lockReleaseError(lockName);
    } catch (error) {
      const releaseError = error?.code === "MIGRATION_LOCK_RELEASE_FAILED"
        ? error
        : lockReleaseError(lockName, error);
      if (primaryError) {
        primaryError.migrationLockReleaseError = {
          code: releaseError.code,
          details: releaseError.details,
        };
      } else {
        throw releaseError;
      }
    }
  }
}

function quoteIdentifier(identifier) {
  if (!/^[a-zA-Z0-9_]+$/.test(identifier)) {
    throw new Error(`Unsafe MySQL identifier: ${identifier}`);
  }

  return `\`${identifier}\``;
}

function splitSqlStatements(sql) {
  const withoutLineComments = sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  return withoutLineComments
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function applyMigration(
  connection,
  { file, sql, checksum = sha256Checksum(sql) },
  { migrationPreparers = defaultMigrationPreparers } = {},
) {
  const statements = splitSqlStatements(sql);

  await connection.beginTransaction();
  try {
    const { skipStatements } = await prepareRegisteredMigration(
      connection,
      file,
      migrationPreparers,
    );
    if (!skipStatements) {
      for (const statement of statements) {
        await connection.query(statement);
      }
    }
    await connection.query(
      "INSERT INTO schema_migrations (version, checksum_sha256) VALUES (?, ?)",
      [file, checksum],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

function boundedMigrationDetail(value, depth = 0) {
  if (depth > 5) return "[truncated]";
  if (typeof value === "string") return value.slice(0, 2048);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 512).map((item) => boundedMigrationDetail(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 64)
        .map(([key, item]) => [key.slice(0, 128), boundedMigrationDetail(item, depth + 1)]),
    );
  }
  return String(value).slice(0, 2048);
}

export function serializeMigrationError(error) {
  const migrationCode = typeof error?.code === "string" && error.code.startsWith("MIGRATION_")
    ? error.code
    : "MIGRATION_FAILED";
  const serialized = {
    code: migrationCode,
    message: migrationCode === "MIGRATION_FAILED"
      ? String(error?.message || "Migration failed").slice(0, 2048)
      : "Migration safety check failed",
  };
  if (error.details !== undefined) {
    serialized.details = boundedMigrationDetail(error.details);
  }
  return serialized;
}

async function ensureDatabase(connection) {
  const databaseName = quoteIdentifier(config.mysql.database);
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS ${databaseName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.query(`USE ${databaseName}`);
}

export async function ensureMigrationsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      checksum_sha256 CHAR(64) NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [columns] = await connection.query(
    `
      SELECT
        DATA_TYPE AS data_type,
        CHARACTER_MAXIMUM_LENGTH AS character_maximum_length,
        IS_NULLABLE AS is_nullable
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'schema_migrations'
        AND column_name = 'checksum_sha256'
      LIMIT 1
    `,
  );
  if (columns.length === 0) {
    await connection.query(
      "ALTER TABLE schema_migrations ADD COLUMN checksum_sha256 CHAR(64) NULL AFTER version",
    );
    return;
  }
  const column = columns[0];
  if (
    String(column.data_type).toLowerCase() !== "char"
    || Number(column.character_maximum_length) !== 64
    || String(column.is_nullable).toUpperCase() !== "YES"
  ) {
    throw migrationError("MIGRATION_HISTORY_SCHEMA_MISMATCH", {
      column: "checksum_sha256",
      expected: { dataType: "char", length: 64, nullable: true },
    });
  }
}

async function appliedMigrationRows(connection) {
  const [rows] = await connection.query(
    "SELECT version, checksum_sha256 FROM schema_migrations ORDER BY version",
  );
  return rows;
}

export async function reconcileMigrationChecksums(connection, rows, checksumsByVersion) {
  for (const row of rows) {
    const expected = checksumsByVersion.get(row.version);
    if (!expected) {
      throw migrationError("MIGRATION_HISTORY_FILE_MISSING", { version: row.version });
    }
    if (row.checksum_sha256 && row.checksum_sha256 !== expected) {
      throw migrationError("MIGRATION_CHECKSUM_MISMATCH", {
        version: row.version,
        recordedChecksum: row.checksum_sha256,
        currentChecksum: expected,
      });
    }
  }

  for (const row of rows) {
    if (row.checksum_sha256) continue;
    await connection.query(
      "UPDATE schema_migrations SET checksum_sha256 = ? WHERE version = ? AND checksum_sha256 IS NULL",
      [checksumsByVersion.get(row.version), row.version],
    );
  }
  return new Set(rows.map((row) => row.version));
}

async function migrationFiles() {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
}

export async function runMigrations({
  connectionFactory = createServerConnection,
  migrationPreparers = defaultMigrationPreparers,
} = {}) {
  validateMigrationPreparerRegistry(migrationPreparers);
  const connection = await connectionFactory();

  try {
    await ensureDatabase(connection);
    return await withMigrationLock(connection, config.mysql.database, async () => {
      await ensureMigrationsTable(connection);

      const files = await migrationFiles();
      const migrations = await Promise.all(files.map(async (file) => {
        const bytes = await fs.readFile(path.join(migrationsDir, file));
        return { file, sql: bytes.toString("utf8"), checksum: sha256Checksum(bytes) };
      }));
      const checksumsByVersion = new Map(
        migrations.map(({ file, checksum }) => [file, checksum]),
      );
      const applied = await reconcileMigrationChecksums(
        connection,
        await appliedMigrationRows(connection),
        checksumsByVersion,
      );
      const executed = [];

      for (const migration of migrations) {
        if (applied.has(migration.file)) continue;
        await applyMigration(connection, migration, { migrationPreparers });
        executed.push(migration.file);
      }

      return { executed, total: files.length };
    });
  } finally {
    await connection.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then((result) => {
      console.log(
        JSON.stringify(
          {
            ok: true,
            database: config.mysql.database,
            executed: result.executed,
            total: result.total
          },
          null,
          2
        )
      );
    })
    .catch((error) => {
      console.error(
        JSON.stringify(
          {
            ok: false,
            error: serializeMigrationError(error)
          },
          null,
          2
        )
      );
      process.exitCode = 1;
    });
}
