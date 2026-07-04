# D22 Tasks: 首页车局分流执行清单

更新日期：2026-07-04

## D22 执行任务

- [x] D22.1 建立 D22 spec 三件套。
  - [x] `requirements.md` 描述首页分流、首车入口、日历、错误处理和分享落地要求。
  - [x] `design.md` 描述状态机、组件边界、数据接口、错误处理和验证方式。
  - [x] `tasks.md` 描述实现和验收清单。

- [x] D22.2 抽出车局日历组件。
  - [x] 新增 `apps/miniprogram/src/components/SessionCalendar.vue`。
  - [x] 从 `apps/miniprogram/src/pages/mine/index.vue` 迁移日历展示、筛选、日期分组、卡片点击和个人删除/退出逻辑。
  - [x] 组件通过事件通知父页面刷新数据。
  - [x] 组件不包含首页维护态、分享回调和首车入口判断。

- [x] D22.3 改造“我的”页复用日历组件。
  - [x] 保留登录判定、管理员入口和退出入口。
  - [x] 复用 `SessionCalendar` 渲染车局日历。
  - [x] 确认“我的”页日历行为与改造前一致。

- [x] D22.4 改造首页状态机。
  - [x] 保留现有维护态和重试逻辑。
  - [x] 无有效 token 时展示首车入口。
  - [x] 登录用户进入首页时加载我的发车和我参与的车。
  - [x] 两个接口均成功且合并为空时展示首车入口。
  - [x] 任一接口失败时展示错误和重试，不进入发车流程。
  - [x] 合并结果非空时展示车局日历。

- [x] D22.5 实现首车入口行为。
  - [x] 首车入口展示 `发起第一辆车`、说明文案和 `开始发车`。
  - [x] 未登录点击 `开始发车` 先调用 `ensureLoggedIn()`。
  - [x] 登录成功后重新加载我的车局。
  - [x] 登录后已有车局时展示日历。
  - [x] 登录后仍无车时清空创建流程并进入 `/pages/session/create`。
  - [x] 登录取消或失败时留在首车入口。

- [x] D22.6 实现首页日历发车入口。
  - [x] 日历顶部标题使用 `我的车局`。
  - [x] 日历顶部主按钮使用 `发车`。
  - [x] 点击 `发车` 调用 `clearCreateFlow()`。
  - [x] 点击 `发车` 后进入 `/pages/session/create`。
  - [x] 管理员入口和退出入口保持弱操作。

- [x] D22.7 保留首页分享能力。
  - [x] 保留 `onShareAppMessage`。
  - [x] 保留 `onShareTimeline`。
  - [x] 好友和群分享继续打开 `/pages/index/index`。
  - [x] 朋友圈分享继续使用首页 query。
  - [x] 分享图继续使用现有首页水墨图。

- [x] D22.8 扩展静态检查。
  - 已完成：先写 D22 首页分流静态断言并确认旧首页失败，再完成实现让检查通过。
  - [x] 更新 `scripts/check-miniprogram.js`，检查首页首车入口文案。
  - [x] 检查首页调用 `ensureLoggedIn()` 后重新加载我的车局。
  - [x] 检查首页加载 `/api/users/me/sessions` 和 `/api/users/me/signups`。
  - [x] 检查首页有 `我的车局` 和 `发车` 日历入口。
  - [x] 检查首页发车按钮会清空创建流程并进入 `/pages/session/create`。
  - [x] 检查首页仍保留维护态和微信分享回调。
  - [x] 检查首页和“我的”页复用 `SessionCalendar`。

- [x] D22.9 执行自动验证。
  - [x] 运行 `npm run check`。
  - [x] 运行 `npm run build:mp-weixin`。
  - [x] 修复 D22 范围内导致的检查或构建失败。

- [ ] D22.10 微信开发者工具验证。
  - [ ] 无 token 进入首页，看到首车入口。
  - [ ] 未登录点击开始发车，先触发微信登录。
  - [ ] 登录后账号没有车局，进入发车流程。
  - [ ] 登录后账号已有车局，进入车局日历。
  - [ ] 日历点击发车，进入当前发车流程。
  - [ ] 日历卡片操作与原“我的”页一致。
  - [ ] 后端维护时只展示维护态。

## D22 验收

- [x] D22 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D22 design 已落地到 [design.md](./design.md)。
- [x] D22 tasks 已落地到本文件。
- [x] 未登录和登录无车用户共用首车入口。
- [x] 未登录点击开始发车后先登录，再重新判定是否有车。
- [x] 已有车局用户进入首页日历。
- [x] 首页日历顶部有 `发车` 主按钮。
- [x] 首页和“我的”复用同一车局日历组件。
- [x] 首页维护态和分享能力保留。
- [x] `npm run check` 通过。
- [x] `npm run build:mp-weixin` 通过。

## 验证记录

- `npm run check`：通过，2026-07-04。
- `npm run build:mp-weixin`：通过，2026-07-04；仅有 `uv-waterfall` Sass legacy API / `@import` deprecation warning。
- 微信开发者工具验证：未执行，待人工导入 `dist/build/mp-weixin` 后走查。
