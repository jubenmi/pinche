import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
