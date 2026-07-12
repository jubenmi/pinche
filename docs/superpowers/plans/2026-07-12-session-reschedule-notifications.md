# Session Reschedule Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let organizers reschedule an unstarted session with member confirmation, persistent in-app notifications, WeChat subscription reminders, and one unified Mini Program message panel.

**Architecture:** Add a dedicated transactional reschedule service and persistent `user_notifications` table. Commit session time and in-app notifications atomically, then send WeChat messages best-effort outside the transaction. Keep Mini Program data shaping and time rules in pure helpers, while `AuthIdentityBar.vue` merges live pending-signup items with persistent notifications.

**Tech Stack:** Node.js 20 ESM, MySQL 8, UniApp/Vue 3 Options API, TDesign Mini Program, WeChat subscribe-message API, Node built-in test runner and repository contract/smoke scripts.

---

## File map

- Create `apps/api/migrations/0024_user_notifications.sql`: persistent notification schema and indexes.
- Create `apps/api/src/modules/core/user-notifications.js`: notification constants, payload serialization, row mapping, insert/list/read helpers.
- Modify `apps/api/src/modules/core/service.js`: transactional reschedule, recipient selection, notification list/read exports, and signup-review notification inserts.
- Create `apps/api/src/modules/core/session-reschedule.js`: explicit-offset parsing, MySQL-second normalization, operation-key generation, and safe response shaping.
- Create `apps/api/test/session-reschedule.test.mjs`: pure reschedule time and operation-key tests.
- Create `apps/api/test/session-reschedule-service.test.mjs`: executable transaction behavior tests with a fake connection.
- Modify `apps/api/src/server.js`: reschedule and notification routes.
- Modify `apps/api/src/config/env.js`: reschedule template ID configuration.
- Modify `apps/api/src/modules/wechat/subscribe-message.js`: reschedule message builder/sender.
- Create `apps/miniprogram/src/utils/sessionReschedule.js`: pure parsing, formatting, validation, and confirmation-copy helpers.
- Create `apps/miniprogram/test/sessionReschedule.test.mjs`: helper unit tests.
- Modify `apps/miniprogram/src/utils/subscribeMessages.js`: member reschedule subscription scene.
- Modify `apps/miniprogram/src/pages/session/share.vue`: request reschedule subscription after a member's successful direct join.
- Modify `apps/miniprogram/src/pages/session/detail.vue`: let confirmed players and bound NPC users request reschedule reminders themselves.
- Modify `apps/miniprogram/src/pages/session/manage.vue`: reschedule picker, confirmation, request, refresh, and delivery summary.
- Modify `apps/miniprogram/src/utils/authMessages.js`: normalize and merge persistent notifications with pending-signup items.
- Modify `apps/miniprogram/src/components/AuthIdentityBar.vue`: fetch/render/read unified messages.
- Modify `scripts/d25-auth-message-panel-check.js`: protect unified-panel hooks.
- Create `scripts/d45-session-reschedule-notifications-check.js`: static contract coverage.
- Create `scripts/d45-session-reschedule-notifications-smoke.js`: database/API behavior coverage.
- Modify `package.json`: add D45 checks to scripts and aggregate check.

### Task 1: Persistent notification schema and helpers

**Files:**
- Create: `apps/api/migrations/0024_user_notifications.sql`
- Create: `apps/api/src/modules/core/user-notifications.js`
- Create: `scripts/d45-session-reschedule-notifications-check.js`

- [ ] **Step 1: Write the failing schema/helper contract check**

Create a Node script that reads the migration and helper source and asserts these concrete contracts:

```js
assertIncludes(migration, "CREATE TABLE IF NOT EXISTS user_notifications");
assertIncludes(migration, "UNIQUE KEY uq_user_notifications_dedupe (user_id, dedupe_key)");
assertIncludes(migration, "KEY idx_user_notifications_inbox (user_id, read_at, created_at)");
assertIncludes(helper, "export const USER_NOTIFICATION_TYPES");
assertIncludes(helper, "export async function insertUserNotification");
assertIncludes(helper, "export function userNotificationResponse");
```

- [ ] **Step 2: Run the contract check and verify RED**

Run: `node scripts/d45-session-reschedule-notifications-check.js`

Expected: FAIL because `0024_user_notifications.sql` and `user-notifications.js` do not exist.

- [ ] **Step 3: Add the migration**

Define `user_notifications` with `id`, `user_id`, `type`, `session_id`, `title`, `payload_json`, `dedupe_key`, `read_at`, `created_at`, and `updated_at`; add foreign keys to `users` and `sessions`, the unique `(user_id, dedupe_key)` constraint, and inbox index `(user_id, read_at, created_at)`.

- [ ] **Step 4: Add focused notification helpers**

Implement and export:

```js
export const USER_NOTIFICATION_TYPES = Object.freeze({
  SIGNUP_REVIEWED: "signup_reviewed",
  SESSION_RESCHEDULED: "session_rescheduled"
});

export async function insertUserNotification(connection, input) {
  await connection.query(
    `INSERT INTO user_notifications
      (user_id, type, session_id, title, payload_json, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [input.userId, input.type, input.sessionId, input.title,
      JSON.stringify(input.payload || {}), input.dedupeKey]
  );
}
```

Add a defensive JSON parser and `userNotificationResponse(row)` returning camel-independent API fields: `id`, `type`, `session_id`, `title`, `payload`, `read_at`, and `created_at`.

- [ ] **Step 5: Run the check and API syntax validation**

Run: `node scripts/d45-session-reschedule-notifications-check.js && npm --workspace apps/api run check`

Expected: PASS with `D45 session reschedule notification checks passed` and API check success.

- [ ] **Step 6: Commit**

```bash
git add apps/api/migrations/0024_user_notifications.sql apps/api/src/modules/core/user-notifications.js scripts/d45-session-reschedule-notifications-check.js
git commit -m "feat: add persistent user notifications"
```

### Task 2: Dedicated transactional reschedule service

**Files:**
- Modify: `apps/api/src/modules/core/service.js`
- Create: `apps/api/src/modules/core/session-reschedule.js`
- Create: `apps/api/test/session-reschedule.test.mjs`
- Create: `apps/api/test/session-reschedule-service.test.mjs`
- Modify: `apps/api/src/server.js`
- Modify: `apps/api/package.json`
- Modify: `scripts/d45-session-reschedule-notifications-check.js`

- [ ] **Step 1: Extend the failing contract check**

Assert the service exports `rescheduleSession` and its testable transaction worker, uses the database-computed `start_at <= CURRENT_TIMESTAMP` lifecycle flag plus session/seat/NPC-role `SELECT ... FOR UPDATE` lock order, checks `membersConfirmed`, inserts `SESSION_RESCHEDULED`, and the server matches `POST /api/sessions/:id/reschedule` before the generic session update route without exposing internal recipients.

- [ ] **Step 2: Verify RED**

Run: `node scripts/d45-session-reschedule-notifications-check.js`

Expected: FAIL with missing `rescheduleSession` and route assertions.

- [ ] **Step 3: Implement recipient selection and validation**

In `service.js`, add a transaction that locks the session row and reads `(start_at <= CURRENT_TIMESTAMP) AS session_started`, calls the existing organizer/admin authorization rule, and rejects when that database-authoritative flag is true. Require an explicit ISO-8601 offset or `Z`, normalize input and the driver-returned current `Date` to MySQL second precision, and reject invalid/past/unchanged (including sub-second-only) values. Lock indexed child membership in session → seats → NPC roles order before selecting distinct non-organizer users from confirmed/locked seats plus bound active NPC roles.

Extract the transaction work as an exported connection-accepting function while keeping `rescheduleSession(user, id, body)` as the unchanged public service API. Add executable fake-connection tests for authorization before mutation, confirmation conflict without writes, seat/NPC recipient dedupe, lock order, notification failure rejection, internal recipients, and safe public response shaping.

Use an explicit conflict response when recipients exist without confirmation:

```js
if (recipients.length > 0 && body.membersConfirmed !== true) {
  throw conflict("Member confirmation is required before rescheduling");
}
```

- [ ] **Step 4: Atomically update and insert in-app notifications**

Update `sessions.start_at`, then insert one `session_rescheduled` row per deduplicated recipient with payload:

```js
{
  script_name: session.script_name_snapshot,
  old_start_at: session.start_at,
  new_start_at: normalizedStartAt
}
```

Use one operation-scoped dedupe key `session-rescheduled:<sessionId>:<operationId>` shared by all recipient inserts, and return the updated session plus recipient `userId`/`openid` records to the outer scope. Generate `operationId` once per successful transaction so retries that roll back remain harmless while a later legitimate reschedule back to an earlier time (for example B→A) still creates new notifications.

- [ ] **Step 5: Add the dedicated route**

Parse `/api/sessions/(\d+)/reschedule`, require authentication, read JSON, call `rescheduleSession(user, id, body)`, and return `{ data }` with the service result.

- [ ] **Step 6: Run checks**

Run: `npm --workspace apps/api run test:session-reschedule && node scripts/d45-session-reschedule-notifications-check.js && npm --workspace apps/api run check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/core/service.js apps/api/src/modules/core/session-reschedule.js apps/api/test/session-reschedule.test.mjs apps/api/test/session-reschedule-service.test.mjs apps/api/src/server.js apps/api/package.json scripts/d45-session-reschedule-notifications-check.js
git commit -m "feat: add transactional session reschedule API"
```

### Task 3: WeChat reschedule subscription delivery

**Files:**
- Modify: `apps/api/src/config/env.js`
- Modify: `apps/api/src/modules/wechat/subscribe-message.js`
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `scripts/check-api-env.js`
- Modify: `scripts/d45-session-reschedule-notifications-check.js`

- [ ] **Step 1: Add failing configuration and sender assertions**

Require `WECHAT_SUBSCRIBE_SESSION_RESCHEDULED_TEMPLATE_ID`, `notifySessionRescheduled`, scene `session_rescheduled`, and a post-transaction `Promise.allSettled` delivery summary with `sent`, `skipped`, and `failed`.

- [ ] **Step 2: Verify RED**

Run: `node scripts/d45-session-reschedule-notifications-check.js && node scripts/check-api-env.js`

Expected: FAIL because the configuration and sender are absent.

- [ ] **Step 3: Add config and sender**

Map the environment variable to `config.subscribeMessage.sessionRescheduledTemplateId`. Implement `notifySessionRescheduled(payload)` using the common sender with the detail-page path and template data for script name, old time, new time, and “车局已改期”. Keep template fields isolated in `rescheduleMessageData()` so existing signup templates do not change.

- [ ] **Step 4: Send after transaction and summarize results**

After the reschedule transaction returns, call the sender once per deduplicated recipient. Convert settled results into:

```js
notification_delivery: {
  recipients: recipients.length,
  sent,
  skipped,
  failed
}
```

Never throw because one WeChat request fails; log through the existing `tryNotify`/notification logging pattern.

- [ ] **Step 5: Run checks**

Run: `WECHAT_SUBSCRIBE_MESSAGE_ENABLED=false node scripts/d45-session-reschedule-notifications-check.js && node scripts/check-api-env.js && npm --workspace apps/api run check`

Expected: PASS; disabled messaging is counted as skipped without network access.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config/env.js apps/api/src/modules/wechat/subscribe-message.js apps/api/src/modules/core/service.js scripts/check-api-env.js scripts/d45-session-reschedule-notifications-check.js
git commit -m "feat: notify members when sessions are rescheduled"
```

### Task 4: Notification inbox and signup-review persistence

**Files:**
- Modify: `apps/api/src/modules/core/user-notifications.js`
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`
- Modify: `scripts/d45-session-reschedule-notifications-check.js`

- [ ] **Step 1: Add failing route/service assertions**

Require exports `listMyNotifications` and `markMyNotificationRead`, routes `GET /api/users/me/notifications` and `POST /api/users/me/notifications/:id/read`, owner-scoped SQL, and `SIGNUP_REVIEWED` inserts inside both approve and reject transactions.

- [ ] **Step 2: Verify RED**

Run: `node scripts/d45-session-reschedule-notifications-check.js`

Expected: FAIL for missing notification inbox behavior.

- [ ] **Step 3: Implement inbox reads and read marking**

List at most 50 current-user rows ordered by unread first and newest first, returning `{ items, unread_count }`. Mark read with `UPDATE ... WHERE id = ? AND user_id = ?`; return not found if no owned row changed.

- [ ] **Step 4: Persist signup review results in existing transactions**

In both approval and rejection paths, insert a notification for the applicant with type `signup_reviewed`, result payload (`approved` or `rejected`), target label, session snapshots, and dedupe key `signup-reviewed:<signupId>:<result>` before transaction commit. Preserve the existing WeChat send after commit.

- [ ] **Step 5: Add authenticated routes and run checks**

Run: `node scripts/d45-session-reschedule-notifications-check.js && npm --workspace apps/api run check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/core/user-notifications.js apps/api/src/modules/core/service.js apps/api/src/server.js scripts/d45-session-reschedule-notifications-check.js
git commit -m "feat: add unified notification inbox API"
```

### Task 5: Reschedule helper and management-page interaction

**Files:**
- Create: `apps/miniprogram/src/utils/sessionReschedule.js`
- Create: `apps/miniprogram/test/sessionReschedule.test.mjs`
- Modify: `apps/miniprogram/src/pages/session/manage.vue`
- Modify: `scripts/d45-session-reschedule-notifications-check.js`

- [ ] **Step 1: Write failing unit tests**

Cover valid ISO/database timestamps, invalid dates, `canRescheduleSession(startAt, now)`, local `YYYY-MM-DD HH:mm` display, unchanged/past selection rejection, and confirmation copy containing member count plus old/new times.

```js
assert.equal(canRescheduleSession("2030-01-01T12:00:00Z", now), true);
assert.equal(canRescheduleSession("2020-01-01T12:00:00Z", now), false);
assert.match(buildRescheduleConfirmation({ memberCount: 2, oldStartAt, newStartAt }), /2 位成员/);
```

- [ ] **Step 2: Verify RED**

Run: `node --test apps/miniprogram/test/sessionReschedule.test.mjs`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the minimal pure helper**

Export `parseSessionStartAt`, `formatSessionStartAt`, `canRescheduleSession`, `validateRescheduleSelection`, and `buildRescheduleConfirmation`. Use explicit local date parts for display and compare epoch milliseconds for rules.

- [ ] **Step 4: Verify GREEN**

Run: `node --test apps/miniprogram/test/sessionReschedule.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Add management-page controls**

Render localized time plus a “改期” button only when `canRescheduleSession` is true. Add a controlled `t-date-time-picker` with `mode="date,minute"`, current session value, a current-time lower bound, and confirm/cancel handlers. Before POSTing, call `showModal` with helper-generated copy; set `membersConfirmed` to `true` only when other onboard members exist and the user confirms.

- [ ] **Step 6: Add success/failure handling**

POST `/api/sessions/${sessionId}/reschedule`, refresh session after success, and summarize `notification_delivery`. Map 409 member-confirmation and already-started errors to direct Chinese guidance; keep the chosen value after retryable failures.

- [ ] **Step 7: Run focused checks**

Run: `node --test apps/miniprogram/test/sessionReschedule.test.mjs && node scripts/d45-session-reschedule-notifications-check.js && node scripts/check-miniprogram.js && npm run build:mp-weixin`

Expected: all PASS and Mini Program build succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/miniprogram/src/utils/sessionReschedule.js apps/miniprogram/test/sessionReschedule.test.mjs apps/miniprogram/src/pages/session/manage.vue scripts/d45-session-reschedule-notifications-check.js
git commit -m "feat: add session reschedule controls"
```

### Task 6: Member subscription request flow

**Files:**
- Modify: `apps/miniprogram/src/utils/subscribeMessages.js`
- Modify: `apps/miniprogram/src/pages/session/share.vue`
- Modify: `apps/miniprogram/src/pages/session/detail.vue`
- Modify: `scripts/d45-session-reschedule-notifications-check.js`

- [ ] **Step 1: Add failing subscription assertions**

Require scene `member_session_rescheduled`, environment template ID exposure, `requestSessionRescheduledSubscription()`, a call after successful direct join, and a member-only “改期提醒” action on the session detail page. Assert subscription rejection never controls the original join return path.

- [ ] **Step 2: Verify RED**

Run: `node scripts/d45-session-reschedule-notifications-check.js`

Expected: FAIL for missing subscription scene/helper/calls.

- [ ] **Step 3: Add the helper and invoke after successful user actions**

Extend `TEMPLATE_IDS`, export:

```js
export function requestSessionRescheduledSubscription() {
  return requestBusinessSubscription("member_session_rescheduled");
}
```

Call it without changing the business success result after a player becomes confirmed through direct join. On the detail page, show “改期提醒” only when the current user is a confirmed/locked player or the bound user of an active NPC role; that user-tapped action calls the same helper. Do not ask pending applicants, and do not let an organizer attempt to authorize on another member's behalf.

- [ ] **Step 4: Run checks and build**

Run: `node scripts/d45-session-reschedule-notifications-check.js && node scripts/d14-session-signup-notifications-check.js && npm run build:mp-weixin`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/miniprogram/src/utils/subscribeMessages.js apps/miniprogram/src/pages/session/share.vue apps/miniprogram/src/pages/session/detail.vue scripts/d45-session-reschedule-notifications-check.js
git commit -m "feat: request session reschedule subscriptions"
```

### Task 7: Unified Mini Program message center

**Files:**
- Modify: `apps/miniprogram/src/utils/authMessages.js`
- Create: `apps/miniprogram/test/authMessages.test.mjs`
- Modify: `apps/miniprogram/src/components/AuthIdentityBar.vue`
- Modify: `scripts/d25-auth-message-panel-check.js`
- Modify: `scripts/d45-session-reschedule-notifications-check.js`

- [ ] **Step 1: Write failing pure-helper tests**

Test pending-signup normalization, signup-review notification copy, reschedule `old → new` copy, unread count, stable newest-first merge, and navigation target selection.

```js
assert.equal(buildPersistentMessage(rescheduled).actionText, "查看车局");
assert.match(buildPersistentMessage(rescheduled).subtitle, /→/);
assert.equal(totalMessageBadgeCount(pending, persistentUnread), 4);
```

- [ ] **Step 2: Verify RED**

Run: `node --test apps/miniprogram/test/authMessages.test.mjs`

Expected: FAIL for missing unified helper exports.

- [ ] **Step 3: Implement message normalization**

Keep `buildOrganizerSignupMessages`, add `buildPersistentMessages`, `mergeAuthMessages`, and `totalMessageBadgeCount`. Give each normalized item `kind`, `key`, `title`, `subtitle`, `actionText`, `sessionId`, `notificationId`, `unread`, and `createdAt`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test apps/miniprogram/test/authMessages.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Refactor `AuthIdentityBar` to load both sources**

Fetch `/api/users/me/sessions?limit=50` and `/api/users/me/notifications` together, merge normalized items, and compute the badge from pending count plus `unread_count`. Change panel title to “消息”, render type-specific tags, and retain refresh/empty/error states.

- [ ] **Step 6: Mark persistent messages read on click**

For notification items, POST `/api/users/me/notifications/:id/read`, optimistically clear unread/badge, and navigate to session detail even if marking read fails. For pending items, keep navigation to session management. Opening the panel must not mark anything read.

- [ ] **Step 7: Run message-center checks and build**

Run: `node --test apps/miniprogram/test/authMessages.test.mjs && node scripts/d25-auth-message-panel-check.js && node scripts/d45-session-reschedule-notifications-check.js && npm run build:mp-weixin`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/miniprogram/src/utils/authMessages.js apps/miniprogram/test/authMessages.test.mjs apps/miniprogram/src/components/AuthIdentityBar.vue scripts/d25-auth-message-panel-check.js scripts/d45-session-reschedule-notifications-check.js
git commit -m "feat: unify mini program notifications"
```

### Task 8: End-to-end smoke coverage and final verification

**Files:**
- Create: `scripts/d45-session-reschedule-notifications-smoke.js`
- Modify: `package.json`
- Modify: `scripts/d45-session-reschedule-notifications-check.js`

- [ ] **Step 1: Write the smoke test before final integration changes**

Using existing mock-login helpers and local API conventions, create organizer, player, and NPC users plus future/past sessions. Assert unauthorized, past-time, started-session, missing-confirmation, successful reschedule, recipient deduplication, notification inbox ownership/read behavior, and signup-review persistence. Run with messaging disabled so no live WeChat call occurs.

- [ ] **Step 2: Verify RED against the not-yet-migrated/test environment**

Run: `WECHAT_SUBSCRIBE_MESSAGE_ENABLED=false BASE_URL=http://127.0.0.1:3029 node scripts/d45-session-reschedule-notifications-smoke.js`

Expected: FAIL until migration `0024_user_notifications.sql` is applied and the local API contains the new routes.

- [ ] **Step 3: Add package scripts**

Add `d45:check` and `d45:smoke`; include the static check and both Mini Program unit files in the root `check` chain, but keep the stateful smoke test opt-in like existing smoke scripts.

- [ ] **Step 4: Run migration and smoke test against the approved local test stack**

Run: `npm run migrate`

Run: `WECHAT_SUBSCRIBE_MESSAGE_ENABLED=false BASE_URL=http://127.0.0.1:3029 node scripts/d45-session-reschedule-notifications-smoke.js`

Expected: `D45 session reschedule notifications smoke passed`.

- [ ] **Step 5: Run complete verification**

Run: `node --test apps/miniprogram/test/sessionReschedule.test.mjs apps/miniprogram/test/authMessages.test.mjs`

Run: `node scripts/d45-session-reschedule-notifications-check.js && node scripts/d25-auth-message-panel-check.js && node scripts/d14-session-signup-notifications-check.js`

Run: `npm --workspace apps/api run check && npm run build:mp-weixin && npm run check`

Expected: all commands exit 0 with no new warnings.

- [ ] **Step 6: Review the diff against the design acceptance criteria**

Confirm all seven acceptance criteria in `docs/superpowers/specs/2026-07-12-session-reschedule-notifications-design.md`, verify no unrelated user changes are staged, and record any environment-only verification limitation in the handoff.

- [ ] **Step 7: Commit**

```bash
git add scripts/d45-session-reschedule-notifications-smoke.js scripts/d45-session-reschedule-notifications-check.js package.json
git commit -m "test: cover session reschedule notifications"
```
