import assert from "node:assert/strict";
import { runD42AlbumVideoHardeningSmoke } from "./d42-album-video-hardening-smoke.js";

let dependencyLoads = 0;
await assert.rejects(
  runD42AlbumVideoHardeningSmoke({
    env: {
      NODE_ENV: "test",
      WECHAT_MOCK_LOGIN: "true",
      D42_SMOKE_ISOLATED: "1",
      MYSQL_HOST: "not-local",
      MYSQL_DATABASE: "pinche_d42_test"
    },
    loadDependencies: async () => {
      dependencyLoads += 1;
      throw new Error("unsafe smoke must not load database dependencies");
    }
  }),
  /D42 smoke isolation rejected before imports\/API\/database/
);
assert.equal(dependencyLoads, 0);

console.log("D42 smoke contract checks passed: unsafe targets reject before database imports");
