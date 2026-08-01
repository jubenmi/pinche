import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeBrandFiles = [
  "apps/miniprogram/src/manifest.json",
  "apps/miniprogram/src/pages.json",
  "apps/miniprogram/src/project.config.json",
  "apps/miniprogram/src/pages/index/index.vue",
  "apps/miniprogram/src/pages/session/detail.vue",
  "apps/miniprogram/src/pages/session/setup.vue",
  "apps/miniprogram/src/pages/session/share.vue",
  "apps/miniprogram/src/utils/api.js",
  "apps/admin-web/index.html",
  "apps/admin-web/src/App.vue",
  "apps/admin-web/src/components/LoginPanel.vue",
  "apps/admin-web/src/components/MiniProgramWorkspace.vue"
];

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("runtime brand surfaces no longer expose the legacy name", async () => {
  for (const relativePath of runtimeBrandFiles) {
    assert.doesNotMatch(await source(relativePath), /剧本迷/, relativePath);
  }
});

test("mini program and admin expose 剧本谜 as the platform brand", async () => {
  const home = await source("apps/miniprogram/src/pages/index/index.vue");
  const appShell = await source("apps/admin-web/src/App.vue");
  const manifest = JSON.parse(await source("apps/miniprogram/src/manifest.json"));
  const project = JSON.parse(await source("apps/miniprogram/src/project.config.json"));

  assert.match(home, /class="home-boot-mark">谜<\/view>/);
  assert.match(home, /class="home-boot-title">剧本谜<\/view>/);
  assert.match(appShell, /class="brand-text">剧本谜管理<\/span>/);
  assert.equal(manifest.name, "剧本谜");
  assert.equal(project.projectname, "剧本谜");
});

test("carpool remains an explicit feature name", async () => {
  const adminMini = await source(
    "apps/admin-web/src/components/MiniProgramWorkspace.vue"
  );
  const moderation = await source("apps/admin-web/src/contentModeration.js");

  assert.match(adminMini, /我的拼车日程/);
  assert.match(moderation, /拼车创建/);
});
