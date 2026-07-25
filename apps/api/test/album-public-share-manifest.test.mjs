import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../migrations/0035_album_tag_public_share_read_model.sql",
  import.meta.url,
);
const migrationHistoryUrl = new URL(
  "../../../scripts/migration-filename-history.json",
  import.meta.url,
);

async function migrationSql() {
  return readFile(migrationUrl, "utf8").catch(() => "");
}

function shareItemTable(sql) {
  return sql.match(
    /CREATE TABLE session_album_public_share_items\s*\([\s\S]*?\)\s*ENGINE=InnoDB[^;]*;/,
  )?.[0] ?? "";
}

function shareItemBackfill(sql) {
  return sql.match(
    /INSERT IGNORE INTO session_album_public_share_items[\s\S]*?;/,
  )?.[0] ?? "";
}

test("migration creates an ordered unique public share manifest", async () => {
  const table = shareItemTable(await migrationSql());

  assert.match(table, /^CREATE TABLE session_album_public_share_items/);
  assert.match(table, /PRIMARY KEY \(share_id, ordinal\)/);
  assert.match(
    table,
    /UNIQUE KEY uniq_album_public_share_media \(share_id, media_id\)/,
  );
  assert.match(
    table,
    /FOREIGN KEY \(share_id\) REFERENCES session_album_public_shares\(id\)/,
  );
});

test("manifest deliberately keeps deleted media IDs as ordinal tombstones", async () => {
  const sql = await migrationSql();
  const table = shareItemTable(sql);
  const backfill = shareItemBackfill(sql);

  assert.doesNotMatch(
    table,
    /FOREIGN KEY \(media_id\)|REFERENCES session_album_photos\(id\)/,
  );
  assert.doesNotMatch(backfill, /JOIN session_album_photos/);
});

test("manifest backfill preserves JSON order and tolerates invalid historical JSON", async () => {
  const backfill = shareItemBackfill(await migrationSql());

  assert.match(backfill, /^INSERT IGNORE INTO session_album_public_share_items/);
  assert.match(backfill, /JSON_TABLE\s*\(/);
  assert.match(backfill, /FOR ORDINALITY/);
  assert.match(backfill, /ordinality\s*-\s*1/);
  assert.match(backfill, /JSON_VALID\s*\(\s*share\.media_ids\s*\)/);
  assert.match(backfill, /ELSE JSON_ARRAY\s*\(\s*\)/);
  assert.match(backfill, /ORDER BY share\.id,\s*expanded\.ordinality/);
});

test("manifest backfill is repeatable and keeps the first duplicate occurrence", async () => {
  const sql = await migrationSql();
  const backfill = shareItemBackfill(sql);

  assert.match(backfill, /^INSERT IGNORE INTO session_album_public_share_items/);
  assert.match(
    sql,
    /UNIQUE KEY uniq_album_public_share_media \(share_id, media_id\)/,
  );
  assert.match(backfill, /ORDER BY share\.id,\s*expanded\.ordinality/);
});

test("migration filename history appends migration 0035", async () => {
  const history = JSON.parse(await readFile(migrationHistoryUrl, "utf8"));

  assert.deepEqual(history.slice(-2), [
    "0034_schema_migration_checksums.sql",
    "0035_album_tag_public_share_read_model.sql",
  ]);
});
