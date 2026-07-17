import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT_URL = new URL("../../../", import.meta.url);

async function text(path) {
  return readFile(new URL(path, ROOT_URL), "utf8");
}

const COVERED_TEXT_ACTIONS = Object.freeze([
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
]);

test("D46 contract locks author-only visibility without weakening public moderation", async () => {
  const [requirements, design, tasks, rootPackageRaw, sharedAlbumMedia, checkScript] =
    await Promise.all([
      text("specs/d46-author-private-content-visibility/requirements.md"),
      text("specs/d46-author-private-content-visibility/design.md"),
      text("specs/d46-author-private-content-visibility/tasks.md"),
      text("package.json"),
      text("packages/shared/src/albumMedia.js"),
      text("scripts/d46-author-private-content-check.js")
    ]);
  const rootPackage = JSON.parse(rootPackageRaw);

  for (const document of [requirements, design, tasks]) {
    assert.match(document, /版本：v1\.0/);
    assert.match(document, /状态：用户已确认，实施中/);
  }

  assert.equal(COVERED_TEXT_ACTIONS.length, 10);
  for (const action of COVERED_TEXT_ACTIONS) {
    assert.equal(requirements.includes(`\`${action}\``), true, `requirements missing ${action}`);
    assert.equal(design.includes(`\`${action}\``), true, `design missing ${action}`);
  }

  for (const invariant of [
    "created_by_user_id",
    "uploader_user_id",
    "车局组织者、同车成员、被标记用户和分享 token 均不得获得该权限",
    "system_admin",
    "isModerationPublished(status)"
  ]) {
    assert.equal(requirements.includes(invariant), true, `missing author invariant: ${invariant}`);
  }

  for (const field of [
    "draft_id",
    "content_ref",
    "publication_state",
    "moderation_status",
    "moderation_message",
    "published_id",
    "can_edit",
    "can_delete",
    "can_resubmit"
  ]) {
    assert.equal(design.includes(`\"${field}\"`), true, `author DTO missing ${field}`);
  }
  assert.match(requirements, /返回 HTTP `202`/);
  assert.match(design, /返回 202 作者 DTO/);

  assert.match(requirements, /URL 有效期 SHALL 不超过 60 秒/);
  assert.match(design, /签发 URL 最长 60 秒/);
  assert.match(requirements, /普通 `reject` 后 SHALL 保持 `rejected`、仅作者可见/);
  assert.match(design, /Block\/reject → moderation_status=rejected → 保留私有对象/);

  for (const gate of [
    "CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ENABLED",
    "CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ACTIONS",
    "CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED",
    "CONTENT_MODERATION_AUTHOR_PRIVATE_VIDEO_ENABLED",
    "CONTENT_MODERATION_AUTHOR_PREVIEW_TTL_SECONDS"
  ]) {
    assert.equal(requirements.includes(gate), true, `requirements missing gate ${gate}`);
    assert.equal(design.includes(gate), true, `design missing gate ${gate}`);
  }
  assert.match(requirements, /D46 发布 SHALL NOT 自动把生产 intake 切为 `moderated`/);

  const publishedFunction = sharedAlbumMedia.match(
    /export function isModerationPublished\(status\) \{[\s\S]*?\n\}/
  )?.[0];
  assert.equal(
    publishedFunction,
    'export function isModerationPublished(status) {\n  return status === "approved" || status === "approved_legacy";\n}'
  );

  assert.equal(
    rootPackage.scripts["d46:check"],
    "node --test scripts/d46-content-moderation-check.test.mjs && node scripts/d46-content-moderation-check.js && node scripts/d46-author-private-content-check.js"
  );
  assert.match(rootPackage.scripts.precheck, /npm run d46\:check/);
  for (const token of [
    "0030_author_private_content_visibility.sql",
    "author-visibility.js",
    "isModerationPublished",
    "approved_legacy",
    "author_visibility_version",
    "CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ENABLED",
    "CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED",
    "CONTENT_MODERATION_AUTHOR_PRIVATE_VIDEO_ENABLED"
  ]) {
    assert.equal(checkScript.includes(token), true, `D46 check missing token: ${token}`);
  }

  const result = spawnSync(process.execPath, ["scripts/d46-author-private-content-check.js"], {
    cwd: fileURLToPath(ROOT_URL),
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
