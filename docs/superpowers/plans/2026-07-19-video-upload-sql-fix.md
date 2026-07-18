# Video Upload SQL Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore production album-video creation after a successful direct COS upload and prove test artifacts are removed.

**Architecture:** Preserve the existing COS inspection, authorization, moderation, and database transaction flow. Correct only the malformed `session_album_photos` INSERT and lock the SQL shape with a focused regression assertion over the statement actually passed to the database connection.

**Tech Stack:** Node.js ESM, MySQL/mysql2 prepared statements, Node `node:test`, Tencent COS, UniApp mini-program, GitHub Actions.

---

### Task 1: Lock the malformed INSERT with a failing regression test

**Files:**
- Modify: `apps/api/test/content-moderation-video-integration.test.mjs`

- [x] **Step 1: Capture the SQL used by the direct fallback video test**

Add `let insertSql = "";` next to `insertValues`, and assign `insertSql = String(sql)` in the `INSERT INTO session_album_photos` branch.

- [x] **Step 2: Assert SQL and bind arity**

Add these assertions after video creation:

```js
const insertMatch = /INSERT INTO session_album_photos\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i.exec(insertSql);
assert.ok(insertMatch, "video INSERT must expose an explicit column and value list");
const insertColumns = insertMatch[1].split(",").map((value) => value.trim());
const insertExpressions = insertMatch[2].split(",").map((value) => value.trim());
assert.equal(insertExpressions.length, insertColumns.length);
assert.equal((insertSql.match(/\?/g) || []).length, insertValues.length);
```

- [x] **Step 3: Run the focused test and verify RED**

Run: `node --test apps/api/test/content-moderation-video-integration.test.mjs`

Expected: the direct fallback test fails because the value-expression count is 17 versus 18 columns, or the placeholder count is 14 versus 15 parameters.

### Task 2: Apply the minimal SQL correction

**Files:**
- Modify: `apps/api/src/modules/core/service.js`

- [x] **Step 1: Add the missing placeholder**

Change the video INSERT value list to:

```sql
VALUES (?, ?, 'video', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
```

- [x] **Step 2: Run the focused test and verify GREEN**

Run: `node --test apps/api/test/content-moderation-video-integration.test.mjs`

Expected: 16 tests pass with zero failures.

- [x] **Step 3: Run related server and D42 regression checks**

Run:

```bash
node scripts/d42-album-video-server-check.js
npm run d42:api-creation
npm run d42:api-lifecycle
npm run d42:api-delete
```

Expected: every command exits zero and reports no failed checks.

### Task 3: Publish and perform the production lifecycle test

**Files:**
- No additional source files.

- [ ] **Step 1: Commit only the plan, design, regression test, and SQL fix**

Run:

```bash
git add docs/superpowers/specs/2026-07-19-video-upload-sql-fix-design.md docs/superpowers/plans/2026-07-19-video-upload-sql-fix.md apps/api/test/content-moderation-video-integration.test.mjs apps/api/src/modules/core/service.js
git commit -m "fix: restore album video creation"
```

- [ ] **Step 2: Release through the guarded CI flow**

Promote the verified commit through `develop`, then `main`, then `publish`, waiting for each GitHub Actions stage to pass before the next promotion.

- [ ] **Step 3: Upload and delete the production test media**

Upload `/private/tmp/codex-video-upload-test-20260718.mp4` through the production mini-program, verify a video card appears, delete it through the UI, refresh, and confirm the original album media count is restored.

- [ ] **Step 4: Delete and verify the failed orphan object**

Delete `uploads/session-album/videos/source/admin-video-69-1-1784345723767-320c425c5ca5a0b9.mp4` using the configured COS storage adapter. HEAD the exact key and require `COS_OBJECT_NOT_FOUND`. Finally remove the local temporary MP4.
