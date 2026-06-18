# Profile Nickname Avatar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can edit nickname and change avatar from the Mini Program profile surface, with changes persisted in `users.nickname` and `users.avatar_url`.

**Architecture:** Extend the existing profile flow instead of adding a parallel page. The API exposes a general profile patch endpoint plus a small authenticated avatar upload/static-file path; the Mini Program keeps all local auth cache updates inside shared API helpers. A focused static regression check tracks the agreed behavior because this repo already uses static check scripts for Mini Program and cross-flow coverage.

**Tech Stack:** Node.js native `http`, `fs`, `path`, `crypto`; MySQL via existing `mysql2`; UniApp/Vue Mini Program; existing shell-free Node check scripts.

---

## Source Of Truth

- Design: `docs/superpowers/specs/2026-06-17-profile-nickname-avatar-design.md`
- Progress board: this file

## Scope Checklist

- [x] Backend profile patch accepts `nickname`, `avatarUrl`, and `gender` without breaking gender-only updates.
- [x] Backend avatar upload accepts authenticated JPEG/PNG multipart uploads, stores files under `apps/api/uploads/avatars`, and serves `/uploads/avatars/:filename` safely.
- [x] Mini Program API helpers expose `assetUrl`, `uploadUserAvatar`, and `updateUserProfile`; `updateUserGender` delegates to profile update.
- [x] `AuthIdentityBar.vue` displays nickname/avatar, supports `chooseAvatar`, previews temporary avatar, and saves profile data.
- [x] `mine/index.vue` shows personal info and opens the same profile editor.
- [x] A profile regression check and existing verification commands pass.

## Task 1: Add Failing Profile Regression Check

**Files:**
- Create: `scripts/d14-profile-check.js`
- Modify: `package.json`

- Progress: started 2026-06-17; writing the regression check first.

- [x] **Step 1: Create static check script**

Add a Node script that asserts the backend, frontend helpers, identity bar, and Mine page contain the agreed profile-editing hooks:

```js
const rootPackage = JSON.parse(read("package.json"));
assert(rootPackage.scripts.check.includes("scripts/d14-profile-check.js"), "root check should run d14 profile check");
assert(usersModule.includes("updateUserProfile"), "users module must expose updateUserProfile");
assert(server.includes('/api/users/me/avatar'), "server must route avatar upload");
assert(server.includes('/uploads/avatars/'), "server must serve uploaded avatars");
assert(api.includes("uploadUserAvatar"), "miniprogram API must upload avatars");
assert(api.includes("updateUserProfile"), "miniprogram API must update profile");
assert(identityBar.includes('open-type="chooseAvatar"'), "profile modal must use chooseAvatar");
assert(mine.includes("个人信息") && mine.includes("openProfileEditor"), "mine page must expose profile editor");
```

- [x] **Step 2: Run red check**

Run: `node scripts/d14-profile-check.js`

Expected: FAIL because `scripts/d14-profile-check.js` is not wired into `package.json`, and implementation hooks do not exist yet.

Actual: FAIL with `root check should run d14 profile check`.

- [x] **Step 3: Wire root check after red is observed**

Add `&& node scripts/d14-profile-check.js` to the root `check` script near the other static checks.

- [x] **Step 4: Keep task unchecked until implementation makes the check pass**

Do not mark Task 1 complete until the check passes after implementation.

Actual: `node scripts/d14-profile-check.js` passed after backend and Mini Program implementation.

## Task 2: Backend Profile Patch And Avatar Upload

**Files:**
- Modify: `apps/api/src/modules/auth/users.js`
- Modify: `apps/api/src/server.js`

- [x] **Step 1: Add profile normalization in `users.js`**

Implement helpers for `nickname`, `avatarUrl`, and `gender`. Empty nickname/avatar values become `null`; nickname max is 32 characters; avatar paths must be empty or start with `/uploads/avatars/`.

- [x] **Step 2: Replace gender-only updater with `updateUserProfile()`**

Keep `updateUserGender()` as a compatibility wrapper around `updateUserProfile(userId, { gender })`.

- [x] **Step 3: Route `PATCH /api/users/me` to profile patch**

Return `{ user: updatedUser, roles: user.roles }` exactly as existing clients expect.

- [x] **Step 4: Add multipart avatar parsing and static serving**

Handle `POST /api/users/me/avatar` before JSON body parsing tries to parse multipart. Store JPEG/PNG files under `apps/api/uploads/avatars`, generate random names, and serve only basename-safe files from `/uploads/avatars/:filename`.

- [x] **Step 5: Run focused checks**

Run: `npm --workspace apps/api run check`

Expected: PASS with API syntax/static check output.

Actual: PASS with `API syntax check passed: 12 files`.

## Task 3: Mini Program API Helpers

**Files:**
- Modify: `apps/miniprogram/src/utils/api.js`

- [x] **Step 1: Add `assetUrl(path)`**

Return empty for empty paths, full URLs unchanged, `/uploads/...` joined to `getApiBaseUrl()`, and `/static/...` unchanged.

- [x] **Step 2: Add `uploadUserAvatar(filePath)`**

Use `uni.uploadFile` with `Authorization: Bearer <token>`, field name `avatar`, and parse the JSON response for `data.avatarUrl`.

- [x] **Step 3: Add `updateUserProfile(patch)`**

Call `PATCH /api/users/me`, update auth cache through `setAuth()`, and return the next auth object.

- [x] **Step 4: Delegate `updateUserGender()`**

Make `updateUserGender(gender)` return `updateUserProfile({ gender })`.

## Task 4: Profile Modal And Mine Page UI

**Files:**
- Modify: `apps/miniprogram/src/components/AuthIdentityBar.vue`
- Modify: `apps/miniprogram/src/pages/mine/index.vue`

- [x] **Step 1: Extend profile modal state**

Track `draftNickname`, `draftAvatarUrl`, and `draftAvatarTempPath`; reset them whenever identity refreshes or the modal opens.

- [x] **Step 2: Add nickname and avatar controls**

Use a compact input and a `button open-type="chooseAvatar"` next to the avatar preview. The modal remains the single profile editor for both top identity bar and Mine page.

- [x] **Step 3: Save avatar before profile patch**

If a temporary avatar path exists, upload it first. Then save `{ nickname, avatarUrl, gender }` through `updateUserProfile()`.

- [x] **Step 4: Show profile card on Mine page**

Display avatar, nickname fallback, gender, and an edit button that emits `AUTH_PROFILE_REQUEST_EVENT` in optional mode for the current route.

- [x] **Step 5: Keep UI restrained**

Use existing spacing, borders, and colors. Avoid adding a second modal, a landing-style section, or decorative elements.

## Task 5: Verification And Task Board Update

**Files:**
- Modify: `docs/superpowers/plans/2026-06-17-profile-nickname-avatar.md`

- [x] **Step 1: Run focused profile check**

Run: `node scripts/d14-profile-check.js`

Expected: PASS.

Actual: PASS with `D14 profile check passed`.

- [x] **Step 2: Run API check**

Run: `npm --workspace apps/api run check`

Expected: PASS.

Actual: PASS with `API syntax check passed: 12 files`.

- [x] **Step 3: Run Mini Program static check**

Run: `node scripts/check-miniprogram.js`

Expected: PASS.

Actual: PASS with `UniApp miniprogram check passed: 10 pages`.

- [x] **Step 4: Run root check when feasible**

Run: `npm run check`

Expected: PASS, unless a pre-existing environment dependency such as local API health is unavailable. If it cannot pass for environmental reasons, record the exact failing command and scoped checks that did pass.

Actual: PASS. Output included `API health check passed`, `D11 gender check passed: 34 checks`, `D14 profile check passed`, and `D10 pseudo chat check passed`.

Additional narrow implementation note: `.gitignore` now excludes `apps/api/uploads/` so runtime avatar files are not accidentally committed.

Follow-up runtime fix: `AuthIdentityBar.vue` now locks the `chooseAvatar` button after tap and releases it on `chooseavatar` callback or short timeout, preventing WeChat DevTools from raising `chooseAvatar:fail another chooseAvatar is in progress` on repeated taps.

- [x] **Step 5: Mark tasks accurately**

Mark completed checklist items only after the corresponding verification evidence exists.
