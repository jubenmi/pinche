import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("D45 text proposal result migration delegates MySQL-compatible reconciliation to the migration runner", async () => {
  const sql = await readFile(
    new URL("../migrations/0026_content_moderation_text_proposal_result.sql", import.meta.url),
    "utf8"
  );

  assert.match(sql, /reconciled by prepareMigration/i);
  assert.match(sql, /SELECT 1/i);
  assert.doesNotMatch(sql, /ALTER TABLE|ADD COLUMN IF NOT EXISTS/i);
  assert.doesNotMatch(sql, /content_moderation_jobs\s+ADD COLUMN/i);
  assert.doesNotMatch(sql, /provider_job_id|access_token|media_url|object_key/i);
});
