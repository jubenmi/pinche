# 相册图片/视频单入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将小程序相册的图片与管理员视频上传收敛为一个入口，并根据 `wx.chooseMedia` 返回类型复用现有图片或视频上传链路。

**Architecture:** 新增一个无副作用的 `classifyAlbumMediaSelection` 工具，负责把微信选择结果归类为多图、单视频或整体无效；`album.vue` 只负责权限/兼容分支、调用选择器和把分类结果交给现有上传方法。普通成员及不支持 `wx.chooseMedia` 的微信版本继续使用 `uni.chooseImage`，后端和 COS 链路不变。

**Tech Stack:** UniApp Vue 2 Options API、微信小程序 `wx.chooseMedia` / `uni.chooseImage`、Node.js `node:test`、现有 Node 静态回归脚本。

---

## File map

- Create: `apps/miniprogram/src/utils/albumMediaSelection.js` — 规范化并分类微信媒体选择结果，不访问 UI 或网络。
- Create: `apps/miniprogram/test/albumMediaSelection.test.mjs` — 选择结果分类的行为单测。
- Modify: `apps/miniprogram/src/pages/session/album.vue` — 单入口 UI、管理员统一选择器、图片/视频分流与两列样式。
- Modify: `scripts/d42-miniprogram-album-video-check.js` — 锁定单入口、权限分支与原上传链路复用。
- Modify: `scripts/d32-admin-album-video-check.js` — 把旧 `chooseVideo` 契约更新为 `chooseAlbumMedia`。
- Modify: `scripts/check-miniprogram.js` — 更新总小程序检查中的 D32 上传入口契约。
- Modify: `scripts/d20-album-first-lifecycle-check.js` — 更新空相册上传按钮契约。

### Task 1: 可独立测试的媒体选择分类器

**Files:**
- Create: `apps/miniprogram/test/albumMediaSelection.test.mjs`
- Create: `apps/miniprogram/src/utils/albumMediaSelection.js`
- Modify: `docs/superpowers/plans/2026-07-12-album-single-media-upload-entry.md`

- [x] **Step 1: 写入会失败的分类行为测试**

创建 `apps/miniprogram/test/albumMediaSelection.test.mjs`：

```js
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const helperUrl = new URL("../src/utils/albumMediaSelection.js", import.meta.url);

async function classifyAlbumMediaSelection(result) {
  assert.equal(
    existsSync(fileURLToPath(helperUrl)),
    true,
    "album media selection helper must exist"
  );
  const helper = await import(helperUrl);
  return helper.classifyAlbumMediaSelection(result);
}

test("classifies multiple selected images", async () => {
  assert.deepEqual(
    await classifyAlbumMediaSelection({
      tempFiles: [
        { fileType: "image", tempFilePath: "wxfile://first.jpg" },
        { fileType: "image", tempFilePath: "wxfile://second.jpg" }
      ]
    }),
    { kind: "images", paths: ["wxfile://first.jpg", "wxfile://second.jpg"] }
  );
});

test("classifies one selected video and preserves its metadata", async () => {
  const file = {
    fileType: "video",
    tempFilePath: "wxfile://clip.mp4",
    duration: 12,
    size: 2048
  };
  const selection = await classifyAlbumMediaSelection({ tempFiles: [file] });
  assert.equal(selection.kind, "video");
  assert.equal(selection.file, file);
});

test("uses the result-level type when a file has no fileType", async () => {
  assert.deepEqual(
    await classifyAlbumMediaSelection({
      type: "image",
      tempFiles: [{ tempFilePath: "wxfile://legacy.jpg" }]
    }),
    { kind: "images", paths: ["wxfile://legacy.jpg"] }
  );
});

test("rejects mixed image and video selections without partial output", async () => {
  assert.deepEqual(
    await classifyAlbumMediaSelection({
      tempFiles: [
        { fileType: "image", tempFilePath: "wxfile://photo.jpg" },
        { fileType: "video", tempFilePath: "wxfile://clip.mp4" }
      ]
    }),
    { kind: "invalid", message: "图片可多选，视频请一次只选 1 个" }
  );
});

test("rejects multiple selected videos", async () => {
  assert.deepEqual(
    await classifyAlbumMediaSelection({
      tempFiles: [
        { fileType: "video", tempFilePath: "wxfile://first.mp4" },
        { fileType: "video", tempFilePath: "wxfile://second.mp4" }
      ]
    }),
    { kind: "invalid", message: "图片可多选，视频请一次只选 1 个" }
  );
});

test("rejects empty, unknown, and pathless selections", async () => {
  const invalid = { kind: "invalid", message: "没有可上传的图片或视频" };
  assert.deepEqual(await classifyAlbumMediaSelection(), invalid);
  assert.deepEqual(
    await classifyAlbumMediaSelection({
      tempFiles: [{ fileType: "audio", tempFilePath: "wxfile://sound.mp3" }]
    }),
    invalid
  );
  assert.deepEqual(
    await classifyAlbumMediaSelection({ tempFiles: [{ fileType: "image" }] }),
    invalid
  );
});
```

- [x] **Step 2: 运行测试并确认 RED**

Run: `node --test apps/miniprogram/test/albumMediaSelection.test.mjs`

Expected: FAIL，断言信息为 `album media selection helper must exist`，因为分类模块尚未创建；测试文件本身可以被 Node 正常加载和执行。

- [x] **Step 3: 写入最小分类实现**

创建 `apps/miniprogram/src/utils/albumMediaSelection.js`：

```js
const INVALID_SELECTION_MESSAGE = "没有可上传的图片或视频";
const MULTIPLE_OR_MIXED_MESSAGE = "图片可多选，视频请一次只选 1 个";

function invalidSelection(message = INVALID_SELECTION_MESSAGE) {
  return { kind: "invalid", message };
}

function selectedFileType(file, fallbackType) {
  const type = String(file?.fileType || file?.type || fallbackType || "")
    .trim()
    .toLowerCase();
  return type === "image" || type === "video" ? type : "";
}

function selectedFilePath(file) {
  return String(file?.tempFilePath || file?.path || "").trim();
}

export function classifyAlbumMediaSelection(result = {}) {
  const files = Array.isArray(result?.tempFiles) ? result.tempFiles : [];
  if (files.length === 0) {
    return invalidSelection();
  }

  const selected = files.map((file) => ({
    file,
    path: selectedFilePath(file),
    type: selectedFileType(file, result?.type)
  }));
  if (selected.some((item) => !item.path || !item.type)) {
    return invalidSelection();
  }

  const images = selected.filter((item) => item.type === "image");
  const videos = selected.filter((item) => item.type === "video");
  if (videos.length > 0 && (videos.length !== 1 || images.length > 0)) {
    return invalidSelection(MULTIPLE_OR_MIXED_MESSAGE);
  }
  if (videos.length === 1) {
    return { kind: "video", file: videos[0].file };
  }
  return { kind: "images", paths: images.map((item) => item.path) };
}
```

- [x] **Step 4: 运行测试并确认 GREEN**

Run: `node --test apps/miniprogram/test/albumMediaSelection.test.mjs`

Expected: PASS，6 个测试通过，0 个失败。

- [x] **Step 5: 标记 Task 1 完成并提交**

更新本计划 Task 1 的复选框为 `- [x]`，然后运行：

```bash
git add apps/miniprogram/src/utils/albumMediaSelection.js apps/miniprogram/test/albumMediaSelection.test.mjs docs/superpowers/plans/2026-07-12-album-single-media-upload-entry.md
git commit -m "test: cover album media selection routing"
```

### Task 2: 单入口 UI 与现有上传链路分流

**Files:**
- Modify: `scripts/d42-miniprogram-album-video-check.js`
- Modify: `scripts/d32-admin-album-video-check.js`
- Modify: `scripts/check-miniprogram.js`
- Modify: `scripts/d20-album-first-lifecycle-check.js`
- Modify: `apps/miniprogram/src/pages/session/album.vue`
- Modify: `docs/superpowers/plans/2026-07-12-album-single-media-upload-entry.md`

- [x] **Step 1: 先更新单入口静态契约**

在 `scripts/d42-miniprogram-album-video-check.js` 的上传检查附近加入：

```js
assert.equal(
  (album.match(/@tap="chooseAlbumMedia"/g) || []).length,
  2,
  "the primary and empty-state upload buttons must share one media entry"
);
assert.doesNotMatch(album, /@tap="chooseVideo"|album-video-upload-action|album-primary-actions\.has-video/);
const chooseAlbumMedia = block(album, "chooseAlbumMedia() {", "choosePhotos() {");
assert.match(chooseAlbumMedia, /this\.canUploadVideo/);
assert.match(chooseAlbumMedia, /mediaType:\s*\["image",\s*"video"\]/);
assert.match(chooseAlbumMedia, /classifyAlbumMediaSelection/);
assert.match(chooseAlbumMedia, /this\.uploadChosenPhotos\(selection\.paths\)/);
assert.match(chooseAlbumMedia, /this\.uploadChosenVideo\(selection\.file\)/);
```

在 `scripts/d32-admin-album-video-check.js` 将：

```js
assertIncludes("apps/miniprogram/src/pages/session/album.vue", "chooseVideo");
```

替换为：

```js
assertIncludes("apps/miniprogram/src/pages/session/album.vue", "chooseAlbumMedia");
assertIncludes("apps/miniprogram/src/pages/session/album.vue", "classifyAlbumMediaSelection");
assertNotIncludes("apps/miniprogram/src/pages/session/album.vue", "@tap=\"chooseVideo\"");
```

在 `scripts/check-miniprogram.js` 的 `requiredD32AlbumVideoText` 数组中把 `"chooseVideo"` 替换为：

```js
"chooseAlbumMedia",
"classifyAlbumMediaSelection",
```

在 `scripts/d20-album-first-lifecycle-check.js` 的空相册 token 数组中把：

```js
"@tap=\"choosePhotos\""
```

替换为：

```js
"@tap=\"chooseAlbumMedia\""
```

- [x] **Step 2: 运行契约并确认 RED**

Run:

```bash
node scripts/d42-miniprogram-album-video-check.js
node scripts/d32-admin-album-video-check.js
node scripts/d20-album-first-lifecycle-check.js
node scripts/check-miniprogram.js
```

Expected: 每个更新后的契约都因 `chooseAlbumMedia` 尚不存在或旧 `chooseVideo` 入口仍存在而失败；失败必须来自预期的单入口断言。

- [x] **Step 3: 实现统一入口模板、导入和方法**

在 `apps/miniprogram/src/pages/session/album.vue`：

1. 删除 `album-primary-actions` 上的 `:class="{ 'has-video': canUploadVideo }"`。
2. 将顶部主按钮和空相册按钮的 `@tap="choosePhotos"` 都改成 `@tap="chooseAlbumMedia"`。
3. 删除整个 `v-if="canUploadVideo"` 的“短视频”按钮。
4. 在工具导入区加入：

```js
import { classifyAlbumMediaSelection } from "../../utils/albumMediaSelection";
```

5. 用以下方法替换原 `chooseVideo()`；方法位置放在 `choosePhotos()` 之前：

```js
chooseAlbumMedia() {
  if (this.timelineMode || !this.canUpload || this.albumBusy) {
    showToast({ title: "发车后同车成员可上传", icon: "none" });
    return;
  }
  if (!this.canUploadVideo) {
    this.choosePhotos();
    return;
  }
  if (typeof wx === "undefined" || typeof wx.chooseMedia !== "function") {
    showToast({ title: "当前微信版本仅支持选择图片", icon: "none" });
    this.choosePhotos();
    return;
  }
  wx.chooseMedia({
    count: 9,
    mediaType: ["image", "video"],
    sourceType: ["album", "camera"],
    sizeType: ["original"],
    maxDuration: MAX_ALBUM_VIDEO_DURATION_SECONDS,
    success: async (result) => {
      const selection = classifyAlbumMediaSelection(result);
      if (selection.kind === "invalid") {
        showToast({ title: selection.message, icon: "none" });
        return;
      }
      if (selection.kind === "video") {
        await this.uploadChosenVideo(selection.file);
        return;
      }
      await this.uploadChosenPhotos(selection.paths);
    }
  });
},
```

保留现有 `choosePhotos`、`uploadChosenPhotos`、`uploadChosenVideo` 的实现不变。

- [x] **Step 4: 清理三列视频按钮样式**

在 `apps/miniprogram/src/pages/session/album.vue` 删除：

```css
.album-primary-actions.has-video {
  grid-template-columns: minmax(0, 1fr) 148rpx 148rpx;
}
```

并从所有组合选择器中移除 `.album-video-upload-action`，删除它不再被引用的单独样式；保留 `.album-primary-actions` 的两列布局及 `.album-privacy-action` 样式。

- [x] **Step 5: 运行分类与静态契约并确认 GREEN**

Run:

```bash
node --test apps/miniprogram/test/albumMediaSelection.test.mjs
node scripts/d42-miniprogram-album-video-check.js
node scripts/d32-admin-album-video-check.js
node scripts/d20-album-first-lifecycle-check.js
node scripts/check-miniprogram.js
```

Expected: 所有命令 PASS；静态契约确认两个入口共用 `chooseAlbumMedia`，不存在独立视频按钮，并继续调用原图片/视频上传方法。

- [x] **Step 6: 标记 Task 2 完成并提交**

更新本计划 Task 2 的复选框为 `- [x]`，然后运行：

```bash
git add apps/miniprogram/src/pages/session/album.vue scripts/d42-miniprogram-album-video-check.js scripts/d32-admin-album-video-check.js scripts/check-miniprogram.js scripts/d20-album-first-lifecycle-check.js docs/superpowers/plans/2026-07-12-album-single-media-upload-entry.md
git commit -m "feat: unify album image and video upload entry"
```

### Task 3: 回归验证与交付审查

**Files:**
- Modify: `docs/superpowers/plans/2026-07-12-album-single-media-upload-entry.md`

- [ ] **Step 1: 运行相册媒体和权限回归**

Run:

```bash
npm run d42:mini
node scripts/d18-session-album-privacy-check.js
node scripts/d23-album-share-join-policy-check.js
node scripts/d31-album-viewer-sequence-check.js
```

Expected: D42 mini 8/8 通过，D42 集成检查、D18、D23 和 D31 全部 PASS。

- [ ] **Step 2: 运行小程序生产构建**

Run: `npm run build:mp-weixin`

Expected: exit 0，生成 `apps/miniprogram/dist/build/mp-weixin`；允许现有 Sass legacy API 弃用警告，不允许编译错误。

- [ ] **Step 3: 运行根检查并检查补丁卫生**

Run:

```bash
npm run check
git diff --check HEAD~2..HEAD
git status --short
```

Expected: `npm run check` exit 0；`git diff --check` 无输出；状态只允许计划复选框的最终更新。

- [ ] **Step 4: 请求代码审查并处理问题**

使用 `superpowers:requesting-code-review` 对设计提交 `d255de6` 至当前 HEAD 的差异做审查。若发现问题，先添加会失败的回归测试，再做最小修复并重跑 Task 3 的全部命令。

- [ ] **Step 5: 标记 Task 3 完成并提交计划状态**

把 Task 3 全部复选框改为 `- [x]`，然后运行：

```bash
git add docs/superpowers/plans/2026-07-12-album-single-media-upload-entry.md
git commit -m "docs: complete album media upload entry plan"
```

- [ ] **Step 6: 最终状态核验**

Run:

```bash
git status --short
git log -4 --oneline
```

Expected: 工作树干净；日志包含计划、分类测试、单入口实现和计划完成提交。
