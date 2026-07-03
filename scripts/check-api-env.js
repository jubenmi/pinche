import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { buildRedisUrl } from "../apps/api/src/config/env.js";

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

console.log("API env check passed");
