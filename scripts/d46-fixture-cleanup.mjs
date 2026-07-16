import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertD46IsolatedSmokeEnvironment
} from "../apps/api/src/modules/content-moderation/d46-isolated-smoke.js";

function fixtureCleanupJobId() {
  if (process.argv.length !== 3) throw new TypeError("D46 fixture cleanup job id is required");
  const value = Number(process.argv[2]);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("D46 fixture cleanup job id is invalid");
  }
  return value;
}

async function main() {
  // This is deliberately the first action: no DB, config, repository, or
  // cleanup dependency is loaded until the strict local-only guard passes.
  assertD46IsolatedSmokeEnvironment(process.env);
  const cleanupJobId = fixtureCleanupJobId();
  const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/api");
  const { withTransaction } = await import("../apps/api/src/db/mysql.js");
  const {
    assertLocalAlbumCleanupPath,
    runAlbumImageCleanupBatch
  } = await import("../apps/api/src/modules/album-image/cleanup.js");
  const repository = await import("../apps/api/src/modules/album-image/repository.js");

  const result = await runAlbumImageCleanupBatch({
    repository,
    withTransaction,
    // A scoped fixture cleanup must never use COS. If a wrong cleanup row is
    // selected, the run stays non-destructive and the status verification
    // below fails closed.
    storage: {
      head: async () => {
        throw Object.assign(new Error("D46 fixture cleanup does not read COS"), {
          code: "D46_FIXTURE_COS_FORBIDDEN"
        });
      },
      delete: async () => {
        throw Object.assign(new Error("D46 fixture cleanup does not delete COS"), {
          code: "D46_FIXTURE_COS_FORBIDDEN"
        });
      }
    },
    unlinkFile: async (localPath) => {
      const normalized = assertLocalAlbumCleanupPath(localPath);
      return fs.unlink(path.join(apiRoot, normalized.slice(1)));
    },
    emit: () => {},
    mediaCleanupJobIds: [cleanupJobId]
  });
  if (result.claimed !== 1) throw new Error("D46 fixture cleanup did not claim exactly one job");
  const status = await withTransaction(async (connection) => {
    const [rows] = await connection.query(
      "SELECT status FROM session_album_object_cleanup_jobs WHERE id = ? LIMIT 1",
      [cleanupJobId]
    );
    return rows[0]?.status || "";
  });
  if (status !== "cleaned") throw new Error("D46 fixture cleanup did not complete");
}

try {
  await main();
} catch {
  // The parent acceptance runner adds only a fixed stage name. Do not print
  // URLs, database values, fixture data, or environment-derived details.
  process.exitCode = 1;
}
