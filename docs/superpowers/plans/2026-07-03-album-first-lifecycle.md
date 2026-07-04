# Album-First Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both the mini-program and web mini-program treat the album as the primary action after a session starts, while keeping the user-facing model to only "before start" and "started".

**Architecture:** Keep the backend and album permissions unchanged. Add a small static regression check, then implement the lifecycle as front-end derived display logic from `start_at`, with content counts only changing copy and button labels. Use the existing detail, mine, review, and album routes.

**Tech Stack:** UniApp/Vue mini-program pages, Vue admin-web mini-program workspace, Node.js static check scripts.

---

### Task 1: Add Album-First Lifecycle Static Check

**Files:**
- Create: `scripts/d20-album-first-lifecycle-check.js`
- Modify: `package.json`

- [x] **Step 1: Write the failing static check**

Create `scripts/d20-album-first-lifecycle-check.js` with assertions that require:

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

const spec = read("docs/superpowers/specs/2026-07-03-album-first-lifecycle-design.md");
assert(spec.includes("用户主路径只理解两个阶段"), "spec must keep the two-stage user model");
assert(!spec.includes("24h"), "spec must not reintroduce a 24h memory transition");

const mine = read("apps/miniprogram/src/pages/mine/index.vue");
for (const token of [
  "isCalendarItemPostStart",
  "calendarPrimaryActionLabel",
  "calendarSecondaryActionLabel",
  "goAlbum",
  "回看相册",
  "已发车 · 相册开放"
]) {
  assert(mine.includes(token), `mini-program mine page must include ${token}`);
}

const detail = read("apps/miniprogram/src/pages/session/detail.vue");
for (const token of [
  "isPostStart",
  "post-start-album-card",
  "相册已开放",
  "albumPrimaryText",
  "打开相册"
]) {
  assert(detail.includes(token), `mini-program detail page must include ${token}`);
}

const webMini = read("apps/admin-web/src/components/MiniProgramWorkspace.vue");
for (const token of [
  "isPostStartSession",
  "sessionLifecycleLabel",
  "webAlbumPrimaryActionLabel",
  "打开相册",
  "已发车 · 相册开放"
]) {
  assert(webMini.includes(token), `web mini-program must include ${token}`);
}
```

- [x] **Step 2: Run the static check and verify RED**

Run: `node scripts/d20-album-first-lifecycle-check.js`

Expected: FAIL with a missing lifecycle helper such as `mini-program mine page must include isCalendarItemPostStart`.

- [x] **Step 3: Register the check conservatively**

Add `&& node scripts/d20-album-first-lifecycle-check.js` to the root `package.json` `check` script after `d19-npc-role-tags-check.js`, preserving the existing uncommitted check additions.

### Task 2: Implement Mini-Program Lifecycle Actions

**Files:**
- Modify: `apps/miniprogram/src/pages/mine/index.vue`
- Modify: `apps/miniprogram/src/pages/session/detail.vue`

- [x] **Step 1: Update the mine page action model**

Add helpers near the existing calendar normalization functions:

```js
function isStartedAt(startAt) {
  const startDate = parseStartAt(startAt);
  return Boolean(startDate && startDate.getTime() <= Date.now());
}

function hasAlbumContent(source) {
  return Number(source.visible_photo_count || source.photo_count || source.review_count || 0) > 0 || Boolean(source.has_review);
}

function calendarPrimaryActionLabel(item) {
  if (!isCalendarItemPostStart(item)) {
    return item.type === "organized" ? "管理" : item.canReview ? item.hasReview ? "编辑记录" : "写记录" : "详情";
  }
  return hasAlbumContent(item.raw) ? "回看相册" : "打开相册";
}

function calendarSecondaryActionLabel(item) {
  if (!isCalendarItemPostStart(item)) {
    return "";
  }
  return item.canReview ? item.hasReview ? "编辑记录" : "写记录" : "";
}
```

Normalize created and joined rows with `phaseText`, `actionLabel`, `secondaryActionLabel`, and `hasReview`, then route the primary action to `goAlbum` when `isCalendarItemPostStart(item)` is true.

- [x] **Step 2: Update the detail page first action**

Make the detail header show a post-start album card when `isPostStart` is true, and make `打开相册` the primary action after `start_at`.

- [x] **Step 3: Run syntax checks for mini-program files**

Run: `node --check scripts/check-miniprogram.js`

Expected: PASS syntax check for the static checker script itself. Then run `node scripts/d20-album-first-lifecycle-check.js` and expect remaining failures only for web mini-program tokens until Task 3 is complete.

Result: `node --check scripts/check-miniprogram.js` passed. `npm --workspace apps/miniprogram run build:mp-weixin` passed with unrelated Sass deprecation warnings. Full `node scripts/check-miniprogram.js` is blocked by the existing `apps/miniprogram/.env.development` local API URL, not by lifecycle code.

### Task 3: Implement Web Mini-Program Lifecycle Actions

**Files:**
- Modify: `apps/admin-web/src/components/MiniProgramWorkspace.vue`

- [x] **Step 1: Add web lifecycle helpers**

Add helpers near `isAlbumOpenForSession`:

```js
function isPostStartSession(session) {
  return isAlbumOpenForSession(session) && session?.status !== "cancelled";
}

function sessionLifecycleLabel(session) {
  if (session?.status === "cancelled") {
    return "已取消";
  }
  return isPostStartSession(session) ? "已发车" : sessionStatusLabel(session?.status);
}

function webAlbumPrimaryActionLabel(session) {
  const count = Number(session?.visible_photo_count || session?.photo_count || session?.review_count || 0);
  return count > 0 ? "回看相册" : "打开相册";
}
```

- [x] **Step 2: Update web mine and detail actions**

For started rows, show `打开相册`/`回看相册` before detail/manage/share actions. In detail, show the album action before share/role/manage actions when `isPostStartSession(detailSession)` is true.

- [x] **Step 3: Run the lifecycle static check**

Run: `node scripts/d20-album-first-lifecycle-check.js`

Expected: PASS.

### Task 4: Final Verification

**Files:**
- Test: `scripts/d20-album-first-lifecycle-check.js`
- Test: `scripts/check-miniprogram.js`
- Test: `scripts/d12-admin-web-check.js`

- [x] **Step 1: Run focused checks**

Run:

```bash
node scripts/d20-album-first-lifecycle-check.js
node scripts/check-miniprogram.js
node scripts/d12-admin-web-check.js
```

Expected: all pass.

Result: `node scripts/d20-album-first-lifecycle-check.js`, `node scripts/d12-admin-web-check.js`, `npm --workspace apps/admin-web run build`, and `npm --workspace apps/miniprogram run build:mp-weixin` passed. `node scripts/check-miniprogram.js` remains blocked by the pre-existing `.env.development` local API URL.

- [x] **Step 2: Review staged diff**

Run: `git diff -- scripts/d20-album-first-lifecycle-check.js apps/miniprogram/src/pages/mine/index.vue apps/miniprogram/src/pages/session/detail.vue apps/admin-web/src/components/MiniProgramWorkspace.vue package.json`

Expected: changes map only to album-first lifecycle behavior and the static check.

### Task 5: Strengthen Mini-Program Album Prominence

**Files:**
- Modify: `scripts/d20-album-first-lifecycle-check.js`
- Modify: `apps/miniprogram/src/components/SessionCalendar.vue`
- Modify: `apps/miniprogram/src/pages/session/detail.vue`
- Modify: `apps/miniprogram/src/pages/session/album.vue`

- [x] **Step 1: Extend the static check for the approved prominence pass**

Add assertions that require:

- post-start calendar rows to carry an album-first visual state and CTA text.
- post-start detail to show album stats and stronger upload/revisit copy.
- the album empty state to include a direct `上传第一张照片` action.

Result: `node scripts/d20-album-first-lifecycle-check.js` failed first on missing `albumFirst`, then passed after implementation.

- [x] **Step 2: Implement the mini-program UI hierarchy changes**

Keep the existing two-stage lifecycle and specific-session album model. Do not add a top-level album tab, public album feed, backend state, or privacy model change.

- [x] **Step 3: Run focused verification**

Run:

```bash
node scripts/d20-album-first-lifecycle-check.js
node --check scripts/check-miniprogram.js
npm --workspace apps/miniprogram run build:mp-weixin
```

Expected: focused lifecycle check and mini-program build pass. If the full miniprogram check remains blocked by local `.env.development`, document it instead of changing environment policy.

Result: all three focused commands passed on 2026-07-04. The build still prints existing `uv-waterfall` Sass deprecation warnings.
