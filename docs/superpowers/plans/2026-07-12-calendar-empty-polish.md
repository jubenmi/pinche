# Calendar Empty Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the selected empty-state visual with accurate copy, the real timeline, borderless editorial spacing, and a verified WeChat Mini Program release.

**Architecture:** Keep behavior in `SessionCalendar.vue` unchanged and adjust only the empty-state markup/styles and D40 static contract. Reuse the existing timeline classes, return icon, and ink landscape asset.

**Tech Stack:** Vue 3, UniApp, WeChat Mini Program, Node contract checks, GitHub Actions.

---

### Task 1: Lock the selected copy and layout contract

**Files:**
- Modify: `scripts/d40-guest-calendar-home-check.js`

- [ ] Require `暂无公开车局`, `新的公开车局发布后，会显示在这里`, and the real timeline class names.
- [ ] Reject `今天还没有公开车局`, the old supporting copy, and visible empty-card border declarations.
- [ ] Run `node scripts/d40-guest-calendar-home-check.js`; expect failure on the old copy.

### Task 2: Implement the selected visual

**Files:**
- Modify: `apps/miniprogram/src/components/SessionCalendar.vue`

- [ ] Replace the guest copy with the selected exact strings.
- [ ] Keep `day-band`, `timeline-rail`, and `day-marker`; remove the visible empty-state card surface while preserving its structural container.
- [ ] Widen and rebalance the content so the supporting sentence stays on one line at the target viewport.
- [ ] Keep the existing refresh action and ink landscape asset.
- [ ] Run D40 and mini-program checks; expect both to pass.

### Task 3: Visual QA and release

**Files:**
- Create: `design-qa.md`
- Modify: `specs/d40-guest-calendar-home/tasks.md`

- [ ] Build and run `dist/dev/mp-weixin` in WeChat DevTools.
- [ ] Capture the same guest empty state and compare it with `docs/superpowers/specs/assets/2026-07-12-calendar-empty-polish-selected.png`.
- [ ] Fix P0/P1/P2 differences and record `final result: passed`.
- [ ] Run the full local check and production build.
- [ ] Commit and merge to `develop`, then push and verify develop, main, and publish CI in order.
