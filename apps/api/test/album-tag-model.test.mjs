import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../migrations/0035_album_tag_public_share_read_model.sql",
  import.meta.url,
);

async function migrationSql() {
  return readFile(migrationUrl, "utf8").catch(() => "");
}

function tagBackfill(sql) {
  return sql.match(
    /INSERT INTO session_album_media_tags[\s\S]*?;\s*(?=INSERT INTO session_album_public_share_items)/,
  )?.[0] ?? "";
}

test("migration creates normalized album tags with exclusive role references", async () => {
  const sql = await migrationSql();

  assert.match(sql, /CREATE TABLE IF NOT EXISTS session_album_media_tags\s*\(/);
  assert.match(
    sql,
    /kind VARCHAR\(32\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/,
  );
  assert.match(sql, /subject_ref_id BIGINT UNSIGNED\s+GENERATED ALWAYS AS\s*\(/);
  assert.match(sql, /CONSTRAINT chk_album_media_tag_shape CHECK\s*\(/);
  assert.match(
    sql,
    /CAST\(kind AS BINARY\) = CAST\('role' AS BINARY\)\s+AND seat_id IS NOT NULL\s+AND session_npc_role_id IS NULL/,
  );
  assert.match(
    sql,
    /CAST\(kind AS BINARY\) = CAST\('npc_role' AS BINARY\)\s+AND seat_id IS NULL\s+AND session_npc_role_id IS NOT NULL/,
  );
  assert.match(
    sql,
    /CAST\(kind AS BINARY\) = CAST\('other' AS BINARY\)\s+AND seat_id IS NULL\s+AND session_npc_role_id IS NULL/,
  );
  assert.match(
    sql,
    /UNIQUE KEY uniq_album_media_tag_subject \(media_id, kind, subject_ref_id\)/,
  );
  assert.match(
    sql,
    /FOREIGN KEY \(media_id\) REFERENCES session_album_photos\(id\)\s+ON DELETE CASCADE/,
  );
  assert.match(
    sql,
    /FOREIGN KEY \(seat_id\) REFERENCES session_seats\(id\)\s+ON DELETE RESTRICT/,
  );
  assert.match(
    sql,
    /FOREIGN KEY \(session_npc_role_id\) REFERENCES session_npc_roles\(id\)\s+ON DELETE RESTRICT/,
  );
});

test("database kind checks use byte-exact comparisons for case and whitespace", async () => {
  const sql = await migrationSql();
  const check = sql.match(
    /CONSTRAINT chk_album_media_tag_shape CHECK\s*\([\s\S]*?\n  \),/,
  )?.[0] ?? "";

  assert.match(check, /CAST\(kind AS BINARY\) = CAST\('role' AS BINARY\)/);
  assert.match(check, /CAST\(kind AS BINARY\) = CAST\('npc_role' AS BINARY\)/);
  assert.match(check, /CAST\(kind AS BINARY\) = CAST\('other' AS BINARY\)/);
  assert.doesNotMatch(check, /(?<!\)) kind = '(?:role|npc_role|other)'/);
});

test("table creation can resume after either DDL statement already succeeded", async () => {
  const sql = await migrationSql();

  assert.match(sql, /CREATE TABLE IF NOT EXISTS session_album_media_tags/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS session_album_public_share_items/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE TABLE/);
});

test("tag backfill accepts only trusted same-session role references and other", async () => {
  const backfill = tagBackfill(await migrationSql());

  assert.match(backfill, /^INSERT INTO session_album_media_tags/);
  assert.match(
    backfill,
    /JOIN session_album_photos media ON media\.id = legacy\.photo_id/,
  );
  assert.match(
    backfill,
    /seat\.id = legacy\.seat_id\s+AND seat\.session_id = media\.session_id/,
  );
  assert.match(
    backfill,
    /npc_role\.id = legacy\.session_npc_role_id\s+AND npc_role\.session_id = media\.session_id/,
  );
  assert.match(
    backfill,
    /CAST\(legacy\.tag_type AS BINARY\)\s*=\s*CAST\('seat' AS BINARY\)[\s\S]*CAST\(legacy\.tag_type AS BINARY\)\s*=\s*CAST\('session_npc_role' AS BINARY\)[\s\S]*CAST\(legacy\.tag_type AS BINARY\)\s*=\s*CAST\('other' AS BINARY\)/,
  );
  assert.doesNotMatch(
    backfill,
    /legacy\.label|\busers\b|\buser_id\b|\bopen_id\b|\bnickname\b/,
  );
  assert.doesNotMatch(
    backfill,
    /legacy\.tag_type\s*=\s*'(?:dm|npc|organizer)'/,
  );
});

test("tag backfill is repeatable without duplicating normalized subjects", async () => {
  const sql = await migrationSql();
  const backfill = tagBackfill(sql);

  assert.match(backfill, /^INSERT INTO session_album_media_tags/);
  assert.match(
    sql,
    /UNIQUE KEY uniq_album_media_tag_subject \(media_id, kind, subject_ref_id\)/,
  );
  assert.match(backfill, /MIN\s*\(\s*trusted\.sort_order\s*\)/);
  assert.match(backfill, /GROUP BY[\s\S]*trusted\.media_id[\s\S]*trusted\.kind/);
  assert.match(
    backfill,
    /ON DUPLICATE KEY UPDATE[\s\S]*sort_order\s*=\s*LEAST\s*\(/,
  );
  assert.doesNotMatch(backfill, /VALUES\s*\(\s*sort_order\s*\)/);
});
