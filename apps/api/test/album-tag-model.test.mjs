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
    /INSERT IGNORE INTO session_album_media_tags[\s\S]*?;\s*(?=INSERT IGNORE INTO session_album_public_share_items)/,
  )?.[0] ?? "";
}

test("migration creates normalized album tags with exclusive role references", async () => {
  const sql = await migrationSql();

  assert.match(sql, /CREATE TABLE session_album_media_tags\s*\(/);
  assert.match(sql, /kind VARCHAR\(32\) NOT NULL/);
  assert.match(sql, /subject_ref_id BIGINT UNSIGNED\s+GENERATED ALWAYS AS\s*\(/);
  assert.match(sql, /CONSTRAINT chk_album_media_tag_shape CHECK\s*\(/);
  assert.match(
    sql,
    /kind = 'role' AND seat_id IS NOT NULL AND session_npc_role_id IS NULL/,
  );
  assert.match(
    sql,
    /kind = 'npc_role' AND seat_id IS NULL AND session_npc_role_id IS NOT NULL/,
  );
  assert.match(
    sql,
    /kind = 'other' AND seat_id IS NULL AND session_npc_role_id IS NULL/,
  );
  assert.match(
    sql,
    /UNIQUE KEY uniq_album_media_tag_subject \(media_id, kind, subject_ref_id\)/,
  );
  assert.match(
    sql,
    /FOREIGN KEY \(media_id\) REFERENCES session_album_photos\(id\)/,
  );
  assert.match(sql, /FOREIGN KEY \(seat_id\) REFERENCES session_seats\(id\)/);
  assert.match(
    sql,
    /FOREIGN KEY \(session_npc_role_id\) REFERENCES session_npc_roles\(id\)/,
  );
});

test("tag backfill accepts only trusted same-session role references and other", async () => {
  const backfill = tagBackfill(await migrationSql());

  assert.match(backfill, /^INSERT IGNORE INTO session_album_media_tags/);
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
    /\(legacy\.tag_type = 'seat' AND seat\.id IS NOT NULL\)[\s\S]*\(legacy\.tag_type = 'session_npc_role' AND npc_role\.id IS NOT NULL\)[\s\S]*legacy\.tag_type = 'other'/,
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

  assert.match(backfill, /^INSERT IGNORE INTO session_album_media_tags/);
  assert.match(
    sql,
    /UNIQUE KEY uniq_album_media_tag_subject \(media_id, kind, subject_ref_id\)/,
  );
});
