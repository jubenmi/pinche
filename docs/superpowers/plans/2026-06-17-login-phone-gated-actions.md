# Login Phone Gated Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Chinese design so phone authorization is optional after login but mandatory before publishing a ride or claiming a seat.

**Architecture:** Keep login orchestration centralized in `apps/miniprogram/src/utils/api.js`, reuse `AuthIdentityBar.vue` as the visible authorization surface, and enforce ride-action phone requirements in backend service functions. Use source checks for mini program guard placement and smoke checks for backend API behavior.

**Tech Stack:** UniApp/Vue 3 mini program, Node.js HTTP API, MySQL-backed smoke scripts, existing repository check scripts.

---

## Source Of Truth

- Design spec: `docs/superpowers/specs/2026-06-17-login-phone-gated-actions-design.md`
- Required behavior:
  - Login may show a skippable phone prompt after fresh login.
  - Browsing and non-ride actions must not require phone authorization.
  - Publishing a ride and claiming a role must require `phoneVerifiedAt`.
  - Phone authorization must use `button open-type="getPhoneNumber"`.
  - Backend must reject direct ride-action API calls when phone is missing.

## File Map

- Modify: `scripts/check-miniprogram.js`
  - Add source checks for phone authorization helpers, `AuthIdentityBar` phone modal, and `requirePhone: true` ordering.
- Modify: `scripts/d2-smoke-test.js`
  - Add smoke checks that ride actions reject missing phone and succeed after phone authorization.
- Modify: `apps/api/src/http/errors.js`
  - Add a typed `phoneRequired()` error helper.
- Modify: `apps/api/src/modules/auth/users.js`
  - Return `{ user, roles }` compatible phone updates and preserve `phoneVerifiedAt`.
- Modify: `apps/api/src/server.js`
  - Accept phone authorization `code` and return updated auth-shaped data.
- Modify: `apps/api/src/modules/core/service.js`
  - Enforce phone verification in `createSession()` and `claimSessionSeat()`.
- Modify: `apps/miniprogram/src/utils/api.js`
  - Add phone auth events, update helper, optional prompt, and required phone guard.
- Modify: `apps/miniprogram/src/components/AuthIdentityBar.vue`
  - Add optional/required phone authorization modal using `open-type="getPhoneNumber"`.
- Modify: `apps/miniprogram/src/pages/session/setup.vue`
  - Require phone before publishing.
- Modify: `apps/miniprogram/src/pages/session/share.vue`
  - Require phone before final claim.

## Task 1: Add Failing Checks

Progress: RED checks completed; current implementation lacks phone gates.

- [x] **Step 1: Add mini program source checks**

Add checks to `scripts/check-miniprogram.js` requiring these exact source signals:

```js
const apiSource = fs.readFileSync(path.join(srcRoot, "utils/api.js"), "utf8");
for (const requiredPhoneAuthText of [
  "AUTH_PHONE_REQUEST_EVENT",
  "AUTH_PHONE_RESPONSE_EVENT",
  "updateUserPhoneFromWechatPhoneCode",
  "ensureUserPhone",
  "requirePhone === true",
  "/api/auth/wechat/phone"
]) {
  if (!apiSource.includes(requiredPhoneAuthText)) {
    fail(`Shared phone authorization support is missing ${requiredPhoneAuthText}`);
  }
}
```

Also require:

```js
for (const requiredPhoneModalText of [
  "phoneVisible",
  "handlePhoneRequest",
  "open-type=\"getPhoneNumber\"",
  "getphonenumber",
  "创建车或上车前需要授权手机号"
]) {
  if (!identityBarSource.includes(requiredPhoneModalText)) {
    fail(`Auth identity bar phone authorization is missing ${requiredPhoneModalText}`);
  }
}
```

And ordering checks:

```js
if (!createPublishedSessionSource.includes("requirePhone: true")) {
  fail("Setup publish button must require phone before publishing");
}
assertBefore(
  createPublishedSessionSource,
  "requirePhone: true",
  "this.busyAction = true",
  "Setup publish button must require phone before marking busy"
);
assertBefore(
  createPublishedSessionSource,
  "requirePhone: true",
  "request",
  "Setup publish button must require phone before publishing requests"
);
if (!shareConfirmRoleSource.includes("requirePhone: true")) {
  fail("Share confirm button must require phone before claiming a role");
}
assertBefore(
  shareConfirmRoleSource,
  "requirePhone: true",
  "claimSeat",
  "Share confirm button must require phone before claiming a role"
);
```

- [x] **Step 2: Run mini program check and verify RED**

Run: `node scripts/check-miniprogram.js`

Expected: FAIL with missing phone authorization support, because implementation has not been added yet.

- [x] **Step 3: Add backend smoke expectations**

Update `scripts/d2-smoke-test.js` so it:

1. Logs in owner and player.
2. Verifies `POST /api/sessions` rejects owner before phone authorization with status `403`.
3. Calls `POST /api/auth/wechat/phone` for owner.
4. Creates the session successfully.
5. Publishes a seat.
6. Verifies `POST /api/session-seats/:id/claim` rejects player before phone authorization with status `403`.
7. Calls `POST /api/auth/wechat/phone` for player.
8. Verifies claiming succeeds.

Use request bodies:

```js
await request(
  "POST",
  "/api/auth/wechat/phone",
  { code: `phone-owner-${suffix}` },
  owner.token
);
```

and:

```js
await request(
  "POST",
  "/api/auth/wechat/phone",
  { code: `phone-player-${suffix}` },
  player.token
);
```

- [x] **Step 4: Run backend smoke and verify RED**

Run against a running local API: `node scripts/d2-smoke-test.js`

Expected: FAIL while `POST /api/sessions` unexpectedly succeeds before phone authorization, proving the missing backend guard.

## Task 2: Implement Backend Phone Gate

- [x] **Step 1: Add phone-required error helper**

In `apps/api/src/http/errors.js`, add:

```js
export function phoneRequired(message = "创建车或上车前需要授权手机号") {
  return new AppError(403, "PHONE_REQUIRED", message);
}
```

- [x] **Step 2: Update phone endpoint response shape**

In `apps/api/src/server.js`, change `/api/auth/wechat/phone` to accept `body.code || body.phoneCode || body.phoneEncrypted || body.phone`, require it, call `updateUserPhone()`, and return:

```js
jsonResponse(response, 200, {
  ok: true,
  data: {
    user: updated,
    roles: user.roles
  }
});
```

- [x] **Step 3: Add backend guard**

In `apps/api/src/modules/core/service.js`, import `phoneRequired` and add:

```js
function requireVerifiedPhone(user) {
  if (!user?.user?.phoneVerifiedAt) {
    throw phoneRequired();
  }
}
```

Call it at the top of `createSession(user, body)` before `ensureRole()`, and at the top of `claimSessionSeat(user, seatId, body)` before locking or mutating seats.

- [x] **Step 4: Run syntax check**

Run: `npm --workspace apps/api run check`

Expected: PASS.

- [x] **Step 5: Run backend smoke and verify GREEN**

Run against a running local API: `node scripts/d2-smoke-test.js`

Expected: PASS, including phone-required rejection before authorization and success after authorization.

## Task 3: Implement Frontend Phone Prompt And Required Guards

- [x] **Step 1: Add phone events and helper flow**

In `apps/miniprogram/src/utils/api.js`, add:

```js
export const AUTH_PHONE_REQUEST_EVENT = "pinche-auth-phone-request";
export const AUTH_PHONE_ACK_EVENT = "pinche-auth-phone-ack";
export const AUTH_PHONE_RESPONSE_EVENT = "pinche-auth-phone-response";
```

Add `updateUserPhoneFromWechatPhoneCode(code)`, `requestUserPhoneFromPhoneModal(auth, options)`, and `ensureUserPhone(auth, options)` following the same event pattern as `requestUserGenderFromProfileModal()`.

- [x] **Step 2: Wire `ensureLoggedIn()` to phone checks**

In `ensureLoggedIn()`:

- For cached auth, call `ensureUserPhone()` before `ensureUserGender()`.
- For fresh login, call `ensureUserPhone({ ... }, { ...options, promptPhoneAfterLogin: true })` before `ensureUserGender()`.
- If required phone returns `null`, stop and return `null`.
- If optional phone is skipped, keep the logged-in auth and continue.

- [x] **Step 3: Add phone modal to `AuthIdentityBar.vue`**

Add state:

```js
phoneVisible: false,
phoneRequired: false,
phoneRequestId: "",
savingPhone: false
```

Listen for `AUTH_PHONE_REQUEST_EVENT`, acknowledge with `AUTH_PHONE_ACK_EVENT`, and render a modal with:

```vue
<button
  class="phone-authorize"
  open-type="getPhoneNumber"
  @getphonenumber="handlePhoneNumber"
>
  授权手机号
</button>
```

Optional mode includes a skip/cancel button. Required mode returns `null` on reject/close.

- [x] **Step 4: Require phone before publishing**

In `apps/miniprogram/src/pages/session/setup.vue`, update the publish login call:

```js
const auth = await ensureLoggedIn({
  content: "登录后发布并分享你的剧本局。",
  requirePhone: true,
  phoneRequiredTitle: "授权手机号后发布",
  phoneRequiredContent: "创建车前需要授权手机号，方便车局沟通和审核。"
});
```

- [x] **Step 5: Require phone before final claim**

In `apps/miniprogram/src/pages/session/share.vue`, update `confirmRole()` to call:

```js
const auth = await this.ensureSeatSelectionLogin({ requirePhone: true });
```

and let `ensureSeatSelectionLogin(options = {})` pass options through to `ensureLoggedIn()`.

- [x] **Step 6: Run mini program source check and verify GREEN**

Run: `node scripts/check-miniprogram.js`

Expected: PASS.

## Task 4: Final Verification

- [x] **Step 1: Run JavaScript syntax checks**

Run: `npm --workspace apps/api run check && node --check scripts/d2-smoke-test.js && node --check scripts/check-miniprogram.js`

Expected: PASS.

- [x] **Step 2: Run repository check subset**

Run: `node scripts/check-miniprogram.js && npm --workspace apps/api run check`

Expected: PASS.

- [x] **Step 3: Review spec coverage**

Confirm these design items are implemented:

- Login can continue without phone.
- Fresh login can show optional phone prompt.
- Publish and claim require phone.
- Phone authorization uses `open-type="getPhoneNumber"`.
- Backend rejects missing-phone ride actions.
- Public data does not expose phone numbers.

- [ ] **Step 4: Commit implementation**

Skipped in this session because several touched frontend files already contained unrelated uncommitted changes before this implementation. Leaving the implementation in the working tree avoids bundling unrelated edits into a commit.

Stage only files changed for this feature and commit:

```bash
git add docs/superpowers/plans/2026-06-17-login-phone-gated-actions.md scripts/check-miniprogram.js scripts/d2-smoke-test.js apps/api/src/http/errors.js apps/api/src/modules/auth/users.js apps/api/src/server.js apps/api/src/modules/core/service.js apps/miniprogram/src/utils/api.js apps/miniprogram/src/components/AuthIdentityBar.vue apps/miniprogram/src/pages/session/setup.vue apps/miniprogram/src/pages/session/share.vue
git commit -m "feat: gate ride actions on phone authorization"
```
