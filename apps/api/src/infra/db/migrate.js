import {
  applyMigration,
  ensureMigrationsTable,
  reconcileMigrationChecksums,
  runMigrations,
  serializeMigrationError,
  sha256Checksum
} from "../../db/migrate.js";

export {
  applyMigration,
  ensureMigrationsTable,
  reconcileMigrationChecksums,
  runMigrations,
  serializeMigrationError
};

export const migrationChecksum = sha256Checksum;

export function verifyAppliedMigration(applied, sql) {
  const expected = String(applied?.checksum || applied?.checksum_sha256 || "");
  const actual = migrationChecksum(sql);
  if (expected !== actual) {
    const error = new Error("migration checksum does not match applied history");
    error.code = "MIGRATION_CHECKSUM_MISMATCH";
    error.details = { version: applied?.version };
    throw error;
  }
  return true;
}
