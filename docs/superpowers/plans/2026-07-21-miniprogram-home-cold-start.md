# 微信小程序首页冷启动可见性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除微信小程序首页冷启动期间导航栏下方的纯白空窗，并保留现有游客、登录和维护流程。

**Architecture:** 在首页后端状态首次确定前，只渲染不依赖自定义组件的原生 `view` 启动态；首次健康检查完成后，再挂载现有业务组件。源码回归测试锁定模板分支和启动状态条件，生产构建与微信开发者工具冷启动验证最终交付行为。

**Tech Stack:** Vue 3、uni-app、微信小程序、Node.js `node:test`、微信开发者工具

---

### Task 1: 建立冷启动首帧回归门禁

**Files:**
- Create: `apps/miniprogram/test/homeColdStart.test.mjs`
- Modify: `apps/miniprogram/package.json`
- Modify: `package.json`

- [ ] **Step 1: 写失败测试**

测试读取 `pages/index/index.vue`，要求根页面的第一个条件内容是 `home-boot-state` 原生 `view`，启动块不包含任何自定义/TDesign 组件，业务组件位于 `v-else` 分支，并由 `backendStatus.available === null` 控制。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test apps/miniprogram/test/homeColdStart.test.mjs`

Expected: FAIL，提示首页缺少原生冷启动状态。

- [ ] **Step 3: 接入检查脚本**

在小程序包新增 `test:home-cold-start`，并把它加入根 `precheck`，使 `npm run check` 在后续回归时自动执行。

### Task 2: 实现最小原生首帧

**Files:**
- Modify: `apps/miniprogram/src/pages/index/index.vue`

- [ ] **Step 1: 增加启动状态条件**

在现有 computed 区域增加：

```js
const isHomeBooting = computed(() => backendStatus.available === null);
```

- [ ] **Step 2: 增加原生模板分支并延迟业务组件挂载**

根节点内先渲染：

```vue
<view v-if="isHomeBooting" class="home-boot-state">
  <view class="home-boot-mark">拼</view>
  <view class="home-boot-title">剧本迷·拼车</view>
  <view class="home-boot-text">首页加载中...</view>
</view>
```

把 `AuthIdentityBar`、`FeedbackHost`、维护态和 `SessionCalendar` 放入 `<template v-else>`，不改变其内部业务分支。

- [ ] **Step 3: 增加不依赖组件的启动态样式**

使用现有绿色品牌色、居中布局和纯 CSS 脉冲标记；不引入图片、组件或请求。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm --workspace apps/miniprogram run test:home-cold-start`

Expected: PASS，1 test、0 failures。

### Task 3: 构建与产物验收

**Files:**
- Generate: `apps/miniprogram/dist/build/mp-weixin/**`（忽略的构建产物）

- [ ] **Step 1: 执行生产构建**

Run: `npm run build:mp-weixin`

Expected: exit 0，输出 `DONE Build complete.`。

- [ ] **Step 2: 检查最终 WXML**

确认 `pages/index/index.wxml` 在业务组件前包含原生 `home-boot-state` 条件分支，且构建产物没有模板编译错误。

- [ ] **Step 3: 运行相关回归**

Run: `npm --workspace apps/miniprogram run test:home-cold-start && node scripts/d40-guest-calendar-home-check.js && node scripts/check-maintenance-mode.js && npm run check`

Expected: 全部 PASS。

### Task 4: 冷启动与审核体验验证

**Files:**
- Inspect: `apps/miniprogram/dist/build/mp-weixin/**`

- [ ] **Step 1: 用微信开发者工具打开生产包并清缓存冷启动**

Expected: 导航栏出现后，业务区立即显示原生启动态，不出现纯白页。

- [ ] **Step 2: 验证首次请求完成后的两条路径**

正常网络进入游客首页并显示公开车局空态；模拟不可用网络进入维护态。两条路径都必须从启动态过渡，不能停留白屏。

- [ ] **Step 3: 验证登录和核心入口**

使用全新登录态完成显式登录，确认首页身份、车局入口及一个核心详情流程可操作。

### Task 5: 发布与录屏

**Files:**
- No source changes expected.

- [ ] **Step 1: 检查 diff、提交修复并走现有 develop → main → publish 守护发布流程**

- [ ] **Step 2: 从最终 publish 提交重新构建并上传新的小程序体验版本**

- [ ] **Step 3: 录制完整审核视频**

视频从全新冷启动开始，连续展示启动态、游客首页、显式登录和核心功能；不剪断关键转场，不展示开发调试悬浮窗。

- [ ] **Step 4: 交付版本号、提交 SHA、CI 结果和视频路径；未经用户明确要求不提交正式审核**
