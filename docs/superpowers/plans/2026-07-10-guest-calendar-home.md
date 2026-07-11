# Guest Calendar Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing calendar the first screen for both guests and authenticated users, allow anonymous read-only browsing of upcoming public sessions, and close ordinary detail access after a session starts.

**Architecture:** `pages/index/index.vue` owns authentication state and selects either an anonymous upcoming data source or the existing member data sources. `SessionCalendar.vue` keeps one layout and receives an explicit guest/member mode. The API adds a minimal anonymous list serializer and viewer-aware session detail access; signed join-invite tokens preserve D23 share-card entry without treating the existing analytics `shareCode` as authorization.

**Tech Stack:** Node.js 20 ESM HTTP API, MySQL, UniApp/Vue 3, TDesign Mini Program, repository static checks and database smoke scripts.

---

## File Map

- Create `scripts/d40-guest-calendar-home-check.js`: static acceptance checks for home, calendar, detail, routes, and package integration.
- Create `scripts/d40-guest-calendar-home-smoke.js`: isolated-database API behavior and privacy smoke test.
- Modify `package.json`: register D40 checks and smoke syntax validation.
- Modify `apps/api/src/modules/core/service.js`: anonymous upcoming query plus viewer-aware public/member/invite detail serializers.
- Modify `apps/api/src/server.js`: anonymous route, optional-auth detail route, and signed join-invite token issue/verify routes.
- Modify `apps/miniprogram/src/pages/index/index.vue`: remove first-session state and load guest/member calendar data.
- Modify `apps/miniprogram/src/components/SessionCalendar.vue`: explicit guest/member mode with shared layout and guest card routing.
- Modify `apps/miniprogram/src/pages/session/detail.vue`: guest entry state, server access scope, login-gated actions, and post-start cache clearing.
- Modify `apps/miniprogram/src/pages/session/share.vue`: carry signed invite tokens while retaining analytics `shareCode`.
- Modify `specs/d40-guest-calendar-home/tasks.md`: live execution status and verification evidence.

## Task 1: RED Static Contract

**Files:**
- Create: `scripts/d40-guest-calendar-home-check.js`
- Modify: `package.json`
- Modify: `specs/d40-guest-calendar-home/tasks.md`

- [ ] **Step 1: Add assertions for the approved homepage contract**

The script must read source files and fail unless all of these are present:

```js
assert(!home.includes('homeState === "first-session"'), "D40 removes first-session home");
assert(home.includes("我的车局（点击登录）"), "D40 guest CTA label");
assert(home.includes("我的车局（点击创建）"), "D40 member CTA label");
assert(home.includes("/api/sessions/public/upcoming?limit=20"), "D40 anonymous source");
assert(calendar.includes('calendarMode: "guest"'), "D40 explicit guest mode");
assert(calendar.includes("近期车局"), "D40 guest filter label");
assert(calendar.includes("entry=guest"), "D40 guest detail route");
assert(detail.includes('return this.entry === "guest"'), "D40 guest detail state");
assert(server.includes('/api/sessions/public/upcoming'), "D40 public API route");
```

- [ ] **Step 2: Register the check in `npm run check`**

Add `node scripts/d40-guest-calendar-home-check.js` after D39 so the complete check suite enforces D38, D39, then D40.

- [ ] **Step 3: Run the check and verify RED**

Run:

```bash
node scripts/d40-guest-calendar-home-check.js
```

Expected: exit 1 because the existing home still contains `first-session` and no public upcoming route exists.

- [ ] **Step 4: Record the RED result in `tasks.md`**

Keep D40.2 unchecked and add the exact missing-contract failure to the verification record.

## Task 2: RED API Smoke

**Files:**
- Create: `scripts/d40-guest-calendar-home-smoke.js`
- Modify: `package.json`

- [ ] **Step 1: Build reusable request and fixture helpers**

Follow D38's smoke conventions: `request()`, `login()`, `authorizePhone()`, `createStore()`, `createScript()`, and `createSession()`. Every fixture name must include a D40 timestamp suffix and run against the configured isolated smoke database.

- [ ] **Step 2: Add anonymous list assertions**

Create eligible, share-only, cancelled, locked/full, past, and future sessions. Assert:

```js
const publicRows = (await request("GET", "/api/sessions/public/upcoming?limit=20")).data.sessions;
assert(ids(publicRows).has(eligible.session.id), "eligible public session is visible");
assert(!ids(publicRows).has(shareOnly.session.id), "share-only session is hidden");
assert(!ids(publicRows).has(past.session.id), "started session is hidden");
assert(sortedByStartAt(publicRows), "public sessions sort by start time then id");
assert(publicRows.length <= 20, "public list clamps limit to 20");
```

Check each row does not contain `note`, `confirmed_user_open_id`, `phone`, coordinates, or album counts.

- [ ] **Step 3: Add detail access assertions**

Assert public future detail returns `access_scope = public_preview`; started detail returns 404 to guests and unrelated users; owner and confirmed members receive `member`; raw `shareCode` does not grant access; a signed invite yields only `invite_preview` and no album payload.

- [ ] **Step 4: Run syntax and smoke RED**

Run:

```bash
node --check scripts/d40-guest-calendar-home-smoke.js
BASE_URL=http://localhost:3018 node scripts/d40-guest-calendar-home-smoke.js
```

Expected: syntax passes; smoke fails with 404 for the missing public route.

## Task 3: GREEN Anonymous Upcoming API

**Files:**
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`
- Test: `scripts/d40-guest-calendar-home-smoke.js`

- [ ] **Step 1: Export `listPublicUpcomingSessions(filters = {})`**

Use the exact eligibility SQL from D40 design. Clamp limit with existing `limitValue(filters.limit, 20)` and then `Math.min(..., 20)`. Select only card fields and numeric counts.

- [ ] **Step 2: Add the static anonymous route before dynamic session-id matching**

```js
if (request.method === "GET" && url.pathname === "/api/sessions/public/upcoming") {
  jsonResponse(response, 200, {
    ok: true,
    data: { sessions: await listPublicUpcomingSessions(Object.fromEntries(url.searchParams)) }
  });
  return;
}
```

Do not call `getAuthUser` or `optionalAuthUser`.

- [ ] **Step 3: Run the D40 smoke subset**

Expected: anonymous-list assertions pass; detail-access assertions remain RED.

- [ ] **Step 4: Mark D40.4 complete only after evidence**

Update every D40.4 child checkbox and its parent in `tasks.md` after the route and query pass smoke.

## Task 4: GREEN Viewer-aware Detail Privacy

**Files:**
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`
- Test: `scripts/d40-guest-calendar-home-smoke.js`

- [ ] **Step 1: Add participant lookup and public serializer helpers**

Create focused helpers:

```js
async function sessionAccessForViewer(connection, session, viewer) {}
async function publicSessionPreview(connection, session) {}
async function memberSessionDetail(connection, session) {}
export async function getSessionForViewer(id, { viewer = null, inviteClaims = null } = {}) {}
```

`publicSessionPreview` must omit confirmed user IDs/open IDs and expose only seat/NPC role labels and states.

- [ ] **Step 2: Enforce the lifecycle matrix**

`public_preview` requires public + recruiting + future. `member` requires organizer, admin, confirmed/locked seat, or bound NPC membership. A valid invite gets `invite_preview`; every other post-start or share-only ordinary request throws `notFound("Session not found")`.

- [ ] **Step 3: Make GET detail optional-auth**

Parse the bearer token with `optionalAuthUser(request)` and pass verified invite claims, never raw `entry`, to `getSessionForViewer`.

- [ ] **Step 4: Run detail smoke GREEN**

Expected: public pre-start, post-start 404, and member access assertions pass. Invite-specific assertions remain RED until Task 5.

## Task 5: GREEN Signed Join Invite

**Files:**
- Modify: `apps/api/src/server.js`
- Modify: `apps/miniprogram/src/pages/session/share.vue`
- Test: `scripts/d40-guest-calendar-home-smoke.js`

- [ ] **Step 1: Add purpose-bound HMAC helpers**

Reuse the base64url HMAC pattern from album-share tokens. Claims must contain:

```js
{
  purpose: "session_join_invite",
  sessionId,
  inviterUserId,
  exp
}
```

Reject malformed, expired, wrong-purpose, and wrong-session tokens.

- [ ] **Step 2: Add an authenticated issue endpoint**

Add `POST /api/sessions/:id/join-invite-token`. Require organizer or confirmed member and return `{ token, expires_at }`.

- [ ] **Step 3: Carry `inviteToken` in friend/group share paths**

Before returning `onShareAppMessage`, ensure the page has fetched a token. Preserve `shareCode` for analytics, but add `inviteToken` to `/pages/session/share` and downstream detail requests.

- [ ] **Step 4: Verify invite preview does not grant album access**

Run D40 smoke and existing D23 privacy checks. Expected: invite preview passes; full album still requires membership or D23 album token.

## Task 6: GREEN Always-calendar Home

**Files:**
- Modify: `apps/miniprogram/src/pages/index/index.vue`
- Test: `scripts/d40-guest-calendar-home-check.js`

- [ ] **Step 1: Delete the first-session template and styles**

Remove the first-session and old page-level loading/error hero branches. Keep maintenance as the only non-calendar page.

- [ ] **Step 2: Add explicit authentication and guest data state**

Add computed `isAuthenticated`, `calendarMode`, and `createButtonLabel`. Guest loading calls exactly `/api/sessions/public/upcoming?limit=20`; member loading retains `/api/users/me/sessions` and `/api/users/me/signups`.

- [ ] **Step 3: Make auth transitions reload the correct source**

Guest-bar login, CTA login, logout, and 401 handling clear the previous source and reload without changing pages. CTA login success stops before `goCreate()`.

- [ ] **Step 4: Run static check**

Expected: home assertions pass; calendar/detail assertions may remain RED.

## Task 7: GREEN Shared Calendar Guest Mode

**Files:**
- Modify: `apps/miniprogram/src/components/SessionCalendar.vue`
- Modify: `apps/miniprogram/src/pages/index/index.vue`
- Test: `scripts/d40-guest-calendar-home-check.js`

- [ ] **Step 1: Add `calendarMode` prop**

The prop accepts `guest | member`; the component does not read auth storage.

- [ ] **Step 2: Derive guest items and filter options**

Map public rows with the same discovery card mapper but type `guest`. Guest filter options contain one entry `{ value: "guest", label: "近期车局", count }`; member retains mine/city.

- [ ] **Step 3: Preserve shared control positions**

Date remains read-only and available. Emit `identity-required` for guest CTA, bag/admin slot, and archive. Hide manage/delete/exit actions on guest cards.

- [ ] **Step 4: Route guest cards to `entry=guest`**

Keep city cards on `entry=city`; mine cards retain existing routes.

- [ ] **Step 5: Run D38, D39, and D40 checks**

Expected: all three pass so guest mode does not regress member/city behavior.

## Task 8: GREEN Guest Detail and Login Gates

**Files:**
- Modify: `apps/miniprogram/src/pages/session/detail.vue`
- Test: `scripts/d40-guest-calendar-home-check.js`

- [ ] **Step 1: Parse `entry=guest` and server `access_scope`**

Guest preview remains visually the existing detail page. City preview keeps its D39 notice, hidden actions, share-menu lock, and event guards.

- [ ] **Step 2: Keep reads anonymous and gate actions**

Loading the detail must not call `ensureLoggedIn`. Existing action methods call context-specific login first. Login success reloads detail access; write/navigation happens only after its normal confirmation path.

- [ ] **Step 3: Clear post-start unauthorized cache**

On 404/private transition, clear session, seat, NPC, review, and share-stat state before showing “车局已发车，仅同车成员可查看”. Do not convert this privacy result into a login popup.

- [ ] **Step 4: Run D39 and D40 static checks**

Expected: guest behavior passes while city remains read-only and unshareable.

## Task 9: Full Verification and Task Sync

**Files:**
- Modify: `specs/d40-guest-calendar-home/tasks.md`

- [ ] **Step 1: Run focused checks**

```bash
node scripts/d40-guest-calendar-home-check.js
node --check scripts/d40-guest-calendar-home-smoke.js
node scripts/d39-city-preview-readonly-check.js
node scripts/d23-album-share-join-policy-check.js
```

- [ ] **Step 2: Run backend smoke**

Start the isolated API using the repository smoke convention, run D40 smoke, and stop it. Expected: every scenario passes and fixtures stay outside production.

- [ ] **Step 3: Run complete checks and build**

```bash
npm run check
npm run build:mp-weixin
```

Expected: exit 0 for both, with no localhost API in the production build.

- [ ] **Step 4: Verify in WeChat DevTools**

Clear storage/login, confirm direct calendar cold start and no login modal. Exercise read-only card/detail, cancel login, complete login, verify CTA state change, and verify a started session cannot be reopened as a guest.

- [ ] **Step 5: Update every completed D40 task with evidence**

Keep any unverified online deployment item unchecked and record its exact blocking condition. Do not claim online `api.pinche.jubenmi.com` routes until a real anonymous request returns the expected response.
