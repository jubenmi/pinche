# City Preview Read-only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sessions opened from the city discovery tab fully read-only while preserving the existing share-card join flow.

**Architecture:** Add an `entry=city` navigation context from `SessionCalendar` to the existing detail page. The detail page uses one computed flag to hide actions and chat, suppress system sharing, prevent membership relinking, and guard seat/NPC events; the share page remains unchanged.

**Tech Stack:** UniApp, Vue 3 Options API and Composition API, TDesign Mini Program, Node.js static checks.

---

### Task 1: Add The Failing D39 Contract Check

**Files:**
- Create: `scripts/d39-city-preview-readonly-check.js`
- Modify: `package.json`
- Modify: `specs/d39-city-preview-readonly/tasks.md`

- [ ] Write assertions for `entry=city`, read-only copy, share-menu suppression, conditional actions/chat, event guards, relink guard, and unchanged share-page join requests.
- [ ] Add `node scripts/d39-city-preview-readonly-check.js` to the root `check` script.
- [ ] Run `node scripts/d39-city-preview-readonly-check.js` and verify it fails on the missing `entry=city` contract.
- [ ] Mark D39.2 complete only after the expected RED failure is recorded.

### Task 2: Propagate City Entry Context

**Files:**
- Modify: `apps/miniprogram/src/components/SessionCalendar.vue`
- Modify: `apps/miniprogram/src/pages/session/detail.vue`
- Modify: `specs/d39-city-preview-readonly/tasks.md`

- [ ] Change `goDetail(id)` to navigate to `/pages/session/detail?id=${id}&entry=city`.
- [ ] Add `entry` state and `isCityPreview` computed state to detail.
- [ ] Save `options.entry` before detail-page side effects in `onLoad`.
- [ ] Add the approved read-only notice.
- [ ] Call `uni.hideShareMenu({ menus: ["shareAppMessage", "shareTimeline"] })` for city preview.

### Task 3: Remove City Preview Actions

**Files:**
- Modify: `apps/miniprogram/src/pages/session/detail.vue`
- Modify: `specs/d39-city-preview-readonly/tasks.md`

- [ ] Render the top action group only when `!isCityPreview`.
- [ ] Hide review edit controls and chat extensions in city preview.
- [ ] Return empty action arrays for city-preview seat and NPC cards.
- [ ] Add city-preview early returns to seat tap and action handlers.
- [ ] Skip `relinkSessionMembership()` in city preview.
- [ ] Keep basic details, map access, role state, and reviews visible.

### Task 4: Verify And Record

**Files:**
- Modify: `specs/d39-city-preview-readonly/tasks.md`

- [ ] Run `node scripts/d39-city-preview-readonly-check.js`; expect pass.
- [ ] Run `node scripts/check-miniprogram.js`; expect pass.
- [ ] Run `npm run check`; expect pass.
- [ ] Run `npm run build:mp-weixin`; expect pass.
- [ ] Run `git diff --check`; expect pass.
- [ ] Inspect generated `SessionCalendar` and detail page output for `entry=city` and the read-only branch.
- [ ] Record automated outcomes and leave Developer Tools-only acceptance unchecked until it is actually exercised.
