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

export async function prepareRegisteredMigration(
  connection,
  filename,
  entries = defaultMigrationPreparers,
) {
  const matches = entries.filter((entry) => entry.filenames.has(filename));
  if (matches.length === 0) return { skipStatements: false };
  if (matches.length > 1) {
    throw migrationError("MIGRATION_PREPARER_CONFLICT", {
      filename,
      preparers: matches.map(({ id }) => id),
    });
  }
  return matches[0].prepare(connection, filename);
}
