# Player Role Gender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist player gender, persist role-seat gender, allow any player to choose any role, and show “反串” on the final role selection page when player gender differs from role gender.

**Architecture:** Store player gender on `users` and role gender on `session_seats`. Keep gender normalization in backend service helpers and frontend display/cross-cast helpers in `createFlow.js`. Use the existing share page as the final role-selection surface.

**Tech Stack:** Node.js API, MySQL migrations, UniApp/Vue miniprogram, static Node check scripts.

---

## File Structure

- Modify `apps/api/migrations/0006_player_role_gender.sql`: add persisted gender columns.
- Modify `apps/api/src/modules/auth/users.js`: expose and update player gender.
- Modify `apps/api/src/server.js`: add `PATCH /api/users/me`.
- Modify `apps/api/src/modules/core/service.js`: validate and persist `roleGender` on seats.
- Modify `apps/miniprogram/src/utils/api.js`: require first-login gender selection and update auth cache.
- Modify `apps/miniprogram/src/utils/createFlow.js`: preserve `roleGender`, expose symbols, and calculate cross-cast.
- Modify `apps/miniprogram/src/pages/session/role.vue`: show role gender symbols while selecting.
- Modify `apps/miniprogram/src/pages/session/setup.vue`: include `roleGender` when creating seats.
- Modify `apps/miniprogram/src/pages/session/share.vue`: show symbols and “反串” on final selection.
- Modify `apps/miniprogram/src/pages/session/share.vue`: confirm cross-cast selection before committing or claiming.
- Modify `apps/miniprogram/src/pages/session/role.vue`: confirm cross-cast selection before saving the creator's selected role.
- Modify `apps/miniprogram/src/pages/mine/index.vue`: show and update player gender.
- Modify `apps/miniprogram/src/components/AuthIdentityBar.vue`: open the profile modal from the identity bar, save gender, and show gendered default avatars.
- Modify `apps/miniprogram/src/utils/api.js`: request the identity-bar profile modal when login requires a missing gender.
- Create `scripts/d11-gender-check.js`: static regression check.
- Modify `package.json`: include D11 check in `npm run check`.
- Update `specs/d11-player-role-gender/tasks.md`: track task progress.

### Task 1: Static Check

**Files:**
- Create: `scripts/d11-gender-check.js`
- Modify: `package.json`
- Modify: `specs/d11-player-role-gender/tasks.md`

- [ ] **Step 1: Write the failing static check**

```js
const requiredChecks = [
  ["migration adds users.gender", "apps/api/migrations/0006_player_role_gender.sql", "ADD COLUMN gender"],
  ["migration adds session_seats.role_gender", "apps/api/migrations/0006_player_role_gender.sql", "ADD COLUMN role_gender"],
  ["auth exposes gender", "apps/api/src/modules/auth/users.js", "gender: row.gender"],
  ["user gender update exists", "apps/api/src/modules/auth/users.js", "updateUserGender"],
  ["profile patch route exists", "apps/api/src/server.js", "PATCH\" && url.pathname === \"/api/users/me"],
  ["first login gender prompt exists", "apps/miniprogram/src/utils/api.js", "ensureUserGender"],
  ["role gender is compacted", "apps/miniprogram/src/utils/createFlow.js", "roleGender"],
  ["cross cast helper exists", "apps/miniprogram/src/utils/createFlow.js", "isCrossCast"],
  ["role page shows symbols", "apps/miniprogram/src/pages/session/role.vue", "roleGenderSymbol"],
  ["setup sends roleGender", "apps/miniprogram/src/pages/session/setup.vue", "roleGender"],
  ["share page shows reverse cast", "apps/miniprogram/src/pages/session/share.vue", "反串"],
  ["mine page updates gender", "apps/miniprogram/src/pages/mine/index.vue", "我的性别"]
];
```

- [ ] **Step 2: Run the check and verify it fails**

Run: `node scripts/d11-gender-check.js`

Expected: FAIL because `apps/api/migrations/0006_player_role_gender.sql` and the required code do not exist yet.

- [ ] **Step 3: Add the check to `npm run check`**

Add `node scripts/d11-gender-check.js` after `node scripts/check-miniprogram.js`.

### Task 2: Backend Persistence And API

**Files:**
- Create: `apps/api/migrations/0006_player_role_gender.sql`
- Modify: `apps/api/src/modules/auth/users.js`
- Modify: `apps/api/src/server.js`
- Modify: `apps/api/src/modules/core/service.js`

- [ ] **Step 1: Add migration**

```sql
ALTER TABLE users ADD COLUMN gender VARCHAR(16) NULL AFTER avatar_url;
ALTER TABLE session_seats ADD COLUMN role_gender VARCHAR(16) NOT NULL DEFAULT 'unlimited' AFTER role_name;
```

Use information-schema guarded statements so repeated migration execution is safe.

- [ ] **Step 2: Expose and update user gender**

`publicUser(row)` includes `gender: row.gender || ""`. Add `updateUserGender(userId, gender)` with allowed values `male` and `female`.

- [ ] **Step 3: Add `PATCH /api/users/me`**

The route requires auth, calls `updateUserGender`, and returns `{ user: updated, roles: user.roles }`.

- [ ] **Step 4: Persist role gender on seats**

Add `normalizeRoleGender(value)` accepting `male`, `female`, and `unlimited`. Use it in `createSeat` and `updateSeat`.

- [ ] **Step 5: Verify API syntax**

Run: `npm --workspace apps/api run check`

Expected: syntax check passes.

### Task 3: Frontend Gender And Cross-Cast

**Files:**
- Modify: `apps/miniprogram/src/utils/api.js`
- Modify: `apps/miniprogram/src/utils/createFlow.js`
- Modify: `apps/miniprogram/src/pages/session/role.vue`
- Modify: `apps/miniprogram/src/pages/session/setup.vue`
- Modify: `apps/miniprogram/src/pages/session/share.vue`
- Modify: `apps/miniprogram/src/pages/mine/index.vue`

- [ ] **Step 1: Require first-login gender**

Add `ensureUserGender(auth)` to show an action sheet with `男` and `女`, save through `PATCH /api/users/me`, and update local auth.

- [ ] **Step 2: Add frontend gender helpers**

Add `normalizeRoleGender`, `roleGenderSymbol`, and `isCrossCast` to `createFlow.js`. Keep missing `roleGender` as `unlimited`.

- [ ] **Step 3: Show role gender symbols**

Role cards in `role.vue` and `share.vue` display `roleGenderSymbol(role.roleGender)` beside role name. Empty symbols render nothing.

- [ ] **Step 4: Send role gender during session creation**

`setup.vue` includes `roleGender: role.roleGender || "unlimited"` in `seatPayload`.

- [ ] **Step 5: Show “反串” on final selection**

`share.vue` computes `isCrossCast(currentUserGender, role.roleGender)` for the current player's selected or pending role and displays `（反串）`.

- [ ] **Step 6: Add Mine gender editor**

`mine/index.vue` displays “我的性别” and saves male/female changes with `PATCH /api/users/me`.

- [ ] **Step 7: Confirm cross-cast before selecting**

`role.vue` and `share.vue` show a modal with `反串可能会影响游戏体验，是否确认` before committing a cross-cast selection. Confirm continues; cancel leaves the existing selected role unchanged.

- [x] **Step 8: Move missing-gender prompt into the profile modal**

`api.js` emits `AUTH_PROFILE_REQUEST_EVENT` from `ensureUserGender` and waits for `AUTH_PROFILE_RESPONSE_EVENT`. `AuthIdentityBar.vue` acknowledges the request, opens a required profile modal, saves gender through `PATCH /api/users/me`, and emits the updated auth. Clicking the identity bar opens the same modal in editable mode with gendered default avatars.

### Task 4: Verification

**Files:**
- Modify: `specs/d11-player-role-gender/tasks.md`

- [ ] **Step 1: Run D11 check**

Run: `node scripts/d11-gender-check.js`

Expected: all D11 static checks pass.

- [ ] **Step 2: Run miniprogram static check**

Run: `node scripts/check-miniprogram.js`

Expected: UniApp miniprogram check passes.

- [ ] **Step 3: Run full check**

Run: `npm run check`

Expected: full repository check passes.

- [ ] **Step 4: Update task file**

Mark D11 tasks complete only after the corresponding code and verification step have passed.
