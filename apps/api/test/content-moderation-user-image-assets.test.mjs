import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createUserImageAssetUploadService,
  projectUserImageAssetStatus
} from "../src/modules/user-image-assets/service.js";
import {
  reconcileUserImageAssetsMigration
} from "../src/modules/user-image-assets/migration.js";
import * as userImageRepository from "../src/modules/user-image-assets/repository.js";
import { requiredSchemaTables } from "../src/db/mysql.js";

const migrationUrl = new URL("../migrations/0031_user_image_assets.sql", import.meta.url);

test("D46 avatar and review image migration creates immutable assets and backfills published references", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /CREATE TABLE user_image_assets/i);
  assert.match(sql, /owner_user_id BIGINT UNSIGNED NOT NULL/i);
  assert.match(sql, /kind VARCHAR\(32\) NOT NULL/i);
  assert.match(sql, /asset_path VARCHAR\(512\) NOT NULL/i);
  assert.match(sql, /object_key VARCHAR\(512\) NULL/i);
  assert.match(sql, /object_version VARCHAR\(128\) NOT NULL/i);
  assert.match(sql, /CREATE TABLE user_image_upload_operations/i);
  assert.match(sql, /scope_key VARCHAR\(256\) NOT NULL/i);
  assert.match(sql, /operation_id VARCHAR\(128\) NOT NULL/i);
  assert.match(sql, /UNIQUE KEY uniq_user_image_upload_operation[\s\S]*owner_user_id, kind, scope_key, operation_id/i);
  assert.match(sql, /moderation_status VARCHAR\(32\) NOT NULL DEFAULT 'approved_legacy'/i);
  assert.match(sql, /status VARCHAR\(32\) NOT NULL DEFAULT 'active'/i);
  assert.match(sql, /UNIQUE KEY uniq_user_image_asset_owner_path \(owner_user_id, asset_path\)/i);
  assert.match(sql, /KEY idx_user_image_asset_path \(asset_path\)/i);
  assert.match(sql, /KEY idx_user_image_asset_object_key \(object_key\)/i);
  assert.match(sql, /ADD COLUMN avatar_image_asset_id BIGINT UNSIGNED NULL/i);
  assert.match(sql, /ADD COLUMN image_asset_id BIGINT UNSIGNED NULL/i);
  assert.match(sql, /INSERT INTO user_image_assets[\s\S]*'avatar'[\s\S]*'approved_legacy'/i);
  assert.match(sql, /INSERT INTO user_image_assets[\s\S]*'review'[\s\S]*'approved_legacy'/i);
  assert.match(sql, /ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID\(user_image_assets\.id\)/i);
  assert.match(sql, /GROUP BY review\.user_id, photo\.photo_url/i);
  assert.match(sql, /MODIFY COLUMN image_asset_id BIGINT UNSIGNED NOT NULL/i);
  assert.match(sql, /cleanup_not_before DATETIME NOT NULL/i);
  assert.match(sql, /CREATE TABLE user_image_object_cleanup_jobs/i);
  assert.match(sql, /UNIQUE KEY uniq_user_image_object_cleanup \(storage_kind, object_key\)/i);
  assert.doesNotMatch(sql, /UPDATE user_image_assets[\s\S]*moderation_status\s*=\s*'pending'/i);
  assert.equal(requiredSchemaTables.includes("user_image_asset_cleanup_jobs"), true);
  assert.equal(requiredSchemaTables.includes("user_image_object_cleanup_jobs"), true);
  assert.equal(requiredSchemaTables.includes("user_image_upload_operations"), true);
});

test("backend upload operation lookup is exact for authenticated owner, kind, and scope", async () => {
  assert.equal(typeof userImageRepository.findUserImageAssetByUploadOperation, "function");
  if (typeof userImageRepository.findUserImageAssetByUploadOperation !== "function") return;
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return [[{
        id: 91,
        owner_user_id: 7,
        kind: "review",
        upload_scope_key: "user:7:session:9",
        upload_operation_id: "sessionReviewPhoto-operation-123"
      }]];
    }
  };
  const asset = await userImageRepository.findUserImageAssetByUploadOperation(connection, {
    ownerUserId: 7,
    kind: "review",
    scopeKey: "user:7:session:9",
    operationId: "sessionReviewPhoto-operation-123"
  });
  assert.equal(asset.id, 91);
  assert.match(calls[0].sql, /owner_user_id = \?/);
  assert.match(calls[0].sql, /kind = \?/);
  assert.match(calls[0].sql, /operation\.scope_key = \?/);
  assert.match(calls[0].sql, /operation\.operation_id = \?/);
  assert.deepEqual(calls[0].params, [
    7,
    "review",
    "user:7:session:9",
    "sessionReviewPhoto-operation-123"
  ]);
});

test("legacy review backfill creates one owner-scoped asset and binds every reference", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.doesNotMatch(sql, /UNIQUE KEY uniq_user_image_asset_path \(asset_path\)/i);
  assert.match(sql, /ON asset\.owner_user_id = review\.user_id[\s\S]*asset\.asset_path = photo\.photo_url/i);
  assert.match(sql, /SET photo\.image_asset_id = asset\.id/i);
  assert.match(sql, /image_asset_id IS NULL[\s\S]*(SIGNAL|migration)/i);
});

test("raw path lookup deterministically selects a published duplicate across owners", async () => {
  assert.equal(typeof userImageRepository.findPublishedUserImageAssetByPath, "function");
  const connection = {
    async query(sql, params) {
      const text = String(sql);
      assert.match(text, /asset_path = \?/);
      assert.match(text, /status = 'active'/);
      assert.match(text, /moderation_status IN \(\?, \?\)/);
      assert.match(text, /ORDER BY id/);
      assert.deepEqual(params.slice(0, 1), ["/uploads/avatars/shared.jpg"]);
      return [[{
        id: 22,
        owner_user_id: 8,
        asset_path: "/uploads/avatars/shared.jpg",
        moderation_status: "approved_legacy",
        status: "active"
      }]];
    }
  };
  assert.equal((await userImageRepository.findPublishedUserImageAssetByPath(
    connection,
    "/uploads/avatars/shared.jpg"
  )).id, 22);
});

test("raw read state distinguishes zero rows from hidden-only and published duplicate groups", async () => {
  assert.equal(typeof userImageRepository.findUserImageAssetReadStateByPath, "function");
  const rows = [
    {
      id: 22,
      owner_user_id: 8,
      asset_path: "/uploads/avatars/shared.jpg",
      moderation_status: "approved_legacy",
      status: "active",
      is_published: 1
    },
    {
      id: 21,
      owner_user_id: 7,
      asset_path: "/uploads/avatars/hidden.jpg",
      moderation_status: "rejected",
      status: "active",
      is_published: 0
    },
    null
  ];
  const connection = {
    async query(sql) {
      const text = String(sql);
      assert.match(text, /asset_path = \?/);
      assert.match(text, /AS is_published/);
      assert.match(text, /ORDER BY is_published DESC, id/);
      const row = rows.shift();
      return [row ? [row] : []];
    }
  };

  assert.deepEqual(await userImageRepository.findUserImageAssetReadStateByPath(
    connection,
    "/uploads/avatars/shared.jpg"
  ), { known: true, published: true });
  assert.deepEqual(await userImageRepository.findUserImageAssetReadStateByPath(
    connection,
    "/uploads/avatars/hidden.jpg"
  ), { known: true, published: false });
  assert.deepEqual(await userImageRepository.findUserImageAssetReadStateByPath(
    connection,
    "/uploads/avatars/legacy.jpg"
  ), { known: false, published: false });
});

function harness({
  moderationRequired = false,
  jobHook = true,
  existingAsset = null,
  duplicateWinner = null,
  intakeError = null,
  probeAsset = undefined,
  cleanupProtected = true
} = {}) {
  const timeline = [];
  const inserted = [];
  const jobs = [];
  const submitted = [];
  const boundOperations = [];
  const asset = {
    id: 31,
    owner_user_id: 7,
    kind: "avatar",
    asset_path: "/uploads/avatars/user-7.webp",
    object_key: "uploads/avatars/user-7.webp",
    object_version: "etag-31",
    moderation_status: moderationRequired ? "pending" : "approved_legacy",
    status: "active"
  };
  const service = createUserImageAssetUploadService({
    probeUserImageAssetByOwnerPath: async () => {
      timeline.push("asset_probe");
      return probeAsset === undefined ? existingAsset : probeAsset;
    },
    transaction: async (run) => {
      timeline.push("transaction_begin");
      const result = await run({});
      timeline.push("transaction_commit");
      return result;
    },
    assertImageIntake: async () => {
      timeline.push("settings_lock");
      if (intakeError) throw intakeError;
      return { moderationRequired };
    },
    repository: {
      findUserImageAssetByOwnerPath: async () => {
        timeline.push("asset_lookup");
        return timeline.filter((entry) => entry === "asset_lookup").length > 1
          ? duplicateWinner || existingAsset
          : existingAsset;
      },
      insertUserImageAsset: async (_connection, input) => {
        timeline.push("asset_insert");
        if (duplicateWinner) throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
        inserted.push(input);
        return { ...asset, moderation_status: input.moderationStatus };
      },
      protectUserImageUploadCleanup: async () => {
        timeline.push("cleanup_protect");
        return cleanupProtected;
      },
      bindUserImageUploadOperation: async (_connection, operation) => {
        timeline.push("operation_bind");
        boundOperations.push(operation);
        return true;
      }
    },
    createWechatImageModerationJob: jobHook
      ? async (_connection, input) => {
          timeline.push("job_insert");
          jobs.push(input);
          return { id: 91, status: "pending", subject_type: input.subjectType };
        }
      : undefined,
    submitWechatImageModeration: jobHook
      ? async (job) => {
          timeline.push("provider_submit");
          submitted.push(job);
        }
      : undefined
  });
  return { service, timeline, inserted, jobs, submitted, boundOperations };
}

const input = {
  ownerUserId: 7,
  kind: "avatar",
  path: "/uploads/avatars/user-7.webp",
  objectKey: "uploads/avatars/user-7.webp",
  objectVersion: "etag-31"
};

test("unavailable image capability preserves direct publication while recording an approved legacy asset", async () => {
  const { service, timeline, inserted, jobs, submitted } = harness();

  const result = await service.finalizeUploadedImage(input);

  assert.deepEqual(timeline, ["asset_probe", "transaction_begin", "settings_lock", "asset_lookup", "asset_insert", "cleanup_protect", "transaction_commit"]);
  assert.equal(inserted[0].moderationStatus, "approved_legacy");
  assert.deepEqual(jobs, []);
  assert.deepEqual(submitted, []);
  assert.deepEqual(result, {
    assetId: 31,
    kind: "avatar",
    moderationStatus: "approved_legacy",
    status: "active",
    path: "/uploads/avatars/user-7.webp"
  });
});

test("backend upload operation is bound to the asset inside its finalize transaction", async () => {
  const { service, timeline, boundOperations } = harness();
  await service.finalizeUploadedImage({
    ...input,
    uploadOperationId: "avatar-operation-123456789",
    uploadScopeKey: "user:7:avatar"
  });
  assert.deepEqual(boundOperations, [{
    ownerUserId: 7,
    kind: "avatar",
    scopeKey: "user:7:avatar",
    operationId: "avatar-operation-123456789",
    assetId: 31
  }]);
  assert.deepEqual(timeline.slice(-3), [
    "cleanup_protect", "operation_bind", "transaction_commit"
  ]);
});

test("available image capability creates a pending asset and D45 job before post-commit submission", async () => {
  const { service, timeline, inserted, jobs, submitted } = harness({ moderationRequired: true });

  const result = await service.finalizeUploadedImage(input);

  assert.deepEqual(timeline, [
    "asset_probe",
    "transaction_begin",
    "settings_lock",
    "asset_lookup",
    "asset_insert",
    "cleanup_protect",
    "job_insert",
    "transaction_commit",
    "provider_submit"
  ]);
  assert.equal(inserted[0].moderationStatus, "pending");
  assert.equal(jobs[0].subjectType, "avatar_image");
  assert.equal(jobs[0].media.id, 31);
  assert.equal(jobs[0].media.uploader_user_id, 7);
  assert.equal(jobs[0].objectKey, "uploads/avatars/user-7.webp");
  assert.equal(jobs[0].subjectVersion, "etag-31");
  assert.equal(submitted.length, 1);
  assert.deepEqual(result, {
    assetId: 31,
    kind: "avatar",
    moderationStatus: "pending",
    status: "active"
  });
});

test("required moderation without the shared D45 job hooks fails before the asset write", async () => {
  const { service, timeline, inserted } = harness({ moderationRequired: true, jobHook: false });

  await assert.rejects(service.finalizeUploadedImage(input), {
    code: "CONTENT_MODERATION_CONFIGURATION_ERROR",
    statusCode: 500
  });
  assert.deepEqual(timeline, ["asset_probe", "transaction_begin", "settings_lock", "asset_lookup"]);
  assert.deepEqual(inserted, []);
});

test("image asset upload facts reject mutable or cross-kind paths before a transaction", async () => {
  const { service, timeline } = harness();

  for (const invalid of [
    { ...input, path: "/uploads/session-reviews/review-7.jpg" },
    { ...input, objectKey: "uploads/avatars/../secret.webp" },
    { ...input, objectVersion: "" },
    { ...input, ownerUserId: 0 }
  ]) {
    await assert.rejects(service.finalizeUploadedImage(invalid), /image asset/i);
  }
  assert.deepEqual(timeline, []);
});

test("same-owner immutable finalize replays an existing asset without another job or insert", async () => {
  const existing = {
    id: 31,
    owner_user_id: 7,
    kind: "avatar",
    asset_path: input.path,
    object_key: input.objectKey,
    object_version: input.objectVersion,
    moderation_status: "approved",
    status: "active"
  };
  const { service, timeline, inserted, jobs, submitted } = harness({
    moderationRequired: true,
    existingAsset: existing
  });

  const result = await service.finalizeUploadedImage(input);

  assert.deepEqual(result, {
    assetId: 31,
    kind: "avatar",
    moderationStatus: "approved",
    status: "active",
    path: input.path
  });
  assert.deepEqual(timeline, ["asset_probe", "transaction_begin", "asset_lookup", "cleanup_protect", "transaction_commit"]);
  assert.deepEqual(inserted, []);
  assert.deepEqual(jobs, []);
  assert.deepEqual(submitted, []);
});

test("a lost finalize response replays its existing pending asset before a later unavailable block", async () => {
  const existing = {
    id: 31,
    owner_user_id: 7,
    kind: "avatar",
    asset_path: input.path,
    object_key: input.objectKey,
    object_version: input.objectVersion,
    moderation_status: "pending",
    status: "active"
  };
  const blockError = Object.assign(new Error("current fallback blocks new images"), {
    code: "CONTENT_MODERATION_UNAVAILABLE",
    statusCode: 503
  });
  const { service, timeline, inserted, jobs, submitted } = harness({
    existingAsset: existing,
    intakeError: blockError
  });

  assert.deepEqual(await service.finalizeUploadedImage(input), {
    assetId: 31,
    kind: "avatar",
    moderationStatus: "pending",
    status: "active"
  });
  assert.deepEqual(timeline, [
    "asset_probe", "transaction_begin", "asset_lookup", "cleanup_protect", "transaction_commit"
  ]);
  assert.deepEqual(inserted, []);
  assert.deepEqual(jobs, []);
  assert.deepEqual(submitted, []);
});

test("a null probe replays an exact concurrent winner found after the settings lock blocks intake", async () => {
  const winner = {
    id: 31,
    owner_user_id: 7,
    kind: "avatar",
    asset_path: input.path,
    object_key: input.objectKey,
    object_version: input.objectVersion,
    moderation_status: "pending",
    status: "active"
  };
  const blockError = Object.assign(new Error("new images are blocked"), {
    code: "CONTENT_MODERATION_UNAVAILABLE",
    statusCode: 503
  });
  const { service, timeline, inserted } = harness({
    probeAsset: null,
    existingAsset: winner,
    intakeError: blockError
  });

  assert.deepEqual(await service.finalizeUploadedImage(input), {
    assetId: 31,
    kind: "avatar",
    moderationStatus: "pending",
    status: "active"
  });
  assert.deepEqual(timeline, [
    "asset_probe", "transaction_begin", "settings_lock", "asset_lookup",
    "cleanup_protect", "transaction_commit"
  ]);
  assert.deepEqual(inserted, []);
});

test("a concurrent duplicate finalize protects the existing upload cleanup anchor", async () => {
  const winner = {
    id: 31,
    owner_user_id: 7,
    kind: "avatar",
    asset_path: input.path,
    object_key: input.objectKey,
    object_version: input.objectVersion,
    moderation_status: "pending",
    status: "active"
  };
  const { service, timeline } = harness({ moderationRequired: true, duplicateWinner: winner });

  assert.deepEqual(await service.finalizeUploadedImage(input), {
    assetId: 31,
    kind: "avatar",
    moderationStatus: "pending",
    status: "active"
  });
  assert.deepEqual(timeline, [
    "asset_probe", "transaction_begin", "settings_lock", "asset_lookup", "asset_insert",
    "asset_lookup", "cleanup_protect", "transaction_commit"
  ]);
});

test("a committed cleanup deletion decision prevents a late finalize claim", async () => {
  const existing = {
    id: 31,
    owner_user_id: 7,
    kind: "avatar",
    asset_path: input.path,
    object_key: input.objectKey,
    object_version: input.objectVersion,
    moderation_status: "approved",
    status: "active"
  };
  const { service, timeline } = harness({
    existingAsset: existing,
    cleanupProtected: false
  });

  await assert.rejects(service.finalizeUploadedImage(input), {
    code: "CONTENT_MODERATION_CONFIGURATION_ERROR"
  });
  assert.deepEqual(timeline, [
    "asset_probe", "transaction_begin", "asset_lookup", "cleanup_protect"
  ]);
});

test("asset status projection releases paths only for active approved states", () => {
  const base = {
    id: 31,
    owner_user_id: 7,
    kind: "review",
    asset_path: "/uploads/session-reviews/review-7.jpg",
    status: "active"
  };
  for (const moderationStatus of ["pending", "error", "review", "rejected"]) {
    assert.deepEqual(projectUserImageAssetStatus({
      ...base,
      moderation_status: moderationStatus
    }), {
      assetId: 31,
      kind: "review",
      moderationStatus,
      status: "active"
    });
  }
  for (const moderationStatus of ["approved", "approved_legacy"]) {
    assert.deepEqual(projectUserImageAssetStatus({
      ...base,
      moderation_status: moderationStatus
    }), {
      assetId: 31,
      kind: "review",
      moderationStatus,
      status: "active",
      path: base.asset_path
    });
  }
  assert.deepEqual(projectUserImageAssetStatus({
    ...base,
    status: "deleted",
    moderation_status: "approved"
  }), {
    assetId: 31,
    kind: "review",
    moderationStatus: "approved",
    status: "deleted"
  });
});

const assetColumns = [
  ["id", "bigint unsigned", "NO", null, "auto_increment"],
  ["owner_user_id", "bigint unsigned", "NO", null, ""],
  ["kind", "varchar(32)", "NO", null, ""],
  ["asset_path", "varchar(512)", "NO", null, ""],
  ["object_key", "varchar(512)", "YES", null, ""],
  ["object_version", "varchar(128)", "NO", null, ""],
  ["moderation_status", "varchar(32)", "NO", "approved_legacy", ""],
  ["status", "varchar(32)", "NO", "active", ""],
  ["created_at", "datetime(3)", "NO", "CURRENT_TIMESTAMP(3)", "DEFAULT_GENERATED"]
].map(([column_name, column_type, is_nullable, column_default, extra]) => ({
  column_name, column_type, is_nullable, column_default, extra
}));

const cleanupColumns = [
  ["id", "bigint unsigned", "NO", null, "auto_increment"],
  ["user_image_asset_id", "bigint unsigned", "YES", null, ""],
  ["owner_user_id", "bigint unsigned", "NO", null, ""],
  ["asset_path", "varchar(512)", "NO", null, ""],
  ["object_key", "varchar(512)", "NO", null, ""],
  ["storage_kind", "varchar(16)", "NO", null, ""],
  ["status", "varchar(32)", "NO", "pending", ""],
  ["attempts", "int unsigned", "NO", "0", ""],
  ["cleanup_not_before", "datetime", "NO", null, ""],
  ["next_retry_at", "datetime", "YES", null, ""],
  ["last_error_code", "varchar(64)", "YES", null, ""],
  ["lease_token", "char(36)", "YES", null, ""],
  ["lease_expires_at", "datetime", "YES", null, ""],
  ["created_at", "datetime", "NO", "CURRENT_TIMESTAMP", "DEFAULT_GENERATED"],
  ["updated_at", "datetime", "NO", "CURRENT_TIMESTAMP", "DEFAULT_GENERATED on update CURRENT_TIMESTAMP"],
  ["completed_at", "datetime", "YES", null, ""]
].map(([column_name, column_type, is_nullable, column_default, extra]) => ({
  column_name, column_type, is_nullable, column_default, extra
}));

const objectCleanupColumns = cleanupColumns
  .filter((column) => !["user_image_asset_id", "owner_user_id"].includes(column.column_name));

const uploadOperationColumns = [
  ["id", "bigint unsigned", "NO", null, "auto_increment"],
  ["owner_user_id", "bigint unsigned", "NO", null, ""],
  ["kind", "varchar(32)", "NO", null, ""],
  ["scope_key", "varchar(256)", "NO", null, ""],
  ["operation_id", "varchar(128)", "NO", null, ""],
  ["user_image_asset_id", "bigint unsigned", "NO", null, ""],
  ["created_at", "datetime", "NO", "CURRENT_TIMESTAMP", "DEFAULT_GENERATED"]
].map(([column_name, column_type, is_nullable, column_default, extra]) => ({
  column_name, column_type, is_nullable, column_default, extra
}));

function overrideColumns(columns, overrides = {}) {
  return columns.map((column) => ({ ...column, ...(overrides[column.column_name] || {}) }));
}

function partialMigrationConnection() {
  const ddl = [];
  const queries = [];
  return {
    ddl,
    queries,
    async query(sql, params = []) {
      const text = String(sql);
      queries.push(text);
      if (/information_schema\.tables/.test(text)) {
        return [[params[0] === "user_image_assets" ? { table_name: params[0], engine: "InnoDB" } : undefined].filter(Boolean)];
      }
      if (/information_schema\.columns/.test(text)) {
        if (params[0] === "user_image_assets") return [assetColumns];
        if (params[0] === "users") {
          return [[{ column_name: "avatar_image_asset_id", column_type: "bigint unsigned", is_nullable: "YES" }]];
        }
        if (params[0] === "session_review_photos") {
          return [[{ column_name: "image_asset_id", column_type: "bigint unsigned", is_nullable: "YES" }]];
        }
        return [[]];
      }
      if (/information_schema\.statistics/.test(text)) {
        if (params[1] === "uniq_user_image_asset_path") {
          return [[{ non_unique: 0, column_name: "asset_path", seq_in_index: 1, sub_part: null }]];
        }
        return [[]];
      }
      if (/information_schema\.referential_constraints/.test(text)) return [[]];
      if (/missing_count/.test(text)) return [[{ missing_count: 0 }]];
      if (/^(CREATE|ALTER)/i.test(text.trim())) ddl.push(text.replace(/\s+/g, " ").trim());
      return [{ affectedRows: 1, insertId: 1 }];
    }
  };
}

test("0031 reconciliation resumes after a partial MySQL DDL application", async () => {
  const connection = partialMigrationConnection();

  const result = await reconcileUserImageAssetsMigration(connection);

  assert.equal(result.reconciledUserImageAssets, true);
  assert.equal(connection.ddl.some((sql) => sql.includes("DROP INDEX uniq_user_image_asset_path")), true);
  assert.equal(connection.ddl.some((sql) => sql.includes("ADD UNIQUE KEY uniq_user_image_asset_owner_path")), true);
  assert.equal(connection.ddl.some((sql) => sql.includes("CREATE TABLE user_image_asset_cleanup_jobs")), true);
  assert.equal(connection.ddl.some((sql) => sql.includes("MODIFY COLUMN image_asset_id BIGINT UNSIGNED NOT NULL")), true);
  assert.equal(
    connection.queries.filter((sql) => /INSERT INTO user_image_assets/.test(sql)).every((sql) =>
      /LAST_INSERT_ID\(user_image_assets\.id\)/.test(sql)
    ),
    true
  );
});

test("0031 reconciliation refuses to record an incomplete historical review binding", async () => {
  const connection = partialMigrationConnection();
  const originalQuery = connection.query.bind(connection);
  connection.query = async (sql, params) => {
    if (/missing_count/.test(String(sql))) return [[{ missing_count: 1 }]];
    return originalQuery(sql, params);
  };

  await assert.rejects(reconcileUserImageAssetsMigration(connection), {
    code: "USER_IMAGE_ASSET_MIGRATION_UNBOUND_REVIEW"
  });
  assert.equal(connection.ddl.some((sql) => sql.includes("MODIFY COLUMN image_asset_id")), false);
});

test("0031 reconciliation refuses to record while a non-empty historical avatar is unbound", async () => {
  const connection = partialMigrationConnection();
  const originalQuery = connection.query.bind(connection);
  connection.query = async (sql, params) => {
    const text = String(sql);
    if (/historical_avatar_missing_count/.test(text)) {
      return [[{ historical_avatar_missing_count: 1 }]];
    }
    return originalQuery(sql, params);
  };

  await assert.rejects(reconcileUserImageAssetsMigration(connection), {
    code: "USER_IMAGE_ASSET_MIGRATION_UNBOUND_AVATAR"
  });
  assert.equal(
    connection.ddl.some((sql) => sql.includes("CREATE TABLE user_image_asset_cleanup_jobs")),
    false
  );
});

function existingInvariantMigrationConnection({
  indexes = {}, foreignKeys = {}, checks = {}, assetOverrides = {}, cleanupOverrides = {},
  objectCleanupOverrides = {}
} = {}) {
  const ddl = [];
  return {
    ddl,
    async query(sql, params = []) {
      const text = String(sql);
      if (/information_schema\.tables/.test(text)) {
        return [[{ table_name: params[0], engine: "InnoDB" }]];
      }
      if (/information_schema\.columns/.test(text)) {
        if (params[0] === "user_image_assets") return [overrideColumns(assetColumns, assetOverrides)];
        if (params[0] === "user_image_asset_cleanup_jobs") {
          return [overrideColumns(cleanupColumns, cleanupOverrides)];
        }
        if (params[0] === "user_image_object_cleanup_jobs") {
          return [overrideColumns(objectCleanupColumns, objectCleanupOverrides)];
        }
        if (params[0] === "user_image_upload_operations") return [uploadOperationColumns];
        if (params[0] === "users") {
          return [[{ column_name: "avatar_image_asset_id", column_type: "bigint unsigned", is_nullable: "YES" }]];
        }
        return [[{ column_name: "image_asset_id", column_type: "bigint unsigned", is_nullable: "NO" }]];
      }
      if (/information_schema\.statistics/.test(text)) {
        return [indexes[`${params[0]}.${params[1]}`] || []];
      }
      if (/information_schema\.referential_constraints/.test(text)) {
        const row = foreignKeys[`${params[0]}.${params[1]}`];
        return [row ? [row] : []];
      }
      if (/information_schema\.check_constraints/.test(text)) {
        const row = checks[`${params[0]}.${params[1]}`];
        return [row ? [row] : []];
      }
      if (/historical_avatar_missing_count/.test(text)) {
        return [[{ historical_avatar_missing_count: 0 }]];
      }
      if (/missing_count/.test(text)) return [[{ missing_count: 0 }]];
      if (/^(CREATE|ALTER)/i.test(text.trim())) ddl.push(text.replace(/\s+/g, " ").trim());
      return [{ affectedRows: 1, insertId: 1 }];
    }
  };
}

test("0031 reconciles every missing runtime index, foreign key, and check on existing tables", async () => {
  const connection = existingInvariantMigrationConnection();
  await reconcileUserImageAssetsMigration(connection);
  const ddl = connection.ddl.join("\n");
  assert.equal(connection.ddl.filter((sql) => sql.includes("ADD PRIMARY KEY (id)")).length, 4);
  for (const invariant of [
    "idx_users_avatar_image_asset",
    "idx_session_review_photo_asset",
    "idx_user_image_asset_owner_kind",
    "idx_user_image_asset_moderation",
    "idx_user_image_asset_path",
    "idx_user_image_asset_object_key",
    "uniq_user_image_cleanup_asset",
    "idx_user_image_cleanup_claim",
    "uniq_user_image_object_cleanup",
    "idx_user_image_object_cleanup_claim",
    "uniq_user_image_upload_operation",
    "idx_user_image_upload_operation_asset",
    "fk_user_image_cleanup_asset",
    "fk_user_image_cleanup_owner",
    "chk_user_image_asset_kind",
    "chk_user_image_asset_status",
    "chk_user_image_asset_moderation",
    "chk_user_image_cleanup_storage",
    "chk_user_image_cleanup_status",
    "chk_user_image_object_cleanup_storage",
    "chk_user_image_object_cleanup_status",
    "fk_user_image_upload_operation_owner",
    "fk_user_image_upload_operation_asset",
    "chk_user_image_upload_operation_kind"
  ]) {
    assert.match(ddl, new RegExp(invariant));
  }
});

test("0031 accepts MySQL's UTF-8 escaped check-constraint representation", async () => {
  const connection = existingInvariantMigrationConnection({
    checks: {
      "user_image_assets.chk_user_image_asset_kind": {
        check_clause: "(`kind` in (_utf8mb4\\'avatar\\',_utf8mb4\\'review\\'))"
      }
    }
  });

  await reconcileUserImageAssetsMigration(connection);
  assert.equal(
    connection.ddl.some((sql) => sql.includes("ADD CONSTRAINT chk_user_image_asset_kind")),
    false
  );
});

test("0031 rejects wrong existing avatar and review binding index shapes", async () => {
  for (const [scope, rows] of [
    ["users.idx_users_avatar_image_asset", [
      { non_unique: 0, column_name: "avatar_image_asset_id", seq_in_index: 1, sub_part: null }
    ]],
    ["session_review_photos.idx_session_review_photo_asset", [
      { non_unique: 1, column_name: "photo_url", seq_in_index: 1, sub_part: null }
    ]]
  ]) {
    const connection = existingInvariantMigrationConnection({
      indexes: { [scope]: rows }
    });
    await assert.rejects(reconcileUserImageAssetsMigration(connection), (error) =>
      error?.code === "USER_IMAGE_ASSET_MIGRATION_SCHEMA_MISMATCH" &&
      error?.details?.scope === scope
    );
  }
});

test("0031 rejects a wrong existing runtime index shape", async () => {
  const connection = existingInvariantMigrationConnection({
    indexes: {
      "user_image_assets.idx_user_image_asset_owner_kind": [
        { non_unique: 1, column_name: "kind", seq_in_index: 1, sub_part: null }
      ]
    }
  });
  await assert.rejects(reconcileUserImageAssetsMigration(connection), (error) =>
    error?.code === "USER_IMAGE_ASSET_MIGRATION_SCHEMA_MISMATCH" &&
    error?.details?.scope === "user_image_assets.idx_user_image_asset_owner_kind"
  );
});

test("0031 rejects malformed asset path and object key lookup indexes", async () => {
  for (const [scope, rows] of [
    ["user_image_assets.idx_user_image_asset_path", [
      { non_unique: 1, column_name: "owner_user_id", seq_in_index: 1, sub_part: null },
      { non_unique: 1, column_name: "asset_path", seq_in_index: 2, sub_part: null }
    ]],
    ["user_image_assets.idx_user_image_asset_object_key", [
      { non_unique: 1, column_name: "object_key", seq_in_index: 1, sub_part: 191 }
    ]]
  ]) {
    const connection = existingInvariantMigrationConnection({ indexes: { [scope]: rows } });
    await assert.rejects(reconcileUserImageAssetsMigration(connection), (error) =>
      error?.code === "USER_IMAGE_ASSET_MIGRATION_SCHEMA_MISMATCH" &&
      error?.details?.scope === scope
    );
  }
});

test("0031 repairs missing runtime column defaults, auto-increment, and on-update semantics", async () => {
  const connection = existingInvariantMigrationConnection({
    assetOverrides: {
      id: { extra: "" },
      status: { column_default: null }
    },
    cleanupOverrides: {
      updated_at: { extra: "DEFAULT_GENERATED" }
    },
    objectCleanupOverrides: {
      status: { column_default: null },
      updated_at: { extra: "DEFAULT_GENERATED" }
    }
  });
  await reconcileUserImageAssetsMigration(connection);
  const ddl = connection.ddl.join("\n");
  assert.match(ddl, /user_image_assets MODIFY COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT/);
  assert.match(ddl, /user_image_assets MODIFY COLUMN status VARCHAR\(32\) NOT NULL DEFAULT 'active'/);
  assert.match(ddl, /user_image_asset_cleanup_jobs MODIFY COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP/);
  assert.match(ddl, /user_image_object_cleanup_jobs MODIFY COLUMN status VARCHAR\(32\) NOT NULL DEFAULT 'pending'/);
  assert.match(ddl, /user_image_object_cleanup_jobs MODIFY COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP/);
});

test("0031 fails closed on conflicting runtime column defaults", async () => {
  const connection = existingInvariantMigrationConnection({
    assetOverrides: { status: { column_default: "deleted" } }
  });
  await assert.rejects(reconcileUserImageAssetsMigration(connection), (error) =>
    error?.code === "USER_IMAGE_ASSET_MIGRATION_SCHEMA_MISMATCH" &&
    error?.details?.scope === "user_image_assets.status.default"
  );
});

test("0031 rejects a wrong existing cleanup foreign key", async () => {
  const connection = existingInvariantMigrationConnection({
    foreignKeys: {
      "user_image_asset_cleanup_jobs.fk_user_image_cleanup_asset": {
        column_name: "user_image_asset_id",
        referenced_table_name: "user_image_assets",
        referenced_column_name: "id",
        delete_rule: "RESTRICT"
      }
    }
  });
  await assert.rejects(reconcileUserImageAssetsMigration(connection), (error) =>
    error?.code === "USER_IMAGE_ASSET_MIGRATION_SCHEMA_MISMATCH" &&
    error?.details?.scope === "user_image_asset_cleanup_jobs.fk_user_image_cleanup_asset"
  );
});

test("0031 rejects a wrong existing cleanup check constraint", async () => {
  const connection = existingInvariantMigrationConnection({
    checks: {
      "user_image_asset_cleanup_jobs.chk_user_image_cleanup_status": {
        check_clause: "status in ('pending', 'cleaned')"
      }
    }
  });
  await assert.rejects(reconcileUserImageAssetsMigration(connection), (error) =>
    error?.code === "USER_IMAGE_ASSET_MIGRATION_SCHEMA_MISMATCH" &&
    error?.details?.scope === "user_image_asset_cleanup_jobs.chk_user_image_cleanup_status"
  );
});
