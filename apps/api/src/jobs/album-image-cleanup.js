import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "../config/env.js";
import { withTransaction } from "../db/mysql.js";
import {
  assertLocalAlbumCleanupPath,
  runAlbumImageCleanupBatch
} from "../modules/album-image/cleanup.js";
import * as repository from "../modules/album-image/repository.js";
import {
  assertUserImageCleanupPath,
  runUserImageCleanupBatch
} from "../modules/user-image-assets/cleanup.js";
import * as userImageRepository from "../modules/user-image-assets/repository.js";
import { deleteCosObject, headCosObject } from "../storage/cos.js";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => { stopping = true; });
}

async function runOnce() {
  const album = await runAlbumImageCleanupBatch({
    repository,
    withTransaction,
    storage: {
      head: (key) => headCosObject({ key, config: config.cos }),
      delete: (key) => deleteCosObject({ key, config: config.cos })
    },
    unlinkFile: (localPath) => {
      const normalized = assertLocalAlbumCleanupPath(localPath);
      return fs.unlink(path.join(apiRoot, normalized.slice(1)));
    }
  });
  const userImages = await runUserImageCleanupBatch({
    repository: userImageRepository,
    withTransaction,
    storage: {
      delete: (key) => deleteCosObject({ key, config: config.cos })
    },
    unlinkFile: (localPath) => {
      const normalized = assertUserImageCleanupPath(localPath);
      return fs.unlink(path.join(apiRoot, normalized.slice(1)));
    }
  });
  return { claimed: album.claimed + userImages.claimed };
}

async function main() {
  const once = process.argv.includes("--once");
  do {
    const result = await runOnce();
    console.log(JSON.stringify({ ok: true, ...result }));
    if (once || stopping) break;
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  } while (!stopping);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
