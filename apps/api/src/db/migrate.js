import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.js";
import { createServerConnection } from "./mysql.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../../migrations");

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

async function ensureDatabase(connection) {
  const databaseName = quoteIdentifier(config.mysql.database);
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS ${databaseName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.query(`USE ${databaseName}`);
}

async function ensureMigrationsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function appliedVersions(connection) {
  const [rows] = await connection.query("SELECT version FROM schema_migrations");
  return new Set(rows.map((row) => row.version));
}

async function migrationFiles() {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
}

export async function runMigrations() {
  const connection = await createServerConnection();

  try {
    await ensureDatabase(connection);
    await ensureMigrationsTable(connection);

    const applied = await appliedVersions(connection);
    const files = await migrationFiles();
    const executed = [];

    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      const statements = splitSqlStatements(sql);

      await connection.beginTransaction();
      try {
        for (const statement of statements) {
          await connection.query(statement);
        }
        await connection.query("INSERT INTO schema_migrations (version) VALUES (?)", [
          file
        ]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }

      executed.push(file);
    }

    return { executed, total: files.length };
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
            error: {
              code: "MIGRATION_FAILED",
              message: error.message
            }
          },
          null,
          2
        )
      );
      process.exitCode = 1;
    });
}
