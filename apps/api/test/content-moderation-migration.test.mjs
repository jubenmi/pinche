import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { requiredSchemaTables } from "../src/db/mysql.js";
import {
  CONTENT_MODERATION_PROVIDER_ATTEMPTS_MIGRATION,
  prepareMigration,
  reconcileContentModerationProviderAttempts
} from "../src/modules/album-video/migration.js";

const migrationUrl = new URL("../migrations/0024_content_moderation.sql", import.meta.url);
const providerAttemptsMigrationUrl = new URL(
  "../migrations/0025_content_moderation_provider_attempts.sql",
  import.meta.url
);
const retryExhaustionMigrationUrl = new URL(
  "../migrations/0027_content_moderation_retry_exhaustion.sql",
  import.meta.url
);
const orphanScanMigrationUrl = new URL(
  "../migrations/0028_content_moderation_orphan_scan_state.sql",
  import.meta.url
);

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
  assert.match(sql, /moderation_object_version VARCHAR\(128\) NULL/i);
  assert.match(sql, /idx_album_moderation/i);
  assert.match(sql, /ALTER TABLE session_album_object_cleanup_jobs/i);
  assert.match(sql, /object_urls_json JSON NULL/i);
  assert.doesNotMatch(sql, /UPDATE session_album_photos SET moderation_status = 'pending'/i);
});

test("D45 retry exhaustion migration adds a nullable terminal marker without rewriting attempt history", async () => {
  const sql = await readFile(retryExhaustionMigrationUrl, "utf8");
  assert.match(sql, /ALTER TABLE content_moderation_jobs/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS retry_exhausted_at DATETIME NULL/i);
  assert.doesNotMatch(sql, /attempt_count\s*=/i);
});

test("D45 orphan scanner persists only bounded cursors and opaque leases", async () => {
  const sql = await readFile(orphanScanMigrationUrl, "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS content_moderation_orphan_scan_state/i);
  assert.match(sql, /scan_name VARCHAR\(64\) NOT NULL PRIMARY KEY/i);
  assert.match(sql, /cursor_value VARCHAR\(1024\) NULL/i);
  assert.match(sql, /lease_token VARCHAR\(128\) NULL/i);
  assert.match(sql, /lease_expires_at DATETIME NULL/i);
  assert.equal(requiredSchemaTables.includes("content_moderation_orphan_scan_state"), true);
  assert.doesNotMatch(sql, /object_key|signed_url|access_token|normalized_payload_json/i);
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

function moderationMigrationConnection({
  attemptTable = false,
  attemptTableMetadata = {},
  attemptForeignKeys,
  indexes = {},
  columns = {},
  proposalColumns = {},
  attemptColumnOverrides = {},
  providerDuplicates = [],
  proposalDuplicates = [],
  jobKeyDuplicates = [],
  indexOverrides = {}
} = {}) {
  const calls = [];
  const indexRows = {
    uniq_moderation_subject_version: [
      "subject_type", "subject_id", "subject_version"
    ],
    uniq_moderation_subject_version_provider: [
      "subject_type", "subject_id", "subject_version", "provider"
    ],
    uniq_moderation_attempt_provider_job: ["provider", "provider_job_id"],
    uniq_moderation_attempt_job_no: ["moderation_job_id", "attempt_no"],
    uniq_moderation_attempt_current_job: ["current_job_id"],
    idx_moderation_attempt_job_current: ["moderation_job_id", "is_current"],
    uniq_moderation_text_actor_action_idempotency: [
      "created_by_user_id", "action", "idempotency_key"
    ]
  };
  const attemptColumns = [
    ["id", "bigint unsigned", "NO", "auto_increment", "", null],
    ["moderation_job_id", "bigint unsigned", "NO", "", "", null],
    ["provider", "varchar(32)", "NO", "", "", null],
    ["provider_job_id", "varchar(128)", "NO", "", "", null],
    ["attempt_no", "int unsigned", "NO", "", "", null],
    ["is_current", "tinyint(1)", "NO", "", "", "1"],
    ["submitted_at", "datetime", "NO", "DEFAULT_GENERATED", "", "CURRENT_TIMESTAMP"],
    ["response_summary_json", "json", "YES", "", "", null],
    [
      "current_job_id", "bigint unsigned", "YES", "VIRTUAL GENERATED",
      "case when (`is_current` = 1) then `moderation_job_id` else NULL end", null
    ],
    ["created_at", "datetime", "NO", "DEFAULT_GENERATED", "", "CURRENT_TIMESTAMP"],
    [
      "updated_at", "datetime", "NO", "DEFAULT_GENERATED on update CURRENT_TIMESTAMP", "",
      "CURRENT_TIMESTAMP"
    ]
  ].map(([column_name, column_type, is_nullable, extra, generation_expression, column_default]) => ({
    column_name, column_type, is_nullable, extra, generation_expression, column_default
  }));
  for (const [columnName, override] of Object.entries(attemptColumnOverrides)) {
    const column = attemptColumns.find((row) => row.column_name === columnName);
    if (column) Object.assign(column, override);
  }
  const proposalColumnTypes = {
    id: "bigint unsigned",
    subject_type: "varchar(64)",
    base_version: "varchar(128)",
    payload_digest: "char(64)",
    created_by_user_id: "bigint unsigned",
    action: "varchar(64)",
    idempotency_key: "varchar(128)"
  };
  const proposalColumnRows = [
    ["id", "bigint unsigned", "NO", "auto_increment"],
    ["subject_type", "varchar(64)", "NO", ""],
    ["base_version", "varchar(128)", "NO", ""],
    ["payload_digest", "char(64)", "NO", ""],
    ["created_by_user_id", "bigint unsigned", "NO", ""]
  ].map(([column_name, column_type, is_nullable, extra]) => ({
    column_name,
    column_type,
    is_nullable,
    column_default: null,
    extra,
    generation_expression: ""
  }));
  for (const [column_name, is_nullable] of Object.entries(columns)) {
    proposalColumnRows.push({
    column_name,
    column_type: proposalColumnTypes[column_name] || "varchar(255)",
    is_nullable,
      column_default: null,
      extra: "",
      generation_expression: ""
    });
  }
  for (const [columnName, override] of Object.entries(proposalColumns)) {
    const index = proposalColumnRows.findIndex((row) => row.column_name === columnName);
    if (override === null) {
      if (index >= 0) proposalColumnRows.splice(index, 1);
      continue;
    }
    const current = index >= 0 ? proposalColumnRows[index] : {
      column_name: columnName,
      column_type: proposalColumnTypes[columnName] || "varchar(255)",
      is_nullable: "NO",
      column_default: null,
      extra: "",
      generation_expression: ""
    };
    const next = { ...current, ...override, column_name: columnName };
    if (index >= 0) proposalColumnRows[index] = next;
    else proposalColumnRows.push(next);
  }
  return {
    calls,
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (text.includes("information_schema.tables")) {
        return [attemptTable ? [{
          table_name: "content_moderation_provider_attempts",
          engine: "InnoDB",
          table_type: "BASE TABLE",
          ...attemptTableMetadata
        }] : []];
      }
      if (text.includes("information_schema.key_column_usage")) {
        return [attemptTable ? (attemptForeignKeys ?? [{
          constraint_name: "fk_moderation_attempt_job",
          column_name: "moderation_job_id",
          ordinal_position: 1,
          referenced_table_schema: "pinche",
          referenced_same_schema: 1,
          referenced_table_name: "content_moderation_jobs",
          referenced_column_name: "id",
          delete_rule: "CASCADE",
          update_rule: "NO ACTION"
        }]) : []];
      }
      if (text.includes("information_schema.statistics")) {
        const indexName = params.at(-1);
        if (indexOverrides[indexName]) return [indexOverrides[indexName]];
        const names = indexes[indexName] ? indexRows[indexName] : null;
        return [names ? names.map((column_name, offset) => ({
          index_name: indexName,
          non_unique: indexName.startsWith("idx_") ? 1 : 0,
          column_name,
          seq_in_index: offset + 1,
          sub_part: null,
          collation: "A",
          index_type: "BTREE",
          expression: null
        })) : []];
      }
      if (text.includes("information_schema.columns") && text.includes("COLUMN_TYPE")) {
        if (params.includes("content_moderation_text_proposals")) return [proposalColumnRows];
        return [attemptTable ? attemptColumns : []];
      }
      if (text.includes("information_schema.columns")) {
        const column = params.at(-1);
        return [columns[column] ? [{ is_nullable: columns[column] }] : []];
      }
      if (text.includes("GROUP BY provider, provider_job_id")) return [providerDuplicates];
      if (text.includes("GROUP BY subject_type, subject_id, subject_version, provider")) return [jobKeyDuplicates];
      if (text.includes("normalized_action")) return [proposalDuplicates];
      return [{ affectedRows: 1, insertId: 1 }];
    }
  };
}

function assertNoMigrationNormalization(calls) {
  assert.equal(calls.some(({ sql }) => (
    /UPDATE content_moderation_jobs|UPDATE content_moderation_text_proposals|INSERT INTO content_moderation_provider_attempts|ALTER TABLE|CREATE TABLE/i.test(sql)
  )), false);
}

const fullyReconciledIndexes = {
  uniq_moderation_subject_version_provider: true,
  uniq_moderation_text_actor_action_idempotency: true,
  uniq_moderation_attempt_provider_job: true,
  uniq_moderation_attempt_job_no: true,
  uniq_moderation_attempt_current_job: true,
  idx_moderation_attempt_job_current: true
};

test("D45 provider-attempt migration keeps the cascading foreign key compatible with generated columns", async () => {
  const connection = moderationMigrationConnection();

  await prepareMigration(connection, CONTENT_MODERATION_PROVIDER_ATTEMPTS_MIGRATION);

  const createTable = connection.calls.find(({ sql }) => (
    /CREATE TABLE IF NOT EXISTS content_moderation_provider_attempts/i.test(sql)
  ));
  assert.ok(createTable);
  assert.match(
    createTable.sql,
    /current_job_id BIGINT UNSIGNED\s+GENERATED ALWAYS AS \([\s\S]*?\) VIRTUAL,/i
  );
  assert.match(
    createTable.sql,
    /FOREIGN KEY \(moderation_job_id\) REFERENCES content_moderation_jobs\(id\) ON DELETE CASCADE/i
  );
});

test("D45 migration deterministically normalizes historical provider-job duplicates before adding constraints", async () => {
  const connection = moderationMigrationConnection({
    providerDuplicates: [{ provider: "tencent_ci_video", provider_job_id: "legacy-job", canonical_job_id: 9 }]
  });

  const result = await prepareMigration(connection, CONTENT_MODERATION_PROVIDER_ATTEMPTS_MIGRATION);

  assert.equal(result.skipStatements, true);
  const normalizeIndex = connection.calls.findIndex(({ sql }) => /SET provider_job_id = NULL/.test(sql));
  const providerKeyIndex = connection.calls.findIndex(({ sql }) =>
    /ADD UNIQUE KEY uniq_moderation_subject_version_provider/.test(sql)
  );
  assert.ok(normalizeIndex >= 0 && normalizeIndex < providerKeyIndex);
  assert.match(connection.calls[normalizeIndex].sql, /status = CASE WHEN status = 'processing' THEN 'error'/);
  assert.deepEqual(connection.calls[normalizeIndex].params, [
    "CONTENT_MODERATION_LEGACY_PROVIDER_JOB_DUPLICATE",
    "tencent_ci_video",
    "legacy-job",
    9
  ]);
  assert.equal(connection.calls.some(({ sql }) => /CREATE TABLE IF NOT EXISTS content_moderation_provider_attempts/.test(sql)), true);
  assert.equal(connection.calls.some(({ sql }) => /NOT EXISTS \(\s*SELECT 1\s*FROM content_moderation_provider_attempts/s.test(sql)), true);
  assert.equal(connection.calls.some(({ sql }) => /MODIFY COLUMN action VARCHAR\(64\) NOT NULL/.test(sql)), true);
  assert.equal(connection.calls.some(({ sql }) => /MODIFY COLUMN idempotency_key VARCHAR\(128\) NOT NULL/.test(sql)), true);
});

test("D45 migration reconciliation is safe to rerun after a partial schema update", async () => {
  const connection = moderationMigrationConnection({
    attemptTable: true,
    indexes: {
      uniq_moderation_subject_version_provider: true,
      uniq_moderation_text_actor_action_idempotency: true,
      uniq_moderation_attempt_provider_job: true,
      uniq_moderation_attempt_job_no: true,
      uniq_moderation_attempt_current_job: true,
      idx_moderation_attempt_job_current: true
    },
    columns: { action: "NO", idempotency_key: "NO" }
  });

  const result = await prepareMigration(connection, CONTENT_MODERATION_PROVIDER_ATTEMPTS_MIGRATION);

  assert.equal(result.skipStatements, true);
  assert.equal(connection.calls.some(({ sql }) => /CREATE TABLE IF NOT EXISTS/.test(sql)), false);
  assert.equal(connection.calls.some(({ sql }) => /ADD UNIQUE KEY|DROP INDEX|ADD COLUMN|MODIFY COLUMN/.test(sql)), false);
});

test("D45 migration rejects a malformed current-attempt generated expression before normalization", async () => {
  const connection = moderationMigrationConnection({
    attemptTable: true,
    indexes: fullyReconciledIndexes,
    columns: { action: "NO", idempotency_key: "NO" },
    attemptColumnOverrides: {
      current_job_id: {
        generation_expression: "case when (`is_current` = 1) then `moderation_job_id` else 0 end"
      }
    }
  });

  await assert.rejects(
    reconcileContentModerationProviderAttempts(connection),
    { code: "CONTENT_MODERATION_MIGRATION_SCHEMA_MISMATCH" }
  );
  assertNoMigrationNormalization(connection.calls);
});

for (const { name, proposalColumns } of [
  {
    name: "a non-null action default",
    proposalColumns: {
      action: { column_default: "legacy" }
    }
  },
  {
    name: "a too-short action column",
    proposalColumns: {
      action: { column_type: "varchar(32)" }
    }
  },
  {
    name: "a too-short idempotency key column",
    proposalColumns: {
      idempotency_key: { column_type: "varchar(64)" }
    }
  }
]) {
  test(`D45 migration rejects ${name} before normalization`, async () => {
    const connection = moderationMigrationConnection({
      columns: { action: "NO", idempotency_key: "NO" },
      proposalColumns
    });

    await assert.rejects(
      reconcileContentModerationProviderAttempts(connection),
      { code: "CONTENT_MODERATION_MIGRATION_SCHEMA_MISMATCH" }
    );
    assertNoMigrationNormalization(connection.calls);
  });
}

test("D45 migration rejects an impossible proposal nullability phase before normalization", async () => {
  const connection = moderationMigrationConnection({
    columns: { action: "YES", idempotency_key: "NO" }
  });

  await assert.rejects(
    reconcileContentModerationProviderAttempts(connection),
    { code: "CONTENT_MODERATION_MIGRATION_SCHEMA_MISMATCH" }
  );
  assertNoMigrationNormalization(connection.calls);
});

test("D45 migration rejects a same-named proposal index with descending order before normalization", async () => {
  const connection = moderationMigrationConnection({
    columns: { action: "NO", idempotency_key: "NO" },
    indexOverrides: {
      uniq_moderation_text_actor_action_idempotency: [
        {
          index_name: "uniq_moderation_text_actor_action_idempotency",
          non_unique: 0,
          column_name: "created_by_user_id",
          seq_in_index: 1,
          sub_part: null,
          collation: "D",
          index_type: "BTREE",
          expression: null
        },
        {
          index_name: "uniq_moderation_text_actor_action_idempotency",
          non_unique: 0,
          column_name: "action",
          seq_in_index: 2,
          sub_part: null,
          collation: "A",
          index_type: "BTREE",
          expression: null
        },
        {
          index_name: "uniq_moderation_text_actor_action_idempotency",
          non_unique: 0,
          column_name: "idempotency_key",
          seq_in_index: 3,
          sub_part: null,
          collation: "A",
          index_type: "BTREE",
          expression: null
        }
      ]
    }
  });

  await assert.rejects(
    reconcileContentModerationProviderAttempts(connection),
    { code: "CONTENT_MODERATION_MIGRATION_SCHEMA_MISMATCH" }
  );
  assertNoMigrationNormalization(connection.calls);
});

for (const columnName of ["base_version", "payload_digest"]) {
  test(`D45 migration rejects a missing proposal ${columnName} anchor before normalization`, async () => {
    const connection = moderationMigrationConnection({
      proposalColumns: { [columnName]: null }
    });

    await assert.rejects(
      reconcileContentModerationProviderAttempts(connection),
      { code: "CONTENT_MODERATION_MIGRATION_SCHEMA_MISMATCH" }
    );
    assertNoMigrationNormalization(connection.calls);
  });
}

for (const columnName of ["action", "idempotency_key"]) {
  test(`D45 migration rejects a generated proposal ${columnName} column before normalization`, async () => {
    const connection = moderationMigrationConnection({
      columns: { action: "NO", idempotency_key: "NO" },
      proposalColumns: {
        [columnName]: {
          extra: "VIRTUAL GENERATED",
          generation_expression: "concat('legacy_', id)"
        }
      }
    });

    await assert.rejects(
      reconcileContentModerationProviderAttempts(connection),
      { code: "CONTENT_MODERATION_MIGRATION_SCHEMA_MISMATCH" }
    );
    assertNoMigrationNormalization(connection.calls);
  });
}

for (const { name, options } of [
  {
    name: "an invalid current-attempt default",
    options: {
      attemptColumnOverrides: {
        is_current: { column_default: "0" }
      }
    }
  },
  {
    name: "an invalid submission timestamp default",
    options: {
      attemptColumnOverrides: {
        submitted_at: { column_default: "2000-01-01 00:00:00" }
      }
    }
  },
  {
    name: "an attempts table with the wrong engine",
    options: {
      attemptTableMetadata: { engine: "MyISAM" }
    }
  },
  {
    name: "an attempts table without its job foreign key",
    options: {
      attemptForeignKeys: []
    }
  }
]) {
  test(`D45 migration rejects ${name} before normalization`, async () => {
    const connection = moderationMigrationConnection({
      attemptTable: true,
      indexes: fullyReconciledIndexes,
      columns: { action: "NO", idempotency_key: "NO" },
      ...options
    });

    await assert.rejects(
      reconcileContentModerationProviderAttempts(connection),
      { code: "CONTENT_MODERATION_MIGRATION_SCHEMA_MISMATCH" }
    );
    assertNoMigrationNormalization(connection.calls);
  });
}

test("D45 migration rejects proposal idempotency duplicates before altering historical moderation jobs", async () => {
  const connection = moderationMigrationConnection({
    proposalDuplicates: [{ created_by_user_id: 8, action: "update_nickname", idempotency_key: "same" }]
  });

  await assert.rejects(
    prepareMigration(connection, CONTENT_MODERATION_PROVIDER_ATTEMPTS_MIGRATION),
    { code: "CONTENT_MODERATION_PROPOSAL_IDEMPOTENCY_DUPLICATE" }
  );
  assert.equal(connection.calls.some(({ sql }) => /UPDATE content_moderation_jobs/.test(sql)), false);
  assert.equal(connection.calls.some(({ sql }) => /ALTER TABLE|CREATE TABLE|INSERT INTO/.test(sql)), false);
});

test("D45 migration rejects duplicate provider-aware job keys before data mutation", async () => {
  const connection = moderationMigrationConnection({
    jobKeyDuplicates: [{ subject_type: "album_video", subject_id: "8", subject_version: "etag", provider: "tencent_ci_video" }]
  });

  await assert.rejects(
    prepareMigration(connection, CONTENT_MODERATION_PROVIDER_ATTEMPTS_MIGRATION),
    { code: "CONTENT_MODERATION_JOB_KEY_DUPLICATE" }
  );
  assert.equal(connection.calls.some(({ sql }) => /UPDATE content_moderation_jobs|ALTER TABLE|CREATE TABLE|INSERT INTO/.test(sql)), false);
});

test("D45 migration rejects a malformed existing attempts table before data mutation", async () => {
  const calls = [];
  const connection = {
    calls,
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (text.includes("information_schema.tables")) {
        return [[{ table_name: "content_moderation_provider_attempts" }]];
      }
      if (text.includes("information_schema.columns") && text.includes("COLUMN_TYPE")) {
        return [[{ column_name: "id", column_type: "bigint unsigned", is_nullable: "NO", extra: "" }]];
      }
      if (text.includes("information_schema.statistics")) {
        const indexName = params.at(-1);
        if (!String(indexName).includes("moderation_attempt")) return [[]];
        return [[{
          index_name: indexName, non_unique: 1, column_name: "wrong", seq_in_index: 1, sub_part: null
        }]];
      }
      if (text.includes("information_schema.columns")) return [[{ is_nullable: "NO" }]];
      return [[]];
    }
  };

  await assert.rejects(
    reconcileContentModerationProviderAttempts(connection),
    { code: "CONTENT_MODERATION_MIGRATION_SCHEMA_MISMATCH" }
  );
  assert.equal(calls.some(({ sql }) => /UPDATE content_moderation_jobs|ALTER TABLE|CREATE TABLE|INSERT INTO/.test(sql)), false);
});

test("D45 migration rejects a same-named provider-aware index with the wrong shape before data mutation", async () => {
  const connection = moderationMigrationConnection({
    indexOverrides: {
      uniq_moderation_subject_version_provider: [{
        index_name: "uniq_moderation_subject_version_provider",
        non_unique: 1,
        column_name: "subject_type",
        seq_in_index: 1,
        sub_part: null
      }]
    }
  });

  await assert.rejects(
    reconcileContentModerationProviderAttempts(connection),
    { code: "CONTENT_MODERATION_MIGRATION_SCHEMA_MISMATCH" }
  );
  assert.equal(connection.calls.some(({ sql }) => /UPDATE content_moderation_jobs|ALTER TABLE|CREATE TABLE|INSERT INTO/.test(sql)), false);
});

test("D45 provider-attempt migration file delegates reconciliation to the migration runner", async () => {
  const sql = await readFile(providerAttemptsMigrationUrl, "utf8");
  assert.match(sql, /reconciled by prepareMigration/i);
  assert.match(sql, /SELECT 1/i);
});

test("database readiness requires all moderation tables including provider attempts", () => {
  for (const table of [
    "content_moderation_jobs",
    "content_moderation_provider_attempts",
    "content_moderation_text_proposals",
    "content_moderation_audit_logs"
  ]) {
    assert.equal(requiredSchemaTables.includes(table), true, table);
  }
});
