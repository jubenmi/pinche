# Login Phone Prompt and Ride Action Gate Design

## Summary

After WeChat login, the mini program prompts the user to authorize a phone number, but the prompt must be skippable during passive browsing and profile use. A verified phone number becomes mandatory only when the user is about to organize or join a ride: publishing a session, claiming a role, or switching into another role.

This keeps browsing lightweight while ensuring every active rider or organizer has a phone number before they enter the operational ride flow.

## Goals

- Let users log in, browse sessions, inspect details, and use non-ride actions without being blocked by phone authorization.
- Prompt for phone authorization after a fresh login when it is missing, with clear copy that it will be required before creating or joining a ride.
- Require a verified phone before session publishing and seat claiming.
- Use WeChat's required `button open-type="getPhoneNumber"` interaction for phone authorization.
- Add backend enforcement so API calls cannot bypass the mini program phone gate.

## Non-Goals

- Do not require phone authorization for browsing session detail or share pages.
- Do not require phone authorization just to open the mine page or inspect account state.
- Do not expose phone numbers in public session, share, or profile surfaces.
- Do not replace the existing gender completion flow.
- Do not build a manual contact fallback in this change.

## Existing Context

The mini program already centralizes login in `apps/miniprogram/src/utils/api.js` through `ensureLoggedIn()`, which handles `wx.login`, backend auth, local auth cache, and missing gender completion. The shared `AuthIdentityBar` already responds to auth/profile events and opens a required profile modal for missing gender.

The backend already exposes `POST /api/auth/wechat/phone`, and `publicUser()` includes `phoneVerifiedAt`. The current phone endpoint stores a submitted phone placeholder and sets `phone_verified_at`, but the protected ride endpoints do not yet enforce phone verification.

Existing product notes prefer collecting phone/contact information at action time rather than while browsing. This design follows that direction.

## User Flow

### Login Without Blocking

1. User taps a login-protected but non-ride action.
2. `ensureLoggedIn()` performs WeChat login if needed.
3. If the user has no `phoneVerifiedAt`, the app shows a skippable phone prompt after this fresh login.
4. If the user skips, login still succeeds and the original non-ride action may continue.
5. Existing missing-gender handling still runs according to current requirements.

### Creating a Ride

1. User reaches the final publish step on `pages/session/setup`.
2. `createPublishedSession()` calls `ensureLoggedIn({ requirePhone: true })`.
3. If the user lacks `phoneVerifiedAt`, the app opens a required phone authorization prompt.
4. The prompt uses a WeChat phone authorization button.
5. If authorization succeeds, the app updates auth cache and continues publishing.
6. If the user rejects or closes the prompt, publishing stops and the draft remains on the page.

### Joining or Switching Roles

1. User chooses and confirms a role on `pages/session/share`.
2. The final claim path calls `ensureLoggedIn({ requirePhone: true })`.
3. If phone authorization succeeds, the app calls `POST /api/session-seats/:id/claim`.
4. If phone authorization is rejected, no local role state is committed and no claim request is sent.

## Frontend Design

### Shared Phone Helpers

Add shared phone helpers to `apps/miniprogram/src/utils/api.js`:

- `updateUserPhoneFromWechatPhoneCode(code)` calls `POST /api/auth/wechat/phone`.
- `requestUserPhoneFromPhoneModal(auth, options)` emits phone-profile events and waits for the visible component to respond.
- `ensureUserPhone(auth, options)` returns the current auth if `auth.user.phoneVerifiedAt` exists. If `options.requirePhone === true`, it requests phone authorization and returns `null` when the user does not complete it. If phone is optional after a fresh login, it prompts once and still returns the original auth when skipped.

The default `ensureLoggedIn()` behavior remains login-first and non-blocking for phone. It shows the optional phone prompt after fresh login, avoids repeatedly nagging cached sessions, and only enforces phone when passed `requirePhone: true`.

### UI Component

Extend `AuthIdentityBar.vue` with a phone authorization modal or a second modal mode:

- Optional mode copy: phone authorization is recommended now and required before creating or joining a ride.
- Required mode copy: phone authorization is required before creating or joining a ride.
- Optional mode has a skip/cancel action.
- Required mode has no successful bypass; closing or rejecting returns `null` to the waiting guard.
- The authorization control is a `button` with `open-type="getPhoneNumber"`.
- The handler reads the dynamic phone authorization `code` from the WeChat event and sends it to the shared API helper.

The phone prompt should not use a normal modal confirm button as the authorization action, because WeChat phone authorization must be initiated by a user click on the dedicated open-type button.

### Action Gates

Update these frontend gates:

- `apps/miniprogram/src/pages/session/setup.vue`
  - `createPublishedSession()` calls `ensureLoggedIn({ requirePhone: true, ... })` before setting `busyAction` or creating the session.
- `apps/miniprogram/src/pages/session/share.vue`
  - `confirmRole()` calls `ensureSeatSelectionLogin({ requirePhone: true })`, or the local wrapper always requires phone for final confirmation.
  - Role browsing and tentative selection can remain available after normal login, but the final claim must be gated.

Other pages continue to use normal `ensureLoggedIn()` unless they create or join a ride.

## Backend Design

### Phone Authorization Endpoint

Keep `POST /api/auth/wechat/phone` authenticated. Accept the WeChat phone authorization `code` from the frontend.

For local mock login or current development mode, the endpoint may persist a deterministic placeholder value and set `phone_verified_at`, preserving testability. For production, the endpoint should exchange the phone authorization `code` with WeChat's phone number API server-side and never rely on the mini program to submit a raw phone number as proof.

The response returns `{ user, roles }` or enough data for the frontend to refresh the auth cache consistently with existing user update flows.

### Ride Action Enforcement

Add a backend guard that rejects ride actions when `user.user.phoneVerifiedAt` is missing:

- `POST /api/sessions`
- `POST /api/session-seats/:id/claim`

The error should be explicit, for example code `PHONE_REQUIRED` with a user-safe message such as `Phone authorization is required before creating or joining a ride`. The frontend should still gate before the request, but this backend check is the source of truth.

## Data Flow

```text
wx.login
  -> POST /api/auth/wechat/login
  -> auth cache updated
  -> optional phone prompt appears after fresh login if phone is missing
  -> user may skip

publish or claim action
  -> ensureLoggedIn({ requirePhone: true })
  -> AuthIdentityBar phone modal
  -> button open-type="getPhoneNumber"
  -> POST /api/auth/wechat/phone { code }
  -> users.phone_verified_at set
  -> auth cache updated
  -> original publish or claim continues
```

## Error Handling

- User skips optional prompt: keep logged-in auth and continue non-ride action.
- User rejects required phone authorization: stop the protected action and show a short toast.
- Phone endpoint fails: keep the current page state, stop the protected action, and show a retryable error.
- Backend returns `PHONE_REQUIRED`: frontend should surface the same phone authorization prompt if possible; otherwise show a clear toast.
- Missing or malformed phone authorization code returns a validation error.

## Testing

- Add focused checks to prove optional login does not require phone.
- Add frontend source checks that publish and claim paths pass `requirePhone: true` before side effects.
- Add backend smoke coverage that `POST /api/sessions` and `POST /api/session-seats/:id/claim` reject users without `phoneVerifiedAt`.
- Add backend smoke coverage that phone authorization updates `phoneVerifiedAt`, after which the same ride action succeeds.
- Keep existing gender, share, maintenance, and miniprogram checks passing.

## Rollout Notes

Before production release, confirm the mini program privacy guide declares phone number collection and that the production backend exchanges WeChat phone authorization codes server-side. Public pages and share images must continue to avoid exposing phone numbers.
