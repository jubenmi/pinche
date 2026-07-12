import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../migrations/0024_content_moderation.sql", import.meta.url);

test("D45 migration creates moderation jobs, text proposals, audit logs, and media gate", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /CREATE TABLE content_moderation_jobs/i);
  assert.match(sql, /CREATE TABLE content_moderation_text_proposals/i);
  assert.match(sql, /CREATE TABLE content_moderation_audit_logs/i);
  assert.match(sql, /UNIQUE KEY uniq_moderation_subject_version/i);
  assert.match(sql, /UNIQUE KEY uniq_moderation_data_id/i);
  assert.match(sql, /lease_token VARCHAR\(64\)/i);
  assert.match(sql, /ALTER TABLE session_album_photos/i);
  assert.match(sql, /moderation_status VARCHAR\(32\) NOT NULL DEFAULT 'approved_legacy'/i);
  assert.match(sql, /idx_album_moderation/i);
  assert.match(sql, /ALTER TABLE session_album_object_cleanup_jobs/i);
  assert.match(sql, /object_urls_json JSON NULL/i);
  assert.doesNotMatch(sql, /UPDATE session_album_photos SET moderation_status = 'pending'/i);
});

test("every new album image and video path explicitly starts moderation pending", async () => {
  const service = await readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8");
  const insertStatements = [...service.matchAll(/INSERT INTO session_album_photos[\s\S]*?VALUES\s*\([\s\S]*?\)/g)]
    .map((match) => match[0]);

  assert.equal(insertStatements.length, 3);
  for (const statement of insertStatements) {
    assert.match(statement, /moderation_status/);
    assert.match(statement, /'pending'/);
  }
});
