export const SESSION_ALBUM_VIDEO_HARDENING_MIGRATION =
  "0022_session_album_video_hardening.sql";
export const SESSION_ALBUM_VIDEO_SOURCE_INDEX =
  "uniq_session_album_video_source_url";
export const CONTENT_MODERATION_PROVIDER_ATTEMPTS_MIGRATION =
  "0025_content_moderation_provider_attempts.sql";
export const CONTENT_MODERATION_TEXT_PROPOSAL_RESULT_MIGRATION =
  "0026_content_moderation_text_proposal_result.sql";
export const CONTENT_MODERATION_RETRY_EXHAUSTION_MIGRATION =
  "0027_content_moderation_retry_exhaustion.sql";

const CONTENT_MODERATION_ATTEMPTS_TABLE = "content_moderation_provider_attempts";
const CONTENT_MODERATION_JOBS_TABLE = "content_moderation_jobs";
const CONTENT_MODERATION_TEXT_PROPOSALS_TABLE = "content_moderation_text_proposals";
const CONTENT_MODERATION_PROVIDER_JOB_DUPLICATE =
  "CONTENT_MODERATION_LEGACY_PROVIDER_JOB_DUPLICATE";
const CURRENT_ATTEMPT_JOB_GENERATION_EXPRESSION =
  "case when (is_current = 1) then moderation_job_id else null end";
const TEXT_PROPOSAL_COLUMN_SHAPES = {
  action: { type: "varchar(64)" },
  idempotency_key: { type: "varchar(128)" }
};
const TEXT_PROPOSAL_RECONCILIATION_COLUMNS = [
  "id",
  "subject_type",
  "base_version",
  "payload_digest",
  "created_by_user_id"
];
const TEXT_PROPOSAL_COLUMN_LIFECYCLE_STATES = new Set([
  "absent:absent",
  "YES:absent",
  "YES:YES",
  "NO:YES",
  "NO:NO"
]);
const TEXT_PROPOSAL_APPLIED_RESULT_COLUMN = {
  tableName: CONTENT_MODERATION_TEXT_PROPOSALS_TABLE,
  anchorColumn: "applied_at",
  anchorExpected: {
    type: "datetime",
    nullable: "YES",
    default: null,
    extra: "",
    generationExpression: ""
  },
  columnName: "applied_result_json",
  expected: {
    type: "json",
    nullable: "YES",
    default: null,
    extra: "",
    generationExpression: ""
  },
  ddl: "ALTER TABLE content_moderation_text_proposals ADD COLUMN applied_result_json JSON NULL AFTER applied_at"
};
const RETRY_EXHAUSTION_COLUMN = {
  tableName: CONTENT_MODERATION_JOBS_TABLE,
  anchorColumn: "next_retry_at",
  anchorExpected: {
    type: "datetime",
    nullable: "YES",
    default: null,
    extra: "",
    generationExpression: ""
  },
  columnName: "retry_exhausted_at",
  expected: {
    type: "datetime",
    nullable: "YES",
    default: null,
    extra: "",
    generationExpression: ""
  },
  ddl: "ALTER TABLE content_moderation_jobs ADD COLUMN retry_exhausted_at DATETIME NULL AFTER next_retry_at"
};

export const DUPLICATE_SESSION_ALBUM_VIDEO_SOURCE_QUERY = `
  SELECT
    duplicates.source_url,
    album.id,
    duplicates.duplicate_count
  FROM session_album_photos AS album
  INNER JOIN (
    SELECT source_url, COUNT(*) AS duplicate_count
    FROM session_album_photos
    WHERE source_url IS NOT NULL
    GROUP BY source_url
    HAVING COUNT(*) > 1
  ) AS duplicates
    ON duplicates.source_url = album.source_url
  ORDER BY duplicates.source_url ASC, album.id ASC
`;

export const SESSION_ALBUM_VIDEO_SOURCE_INDEX_QUERY = `
  SELECT
    NON_UNIQUE AS non_unique,
    COLUMN_NAME AS column_name,
    SEQ_IN_INDEX AS seq_in_index,
    SUB_PART AS sub_part
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'session_album_photos'
    AND index_name = ?
  ORDER BY seq_in_index ASC
`;

const DUPLICATE_ERROR_DETAIL_LIMIT = 2048;

function duplicateSourceError(duplicates) {
  const details = duplicates.map(({ sourceUrl, count, ids }) => {
    return `source_url=${JSON.stringify(sourceUrl)} count=${count} ids=[${ids.join(",")}]`;
  }).join("; ");
  const humanDetails = details.length <= DUPLICATE_ERROR_DETAIL_LIMIT
    ? details
    : `${details.slice(0, DUPLICATE_ERROR_DETAIL_LIMIT)}… [truncated; full IDs in error.details]`;
  const structuredDuplicates = duplicates.map(({ sourceUrl, count, ids }) => ({
    sourceUrl,
    count,
    ids: [...ids]
  }));
  const error = new Error(
    `Cannot add ${SESSION_ALBUM_VIDEO_SOURCE_INDEX}; duplicate album video sources exist: ${humanDetails}`
  );
  error.code = "SESSION_ALBUM_VIDEO_DUPLICATE_SOURCE_URL";
  error.details = { duplicates: structuredDuplicates };
  error.duplicates = structuredDuplicates;
  return error;
}

export async function assertSessionAlbumVideoSourceUrlsUnique(connection) {
  const [rows] = await connection.query(DUPLICATE_SESSION_ALBUM_VIDEO_SOURCE_QUERY);
  if (rows.length > 0) {
    const duplicates = [];
    for (const row of rows) {
      const current = duplicates.at(-1);
      if (!current || current.sourceUrl !== row.source_url) {
        duplicates.push({
          sourceUrl: row.source_url,
          count: Number(row.duplicate_count),
          ids: [row.id]
        });
      } else {
        current.ids.push(row.id);
      }
    }
    throw duplicateSourceError(duplicates);
  }
}

function wrongIndexShapeError(rows) {
  const shape = rows.map((row) => ({
    nonUnique: Number(row.non_unique),
    column: row.column_name,
    position: Number(row.seq_in_index),
    prefixLength: row.sub_part == null ? null : Number(row.sub_part)
  }));
  const error = new Error(
    `${SESSION_ALBUM_VIDEO_SOURCE_INDEX} exists with an incompatible shape: ${JSON.stringify(shape)}`
  );
  error.code = "SESSION_ALBUM_VIDEO_SOURCE_INDEX_SHAPE_MISMATCH";
  error.details = { expected: { unique: true, columns: ["source_url"] }, actual: shape };
  return error;
}

export async function inspectSessionAlbumVideoSourceIndex(connection) {
  const [rows] = await connection.query(
    SESSION_ALBUM_VIDEO_SOURCE_INDEX_QUERY,
    [SESSION_ALBUM_VIDEO_SOURCE_INDEX]
  );
  if (rows.length === 0) {
    return { exists: false };
  }

  const exact = rows.length === 1 &&
    Number(rows[0].non_unique) === 0 &&
    rows[0].column_name === "source_url" &&
    Number(rows[0].seq_in_index) === 1 &&
    rows[0].sub_part == null;
  if (!exact) {
    throw wrongIndexShapeError(rows);
  }
  return { exists: true, exact: true };
}

async function inspectTableMetadata(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT
       TABLE_NAME AS table_name,
       ENGINE AS engine,
       TABLE_TYPE AS table_type
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?
     LIMIT 1`,
    [tableName]
  );
  return rows[0] || null;
}

function schemaMismatch(scope, details = {}) {
  const error = new Error(`content moderation migration schema mismatch: ${scope}`);
  error.code = "CONTENT_MODERATION_MIGRATION_SCHEMA_MISMATCH";
  error.details = { scope, ...details };
  return error;
}

function duplicateJobKeyError(rows) {
  const error = new Error("content moderation provider-aware job keys are duplicated");
  error.code = "CONTENT_MODERATION_JOB_KEY_DUPLICATE";
  error.details = { duplicates: rows };
  return error;
}

async function inspectExpectedIndex(connection, tableName, indexName, expected) {
  const [rows] = await connection.query(
    `SELECT
       NON_UNIQUE AS non_unique,
       COLUMN_NAME AS column_name,
       SEQ_IN_INDEX AS seq_in_index,
       SUB_PART AS sub_part,
       COLLATION AS collation,
       INDEX_TYPE AS index_type,
       EXPRESSION AS expression
     FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
     ORDER BY seq_in_index ASC`,
    [tableName, indexName]
  );
  if (rows.length === 0) return { exists: false };

  const expectedNonUnique = expected.unique ? 0 : 1;
  const exact = rows.length === expected.columns.length && rows.every((row, index) => (
    Number(row.non_unique) === expectedNonUnique &&
    String(row.column_name) === expected.columns[index] &&
    Number(row.seq_in_index) === index + 1 &&
    row.sub_part == null &&
    String(row.collation || "").toUpperCase() === "A" &&
    String(row.index_type || "").toUpperCase() === "BTREE" &&
    row.expression == null
  ));
  if (!exact) {
    throw schemaMismatch(`${tableName}.${indexName}`, {
      expected: { ...expected, collation: "A", indexType: "BTREE", expression: null },
      actual: rows.map((row) => ({
        nonUnique: Number(row.non_unique),
        column: row.column_name,
        position: Number(row.seq_in_index),
        prefixLength: row.sub_part == null ? null : Number(row.sub_part),
        collation: row.collation || null,
        indexType: row.index_type || null,
        expression: row.expression || null
      }))
    });
  }
  return { exists: true };
}

function normalizeSchemaText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeGeneratedExpression(value) {
  return normalizeSchemaText(value).replace(/`/g, "");
}

function normalizeColumnMetadata(value) {
  if (value == null) return null;
  return normalizeSchemaText(value).replace(/\(\)/g, "");
}

async function inspectModerationTableColumns(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT
       COLUMN_NAME AS column_name,
       COLUMN_TYPE AS column_type,
       IS_NULLABLE AS is_nullable,
       COLUMN_DEFAULT AS column_default,
       EXTRA AS extra,
       GENERATION_EXPRESSION AS generation_expression
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?`,
    [tableName]
  );
  return new Map(rows.map((row) => [String(row.column_name), row]));
}

function normalizedModerationColumnShape(column) {
  return {
    type: normalizeSchemaText(column.column_type),
    nullable: String(column.is_nullable || "").toUpperCase(),
    default: normalizeColumnMetadata(column.column_default),
    extra: normalizeColumnMetadata(column.extra),
    generationExpression: normalizeGeneratedExpression(column.generation_expression)
  };
}

function assertModerationColumnShape(definition, columnName, column, expected) {
  const actual = normalizedModerationColumnShape(column);
  const exact = actual.type === expected.type &&
    actual.nullable === expected.nullable &&
    actual.default === expected.default &&
    actual.extra === expected.extra &&
    actual.generationExpression === expected.generationExpression;
  if (!exact) {
    throw schemaMismatch(`${definition.tableName}.${columnName}`, {
      expected,
      actual: column
    });
  }
}

async function reconcileModerationAdditiveColumn(connection, definition) {
  const columns = await inspectModerationTableColumns(connection, definition.tableName);
  if (!columns.has(definition.anchorColumn)) {
    throw schemaMismatch(`${definition.tableName}.${definition.anchorColumn}`, {
      expected: { required: true },
      actual: null
    });
  }
  assertModerationColumnShape(
    definition,
    definition.anchorColumn,
    columns.get(definition.anchorColumn),
    definition.anchorExpected
  );

  const column = columns.get(definition.columnName);
  if (!column) {
    await connection.query(definition.ddl);
    return { added: true };
  }

  assertModerationColumnShape(definition, definition.columnName, column, definition.expected);
  return { added: false };
}

async function reconcileContentModerationTextProposalResult(connection) {
  return reconcileModerationAdditiveColumn(connection, TEXT_PROPOSAL_APPLIED_RESULT_COLUMN);
}

async function reconcileContentModerationRetryExhaustion(connection) {
  return reconcileModerationAdditiveColumn(connection, RETRY_EXHAUSTION_COLUMN);
}

async function inspectTextProposalColumns(connection) {
  const columns = await inspectModerationTableColumns(
    connection,
    CONTENT_MODERATION_TEXT_PROPOSALS_TABLE
  );
  for (const name of TEXT_PROPOSAL_RECONCILIATION_COLUMNS) {
    if (!columns.has(name)) {
      throw schemaMismatch(`${CONTENT_MODERATION_TEXT_PROPOSALS_TABLE}.${name}`, {
        expected: { required: true },
        actual: null
      });
    }
  }
  const result = {};
  for (const [name, expected] of Object.entries(TEXT_PROPOSAL_COLUMN_SHAPES)) {
    const column = columns.get(name);
    if (!column) {
      result[name] = { exists: false, isNullable: null };
      continue;
    }

    const actualType = normalizeSchemaText(column.column_type);
    const nullable = String(column.is_nullable || "").toUpperCase();
    // YES is the only resumable pre-finalization shape produced by this
    // migration; NO is the final shape. Any other schema is unsafe to modify.
    const expectedShape = actualType === expected.type &&
      (nullable === "YES" || nullable === "NO") &&
      column.column_default === null &&
      normalizeSchemaText(column.extra) === "" &&
      normalizeGeneratedExpression(column.generation_expression) === "";
    if (!expectedShape) {
      throw schemaMismatch(`${CONTENT_MODERATION_TEXT_PROPOSALS_TABLE}.${name}`, {
        expected: {
          type: expected.type,
          nullable: ["YES", "NO"],
          default: null,
          extra: "",
          generationExpression: ""
        },
        actual: column
      });
    }
    result[name] = { exists: true, isNullable: nullable };
  }
  return result;
}

async function inspectAttemptsForeignKey(connection) {
  const [rows] = await connection.query(
    `SELECT
       kcu.CONSTRAINT_NAME AS constraint_name,
       kcu.COLUMN_NAME AS column_name,
       kcu.ORDINAL_POSITION AS ordinal_position,
       kcu.REFERENCED_TABLE_SCHEMA = DATABASE() AS referenced_same_schema,
       kcu.REFERENCED_TABLE_NAME AS referenced_table_name,
       kcu.REFERENCED_COLUMN_NAME AS referenced_column_name,
       rc.DELETE_RULE AS delete_rule,
       rc.UPDATE_RULE AS update_rule
     FROM information_schema.key_column_usage AS kcu
     INNER JOIN information_schema.referential_constraints AS rc
       ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
      AND rc.TABLE_NAME = kcu.TABLE_NAME
      AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
     WHERE kcu.CONSTRAINT_SCHEMA = DATABASE()
       AND kcu.TABLE_NAME = ?
       AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY kcu.CONSTRAINT_NAME ASC, kcu.ORDINAL_POSITION ASC`,
    [CONTENT_MODERATION_ATTEMPTS_TABLE]
  );
  const exact = rows.length === 1 &&
    String(rows[0].constraint_name) === "fk_moderation_attempt_job" &&
    String(rows[0].column_name) === "moderation_job_id" &&
    Number(rows[0].ordinal_position) === 1 &&
    Number(rows[0].referenced_same_schema) === 1 &&
    String(rows[0].referenced_table_name) === "content_moderation_jobs" &&
    String(rows[0].referenced_column_name) === "id" &&
    String(rows[0].delete_rule).toUpperCase() === "CASCADE" &&
    String(rows[0].update_rule).toUpperCase() === "NO ACTION";
  if (!exact) {
    throw schemaMismatch(`${CONTENT_MODERATION_ATTEMPTS_TABLE}.fk_moderation_attempt_job`, {
      expected: {
        column: "moderation_job_id",
        referencedTable: "content_moderation_jobs",
        referencedColumn: "id",
        deleteRule: "CASCADE",
        updateRule: "NO ACTION"
      },
      actual: rows
    });
  }
}

function assertTextProposalColumnLifecycle(proposalColumns, proposalIndex) {
  const actionState = proposalColumns.action.exists
    ? proposalColumns.action.isNullable
    : "absent";
  const idempotencyState = proposalColumns.idempotency_key.exists
    ? proposalColumns.idempotency_key.isNullable
    : "absent";
  const state = `${actionState}:${idempotencyState}`;
  if (!TEXT_PROPOSAL_COLUMN_LIFECYCLE_STATES.has(state)) {
    throw schemaMismatch(CONTENT_MODERATION_TEXT_PROPOSALS_TABLE, {
      expectedLifecycleStates: [...TEXT_PROPOSAL_COLUMN_LIFECYCLE_STATES],
      actualLifecycleState: state
    });
  }
  if (proposalIndex.exists && state !== "NO:NO") {
    throw schemaMismatch("content_moderation_text_proposals.uniq_moderation_text_actor_action_idempotency", {
      expectedLifecycleState: "NO:NO",
      actualLifecycleState: state
    });
  }
}

async function inspectAttemptsTable(connection) {
  const table = await inspectTableMetadata(connection, CONTENT_MODERATION_ATTEMPTS_TABLE);
  if (!table) {
    return { exists: false };
  }
  if (
    normalizeSchemaText(table.engine) !== "innodb" ||
    String(table.table_type || "").toUpperCase() !== "BASE TABLE"
  ) {
    throw schemaMismatch(CONTENT_MODERATION_ATTEMPTS_TABLE, {
      expected: { engine: "InnoDB", tableType: "BASE TABLE" },
      actual: table
    });
  }
  const [rows] = await connection.query(
    `SELECT
       COLUMN_NAME AS column_name,
       COLUMN_TYPE AS column_type,
       IS_NULLABLE AS is_nullable,
       COLUMN_DEFAULT AS column_default,
       EXTRA AS extra,
       GENERATION_EXPRESSION AS generation_expression
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [CONTENT_MODERATION_ATTEMPTS_TABLE]
  );
  const columns = new Map(rows.map((row) => [String(row.column_name), row]));
  const expectedColumns = [
    ["id", "bigint unsigned", "NO", { default: null, extra: "auto_increment" }],
    ["moderation_job_id", "bigint unsigned", "NO", { default: null, extra: "" }],
    ["provider", "varchar(32)", "NO", { default: null, extra: "" }],
    ["provider_job_id", "varchar(128)", "NO", { default: null, extra: "" }],
    ["attempt_no", "int unsigned", "NO", { default: null, extra: "" }],
    ["is_current", "tinyint(1)", "NO", { default: "1", extra: "" }],
    ["submitted_at", "datetime", "NO", { default: "current_timestamp", extra: "default_generated" }],
    ["response_summary_json", "json", "YES", { default: null, extra: "" }],
    ["current_job_id", "bigint unsigned", "YES", {
      default: null,
      extra: "virtual generated",
      generated: true
    }],
    ["created_at", "datetime", "NO", { default: "current_timestamp", extra: "default_generated" }],
    ["updated_at", "datetime", "NO", {
      default: "current_timestamp",
      extra: "default_generated on update current_timestamp"
    }]
  ];
  for (const [name, type, nullable, options = {}] of expectedColumns) {
    const column = columns.get(name);
    const actualType = normalizeSchemaText(column?.column_type);
    if (!column || actualType !== type || String(column.is_nullable).toUpperCase() !== nullable) {
      throw schemaMismatch(`${CONTENT_MODERATION_ATTEMPTS_TABLE}.${name}`, {
        expected: { type, nullable, ...options },
        actual: column || null
      });
    }
    const actualDefault = normalizeColumnMetadata(column.column_default);
    const extra = normalizeColumnMetadata(column.extra);
    if (actualDefault !== options.default || extra !== options.extra) {
      throw schemaMismatch(`${CONTENT_MODERATION_ATTEMPTS_TABLE}.${name}`, {
        expected: options,
        actual: column
      });
    }
    if (
      options.generated &&
      normalizeGeneratedExpression(column.generation_expression) !== CURRENT_ATTEMPT_JOB_GENERATION_EXPRESSION
    ) {
      throw schemaMismatch(`${CONTENT_MODERATION_ATTEMPTS_TABLE}.${name}`, {
        expected: {
          ...options,
          extra: "VIRTUAL GENERATED",
          generationExpression: CURRENT_ATTEMPT_JOB_GENERATION_EXPRESSION
        },
        actual: column
      });
    }
  }

  for (const [indexName, expected] of Object.entries({
    uniq_moderation_attempt_provider_job: { unique: true, columns: ["provider", "provider_job_id"] },
    uniq_moderation_attempt_job_no: { unique: true, columns: ["moderation_job_id", "attempt_no"] },
    uniq_moderation_attempt_current_job: { unique: true, columns: ["current_job_id"] },
    idx_moderation_attempt_job_current: { unique: false, columns: ["moderation_job_id", "is_current"] }
  })) {
    const index = await inspectExpectedIndex(connection, CONTENT_MODERATION_ATTEMPTS_TABLE, indexName, expected);
    if (!index.exists) throw schemaMismatch(`${CONTENT_MODERATION_ATTEMPTS_TABLE}.${indexName}`, { expected });
  }
  await inspectAttemptsForeignKey(connection);
  return { exists: true };
}

async function findLegacyProviderJobDuplicates(connection) {
  const [rows] = await connection.query(
    `SELECT provider, provider_job_id, MAX(id) AS canonical_job_id
     FROM content_moderation_jobs
     WHERE provider_job_id IS NOT NULL AND TRIM(provider_job_id) <> ''
     GROUP BY provider, provider_job_id
     HAVING COUNT(*) > 1`
  );
  return rows;
}

async function normalizeLegacyProviderJobDuplicates(connection, duplicates) {
  for (const duplicate of duplicates) {
    await connection.query(
      `UPDATE content_moderation_jobs
       SET provider_job_id = NULL,
           status = CASE WHEN status = 'processing' THEN 'error' ELSE status END,
           last_error_code = CASE
             WHEN last_error_code IS NULL OR last_error_code = '' THEN ?
             ELSE last_error_code
           END
       WHERE provider = ? AND provider_job_id = ? AND id <> ?`,
      [
        CONTENT_MODERATION_PROVIDER_JOB_DUPLICATE,
        duplicate.provider,
        duplicate.provider_job_id,
        Number(duplicate.canonical_job_id)
      ]
    );
  }
}

async function findProviderAwareJobKeyDuplicates(connection) {
  const [rows] = await connection.query(
    `SELECT subject_type, subject_id, subject_version, provider, COUNT(*) AS duplicate_count
     FROM content_moderation_jobs
     GROUP BY subject_type, subject_id, subject_version, provider
     HAVING COUNT(*) > 1`
  );
  return rows;
}

function contentModerationAttemptsTableSql() {
  return `CREATE TABLE IF NOT EXISTS content_moderation_provider_attempts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    moderation_job_id BIGINT UNSIGNED NOT NULL,
    provider VARCHAR(32) NOT NULL,
    provider_job_id VARCHAR(128) NOT NULL,
    attempt_no INT UNSIGNED NOT NULL,
    is_current TINYINT(1) NOT NULL DEFAULT 1,
    submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    response_summary_json JSON NULL,
    current_job_id BIGINT UNSIGNED
      GENERATED ALWAYS AS (
        CASE WHEN is_current = 1 THEN moderation_job_id ELSE NULL END
      ) VIRTUAL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_moderation_attempt_provider_job (provider, provider_job_id),
    UNIQUE KEY uniq_moderation_attempt_job_no (moderation_job_id, attempt_no),
    UNIQUE KEY uniq_moderation_attempt_current_job (current_job_id),
    INDEX idx_moderation_attempt_job_current (moderation_job_id, is_current),
    CONSTRAINT fk_moderation_attempt_job
      FOREIGN KEY (moderation_job_id) REFERENCES content_moderation_jobs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
}

function proposalDuplicateError(rows) {
  const error = new Error("content moderation proposal idempotency keys are duplicated");
  error.code = "CONTENT_MODERATION_PROPOSAL_IDEMPOTENCY_DUPLICATE";
  error.details = { duplicates: rows };
  return error;
}

async function findProposalIdempotencyDuplicates(connection, { actionExists, idempotencyKeyExists }) {
  const actionExpression = actionExists
    ? "COALESCE(action, CONCAT('legacy_', LEFT(subject_type, 56)))"
    : "CONCAT('legacy_', LEFT(subject_type, 56))";
  const idempotencyExpression = idempotencyKeyExists
    ? "COALESCE(idempotency_key, CONCAT('legacy_', id))"
    : "CONCAT('legacy_', id)";
  const [rows] = await connection.query(
    `SELECT
       created_by_user_id,
       ${actionExpression} AS normalized_action,
       ${idempotencyExpression} AS normalized_idempotency_key,
       COUNT(*) AS duplicate_count
     FROM content_moderation_text_proposals
     GROUP BY created_by_user_id, ${actionExpression}, ${idempotencyExpression}
     HAVING COUNT(*) > 1`
  );
  return rows;
}

export async function reconcileContentModerationProviderAttempts(connection) {
  const [legacyJobIndex, providerJobIndex, attemptsTable, proposalColumns, proposalIndex] = await Promise.all([
    inspectExpectedIndex(connection, "content_moderation_jobs", "uniq_moderation_subject_version", {
      unique: true,
      columns: ["subject_type", "subject_id", "subject_version"]
    }),
    inspectExpectedIndex(connection, "content_moderation_jobs", "uniq_moderation_subject_version_provider", {
      unique: true,
      columns: ["subject_type", "subject_id", "subject_version", "provider"]
    }),
    inspectAttemptsTable(connection),
    inspectTextProposalColumns(connection),
    inspectExpectedIndex(connection, CONTENT_MODERATION_TEXT_PROPOSALS_TABLE, "uniq_moderation_text_actor_action_idempotency", {
      unique: true,
      columns: ["created_by_user_id", "action", "idempotency_key"]
    })
  ]);
  assertTextProposalColumnLifecycle(proposalColumns, proposalIndex);
  const [jobKeyDuplicates, proposalDuplicates, providerJobDuplicates] = await Promise.all([
    findProviderAwareJobKeyDuplicates(connection),
    findProposalIdempotencyDuplicates(connection, {
      actionExists: proposalColumns.action.exists,
      idempotencyKeyExists: proposalColumns.idempotency_key.exists
    }),
    findLegacyProviderJobDuplicates(connection)
  ]);
  if (jobKeyDuplicates.length > 0) throw duplicateJobKeyError(jobKeyDuplicates);
  if (proposalDuplicates.length > 0) throw proposalDuplicateError(proposalDuplicates);

  await normalizeLegacyProviderJobDuplicates(connection, providerJobDuplicates);

  if (!providerJobIndex.exists) {
    await connection.query(
      `ALTER TABLE content_moderation_jobs
       ADD UNIQUE KEY uniq_moderation_subject_version_provider
         (subject_type, subject_id, subject_version, provider)`
    );
  }
  if (legacyJobIndex.exists) {
    await connection.query(
      "ALTER TABLE content_moderation_jobs DROP INDEX uniq_moderation_subject_version"
    );
  }

  if (!attemptsTable.exists) {
    await connection.query(contentModerationAttemptsTableSql());
  }

  await connection.query(
    `INSERT INTO content_moderation_provider_attempts
      (moderation_job_id, provider, provider_job_id, attempt_no, is_current, submitted_at, response_summary_json)
     SELECT
       job.id,
       job.provider,
       job.provider_job_id,
       GREATEST(job.attempt_count, 1),
       1,
       COALESCE(job.submitted_at, job.created_at),
       job.response_summary_json
     FROM content_moderation_jobs AS job
     WHERE job.provider_job_id IS NOT NULL AND TRIM(job.provider_job_id) <> ''
       AND NOT EXISTS (
         SELECT 1
         FROM content_moderation_provider_attempts AS attempt
         WHERE attempt.moderation_job_id = job.id
       )`
  );
  await connection.query(
    `UPDATE content_moderation_jobs
     SET attempt_count = GREATEST(attempt_count, 1)
     WHERE provider_job_id IS NOT NULL AND TRIM(provider_job_id) <> ''`
  );

  if (!proposalColumns.action.exists) {
    await connection.query(
      "ALTER TABLE content_moderation_text_proposals ADD COLUMN action VARCHAR(64) NULL AFTER base_version"
    );
  }
  if (!proposalColumns.idempotency_key.exists) {
    await connection.query(
      "ALTER TABLE content_moderation_text_proposals ADD COLUMN idempotency_key VARCHAR(128) NULL AFTER payload_digest"
    );
  }
  await connection.query(
    `UPDATE content_moderation_text_proposals
     SET
       action = CONCAT('legacy_', LEFT(subject_type, 56)),
       idempotency_key = CONCAT('legacy_', id)
     WHERE action IS NULL OR idempotency_key IS NULL`
  );
  if (!proposalColumns.action.exists || proposalColumns.action.isNullable !== "NO") {
    await connection.query(
      "ALTER TABLE content_moderation_text_proposals MODIFY COLUMN action VARCHAR(64) NOT NULL"
    );
  }
  if (!proposalColumns.idempotency_key.exists || proposalColumns.idempotency_key.isNullable !== "NO") {
    await connection.query(
      "ALTER TABLE content_moderation_text_proposals MODIFY COLUMN idempotency_key VARCHAR(128) NOT NULL"
    );
  }

  if (!proposalIndex.exists) {
    await connection.query(
      `ALTER TABLE content_moderation_text_proposals
       ADD UNIQUE KEY uniq_moderation_text_actor_action_idempotency
         (created_by_user_id, action, idempotency_key)`
    );
  }
}

export async function prepareMigration(connection, filename) {
  if (filename === CONTENT_MODERATION_PROVIDER_ATTEMPTS_MIGRATION) {
    await reconcileContentModerationProviderAttempts(connection);
    return { skipStatements: true, reconciledContentModeration: true };
  }
  if (filename === CONTENT_MODERATION_TEXT_PROPOSAL_RESULT_MIGRATION) {
    await reconcileContentModerationTextProposalResult(connection);
    return { skipStatements: true, reconciledContentModeration: true };
  }
  if (filename === CONTENT_MODERATION_RETRY_EXHAUSTION_MIGRATION) {
    await reconcileContentModerationRetryExhaustion(connection);
    return { skipStatements: true, reconciledContentModeration: true };
  }
  if (filename !== SESSION_ALBUM_VIDEO_HARDENING_MIGRATION) {
    return { skipStatements: false };
  }

  const index = await inspectSessionAlbumVideoSourceIndex(connection);
  if (index.exists) {
    return { skipStatements: true, reconciledExistingIndex: true };
  }
  await assertSessionAlbumVideoSourceUrlsUnique(connection);
  return { skipStatements: false, reconciledExistingIndex: false };
}
