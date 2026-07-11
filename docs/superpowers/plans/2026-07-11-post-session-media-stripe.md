# Post-Session Media Stripe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an ended session's calendar stripe wine red until its album contains an effective photo or video, then turn the stripe green.

**Architecture:** Add one pure mini-program decision helper for the three stripe tones and one API SQL-expression helper for the shared effective-media count. Both organizer and participant list queries return `album_media_count`; `SessionCalendar.vue` passes that value plus the existing failed/post-start predicates to the pure decision helper. No schema or persisted outcome state is added.

**Tech Stack:** Node.js 20 ES modules, UniApp/Vue 3, MySQL 8 SQL, repository-style Node assertion checks.

---

Design reference: `docs/superpowers/specs/2026-07-11-post-session-media-stripe-design.md`

## File map

- Create `apps/miniprogram/src/utils/sessionCalendarStripe.js`: pure, framework-free stripe-tone decision.
- Create `apps/api/src/modules/core/session-album-media-count.js`: safe shared SQL expression for counting effective album media.
- Create `scripts/d43-post-session-media-stripe-check.js`: executable behavioral and source-integration regression check.
- Modify `apps/api/src/modules/core/service.js`: expose the shared media count from organizer and participant list queries.
- Modify `apps/miniprogram/src/components/SessionCalendar.vue`: delegate the stripe decision to the pure helper.
- Modify `package.json`: register the D43 check in the normal repository check command.

### Task 1: Lock the three-color decision in a pure helper

**Files:**
- Create: `scripts/d43-post-session-media-stripe-check.js`
- Create: `apps/miniprogram/src/utils/sessionCalendarStripe.js`

- [ ] **Step 1: Write the failing stripe-decision check**

Create `scripts/d43-post-session-media-stripe-check.js` with:

```js
import assert from "node:assert/strict";

import { sessionCalendarStripeTone } from "../apps/miniprogram/src/utils/sessionCalendarStripe.js";

const stripeCases = [
  {
    name: "future session stays amber without media",
    input: { failed: false, postStart: false, albumMediaCount: 0 },
    expected: "amber"
  },
  {
    name: "future session stays amber even if media already exists",
    input: { failed: false, postStart: false, albumMediaCount: 1 },
    expected: "amber"
  },
  {
    name: "ended session without media is red",
    input: { failed: false, postStart: true, albumMediaCount: 0 },
    expected: "red"
  },
  {
    name: "ended session with media is green",
    input: { failed: false, postStart: true, albumMediaCount: 1 },
    expected: "green"
  },
  {
    name: "missing media count is treated as zero",
    input: { failed: false, postStart: true },
    expected: "red"
  },
  {
    name: "cancelled or rejected state wins over media",
    input: { failed: true, postStart: true, albumMediaCount: 9 },
    expected: "red"
  }
];

for (const testCase of stripeCases) {
  assert.equal(
    sessionCalendarStripeTone(testCase.input),
    testCase.expected,
    testCase.name
  );
}

console.log("D43 post-session media stripe checks passed");
```

- [ ] **Step 2: Run the check and verify RED**

Run:

```bash
node scripts/d43-post-session-media-stripe-check.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `sessionCalendarStripe.js`.

- [ ] **Step 3: Implement the minimal pure decision helper**

Create `apps/miniprogram/src/utils/sessionCalendarStripe.js` with:

```js
function positiveMediaCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export function sessionCalendarStripeTone({
  failed = false,
  postStart = false,
  albumMediaCount = 0
} = {}) {
  if (failed) {
    return "red";
  }
  if (!postStart) {
    return "amber";
  }
  return positiveMediaCount(albumMediaCount) > 0 ? "green" : "red";
}
```

- [ ] **Step 4: Run the check and verify GREEN**

Run:

```bash
node scripts/d43-post-session-media-stripe-check.js
```

Expected: PASS with `D43 post-session media stripe checks passed`.

- [ ] **Step 5: Commit the isolated decision helper**

```bash
git add scripts/d43-post-session-media-stripe-check.js apps/miniprogram/src/utils/sessionCalendarStripe.js
git commit -m "test: define post-session stripe colors"
```

### Task 2: Return one effective-media count from both member list APIs

**Files:**
- Create: `apps/api/src/modules/core/session-album-media-count.js`
- Modify: `apps/api/src/modules/core/service.js:1-12,3651-3696,5006-5051`
- Modify: `scripts/d43-post-session-media-stripe-check.js`

- [ ] **Step 1: Extend the check with the missing API count contract**

Add these imports at the top of `scripts/d43-post-session-media-stripe-check.js`:

```js
import { readFileSync } from "node:fs";

import { albumMediaCountSql } from "../apps/api/src/modules/core/session-album-media-count.js";
```

Add these assertions before the final `console.log`:

```js
const expectedAlbumMediaCountSql =
  "COUNT(DISTINCT CASE WHEN album_media.status = 'active' " +
  "AND (album_media.media_type = 'image' OR " +
  "(album_media.media_type = 'video' AND album_media.processing_status <> 'failed')) " +
  "THEN album_media.id END)";

assert.equal(albumMediaCountSql("album_media"), expectedAlbumMediaCountSql);
assert.throws(
  () => albumMediaCountSql("album media"),
  /safe SQL identifier/,
  "SQL aliases must not allow injected syntax"
);

const serviceSource = readFileSync(
  new URL("../apps/api/src/modules/core/service.js", import.meta.url),
  "utf8"
);
assert(
  serviceSource.includes('${albumMediaCountSql("album_photo")} AS album_media_count'),
  "listMySessions must select album_media_count"
);
assert(
  serviceSource.includes('SELECT ${albumMediaCountSql("album_media")}'),
  "listMySignups must select album_media_count"
);
assert(
  serviceSource.match(/album_media_count: Number\(row\.album_media_count \|\| 0\)/g)?.length >= 2,
  "both list responses must normalize album_media_count to a number"
);
```

- [ ] **Step 2: Run the check and verify RED**

Run:

```bash
node scripts/d43-post-session-media-stripe-check.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `session-album-media-count.js`.

- [ ] **Step 3: Implement the shared SQL expression**

Create `apps/api/src/modules/core/session-album-media-count.js` with:

```js
const SAFE_SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function albumMediaCountSql(alias) {
  const tableAlias = String(alias || "").trim();
  if (!SAFE_SQL_IDENTIFIER.test(tableAlias)) {
    throw new TypeError("album media alias must be a safe SQL identifier");
  }
  return (
    `COUNT(DISTINCT CASE WHEN ${tableAlias}.status = 'active' ` +
    `AND (${tableAlias}.media_type = 'image' OR ` +
    `(${tableAlias}.media_type = 'video' AND ${tableAlias}.processing_status <> 'failed')) ` +
    `THEN ${tableAlias}.id END)`
  );
}
```

- [ ] **Step 4: Use the count expression in both API list queries**

Add this import to `apps/api/src/modules/core/service.js`:

```js
import { albumMediaCountSql } from "./session-album-media-count.js";
```

In `listMySessions`, extend the selected counts and normalize the returned field:

```js
COUNT(DISTINCT album_photo.id) AS active_album_photo_count,
COUNT(DISTINCT album_photo.id) AS photo_count,
${albumMediaCountSql("album_photo")} AS album_media_count
```

```js
return rows.map((row) => ({
  ...row,
  album_media_count: Number(row.album_media_count || 0)
}));
```

In `listMySignups`, insert this correlated count after `has_review` and before `can_review`:

```js
(
  SELECT ${albumMediaCountSql("album_media")}
  FROM session_album_photos album_media
  WHERE album_media.session_id = signup.session_id
) AS album_media_count,
```

Extend the existing response mapping with:

```js
album_media_count: Number(row.album_media_count || 0),
```

Keep `active_album_photo_count` and `photo_count` unchanged because existing cancellation and album flows consume them.

- [ ] **Step 5: Run the D43 check and verify GREEN**

Run:

```bash
node scripts/d43-post-session-media-stripe-check.js
```

Expected: PASS with `D43 post-session media stripe checks passed`.

- [ ] **Step 6: Run the API syntax check**

Run:

```bash
npm --workspace apps/api run check
```

Expected: PASS with `API JavaScript syntax checks passed`.

- [ ] **Step 7: Commit the API count contract**

```bash
git add apps/api/src/modules/core/session-album-media-count.js apps/api/src/modules/core/service.js scripts/d43-post-session-media-stripe-check.js
git commit -m "feat: expose effective album media counts"
```

### Task 3: Wire the calendar stripe and run repository verification

**Files:**
- Modify: `apps/miniprogram/src/components/SessionCalendar.vue:218-230,931-978`
- Modify: `scripts/d43-post-session-media-stripe-check.js`
- Modify: `package.json:13-44`

- [ ] **Step 1: Extend the check with the missing Vue wiring contract**

Add these assertions before the final `console.log` in `scripts/d43-post-session-media-stripe-check.js`:

```js
const calendarSource = readFileSync(
  new URL("../apps/miniprogram/src/components/SessionCalendar.vue", import.meta.url),
  "utf8"
);
assert(
  calendarSource.includes(
    'import { sessionCalendarStripeTone } from "../utils/sessionCalendarStripe";'
  ),
  "SessionCalendar must import the pure stripe helper"
);
for (const token of [
  "return sessionCalendarStripeTone({",
  "failed: calendarItemFailed(item)",
  "postStart: isCalendarItemPostStart(item)",
  "albumMediaCount: item.raw?.album_media_count"
]) {
  assert(calendarSource.includes(token), `SessionCalendar stripe wiring must include: ${token}`);
}
assert(
  !calendarSource.includes('if (isCalendarItemPostStart(item)) {\n    return "green";'),
  "post-start sessions must no longer become green unconditionally"
);
```

- [ ] **Step 2: Run the check and verify RED**

Run:

```bash
node scripts/d43-post-session-media-stripe-check.js
```

Expected: FAIL with `SessionCalendar must import the pure stripe helper`.

- [ ] **Step 3: Delegate the existing stripe method to the pure helper**

Add this import in the `SessionCalendar.vue` script block:

```js
import { sessionCalendarStripeTone } from "../utils/sessionCalendarStripe";
```

Replace `calendarStripeTone` with:

```js
function calendarStripeTone(item) {
  return sessionCalendarStripeTone({
    failed: calendarItemFailed(item),
    postStart: isCalendarItemPostStart(item),
    albumMediaCount: item.raw?.album_media_count
  });
}
```

Do not change `statusTone`, `calendarItemStatusText`, `calendarAlbumCtaNote`, or the existing CSS colors.

- [ ] **Step 4: Run the D43 check and verify GREEN**

Run:

```bash
node scripts/d43-post-session-media-stripe-check.js
```

Expected: PASS with `D43 post-session media stripe checks passed`.

- [ ] **Step 5: Register the D43 regression check**

Add this exact script entry to `package.json`:

```json
"d43:check": "node scripts/d43-post-session-media-stripe-check.js"
```

Append this exact suffix to the current root `scripts.check` string:

```text
 && npm run d43:check
```

- [ ] **Step 6: Build the WeChat mini-program**

Run:

```bash
npm run build:mp-weixin
```

Expected: exit code 0 and a completed `mp-weixin` production build.

- [ ] **Step 7: Run targeted regressions**

Run:

```bash
npm run d43:check
npm --workspace apps/api run check
node scripts/check-miniprogram.js
```

Expected: all three commands exit 0; D43, API syntax, and mini-program source checks report success.

- [ ] **Step 8: Run the full repository check**

Run:

```bash
npm run check
```

Expected: exit code 0 with the existing suite plus `D43 post-session media stripe checks passed`.

- [ ] **Step 9: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` prints nothing; status lists only the intended D43 implementation files.

- [ ] **Step 10: Commit the calendar integration**

```bash
git add apps/miniprogram/src/components/SessionCalendar.vue scripts/d43-post-session-media-stripe-check.js package.json
git commit -m "feat: mark ended sessions red until media exists"
```
