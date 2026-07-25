# 小程序审核首页白屏修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让微信审核环境在逻辑层执行前、首页组件初始化中和首批数据失败时都不会出现纯白业务区域。

**Architecture:** 移除公共启动 vendor 对完整 `Intl` 的同步依赖；使用微信静态初始渲染缓存提前显示纯原生启动态；把“允许挂载业务组件”和“可以隐藏启动态”拆成两个状态。production 构建测试直接检查最终上传目录。

**Tech Stack:** UniApp、Vue 3、微信小程序、Node.js test runner

---

### Task 1: 消除 Intl 启动依赖

**Files:**
- Modify: `packages/shared/test/beijingTime.test.mjs`
- Modify: `packages/shared/src/beijingTime.js`

- [ ] 写测试：分别在 `globalThis.Intl = undefined` 和 `DateTimeFormat` 无
  `formatToParts` 时重新导入模块，断言 `beijingDateKey`、`beijingTimeText` 和
  `formatBeijingDateTime` 仍返回北京时间。
- [ ] 运行 `npm --workspace packages/shared run test:time`，确认新用例因当前顶层
  `Intl.DateTimeFormat` 失败。
- [ ] 删除顶层 formatter，增加 `8 * 60 * 60 * 1000` 偏移；解析时间后创建偏移后的
  `Date`，使用 `getUTCFullYear/getUTCMonth/getUTCDate/getUTCHours` 等字段返回结果。
- [ ] 重跑共享时间测试并提交 `fix(miniprogram): remove Intl startup dependency`。

### Task 2: 延长首页启动态

**Files:**
- Modify: `apps/miniprogram/test/homeColdStart.test.mjs`
- Modify: `apps/miniprogram/src/pages/index/index.vue`
- Modify: `apps/miniprogram/src/pages.json`

- [ ] 扩展源码测试，要求存在 `hasBackendResult`、`showHomeBoot`、
  `initialHomeSettled`，业务分支由 `hasBackendResult` 控制，首批请求在 `finally`
  中结束启动态，首页配置 `initialRenderingCache: "static"`。
- [ ] 运行 `npm --workspace apps/miniprogram run test:home-cold-start`，确认 RED。
- [ ] 启动态继续使用行内 `display`，避免静态初始渲染缺少页面数据时被 `wx:if`
  删除；业务分支在健康检查后挂载；启动态改为带背景色的绝对覆盖层。
- [ ] `loadHomeCalendar()` 无论成功或失败都将 `initialHomeSettled` 设为 `true`，
  让现有业务错误态接管页面。
- [ ] 在首页页面配置增加静态初始渲染，重跑源码测试并提交
  `fix(miniprogram): keep review home visible during startup`。

### Task 3: 检查实际 production 产物

**Files:**
- Create: `apps/miniprogram/test/homeStartupBuild.test.mjs`
- Modify: `apps/miniprogram/package.json`

- [ ] 新测试读取 `dist/build/mp-weixin/pages/index/index.json`，断言
  `initialRenderingCache` 为 `static`。
- [ ] 读取首页 WXML，断言 `home-boot-state` 位于第一个业务 `wx:if` 之前，且包含
  “剧本迷·拼车”。
- [ ] 读取 `common/vendor.js`，断言不含 `Intl.DateTimeFormat` 和
  `formatToParts`。
- [ ] 将新测试加入现有 `test:tdesign-runtime` production 构建测试。
- [ ] 运行 production 构建测试、共享时间测试、首页源码测试、
  `check-miniprogram --require-built-wxml`、WeChatLib 兼容检查和 `git diff --check`。
- [ ] 提交 `test(miniprogram): gate review home startup build`。

### Task 4: 冷启动、发布与送审

- [ ] 用干净 production 目录打开微信开发者工具，开启严格域名检查，全部清缓存后编译。
- [ ] 确认启动态先出现，随后游客首页完整显示，控制台 0 error。
- [ ] 合并到本地 `develop`，推送并等待 CI 成功。
- [ ] 按发布流程合并 `develop → main → publish`，等待 CI/Docker 成功。
- [ ] 从最终 publish 提交重新 production 构建，记录 SHA-256 和包体大小后上传体验版。
- [ ] 检查体验版首页冷启动与核心游客流程，随后在微信公众平台提交审核。
