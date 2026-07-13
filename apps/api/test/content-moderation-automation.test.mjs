import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function text(path) {
  return readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
}

test("D45 automation commands keep unit, static checks, and fake-provider smoke local", async () => {
  const [rootPackageRaw, checkScript, smokeScript] = await Promise.all([
    text("package.json"),
    text("scripts/d45-content-moderation-check.js"),
    text("scripts/d45-content-moderation-smoke.js")
  ]);
  const rootPackage = JSON.parse(rootPackageRaw);

  assert.equal(
    rootPackage.scripts["d45:unit"],
    "npm --workspace @jubenmi/talk run test && node --test apps/api/test/content-moderation-*.test.mjs apps/api/test/wechat-access-token.test.mjs apps/miniprogram/test/contentModeration.test.mjs"
  );
  assert.equal(rootPackage.scripts["d45:check"], "node scripts/d45-content-moderation-check.js");
  assert.equal(rootPackage.scripts["d45:smoke"], "node scripts/d45-content-moderation-smoke.js");
  for (const command of ["d45:unit", "d45:check", "d45:smoke"]) {
    assert.match(rootPackage.scripts.precheck, new RegExp(`npm run ${command.replace(/:/g, "\\:")}`));
  }

  for (const token of [
    "0024_content_moderation.sql",
    "0028_content_moderation_orphan_scan_state.sql",
    "CONTENT_MODERATION_WECHAT_TEXT_ENABLED",
    "CONTENT_MODERATION_WECHAT_IMAGE_ENABLED",
    "CONTENT_MODERATION_TENCENT_VIDEO_ENABLED",
    "CONTENT_MODERATION_TEXT_INTAKE_MODE",
    "CONTENT_MODERATION_IMAGE_INTAKE_MODE",
    "CONTENT_MODERATION_VIDEO_INTAKE_MODE",
    "CONTENT_MODERATION_INTAKE_CLOSED",
    "审核 provider 开关不是流量开关",
    "isModerationPublished",
    "hybrid-content-moderation-release.md",
    "TMS",
    "CI 图片"
  ]) {
    assert.equal(checkScript.includes(token), true, token);
  }

  assert.match(smokeScript, /NODE_ENV === "production"/);
  for (const testFile of [
    "content-moderation-text-service.test.mjs",
    "content-moderation-wechat-image.test.mjs",
    "content-moderation-service.test.mjs",
    "content-moderation-admin.test.mjs"
  ]) {
    assert.equal(smokeScript.includes(testFile), true, testFile);
  }
  assert.doesNotMatch(smokeScript, /https?:\/\//);
});
