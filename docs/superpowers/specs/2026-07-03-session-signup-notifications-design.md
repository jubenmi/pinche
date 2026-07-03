# Session Signup Notifications Design

Date: 2026-07-03

## Context

Pinche already has the core approval model for joining a session:

- `POST /api/signups` creates a `pending` signup and moves an open seat to `applied`.
- `PATCH /api/signups/:id/approve` confirms the applicant into the seat.
- `PATCH /api/signups/:id/reject` rejects the applicant and can reopen the seat.
- `pages/session/manage` lets the organizer review pending signups.

The current Mini Program role selection path in `pages/session/share` still uses `POST /api/session-seats/:id/claim`, which directly confirms the user into a role. That conflicts with the product rule that the organizer must approve every rider before they can access role-scoped session privileges, especially post-start album privacy.

## Goal

Implement a strict organizer-review join flow with WeChat subscription notifications:

1. Every player role selection creates a pending signup instead of directly claiming a seat.
2. The organizer can receive a WeChat subscription message when someone applies.
3. The applicant can receive a WeChat subscription message when the organizer approves or rejects.
4. Subscription refusal never blocks signup, review, or session management.
5. Album and role privacy rely only on approved seat membership, never on pending signups.

## Non-Goals

- Do not add rewards, credits, or benefits for subscribing.
- Do not send marketing, growth, or share-prompt messages.
- Do not create a new signup state machine parallel to `signups`.
- Do not allow direct post-start seat claiming from the Mini Program.
- Do not require real WeChat notification delivery in local development or smoke tests.

## Product Rules

### Joining

All player joins, including post-start补位, must use this flow:

```text
player selects role
  -> player submits pending signup
  -> organizer reviews signup
  -> approval binds player to seat and role
  -> rejection leaves player without seat or album role access
```

The Mini Program must not call direct claim for role selection. The backend must also stop allowing ordinary players to self-claim seats directly, including post-start open seats. Any remaining direct seat assignment path must be limited to organizer/admin maintenance actions and must not grant a player membership without organizer intent.

### Privacy

Pending signup users are not onboard members. They must not gain:

- confirmed seat ownership
- role-bound album visibility
- same-session member privileges
- review eligibility
- post-start album access based solely on applying

Only `confirmed` or `locked` seats with `confirmed_user_id` grant those privileges.

### Notifications

Notifications are business reminders tied to explicit user action:

- Organizer subscribes to "new signup reminder" after publishing a session or from the management page.
- Player subscribes to "signup review result" after submitting a signup.

If the user rejects, dismisses, or cannot subscribe, the primary business action still succeeds. The result is recorded through the existing subscription request tracking endpoint.

## Mini Program Design

### Role Selection Page

`apps/miniprogram/src/pages/session/share.vue` changes the published-session confirm action:

- Before: call `POST /api/session-seats/:id/claim`.
- After: call `POST /api/signups` with the selected `seatId`, contact text, and note.

Successful signup copy:

```text
已提交申请，等待车头审核。
```

The selected card should show a pending state after reload because the seat becomes `applied`. The player must not be shown as "我选" unless their user id is the seat `confirmed_user_id`.

For sessions that have already started, the same pending signup flow applies. The page can still allow selecting open seats, but confirmation creates a pending signup rather than a direct claim.

### Detail Page

`apps/miniprogram/src/pages/session/detail.vue` can continue linking to role selection for `open` or `applied` seats. Any post-start affordance must use the same signup flow. Labels should distinguish:

- `open`: 可申请
- `applied`: 待审核
- `confirmed` / `locked`: 已上车 / 已锁定

### Manage Page

`apps/miniprogram/src/pages/session/manage.vue` remains the organizer review surface. It should optionally offer a clear subscription entry for new signup reminders, such as a secondary action near the refresh button:

```text
申请提醒
```

This action requests the organizer notification template. Refusal only shows a mild status message and records the result.

### Subscription Helper

Create a small Mini Program helper that:

- Checks `wx.requestSubscribeMessage` availability.
- Requests one template at a time.
- Normalizes `accept`, `reject`, `ban`, `filter`, unavailable API, and local non-WeChat environments.
- Posts the normalized result to `/api/subscriptions/request-result`.

Scenes:

- `organizer_signup_created`
- `player_signup_reviewed`

Template ids come from Mini Program environment variables, with empty values treated as disabled.

## Backend Design

### Configuration

Add environment-backed notification settings:

- `WECHAT_SUBSCRIBE_MESSAGE_ENABLED`
- `WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_CREATED`
- `WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_REVIEWED`

When disabled or missing template ids, backend notification calls become no-op results. This keeps local development and CI independent from WeChat network access.

### WeChat Client

Add a focused backend module for subscription message sending. It owns:

- Access token retrieval with the configured `WECHAT_APP_ID` and `WECHAT_APP_SECRET`.
- `POST /cgi-bin/message/subscribe/send` calls.
- No-op behavior when disabled or incomplete.
- Structured results for sent, skipped, and failed sends.

Notification failures must not roll back signup creation or organizer review. They may be logged or returned internally for future observability, but user-facing API success follows the business database transaction.

### Signup Created Notification

After `createSignup` commits a pending signup, notify the session organizer when:

- signup was created successfully
- organizer has an open id in `users.open_id`
- the signup belongs to a real session and seat
- the new-signup template id is configured

The message should deep link to:

```text
/pages/session/manage?id=<session_id>
```

Message fields should use approved template keywords only. Candidate semantic fields:

- session/script name
- seat/role name
- applicant nickname or "新申请"
- start time
- status "待审核"

### Signup Reviewed Notification

After `approveSignup` or `rejectSignup` commits, notify the applicant when:

- review operation succeeds
- applicant has an open id
- the review-result template id is configured

The message should deep link to:

```text
/pages/session/detail?id=<session_id>
```

Message fields should describe:

- session/script name
- seat/role name
- review result
- start time

### Existing Direct Claim Endpoint

The backend `POST /api/session-seats/:id/claim` must no longer be a public player onboarding path. It should either:

- reject ordinary player calls with a permission error; or
- be replaced by an organizer/admin-only direct assignment endpoint in a later maintenance spec.

Existing smoke tests that rely on player self-claiming must be updated to use:

```text
POST /api/signups
PATCH /api/signups/:id/approve
```

This keeps API behavior aligned with album privacy instead of only hiding the direct claim path from Mini Program UI.

## Data Model

No new tables are required for the MVP implementation.

Use existing tables:

- `signups` for pending/approved/rejected state.
- `session_seats.confirmed_user_id` for actual role membership.
- `subscription_requests` for client-side subscription request result tracking.

Backend send attempts do not need durable storage in this increment. If delivery audit becomes necessary, add a dedicated notification log in a later spec.

## API Behavior

### `POST /api/signups`

Expected behavior remains:

- Requires authenticated user.
- Creates a pending signup.
- Reuses existing uniqueness constraint for duplicate user-seat signup protection.
- Moves `open` seat to `applied`.
- Triggers organizer notification after commit.

### `PATCH /api/signups/:id/approve`

Expected behavior remains:

- Requires organizer or admin.
- Approves only pending signup.
- Rejects same-seat competing pending signups.
- Confirms seat for approved user.
- Triggers applicant review-result notification after commit.

### `PATCH /api/signups/:id/reject`

Expected behavior remains:

- Requires organizer or admin.
- Rejects signup.
- Reopens seat when no active signup remains.
- Triggers applicant review-result notification after commit.

### `POST /api/session-seats/:id/claim`

Expected behavior changes:

- Must not allow ordinary authenticated players to become confirmed members directly.
- Must not allow post-start open seats to be claimed without organizer review.
- Should return a permission or bad-request error for player self-claim attempts.
- Existing organizer review APIs remain the supported way to confirm membership.

## Error Handling

- Signup and review failures return existing API errors.
- Subscription prompt failures do not block UI actions.
- Backend WeChat send failures do not change API success for signup/review.
- Missing notification config produces an explicit skipped result, not an exception.
- Duplicate signup remains a conflict; UI should show the user that they already applied for this role.

## Compliance

This design follows the existing WeChat compliance guardrails:

- Subscription happens only after clear business actions.
- Refusing subscription never blocks signup or management.
- Notification content is tied to the subscribed purpose.
- No reward, marketing, or share induction is attached to subscription.

## Testing

Add or update checks to prove:

- Mini Program role confirmation no longer references `/api/session-seats/:id/claim`.
- Published-session role confirmation references `POST /api/signups`.
- Post-start open-seat selection also follows signup creation semantics.
- Backend direct claim no longer lets ordinary players bypass organizer review.
- `POST /api/signups` still creates pending signup and applied seat state.
- Approve/reject smoke coverage still passes.
- Backend notification helper returns skipped results when disabled or missing template ids.
- Existing `npm run check` syntax checks continue to pass.

## Rollout

1. Deploy backend with notification no-op support and config keys.
2. Deploy Mini Program signup-flow change.
3. Configure WeChat subscription templates in production.
4. Enable `WECHAT_SUBSCRIBE_MESSAGE_ENABLED` after templates are approved.
5. Verify on a WeChat development/experience build because `wx.requestSubscribeMessage` cannot be fully validated through Node smoke tests.
