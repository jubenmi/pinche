import assert from "node:assert/strict";

import { getTencentMapKey } from "../src/runtimeConfig.js";

const buildEnv = { VITE_TENCENT_MAP_KEY: " build-time-key " };

assert.equal(
  getTencentMapKey(
    { __PINCH_ADMIN_CONFIG__: { TENCENT_MAP_KEY: " runtime-key " } },
    buildEnv
  ),
  "runtime-key",
  "runtime config should take precedence over build-time env"
);

assert.equal(
  getTencentMapKey({}, buildEnv),
  "",
  "build-time env should not be embedded into the static admin bundle"
);

assert.equal(
  getTencentMapKey({ __PINCH_ADMIN_CONFIG__: { TENCENT_MAP_KEY: "" } }, {}),
  "",
  "missing map key should resolve to an empty string"
);
