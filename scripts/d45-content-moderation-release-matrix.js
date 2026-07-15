import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.NODE_ENV === "production") {
  throw new Error("D45 release matrix refuses to run with NODE_ENV=production");
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const matrixTests = [
  "apps/api/test/content-moderation-text-service.test.mjs",
  "apps/api/test/content-moderation-wechat-image.test.mjs",
  "apps/api/test/content-moderation-wechat-callback.test.mjs",
  "apps/api/test/content-moderation-service.test.mjs",
  "apps/api/test/content-moderation-callback.test.mjs",
  "apps/api/test/content-moderation-retry.test.mjs",
  "apps/api/test/content-moderation-video-integration.test.mjs",
  "apps/api/test/album-image-cleanup.test.mjs"
];

const result = spawnSync(process.execPath, ["--test", ...matrixTests], {
  cwd: repoRoot,
  env: {
    ...process.env,
    NODE_ENV: "test",
    MYSQL_HOST: "127.0.0.1",
    MYSQL_DATABASE: "pinche_d45_release_matrix",
    REDIS_ENABLED: "false",
    COS_ENABLED: "false",
    CONTENT_MODERATION_ENABLED: "false",
    CONTENT_MODERATION_WECHAT_TEXT_ENABLED: "false",
    CONTENT_MODERATION_WECHAT_IMAGE_ENABLED: "false",
    CONTENT_MODERATION_TENCENT_VIDEO_ENABLED: "false"
  },
  stdio: "inherit"
});

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`D45 release matrix failed with exit status ${String(result.status)}`);
}

console.log("D45 release matrix passed: fake adapters and signed callback replays cover results, faults, stale events, and rejected-media cleanup");
