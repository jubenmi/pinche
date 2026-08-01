# 剧本谜品牌重命名实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将小程序和 Admin 的平台品牌统一为“剧本谜”，保留拼车功能词，修复已获准的 D53 基线契约，并完成三分支 CI 发布与微信开发版本上传。

**Architecture:** 仅修改运行时品牌展示面和静态项目显示配置，不重命名内部 `pinche` 技术标识。用一个无外部依赖的 Node 契约测试扫描明确列出的运行时文件，阻止旧品牌回归；现有首页冷启动测试继续验证构建产物中的新品牌。

**Tech Stack:** Vue 3、UniApp、Node.js test runner、GitHub Actions、微信开发者工具 CLI

---

### Task 1: 恢复 D53 基线契约

**Files:**
- Modify: `apps/miniprogram/src/pages/session/album.vue`
- Test: `scripts/d53-album-four-action-selection-check.js`

- [ ] **Step 1: 重现获准修复的基线失败**

Run: `npm run d53:check`

Expected: FAIL，错误为 `tag action must retain its green primary style`。

- [ ] **Step 2: 恢复标注按钮的契约类名**

将 `openTagSelectionMode` 对应按钮从：

```vue
<t-button
  class="album-command"
```

改为：

```vue
<t-button
  class="album-command tag-action"
```

不改变其现有 `custom-style`、事件或其他属性。

- [ ] **Step 3: 验证基线契约恢复**

Run: `npm run d53:check`

Expected: PASS，输出包含 `D53 album four-action selection checks passed`。

- [ ] **Step 4: 提交基线修复**

```bash
git add apps/miniprogram/src/pages/session/album.vue
git commit -m "fix(miniprogram): restore tag action style contract"
```

### Task 2: 先写品牌契约并确认失败

**Files:**
- Create: `scripts/brand-identity.test.mjs`
- Modify: `apps/miniprogram/test/homeColdStart.test.mjs`
- Modify: `apps/miniprogram/test/homeStartupBuild.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: 新增运行时品牌契约测试**

创建 `scripts/brand-identity.test.mjs`：

```js
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
```

- [ ] **Step 2: 将首页已有断言改为新品牌**

在 `homeColdStart.test.mjs` 和 `homeStartupBuild.test.mjs` 中把：

```js
assert.match(bootMarkup, /剧本迷·拼车/);
```

改为：

```js
assert.match(bootMarkup, /剧本谜/);
assert.match(bootMarkup, />谜<\/view>/);
```

- [ ] **Step 3: 将品牌契约加入快速检查**

在根 `package.json` 的 `check:fast` 开头加入：

```json
"node --test scripts/brand-identity.test.mjs && "
```

- [ ] **Step 4: 运行测试并确认因旧品牌失败**

Run: `node --test scripts/brand-identity.test.mjs apps/miniprogram/test/homeColdStart.test.mjs`

Expected: FAIL；失败内容应指向“剧本迷”仍存在或“剧本谜/谜”尚未出现，而不是语法或路径错误。

### Task 3: 更新小程序与 Admin 品牌面

**Files:**
- Modify: `apps/miniprogram/src/manifest.json`
- Modify: `apps/miniprogram/src/pages.json`
- Modify: `apps/miniprogram/src/project.config.json`
- Modify: `apps/miniprogram/src/pages/index/index.vue`
- Modify: `apps/miniprogram/src/pages/session/detail.vue`
- Modify: `apps/miniprogram/src/pages/session/setup.vue`
- Modify: `apps/miniprogram/src/pages/session/share.vue`
- Modify: `apps/miniprogram/src/utils/api.js`
- Modify: `apps/admin-web/index.html`
- Modify: `apps/admin-web/src/App.vue`
- Modify: `apps/admin-web/src/components/LoginPanel.vue`
- Modify: `apps/admin-web/src/components/MiniProgramWorkspace.vue`
- Test: `scripts/brand-identity.test.mjs`
- Test: `apps/miniprogram/test/homeColdStart.test.mjs`
- Test: `apps/miniprogram/test/homeStartupBuild.test.mjs`

- [ ] **Step 1: 精确更新小程序品牌**

执行以下映射，不替换其他“拼车”功能文字：

```text
首页 home-boot-mark: 拼 -> 谜
剧本迷·拼车 -> 剧本谜
剧本迷·拼车，一起玩好本 -> 剧本谜，一起玩好本
剧本迷·拼车，一起沉浸好本。 -> 剧本谜，一起沉浸好本。
登录后继续使用剧本迷·拼车。 -> 登录后继续使用剧本谜。
```

同时把 `manifest.json.name`、`project.config.json.projectname` 和两处 `pages.json.navigationBarTitleText` 设为 `剧本谜`。

- [ ] **Step 2: 精确更新 Admin 品牌**

执行以下映射：

```text
剧本迷管理后台 -> 剧本谜管理后台
剧本迷管理 -> 剧本谜管理
剧本迷·拼车，一起沉浸好本。 -> 剧本谜，一起沉浸好本。
```

- [ ] **Step 3: 验证品牌契约转绿**

Run: `node --test scripts/brand-identity.test.mjs apps/miniprogram/test/homeColdStart.test.mjs`

Expected: PASS，全部品牌和冷启动测试通过。

- [ ] **Step 4: 构建并验证上传产物品牌**

Run: `npm run build:mp-weixin && node --test apps/miniprogram/test/homeStartupBuild.test.mjs && npm run build:admin-web`

Expected: 两个构建退出码均为 0，构建产物首页品牌测试通过。

- [ ] **Step 5: 提交品牌实现与测试**

```bash
git add package.json scripts/brand-identity.test.mjs apps/miniprogram apps/admin-web
git commit -m "feat: rename platform brand to 剧本谜"
```

### Task 4: 完整本地验证

**Files:**
- Verify only

- [ ] **Step 1: 扫描运行时旧品牌与功能词**

Run: `rg -n '剧本迷' apps/miniprogram apps/admin-web -g '!**/node_modules/**' -g '!**/dist/**' -g '!**/wxcomponents/**' -g '!**/uni_modules/**'`

Expected: 无输出。

Run: `rg -n '我的拼车日程|拼车创建|拼车说明|拼车车局' apps/miniprogram/src apps/admin-web/src apps/api/src`

Expected: 仍能找到明确的拼车功能文案。

- [ ] **Step 2: 运行完整检查**

Run: `npm run check`

Expected: exit 0；包括此前失败的 D53 契约、品牌契约、构建与现有测试全部通过。

- [ ] **Step 3: 检查提交范围和工作区**

Run: `git status --short --branch`

Run: `git diff --check origin/develop...HEAD`

Run: `git diff --stat origin/develop...HEAD`

Expected: 工作区干净；差异只包括设计/计划、品牌测试、品牌展示文件和获准的 D53 类名修复。

### Task 5: 受控三分支 CI 发布

**Files:**
- Git refs only

- [ ] **Step 1: 更新远端状态并确认 develop 可快进**

Run: `git fetch origin --prune`

Run: `git rev-list --left-right --count origin/develop...HEAD`

Expected: 左侧为 `0`；若远端出现新提交，停止并先合并远端，不强推。

- [ ] **Step 2: 推送到 develop 并等待 CI**

Run: `git push origin HEAD:develop`

Run: `gh run list --repo jubenmi/pinche --branch develop --workflow "Docker Publish" --limit 5`

Run: `gh run watch "$(gh run list --repo jubenmi/pinche --branch develop --workflow 'Docker Publish' --limit 1 --json databaseId --jq '.[0].databaseId')" --repo jubenmi/pinche --exit-status`

Expected: develop CI success。

- [ ] **Step 3: 从远端 main 创建临时 worktree并合并已验证 develop**

```bash
git worktree add --detach /private/tmp/pinche-rebrand-main-20260801 origin/main
git -C /private/tmp/pinche-rebrand-main-20260801 merge --no-ff origin/develop -m "Merge develop into main"
git -C /private/tmp/pinche-rebrand-main-20260801 push origin HEAD:main
```

等待 `main` 的 Docker Publish CI success 后继续。

- [ ] **Step 4: 从远端 publish 创建临时 worktree并合并已验证 main**

```bash
git worktree add --detach /private/tmp/pinche-rebrand-publish-20260801 origin/publish
git -C /private/tmp/pinche-rebrand-publish-20260801 merge --no-ff origin/main -m "Merge main into publish"
git -C /private/tmp/pinche-rebrand-publish-20260801 push origin HEAD:publish
```

等待 `publish` 的 Docker Publish CI success 后继续。

- [ ] **Step 5: 记录 SHA、CI run id 并清理 main 发布 worktree**

记录 `develop`、`main`、`publish` 远端 SHA 和三次 CI run id。移除 `/private/tmp/pinche-rebrand-main-20260801`，保留最终 publish worktree用于小程序构建上传。不得删除主工作区或品牌实施 worktree。

### Task 6: 从已验证 publish 上传微信开发版本

**Files:**
- Build output only: `apps/miniprogram/dist/build/mp-weixin`
- Temporary upload result: `/private/tmp/pinche-rebrand-upload-20260801.json`

- [ ] **Step 1: 从最终 publish 提交构建生产包**

在干净的最终 `publish` worktree 运行：

Run: `git submodule update --init --recursive`

Run: `npm ci`

Run: `npm run build:mp-weixin`

Expected: exit 0，`apps/miniprogram/dist/build/mp-weixin/app.js` 和 `project.config.json` 存在。

- [ ] **Step 2: 验证生产包品牌和 API 配置**

Run: `node --test apps/miniprogram/test/homeStartupBuild.test.mjs && node scripts/miniprogram-production-login-compatibility-check.js --require-build`

Expected: 构建品牌、启动兼容性和生产 API 配置检查通过。

- [ ] **Step 3: 上传微信开发版本**

使用北京时间当天首次计划版本 `0.20260801.1`：

```bash
/Applications/wechatwebdevtools.app/Contents/MacOS/cli upload \
  --project apps/miniprogram/dist/build/mp-weixin \
  --version 0.20260801.1 \
  --desc "剧本谜品牌升级" \
  --info-output /private/tmp/pinche-rebrand-upload-20260801.json
```

Expected: CLI exit 0，输出“代码上传成功”或等价成功状态，info output 记录上传结果。若该版本号已存在，仅将末位递增为 `.2` 后重试。

- [ ] **Step 4: 最终报告**

报告：

- 品牌与获准基线修复的提交 SHA。
- `develop`、`main`、`publish` SHA 和 CI run id/status。
- 微信上传版本号与 CLI 成功证据。
- 主工作区保留且未触碰的用户改动。
- 明确说明未自动提交微信审核、未发布线上小程序版本。

上传结果记录完成后移除 `/private/tmp/pinche-rebrand-publish-20260801` worktree。
