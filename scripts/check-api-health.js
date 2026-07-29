import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { requiredSchemaTables } from "../apps/api/src/db/mysql.js";

const serverSource = await readFile(
  new URL("../apps/api/src/app/create-app.js", import.meta.url),
  "utf8"
);
const releaseCheckSource = await readFile(
  new URL("./d9-release-check.js", import.meta.url),
  "utf8"
);

for (const table of ["users", "stores", "scripts", "schema_migrations"]) {
  assert(
    requiredSchemaTables.includes(table),
    `health schema readiness should require ${table}`
  );
}

assert(
  serverSource.includes("checkDatabaseReadiness"),
  "/health should check database readiness, not only process liveness"
);
assert(
  serverSource.includes("schemaReady"),
  "/health and /health/db should expose schemaReady"
);
assert(
  releaseCheckSource.includes("health.capabilities?.production === true") &&
    releaseCheckSource.includes("health.capabilities?.wechatMockLogin === false") &&
    !releaseCheckSource.includes("health.config?.wechatMockLogin"),
  "D9 release gate should consume the current public health capabilities contract"
);

console.log("API health check passed");
