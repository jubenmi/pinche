import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { requiredSchemaTables } from "../src/db/mysql.js";

test("album image migration has durable intent and cleanup anchors", async () => {
  const sql = await readFile(
    new URL("../migrations/0023_album_media_cos_direct.sql", import.meta.url),
    "utf8"
  );

  assert.match(sql, /ADD COLUMN object_key VARCHAR\(512\) NULL/);
  assert.match(sql, /ADD COLUMN object_etag VARCHAR\(128\) NULL/);
  assert.match(sql, /UNIQUE KEY uniq_session_album_photos_object_key \(object_key\)/);
  assert.match(sql, /CREATE TABLE session_album_upload_intents/);
  assert.match(sql, /UNIQUE KEY uniq_album_upload_intents_object_key \(object_key\)/);
  assert.match(sql, /UNIQUE KEY uniq_album_upload_intents_media_id \(media_id\)/);
  assert.match(sql, /FOREIGN KEY \(media_id\).*ON DELETE SET NULL/s);
  assert.match(sql, /idx_album_upload_intents_cleanup \(status, cleanup_not_before, next_retry_at\)/);
  assert.match(sql, /idx_album_upload_intents_user_created \(user_id, created_at\)/);

  assert.match(sql, /CREATE TABLE session_album_object_cleanup_jobs/);
  assert.match(sql, /lease_token CHAR\(36\) NULL/);
  assert.match(sql, /lease_expires_at DATETIME NULL/);
  assert.match(sql, /UNIQUE KEY uniq_album_object_cleanup_media \(media_id\)/);
  assert.match(sql, /fk_album_upload_intents_session[\s\S]*ON DELETE SET NULL/);
  assert.match(sql, /fk_album_object_cleanup_session[\s\S]*ON DELETE SET NULL/);

  assert.deepEqual(
    requiredSchemaTables.filter((name) => name.startsWith("session_album_")),
    ["session_album_upload_intents", "session_album_object_cleanup_jobs"]
  );
});
