import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as albumTagModel from "../src/modules/core/album-tags.js";
import {
  listAlbumTagOptions,
  normalizeAlbumTagKeys,
  resolveAlbumTagPrivacySubjects,
  resolveAlbumTags,
  writeAlbumMediaTags,
} from "../src/modules/core/album-tags.js";
import { isAlbumPhotoVisibleInPublicShare } from "../src/modules/core/service.js";

const migrationUrl = new URL(
  "../migrations/0035_album_tag_public_share_read_model.sql",
  import.meta.url,
);

async function migrationSql() {
  return readFile(migrationUrl, "utf8").catch(() => "");
}

async function serviceSource() {
  return readFile(
    new URL("../src/modules/core/service.js", import.meta.url),
    "utf8",
  );
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

test("migration preparer atomically reconciles the legacy photo FK", async () => {
  const sql = await migrationSql();
  const { prepareAlbumTagMigration } = await import(
    "../src/modules/core/album-tags-migration.js"
  );
  const migrationFilename = "0035_album_tag_public_share_read_model.sql";
  const legacyConnectionCalls = [];
  const legacyConnection = {
    async query(statement, params = []) {
      legacyConnectionCalls.push({ statement, params });
      if (statement.includes("information_schema.key_column_usage")) {
        return [[{
          constraint_name: "fk_session_album_photo_tags_photo",
          column_name: "photo_id",
          referenced_table_name: "session_album_photos",
          referenced_column_name: "id",
          delete_rule: "NO ACTION",
        }]];
      }
      if (statement.startsWith("ALTER TABLE")) return [{ affectedRows: 0 }];
      throw new Error(`Unexpected SQL: ${statement}`);
    },
  };

  assert.deepEqual(
    await prepareAlbumTagMigration(legacyConnection, migrationFilename),
    { skipStatements: false, reconciledLegacyPhotoForeignKey: true },
  );
  assert.equal(legacyConnectionCalls.length, 2);
  assert.match(
    legacyConnectionCalls[1].statement,
    /ALTER TABLE session_album_photo_tags[\s\S]*DROP FOREIGN KEY fk_session_album_photo_tags_photo,[\s\S]*ADD CONSTRAINT fk_session_album_photo_tags_photo_cascade[\s\S]*FOREIGN KEY \(photo_id\)[\s\S]*REFERENCES session_album_photos\(id\)[\s\S]*ON DELETE CASCADE/,
  );
  assert.doesNotMatch(sql, /legacy_photo_fk|PREPARE|DROP FOREIGN KEY/);
});

test("album tag migration preparer accepts cascade and restores a missing FK", async () => {
  const { prepareAlbumTagMigration } = await import(
    "../src/modules/core/album-tags-migration.js"
  );
  const migrationFilename = "0035_album_tag_public_share_read_model.sql";
  for (const [rows, expectedDdl] of [
    [[{
      constraint_name: "fk_session_album_photo_tags_photo_cascade",
      column_name: "photo_id",
      referenced_table_name: "session_album_photos",
      referenced_column_name: "id",
      delete_rule: "CASCADE",
    }], null],
    [[], /ADD CONSTRAINT fk_session_album_photo_tags_photo_cascade/],
  ]) {
    const calls = [];
    const connection = {
      async query(statement) {
        calls.push(statement);
        if (statement.includes("information_schema.key_column_usage")) {
          return [rows];
        }
        if (statement.startsWith("ALTER TABLE")) return [{ affectedRows: 0 }];
        throw new Error(`Unexpected SQL: ${statement}`);
      },
    };

    assert.deepEqual(
      await prepareAlbumTagMigration(connection, migrationFilename),
      { skipStatements: false, reconciledLegacyPhotoForeignKey: true },
    );
    if (expectedDdl) {
      assert.equal(calls.length, 2);
      assert.match(calls[1], expectedDdl);
      assert.doesNotMatch(calls[1], /DROP FOREIGN KEY/);
    } else {
      assert.equal(calls.length, 1);
    }
  }
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

test("normalizes canonical and legacy role, npc role, and other keys and rejects duplicates", () => {
  assert.deepEqual(
    normalizeAlbumTagKeys(["role:12", "npc-role:8", "other"]),
    [
      { kind: "role", refId: 12, key: "role:12" },
      { kind: "npc_role", refId: 8, key: "npc-role:8" },
      { kind: "other", refId: null, key: "other" },
    ],
  );

  assert.deepEqual(
    normalizeAlbumTagKeys(["seat:12", "session-npc:8", "other:session"]),
    [
      { kind: "role", refId: 12, key: "role:12" },
      { kind: "npc_role", refId: 8, key: "npc-role:8" },
      { kind: "other", refId: null, key: "other" },
    ],
  );

  for (const invalid of [
    "dm:session",
    "npc:session",
    "organizer:session",
    "role:0",
    "role:9007199254740992",
  ]) {
    assert.throws(
      () => normalizeAlbumTagKeys([invalid]),
      /invalid album tag/i,
      invalid,
    );
  }
  assert.throws(
    () => normalizeAlbumTagKeys(["role:12", " role:12 "]),
    /unique/i,
  );
  assert.throws(
    () => normalizeAlbumTagKeys(["other", "other"]),
    /unique/i,
  );
  assert.throws(
    () => normalizeAlbumTagKeys(["other", "other:session"]),
    /unique/i,
  );
});

test("lists every canonical seat role, npc role, and other option without account fields", async () => {
  const sqlCalls = [];
  const connection = {
    async query(sql, params) {
      sqlCalls.push({ sql, params });
      if (sql.includes("FROM session_seats")) {
        return [[
          { id: 12, role_name: "  沈清商  ", name: "旧座位名" },
          { id: 13, role_name: "   ", name: "顾南衣" },
          { id: 14, role_name: "", name: "" },
        ]];
      }
      if (sql.includes("FROM session_npc_roles")) {
        return [[
          { id: 8, name: "  阿离  " },
          { id: 9, name: " " },
        ]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const options = await listAlbumTagOptions(connection, 77);

  assert.deepEqual(options, [
    { key: "role:12", kind: "role", ref_id: 12, label: "沈清商" },
    { key: "role:13", kind: "role", ref_id: 13, label: "顾南衣" },
    { key: "npc-role:8", kind: "npc_role", ref_id: 8, label: "阿离" },
    { key: "other", kind: "other", ref_id: null, label: "其他" },
  ]);
  assert.equal(sqlCalls.length, 2);
  assert.deepEqual(sqlCalls.map((call) => call.params), [[77], [77]]);
  const contract = JSON.stringify(options);
  assert.doesNotMatch(contract, /user|nickname|open_id|account|tag_type/);
  assert.doesNotMatch(sqlCalls[0].sql, /seat\.status|status IN \('confirmed', 'locked'\)/);
  assert.match(sqlCalls[1].sql, /status = 'active'/);
});

test("accepts every same-session seat role regardless of claim status", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT media.id")) return [[{ id: 41 }]];
      if (sql.includes("FROM session_seats")) return [[{ id: 12 }, { id: 13 }]];
      if (sql.startsWith("DELETE FROM")) return [{ affectedRows: 0 }];
      if (sql.includes("INSERT INTO")) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  await writeAlbumMediaTags(connection, {
    mediaId: 41,
    sessionId: 77,
    normalizedTags: [
      { key: "role:12" },
      { key: "role:13" },
    ],
  });

  const seatLookup = calls.find((call) => call.sql.includes("FROM session_seats"));
  assert.ok(seatLookup);
  assert.doesNotMatch(
    seatLookup.sql,
    /status IN \('confirmed', 'locked'\)/,
  );
});

test("resolves latest canonical labels into a safe DTO and ignores polluted stored text", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[
        {
          media_id: 41,
          kind: "role",
          seat_id: 12,
          session_npc_role_id: null,
          canonical_label: "  新角色名  ",
          label: "旧自由文本",
          user_id: 999,
          nickname: "玩家昵称",
        },
        {
          media_id: 41,
          kind: "npc_role",
          seat_id: null,
          session_npc_role_id: 8,
          canonical_label: "  新 NPC 名  ",
        },
        {
          media_id: 41,
          kind: "other",
          seat_id: null,
          session_npc_role_id: null,
          canonical_label: "不应读取",
        },
        {
          media_id: 42,
          kind: "role",
          seat_id: 13,
          session_npc_role_id: null,
          canonical_label: "   ",
          label: "不得回退的旧角色名",
        },
      ]];
    },
  };

  const tagsByMediaId = await resolveAlbumTags(connection, 77, [41, 42]);

  assert.deepEqual(tagsByMediaId, new Map([
    [41, [
      { kind: "role", ref_id: 12, label: "新角色名" },
      { kind: "npc_role", ref_id: 8, label: "新 NPC 名" },
      { kind: "other", ref_id: null, label: "其他" },
    ]],
  ]));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [77, 41, 42]);
  assert.match(calls[0].sql, /FROM session_album_media_tags/);
  assert.match(calls[0].sql, /JOIN session_album_photos/);
  assert.match(calls[0].sql, /seat\.session_id = media\.session_id/);
  assert.doesNotMatch(
    calls[0].sql,
    /seat\.status|status IN \('confirmed', 'locked'\)/,
  );
  assert.match(calls[0].sql, /npc_role\.session_id = media\.session_id/);
  assert.doesNotMatch(
    calls[0].sql,
    /\busers\b|\bnickname\b|\bopen_id\b|legacy\.label|session_album_photo_tags/i,
  );
  assert.equal(JSON.stringify(tagsByMediaId).includes("玩家昵称"), false);
});

test("resolves privacy users separately from display tags", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[
        { media_id: 41, privacy_user_id: 101 },
        { media_id: 41, privacy_user_id: 101 },
        { media_id: 41, privacy_user_id: 202 },
        { media_id: 42, privacy_user_id: null },
      ]];
    },
  };

  const subjects = await resolveAlbumTagPrivacySubjects(
    connection,
    77,
    [41, 42],
  );

  assert.deepEqual(subjects, new Map([
    [41, [101, 202]],
    [42, []],
  ]));
  assert.match(calls[0].sql, /seat\.confirmed_user_id/);
  assert.match(calls[0].sql, /npc_role\.bound_user_id/);
  assert.match(calls[0].sql, /seat\.session_id = media\.session_id/);
  assert.match(calls[0].sql, /npc_role\.session_id = media\.session_id/);
  assert.doesNotMatch(calls[0].sql, /\busers\b|\bnickname\b|\bopen_id\b/i);
});

test("one tag read snapshot keeps NPC display and privacy denial inseparable", async () => {
  const row = {
    media_id: 41,
    kind: "npc_role",
    seat_id: null,
    session_npc_role_id: 8,
    canonical_label: "阿离",
    privacy_user_id: 202,
  };
  let splitQueryCount = 0;
  const splitConnection = {
    async query() {
      splitQueryCount += 1;
      return splitQueryCount === 1 ? [[row]] : [[]];
    },
  };
  const splitTags = await resolveAlbumTags(splitConnection, 77, [41]);
  const splitSubjects = await resolveAlbumTagPrivacySubjects(
    splitConnection,
    77,
    [41],
  );
  const photo = {
    id: 41,
    session_id: 77,
    uploader_user_id: 100,
    status: "active",
    moderation_status: "approved",
    media_type: "image",
  };
  const claims = { sessionId: 77, sharerUserId: 100, seatId: 12 };
  const privacyByUser = new Map([
    [100, { allow_uploaded_visible: true, allow_tagged_visible: true }],
    [202, { allow_uploaded_visible: true, allow_tagged_visible: false }],
  ]);

  assert.equal(
    isAlbumPhotoVisibleInPublicShare(
      photo,
      splitTags.get(41),
      privacyByUser,
      claims,
      {},
      splitSubjects.get(41),
    ),
    false,
    "the authorization API rejects the former split-read arguments",
  );

  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[row]];
    },
  };
  const context = await albumTagModel.resolveAlbumTagReadContext(
    connection,
    77,
    [41],
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [77, 41]);
  assert.match(calls[0].sql, /AS canonical_label/);
  assert.match(calls[0].sql, /AS privacy_user_id/);
  assert.deepEqual(context.tagsByMediaId.get(41), [
    { kind: "npc_role", ref_id: 8, label: "阿离" },
  ]);
  assert.deepEqual(context.privacySubjectsByMediaId.get(41), [202]);
  assert.deepEqual(
    Object.keys(context.tagsByMediaId.get(41)[0]).sort(),
    ["kind", "label", "ref_id"],
  );
  assert.equal(
    isAlbumPhotoVisibleInPublicShare(photo, context, privacyByUser, claims),
    false,
  );
  assert.equal(
    isAlbumPhotoVisibleInPublicShare(
      photo,
      { tagsByMediaId: context.tagsByMediaId },
      privacyByUser,
      claims,
    ),
    false,
    "a caller cannot omit the privacy-subject projection",
  );
});

test("one tag read snapshot drops both projections when the role is inactive", async () => {
  let queryCount = 0;
  const context = await albumTagModel.resolveAlbumTagReadContext(
    {
      async query() {
        queryCount += 1;
        return [[]];
      },
    },
    77,
    [41],
  );

  assert.equal(queryCount, 1);
  assert.deepEqual(context.tagsByMediaId.get(41), []);
  assert.deepEqual(context.privacySubjectsByMediaId.get(41), []);
});

test("service visibility context uses only the combined tag resolver", async () => {
  const source = await serviceSource();
  const contextFunction = source.match(
    /async function resolveAlbumTagContext[\s\S]*?\n}\n\nfunction isAlbumTagInPersonalScope/,
  )?.[0] ?? "";

  assert.match(contextFunction, /resolveAlbumTagReadContext/);
  assert.doesNotMatch(
    contextFunction,
    /resolveAlbumTags|resolveAlbumTagPrivacySubjects/,
  );
});

test("writes only validated same-session normalized references", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM session_album_photos")) return [[{ id: 41 }]];
      if (sql.includes("FROM session_seats")) return [[{ id: 12 }]];
      if (sql.includes("FROM session_npc_roles")) return [[{ id: 8 }]];
      if (sql.startsWith("DELETE ")) return [{ affectedRows: 0 }];
      if (sql.includes("INSERT INTO session_album_media_tags")) {
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const normalizedTags = normalizeAlbumTagKeys([
    "role:12",
    "npc-role:8",
    "other",
  ]);

  await writeAlbumMediaTags(connection, {
    mediaId: 41,
    sessionId: 77,
    normalizedTags,
  });

  assert.equal(
    calls.filter((call) => call.sql.includes("INSERT INTO session_album_media_tags")).length,
    3,
  );
  assert.deepEqual(
    calls
      .filter((call) => call.sql.includes("INSERT INTO session_album_media_tags"))
      .map((call) => call.params),
    [
      [41, "role", 12, null, 0],
      [41, "npc_role", null, 8, 1],
      [41, "other", null, null, 2],
    ],
  );
  const writeSql = calls.map((call) => call.sql).join("\n");
  assert.doesNotMatch(
    writeSql,
    /session_album_photo_tags|\blabel\b|\buser_id\b|\bnickname\b|\bopen_id\b/i,
  );
});

test("rejects a role reference outside the media session before replacing tags", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM session_album_photos")) return [[{ id: 41 }]];
      if (sql.includes("FROM session_seats")) return [[]];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  await assert.rejects(
    writeAlbumMediaTags(connection, {
      mediaId: 41,
      sessionId: 77,
      normalizedTags: normalizeAlbumTagKeys(["role:12"]),
    }),
    /invalid album tag reference/i,
  );
  assert.equal(
    calls.some((call) => call.sql.startsWith("DELETE ")),
    false,
  );
});
