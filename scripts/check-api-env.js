import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { assertDatabaseTargetLock, buildRedisUrl } from "../apps/api/src/config/env.js";

const productionEnvExample = readFileSync(
  new URL("../.env.production.example", import.meta.url),
  "utf8"
);

assert.equal(
  buildRedisUrl({
    REDIS_URL: "redis://redis:6379",
    REDIS_HOST: "10.206.16.15",
    REDIS_PORT: "6379",
    REDIS_DB: "3"
  }),
  "redis://redis:6379",
  "REDIS_URL should take precedence when it is provided"
);

assert.equal(
  buildRedisUrl({
    REDIS_HOST: "10.206.16.15",
    REDIS_PORT: "6379",
    REDIS_DB: "3"
  }),
  "redis://10.206.16.15:6379/3",
  "split TencentDB Redis env should build a Redis URL"
);

assert.equal(
  buildRedisUrl({
    REDIS_HOST: "10.206.16.15",
    REDIS_PORT: "6379",
    REDIS_DB: "3",
    REDIS_PASSWORD: "p@ ss"
  }),
  "redis://:p%40%20ss@10.206.16.15:6379/3",
  "Redis passwords should be URL encoded"
);

assert.equal(
  buildRedisUrl({}),
  "redis://127.0.0.1:6379",
  "Redis config should keep the existing local fallback"
);

const child = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    "import { config } from './apps/api/src/config/env.js'; console.log(config.redis.url);"
  ],
  {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env,
      REDIS_URL: "",
      REDIS_HOST: "10.206.16.15",
      REDIS_PORT: "6379",
      REDIS_DB: "3"
    },
    encoding: "utf8"
  }
);

assert.equal(child.status, 0, child.stderr);
assert.equal(
  child.stdout.trim(),
  "redis://10.206.16.15:6379/3",
  "empty REDIS_URL should not be replaced by local .env values"
);

assert.doesNotThrow(
  () =>
    assertDatabaseTargetLock(
      { host: "cloud-db.example.com" },
      {
        DATABASE_TARGET_LOCK: "cloud",
        DATABASE_TARGET_LOCK_HOST: "cloud-db.example.com"
      }
    ),
  "cloud database lock should allow the expected cloud host"
);

assert.throws(
  () =>
    assertDatabaseTargetLock(
      { host: "127.0.0.1" },
      {
        DATABASE_TARGET_LOCK: "cloud",
        DATABASE_TARGET_LOCK_HOST: "cloud-db.example.com"
      }
    ),
  /refuse to start with local MYSQL_HOST/,
  "cloud database lock should reject local MySQL hosts"
);

assert.throws(
  () =>
    assertDatabaseTargetLock(
      { host: "other-cloud.example.com" },
      {
        DATABASE_TARGET_LOCK: "cloud",
        DATABASE_TARGET_LOCK_HOST: "cloud-db.example.com"
      }
    ),
  /expected MYSQL_HOST=cloud-db\.example\.com/,
  "cloud database lock should reject unexpected cloud hosts"
);

assert(
  productionEnvExample.includes("DATABASE_TARGET_LOCK=cloud"),
  "production env example should lock database target to cloud"
);
assert(
  productionEnvExample.includes(
    "DATABASE_TARGET_LOCK_HOST=nj-cynosdbmysql-grp-9cgedjkh.sql.tencentcdb.com"
  ),
  "production env example should lock the expected cloud database host"
);
assert(
  productionEnvExample.includes("MYSQL_HOST=nj-cynosdbmysql-grp-9cgedjkh.sql.tencentcdb.com") &&
    productionEnvExample.includes("MYSQL_PORT=25909"),
  "production env example should point MySQL at the locked cloud database"
);

console.log("API env check passed");
