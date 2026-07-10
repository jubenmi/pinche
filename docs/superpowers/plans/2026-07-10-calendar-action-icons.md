# Calendar Action Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ambiguous calendar action artwork and the “归位/日期” labels with clear, consistently aligned setting, curved-return-arrow, and calendar icons.

**Architecture:** Keep the existing `SessionCalendar` events and layout intact. Use local SVG assets through `t-image`, and render both compact calendar tools with the same `t-button` primitive so their internal flex alignment is identical. A focused static contract check locks the return-arrow semantics, shared primitive, accessibility labels, and local assets.

**Tech Stack:** Vue 3 `<script setup>`, uni-app, WeChat Mini Program, SVG, Node.js static checks

---

### Task 1: Add the failing icon contract check

**Files:**
- Create: `scripts/d41-calendar-action-icons-check.js`
- Test: `scripts/d41-calendar-action-icons-check.js`

- [ ] **Step 1: Write the failing test**

Create a Node script that reads `SessionCalendar.vue` and the three expected SVG files. Assert that the component references `settings-light.svg`, `return-green.svg`, and `calendar-green.svg`; assert the labels `管理`, `归位到今天`, and `选择日期`; assert both compact tools use `t-button`; assert each SVG exists and contains an `<svg` root.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/d41-calendar-action-icons-check.js`

Expected: FAIL because `SessionCalendar.vue` still references `toolbox-light.svg` and the three new assets do not exist.

### Task 2: Add icons and wire them into the calendar

**Files:**
- Create: `apps/miniprogram/src/static/icons/settings-light.svg`
- Create: `apps/miniprogram/src/static/icons/return-green.svg`
- Delete: `apps/miniprogram/src/static/icons/target-green.svg`
- Create: `apps/miniprogram/src/static/icons/calendar-green.svg`
- Modify: `apps/miniprogram/src/components/SessionCalendar.vue:11-43`
- Modify: `apps/miniprogram/src/components/SessionCalendar.vue:1366-1370`
- Modify: `apps/miniprogram/src/components/SessionCalendar.vue:1429-1455`
- Test: `scripts/d41-calendar-action-icons-check.js`

- [ ] **Step 1: Create the minimal SVG assets**

Use matching `24 × 24` view boxes, `fill="none"`, round caps/joins, and `stroke-width="1.8"`. Use `#eaf8f1` for the settings icon and `#24745f` for the return-arrow and calendar icons. Keep both green icons inside the same optical bounds from 4 to 20.

- [ ] **Step 2: Replace the management artwork**

Change the existing management image source from `/static/icons/toolbox-light.svg` to `/static/icons/settings-light.svg`; preserve its event and `aria-label="管理"`.

- [ ] **Step 3: Replace the calendar tool labels**

Render `/static/icons/return-green.svg` inside the reset button with `aria-label="归位到今天"`. The icon uses a left-pointing sharp chevron flowing into a rounded return arc. Render `/static/icons/calendar-green.svg` inside a matching `t-button` with `aria-label="选择日期"`. Preserve `scrollToToday` and `openCalendarDatePicker` unchanged.

- [ ] **Step 4: Size the new tool images**

Keep the shared `.calendar-tool-icon` rule at `34rpx × 34rpx`. Both controls must be `t-button` components, eliminating the `view`/`t-button` baseline mismatch. Do not change grid widths, button heights, borders, or spacing.

- [ ] **Step 5: Run test to verify it passes**

Run: `node scripts/d41-calendar-action-icons-check.js`

Expected: PASS with `calendar action icon checks passed`.

### Task 3: Verify the mini program bundle

**Files:**
- Verify: `apps/miniprogram/src/components/SessionCalendar.vue`
- Verify: `apps/miniprogram/src/static/icons/*.svg`

- [ ] **Step 1: Check syntax and whitespace**

Run: `node --check scripts/d41-calendar-action-icons-check.js`

Expected: exit 0.

Run: `git diff --check -- apps/miniprogram/src/components/SessionCalendar.vue apps/miniprogram/src/static/icons/settings-light.svg apps/miniprogram/src/static/icons/return-green.svg apps/miniprogram/src/static/icons/calendar-green.svg scripts/d41-calendar-action-icons-check.js`

Expected: exit 0.

- [ ] **Step 2: Build the WeChat Mini Program**

Run: `npm run build:mp-weixin`

Expected: exit 0 and a completed uni-app build.

- [ ] **Step 3: Confirm generated assets**

Run: `rg -n "settings-light|return-green|calendar-green" apps/miniprogram/dist/build/mp-weixin`

Expected: all three icon asset names are referenced or copied into the generated bundle.
