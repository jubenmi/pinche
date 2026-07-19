import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MIGRATION_FILENAME_PATTERN = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

export const LEGACY_MAX_PREFIX = 32;

export const LEGACY_DUPLICATE_PREFIXES = Object.freeze({
  "0021": Object.freeze([
    "0021_private_catalog_review.sql",
    "0021_session_album_video.sql",
  ]),
  "0022": Object.freeze([
    "0022_session_album_video_hardening.sql",
    "0022_store_location_data.sql",
  ]),
  "0024": Object.freeze([
    "0024_content_moderation.sql",
    "0024_user_notifications.sql",
  ]),
  "0030": Object.freeze([
    "0030_author_private_content_visibility.sql",
    "0030_content_security_settings.sql",
  ]),
  "0032": Object.freeze([
    "0032_session_album_public_shares.sql",
    "0032_session_review_album_photos.sql",
  ]),
});

export const LEGACY_MIGRATION_FILENAMES = Object.freeze([
  "0001_empty_bootstrap.sql",
  "0002_identity_and_core_model.sql",
  "0003_admin_catalog_seed_and_templates.sql",
  "0004_session_interaction_board.sql",
  "0005_chat_rooms_backfill.sql",
  "0006_player_role_gender.sql",
  "0007_admin_web_login.sql",
  "0008_store_script_links.sql",
  "0009_wechat_identities.sql",
  "0010_session_review_records.sql",
  "0011_store_script_price.sql",
  "0012_session_membership_downlisting.sql",
  "0013_session_album_privacy.sql",
  "0014_session_album_display_metadata.sql",
  "0015_npc_role_tags.sql",
  "0016_session_join_policy.sql",
  "0017_npc_self_join.sql",
  "0018_session_member_removal_reports.sql",
  "0019_session_join_settings.sql",
  "0020_npc_role_gender.sql",
  "0021_private_catalog_review.sql",
  "0021_session_album_video.sql",
  "0022_session_album_video_hardening.sql",
  "0022_store_location_data.sql",
  "0023_album_media_cos_direct.sql",
  "0024_content_moderation.sql",
  "0024_user_notifications.sql",
  "0025_content_moderation_provider_attempts.sql",
  "0026_content_moderation_text_proposal_result.sql",
  "0027_content_moderation_retry_exhaustion.sql",
  "0028_content_moderation_orphan_scan_state.sql",
  "0029_content_moderation_production_preflight.sql",
  "0030_author_private_content_visibility.sql",
  "0030_content_security_settings.sql",
  "0031_user_image_assets.sql",
  "0032_session_album_public_shares.sql",
  "0032_session_review_album_photos.sql",
]);

const legacyFilenames = new Set(LEGACY_MIGRATION_FILENAMES);

function issue(code, message, details = {}) {
  return Object.freeze({ code, message, ...details });
}

function sameStrings(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

export function validateMigrationFilenames(filenames) {
  const issues = [];
  const filenamesByPrefix = new Map();

  for (const filename of filenames) {
    const match = MIGRATION_FILENAME_PATTERN.exec(filename);
    if (!match) {
      issues.push(
        issue(
          "MIGRATION_FILENAME_INVALID",
          "Migration filename must use a four-digit prefix, snake_case description, and .sql suffix",
          { filename },
        ),
      );
      continue;
    }

    const prefix = match[1];
    const numericPrefix = Number(prefix);
    const prefixFilenames = filenamesByPrefix.get(prefix) ?? [];
    prefixFilenames.push(filename);
    filenamesByPrefix.set(prefix, prefixFilenames);

    if (numericPrefix <= LEGACY_MAX_PREFIX && !legacyFilenames.has(filename)) {
      issues.push(
        issue(
          "MIGRATION_FILENAME_BACKWARD",
          `New migrations must use a prefix greater than ${String(LEGACY_MAX_PREFIX).padStart(4, "0")}`,
          { filename, prefix },
        ),
      );
    }
  }

  for (const [prefix, prefixFilenames] of filenamesByPrefix) {
    const sortedFilenames = [...prefixFilenames].sort();
    const legacyException = LEGACY_DUPLICATE_PREFIXES[prefix];

    if (legacyException) {
      if (!sameStrings(sortedFilenames, [...legacyException].sort())) {
        issues.push(
          issue(
            "MIGRATION_FILENAME_LEGACY_SET_MISMATCH",
            `Legacy duplicate prefix ${prefix} must match its exact allowlist`,
            { prefix, filenames: sortedFilenames },
          ),
        );
      }
      continue;
    }

    if (Number(prefix) > LEGACY_MAX_PREFIX && sortedFilenames.length > 1) {
      issues.push(
        issue(
          "MIGRATION_FILENAME_DUPLICATE_PREFIX",
          `Future migration prefix ${prefix} must be globally unique`,
          { prefix, filenames: sortedFilenames },
        ),
      );
    }
  }

  return issues;
}

export async function checkMigrationDirectory(
  migrationsUrl = new URL("../apps/api/migrations/", import.meta.url),
) {
  return validateMigrationFilenames(await readdir(migrationsUrl));
}

async function main() {
  const issues = await checkMigrationDirectory();
  if (issues.length === 0) {
    process.stdout.write("Migration filenames passed governance checks.\n");
    return;
  }

  for (const { code, message, filename, prefix } of issues) {
    const subject = filename ?? prefix ?? "migration directory";
    process.stderr.write(`[${code}] ${subject}: ${message}\n`);
  }
  process.exitCode = 1;
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;

if (entryUrl === import.meta.url) {
  main().catch((error) => {
    const scriptName = fileURLToPath(import.meta.url).split("/").pop();
    process.stderr.write(`${scriptName}: ${error?.message ?? "Migration filename check failed"}\n`);
    process.exitCode = 1;
  });
}
