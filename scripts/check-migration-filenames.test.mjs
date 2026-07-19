import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import test from "node:test";

import { validateMigrationFilenames } from "./check-migration-filenames.mjs";

const migrationsUrl = new URL("../apps/api/migrations/", import.meta.url);

async function currentMigrationFilenames() {
  return (await readdir(migrationsUrl)).filter((name) => name.endsWith(".sql"));
}

function issueCodes(filenames, options) {
  return validateMigrationFilenames(filenames, options).map(({ code }) => code);
}

test("the current migration history, including five legacy duplicate prefixes, is valid", async () => {
  assert.deepEqual(validateMigrationFilenames(await currentMigrationFilenames()), []);
});

test("future migration filenames must use a four-digit prefix and snake_case description", async () => {
  const filenames = await currentMigrationFilenames();

  assert.deepEqual(
    issueCodes([...filenames, "33_bad_prefix.sql", "0033-bad-name.sql", "0033_BadName.sql"]),
    [
      "MIGRATION_FILENAME_INVALID",
      "MIGRATION_FILENAME_INVALID",
      "MIGRATION_FILENAME_INVALID",
    ],
  );
});

test("prefixes from 0033 onward are globally unique", async () => {
  const filenames = await currentMigrationFilenames();

  assert.equal(
    issueCodes([...filenames, "0033_add_alpha.sql", "0033_add_beta.sql"])
      .includes("MIGRATION_FILENAME_DUPLICATE_PREFIX"),
    true,
  );
  assert.deepEqual(
    validateMigrationFilenames(
      [...filenames, "0033_add_alpha.sql", "0034_add_beta.sql"],
      { futureMigrationHistory: ["0033_add_alpha.sql", "0034_add_beta.sql"] },
    ),
    [],
  );
});

test("future migration history is append-only and strictly increasing", async () => {
  const filenames = await currentMigrationFilenames();
  const futureMigrationHistory = [
    "0033_first.sql",
    "0035_existing.sql",
    "0034_backdated.sql",
  ];

  assert.equal(
    issueCodes([...filenames, ...futureMigrationHistory], { futureMigrationHistory })
      .includes("MIGRATION_FILENAME_HISTORY_NOT_INCREASING"),
    true,
  );
});

test("future migration history cannot insert a backdated prefix before an existing maximum", async () => {
  const filenames = await currentMigrationFilenames();
  const baselineFutureMigrationHistory = ["0033_first.sql", "0035_existing.sql"];
  const futureMigrationHistory = [
    "0033_first.sql",
    "0034_backdated.sql",
    "0035_existing.sql",
  ];

  assert.equal(
    issueCodes(
      [...filenames, ...futureMigrationHistory],
      { baselineFutureMigrationHistory, futureMigrationHistory },
    ).includes("MIGRATION_FILENAME_HISTORY_REWRITTEN"),
    true,
  );
});

test("new migrations cannot use a prefix at or below the 0032 legacy high-water mark", async () => {
  const filenames = await currentMigrationFilenames();

  assert.deepEqual(
    issueCodes([...filenames, "0000_retroactive_fix.sql"]),
    ["MIGRATION_FILENAME_BACKWARD", "MIGRATION_FILENAME_LEGACY_SET_MISMATCH"],
  );
});

test("legacy duplicate exceptions are exact and cannot be extended", async () => {
  const filenames = await currentMigrationFilenames();

  assert.deepEqual(
    issueCodes([...filenames, "0021_unregistered_legacy.sql"]),
    ["MIGRATION_FILENAME_BACKWARD", "MIGRATION_FILENAME_LEGACY_SET_MISMATCH"],
  );
});

test("every unique legacy migration remains present", async () => {
  const filenames = await currentMigrationFilenames();
  const withoutUniqueHistory = filenames.filter(
    (filename) => filename !== "0010_session_review_records.sql",
  );

  assert.deepEqual(
    issueCodes(withoutUniqueHistory),
    ["MIGRATION_FILENAME_LEGACY_SET_MISMATCH"],
  );
});
