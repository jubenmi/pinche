# Album Loading Lifecycle Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure current member-album requests always leave loading state and expose retry UI on failures under Vue 3 reactivity.

**Architecture:** Keep the existing album list request authority as the single source of request freshness. Remove the reactive raw-object owner latch, clear loading only when the local request remains current, and model failure explicitly with `albumLoadFailed`.

**Tech Stack:** Vue 3 Options API, uni-app, Node.js test runner, WeChat Developer Tools.

---

### Task 1: Add runtime lifecycle regressions

**Files:**
- Create: `apps/miniprogram/test/albumLoadingLifecycle.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write a test harness that extracts `loadAlbum()` and runs it with a Vue `reactive()` component context**

  Cover a current successful request and assert `loadingAlbum === false` after completion.

- [ ] **Step 2: Add a current failed-request test**

  Reject the album request and assert `albumLoadFailed === true`, `loadingAlbum === false`, and the failure status text is retained.

- [ ] **Step 3: Register the test in `d56:unit`**

  Run: `npm run d56:unit`

  Expected before implementation: both new lifecycle assertions fail for the current production code.

### Task 2: Fix member album request state

**Files:**
- Modify: `apps/miniprogram/src/pages/session/album.vue`

- [ ] **Step 1: Remove `albumLoadingOwner` from reactive state and invalidation**

  The request owner remains a local value guarded by the existing authority closure.

- [ ] **Step 2: Reset failure state when a current full load begins**

  Set `albumLoadFailed=false` together with `loadingAlbum=true`.

- [ ] **Step 3: Mark current request failures explicitly**

  After clearing the failed member projection, set `albumLoadFailed=true` before returning.

- [ ] **Step 4: Clear loading through request freshness**

  In `finally`, use `isCurrentRequest()` so a stale request cannot clear a newer request while a current request always terminates.

- [ ] **Step 5: Verify green**

  Run: `npm run d56:unit`

  Expected: all tests pass, including both Vue-reactive lifecycle regressions.

### Task 3: Verify and display locally

**Files:**
- Generated: `apps/miniprogram/dist/dev/mp-weixin/**`

- [ ] **Step 1: Run focused checks**

  Run: `node scripts/historical-session-backfill-check.js`

  Expected: exit 0.

- [ ] **Step 2: Build the mini program**

  Run: `npm run build:mp-weixin`

  Expected: exit 0 with a generated `dist/build/mp-weixin` bundle.

- [ ] **Step 3: Refresh the development bundle and WeChat Developer Tools**

  Run: `npm run devtools:refresh`

  Expected: the tool opens the rebrand worktree dev bundle with zero compile errors.

- [ ] **Step 4: Open a logged-in member album**

  Confirm the photo waterfall replaces the loading card and the console reports no new runtime error.

