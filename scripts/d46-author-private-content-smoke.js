import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.NODE_ENV === "production") {
  throw new Error("D46 smoke refuses to run with NODE_ENV=production");
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smokeTests = [
  "apps/api/test/content-moderation-author-visibility.test.mjs",
  "apps/api/test/content-moderation-author-text-action-matrix.test.mjs",
  "apps/api/test/content-moderation-author-text-projection.test.mjs",
  "apps/api/test/content-moderation-author-drafts.test.mjs",
  "apps/api/test/content-moderation-author-media-preview.test.mjs",
  "apps/api/test/content-moderation-author-media-retention.test.mjs",
  "apps/api/test/content-moderation-author-leak-gates.test.mjs",
  "apps/api/test/content-moderation-text-service.test.mjs",
  "apps/api/test/content-moderation-service.test.mjs",
  "apps/api/test/content-moderation-video-integration.test.mjs",
  "apps/api/test/album-image-delete.test.mjs"
];

const result = spawnSync(process.execPath, ["--test", ...smokeTests], {
  cwd: repoRoot,
  env: {
    ...process.env,
    NODE_ENV: "test",
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
  throw new Error(`D46 smoke failed with exit status ${String(result.status)}`);
}

console.log(
  "D46 author-private in-process security smoke passed: fake providers and isolated in-memory adapters " +
  "covered the ten-action lifecycle matrix, text replay, image/video preview, callback identity, " +
  "cancel, replacement, rejected retention, author deletion, and non-author isolation; no live API, " +
  "database, Redis, COS, WeChat, or Tencent Cloud was contacted"
);
