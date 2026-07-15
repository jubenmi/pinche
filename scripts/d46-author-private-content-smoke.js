import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.NODE_ENV === "production") {
  throw new Error("D46 smoke refuses to run with NODE_ENV=production");
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smokeTests = [
  "apps/api/test/content-moderation-author-visibility.test.mjs",
  "apps/api/test/content-moderation-author-text-projection.test.mjs",
  "apps/api/test/content-moderation-author-drafts.test.mjs",
  "apps/api/test/content-moderation-author-media-preview.test.mjs",
  "apps/api/test/content-moderation-author-media-retention.test.mjs",
  "apps/api/test/content-moderation-author-leak-gates.test.mjs",
  "apps/api/test/content-moderation-text-service.test.mjs",
  "apps/api/test/content-moderation-service.test.mjs",
  "apps/api/test/album-image-delete.test.mjs"
];
const authorPrivateActions = [
  "update_nickname",
  "create_private_store",
  "create_private_script",
  "create_session",
  "update_session",
  "create_session_npc_role",
  "update_session_npc_role",
  "upsert_session_review",
  "create_session_message",
  "update_session_pinned_message"
].join(",");

const result = spawnSync(process.execPath, ["--test", ...smokeTests], {
  cwd: repoRoot,
  env: {
    ...process.env,
    NODE_ENV: "test",
    MYSQL_HOST: "127.0.0.1",
    MYSQL_DATABASE: "pinche_d46_smoke",
    REDIS_ENABLED: "false",
    COS_ENABLED: "false",
    CONTENT_MODERATION_ENABLED: "false",
    CONTENT_MODERATION_WECHAT_TEXT_ENABLED: "false",
    CONTENT_MODERATION_WECHAT_IMAGE_ENABLED: "false",
    CONTENT_MODERATION_TENCENT_VIDEO_ENABLED: "false",
    CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ENABLED: "true",
    CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ACTIONS: authorPrivateActions,
    CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED: "true",
    CONTENT_MODERATION_AUTHOR_PRIVATE_VIDEO_ENABLED: "true",
    CONTENT_MODERATION_AUTHOR_PREVIEW_TTL_SECONDS: "60",
    D46_SMOKE_ISOLATED: "true"
  },
  stdio: "inherit"
});

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`D46 smoke failed with exit status ${String(result.status)}`);
}

console.log(
  "D46 author-private smoke passed: fake providers and isolated adapters covered text create/update, " +
  "image/video preview, cancel, replacement, rejected retention, author deletion, and non-author isolation"
);
