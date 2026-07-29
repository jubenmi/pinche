# Business Time Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every confirmed-broken session business-time path use one Beijing-time contract while preserving the database schema, UTC storage, correct ISO behavior, and all existing correct records.

**Architecture:** Extend `@pinche/shared` with four pure Beijing-time helpers, normalize initial session creation at the API boundary, and adapt only the confirmed-broken client, notification, plugin, and Beijing-calendar query paths. Protect correct paths with characterization tests first; historical data support is a SELECT-only audit with no repair executor or migration.

**Tech Stack:** Node.js 24 ESM, Vue/uni-app, `@pinche/shared`, mysql2/MySQL 8.4, Node test runner, Docker Compose, Git submodule `packages/talk`.

---

## File map

### New focused files

- `apps/api/src/modules/core/session-create-time.js` — initial-create `startAt` normalization only.
- `apps/api/test/session-create-time.test.mjs` — API normalization contract.
- `apps/miniprogram/src/utils/sessionCreationTime.js` — creation-page defaults, wall value, transport value, and picker restore.
- `apps/miniprogram/test/sessionCreationTime.test.mjs` — device-timezone-independent creation tests.
- `packages/talk/api/business-time.js` — talk default pinned-message presentation built on the host-provided shared package.
- `packages/talk/test/business-time.test.mjs` — talk API time characterization.
- `apps/api/test/session-create-mysql-roundtrip.test.mjs` — real UTC MySQL write/read/JSON/display loop.
- `apps/api/src/modules/core/session-time-audit.js` — SELECT-only query and conservative evidence projection.
- `apps/api/test/session-time-audit.test.mjs` — proves the audit cannot classify uncertain rows or emit mutation SQL.
- `scripts/session-time-audit.mjs` — read-only CLI that prints JSON Lines.
- `scripts/business-time-smoke-contract.test.mjs` — prevents API smoke clients from stripping timezone information.

### Existing files modified by responsibility

- `packages/shared/src/beijingTime.js`, `packages/shared/test/beijingTime.test.mjs` — shared pure time contract.
- `apps/api/src/modules/core/service.js` — normalized create binding and Beijing discovery day key.
- `apps/miniprogram/src/pages/session/setup.vue`, `apps/admin-web/src/components/MiniProgramWorkspace.vue` — the two initial-create transports.
- `apps/miniprogram/src/pages/session/album.vue`, `apps/miniprogram/src/pages/admin/catalog.vue`, `apps/miniprogram/src/utils/authMessages.js`, `apps/miniprogram/src/extensions/session-pseudo-chat/ChatEntry.vue` — confirmed-broken presentation points.
- `apps/miniprogram/src/pages/session/detail.vue`, `apps/miniprogram/src/pages/session/share.vue`, `apps/miniprogram/src/utils/sessionShare.js` — reachable legacy lifecycle fallback while keeping server lifecycle authoritative.
- `apps/api/src/modules/wechat/subscribe-message.js` — signup subscription date.
- `apps/api/src/modules/content-moderation/admin-api.js`, `apps/api/src/modules/content-moderation/repository.js` — Beijing calendar filter to UTC range.
- `packages/talk/package.json`, `packages/talk/api/service.js`, `packages/talk/miniprogram/ChatEntry.vue` — plugin peer dependency and time presentation.
- `apps/api/test/content-moderation-admin-api.test.mjs`, `apps/api/test/content-moderation-repository.test.mjs`, `apps/api/test/subscribe-message-reschedule.test.mjs`, `apps/miniprogram/test/authMessages.test.mjs`, `apps/miniprogram/test/sessionShare.test.mjs` — focused regressions.
- `scripts/d38-city-session-discovery-smoke.js`, `scripts/d38-city-session-discovery-check.js`, `scripts/d47-beijing-time-check.js` — Beijing-midnight behavior and source contracts.
- `docker-compose.d51-test.yml`, `package.json`, `package-lock.json` — isolated real-MySQL target and verification commands; no application migration.

## Task 1: Extend the shared Beijing-time contract

> 进度：已完成（2026-07-29）。三种进程时区测试均通过，并已通过规格与代码质量审查。

**Files:**
- Modify: `packages/shared/test/beijingTime.test.mjs`
- Modify: `packages/shared/src/beijingTime.js`

- [x] **Step 1: Write failing tests for picker, short text, reached state, and UTC day range**

Add the four imports and the following tests:

```js
import {
  beijingDayUtcRange,
  businessDateTimeToPickerValue,
  formatBeijingShortDateTime,
  isBusinessDateTimeReached
} from "../src/beijingTime.js";

test("converts canonical and legacy values to Beijing picker values", () => {
  assert.deepEqual(businessDateTimeToPickerValue("2026-07-28T07:00:00.000Z"), {
    date: "2026-07-28",
    time: "15:00"
  });
  assert.deepEqual(businessDateTimeToPickerValue("2026-07-28 15:00:00"), {
    date: "2026-07-28",
    time: "15:00"
  });
  assert.equal(businessDateTimeToPickerValue("invalid"), null);
});

test("formats compact Beijing date time", () => {
  assert.equal(formatBeijingShortDateTime("2026-07-28T07:00:00.000Z"), "07-28 15:00");
  assert.equal(formatBeijingShortDateTime("invalid", ""), "");
});

test("compares business time without process-timezone parsing", () => {
  const now = Date.parse("2026-07-28T07:00:00.000Z");
  assert.equal(isBusinessDateTimeReached("2026-07-28T07:00:00.000Z", now), true);
  assert.equal(isBusinessDateTimeReached("2026-07-28 15:00:01", now), false);
  assert.equal(isBusinessDateTimeReached("invalid", now), false);
});

test("maps a Beijing calendar day to a UTC half-open range", () => {
  const range = beijingDayUtcRange("2026-07-29");
  assert.equal(range.start.toISOString(), "2026-07-28T16:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-07-29T16:00:00.000Z");
  assert.equal(beijingDayUtcRange("2026-02-30"), null);
});
```

- [x] **Step 2: Run the shared tests and verify RED**

Run: `npm --workspace packages/shared run test:time`

Expected: FAIL because the four exports do not exist.

- [x] **Step 3: Add the minimal pure helpers**

Append to `packages/shared/src/beijingTime.js`:

```js
const BEIJING_DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export function businessDateTimeToPickerValue(value) {
  const date = parseBusinessDateTime(value);
  if (!date) return null;
  return {
    date: beijingDateKey(date),
    time: beijingTimeText(date, "")
  };
}

export function formatBeijingShortDateTime(value, fallback = "时间待定") {
  const parts = beijingDateParts(value);
  return parts
    ? `${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`
    : fallback;
}

export function isBusinessDateTimeReached(value, now = Date.now()) {
  const date = parseBusinessDateTime(value);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  return Boolean(date && Number.isFinite(nowMs) && date.getTime() <= nowMs);
}

export function beijingDayUtcRange(value) {
  if (typeof value !== "string") return null;
  const key = value.trim();
  const start = parseBusinessDateTime(`${key} 00:00:00`);
  if (!start || beijingDateKey(start) !== key) return null;
  return {
    start,
    end: new Date(start.getTime() + BEIJING_DAY_MILLISECONDS)
  };
}
```

- [x] **Step 4: Run the shared tests in three process timezones**

Run:

```bash
TZ=Asia/Shanghai npm --workspace packages/shared run test:time
TZ=UTC npm --workspace packages/shared run test:time
TZ=America/New_York npm --workspace packages/shared run test:time
```

Expected: all tests PASS with identical assertions.

- [x] **Step 5: Commit the shared contract**

```bash
git add packages/shared/src/beijingTime.js packages/shared/test/beijingTime.test.mjs
git commit -m "feat(time): extend shared Beijing business time helpers"
```

## Task 2: Normalize initial creation at the API boundary

> 进度：已完成（2026-07-29）。创建归一化、幂等、改期和纠时测试均通过，并已通过规格与代码质量审查。

**Files:**
- Create: `apps/api/test/session-create-time.test.mjs`
- Create: `apps/api/src/modules/core/session-create-time.js`
- Modify: `apps/api/src/modules/core/service.js:61-70,3903-3953`

- [x] **Step 1: Write the failing normalization contract**

Create `apps/api/test/session-create-time.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSessionCreationStartAt } from "../src/modules/core/session-create-time.js";

test("normalizes explicit and legacy creation values to UTC second precision", () => {
  assert.equal(
    normalizeSessionCreationStartAt("2026-07-28T07:00:00.987Z").toISOString(),
    "2026-07-28T07:00:00.000Z"
  );
  assert.equal(
    normalizeSessionCreationStartAt("2026-07-28T15:00:00+08:00").toISOString(),
    "2026-07-28T07:00:00.000Z"
  );
  assert.equal(
    normalizeSessionCreationStartAt("2026-07-28 15:00:00").toISOString(),
    "2026-07-28T07:00:00.000Z"
  );
});

test("rejects missing and invalid creation values", () => {
  for (const value of [undefined, null, "", "2026-02-30 15:00:00", "not-a-date"]) {
    assert.throws(() => normalizeSessionCreationStartAt(value), {
      code: "INVALID_START_AT"
    });
  }
});
```

- [x] **Step 2: Run the test and verify RED**

Run: `node --test apps/api/test/session-create-time.test.mjs`

Expected: FAIL with module-not-found.

- [x] **Step 3: Implement the isolated normalizer**

Create `apps/api/src/modules/core/session-create-time.js`:

```js
import { parseBusinessDateTime } from "@pinche/shared";

function invalidStartAt() {
  return Object.assign(new Error("startAt must be a valid business date time"), {
    code: "INVALID_START_AT"
  });
}

export function normalizeSessionCreationStartAt(value) {
  const parsed = parseBusinessDateTime(value);
  if (!parsed) throw invalidStartAt();
  return new Date(Math.floor(parsed.getTime() / 1000) * 1000);
}
```

- [x] **Step 4: Wire the normalizer without changing reschedule or correction**

Import `normalizeSessionCreationStartAt` in `service.js`. Inside the `replaySessionCreation` callback, before the `INSERT`, calculate:

```js
let normalizedStartAt;
try {
  normalizedStartAt = normalizeSessionCreationStartAt(requireValue(body, "startAt"));
} catch (error) {
  if (error?.code === "INVALID_START_AT") throw badRequest(error.message);
  throw error;
}
```

Replace only the `sessions.start_at` bind argument:

```js
normalizedStartAt,
```

Do not change `session-reschedule.js`, `session-time-correction.js`, the MySQL configuration, or migrations.

- [x] **Step 5: Run focused API contracts**

Run:

```bash
node --test apps/api/test/session-create-time.test.mjs apps/api/test/session-creation-idempotency.test.mjs
npm --workspace apps/api run test:session-reschedule
npm --workspace apps/api run test:session-time-correction
```

Expected: all PASS.

- [x] **Step 6: Commit the API boundary**

```bash
git add apps/api/src/modules/core/session-create-time.js apps/api/src/modules/core/service.js apps/api/test/session-create-time.test.mjs
git commit -m "fix(api): normalize initial session start time"
```

## Task 3: Fix both creation clients and Beijing picker defaults

> 进度：已完成（2026-07-29）。两个创建入口均发送显式 UTC ISO，草稿仍保留北京时间语义；测试、构建和双重审查通过。

**Files:**
- Create: `apps/miniprogram/src/utils/sessionCreationTime.js`
- Create: `apps/miniprogram/test/sessionCreationTime.test.mjs`
- Modify: `apps/miniprogram/src/pages/session/setup.vue:156-225,240-355`
- Modify: `apps/admin-web/src/components/MiniProgramWorkspace.vue:650-757,915-916,1232-1236`

- [x] **Step 1: Write failing creation-page helper tests**

Create `apps/miniprogram/test/sessionCreationTime.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  sessionCreationDefaults,
  sessionCreationTransportStartAt,
  sessionCreationWallTime,
  sessionCreationPickerValue
} from "../src/utils/sessionCreationTime.js";

test("serializes Beijing wall time and restores the picker", () => {
  assert.equal(sessionCreationWallTime("2026-07-28", "15:00"), "2026-07-28 15:00:00");
  assert.equal(
    sessionCreationTransportStartAt("2026-07-28", "15:00"),
    "2026-07-28T07:00:00.000Z"
  );
  assert.deepEqual(sessionCreationPickerValue("2026-07-28T07:00:00.000Z"), {
    date: "2026-07-28",
    time: "15:00"
  });
});

test("uses the Beijing date around midnight independent of device timezone", () => {
  assert.deepEqual(sessionCreationDefaults(Date.parse("2026-07-28T16:30:00.000Z")), {
    today: "2026-07-29",
    date: "2026-07-30",
    time: "14:00"
  });
});

test("fails closed for invalid picker values", () => {
  assert.equal(sessionCreationTransportStartAt("2026-02-30", "15:00"), null);
  assert.equal(sessionCreationPickerValue("invalid"), null);
});
```

- [x] **Step 2: Run the helper test and verify RED**

Run: `node --test apps/miniprogram/test/sessionCreationTime.test.mjs`

Expected: FAIL with module-not-found.

- [x] **Step 3: Implement the creation helper**

Create `apps/miniprogram/src/utils/sessionCreationTime.js`:

```js
import {
  beijingDateKey,
  beijingWallTimeToIso,
  businessDateTimeToPickerValue
} from "@pinche/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

export function sessionCreationWallTime(date, time) {
  return `${String(date || "")} ${String(time || "")}:00`;
}

export function sessionCreationTransportStartAt(date, time) {
  return beijingWallTimeToIso(sessionCreationWallTime(date, time));
}

export function sessionCreationPickerValue(value) {
  return businessDateTimeToPickerValue(value);
}

export function sessionCreationDefaults(now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  return {
    today: beijingDateKey(new Date(nowMs)),
    date: beijingDateKey(new Date(nowMs + DAY_MS)),
    time: "14:00"
  };
}
```

- [x] **Step 4: Replace setup-page local date logic and request serialization**

Import the four helper functions. Remove `pad`, `dateText`, and `tomorrowAtDefaultTime`. Initialize `today`, `dateValue`, and `timeValue` from `sessionCreationDefaults()`.

Keep the draft value as wall time and add a transport computed property:

```js
startAt() {
  return sessionCreationWallTime(this.dateValue, this.timeValue);
},
transportStartAt() {
  return sessionCreationTransportStartAt(this.dateValue, this.timeValue);
},
```

Restore saved values with:

```js
const restored = sessionCreationPickerValue(flow.startAt);
if (restored) {
  this.dateValue = restored.date;
  this.timeValue = restored.time;
}
```

Require `transportStartAt` in `canSubmit`, and send:

```js
startAt: this.transportStartAt,
```

Continue persisting `this.startAt` so a draft retains Beijing wall-clock intent.

- [x] **Step 5: Fix the management-web creation transport only**

Add `beijingWallTimeToIso` to the existing `@pinche/shared` import. Keep the already-correct `defaultDate()` unchanged. Add:

```js
const transportStartAt = computed(() => beijingWallTimeToIso(startAt.value));
```

Require `transportStartAt.value` in `canCreate`, and pass:

```js
startAt: transportStartAt.value,
```

- [x] **Step 6: Run creation tests and builds**

Run:

```bash
TZ=UTC node --test apps/miniprogram/test/sessionCreationTime.test.mjs
TZ=America/New_York node --test apps/miniprogram/test/sessionCreationTime.test.mjs
npm run build:mp-weixin
npm run build:admin-web
```

Expected: all PASS.

- [x] **Step 7: Commit both client entries**

```bash
git add apps/miniprogram/src/utils/sessionCreationTime.js apps/miniprogram/test/sessionCreationTime.test.mjs apps/miniprogram/src/pages/session/setup.vue apps/admin-web/src/components/MiniProgramWorkspace.vue
git commit -m "fix(clients): serialize created sessions as UTC instants"
```

## Task 4: Fix confirmed-broken mini-program presentation paths

> 进度：已完成（2026-07-29）。四个确认错误的展示点已接入共享格式化，测试、构建和双重审查通过。

**Files:**
- Modify: `apps/miniprogram/test/authMessages.test.mjs`
- Modify: `apps/miniprogram/src/utils/authMessages.js`
- Modify: `apps/miniprogram/src/pages/session/album.vue:690-715,3603-3619`
- Modify: `apps/miniprogram/src/pages/admin/catalog.vue:1750-1820`
- Modify: `apps/miniprogram/src/extensions/session-pseudo-chat/ChatEntry.vue:105-115,403-407`

- [x] **Step 1: Change the pending-signup test to protect canonical ISO display**

Update the fixture and expected subtitle:

```js
start_at: "2026-07-28T07:00:00.000Z",
```

```js
subtitle: "山海店 / 2026-07-28 15:00",
```

- [x] **Step 2: Run the auth-message test and verify RED**

Run: `node --test apps/miniprogram/test/authMessages.test.mjs`

Expected: FAIL because the raw ISO value is displayed.

- [x] **Step 3: Reuse the existing correct reschedule formatter in auth messages**

Replace the pending subtitle time with:

```js
formatShanghaiTime(session.start_at, "时间待定")
```

Do not change the already-correct reschedule notification logic.

- [x] **Step 4: Replace album and mini-admin local formatting**

Add `formatBeijingDateTime` to each existing shared import and reduce the local functions to:

```js
formatDate(value) {
  return formatBeijingDateTime(value, "-");
}
```

For `pages/admin/catalog.vue`, replace its raw slice helper with:

```js
function formatDate(value) {
  return formatBeijingDateTime(value, "-");
}
```

- [x] **Step 5: Replace the application chat component formatter**

Import `formatBeijingShortDateTime` and replace `timeText` with:

```js
timeText(value) {
  return formatBeijingShortDateTime(value, "");
}
```

- [x] **Step 6: Run presentation tests and the mini build**

Run:

```bash
node --test apps/miniprogram/test/authMessages.test.mjs
npm --workspace apps/miniprogram run test:content-moderation
npm run build:mp-weixin
```

Expected: all PASS; generated chat and album output uses Beijing helpers.

- [x] **Step 7: Commit the mini-program presentation fixes**

```bash
git add apps/miniprogram/test/authMessages.test.mjs apps/miniprogram/src/utils/authMessages.js apps/miniprogram/src/pages/session/album.vue apps/miniprogram/src/pages/admin/catalog.vue apps/miniprogram/src/extensions/session-pseudo-chat/ChatEntry.vue
git commit -m "fix(miniprogram): format business timestamps in Beijing time"
```

## Task 5: Fix `talk` without duplicating timezone logic

> 进度：已完成（2026-07-29）。talk 已复用宿主共享组件，子模块与主工程提交、测试和双重审查均完成；尚未推送。

**Files in the `packages/talk` submodule:**
- Modify: `package.json`
- Create: `api/business-time.js`
- Create: `test/business-time.test.mjs`
- Modify: `api/service.js:1-70`
- Modify: `miniprogram/ChatEntry.vue:84-92,364-368`

**Superproject files:**
- Modify: `packages/talk` gitlink
- Modify if generated: `package-lock.json`

- [x] **Step 1: Create an isolated submodule branch**

Run from `packages/talk`:

```bash
git switch -c codex/business-time-consistency
```

Expected: branch starts at the superproject-pinned `bb043d9d` commit.

- [x] **Step 2: Write failing talk time tests**

Create `packages/talk/test/business-time.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultPinnedMessageForSession,
  formatTalkSessionDateTime
} from "../api/business-time.js";

test("formats talk session times in Beijing time", () => {
  assert.equal(
    formatTalkSessionDateTime(new Date("2026-07-28T07:00:00.000Z")),
    "2026-07-28 15:00"
  );
});

test("builds a Beijing-time default pinned message", () => {
  assert.equal(
    defaultPinnedMessageForSession({
      script_name_snapshot: "雾都",
      store_name_snapshot: "山海店",
      start_at: new Date("2026-07-28T07:00:00.000Z")
    }),
    "置顶：雾都 2026-07-28 15:00，山海店集合。"
  );
});
```

- [x] **Step 3: Run the talk test and verify RED**

Run from the superproject root: `node --test packages/talk/test/business-time.test.mjs`

Expected: FAIL with module-not-found.

- [x] **Step 4: Declare and consume the shared peer dependency**

Add to `packages/talk/package.json`:

```json
"peerDependencies": {
  "@pinche/shared": "*"
}
```

Create `packages/talk/api/business-time.js`:

```js
import { formatBeijingDateTime } from "@pinche/shared";

export function formatTalkSessionDateTime(value) {
  return formatBeijingDateTime(value, "时间待定");
}

export function defaultPinnedMessageForSession(session) {
  return `置顶：${session.script_name_snapshot} ${formatTalkSessionDateTime(
    session.start_at
  )}，${session.store_name_snapshot}集合。`;
}
```

Import `defaultPinnedMessageForSession` in `api/service.js` and delete the local UTC-slicing functions. Import `formatBeijingShortDateTime` in `miniprogram/ChatEntry.vue` and use it in `timeText`.

- [x] **Step 5: Run talk tests and commit the submodule**

Run:

```bash
npm --workspace @jubenmi/talk run test
git -C packages/talk add package.json api/business-time.js api/service.js miniprogram/ChatEntry.vue test/business-time.test.mjs
git -C packages/talk commit -m "fix(time): use host Beijing business time helpers"
```

Expected: talk tests PASS and the submodule has one new commit.

- [x] **Step 6: Refresh workspace metadata and commit the gitlink**

Run:

```bash
npm install --package-lock-only
git add packages/talk package-lock.json
git commit -m "chore(talk): pin Beijing time presentation fix"
```

If `package-lock.json` is byte-for-byte unchanged, stage only `packages/talk`. Do not push either repository in this task.

## Task 6: Fix signup subscription-message time

> 进度：已完成（2026-07-29）。报名消息复用现有上海时区格式化，测试和双重审查通过；改期消息未修改。

**Files:**
- Modify: `apps/api/test/subscribe-message-reschedule.test.mjs`
- Modify: `apps/api/src/modules/wechat/subscribe-message.js:43-78`

- [x] **Step 1: Add a failing signup formatter test**

Import `formatSessionSignupTime` and add:

```js
test("formats signup Date payloads in Asia/Shanghai", () => {
  assert.equal(
    formatSessionSignupTime(new Date("2026-07-28T07:00:00.000Z")),
    "2026-07-28 15:00:00"
  );
  assert.equal(formatSessionSignupTime("invalid"), "时间待定");
});
```

- [x] **Step 2: Run the subscription test and verify RED**

Run: `node --test apps/api/test/subscribe-message-reschedule.test.mjs`

Expected: FAIL because the export does not exist.

- [x] **Step 3: Route signup date4 through the existing correct formatter**

Add:

```js
export function formatSessionSignupTime(value, fallback = "时间待定") {
  return formatSessionRescheduleTime(value, fallback);
}
```

Replace the signup `date4` value with:

```js
date4: { value: formatSessionSignupTime(payload.startAt).slice(0, 20) },
```

Do not change `sessionTimeFormatter` or reschedule template fields because they already have correct `Asia/Shanghai` behavior.

- [x] **Step 4: Run subscription and access-token tests**

Run:

```bash
node --test apps/api/test/subscribe-message-reschedule.test.mjs apps/api/test/wechat-access-token.test.mjs
```

Expected: all PASS.

- [x] **Step 5: Commit the notification fix**

```bash
git add apps/api/test/subscribe-message-reschedule.test.mjs apps/api/src/modules/wechat/subscribe-message.js
git commit -m "fix(notifications): format signup time in Beijing time"
```

## Task 7: Unify reachable lifecycle fallback parsing

> 进度：已完成（2026-07-29）。历史无时区回退已统一，服务端精确布尔保持权威；三时区测试、构建和双重审查通过。
>
> 执行说明：现有 `sessionSharePage` 测试加载器会剥离 Vue import 并手工注入依赖；新增共享 helper 必须同步注入才能运行既有测试。允许仅修改该测试夹具，不改变测试期望或生产行为。
>
> 审查修正：详情页和管理端现已优先采用服务端精确布尔 `has_started`；仅在缺失时按 `start_at` 回退，并有冲突值测试保护。

**Files:**
- Modify: `apps/miniprogram/test/sessionShare.test.mjs`
- Modify: `apps/miniprogram/src/utils/sessionShare.js`
- Modify: `apps/miniprogram/src/pages/session/detail.vue:173,708-712`
- Modify: `apps/miniprogram/src/pages/session/share.vue:148,253-258,774-803`
- Modify: `apps/admin-web/src/components/MiniProgramWorkspace.vue:650-656,1076-1078,2184-2186`

- [x] **Step 1: Add legacy wall-time fallback characterization**

Add to `apps/miniprogram/test/sessionShare.test.mjs`:

```js
test("legacy Beijing wall time resolves independently of process timezone", () => {
  const now = Date.parse("2026-07-28T07:00:00.000Z");
  assert.equal(
    resolveSessionShareMode({ status: "locked", start_at: "2026-07-28 15:00:00" }, now),
    "claim"
  );
  assert.equal(
    resolveSessionShareMode({ status: "locked", start_at: "2026-07-28 15:00:01" }, now),
    "join"
  );
});
```

- [x] **Step 2: Run under a non-Beijing timezone and verify RED**

Run: `TZ=America/New_York node --test apps/miniprogram/test/sessionShare.test.mjs`

Expected: FAIL because raw `Date.parse` treats the legacy value as New York local time.

- [x] **Step 3: Replace only business-time lifecycle parsing**

Change `resolveSessionShareMode` to accept `now = Date.now()` as its optional second argument and use `isBusinessDateTimeReached(session.start_at, now)`. Existing callers remain compatible. Use `isBusinessDateTimeReached` in detail and the two admin helpers. In `share.vue`, use:

```js
const startAt = parseBusinessDateTime(this.session.start_at);
const startAtMs = startAt?.getTime();
```

for timer scheduling, and `isBusinessDateTimeReached` for boolean started checks. Keep an exact server `has_started` value authoritative.

- [x] **Step 4: Run lifecycle tests in three timezones**

Run:

```bash
TZ=Asia/Shanghai npm run unified-share:unit
TZ=UTC npm run unified-share:unit
TZ=America/New_York npm run unified-share:unit
```

Expected: all PASS; explicit ISO behavior remains unchanged.

- [x] **Step 5: Commit lifecycle compatibility**

```bash
git add apps/miniprogram/test/sessionShare.test.mjs apps/miniprogram/src/utils/sessionShare.js apps/miniprogram/src/pages/session/detail.vue apps/miniprogram/src/pages/session/share.vue apps/admin-web/src/components/MiniProgramWorkspace.vue
git commit -m "fix(time): parse lifecycle fallback with business time contract"
```

## Task 8: Convert Beijing moderation dates to UTC query bounds

> 进度：已完成（2026-07-29）。筛选已使用 UTC 半开区间，无法转换的边界明确返回 400；测试和双重审查通过。
>
> 审查修正：任何通过文本校验但无法转换为 UTC 区间的日期必须返回 400，不能静默移除筛选条件；同时补充单边区间测试。

**Files:**
- Modify: `apps/api/test/content-moderation-admin-api.test.mjs`
- Modify: `apps/api/test/content-moderation-repository.test.mjs`
- Modify: `apps/api/src/modules/content-moderation/admin-api.js:178-215`
- Modify: `apps/api/src/modules/content-moderation/repository.js:1407-1419`

- [x] **Step 1: Write failing DTO boundary expectations**

Change the canonical filter assertion to expect:

```js
dateFrom: new Date("2026-06-30T16:00:00.000Z"),
dateToExclusive: new Date("2026-07-31T16:00:00.000Z"),
```

The empty-query assertion must contain both keys with `undefined` values.

In the repository test, assert the SQL contains:

```js
"job.created_at >= ?"
"job.created_at < ?"
```

and that bound values are `Date` objects with the two exact ISO values. Assert the SQL does not contain `DATE_ADD(?, INTERVAL 1 DAY)`.

- [x] **Step 2: Run the two tests and verify RED**

Run:

```bash
node --test apps/api/test/content-moderation-admin-api.test.mjs apps/api/test/content-moderation-repository.test.mjs
```

Expected: FAIL on string dates and the old `DATE_ADD` SQL.

- [x] **Step 3: Normalize calendar keys in the admin DTO**

Import `beijingDayUtcRange`. After validating `dateFrom <= dateTo`, calculate:

```js
const fromRange = dateFrom ? beijingDayUtcRange(dateFrom) : null;
const toRange = dateTo ? beijingDayUtcRange(dateTo) : null;
```

Return:

```js
dateFrom: fromRange?.start,
dateToExclusive: toRange?.end,
```

The existing calendar validation remains the first line of defense.

- [x] **Step 4: Bind the UTC half-open range in the repository**

Rename the repository option to `dateToExclusive` and use:

```js
if (dateFrom) {
  where.push("job.created_at >= ?");
  values.push(dateFrom);
}
if (dateToExclusive) {
  where.push("job.created_at < ?");
  values.push(dateToExclusive);
}
```

- [x] **Step 5: Run the moderation suite**

Run:

```bash
node --test apps/api/test/content-moderation-admin-api.test.mjs apps/api/test/content-moderation-repository.test.mjs
npm run d45:unit
```

Expected: all PASS.

- [x] **Step 6: Commit the filter boundary**

```bash
git add apps/api/test/content-moderation-admin-api.test.mjs apps/api/test/content-moderation-repository.test.mjs apps/api/src/modules/content-moderation/admin-api.js apps/api/src/modules/content-moderation/repository.js
git commit -m "fix(admin): filter moderation jobs by Beijing calendar day"
```

## Task 9: Order city discovery by Beijing calendar day

> 进度：已完成（2026-07-29）。北京跨午夜排序键与隔离烟测已完成，静态/语法检查和双重审查通过。
>
> 审查修正：跨午夜烟测使用本次运行唯一城市并单独查询，避免复用测试库时被历史样本挤出结果上限；静态检查精确限定到目标函数。

**Files:**
- Modify: `apps/api/src/modules/core/service.js:4390-4405`
- Modify: `scripts/d38-city-session-discovery-check.js`
- Modify: `scripts/d38-city-session-discovery-smoke.js`

- [x] **Step 1: Add a failing source contract**

In `scripts/d38-city-session-discovery-check.js`, require:

```js
assert(
  discoveryService.includes("DATE(DATE_ADD(session.start_at, INTERVAL 8 HOUR)) ASC"),
  "city discovery should group results by Beijing calendar date"
);
```

- [x] **Step 2: Run the static check and verify RED**

Run: `node scripts/d38-city-session-discovery-check.js`

Expected: FAIL because the query uses `DATE(session.start_at)`.

- [x] **Step 3: Change only the city date ordering expression**

Replace:

```sql
DATE(session.start_at) ASC,
```

with:

```sql
DATE(DATE_ADD(session.start_at, INTERVAL 8 HOUR)) ASC,
```

Keep `session.start_at > CURRENT_TIMESTAMP`, distance order, exact start time order, and ID tie-break unchanged.

- [x] **Step 4: Add an isolated Beijing-midnight smoke pair**

Extend the D38 smoke fixture with two public sessions whose UTC values are `15:30:00Z` and `16:30:00Z` on the same UTC day, corresponding to Beijing 23:30 and next-day 00:30. Give the later Beijing day a shorter distance:

```js
const beijingBoundaryDay = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
beijingBoundaryDay.setUTCHours(15, 30, 0, 0);
const beijingLateDay = await createSession(
  organizer,
  farStore,
  script,
  "beijing-late-day",
  { startAt: beijingBoundaryDay.toISOString() }
);
const beijingNextDay = await createSession(
  organizer,
  nearStore,
  script,
  "beijing-next-day",
  { startAt: new Date(beijingBoundaryDay.getTime() + 60 * 60 * 1000).toISOString() }
);
```

After loading `cityRows`, assert:

```js
const beijingLateDayIndex = cityRows.findIndex(
  (row) => Number(row.id) === Number(beijingLateDay.session.id)
);
const beijingNextDayIndex = cityRows.findIndex(
  (row) => Number(row.id) === Number(beijingNextDay.session.id)
);
assert(
  beijingLateDayIndex >= 0 &&
    beijingNextDayIndex >= 0 &&
    beijingLateDayIndex < beijingNextDayIndex,
  "Beijing calendar day should sort before distance across midnight"
);
```

Use the existing session/store fixture helpers and cleanup registration; do not add production calls.

- [x] **Step 5: Run D38 checks**

Run:

```bash
node scripts/d38-city-session-discovery-check.js
node --check scripts/d38-city-session-discovery-smoke.js
```

Expected: PASS. The live smoke remains reserved for the isolated test environment.

- [x] **Step 6: Commit the Beijing-day ordering**

```bash
git add apps/api/src/modules/core/service.js scripts/d38-city-session-discovery-check.js scripts/d38-city-session-discovery-smoke.js
git commit -m "fix(discovery): group sessions by Beijing calendar day"
```

## Task 10: Add the real MySQL UTC round trip

> 进度：已完成（2026-07-29）。真实 MySQL 闭环与加强后的隔离守卫均通过，隔离容器、网络和卷已清理。
>
> 审查修正：测试在连接前同时校验隔离标记、非生产环境、`MYSQL_HOST=mysql` 与 `MYSQL_DATABASE=pinche_d51_test`，避免单一标记误连其他数据库。

**Files:**
- Create: `apps/api/test/session-create-mysql-roundtrip.test.mjs`
- Modify: `docker-compose.d51-test.yml`
- Modify: `package.json`

- [x] **Step 1: Write a fail-closed real-MySQL test**

Create `apps/api/test/session-create-mysql-roundtrip.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { formatBeijingDateTime } from "@pinche/shared";
import { withDatabaseConnection } from "../src/db/mysql.js";
import { normalizeSessionCreationStartAt } from "../src/modules/core/session-create-time.js";

test("creation wall time survives a UTC DATETIME round trip", async () => {
  assert.equal(process.env.D51_INTEGRATION_ISOLATED, "1");
  await withDatabaseConnection(async (connection) => {
    await connection.query(
      "CREATE TEMPORARY TABLE business_time_roundtrip (start_at DATETIME NOT NULL)"
    );
    const normalized = normalizeSessionCreationStartAt("2026-07-28 15:00:00");
    await connection.query(
      "INSERT INTO business_time_roundtrip (start_at) VALUES (?)",
      [normalized]
    );
    const [rows] = await connection.query(
      "SELECT start_at FROM business_time_roundtrip LIMIT 1"
    );
    assert.equal(rows[0].start_at instanceof Date, true);
    assert.equal(rows[0].start_at.toISOString(), "2026-07-28T07:00:00.000Z");
    assert.equal(
      JSON.parse(JSON.stringify(rows[0])).start_at,
      "2026-07-28T07:00:00.000Z"
    );
    assert.equal(formatBeijingDateTime(rows[0].start_at), "2026-07-28 15:00");
  });
});
```

- [x] **Step 2: Add an isolated Compose test service**

Add `business_time_acceptance` using `*api-image`, `*api-environment`, working directory `/app/apps/api`, and:

```yaml
entrypoint: ["node", "--test"]
command: ["test/session-create-mysql-roundtrip.test.mjs"]
environment:
  <<: *api-environment
  D51_INTEGRATION_ISOLATED: "1"
depends_on:
  migrate:
    condition: service_completed_successfully
  mysql:
    condition: service_healthy
restart: "no"
```

- [x] **Step 3: Add an explicit root command**

Add this `package.json` script as one line:

```json
"test:business-time-mysql": "docker compose -f docker-compose.d51-test.yml --project-name pinche-business-time-test up --build --abort-on-container-exit --exit-code-from business_time_acceptance business_time_acceptance"
```

- [x] **Step 4: Run the real database test**

Run: `npm run test:business-time-mysql`

Expected: MySQL and migrate start in the isolated Compose network; the one test PASSes. The temporary table disappears with the connection. No production database is contacted.

- [x] **Step 5: Clean the isolated Compose project**

Run: `docker compose -f docker-compose.d51-test.yml --project-name pinche-business-time-test down --volumes`

Expected: isolated containers, network, and volumes are removed.

- [x] **Step 6: Commit the integration contract**

```bash
git add apps/api/test/session-create-mysql-roundtrip.test.mjs docker-compose.d51-test.yml package.json
git commit -m "test(time): cover UTC MySQL creation round trip"
```

## Task 11: Add a SELECT-only historical audit

> 进度：已完成（2026-07-29）。只读审计、保守分类与安全检查完成并通过双重审查；未运行 CLI、未连接数据库。

**Files:**
- Create: `apps/api/test/session-time-audit.test.mjs`
- Create: `apps/api/src/modules/core/session-time-audit.js`
- Create: `scripts/session-time-audit.mjs`
- Modify: `package.json`

- [x] **Step 1: Write conservative audit tests**

Create `apps/api/test/session-time-audit.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_TIME_AUDIT_QUERY,
  projectSessionTimeAuditRow
} from "../src/modules/core/session-time-audit.js";

test("audit SQL is SELECT-only", () => {
  assert.match(SESSION_TIME_AUDIT_QUERY.trim(), /^SELECT\b/i);
  assert.doesNotMatch(
    SESSION_TIME_AUDIT_QUERY,
    /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|TRUNCATE|CREATE)\b/i
  );
});

test("an exact latest correction is evidence of a correct current value", () => {
  const report = projectSessionTimeAuditRow({
    id: 42,
    start_at: new Date("2026-07-28T07:00:00.000Z"),
    corrected_start_at: new Date("2026-07-28T07:00:00.000Z"),
    correction_id: 9,
    created_at: new Date("2026-07-20T01:00:00.000Z"),
    updated_at: new Date("2026-07-28T01:00:00.000Z")
  });
  assert.equal(report.classification, "evidence_correct");
  assert.equal(report.current_beijing, "2026-07-28 15:00");
});

test("rows without provenance remain indeterminate", () => {
  const report = projectSessionTimeAuditRow({
    id: 43,
    start_at: new Date("2026-07-28T15:00:00.000Z"),
    correction_id: null,
    corrected_start_at: null
  });
  assert.equal(report.classification, "indeterminate");
  assert.equal(report.suggested_update, undefined);
});
```

- [x] **Step 2: Run the audit test and verify RED**

Run: `node --test apps/api/test/session-time-audit.test.mjs`

Expected: FAIL with module-not-found.

- [x] **Step 3: Implement the query and projection without an update path**

Create `apps/api/src/modules/core/session-time-audit.js` with a `SELECT` that reads sessions and the latest correction via a correlated maximum correction ID. Export a projector with this decision rule:

```js
import { formatBeijingDateTime, parseBusinessDateTime } from "@pinche/shared";

export const SESSION_TIME_AUDIT_QUERY = `
  SELECT session.id, session.start_at, session.created_at, session.updated_at,
         correction.id AS correction_id,
         correction.new_start_at AS corrected_start_at,
         correction.created_at AS correction_created_at
  FROM sessions session
  LEFT JOIN session_start_time_corrections correction
    ON correction.id = (
      SELECT MAX(candidate.id)
      FROM session_start_time_corrections candidate
      WHERE candidate.session_id = session.id
    )
  ORDER BY session.id DESC
  LIMIT ?
`;

export function projectSessionTimeAuditRow(row) {
  const current = parseBusinessDateTime(row.start_at);
  const corrected = parseBusinessDateTime(row.corrected_start_at);
  const correctionMatches = Boolean(
    row.correction_id && current && corrected && current.getTime() === corrected.getTime()
  );
  return {
    session_id: Number(row.id),
    current_utc: current?.toISOString() || null,
    current_beijing: formatBeijingDateTime(row.start_at, "时间无效"),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    correction_id: row.correction_id ? Number(row.correction_id) : null,
    correction_created_at: row.correction_created_at || null,
    classification: correctionMatches ? "evidence_correct" : "indeterminate"
  };
}
```

Do not add a function that emits SQL, subtracts eight hours, or labels a row `evidence_wrong` from database digits alone.

- [x] **Step 4: Add the read-only CLI**

Create `scripts/session-time-audit.mjs`:

```js
import { withDatabaseConnection } from "../apps/api/src/db/mysql.js";
import {
  SESSION_TIME_AUDIT_QUERY,
  projectSessionTimeAuditRow
} from "../apps/api/src/modules/core/session-time-audit.js";

function parseLimit(args) {
  const option = args.find((value) => value.startsWith("--limit="));
  if (!option) return 200;
  const raw = option.slice("--limit=".length);
  if (!/^\d+$/.test(raw)) throw new Error("--limit must be an integer from 1 to 1000");
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("--limit must be an integer from 1 to 1000");
  }
  return limit;
}

const unsupported = process.argv.slice(2).find(
  (value) => !value.startsWith("--limit=")
);
if (unsupported) throw new Error(`unsupported option: ${unsupported}`);

const limit = parseLimit(process.argv.slice(2));
await withDatabaseConnection(async (connection) => {
  const [rows] = await connection.query(SESSION_TIME_AUDIT_QUERY, [limit]);
  for (const row of rows) {
    process.stdout.write(`${JSON.stringify(projectSessionTimeAuditRow(row))}\n`);
  }
});
```

It has no `--apply`, `--fix`, or output SQL path.

Add:

```json
"audit:session-time": "node scripts/session-time-audit.mjs"
```

- [x] **Step 5: Test source safety without connecting to production**

Run:

```bash
node --test apps/api/test/session-time-audit.test.mjs
node --check scripts/session-time-audit.mjs
```

Expected: PASS. Do not run the CLI against any external database during implementation.

- [x] **Step 6: Commit the read-only audit**

```bash
git add apps/api/test/session-time-audit.test.mjs apps/api/src/modules/core/session-time-audit.js scripts/session-time-audit.mjs package.json
git commit -m "feat(time): add read-only session time audit"
```

## Task 12: Make smoke clients send explicit ISO timestamps

> 进度：已完成（2026-07-29）。16 个烟测客户端均保留显式 ISO 时区，源码合同、语法检查和双重审查通过。

**Files:**
- Create: `scripts/business-time-smoke-contract.test.mjs`
- Modify: `scripts/d2-smoke-test.js`
- Modify: `scripts/d4-smoke-test.js`
- Modify: `scripts/d5-smoke-test.js`
- Modify: `scripts/d6-smoke-test.js`
- Modify: `scripts/d7-smoke-test.js`
- Modify: `scripts/d8-qa-check.js`
- Modify: `scripts/d10-pseudo-chat-smoke.js`
- Modify: `scripts/d18-session-album-privacy-smoke.js`
- Modify: `scripts/d23-album-share-join-policy-smoke.js`
- Modify: `scripts/d30-current-signup-role-check.js`
- Modify: `scripts/d32-admin-album-video-smoke.js`
- Modify: `scripts/d34-store-location-smoke.js`
- Modify: `scripts/d38-city-session-discovery-smoke.js`
- Modify: `scripts/d40-guest-calendar-home-smoke.js`
- Modify: `scripts/d46-author-private-content-api-smoke.js`
- Modify: `scripts/d53-album-four-action-selection-smoke.js`

- [x] **Step 1: Write a failing smoke-client contract**

Create `scripts/business-time-smoke-contract.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = [
  "d2-smoke-test.js",
  "d4-smoke-test.js",
  "d5-smoke-test.js",
  "d6-smoke-test.js",
  "d7-smoke-test.js",
  "d8-qa-check.js",
  "d10-pseudo-chat-smoke.js",
  "d18-session-album-privacy-smoke.js",
  "d23-album-share-join-policy-smoke.js",
  "d30-current-signup-role-check.js",
  "d32-admin-album-video-smoke.js",
  "d34-store-location-smoke.js",
  "d38-city-session-discovery-smoke.js",
  "d40-guest-calendar-home-smoke.js",
  "d46-author-private-content-api-smoke.js",
  "d53-album-four-action-selection-smoke.js"
];

test("API smoke clients retain the timezone on generated startAt values", async () => {
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /toISOString\(\)[\s\S]{0,80}slice\(0,\s*19\)[\s\S]{0,80}replace\(["']T["'],\s*["'] ["']\)/,
      file
    );
  }
});
```

- [x] **Step 2: Run the contract and verify RED**

Run: `node --test scripts/business-time-smoke-contract.test.mjs`

Expected: FAIL on the first helper that strips `Z`.

- [x] **Step 3: Preserve explicit ISO in every API startAt fixture**

For each listed helper, replace this pattern:

```js
return new Date(targetMilliseconds)
  .toISOString()
  .slice(0, 19)
  .replace("T", " ");
```

with:

```js
return new Date(targetMilliseconds).toISOString();
```

For `startAtDay`, retain the UTC calendar setup and return `value.toISOString()`. Change only values sent as API `startAt`; leave diagnostic `checkedAt`, database cursor keys, and unrelated formatting untouched.

- [x] **Step 4: Run source syntax and contract checks**

Run:

```bash
node --test scripts/business-time-smoke-contract.test.mjs
node --check scripts/d2-smoke-test.js
node --check scripts/d4-smoke-test.js
node --check scripts/d5-smoke-test.js
node --check scripts/d6-smoke-test.js
node --check scripts/d7-smoke-test.js
node --check scripts/d8-qa-check.js
node --check scripts/d10-pseudo-chat-smoke.js
node --check scripts/d18-session-album-privacy-smoke.js
node --check scripts/d23-album-share-join-policy-smoke.js
node --check scripts/d30-current-signup-role-check.js
node --check scripts/d32-admin-album-video-smoke.js
node --check scripts/d34-store-location-smoke.js
node --check scripts/d38-city-session-discovery-smoke.js
node --check scripts/d40-guest-calendar-home-smoke.js
node --check scripts/d46-author-private-content-api-smoke.js
node --check scripts/d53-album-four-action-selection-smoke.js
```

Expected: all PASS.

- [x] **Step 5: Commit the test-client correction**

```bash
git add scripts/business-time-smoke-contract.test.mjs scripts/d2-smoke-test.js scripts/d4-smoke-test.js scripts/d5-smoke-test.js scripts/d6-smoke-test.js scripts/d7-smoke-test.js scripts/d8-qa-check.js scripts/d10-pseudo-chat-smoke.js scripts/d18-session-album-privacy-smoke.js scripts/d23-album-share-join-policy-smoke.js scripts/d30-current-signup-role-check.js scripts/d32-admin-album-video-smoke.js scripts/d34-store-location-smoke.js scripts/d38-city-session-discovery-smoke.js scripts/d40-guest-calendar-home-smoke.js scripts/d46-author-private-content-api-smoke.js scripts/d53-album-four-action-selection-smoke.js
git commit -m "test(time): keep timezone on smoke session inputs"
```

## Task 13: Expand source contracts and run the complete verification matrix

> 进度：已完成（2026-07-29）。全仓合同、三时区矩阵、真实 MySQL、构建、迁移与数据库安全验收全部通过。
>
> 执行说明：完整矩阵发现 D45 报名消息源码契约仍要求旧的 `valueOrFallback` 路径。允许仅同步该断言到已批准的 `formatSessionSignupTime`，不改变生产行为或其他 D45 合同。
>
> 审查修正：D47 的小程序默认日期与草稿恢复断言限定到 `data()`/`onLoad()` 可执行区域，talk 置顶检查限定到函数体，避免 import 误满足或跨函数误报。

**Files:**
- Modify: `scripts/d47-beijing-time-check.js`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-07-28-business-time-consistency-design.md` only if implementation revealed a factual correction; do not rewrite approved scope.

- [x] **Step 1: Make D47 cover every confirmed-broken path**

Read these additional sources in `scripts/d47-beijing-time-check.js`:

```js
apps/miniprogram/src/pages/session/setup.vue
apps/miniprogram/src/pages/session/album.vue
apps/miniprogram/src/pages/admin/catalog.vue
apps/miniprogram/src/utils/authMessages.js
apps/miniprogram/src/extensions/session-pseudo-chat/ChatEntry.vue
apps/admin-web/src/components/MiniProgramWorkspace.vue
apps/api/src/modules/core/service.js
apps/api/src/modules/core/session-create-time.js
apps/api/src/modules/wechat/subscribe-message.js
apps/api/src/modules/content-moderation/admin-api.js
apps/api/src/modules/content-moderation/repository.js
packages/talk/api/business-time.js
packages/talk/miniprogram/ChatEntry.vue
```

Add positive assertions for the named shared helpers and normalized `Date` binding. Add scoped negative assertions proving the target formatters no longer contain `toISOString().slice`, `String(value).slice(5, 16)`, local `getHours`, or raw `requireValue(body, "startAt")` in the INSERT values. Do not globally ban `Date.parse`, local getters, or ISO slicing in expiry, cache, build, and operational code.

- [x] **Step 2: Add one root verification command**

Add:

```json
"business-time:verify": "npm --workspace packages/shared run test:time && node --test apps/api/test/session-create-time.test.mjs apps/api/test/session-time-audit.test.mjs apps/api/test/subscribe-message-reschedule.test.mjs apps/api/test/content-moderation-admin-api.test.mjs apps/api/test/content-moderation-repository.test.mjs apps/miniprogram/test/sessionCreationTime.test.mjs apps/miniprogram/test/authMessages.test.mjs apps/miniprogram/test/sessionShare.test.mjs scripts/business-time-smoke-contract.test.mjs && node scripts/d47-beijing-time-check.js && node scripts/d38-city-session-discovery-check.js && npm --workspace apps/api run test:mysql-timezone && npm run session-reschedule:verify && npm run session-time-correction:verify && npm --workspace @jubenmi/talk run test"
```

- [x] **Step 3: Run the cross-timezone focused matrix**

Run:

```bash
TZ=Asia/Shanghai npm run business-time:verify
TZ=UTC npm run business-time:verify
TZ=America/New_York npm run business-time:verify
```

Expected: all commands PASS.

- [x] **Step 4: Run real MySQL, builds, and repository checks**

Run:

```bash
npm run test:business-time-mysql
npm run build:mp-weixin
npm run build:admin-web
npm run check:fast
npm run d45:unit
npm run unified-share:unit
git diff origin/develop -- apps/api/migrations
```

Expected: all tests and builds PASS; the migration diff is empty.

- [x] **Step 5: Inspect scope and database safety**

Run:

```bash
git status --short
git diff --check origin/develop...HEAD
git diff --stat origin/develop...HEAD
rg -n "\b(?:UPDATE|DELETE|INSERT|ALTER|DROP|TRUNCATE|CREATE)\b" scripts/session-time-audit.mjs apps/api/src/modules/core/session-time-audit.js
```

Expected: only planned files are changed; diff check is clean; the only SQL mutation match permitted in the audit test is the negative-regex test itself, while the audit implementation contains none.

- [x] **Step 6: Commit verification wiring**

```bash
git add scripts/d47-beijing-time-check.js package.json package-lock.json
git commit -m "test(time): enforce business time consistency contract"
```

- [x] **Step 7: Final review against the approved specification**

Confirm all of the following in the handoff:

- Picker 15:00 -> request 07:00Z -> UTC DATETIME 07:00 -> JSON 07:00Z -> target views 15:00.
- Correct explicit ISO behavior, reschedule, correction, MySQL UTC, `CURRENT_TIMESTAMP`, expiry, lease, and cleanup tests remain green.
- No migration or production data write was added or executed.
- Every audited point is recorded as fixed-and-tested or correct-and-untouched.
- The `packages/talk` gitlink commit exists locally and must be published before any superproject branch that references it is pushed.

## Final whole-branch review corrections

> 进度：已完成（2026-07-29）。整分支审查发现的三个跨任务合同缺口已按原设计补齐，完整验证与最终复审均已通过。

- [x] 初次创建在 `startAt` 归一化成功前不得执行 `ensureRole` 或其他业务写语句，并增加连接调用顺序测试。
- [x] 报名/改期订阅消息的时间拆分改为基于 `@pinche/shared`，移除独立 `Intl.DateTimeFormat` 时区内核。
- [x] 只读历史审计补充可用的通知证据与跨北京日期影响字段，仍保持 SELECT-only、保守分类和无修复路径。
- [x] 三项修正完成独立规格/质量复审，并重新运行三时区、真实 MySQL、构建与数据库安全验收。
