import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path) {
  try {
    return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`D46 implementation artifact is missing: ${path}`);
    }
    throw error;
  }
}

function exportedFunction(source, name) {
  const start = source.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `missing public media getter: ${name}`);
  const next = source.indexOf("\nexport async function ", start + 10);
  return source.slice(start, next === -1 ? undefined : next);
}

const [
  requirements,
  design,
  tasks,
  sharedAlbumMedia,
  coreService,
  authorVisibility,
  migration,
  migrationReconciler,
  rootPackageRaw,
  smoke,
  envExample,
  productionEnvExample,
  compose,
  moderationEnv,
  telemetry,
  retryWorker,
  adminApi,
  adminWorkspace,
  albumPage
] =
  await Promise.all([
    text("specs/d46-author-private-content-visibility/requirements.md"),
    text("specs/d46-author-private-content-visibility/design.md"),
    text("specs/d46-author-private-content-visibility/tasks.md"),
    text("packages/shared/src/albumMedia.js"),
    text("apps/api/src/modules/core/service.js"),
    text("apps/api/src/modules/content-moderation/author-visibility.js"),
    text("apps/api/migrations/0030_author_private_content_visibility.sql"),
    text("apps/api/src/modules/album-video/migration.js"),
    text("package.json"),
    text("scripts/d46-author-private-content-smoke.js"),
    text(".env.example"),
    text(".env.production.example"),
    text("docker-compose.prod.example.yml"),
    text("apps/api/src/config/env.js"),
    text("apps/api/src/modules/content-moderation/telemetry.js"),
    text("apps/api/src/jobs/content-moderation-retry.js"),
    text("apps/api/src/modules/content-moderation/admin-api.js"),
    text("apps/admin-web/src/components/ContentModerationWorkspace.vue"),
    text("apps/miniprogram/src/pages/session/album.vue")
  ]);

const rootPackage = JSON.parse(rootPackageRaw);

for (const document of [requirements, design, tasks]) {
  assert.match(document, /版本：v1\.0/);
  assert.match(document, /状态：用户已确认，实施中/);
}

const publishedFunction = sharedAlbumMedia.match(
  /export function isModerationPublished\(status\) \{[\s\S]*?\n\}/
)?.[0];
assert.equal(
  publishedFunction,
  'export function isModerationPublished(status) {\n  return status === "approved" || status === "approved_legacy";\n}',
  "isModerationPublished must stay strict"
);

for (const getter of [
  "getVisibleSessionAlbumPhotoForMedia",
  "getPublicSessionAlbumPhotoForMedia",
  "getVisibleSessionAlbumVideoForPlayback",
  "getPublicSessionAlbumVideoCoverForMedia"
]) {
  const body = exportedFunction(coreService, getter);
  assert.match(body, /isModerationPublished\(/, `${getter} lost the public moderation gate`);
  assert.doesNotMatch(
    body,
    /isModerationPublished\([^)]*\)\s*\|\||!isModerationPublished\([^)]*\)[^;\n]*(?:uploader|author|is_mine)/,
    `${getter} contains an owner bypass in a public path`
  );
  assert.doesNotMatch(
    body,
    /author_visibility_version|publication_state\s*[:=]\s*["']author_only["']/,
    `${getter} must not serialize author-private content`
  );
}

for (const token of [
  "resolveAuthorVisibility",
  "authorVisibilityVersion",
  "viewerUserId",
  "authorUserId",
  "approved_legacy",
  "author_only",
  "hidden"
]) {
  assert.equal(authorVisibility.includes(token), true, `author visibility policy missing ${token}`);
}

for (const token of [
  "target_subject_id",
  "author_visibility_version",
  "cancelled_at",
  "superseded_by_proposal_id",
  "session_album_photos"
]) {
  assert.equal(
    `${migration}\n${migrationReconciler}`.includes(token),
    true,
    `0030 migration reconciliation missing ${token}`
  );
}
assert.match(migration, /reconciled by prepareMigration/i);

for (const gate of [
  "CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ENABLED",
  "CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED",
  "CONTENT_MODERATION_AUTHOR_PRIVATE_VIDEO_ENABLED"
]) {
  assert.equal(requirements.includes(gate), true, `requirements missing independent gate ${gate}`);
  assert.equal(design.includes(gate), true, `design missing independent gate ${gate}`);
}
assert.match(requirements, /不在本任务中把生产 intake 从 `closed` 切为 `moderated`/);

for (const command of ["d46:unit", "d46:check", "d46:smoke"]) {
  assert.equal(typeof rootPackage.scripts[command], "string", `missing root command: ${command}`);
  assert.equal(
    rootPackage.scripts.precheck.includes(`npm run ${command}`),
    true,
    `precheck missing ${command}`
  );
}
assert.match(smoke, /NODE_ENV === "production"/);
assert.match(smoke, /pinche_d46_smoke/);
assert.match(smoke, /CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ACTIONS/);
assert.match(smoke, /content-moderation-author-media-retention\.test\.mjs/);
assert.match(smoke, /content-moderation-author-leak-gates\.test\.mjs/);

for (const source of [envExample, productionEnvExample, compose, moderationEnv]) {
  for (const gate of [
    "CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ENABLED",
    "CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ACTIONS",
    "CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED",
    "CONTENT_MODERATION_AUTHOR_PRIVATE_VIDEO_ENABLED",
    "CONTENT_MODERATION_AUTHOR_PREVIEW_TTL_SECONDS"
  ]) {
    assert.equal(source.includes(gate), true, `D46 config artifact missing ${gate}`);
  }
}
for (const event of [
  "author_private_created",
  "author_private_read",
  "author_private_cancelled",
  "author_private_superseded",
  "author_private_rejected",
  "author_private_purged",
  "author_private_access_denied",
  "author_private_public_leak",
  "author_private_retained_object_count",
  "author_private_retained_bytes",
  "author_private_long_lived_count"
]) {
  assert.equal(telemetry.includes(event), true, `telemetry missing ${event}`);
}
assert.match(retryWorker, /getAuthorPrivateRetentionStats/);
assert.match(retryWorker, /emitAuthorPrivateRetentionSnapshot/);
assert.match(adminApi, /author_private_retained/);
assert.match(adminWorkspace, /作者私有保留/);
assert.doesNotMatch(adminWorkspace, /object_key|source_url|display_url|cover_url/i);
assert.match(albumPage, /isAuthorPrivateAlbumMediaRow/);
assert.match(albumPage, /clearAuthorPrivateAlbumState/);

console.log("D46 author-private content static checks passed");
