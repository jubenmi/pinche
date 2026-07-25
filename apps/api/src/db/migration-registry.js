import {
  prepareAlbumVideoMigration,
  SESSION_ALBUM_VIDEO_HARDENING_MIGRATION,
} from "../modules/album-video/migration.js";
import {
  CONTENT_MODERATION_MIGRATIONS,
  prepareContentModerationMigration,
} from "../modules/content-moderation/migration.js";
import {
  prepareUserImageAssetsMigration,
  USER_IMAGE_ASSETS_MIGRATION,
} from "../modules/user-image-assets/migration.js";

function migrationError(code, details) {
  const error = new Error(`migration preparer registry failed: ${code}`);
  error.code = code;
  error.details = details;
  return error;
}

export const SCHEMA_MIGRATION_CHECKSUMS_MIGRATION =
  "0034_schema_migration_checksums.sql";

async function prepareSchemaMigrationChecksums(connection) {
  const [columns] = await connection.query(
    `
      SELECT
        DATA_TYPE AS data_type,
        CHARACTER_MAXIMUM_LENGTH AS character_maximum_length,
        IS_NULLABLE AS is_nullable
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'schema_migrations'
        AND column_name = 'checksum_sha256'
      LIMIT 1
    `,
  );
  const column = columns[0];
  if (
    !column ||
    String(column.data_type).toLowerCase() !== "char" ||
    Number(column.character_maximum_length) !== 64 ||
    String(column.is_nullable).toUpperCase() !== "YES"
  ) {
    throw migrationError("MIGRATION_HISTORY_SCHEMA_MISMATCH", {
      column: "checksum_sha256",
    });
  }
  return { skipStatements: true, reconciledMigrationChecksums: true };
}

export const defaultMigrationPreparers = Object.freeze([
  Object.freeze({
    id: "schema-migration-checksums",
    filenames: new Set([SCHEMA_MIGRATION_CHECKSUMS_MIGRATION]),
    prepare: prepareSchemaMigrationChecksums,
  }),
  Object.freeze({
    id: "album-video",
    filenames: new Set([SESSION_ALBUM_VIDEO_HARDENING_MIGRATION]),
    prepare: prepareAlbumVideoMigration,
  }),
  Object.freeze({
    id: "content-moderation",
    filenames: CONTENT_MODERATION_MIGRATIONS,
    prepare: prepareContentModerationMigration,
  }),
  Object.freeze({
    id: "user-image-assets",
    filenames: new Set([USER_IMAGE_ASSETS_MIGRATION]),
    prepare: prepareUserImageAssetsMigration,
  }),
]);

export function validateMigrationPreparerRegistry(
  entries = defaultMigrationPreparers,
) {
  const preparersByFilename = new Map();
  for (const entry of entries) {
    for (const filename of entry.filenames) {
      const preparers = preparersByFilename.get(filename) ?? [];
      preparers.push(entry.id);
      preparersByFilename.set(filename, preparers);
    }
  }
  for (const [filename, preparers] of preparersByFilename) {
    if (preparers.length > 1) {
      throw migrationError("MIGRATION_PREPARER_CONFLICT", {
        filename,
        preparers,
      });
    }
  }
  return entries;
}

export async function prepareRegisteredMigration(
  connection,
  filename,
  entries = defaultMigrationPreparers,
) {
  validateMigrationPreparerRegistry(entries);
  const matches = entries.filter((entry) => entry.filenames.has(filename));
  if (matches.length === 0) return { skipStatements: false };
  return matches[0].prepare(connection, filename);
}
