# Miniprogram Production Login Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the production miniprogram bundle from crashing before login, add a repeatable real-login smoke test against the production build, and release the verified fix through the existing guarded branch flow.

**Architecture:** Route shared API feedback through a small safe gateway. The gateway prefers the existing TDesign host, falls back to the `uni` feedback API, and reports an unavailable method through callbacks instead of throwing. Keep the real-device concern outside unit tests: build the production bundle, open that exact bundle with WeChat DevTools automation, clear storage, complete a fresh `wx.login`, and assert the signed-in UI state.

**Tech Stack:** Vue 3, uni-app, WeChat miniprogram production build, Node.js test runner, WeChat `miniprogram-automator`, GitHub Actions.

---

### Task 1: Pin the production-bundle regression with failing checks

- [ ] Add `apps/miniprogram/test/safeFeedback.test.mjs` covering preferred feedback, `uni` fallback, and the no-provider callback path.
- [ ] Add `scripts/miniprogram-production-login-compatibility-check.js` to reject direct feedback imports and unsafe production output.
- [ ] Add focused package scripts without changing dependency or lock files.
- [ ] Run the focused checks and record the expected failure before implementation.

### Task 2: Implement the safe feedback gateway

- [ ] Add `apps/miniprogram/src/utils/safeFeedback.js` with stable wrappers for modal, toast, and action sheet calls.
- [ ] Change `apps/miniprogram/src/utils/api.js` to use namespace import plus the safe gateway.
- [ ] Run unit tests, production build, compatibility check, and D37 login policy check.
- [ ] Inspect the built `utils/api.js` and `utils/safeFeedback.js` contract for unsafe property access.

### Task 3: Add and run a real production-login smoke test

- [ ] Add `scripts/miniprogram-production-login-smoke.mjs` using a pinned, temporary `miniprogram-automator` install so repository dependencies remain unchanged.
- [ ] Launch `apps/miniprogram/dist/build/mp-weixin`, clear authentication storage, trigger the explicit home-page login action, confirm the modal, and wait for the authenticated home label.
- [ ] Fail on page exceptions or the prior `showModal` undefined signature and always close the automation session.
- [ ] Run the smoke against the production bundle and capture a passing result.

### Task 4: Verify and integrate

- [ ] Run `npm run check`, focused production-login checks, build, and real-login smoke from the feature worktree.
- [ ] Commit only the plan, tests, scripts, gateway, API integration, and package-script changes.
- [ ] Merge the feature branch into local `develop` without touching the user's unrelated dirty files.
- [ ] Re-run the release gate from `develop`.

### Task 5: Guarded CI release and experience upload

- [ ] Push `develop` and wait for its required GitHub Actions checks to pass.
- [ ] Promote the verified commit to `main`, push it, and wait for checks to pass.
- [ ] Promote the verified `main` commit to `publish`, push it, and wait for checks to pass.
- [ ] Build from the verified release commit, rerun the production real-login smoke, upload a new miniprogram version, and overwrite the current experience version.
- [ ] Record commit SHAs, CI run URLs/IDs, uploaded version, and final experience-version status; do not submit for formal review.
