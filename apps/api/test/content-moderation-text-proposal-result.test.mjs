import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("D45 text proposal replay persists only a nullable safe applied-result reference", async () => {
  const sql = await readFile(
    new URL("../migrations/0026_content_moderation_text_proposal_result.sql", import.meta.url),
    "utf8"
  );

  assert.match(
    sql,
    /ALTER TABLE content_moderation_text_proposals\s+ADD COLUMN(?: IF NOT EXISTS)? applied_result_json JSON NULL/i
  );
  assert.doesNotMatch(sql, /content_moderation_jobs\s+ADD COLUMN/i);
  assert.doesNotMatch(sql, /provider_job_id|access_token|media_url|object_key/i);
});
