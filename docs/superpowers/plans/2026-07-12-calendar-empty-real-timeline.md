# Calendar Empty Real Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separately drawn guest empty-state axis with the calendar's real day-band timeline and remove the redundant empty-state date action.

**Architecture:** Keep the change inside `SessionCalendar.vue`. Render one empty current-day band using the existing `day-band`, `timeline-rail`, `day-marker`, and `day-card` primitives; retain only the refresh action and existing water-ink background.

**Tech Stack:** Vue 3 `<script setup>`, UniApp, WeChat Mini Program, Node static contract checks.

---

### Task 1: Lock the corrected empty-state contract

**Files:**
- Modify: `scripts/d40-guest-calendar-home-check.js`

- [ ] Replace the old assertions with checks requiring `calendar-empty-day-band`, `timeline-rail`, `day-marker`, and `day-card` in the empty-state block.
- [ ] Assert that `calendar-empty-route-axis`, `emptyDateTicks`, and `选择其他日期` are absent.
- [ ] Run `node scripts/d40-guest-calendar-home-check.js` and confirm it fails on the current separate-axis implementation.

### Task 2: Reuse the real day-band timeline

**Files:**
- Modify: `apps/miniprogram/src/components/SessionCalendar.vue`

- [ ] Replace the custom route-axis template with one current-day `day-band` using the existing timeline and card classes.
- [ ] Remove `emptyDateTicks` and all custom axis/date-action styles.
- [ ] Keep the title, body, refresh action, water-ink background, and hidden empty load-more behavior.
- [ ] Run the D40 contract and `node scripts/check-miniprogram.js`; confirm both pass.

### Task 3: Build and verify in WeChat DevTools

**Files:**
- Verify: `apps/miniprogram/dist/dev/mp-weixin`

- [ ] Run `npm run build:mp-weixin` and confirm exit 0.
- [ ] Let the active `dev:mp-weixin` watcher update `dist/dev/mp-weixin`.
- [ ] Compile the current project in WeChat DevTools.
- [ ] Confirm visually that the empty state uses the real green “今” marker and card timeline, with no “选择其他日期”.
- [ ] Commit the implementation to `develop`.
