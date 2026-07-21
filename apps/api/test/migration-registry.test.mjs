import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultMigrationPreparers,
  prepareRegisteredMigration,
} from "../src/db/migration-registry.js";

function entry(id, filenames, prepare) {
  return { id, filenames: new Set(filenames), prepare };
}

test("registry returns the ordinary statement path when no preparer matches", async () => {
  assert.deepEqual(
    await prepareRegisteredMigration({}, "0099_plain.sql", []),
    { skipStatements: false },
  );
});

test("registry invokes exactly one matching preparer and preserves its result", async () => {
  const connection = { marker: "connection" };
  const calls = [];
  const result = { skipStatements: true, reconciled: "domain" };
  const entries = [
    entry("other", ["0001_other.sql"], async () => {
      throw new Error("non-matching preparer must not run");
    }),
    entry("domain", ["0042_domain.sql"], async (...args) => {
      calls.push(args);
      return result;
    }),
  ];

  assert.equal(
    await prepareRegisteredMigration(connection, "0042_domain.sql", entries),
    result,
  );
  assert.deepEqual(calls, [[connection, "0042_domain.sql"]]);
});

test("registry fails closed when two preparers claim the same filename", async () => {
  const entries = [
    entry("first", ["0042_conflict.sql"], async () => ({ skipStatements: true })),
    entry("second", ["0042_conflict.sql"], async () => ({ skipStatements: false })),
  ];

  await assert.rejects(
    prepareRegisteredMigration({}, "0042_conflict.sql", entries),
    (error) => error.code === "MIGRATION_PREPARER_CONFLICT"
      && error.details.filename === "0042_conflict.sql"
      && assert.deepEqual(error.details.preparers, ["first", "second"]) === undefined,
  );
});

test("default registry owns album video, content moderation, and user image migrations", () => {
  assert.deepEqual(
    defaultMigrationPreparers.map(({ id }) => id),
    ["album-video", "content-moderation", "user-image-assets"],
  );
  const claimed = defaultMigrationPreparers.flatMap(({ id, filenames }) =>
    [...filenames].map((filename) => [filename, id]));
  assert.equal(new Set(claimed.map(([filename]) => filename)).size, claimed.length);
  assert.deepEqual(claimed.map(([filename]) => filename).sort(), [
    "0022_session_album_video_hardening.sql",
    "0025_content_moderation_provider_attempts.sql",
    "0026_content_moderation_text_proposal_result.sql",
    "0027_content_moderation_retry_exhaustion.sql",
    "0030_author_private_content_visibility.sql",
    "0031_user_image_assets.sql",
  ]);
});
