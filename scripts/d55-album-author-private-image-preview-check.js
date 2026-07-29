import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

const [
  requirements,
  design,
  tasks,
  sharedMedia,
  reviewPage,
  reviewPhotos,
  coreService
] = await Promise.all([
  text("specs/d55-album-author-private-image-preview/requirements.md"),
  text("specs/d55-album-author-private-image-preview/design.md"),
  text("specs/d55-album-author-private-image-preview/tasks.md"),
  text("packages/shared/src/albumMedia.js"),
  text("apps/miniprogram/src/pages/session/review.vue"),
  text("apps/api/src/modules/core/session-review.js"),
  text("apps/api/src/modules/core/service.js")
]);

for (const document of [requirements, design]) {
  assert.match(document, /版本：v1\.0/);
  assert.match(document, /状态：用户已确认，实施中/);
}
assert.match(tasks, /D55 相册作者私有图片预览恢复 Implementation Plan/);

const published = sharedMedia.match(
  /export function isModerationPublished\(status\) \{[\s\S]*?\n\}/
)?.[0];
assert.equal(
  published,
  'export function isModerationPublished(status) {\n' +
    '  return status === "approved" || status === "approved_legacy";\n' +
    '}'
);
assert.match(sharedMedia, /isAuthorPrivateAlbumMediaProjection\(refreshed\)/);
assert.match(sharedMedia, /delete next\.download_url/);
assert.match(reviewPage, /this\.currentUserId\s*=\s*auth\.user\.id/);
assert.match(
  reviewPage,
  /isSelectableSessionReviewAlbumPhoto\(photo,\s*this\.currentUserId\)/
);
assert.match(coreService, /isAssociableSessionReviewAlbumPhoto\(/);
assert.match(
  coreService,
  /reviewPhotos\(connection,\s*\[Number\(review\.id\)\],\s*\{\s*ownerUserId:\s*user\.user\.id\s*\}\)/
);
assert.match(reviewPhotos, /isPublishableSessionReviewAlbumPhoto[\s\S]*isModerationPublished/);

console.log("D55 album author-private image preview checks passed");
