import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function filePath(relativePath) {
  return path.join(root, relativePath);
}

function exists(relativePath) {
  return fs.existsSync(filePath(relativePath));
}

function read(relativePath) {
  return exists(relativePath) ? fs.readFileSync(filePath(relativePath), "utf8") : "";
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const migrationPath = "apps/api/migrations/0021_private_catalog_review.sql";
assert(exists(migrationPath), "D33 migration file must exist");

const migration = read(migrationPath);
for (const tableName of ["stores", "scripts"]) {
  for (const token of [
    `ALTER TABLE ${tableName}`,
    "visibility VARCHAR(32) NOT NULL DEFAULT ''public''",
    "review_status VARCHAR(32) NOT NULL DEFAULT ''approved''",
    "created_by_user_id BIGINT UNSIGNED NULL",
    "reviewed_by_admin_user_id BIGINT UNSIGNED NULL",
    "review_note TEXT NULL",
    "reviewed_at DATETIME NULL",
    "merged_into_id BIGINT UNSIGNED NULL"
  ]) {
    assert(migration.includes(token), `D33 migration must add ${token} to ${tableName}`);
  }

  const indexPrefix = tableName === "stores" ? "idx_stores" : "idx_scripts";
  for (const token of [
    `${indexPrefix}_visibility_review`,
    "(visibility, review_status, status)",
    `${indexPrefix}_created_by_review`,
    "(created_by_user_id, review_status)"
  ]) {
    assert(migration.includes(token), `D33 migration must include ${token} for ${tableName}`);
  }
}
