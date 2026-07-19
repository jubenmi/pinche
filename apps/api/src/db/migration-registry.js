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

export const defaultMigrationPreparers = Object.freeze([
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
