import { config } from "../config/env.js";
import { withDatabaseConnection } from "../db/mysql.js";
import { backfillAlbumImageObjectKeys } from "../modules/album-image/backfill.js";
import {
  listBackfillCandidates,
  updateBackfilledObject
} from "../modules/album-image/repository.js";
import { headCosObject } from "../storage/cos.js";

const apply = process.argv.includes("--apply");

const repository = {
  listBackfillCandidates: (afterId, limit) => withDatabaseConnection((connection) =>
    listBackfillCandidates(connection, { afterId, limit })
  ),
  updateBackfilledObject: (input) => withDatabaseConnection((connection) =>
    updateBackfilledObject(connection, input)
  )
};

backfillAlbumImageObjectKeys({
  repository,
  storage: {
    head: async (key) => {
      const response = await headCosObject({ key, config: config.cos });
      return { etag: response.headers.etag || "" };
    }
  },
  apply
}).then((result) => {
  console.log(JSON.stringify({ ok: true, apply, ...result }, null, 2));
}).catch((error) => {
  console.error(JSON.stringify({ ok: false, apply, error: error.message }));
  process.exitCode = 1;
});
