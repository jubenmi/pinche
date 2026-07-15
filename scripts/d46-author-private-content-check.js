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
  migrationReconciler
] =
  await Promise.all([
    text("specs/d46-author-private-content-visibility/requirements.md"),
    text("specs/d46-author-private-content-visibility/design.md"),
    text("specs/d46-author-private-content-visibility/tasks.md"),
    text("packages/shared/src/albumMedia.js"),
    text("apps/api/src/modules/core/service.js"),
    text("apps/api/src/modules/content-moderation/author-visibility.js"),
    text("apps/api/migrations/0030_author_private_content_visibility.sql"),
    text("apps/api/src/modules/album-video/migration.js")
  ]);

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

console.log("D46 author-private content static checks passed");
