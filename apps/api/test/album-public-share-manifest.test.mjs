import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { config } from "../src/config/env.js";

import {
  assertManifestMatchesLegacySnapshot,
  decodePublicShareOrdinalCursor,
  emitPublicShareManifestTelemetry,
  encodePublicShareOrdinalCursor,
  loadPublicShareItems,
  readPublicShareItemPage,
  writePublicShareItems,
} from "../src/modules/core/public-album-share-manifest.js";

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

function legacyOffsetCursor(shareId, offset) {
  const payload = Buffer.from(JSON.stringify({ share_id: shareId, offset }))
    .toString("base64url");
  const signature = crypto
    .createHmac("sha256", config.sessionSecret)
    .update(`album-share-page:${payload}`)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function shareItemTable(sql) {
  return sql.match(
    /CREATE TABLE IF NOT EXISTS session_album_public_share_items\s*\([\s\S]*?\)\s*ENGINE=InnoDB[^;]*;/,
  )?.[0] ?? "";
}

function shareItemBackfill(sql) {
  return sql.match(
    /INSERT INTO session_album_public_share_items[\s\S]*?;/,
  )?.[0] ?? "";
}

test("migration creates an ordered unique public share manifest", async () => {
  const table = shareItemTable(await migrationSql());

  assert.match(table, /^CREATE TABLE IF NOT EXISTS session_album_public_share_items/);
  assert.match(table, /PRIMARY KEY \(share_id, ordinal\)/);
  assert.match(
    table,
    /UNIQUE KEY uniq_album_public_share_media \(share_id, media_id\)/,
  );
  assert.match(
    table,
    /FOREIGN KEY \(share_id\) REFERENCES session_album_public_shares\(id\)\s+ON DELETE CASCADE/,
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

  assert.match(backfill, /^INSERT INTO session_album_public_share_items/);
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

  assert.match(backfill, /^INSERT INTO session_album_public_share_items/);
  assert.doesNotMatch(backfill, /INSERT IGNORE/);
  assert.match(
    sql,
    /UNIQUE KEY uniq_album_public_share_media \(share_id, media_id\)/,
  );
  assert.match(backfill, /ROW_NUMBER\s*\(\s*\)\s+OVER\s*\(/);
  assert.match(
    backfill,
    /PARTITION BY parsed\.share_id,\s*parsed\.media_id\s+ORDER BY parsed\.ordinality/,
  );
  assert.match(backfill, /candidate\.media_occurrence = 1/);
  assert.match(backfill, /existing_ordinal\.share_id IS NULL/);
  assert.match(backfill, /existing_media\.share_id IS NULL/);
  assert.match(backfill, /ORDER BY share\.id,\s*expanded\.ordinality/);
});

test("manifest backfill accepts only exact positive JSON integers in unsigned bigint range", async () => {
  const backfill = shareItemBackfill(await migrationSql());

  assert.match(backfill, /raw_media_id JSON PATH '\$'/);
  assert.match(
    backfill,
    /JSON_TYPE\s*\(\s*expanded\.raw_media_id\s*\)\s*=\s*'INTEGER'/,
  );
  assert.match(
    backfill,
    /JSON_UNQUOTE\s*\(\s*expanded\.raw_media_id\s*\)\s+REGEXP\s+'\^\[1-9\]\[0-9\]\{0,19\}\x24'/,
  );
  assert.match(backfill, /18446744073709551615/);
  assert.match(
    backfill,
    /CAST\s*\(\s*JSON_UNQUOTE\s*\(\s*expanded\.raw_media_id\s*\)\s+AS UNSIGNED\s*\)/,
  );
  assert.doesNotMatch(backfill, /\bBINARY\s+JSON_UNQUOTE/);
});

test("manifest telemetry emits only approved identifiers, counters, result code, and duration", () => {
  const events = [];
  emitPublicShareManifestTelemetry("public_share_manifest_page", {
    sessionId: 10,
    shareId: 50,
    requestedLimit: 30,
    returnedCount: 28,
    scannedCount: 30,
    resultCode: "SUCCESS",
    durationMs: 12.5,
    token: "TOKEN_CANARY",
    label: "LABEL_CANARY",
    url: "URL_CANARY",
  }, (line) => events.push(JSON.parse(line)));

  assert.deepEqual(events, [{
    event: "public_share_manifest_page",
    sessionId: 10,
    shareId: 50,
    requestedLimit: 30,
    returnedCount: 28,
    scannedCount: 30,
    resultCode: "SUCCESS",
    durationMs: 12.5,
  }]);

  emitPublicShareManifestTelemetry("public_share_manifest_membership_denied", {
    sessionId: 10,
    shareId: 50,
    requestedLimit: 1,
    returnedCount: 0,
    scannedCount: 1,
    resultCode: "OUTSIDE_MANIFEST",
    durationMs: 1,
    mediaId: 999,
    token: "TOKEN_CANARY",
  }, (line) => events.push(JSON.parse(line)));
  assert.deepEqual(events[1], {
    event: "public_share_manifest_membership_denied",
    sessionId: 10,
    shareId: 50,
    requestedLimit: 1,
    returnedCount: 0,
    scannedCount: 1,
    resultCode: "OUTSIDE_MANIFEST",
    durationMs: 1,
  });
});

test("migration filename history keeps migration 0035 before later migrations", async () => {
  const history = JSON.parse(await readFile(migrationHistoryUrl, "utf8"));

  assert.deepEqual(history.slice(-3), [
    "0035_album_tag_public_share_read_model.sql",
    "0036_historical_session_backfill.sql",
    "0037_historical_session_creation_operations.sql",
  ]);
});

test("writePublicShareItems validates the complete manifest before issuing ordered inserts", async () => {
  const queries = [];
  const connection = {
    async query(sql, values) {
      queries.push({ sql, values });
      return [{ affectedRows: 1 }];
    },
  };

  await writePublicShareItems(connection, 41, [9, 4, 7]);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].values, [
    41, 0, 9,
    41, 1, 4,
    41, 2, 7,
  ]);
  assert(queries.every(({ sql }) => sql.includes("session_album_public_share_items")));

  const lateDuplicate = Array.from({ length: 501 }, (_, index) => index + 1);
  lateDuplicate[500] = 1;
  for (const mediaIds of [
    [],
    [1, 1],
    [0],
    [-1],
    [1.5],
    ["1"],
    [Number.MAX_SAFE_INTEGER + 1],
    lateDuplicate,
  ]) {
    const before = queries.length;
    await assert.rejects(
      () => writePublicShareItems(connection, 41, mediaIds),
      (error) => error?.statusCode === 400,
    );
    assert.equal(queries.length, before, `invalid manifest ${JSON.stringify(mediaIds)} reached SQL`);
  }
});

test("writePublicShareItems uses fixed multi-row batches without changing ordinal order", async () => {
  const queries = [];
  const connection = {
    async query(sql, values) {
      queries.push({ sql, values });
      return [{ affectedRows: values.length / 3 }];
    },
  };
  const mediaIds = Array.from({ length: 1201 }, (_, index) => index + 10);

  await writePublicShareItems(connection, 41, mediaIds);

  assert.equal(queries.length, 3);
  assert.deepEqual(queries.map(({ values }) => values.length), [1500, 1500, 603]);
  assert.deepEqual(queries[0].values.slice(0, 6), [41, 0, 10, 41, 1, 11]);
  assert.deepEqual(queries[1].values.slice(0, 3), [41, 500, 510]);
  assert.deepEqual(queries[2].values.slice(-3), [41, 1200, 1210]);
  for (const { sql, values } of queries) {
    assert.equal(
      (sql.match(/\(\?, \?, \?\)/g) || []).length,
      values.length / 3,
    );
  }
});

test("loadPublicShareItems preserves stable ordinal order and rejects malformed database rows", async () => {
  const connection = {
    async query(sql, values) {
      assert.match(sql, /WHERE share_id = \?\s+ORDER BY ordinal/);
      assert.deepEqual(values, [41]);
      return [[
        { ordinal: 0, media_id: 9 },
        { ordinal: 2, media_id: 4 },
        { ordinal: 7, media_id: 8 },
      ]];
    },
  };

  assert.deepEqual(await loadPublicShareItems(connection, 41), [
    { ordinal: 0, media_id: 9 },
    { ordinal: 2, media_id: 4 },
    { ordinal: 7, media_id: 8 },
  ]);

  await assert.rejects(
    () => loadPublicShareItems({
      async query() {
        return [[{ ordinal: 0, media_id: "9" }]];
      },
    }, 41),
    (error) => error?.statusCode === 403,
  );
});

test("legacy JSON and normalized items must contain the exact same strict ID sequence", () => {
  const items = [
    { ordinal: 0, media_id: 4 },
    { ordinal: 1, media_id: 2 },
    { ordinal: 2, media_id: 9 },
  ];

  assert.doesNotThrow(() => assertManifestMatchesLegacySnapshot(items, "[4,2,9]"));
  for (const legacy of [
    "[4,9,2]",
    "[4,2]",
    "[4,2,9,9]",
    "[4,\"2\",9]",
    "[4,2.5,9]",
    "[4,0,9]",
    "not-json",
  ]) {
    assert.throws(
      () => assertManifestMatchesLegacySnapshot(items, legacy),
      (error) => error?.statusCode === 403,
      legacy,
    );
  }
  assert.throws(
    () => assertManifestMatchesLegacySnapshot([
      { ordinal: 0, media_id: 4 },
      { ordinal: 2, media_id: 2 },
      { ordinal: 3, media_id: 9 },
    ], [4, 2, 9]),
    (error) => error?.statusCode === 403,
  );
});

test("ordinal cursors are signed, share-bound, tamper-proof, and range-checked", () => {
  const cursor = encodePublicShareOrdinalCursor(41, 7);
  assert.match(cursor, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(
    decodePublicShareOrdinalCursor(cursor, 41, { maxOrdinal: 9 }),
    7,
  );
  const payload = JSON.parse(
    Buffer.from(cursor.split(".")[0], "base64url").toString("utf8"),
  );
  assert.deepEqual(payload, { share_id: 41, after_ordinal: 7 });
  assert.throws(
    () => decodePublicShareOrdinalCursor(cursor, 42, { maxOrdinal: 9 }),
    (error) => error?.statusCode === 400,
  );
  assert.throws(
    () => decodePublicShareOrdinalCursor(`${cursor.slice(0, -1)}x`, 41, { maxOrdinal: 9 }),
    (error) => error?.statusCode === 400,
  );
  assert.throws(
    () => decodePublicShareOrdinalCursor(cursor, 41, { maxOrdinal: 6 }),
    (error) => error?.statusCode === 400,
  );
});

test("legacy offset cursors map to the same share ordinal only within the live manifest", () => {
  assert.equal(
    decodePublicShareOrdinalCursor(legacyOffsetCursor(41, 3), 41, {
      maxOrdinal: 8,
      manifestLength: 9,
    }),
    2,
  );
  for (const [cursor, shareId] of [
    [legacyOffsetCursor(41, 0), 41],
    [legacyOffsetCursor(41, 9), 41],
    [legacyOffsetCursor(41, 3), 42],
  ]) {
    assert.throws(
      () => decodePublicShareOrdinalCursor(cursor, shareId, {
        maxOrdinal: 8,
        manifestLength: 9,
      }),
      (error) => error?.statusCode === 400,
    );
  }
});

test("readPublicShareItemPage scans after an ordinal with a bounded SQL limit", async () => {
  const connection = {
    async query(sql, values) {
      assert.match(sql, /ordinal > \?/);
      assert.match(sql, /ORDER BY ordinal/);
      assert.match(sql, /LIMIT \?/);
      assert.deepEqual(values, [41, 2, 3]);
      return [[
        { ordinal: 5, media_id: 8 },
        { ordinal: 6, media_id: 3 },
        { ordinal: 9, media_id: 7 },
      ]];
    },
  };

  assert.deepEqual(
    await readPublicShareItemPage(connection, 41, { afterOrdinal: 2, limit: 3 }),
    {
      items: [
        { ordinal: 5, media_id: 8 },
        { ordinal: 6, media_id: 3 },
        { ordinal: 9, media_id: 7 },
      ],
      lastScannedOrdinal: 9,
    },
  );
});
