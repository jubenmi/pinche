# Session Membership Downlisting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users remove a created or joined session from their own Mine lists without deleting the shared session or affecting other participants.

**Architecture:** Treat `sessions` as the shared "group" object and `signups` as the participant membership link. Add per-user downlisting timestamps, filter them from Mine lists, expose focused hide/relink API endpoints, and add Mini Program controls that clearly describe the personal-only effect.

**Tech Stack:** Node.js HTTP API, MySQL migrations, UniApp/Vue Mini Program, static Node regression checks.

---

## File Structure

- Create `scripts/d16-session-membership-downlisting-check.js`: static regression guard for the feature.
- Modify `package.json`: run the D16 check from root `npm run check`.
- Create `apps/api/migrations/0012_session_membership_downlisting.sql`: add `sessions.organizer_hidden_at` and `signups.user_hidden_at`.
- Modify `apps/api/src/modules/core/service.js`: add membership hide/relink functions and filter Mine lists.
- Modify `apps/api/src/server.js`: route session hide, signup hide, and session relink endpoints.
- Modify `apps/miniprogram/src/pages/mine/index.vue`: add delete/downlist actions for created and joined sessions.
- Modify `apps/miniprogram/src/pages/session/detail.vue`: relink an existing member when entering from a shared session detail.

## Spec Checklist

- [x] Shared session records are never physically deleted.
- [x] Session cancellation is not reused for personal downlisting.
- [x] Created-session downlisting only hides the organizer's Mine entry.
- [x] Joined-session downlisting only hides the current user's signup entry.
- [x] Mine lists default-filter downlisted memberships.
- [x] Shared links can relink existing organizers/participants.
- [x] Non-members cannot relink themselves into the group.
- [x] Mini Program copy explains the personal-only effect.

## Task 1: Add Failing D16 Static Regression Check

**Files:**
- Create: `scripts/d16-session-membership-downlisting-check.js`
- Modify: `package.json`

Progress: in progress.

- [x] **Step 1: Write the failing static check**

Create `scripts/d16-session-membership-downlisting-check.js` with checks for:

```js
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const migration = read("apps/api/migrations/0012_session_membership_downlisting.sql");
assert(migration.includes("organizer_hidden_at"), "migration must add organizer hidden timestamp");
assert(migration.includes("user_hidden_at"), "migration must add signup user hidden timestamp");

const service = read("apps/api/src/modules/core/service.js");
assert(service.includes("hideMyOrganizedSession"), "service must hide organizer membership");
assert(service.includes("hideMySignup"), "service must hide signup membership");
assert(service.includes("relinkMySessionMembership"), "service must relink existing memberships");
assert(service.includes("session.organizer_hidden_at IS NULL"), "created sessions list must hide downlisted organizer entries");
assert(service.includes("signup.user_hidden_at IS NULL"), "joined sessions list must hide downlisted signup entries");
assert(service.includes("organizer_hidden_at = NULL"), "relink must restore organizer entry");
assert(service.includes("user_hidden_at = NULL"), "relink must restore signup entry");

const server = read("apps/api/src/server.js");
assert(server.includes("hideMyOrganizedSession"), "server must import organizer hide service");
assert(server.includes("hideMySignup"), "server must import signup hide service");
assert(server.includes("relinkMySessionMembership"), "server must import relink service");
assert(server.includes("/hide"), "server must expose hide routes");
assert(server.includes("/relink"), "server must expose relink route");

const mine = read("apps/miniprogram/src/pages/mine/index.vue");
assert(mine.includes("hideOrganizedSession"), "Mine page must hide created sessions");
assert(mine.includes("hideJoinedSession"), "Mine page must hide joined sessions");
assert(mine.includes("只会从你的列表下架"), "Mine page must explain personal downlisting");

const detail = read("apps/miniprogram/src/pages/session/detail.vue");
assert(detail.includes("relinkSessionMembership"), "detail page must relink existing members");
assert(detail.includes("/relink"), "detail page must call relink endpoint");

const packageJson = JSON.parse(read("package.json"));
assert(
  packageJson.scripts.check.includes("scripts/d16-session-membership-downlisting-check.js"),
  "root check should run d16 session membership downlisting check"
);

console.log("D16 session membership downlisting check passed");
```

- [ ] **Step 2: Run the check to verify RED**
- [x] **Step 2: Run the check to verify RED**

Run:

```bash
node scripts/d16-session-membership-downlisting-check.js
```

Expected: FAIL with `ENOENT` for `apps/api/migrations/0012_session_membership_downlisting.sql`.

Progress: completed.

## Task 2: Add Database Columns

**Files:**
- Create: `apps/api/migrations/0012_session_membership_downlisting.sql`

Progress: in progress.

- [x] **Step 1: Create migration**

Create an idempotent MySQL migration that:

```sql
ALTER TABLE sessions ADD COLUMN organizer_hidden_at DATETIME NULL AFTER visibility;
ALTER TABLE signups ADD COLUMN user_hidden_at DATETIME NULL AFTER review_eligible_at;
```

Use `information_schema.columns` plus prepared statements so rerunning the migration is safe.

- [x] **Step 2: Run D16 to verify next RED**

Run:

```bash
node scripts/d16-session-membership-downlisting-check.js
```

Expected: FAIL with `service must hide organizer membership`.

Progress: completed.

## Task 3: Add Core Service Behavior

**Files:**
- Modify: `apps/api/src/modules/core/service.js`

Progress: in progress.

- [x] **Step 1: Filter downlisted Mine rows**

Update `listMySessions` to include:

```sql
session.organizer_hidden_at IS NULL
```

Update `listMySignups` to include:

```sql
signup.user_hidden_at IS NULL
```

- [x] **Step 2: Add organizer hide service**

Add:

```js
export async function hideMyOrganizedSession(user, sessionId) {
  return withDatabaseConnection(async (connection) => {
    const session = await requireSessionOwner(connection, sessionId, user);
    await connection.query(
      "UPDATE sessions SET organizer_hidden_at = CURRENT_TIMESTAMP WHERE id = ?",
      [sessionId]
    );
    return { ...session, organizer_hidden_at: new Date().toISOString() };
  });
}
```

- [x] **Step 3: Add signup hide service**

Add a helper that loads a signup by id, checks `signup.user_id === user.user.id`, then sets:

```sql
UPDATE signups SET user_hidden_at = CURRENT_TIMESTAMP WHERE id = ?
```

Return `{ id, session_id, hidden: true }`.

- [x] **Step 4: Add relink service**

Add `relinkMySessionMembership(user, sessionId)` that:

- Finds the session or throws 404.
- Clears `sessions.organizer_hidden_at` when the user is the organizer.
- Clears `signups.user_hidden_at` for this user and session when matching signup rows exist.
- Throws 403 when neither organizer nor signup match exists.
- Returns `{ session_id, organizer_relinked, signup_relinked }`.

- [x] **Step 5: Run D16 to verify next RED**

Run:

```bash
node scripts/d16-session-membership-downlisting-check.js
```

Expected: FAIL with `server must import organizer hide service`.

Progress: completed.

## Task 4: Add API Routes

**Files:**
- Modify: `apps/api/src/server.js`

Progress: in progress.

- [x] **Step 1: Import services**

Add `hideMyOrganizedSession`, `hideMySignup`, and `relinkMySessionMembership` to the service imports.

- [x] **Step 2: Route organizer hide**

Add:

```js
const hideSessionId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/hide$/);
if (request.method === "PATCH" && hideSessionId) {
  const user = await getAuthUser(request);
  jsonResponse(response, 200, {
    ok: true,
    data: await hideMyOrganizedSession(user, hideSessionId)
  });
  return;
}
```

- [x] **Step 3: Route session relink**

Add:

```js
const relinkSessionId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/relink$/);
if (request.method === "PATCH" && relinkSessionId) {
  const user = await getAuthUser(request);
  jsonResponse(response, 200, {
    ok: true,
    data: await relinkMySessionMembership(user, relinkSessionId)
  });
  return;
}
```

- [x] **Step 4: Route signup hide**

Add:

```js
const hideSignupId = idMatch(url.pathname, /^\/api\/signups\/(\d+)\/hide$/);
if (request.method === "PATCH" && hideSignupId) {
  const user = await getAuthUser(request);
  jsonResponse(response, 200, {
    ok: true,
    data: await hideMySignup(user, hideSignupId)
  });
  return;
}
```

- [x] **Step 5: Run D16 to verify next RED**

Run:

```bash
node scripts/d16-session-membership-downlisting-check.js
```

Expected: FAIL with `Mine page must hide created sessions`.

Progress: completed.

## Task 5: Add Mine Page Downlist Actions

**Files:**
- Modify: `apps/miniprogram/src/pages/mine/index.vue`

Progress: in progress.

- [x] **Step 1: Add delete buttons**

For each created session item add a muted mini button:

```vue
<button class="mini-button danger-muted" @tap="hideOrganizedSession(session)">
  删除
</button>
```

For each joined signup item add:

```vue
<button class="mini-button danger-muted" @tap="hideJoinedSession(signup)">
  删除
</button>
```

- [x] **Step 2: Add confirm methods**

Add `confirmPersonalDownlist(content, onConfirm)` using `uni.showModal`.

- [x] **Step 3: Add organizer hide method**

Add `hideOrganizedSession(session)` that confirms:

```text
只会从你的列表下架，不会取消车，也不会影响其他车友。
```

Then calls:

```js
await request({ url: `/api/sessions/${session.id}/hide`, method: "PATCH" });
await loadMySessions();
```

- [x] **Step 4: Add joined hide method**

Add `hideJoinedSession(signup)` that confirms:

```text
只会从你的列表下架，不会影响这台车或其他车友。
```

Then calls:

```js
await request({ url: `/api/signups/${signup.id}/hide`, method: "PATCH" });
await loadMySignups();
```

- [x] **Step 5: Run D16 to verify next RED**

Run:

```bash
node scripts/d16-session-membership-downlisting-check.js
```

Expected: FAIL with `detail page must relink existing members`.

Progress: completed.

## Task 6: Relink From Shared Detail

**Files:**
- Modify: `apps/miniprogram/src/pages/session/detail.vue`

Progress: in progress.

- [x] **Step 1: Add relink method**

Add:

```js
async relinkSessionMembership() {
  if (!this.currentUserId || !this.sessionId || this.sessionId === "d1-demo") {
    return;
  }
  try {
    await request({
      url: `/api/sessions/${this.sessionId}/relink`,
      method: "PATCH"
    });
  } catch (error) {
    // Non-members cannot relink; detail viewing should continue.
  }
}
```

- [x] **Step 2: Call relink after user hydration**

Call `this.relinkSessionMembership()` from `onShow` after `hydrateUser()` and from `onLoad` after `hydrateUser()`.

- [x] **Step 3: Run D16 to verify GREEN**

Run:

```bash
node scripts/d16-session-membership-downlisting-check.js
```

Expected: PASS with `D16 session membership downlisting check passed`.

Progress: completed.

## Task 7: Full Verification

**Files:**
- Verify all changed files.

Progress: in progress.

- [x] **Step 1: Run syntax checks**

Run:

```bash
npm run check
```

Expected: all checks pass, including D16.

- [x] **Step 2: Review git diff**

Run:

```bash
git diff --stat
git diff -- scripts/d16-session-membership-downlisting-check.js apps/api/migrations/0012_session_membership_downlisting.sql apps/api/src/modules/core/service.js apps/api/src/server.js apps/miniprogram/src/pages/mine/index.vue apps/miniprogram/src/pages/session/detail.vue package.json
```

Expected: every changed hunk maps to this plan and spec.

Progress: completed.
