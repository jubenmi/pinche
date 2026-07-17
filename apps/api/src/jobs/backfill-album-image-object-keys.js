import { config } from "../config/env.js";
import { withDatabaseConnection } from "../db/mysql.js";
import { backfillAlbumImageObjectKeys } from "../modules/album-image/backfill.js";
import { assertD46IsolatedSmokeGenericJobDisabled } from "../modules/content-moderation/d46-isolated-smoke.js";
import {
  listBackfillCandidates,
  updateBackfilledObject
} from "../modules/album-image/repository.js";
import { headCosObject } from "../storage/cos.js";

const repository = {
  listBackfillCandidates: (afterId, limit) => withDatabaseConnection((connection) =>
    listBackfillCandidates(connection, { afterId, limit })
  ),
  updateBackfilledObject: (input) => withDatabaseConnection((connection) =>
    updateBackfilledObject(connection, input)
  )
};

async function main() {
  assertD46IsolatedSmokeGenericJobDisabled("album-image-backfill");
  const apply = process.argv.includes("--apply");
  const result = await backfillAlbumImageObjectKeys({
    repository,
    storage: {
      head: async (key) => {
        const response = await headCosObject({ key, config: config.cos });
        return { etag: response.headers.etag || "" };
      }
    },
    apply
  });
  console.log(JSON.stringify({ ok: true, apply, ...result }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  });
}
