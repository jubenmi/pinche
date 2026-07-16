# Beijing Time Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every user-visible and business-calendar time in the project use `Asia/Shanghai` while preserving UTC for storage and API transport.

**Architecture:** Add one environment-independent time contract to `@pinche/shared`. Small-program and admin UI code consume it for parsing, formatting, date keys, and wall-time conversion; the API makes MySQL UTC handling explicit at the connection boundary. Existing absolute timestamps remain unchanged.

**Tech Stack:** Node.js ESM, Vue 3, uni-app/WeChat Mini Program, mysql2, Node test runner.

---

### Task 1: Add the shared Beijing-time contract

**Files:**
- Create: `packages/shared/src/beijingTime.js`
- Modify: `packages/shared/src/index.js`
- Create: `packages/shared/test/beijingTime.test.mjs`
- Modify: `packages/shared/package.json`

- [ ] **Step 1: Write failing shared time tests**

Cover absolute ISO values, explicit offsets, legacy no-zone database values, cross-midnight date keys, invalid values, and Beijing wall-time conversion:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  BEIJING_TIME_ZONE,
  beijingDateKey,
  beijingTimeText,
  formatBeijingDateTime,
  parseBusinessDateTime,
  beijingWallTimeToIso
} from "../src/beijingTime.js";

test("formats absolute timestamps in Beijing time", () => {
  assert.equal(BEIJING_TIME_ZONE, "Asia/Shanghai");
  assert.equal(formatBeijingDateTime("2026-07-18T05:00:00.000Z"), "2026-07-18 13:00");
  assert.equal(formatBeijingDateTime("2026-07-18T13:00:00+08:00"), "2026-07-18 13:00");
  assert.equal(formatBeijingDateTime("2026-07-18T01:00:00-04:00"), "2026-07-18 13:00");
});

test("treats legacy timezone-free timestamps as Beijing wall time", () => {
  assert.equal(parseBusinessDateTime("2026-07-18 13:00:00").toISOString(), "2026-07-18T05:00:00.000Z");
});

test("uses Beijing calendar parts independent of process timezone", () => {
  assert.equal(beijingDateKey("2026-07-17T16:30:00.000Z"), "2026-07-18");
  assert.equal(beijingTimeText("2026-07-18T05:00:00.000Z"), "13:00");
});

test("converts Beijing wall input to UTC transport", () => {
  assert.equal(beijingWallTimeToIso("2026-07-18 13:00"), "2026-07-18T05:00:00.000Z");
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test packages/shared/test/beijingTime.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/beijingTime.js`.

- [ ] **Step 3: Implement the shared module**

Implement a full-string parser that checks an explicit timezone before legacy wall time. Use a fixed `+08:00` only for legacy no-zone input, and use `Intl.DateTimeFormat(..., { timeZone: "Asia/Shanghai" })` for output parts. Return `null` for invalid parse functions and stable fallback labels for display functions.

Required exports:

```js
export const BEIJING_TIME_ZONE = "Asia/Shanghai";
export function parseBusinessDateTime(value) {}
export function beijingDateParts(value) {}
export function formatBeijingDateTime(value, fallback = "时间待定") {}
export function beijingDateKey(value) {}
export function beijingTimeText(value, fallback = "时间待定") {}
export function beijingWallTimeToIso(value) {}
```

Re-export these from `packages/shared/src/index.js`, and add `test:time` to `packages/shared/package.json`.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `TZ=America/New_York node --test packages/shared/test/beijingTime.test.mjs`

Expected: all tests pass, proving no dependence on the process timezone.

- [ ] **Step 5: Commit the shared contract**

```bash
git add packages/shared/src/beijingTime.js packages/shared/src/index.js packages/shared/test/beijingTime.test.mjs packages/shared/package.json
git commit -m "feat: add shared Beijing time contract"
```

### Task 2: Replace mini-program local-time parsing

**Files:**
- Modify: `apps/miniprogram/src/utils/sessionReschedule.js`
- Modify: `apps/miniprogram/src/components/SessionCalendar.vue`
- Modify: `apps/miniprogram/src/pages/session/detail.vue`
- Modify: `apps/miniprogram/src/pages/session/share.vue`
- Modify: `apps/miniprogram/test/sessionReschedule.test.mjs`
- Create: `scripts/d47-beijing-time-check.js`

- [ ] **Step 1: Add failing mini-program regression assertions**

Extend `sessionReschedule.test.mjs` so `formatSessionStartAt("2026-07-18T05:00:00Z")` equals `2026-07-18 13:00`, and create `d47-beijing-time-check.js` to assert:

```js
assert.match(calendarSource, /@pinche\/shared/);
assert.doesNotMatch(calendarSource, /function parseStartAt\(/);
assert.doesNotMatch(calendarSource, /date\.getHours\(\)/);
assert.match(detailSource, /formatBeijingDateTime/);
assert.match(shareSource, /formatBeijingDateTime/);
```

- [ ] **Step 2: Run the check and verify RED**

Run: `node scripts/d47-beijing-time-check.js`

Expected: FAIL because `SessionCalendar.vue` still has `parseStartAt()` and device-local getters.

- [ ] **Step 3: Integrate the shared functions**

In `sessionReschedule.js`, replace its private parser/formatter with imports from `@pinche/shared`, while preserving public function names:

```js
import { formatBeijingDateTime, parseBusinessDateTime, beijingWallTimeToIso } from "@pinche/shared";

export const parseSessionStartAt = parseBusinessDateTime;
export function formatSessionStartAt(value) {
  return formatBeijingDateTime(value);
}
```

Use `beijingWallTimeToIso()` for picker wall-time submission.

In `SessionCalendar.vue`, import `parseBusinessDateTime`, `beijingDateKey`, and `beijingTimeText`. Remove the local `parseStartAt`, `dateKey`, and `timeText` implementations, and ensure day grouping uses Beijing keys rather than device-local getters.

In detail/share pages, replace raw interpolation and `.slice(0, 16)` with `formatBeijingDateTime()`.

- [ ] **Step 4: Run mini-program tests and build**

Run: `node --test apps/miniprogram/test/sessionReschedule.test.mjs apps/miniprogram/test/authMessages.test.mjs`

Expected: 22 or more tests pass, 0 fail.

Run: `node scripts/d47-beijing-time-check.js`

Expected: PASS.

Run: `npm run build:mp-weixin`

Expected: build exits 0.

- [ ] **Step 5: Commit mini-program integration**

```bash
git add apps/miniprogram/src/utils/sessionReschedule.js apps/miniprogram/src/components/SessionCalendar.vue apps/miniprogram/src/pages/session/detail.vue apps/miniprogram/src/pages/session/share.vue apps/miniprogram/test/sessionReschedule.test.mjs scripts/d47-beijing-time-check.js
git commit -m "fix: render mini-program times in Beijing time"
```

### Task 3: Replace admin-web duplicate time parsing

**Files:**
- Modify: `apps/admin-web/src/App.vue`
- Modify: `apps/admin-web/src/components/CatalogWorkspace.vue`
- Modify: `apps/admin-web/src/components/MiniProgramWorkspace.vue`
- Modify: `apps/admin-web/src/components/SessionAlbumWorkspace.vue`
- Modify: `scripts/d47-beijing-time-check.js`

- [ ] **Step 1: Extend the failing source contract**

Add assertions that admin files import shared Beijing formatters, `MiniProgramWorkspace.vue` has no `parseMineStartAt`, and no targeted formatter uses device-local calendar getters for business dates.

- [ ] **Step 2: Run the source contract and verify RED**

Run: `node scripts/d47-beijing-time-check.js`

Expected: FAIL on `parseMineStartAt` and duplicate `formatShanghaiDate` implementations.

- [ ] **Step 3: Replace duplicates with shared functions**

Import shared helpers from `@pinche/shared`. Replace `parseMineStartAt`, `formatShanghaiDate`, and direct `Intl.DateTimeFormat` duplicates. Preserve each component's existing fallback (`"-"`, `"无"`, or original text) by passing it to the shared formatter.

For preview calendar grouping, use `beijingDateKey()` and shared parts instead of `getDate()`, `getHours()`, and `getDay()` on device-local dates.

- [ ] **Step 4: Run admin tests and build**

Run: `node scripts/d47-beijing-time-check.js`

Expected: PASS.

Run: `npm --workspace apps/admin-web run test:runtime-config`

Expected: all tests pass.

Run: `npm run build:admin-web`

Expected: build exits 0.

- [ ] **Step 5: Commit admin integration**

```bash
git add apps/admin-web/src/App.vue apps/admin-web/src/components/CatalogWorkspace.vue apps/admin-web/src/components/MiniProgramWorkspace.vue apps/admin-web/src/components/SessionAlbumWorkspace.vue scripts/d47-beijing-time-check.js
git commit -m "fix: render admin times in Beijing time"
```

### Task 4: Make the API/MySQL UTC boundary explicit

**Files:**
- Modify: `apps/api/src/db/mysql.js`
- Create: `apps/api/test/mysql-timezone.test.mjs`
- Modify: `apps/api/package.json`
- Modify: `scripts/d47-beijing-time-check.js`

- [ ] **Step 1: Write failing MySQL boundary tests**

Test that connection options contain `timezone: "Z"` and that `configureConnectionTimeZone()` executes exactly `SET time_zone = '+00:00'` against a fake connection.

```js
test("configures driver and MySQL session for UTC", async () => {
  assert.equal(databaseConnectionOptions().timezone, "Z");
  const calls = [];
  await configureConnectionTimeZone({ query: async (sql) => calls.push(sql) });
  assert.deepEqual(calls, ["SET time_zone = '+00:00'"]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test apps/api/test/mysql-timezone.test.mjs`

Expected: FAIL because `configureConnectionTimeZone` and UTC options do not exist.

- [ ] **Step 3: Configure every created connection**

Add `timezone: "Z"` to `serverConnectionOptions()`. Export `configureConnectionTimeZone(connection)`, call it immediately after both server and database connections are created, and close/rethrow if session configuration fails.

- [ ] **Step 4: Run API tests**

Run: `node --test apps/api/test/mysql-timezone.test.mjs`

Expected: PASS.

Run: `npm --workspace apps/api run test:session-reschedule`

Expected: 22 tests pass, 0 fail.

- [ ] **Step 5: Commit the API boundary**

```bash
git add apps/api/src/db/mysql.js apps/api/test/mysql-timezone.test.mjs apps/api/package.json scripts/d47-beijing-time-check.js
git commit -m "fix: make API database timezone explicit"
```

### Task 5: Full verification and developer-tools acceptance

**Files:**
- Modify: `package.json`
- Modify: `docs/superpowers/plans/2026-07-17-beijing-time.md`

- [ ] **Step 1: Add the time checks to the root check command**

Add `npm --workspace packages/shared run test:time` and `node scripts/d47-beijing-time-check.js` near the start of the root `check` script.

- [ ] **Step 2: Run the complete automated verification**

Run: `TZ=America/New_York npm run check`

Expected: exit 0 with no failed tests or checks.

- [ ] **Step 3: Refresh WeChat Developer Tools**

Run: `node scripts/devtools-refresh-hook.js`

Open the mini-program calendar and the “野菩萨” management page. Verify both show `2026-07-18 13:00`, and the calendar card shows `13:00`, never `05:00`.

- [ ] **Step 4: Check the final diff and preserve unrelated files**

Run: `git status --short` and `git diff --check`.

Expected: only planned files are modified; the main worktree's existing `docs/evidence/` remains untouched.

- [ ] **Step 5: Commit verification wiring**

```bash
git add package.json docs/superpowers/plans/2026-07-17-beijing-time.md
git commit -m "test: enforce Beijing time consistency"
```
