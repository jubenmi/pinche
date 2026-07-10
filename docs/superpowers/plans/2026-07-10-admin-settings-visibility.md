# 首页管理员设置入口可见性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 仅向 `system_admin` 显示首页设置按钮，并在按钮隐藏时让发车按钮占满整行。

**Architecture:** 首页继续拥有认证和角色状态，以现有 `isAdmin` 作为设置入口的唯一显示条件；`SessionCalendar` 只消费布尔 prop，并用同一 prop 切换双列或单列操作栏。保留现有管理事件的权限防御，不引入新的角色或全局状态依赖。

**Tech Stack:** Vue 3 `<script setup>`、uni-app、微信小程序、Node.js 静态契约检查

---

## 文件边界

- Modify: `scripts/d40-guest-calendar-home-check.js` — 锁定游客/普通用户/管理员设置入口与单列布局契约。
- Modify: `apps/miniprogram/src/pages/index/index.vue:92-98` — 将设置入口显示条件收紧为 `system_admin`。
- Modify: `apps/miniprogram/src/components/SessionCalendar.vue:4-20,1321-1326` — 设置节点隐藏时切换为单列满宽网格。

当前三个目标文件都与工作区现有 D40/D41 未提交改动重叠。实施时只做计划列出的窄范围编辑，不创建会遗漏这些权威改动的新 worktree，也不自动提交整文件中的既有改动。

### Task 1: 锁定并修复管理员可见性

**Files:**
- Modify: `scripts/d40-guest-calendar-home-check.js:54-58`
- Modify: `apps/miniprogram/src/pages/index/index.vue:92-98`
- Test: `scripts/d40-guest-calendar-home-check.js`

- [x] **Step 1: 写入会失败的权限契约**

在首页 CTA 断言后加入：

```js
assert(
  home.includes("const showAdminAction = computed(() => isAdmin.value);") &&
    !home.includes("!isAuthenticated.value || isAdmin.value"),
  "D40 home admin settings must render only for system_admin"
);
```

- [x] **Step 2: 运行测试并确认 RED**

Run: `node scripts/d40-guest-calendar-home-check.js`

Expected: FAIL，错误包含 `D40 home admin settings must render only for system_admin`，因为当前实现仍把游客包含在 `showAdminAction` 中。

- [x] **Step 3: 实施最小权限修复**

将首页计算属性改为：

```js
const showAdminAction = computed(() => isAdmin.value);
```

保留 `isAdmin` 的现有 `roles.value.includes("system_admin")` 定义和 `handleAdminAction` 的防御判断。

- [x] **Step 4: 运行聚焦测试并确认 GREEN**

Run: `node scripts/d40-guest-calendar-home-check.js`

Expected: PASS with `D40 guest calendar home checks passed`。

- [x] **Step 5: 检查窄范围差异**

Run: `git diff -- scripts/d40-guest-calendar-home-check.js apps/miniprogram/src/pages/index/index.vue`

Expected: 新增权限契约，生产行为只改变 `showAdminAction` 条件；不改登录、发车或管理页导航流程。

### Task 2: 锁定并修复单按钮满宽布局

**Files:**
- Modify: `scripts/d40-guest-calendar-home-check.js:58-70`
- Modify: `apps/miniprogram/src/components/SessionCalendar.vue:4-20,1321-1326`
- Test: `scripts/d40-guest-calendar-home-check.js`

- [x] **Step 1: 写入会失败的布局契约**

在权限契约后加入：

```js
assert(
  calendar.includes(`:class="{ 'calendar-action-bar--single': !showAdminButton }"`) &&
    calendar.includes(".calendar-action-bar--single") &&
    calendar.includes("grid-template-columns: minmax(0, 1fr);"),
  "D40 calendar create action must fill the row when admin settings are hidden"
);
assert(
  calendar.includes('v-if="showAdminButton"'),
  "D40 calendar must remove the admin settings node for non-admin users"
);
```

- [x] **Step 2: 运行测试并确认 RED**

Run: `node scripts/d40-guest-calendar-home-check.js`

Expected: FAIL，错误包含 `D40 calendar create action must fill the row when admin settings are hidden`，因为操作栏还没有单列状态。

- [x] **Step 3: 实施最小布局修复**

把操作栏模板改为：

```vue
<view
  v-if="showCalendarActions"
  class="calendar-action-bar"
  :class="{ 'calendar-action-bar--single': !showAdminButton }"
>
```

在现有 `.calendar-action-bar` 后加入：

```css
.calendar-action-bar--single {
  grid-template-columns: minmax(0, 1fr);
}
```

不修改管理员双列网格、按钮高度、间距、图标或事件。

- [x] **Step 4: 运行聚焦测试并确认 GREEN**

Run: `node scripts/d40-guest-calendar-home-check.js`

Expected: PASS with `D40 guest calendar home checks passed`。

- [x] **Step 5: 检查窄范围差异**

Run: `git diff -- scripts/d40-guest-calendar-home-check.js apps/miniprogram/src/components/SessionCalendar.vue`

Expected: 只新增布局契约、条件 class 和单列 CSS；设置节点继续由 `v-if="showAdminButton"` 控制。

### Task 3: 回归验证

**Files:**
- Verify: `scripts/d40-guest-calendar-home-check.js`
- Verify: `scripts/d41-calendar-action-icons-check.js`
- Verify: `apps/miniprogram/src/pages/index/index.vue`
- Verify: `apps/miniprogram/src/components/SessionCalendar.vue`

- [x] **Step 1: 运行相邻聚焦检查**

Run: `node scripts/d40-guest-calendar-home-check.js`

Expected: PASS。

Run: `node scripts/d41-calendar-action-icons-check.js`

Expected: PASS with `calendar action icon checks passed`。

Run: `node scripts/check-miniprogram.js`

Expected: PASS with `UniApp miniprogram check passed`。

- [x] **Step 2: 运行完整静态回归**

Run: `npm run check`

Expected: exit 0，包含 D40、D41 及既有回归全部通过。

- [x] **Step 3: 构建微信小程序生产包**

Run: `npm -C apps/miniprogram run build:mp-weixin`

Expected: exit 0 with `DONE Build complete`。

- [x] **Step 4: 检查格式和最终差异**

Run: `git diff --check -- scripts/d40-guest-calendar-home-check.js apps/miniprogram/src/pages/index/index.vue apps/miniprogram/src/components/SessionCalendar.vue`

Expected: exit 0，无空白错误。

Run: `git diff -- scripts/d40-guest-calendar-home-check.js apps/miniprogram/src/pages/index/index.vue apps/miniprogram/src/components/SessionCalendar.vue`

Expected: 可见性、单列布局及测试三处改动与设计一致，没有范围外重构。
