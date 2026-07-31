import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { requiredSchemaTables } from "../src/db/mysql.js";

test("historical-session migration adds a safe compatible purpose", async () => {
  const sql = await readFile(
    new URL("../migrations/0033_historical_session_backfill.sql", import.meta.url),
    "utf8"
  );
  const executableSql = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[\t ]*--.*$/gm, "")
    .replace(/''/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  assert.match(
    executableSql,
    /SET @session_purpose_exists = \( SELECT COUNT\(\*\) FROM information_schema\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'session_purpose' \);/i
  );
  assert.match(
    executableSql,
    /SET @session_purpose_sql = IF\( @session_purpose_exists = 0, 'ALTER TABLE sessions ADD COLUMN session_purpose VARCHAR\(32\) NOT NULL DEFAULT 'future_carpool' AFTER start_at', 'SELECT 1' \);/i
  );
  assert.match(
    executableSql,
    /PREPARE session_purpose_statement FROM @session_purpose_sql; EXECUTE session_purpose_statement;/i
  );
  assert.match(
    executableSql,
    /SET @session_purpose_index_exists = \( SELECT COUNT\(\*\) FROM information_schema\.STATISTICS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'sessions' AND INDEX_NAME = 'idx_sessions_public_purpose_status_start' \);/i
  );
  assert.match(
    executableSql,
    /SET @session_purpose_index_sql = IF\( @session_purpose_index_exists = 0, 'ALTER TABLE sessions ADD INDEX idx_sessions_public_purpose_status_start \(session_purpose, visibility, status, start_at\)', 'SELECT 1' \);/i
  );
  assert.match(
    executableSql,
    /PREPARE session_purpose_index_statement FROM @session_purpose_index_sql; EXECUTE session_purpose_index_statement;/i
  );
  assert.doesNotMatch(executableSql, /UPDATE\s+sessions/i);
});

test("historical creation operation migration stores only scoped hashes and is readiness-critical", async () => {
  const sql = await readFile(
    new URL("../migrations/0034_historical_session_creation_operations.sql", import.meta.url),
    "utf8"
  );

  assert.match(sql, /CREATE TABLE IF NOT EXISTS historical_session_creation_operations/i);
  assert.match(sql, /organizer_user_id BIGINT UNSIGNED NOT NULL/i);
  assert.match(sql, /creation_key_hash BINARY\(32\) NOT NULL/i);
  assert.match(sql, /payload_hash BINARY\(32\) NOT NULL/i);
  assert.match(sql, /session_id BIGINT UNSIGNED NULL/i);
  assert.match(sql, /PRIMARY KEY \(organizer_user_id, creation_key_hash\)/i);
  assert.match(sql, /UNIQUE KEY uniq_historical_creation_session \(session_id\)/i);
  assert.match(sql, /FOREIGN KEY \(organizer_user_id\)[\s\S]*REFERENCES users\(id\)/i);
  assert.match(sql, /FOREIGN KEY \(session_id\)[\s\S]*REFERENCES sessions\(id\)/i);
  assert.doesNotMatch(sql, /raw_key|historical_creation_key VARCHAR|creation_key VARCHAR/i);
  assert.equal(
    requiredSchemaTables.includes("historical_session_creation_operations"),
    true
  );
});
