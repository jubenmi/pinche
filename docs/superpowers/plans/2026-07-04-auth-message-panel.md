# 顶部消息面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在微信小程序顶部个人信息栏展示车头待审核申请消息，并允许展开后跳转处理。

**Architecture:** 新增纯函数 `authMessages.js` 汇总 `/api/users/me/sessions` 的 `pending_signup_count`。`AuthIdentityBar.vue` 负责拉取消息、显示徽标、展开面板、刷新和导航到车头管理页。验证脚本覆盖 helper 行为和组件关键钩子。

**Tech Stack:** uni-app Vue SFC, existing `request`/`dataOf` API helper, Node static verification scripts.

---

### Task 1: 消息汇总 Helper

**Files:**
- Create: `apps/miniprogram/src/utils/authMessages.js`
- Create: `scripts/d25-auth-message-panel-check.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `scripts/d25-auth-message-panel-check.js` that imports `buildOrganizerSignupMessages` and `totalOrganizerSignupMessageCount`, then asserts only sessions with `pending_signup_count > 0` become messages.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/d25-auth-message-panel-check.js`

Expected: fails because `apps/miniprogram/src/utils/authMessages.js` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `apps/miniprogram/src/utils/authMessages.js` with:

```js
export function buildOrganizerSignupMessages(sessions = []) {
  return (sessions || [])
    .map((session) => {
      const count = Number(session?.pending_signup_count || 0);
      if (!count || count < 1 || !session?.id) {
        return null;
      }
      return {
        key: `organizer-signups-${session.id}`,
        sessionId: session.id,
        count,
        badgeText: count > 99 ? "99+" : String(count),
        title: session.script_name_snapshot || "未命名车局",
        subtitle: [session.store_name_snapshot || "店家待定", session.start_at || "时间待定"].join(" / "),
        actionText: "去审核"
      };
    })
    .filter(Boolean);
}

export function totalOrganizerSignupMessageCount(messages = []) {
  return (messages || []).reduce((total, message) => total + Number(message?.count || 0), 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/d25-auth-message-panel-check.js`

Expected: PASS.

### Task 2: 顶部栏消息面板

**Files:**
- Modify: `apps/miniprogram/src/components/AuthIdentityBar.vue`
- Test: `scripts/d25-auth-message-panel-check.js`

- [ ] **Step 1: Extend the failing test**

Add assertions that `AuthIdentityBar.vue` contains `auth-message-chip`, `messagePanelVisible`, `refreshOrganizerMessages`, `待处理申请`, and `/pages/session/manage?id=`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/d25-auth-message-panel-check.js`

Expected: fails until the SFC includes the panel.

- [ ] **Step 3: Implement the minimal SFC changes**

Import `dataOf`, `request`, `buildOrganizerSignupMessages`, and `totalOrganizerSignupMessageCount`; add component state for messages; fetch `/api/users/me/sessions?limit=50`; render a badge and dropdown panel; navigate to `/pages/session/manage?id=<session_id>` on item tap.

- [ ] **Step 4: Run checks**

Run:

```bash
node scripts/d25-auth-message-panel-check.js
node scripts/check-miniprogram.js
```

Expected: both pass.
