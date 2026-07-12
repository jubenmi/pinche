# 微信小程序 COS SDK 打包修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 确保 COS 微信 SDK 被 uni-app/Vite 打入最终微信小程序包，不再留下微信运行时无法解析的裸模块 `require`。

**Architecture:** `apps/miniprogram/src/utils/api.js` 在模块顶层静态导入 SDK，构建器负责把 CommonJS SDK 收进公共 vendor chunk。源码测试约束导入方式，独立构建产物检查约束最终交付包，避免源码字符串检查再次误报。

**Tech Stack:** uni-app、Vite、微信小程序、Node.js `node:test`、Tencent COS WeChat SDK

---

### Task 1: 建立最终构建包失败门禁

进度：已完成；门禁已通过红—绿验证，可捕获最终包中的裸模块 `require`。

CI 备注：GitHub Actions 的干净工作区没有被忽略的 `dist`，首次 develop run `29175525732` 因 ENOENT 失败。相册媒体测试脚本已收紧为先执行生产构建再运行产物门禁，避免本地残留构建包造成假通过。

Node 检查备注：静态 COS import 会在 `check-maintenance-mode.js` 导入 `api.js` 时读取微信全局对象；该既有检查现提供与相册上传单测一致的最小 `wx` 桩，生产代码不受影响。

**Files:**
- Create: `apps/miniprogram/test/cosSdkBundle.test.mjs`
- Inspect: `apps/miniprogram/dist/build/mp-weixin/utils/api.js`
- Inspect: `apps/miniprogram/dist/build/mp-weixin/common/vendor.js`

- [x] **Step 1: 写最终构建包检查**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const outputRoot = new URL("../dist/build/mp-weixin/", import.meta.url);

test("production bundle resolves the COS SDK at build time", async () => {
  const [apiBundle, vendorBundle] = await Promise.all([
    readFile(new URL("utils/api.js", outputRoot), "utf8"),
    readFile(new URL("common/vendor.js", outputRoot), "utf8")
  ]);

  assert.doesNotMatch(apiBundle, /cos-wx-sdk-v5/);
  assert.doesNotMatch(apiBundle, /utils\/cos-wx-sdk-v5/);
  assert.match(vendorBundle, /sdkVersionName:\s*["']cos-wx-sdk-v5["']/);
});
```

- [x] **Step 2: 用当前生产构建验证测试确实失败**

Run: `node --test test/cosSdkBundle.test.mjs`

Expected: FAIL，指出 `dist/build/mp-weixin/utils/api.js` 仍包含 `require("cos-wx-sdk-v5/index.js")`。

- [x] **Step 3: 把该测试加入相册媒体测试脚本**

将 `apps/miniprogram/package.json` 中脚本改为：

```json
"test:album-media": "node --test test/albumMediaSelection.test.mjs test/albumMediaOperation.test.mjs test/albumPhotoUpload.test.mjs test/cosSdkBundle.test.mjs"
```

### Task 2: 改为构建期静态解析

进度：已完成；源码已改为静态 ESM import，源码级测试通过。

执行备注：静态 import 会让 Node 单测加载 COS SDK；SDK 顶层读取 `wx.getFileSystemManager()`，因此测试在动态导入被测模块前提供最小 `wx` 桩。该调整仅修复测试环境，不改变生产逻辑。

**Files:**
- Modify: `apps/miniprogram/src/utils/api.js`
- Modify: `apps/miniprogram/test/albumPhotoUpload.test.mjs`
- Modify: `scripts/d17-cos-storage-check.js`

- [x] **Step 1: 更新源码级测试表达期望导入方式**

把现有 COS SDK 测试改为匹配顶层静态导入，并同时禁止动态 import 和运行时 require：

```js
assert.match(source, /import COS from "cos-wx-sdk-v5\/index\.js"/);
assert.doesNotMatch(source, /import\("cos-wx-sdk-v5\/index\.js"\)/);
assert.doesNotMatch(source, /require\("cos-wx-sdk-v5\/index\.js"\)/);
```

同步修改 `scripts/d17-cos-storage-check.js` 的三项断言。

- [x] **Step 2: 运行源码级测试并确认失败**

Run: `node --test test/albumPhotoUpload.test.mjs`

Expected: FAIL，当前源码没有静态 ESM import。

- [x] **Step 3: 实施最小静态导入**

在 `apps/miniprogram/src/utils/api.js` 顶层加入：

```js
import COS from "cos-wx-sdk-v5/index.js";
```

并把装载函数缩减为：

```js
async function loadCosSdk() {
  return COS;
}
```

- [x] **Step 4: 运行源码级测试并确认通过**

Run: `node --test test/albumPhotoUpload.test.mjs`

Expected: PASS。

### Task 3: 重建并验证交付包

进度：已完成；生产构建、最终包检查和相关回归检查均通过。

**Files:**
- Generate: `apps/miniprogram/dist/build/mp-weixin/**`（忽略的构建产物）

- [x] **Step 1: 执行生产构建**

Run: `npm run build:mp-weixin`

Expected: exit 0，输出 `DONE Build complete.`。

- [x] **Step 2: 运行最终构建包回归测试**

Run: `node --test test/cosSdkBundle.test.mjs`

Expected: PASS，`utils/api.js` 不再包含 COS 包名，vendor chunk 包含 SDK 标识。

- [x] **Step 3: 运行相关回归检查**

Run: `npm run test:album-media`

Expected: 全部 PASS。

Run: `node scripts/d17-cos-storage-check.js`

Expected: 输出 `D17 COS storage check passed`。

- [x] **Step 4: 检查变更范围并提交**

Run: `git diff --check && git status --short`

Expected: 无 whitespace 错误；仅包含计划内测试、源码和检查脚本。

```bash
git add apps/miniprogram/package.json apps/miniprogram/src/utils/api.js apps/miniprogram/test/albumPhotoUpload.test.mjs apps/miniprogram/test/cosSdkBundle.test.mjs scripts/d17-cos-storage-check.js docs/superpowers/plans/2026-07-12-miniprogram-cos-sdk-bundling-fix.md
git commit -m "fix: bundle COS SDK into mini program"
```
