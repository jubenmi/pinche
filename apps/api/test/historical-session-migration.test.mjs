import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("historical-session migration adds a safe compatible purpose", async () => {
  const sql = await readFile(
    new URL("../migrations/0033_historical_session_backfill.sql", import.meta.url),
    "utf8"
  );
  const executableSql = sql.replace(/^--.*$/gm, "").replace(/''/g, "'");

  assert.match(
    executableSql,
    /session_purpose VARCHAR\(32\) NOT NULL DEFAULT 'future_carpool'/
  );
  assert.match(
    executableSql,
    /ADD INDEX idx_sessions_public_purpose_status_start \(session_purpose, visibility, status, start_at\)/
  );
  assert.doesNotMatch(executableSql, /UPDATE\s+sessions/i);
});
