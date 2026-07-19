import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const MIGRATION_FILENAME_PATTERN = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const FUTURE_HISTORY_PATH = "scripts/migration-filename-history.json";
const futureHistoryUrl = new URL("./migration-filename-history.json", import.meta.url);

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

export function validateMigrationFilenames(
  filenames,
  {
    baselineFutureMigrationHistory = [],
    futureMigrationHistory = [],
  } = {},
) {
  const issues = [];
  const filenamesByPrefix = new Map();
  const validMigrations = [];

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
    validMigrations.push({ filename, prefix, numericPrefix });
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

  const actualLegacyFilenames = validMigrations
    .filter(({ numericPrefix }) => numericPrefix <= LEGACY_MAX_PREFIX)
    .map(({ filename }) => filename)
    .sort();
  const expectedLegacyFilenames = [...LEGACY_MIGRATION_FILENAMES].sort();
  if (!sameStrings(actualLegacyFilenames, expectedLegacyFilenames)) {
    const actualLegacySet = new Set(actualLegacyFilenames);
    issues.push(
      issue(
        "MIGRATION_FILENAME_LEGACY_SET_MISMATCH",
        "Legacy migration filenames must match the complete immutable history",
        {
          missing: expectedLegacyFilenames.filter((name) => !actualLegacySet.has(name)),
          unexpected: actualLegacyFilenames.filter((name) => !legacyFilenames.has(name)),
        },
      ),
    );
  }

  for (const [prefix, prefixFilenames] of filenamesByPrefix) {
    const sortedFilenames = [...prefixFilenames].sort();
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

  let previousHistoryPrefix = LEGACY_MAX_PREFIX;
  const validFutureHistory = [];
  for (const filename of futureMigrationHistory) {
    const match = MIGRATION_FILENAME_PATTERN.exec(filename);
    const numericPrefix = match ? Number(match[1]) : 0;
    if (!match || numericPrefix <= LEGACY_MAX_PREFIX) {
      issues.push(
        issue(
          "MIGRATION_FILENAME_HISTORY_INVALID",
          "Future migration history entries must be valid filenames above the legacy high-water mark",
          { filename },
        ),
      );
      continue;
    }
    validFutureHistory.push(filename);
    if (numericPrefix <= previousHistoryPrefix) {
      issues.push(
        issue(
          "MIGRATION_FILENAME_HISTORY_NOT_INCREASING",
          "Future migration history must remain append-only with strictly increasing prefixes",
          { filename, prefix: match[1], previousPrefix: String(previousHistoryPrefix).padStart(4, "0") },
        ),
      );
    }
    previousHistoryPrefix = numericPrefix;
  }

  const historyPrefixPreserved = baselineFutureMigrationHistory.every(
    (filename, index) => futureMigrationHistory[index] === filename,
  );
  if (
    baselineFutureMigrationHistory.length > futureMigrationHistory.length
    || !historyPrefixPreserved
  ) {
    issues.push(
      issue(
        "MIGRATION_FILENAME_HISTORY_REWRITTEN",
        "Existing future migration history must remain an exact prefix of the current history",
        {
          baselineLength: baselineFutureMigrationHistory.length,
          currentLength: futureMigrationHistory.length,
        },
      ),
    );
  }

  const actualFutureFilenames = validMigrations
    .filter(({ numericPrefix }) => numericPrefix > LEGACY_MAX_PREFIX)
    .map(({ filename }) => filename)
    .sort();
  const expectedFutureFilenames = [...validFutureHistory].sort();
  if (!sameStrings(actualFutureFilenames, expectedFutureFilenames)) {
    const actualFutureSet = new Set(actualFutureFilenames);
    const expectedFutureSet = new Set(expectedFutureFilenames);
    issues.push(
      issue(
        "MIGRATION_FILENAME_FUTURE_SET_MISMATCH",
        "Future migration files must match the append-only migration history",
        {
          missing: expectedFutureFilenames.filter((name) => !actualFutureSet.has(name)),
          unregistered: actualFutureFilenames.filter((name) => !expectedFutureSet.has(name)),
        },
      ),
    );
  }

  return issues;
}

function parseFutureMigrationHistory(text, source) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    throw new Error(`${source} must contain a JSON array of migration filenames`);
  }
  return parsed;
}

async function gitStdout(args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

async function baselineGitRef() {
  const configured = String(
    process.env.MIGRATION_GOVERNANCE_BASE_REF || "",
  ).trim();
  if (configured && !/^0+$/.test(configured)) return configured;

  const status = await gitStdout([
    "status",
    "--porcelain",
    "--",
    FUTURE_HISTORY_PATH,
  ]);
  return status.trim() ? "HEAD" : "HEAD^";
}

async function readBaselineFutureMigrationHistory() {
  const ref = await baselineGitRef();
  try {
    await gitStdout(["cat-file", "-e", `${ref}^{commit}`]);
  } catch {
    throw new Error(`Migration governance baseline commit is unavailable: ${ref}`);
  }

  try {
    await gitStdout(["cat-file", "-e", `${ref}:${FUTURE_HISTORY_PATH}`]);
  } catch {
    return [];
  }
  return parseFutureMigrationHistory(
    await gitStdout(["show", `${ref}:${FUTURE_HISTORY_PATH}`]),
    `${ref}:${FUTURE_HISTORY_PATH}`,
  );
}

export async function checkMigrationDirectory(
  migrationsUrl = new URL("../apps/api/migrations/", import.meta.url),
) {
  const futureMigrationHistory = parseFutureMigrationHistory(
    await readFile(futureHistoryUrl, "utf8"),
    FUTURE_HISTORY_PATH,
  );
  const baselineFutureMigrationHistory = await readBaselineFutureMigrationHistory();
  return validateMigrationFilenames(await readdir(migrationsUrl), {
    baselineFutureMigrationHistory,
    futureMigrationHistory,
  });
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
