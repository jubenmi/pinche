# 相册预览分享图标修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让相册预览的分享入口在所有状态下保持同一个分享图标，不可用时变灰，并通过独立提示窗口反馈准备错误。

**Architecture:** 保留 `AlbumImageViewer.vue` 只负责展示和派发点击事件的边界；分享状态与重试仍由 `album.vue` 管理。失败提示在分享准备请求的错误分支触发，避免用按钮文字泄露内部状态。

**Tech Stack:** uni-app、Vue 2、小程序原生 `open-type="share"`、Node.js 静态契约检查

---

### Task 1: 锁定分享入口视觉契约

**Files:**
- Modify: `scripts/d50-album-single-media-sharing-check.js`
- Modify: `apps/miniprogram/src/components/AlbumImageViewer.vue`

- [x] **Step 1: 写失败的静态契约检查**

要求组件引用 `/static/icons/share-light.svg`，非隐藏状态只渲染该图标，`blocked` 状态应用灰色不可用样式，并且模板不包含“准备中”“不可分享”“重试分享”。

- [x] **Step 2: 运行测试并确认失败**

Run: `node scripts/d50-album-single-media-sharing-check.js`

Expected: FAIL，指出分享图标契约尚未满足。

- [x] **Step 3: 实现最小模板与样式修改**

在 ready 的原生分享按钮和其他状态的点击容器中渲染同一个：

```vue
<t-image class="album-image-viewer__share-icon" src="/static/icons/share-light.svg" mode="aspectFit" width="32rpx" height="32rpx" />
```

删除分享按钮的文字专用宽度、内边距和字号，让它沿用 58rpx 圆形图标按钮规格。

- [x] **Step 4: 运行测试并确认通过**

Run: `node scripts/d50-album-single-media-sharing-check.js`

Expected: `D50 album single-media sharing checks passed`

### Task 2: 锁定失败提示窗口契约

**Files:**
- Modify: `scripts/d50-album-single-media-sharing-check.js`
- Modify: `apps/miniprogram/src/pages/session/album.vue`

- [x] **Step 1: 写失败的错误提示契约检查**

要求 `prepareSingleMediaShare` 的 catch 分支只在 `force` 用户重试失败并记录 `failed` 状态后调用 `showModal`；后台预加载失败保持静默。

- [x] **Step 2: 运行测试并确认失败**

Run: `node scripts/d50-album-single-media-sharing-check.js`

Expected: FAIL，指出分享准备错误没有独立提示窗口。

- [x] **Step 3: 实现最小错误提示**

在当前请求仍有效且状态为 `failed` 时调用：

```js
showModal({
  title: "分享暂不可用",
  content: error?.userMessage || "分享准备失败，请稍后再试。",
  showCancel: false,
  confirmText: "知道了"
});
```

`blocked` 状态继续由点击分享图标时的现有 toast 提示，不改变权限判定。

- [x] **Step 4: 运行测试并确认通过**

Run: `node scripts/d50-album-single-media-sharing-check.js`

Expected: `D50 album single-media sharing checks passed`

### Task 3: 回归验证

**Files:**
- Verify: `apps/miniprogram/src/components/AlbumImageViewer.vue`
- Verify: `apps/miniprogram/src/pages/session/album.vue`
- Verify: `scripts/d50-album-single-media-sharing-check.js`

- [x] **Step 1: 运行单媒体分享单元测试**

Run: `node --test apps/miniprogram/test/albumSingleMediaShare.test.mjs`

Expected: all tests pass。

- [x] **Step 2: 运行小程序静态检查**

Run: `node scripts/check-miniprogram.js`

Expected: exit code 0。

- [x] **Step 3: 检查差异**

Run: `git diff --check && git diff -- apps/miniprogram/src/components/AlbumImageViewer.vue apps/miniprogram/src/pages/session/album.vue scripts/d50-album-single-media-sharing-check.js`

Expected: 无空白错误，差异仅包含本修复。
