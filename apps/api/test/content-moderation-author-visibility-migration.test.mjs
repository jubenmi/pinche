import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { applyMigration } from "../src/db/migrate.js";
import {
  AUTHOR_PRIVATE_CONTENT_VISIBILITY_MIGRATION,
  prepareMigration,
  reconcileAuthorPrivateContentVisibility
} from "../src/modules/album-video/migration.js";

const migrationUrl = new URL(
  "../migrations/0030_author_private_content_visibility.sql",
  import.meta.url
);

const expectedProposalColumns = Object.freeze({
  target_subject_id: {
    column_type: "varchar(128)",
    is_nullable: "YES",
    column_default: null,
    extra: "",
    generation_expression: ""
  },
  author_visibility_version: {
    column_type: "smallint unsigned",
    is_nullable: "NO",
    column_default: "0",
    extra: "",
    generation_expression: ""
  },
  cancelled_at: {
    column_type: "datetime",
    is_nullable: "YES",
    column_default: null,
    extra: "",
    generation_expression: ""
  },
  superseded_by_proposal_id: {
    column_type: "bigint unsigned",
    is_nullable: "YES",
    column_default: null,
    extra: "",
    generation_expression: ""
  }
});

const expectedAlbumColumns = Object.freeze({
  author_visibility_version: expectedProposalColumns.author_visibility_version
});

function column(column_name, column_type, is_nullable, {
  column_default = null,
  extra = "",
  generation_expression = ""
} = {}) {
  return {
    column_name,
    column_type,
    is_nullable,
    column_default,
    extra,
    generation_expression
  };
}

function authorVisibilityMigrationConnection({
  includeD46 = false,
  malformedColumn = null,
  failMigrationRecordOnce = false
} = {}) {
  const calls = [];
  const columns = {
    content_moderation_text_proposals: new Map([
      ["id", column("id", "bigint unsigned", "NO", { extra: "auto_increment" })],
      ["subject_id", column("subject_id", "varchar(128)", "NO")],
      ["action", column("action", "varchar(64)", "NO")],
      ["status", column("status", "varchar(32)", "NO", { column_default: "pending" })],
      ["created_by_user_id", column("created_by_user_id", "bigint unsigned", "NO")],
      ["applied_result_json", column("applied_result_json", "json", "YES")],
      ["updated_at", column("updated_at", "datetime", "NO", {
        column_default: "CURRENT_TIMESTAMP",
        extra: "DEFAULT_GENERATED on update CURRENT_TIMESTAMP"
      })]
    ]),
    session_album_photos: new Map([
      ["id", column("id", "bigint unsigned", "NO", { extra: "auto_increment" })],
      ["moderation_object_version", column("moderation_object_version", "varchar(128)", "YES")]
    ])
  };
  if (includeD46) {
    for (const [name, shape] of Object.entries(expectedProposalColumns)) {
      columns.content_moderation_text_proposals.set(name, column(name, shape.column_type, shape.is_nullable, shape));
    }
    for (const [name, shape] of Object.entries(expectedAlbumColumns)) {
      columns.session_album_photos.set(name, column(name, shape.column_type, shape.is_nullable, shape));
    }
  }
  if (malformedColumn) {
    const [tableName, columnName, override] = malformedColumn;
    const baseline = columns[tableName].get(columnName) || column(
      columnName,
      expectedProposalColumns[columnName]?.column_type || "varchar(255)",
      expectedProposalColumns[columnName]?.is_nullable || "YES"
    );
    columns[tableName].set(columnName, { ...baseline, ...override });
  }
  let indexExists = includeD46;
  let foreignKeyExists = includeD46;
  let shouldFailRecord = failMigrationRecordOnce;

  const connection = {
    calls,
    columns,
    async beginTransaction() {
      calls.push({ sql: "BEGIN", params: [] });
    },
    async commit() {
      calls.push({ sql: "COMMIT", params: [] });
    },
    async rollback() {
      calls.push({ sql: "ROLLBACK", params: [] });
    },
    async query(sql, params = []) {
      const text = String(sql).trim();
      calls.push({ sql: text, params });
      if (text.includes("information_schema.columns")) {
        const tableName = params[0];
        return [[...columns[tableName].values()]];
      }
      if (text.includes("information_schema.statistics")) {
        if (!indexExists) return [[]];
        return [[
          "created_by_user_id",
          "action",
          "target_subject_id",
          "status",
          "updated_at"
        ].map((column_name, offset) => ({
          non_unique: 1,
          column_name,
          seq_in_index: offset + 1,
          sub_part: null,
          collation: "A",
          index_type: "BTREE",
          expression: null
        }))];
      }
      if (text.includes("information_schema.key_column_usage")) {
        return [foreignKeyExists ? [{
          constraint_name: "fk_moderation_text_superseded_by",
          column_name: "superseded_by_proposal_id",
          ordinal_position: 1,
          referenced_same_schema: 1,
          referenced_table_name: "content_moderation_text_proposals",
          referenced_column_name: "id",
          delete_rule: "SET NULL",
          update_rule: "NO ACTION"
        }] : []];
      }
      const addColumn = text.match(
        /^ALTER TABLE (content_moderation_text_proposals|session_album_photos)\s+ADD COLUMN ([a-z_]+)/i
      );
      if (addColumn) {
        const [, tableName, columnName] = addColumn;
        const shapes = tableName === "session_album_photos"
          ? expectedAlbumColumns
          : expectedProposalColumns;
        const shape = shapes[columnName];
        columns[tableName].set(columnName, column(columnName, shape.column_type, shape.is_nullable, shape));
        return [{ affectedRows: 0 }];
      }
      if (/ADD INDEX idx_moderation_text_author_target/i.test(text)) {
        indexExists = true;
        return [{ affectedRows: 0 }];
      }
      if (/ADD CONSTRAINT fk_moderation_text_superseded_by/i.test(text)) {
        foreignKeyExists = true;
        return [{ affectedRows: 0 }];
      }
      if (text === "INSERT INTO schema_migrations (version) VALUES (?)" && shouldFailRecord) {
        shouldFailRecord = false;
        throw new Error("simulated schema_migrations write failure");
      }
      return [{ affectedRows: 1 }];
    }
  };
  Object.defineProperties(connection, {
    indexExists: { get: () => indexExists },
    foreignKeyExists: { get: () => foreignKeyExists }
  });
  return connection;
}

test("D46 migration delegates all MySQL/TDSQL-C reconciliation to the migration runner", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.equal(AUTHOR_PRIVATE_CONTENT_VISIBILITY_MIGRATION, "0030_author_private_content_visibility.sql");
  assert.match(sql, /reconciled by prepareMigration/i);
  assert.match(sql, /SELECT 1/i);
  assert.doesNotMatch(sql, /ADD COLUMN IF NOT EXISTS|ALTER TABLE/i);
});

test("D46 reconciliation upgrades version-zero history and is idempotent", async () => {
  const connection = authorVisibilityMigrationConnection();

  const first = await reconcileAuthorPrivateContentVisibility(connection);
  const ddlAfterFirst = connection.calls.filter(({ sql }) => /^ALTER TABLE/i.test(sql)).length;
  const second = await reconcileAuthorPrivateContentVisibility(connection);

  assert.deepEqual(first, { reconciledAuthorPrivateVisibility: true });
  assert.deepEqual(second, { reconciledAuthorPrivateVisibility: true });
  assert.equal(ddlAfterFirst, 7);
  assert.equal(connection.calls.filter(({ sql }) => /^ALTER TABLE/i.test(sql)).length, ddlAfterFirst);
  assert.equal(connection.indexExists, true);
  assert.equal(connection.foreignKeyExists, true);
  assert.equal(
    connection.calls.some(({ sql }) => /^UPDATE\s/i.test(sql)),
    false,
    "historical rows must inherit DEFAULT 0 without a content backfill"
  );
  assert.equal(
    connection.columns.content_moderation_text_proposals
      .get("author_visibility_version").column_default,
    "0"
  );
  assert.equal(
    connection.columns.session_album_photos.get("author_visibility_version").column_default,
    "0"
  );
});

test("D46 prepareMigration recognizes an already-upgraded schema", async () => {
  const connection = authorVisibilityMigrationConnection({ includeD46: true });
  const result = await prepareMigration(connection, AUTHOR_PRIVATE_CONTENT_VISIBILITY_MIGRATION);

  assert.deepEqual(result, {
    skipStatements: true,
    reconciledAuthorPrivateVisibility: true
  });
  assert.equal(connection.calls.some(({ sql }) => /^ALTER TABLE/i.test(sql)), false);
});

test("D46 reconciliation rejects an incompatible existing column before any DDL", async () => {
  const connection = authorVisibilityMigrationConnection({
    malformedColumn: [
      "content_moderation_text_proposals",
      "author_visibility_version",
      { column_type: "varchar(8)", is_nullable: "YES" }
    ]
  });

  await assert.rejects(reconcileAuthorPrivateContentVisibility(connection), {
    code: "CONTENT_MODERATION_MIGRATION_SCHEMA_MISMATCH"
  });
  assert.equal(connection.calls.some(({ sql }) => /^ALTER TABLE/i.test(sql)), false);
});

test("D46 migration safely reruns after DDL committed but migration recording failed", async () => {
  const connection = authorVisibilityMigrationConnection({ failMigrationRecordOnce: true });
  const sql = await readFile(migrationUrl, "utf8");

  await assert.rejects(
    applyMigration(connection, { file: AUTHOR_PRIVATE_CONTENT_VISIBILITY_MIGRATION, sql }),
    /simulated schema_migrations write failure/
  );
  const ddlAfterCrash = connection.calls.filter(({ sql: statement }) => /^ALTER TABLE/i.test(statement)).length;

  await applyMigration(connection, { file: AUTHOR_PRIVATE_CONTENT_VISIBILITY_MIGRATION, sql });

  assert.equal(connection.calls.filter(({ sql: statement }) => /^ALTER TABLE/i.test(statement)).length, ddlAfterCrash);
  assert.equal(connection.calls.filter(({ sql: statement }) => statement === "ROLLBACK").length, 1);
  assert.equal(connection.calls.filter(({ sql: statement }) => statement === "COMMIT").length, 1);
});
