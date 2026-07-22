# D52 历史车局时间纠错 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让当前车头把已经过去的错误开本时间修正为另一个过去时间，同时保留追加式审计且不触发普通改期副作用。

**Architecture:** 未来改期继续走现有 `/reschedule`；历史纠错新增 `/start-time-corrections`，在一个事务内锁定车局、使用数据库时间重验生命周期、更新 `sessions.start_at` 并追加审计。小程序管理页使用独立纯 helper 和 picker 状态，在“改期”与“纠正时间”之间互斥展示。

**Tech Stack:** Node.js ESM、`node:test`、MySQL 8 / mysql2、UniApp Vue、TDesign 小程序组件。

---

## 文件结构

- Create: `apps/api/migrations/0033_session_start_time_corrections.sql` — 追加式时间纠错审计表。
- Create: `apps/api/src/modules/core/session-time-correction.js` — 服务端 ISO 时间解析、秒级归一化与过去时间校验。
- Create: `apps/api/test/session-time-correction.test.mjs` — 服务端纯 helper 单元测试。
- Create: `apps/api/test/session-time-correction-service.test.mjs` — 权限、生命周期、更新与审计事务测试。
- Modify: `apps/api/src/modules/core/service.js` — 历史纠错事务服务。
- Modify: `apps/api/src/server.js` — 独立 HTTP 路由。
- Modify: `apps/api/src/db/mysql.js` — readiness 必需表。
- Modify: `apps/api/package.json` — D52 API 定向测试命令。
- Create: `apps/miniprogram/src/utils/sessionTimeCorrection.js` — 端侧入口判断、选择校验、确认和错误文案。
- Create: `apps/miniprogram/test/sessionTimeCorrection.test.mjs` — 小程序纯 helper 单元测试。
- Modify: `apps/miniprogram/src/pages/session/manage.vue` — 历史纠错入口、picker、确认和提交。
- Create: `scripts/d52-session-history-time-correction-check.js` — 跨层静态契约。
- Modify: `package.json` — D52 定向验证与根回归接线。
- Modify: `specs/d52-session-history-time-correction/tasks.md` — 实时勾选与验证记录。

### Task 1: 建立服务端时间边界的 RED/GREEN 循环

> 进度：已完成；纯 helper 已按预期红灯并以 3/3 单测转绿。

**Files:**
- Create: `apps/api/test/session-time-correction.test.mjs`
- Create: `apps/api/src/modules/core/session-time-correction.js`

- [x] **Step 1: 写纯 helper 失败测试**

创建测试，覆盖合法时区、秒级精度、缺时区、非法日期、未来目标和相同时间：

```js
import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSessionTimeCorrectionStartAt } from "../src/modules/core/session-time-correction.js";

const NOW = new Date("2026-07-22T08:00:00.500Z");
const CURRENT = new Date("2026-06-20T10:30:00.000Z");

test("normalizes a past explicit-offset timestamp to MySQL second precision", () => {
  assert.deepEqual(
    normalizeSessionTimeCorrectionStartAt("2026-06-20T19:30:45.987+08:00", CURRENT, NOW),
    {
      date: new Date("2026-06-20T11:30:45.000Z"),
      canonical: "2026-06-20T11:30:45.000Z"
    }
  );
});

test("rejects missing timezone, invalid calendar values, and invalid offsets", () => {
  for (const value of [
    "2026-06-20T19:30:00",
    "2026-02-30T19:30:00+08:00",
    "2026-06-20T19:30:00+14:01"
  ]) {
    assert.throws(
      () => normalizeSessionTimeCorrectionStartAt(value, CURRENT, NOW),
      { code: "INVALID_START_AT" }
    );
  }
});

test("rejects a target that is not past and a second-precision no-op", () => {
  assert.throws(
    () => normalizeSessionTimeCorrectionStartAt("2026-07-22T08:00:00.500Z", CURRENT, NOW),
    { code: "CORRECTION_START_AT_NOT_PAST" }
  );
  assert.throws(
    () => normalizeSessionTimeCorrectionStartAt("2026-06-20T10:30:00.999Z", CURRENT, NOW),
    { code: "UNCHANGED_START_AT" }
  );
});
```

- [x] **Step 2: 运行测试并确认按预期失败**

Run: `node --test apps/api/test/session-time-correction.test.mjs`

Expected: FAIL，错误指出 `session-time-correction.js` 不存在或未导出目标函数。

- [x] **Step 3: 写最小纯 helper 实现**

实现独立模块；显式 ISO 解析规则与现有 reschedule 保持一致，但生命周期方向相反：

```js
const EXPLICIT_ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/i;

function correctionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseExplicitIsoTimestamp(value) {
  if (typeof value !== "string") {
    throw correctionError("INVALID_START_AT", "startAt must include an explicit timezone");
  }
  const match = EXPLICIT_ISO_TIMESTAMP.exec(value);
  if (!match) {
    throw correctionError("INVALID_START_AT", "startAt must include an explicit timezone");
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ""] = match;
  const [year, month, day, hour, minute, second] =
    [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day ||
    calendarDate.getUTCHours() !== hour ||
    calendarDate.getUTCMinutes() !== minute ||
    calendarDate.getUTCSeconds() !== second
  ) {
    throw correctionError("INVALID_START_AT", "startAt must be a valid ISO-8601 timestamp");
  }
  const offsetHour = Number(match[10] || 0);
  const offsetMinute = Number(match[11] || 0);
  if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
    throw correctionError("INVALID_START_AT", "startAt has an invalid timezone offset");
  }
  const offsetSign = match[9] === "-" ? -1 : 1;
  const milliseconds = Number((fraction + "000").slice(0, 3));
  return Date.UTC(year, month - 1, day, hour, minute, second, milliseconds) -
    offsetSign * (offsetHour * 60 + offsetMinute) * 60_000;
}

export function normalizeSessionTimeCorrectionStartAt(value, currentStartAt, now = new Date()) {
  const normalizedTimestamp = Math.floor(parseExplicitIsoTimestamp(value) / 1000) * 1000;
  const currentTimestamp = Math.floor(new Date(currentStartAt).getTime() / 1000) * 1000;
  const nowTimestamp = Math.floor(new Date(now).getTime() / 1000) * 1000;
  if (!Number.isFinite(currentTimestamp) || !Number.isFinite(nowTimestamp)) {
    throw correctionError("INVALID_CURRENT_START_AT", "Current session time is invalid");
  }
  if (normalizedTimestamp >= nowTimestamp) {
    throw correctionError(
      "CORRECTION_START_AT_NOT_PAST",
      "Historical correction startAt must be in the past"
    );
  }
  if (normalizedTimestamp === currentTimestamp) {
    throw correctionError("UNCHANGED_START_AT", "startAt must change by at least one second");
  }
  const date = new Date(normalizedTimestamp);
  return { date, canonical: date.toISOString() };
}
```

- [x] **Step 4: 运行纯 helper 测试并确认转绿**

Run: `node --test apps/api/test/session-time-correction.test.mjs`

Expected: PASS，3 个测试全部通过。

- [x] **Step 5: 提交服务端时间边界**

```bash
git add apps/api/test/session-time-correction.test.mjs apps/api/src/modules/core/session-time-correction.js
git commit -m "test: define historical session time correction"
```

### Task 2: 建立迁移与事务服务的 RED/GREEN 循环

> 进度：已完成；权限、生命周期、更新、审计与失败传播共 9/9 定向测试通过。

**Files:**
- Create: `apps/api/migrations/0033_session_start_time_corrections.sql`
- Create: `apps/api/test/session-time-correction-service.test.mjs`
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/db/mysql.js`

- [x] **Step 1: 写事务服务失败测试**

测试使用 fake connection 锁定 SQL 边界，并验证非车头、未来车局、成功更新与审计：

```js
import assert from "node:assert/strict";
import test from "node:test";

import { correctHistoricalSessionStartTimeInTransaction } from "../src/modules/core/service.js";

const organizer = { user: { id: 7 }, roles: ["organizer"] };
const oldStart = new Date("2026-06-20T10:30:00.000Z");
const databaseNow = new Date("2026-07-22T08:00:00.000Z");

function fakeConnection({ organizerUserId = 7, sessionStarted = 1 } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, values });
      if (normalized.includes("AS session_started") && normalized.endsWith("FOR UPDATE")) {
        return [[{
          id: 42,
          organizer_user_id: organizerUserId,
          start_at: oldStart,
          database_now: databaseNow,
          session_started: sessionStarted
        }]];
      }
      if (normalized.startsWith("UPDATE sessions SET start_at")) return [{ affectedRows: 1 }];
      if (normalized.startsWith("INSERT INTO session_start_time_corrections")) {
        return [{ insertId: 9 }];
      }
      if (normalized === "SELECT * FROM sessions WHERE id = ?") {
        return [[{ id: 42, start_at: values[0] || oldStart }]];
      }
      if (normalized === "SELECT * FROM session_start_time_corrections WHERE id = ?") {
        return [[{ id: 9, session_id: 42 }]];
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    }
  };
}

test("rejects a non-organizer before mutation", async () => {
  const connection = fakeConnection({ organizerUserId: 99 });
  await assert.rejects(
    correctHistoricalSessionStartTimeInTransaction(connection, organizer, 42, {
      startAt: "2026-06-20T19:30:00+08:00"
    }),
    { code: "FORBIDDEN" }
  );
  assert.equal(connection.calls.length, 1);
});

test("rejects a session that is not historical", async () => {
  const connection = fakeConnection({ sessionStarted: 0 });
  await assert.rejects(
    correctHistoricalSessionStartTimeInTransaction(connection, organizer, 42, {
      startAt: "2026-06-20T19:30:00+08:00"
    }),
    { code: "SESSION_NOT_HISTORICAL", statusCode: 409 }
  );
  assert.equal(connection.calls.length, 1);
});

test("updates only start_at and appends one audit row", async () => {
  const connection = fakeConnection();
  const result = await correctHistoricalSessionStartTimeInTransaction(connection, organizer, 42, {
    startAt: "2026-06-20T19:30:00+08:00"
  });
  const update = connection.calls.find(({ sql }) => sql.startsWith("UPDATE sessions SET start_at"));
  const audit = connection.calls.find(({ sql }) =>
    sql.startsWith("INSERT INTO session_start_time_corrections")
  );
  assert.deepEqual(update.values.slice(1), [42]);
  assert.deepEqual(audit.values.slice(0, 3), [42, 7, oldStart]);
  assert.equal(connection.calls.some(({ sql }) => sql.includes("user_notifications")), false);
  assert.equal(result.correction.id, 9);
});
```

- [x] **Step 2: 运行事务测试并确认按预期失败**

Run: `node --test apps/api/test/session-time-correction-service.test.mjs`

Expected: FAIL，`correctHistoricalSessionStartTimeInTransaction` 尚未导出。

- [x] **Step 3: 新增审计表迁移并纳入 readiness**

创建完整迁移：

```sql
CREATE TABLE session_start_time_corrections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id BIGINT UNSIGNED NOT NULL,
  changed_by_user_id BIGINT UNSIGNED NOT NULL,
  old_start_at DATETIME NOT NULL,
  new_start_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_session_start_time_corrections_session_created (session_id, created_at, id),
  CONSTRAINT fk_session_start_time_corrections_session
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_session_start_time_corrections_user
    FOREIGN KEY (changed_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

并在 `requiredSchemaTables` 增加：

```js
"session_start_time_corrections",
```

- [x] **Step 4: 实现最小事务服务**

在 `service.js` 导入 helper，并增加事务入口。校验错误保留独立 code：

```js
import { normalizeSessionTimeCorrectionStartAt } from "./session-time-correction.js";

export async function correctHistoricalSessionStartTime(user, sessionId, body = {}) {
  const id = positiveId(sessionId, "sessionId");
  return withTransaction((connection) =>
    correctHistoricalSessionStartTimeInTransaction(connection, user, id, body)
  );
}

export async function correctHistoricalSessionStartTimeInTransaction(
  connection,
  user,
  id,
  body = {}
) {
  const [rows] = await connection.query(
    `SELECT *, CURRENT_TIMESTAMP AS database_now,
            (start_at <= CURRENT_TIMESTAMP) AS session_started
       FROM sessions WHERE id = ? FOR UPDATE`,
    [id]
  );
  const session = rows[0];
  if (!session) throw notFound("Session not found");
  if (Number(session.organizer_user_id) !== Number(user.user.id)) {
    throw forbidden("Only the current session organizer can correct historical time");
  }
  if (Number(session.session_started) !== 1) {
    throw new AppError(409, "SESSION_NOT_HISTORICAL", "Session has not started");
  }

  let normalized;
  try {
    normalized = normalizeSessionTimeCorrectionStartAt(
      body.startAt,
      session.start_at,
      session.database_now
    );
  } catch (error) {
    if (["INVALID_START_AT", "CORRECTION_START_AT_NOT_PAST", "UNCHANGED_START_AT"].includes(error.code)) {
      throw new AppError(400, error.code, error.message);
    }
    throw error;
  }

  await connection.query("UPDATE sessions SET start_at = ? WHERE id = ?", [normalized.date, id]);
  const [auditResult] = await connection.query(
    `INSERT INTO session_start_time_corrections
       (session_id, changed_by_user_id, old_start_at, new_start_at)
     VALUES (?, ?, ?, ?)`,
    [id, user.user.id, session.start_at, normalized.date]
  );
  const [updatedRows] = await connection.query("SELECT * FROM sessions WHERE id = ?", [id]);
  const [correctionRows] = await connection.query(
    "SELECT * FROM session_start_time_corrections WHERE id = ?",
    [auditResult.insertId]
  );
  return { session: updatedRows[0], correction: correctionRows[0] };
}
```

- [x] **Step 5: 运行事务与 helper 测试并确认转绿**

Run: `node --test apps/api/test/session-time-correction*.test.mjs`

Expected: PASS，纯 helper 与 service 测试全部通过。

- [x] **Step 6: 提交迁移与事务服务**

```bash
git add apps/api/migrations/0033_session_start_time_corrections.sql apps/api/src/db/mysql.js apps/api/src/modules/core/service.js apps/api/test/session-time-correction-service.test.mjs
git commit -m "feat(api): persist historical time corrections"
```

### Task 3: 接入独立 API 路由与静态契约

> 进度：已完成；独立路由、路由顺序和验证接线通过静态契约，API 9/9 通过。

**Files:**
- Create: `scripts/d52-session-history-time-correction-check.js`
- Modify: `apps/api/src/server.js`
- Modify: `apps/api/package.json`
- Modify: `package.json`

- [x] **Step 1: 写跨层失败契约**

静态检查先读取迁移、helper、service、server 和 package scripts；管理页断言在 Task 5 加入：

```js
assert.match(migration, /CREATE TABLE session_start_time_corrections/i);
assert.match(service, /export async function correctHistoricalSessionStartTime/);
assert.match(server, /start-time-corrections/);
assert.match(reschedule, /normalizedTimestamp <= now/);
assert.match(rootPackage.scripts["session-time-correction:verify"], /session-time-correction/);
```

- [x] **Step 2: 运行静态契约并确认路由缺失红灯**

Run: `node scripts/d52-session-history-time-correction-check.js`

Expected: FAIL，指出 server 尚未注册 `/start-time-corrections`。

- [x] **Step 3: 注册独立路由**

在 generic session route 之前导入并调用服务：

```js
const sessionTimeCorrectionId = idMatch(
  url.pathname,
  /^\/api\/sessions\/(\d+)\/start-time-corrections$/
);
if (request.method === "POST" && sessionTimeCorrectionId) {
  const user = await getAuthUser(request);
  jsonResponse(response, 200, {
    ok: true,
    data: await correctHistoricalSessionStartTime(user, sessionTimeCorrectionId, body)
  });
  return;
}
```

- [x] **Step 4: 接入定向验证命令**

`apps/api/package.json` 增加：

```json
"test:session-time-correction": "node --test test/session-time-correction*.test.mjs"
```

根 `package.json` 增加：

```json
"session-time-correction:verify": "npm --workspace apps/api run test:session-time-correction && node --test apps/miniprogram/test/sessionTimeCorrection.test.mjs && node scripts/d52-session-history-time-correction-check.js"
```

并把 `npm run session-time-correction:verify` 加入根 `check`，位于 session reschedule 回归附近。

- [x] **Step 5: 运行服务端定向验证**

Run: `npm --workspace apps/api run test:session-time-correction`

Expected: PASS。

- [x] **Step 6: 提交 API 路由与验证接线**

```bash
git add scripts/d52-session-history-time-correction-check.js apps/api/src/server.js apps/api/package.json package.json
git commit -m "feat(api): expose historical time correction"
```

### Task 4: 建立小程序 helper 的 RED/GREEN 循环

> 进度：已完成；入口、选择、确认与错误文案共 6/6 单测通过。

**Files:**
- Create: `apps/miniprogram/test/sessionTimeCorrection.test.mjs`
- Create: `apps/miniprogram/src/utils/sessionTimeCorrection.js`

- [x] **Step 1: 写端侧失败测试**

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHistoricalTimeCorrectionConfirmation,
  canCorrectHistoricalSession,
  historicalTimeCorrectionErrorRequiresRefresh,
  historicalTimeCorrectionErrorText,
  validateHistoricalTimeCorrection
} from "../src/utils/sessionTimeCorrection.js";

const now = "2026-07-22T08:00:00Z";

test("history correction and future reschedule entry boundaries are mutually exclusive", () => {
  assert.equal(canCorrectHistoricalSession("2026-07-22T07:59:59Z", now), true);
  assert.equal(canCorrectHistoricalSession("2026-07-22T08:00:01Z", now), false);
});

test("validates a past changed target at whole-second precision", () => {
  assert.deepEqual(
    validateHistoricalTimeCorrection(
      "2026-06-20 19:30",
      "2026-06-20T10:30:00Z",
      now
    ),
    { valid: true, startAt: "2026-06-20T11:30:00.000Z" }
  );
  assert.equal(
    validateHistoricalTimeCorrection("2026-07-23 19:30", "2026-06-20T10:30:00Z", now).reason,
    "not-past"
  );
});

test("confirmation and server errors use historical-correction copy", () => {
  const text = buildHistoricalTimeCorrectionConfirmation({
    oldStartAt: "2026-06-20T10:30:00Z",
    newStartAt: "2026-06-20T11:30:00Z"
  });
  assert.match(text, /仅修正历史记录，不会重新发车/);
  const error = Object.assign(new Error("Session has not started"), {
    statusCode: 409,
    code: "SESSION_NOT_HISTORICAL"
  });
  assert.equal(historicalTimeCorrectionErrorRequiresRefresh(error), true);
  assert.equal(historicalTimeCorrectionErrorText(error), "这辆车还没有开始，请使用改期。");
});
```

- [x] **Step 2: 运行端侧测试并确认按预期失败**

Run: `node --test apps/miniprogram/test/sessionTimeCorrection.test.mjs`

Expected: FAIL，端侧 helper 尚不存在。

- [x] **Step 3: 实现端侧纯 helper**

复用 `@pinche/shared` 的北京时间解析与格式化：

```js
import { beijingWallTimeToIso, formatBeijingDateTime, parseBusinessDateTime } from "@pinche/shared";

function wholeSeconds(value) {
  return Math.floor(value.getTime() / 1000);
}

export function canCorrectHistoricalSession(startAt, now = new Date()) {
  const start = parseBusinessDateTime(startAt);
  const current = parseBusinessDateTime(now);
  return Boolean(start && current && wholeSeconds(start) <= wholeSeconds(current));
}

export function validateHistoricalTimeCorrection(selected, currentStartAt, now = new Date()) {
  const selectedDate = parseBusinessDateTime(selected);
  const current = parseBusinessDateTime(currentStartAt);
  const currentTime = parseBusinessDateTime(now);
  if (!selectedDate || !current || !currentTime) {
    return { valid: false, reason: "invalid", message: "请选择有效的历史时间。" };
  }
  if (wholeSeconds(selectedDate) >= wholeSeconds(currentTime)) {
    return {
      valid: false,
      reason: "not-past",
      message: "历史纠错只能选择已经过去的时间。"
    };
  }
  if (wholeSeconds(selectedDate) === wholeSeconds(current)) {
    return {
      valid: false,
      reason: "unchanged",
      message: "新时间与原时间相同，请重新选择。"
    };
  }
  return { valid: true, startAt: beijingWallTimeToIso(selected) };
}

export function buildHistoricalTimeCorrectionConfirmation({ oldStartAt, newStartAt }) {
  return `原时间：${formatBeijingDateTime(oldStartAt)}\n新时间：${formatBeijingDateTime(newStartAt)}\n\n仅修正历史记录，不会重新发车。`;
}

export function historicalTimeCorrectionErrorRequiresRefresh(error) {
  return error?.code === "SESSION_NOT_HISTORICAL" || [403, 404].includes(error?.statusCode);
}

export function historicalTimeCorrectionErrorText(error) {
  if (error?.code === "SESSION_NOT_HISTORICAL") return "这辆车还没有开始，请使用改期。";
  if (error?.code === "CORRECTION_START_AT_NOT_PAST") {
    return "历史纠错只能选择已经过去的时间。";
  }
  if (error?.code === "UNCHANGED_START_AT") return "新时间与原时间相同，请重新选择。";
  if (error?.statusCode === 401) return "登录已过期，请重新登录后再纠正时间。";
  if (error?.statusCode === 403) return "你已不是本车车头，无法继续纠正时间。";
  if (error?.statusCode === 404) return "车局不存在或已被删除，请返回上一页。";
  return "时间纠错失败，请稍后重试。";
}
```

- [x] **Step 4: 运行端侧测试并确认转绿**

Run: `node --test apps/miniprogram/test/sessionTimeCorrection.test.mjs`

Expected: PASS。

- [x] **Step 5: 提交端侧 helper**

```bash
git add apps/miniprogram/test/sessionTimeCorrection.test.mjs apps/miniprogram/src/utils/sessionTimeCorrection.js
git commit -m "test(miniprogram): define historical time correction UI rules"
```

### Task 5: 在车头管理页接入历史时间纠错

> 进度：已完成；管理页静态契约、D52 15 个定向测试和小程序构建通过。

**Files:**
- Modify: `apps/miniprogram/src/pages/session/manage.vue`
- Modify: `scripts/d52-session-history-time-correction-check.js`

- [x] **Step 1: 收紧静态契约以建立管理页红灯**

增加以下断言后运行检查：

```js
assert.match(manage, /v-if="canCorrectHistoricalTime"/);
assert.match(manage, />\s*纠正时间\s*</);
assert.match(manage, /\/start-time-corrections/);
assert.match(correctionHelper, /仅修正历史记录，不会重新发车/);
assert.match(manage, /buildHistoricalTimeCorrectionConfirmation/);
assert.match(manage, /historicalCorrectionPickerVisible/);
```

Run: `node scripts/d52-session-history-time-correction-check.js`

Expected: FAIL，指出管理页尚未实现入口和提交。

- [x] **Step 2: 增加互斥入口和 picker**

在总览操作区紧邻“改期”增加：

```vue
<t-button
  v-if="canCorrectHistoricalTime"
  class="mini-button muted"
  :disabled="busyAction"
  @tap="openHistoricalCorrectionPicker"
>
  纠正时间
</t-button>
<t-date-time-picker
  title="纠正历史开本时间"
  :mode="['date', 'minute']"
  format="YYYY-MM-DD HH:mm"
  :visible="historicalCorrectionPickerVisible"
  :value="historicalCorrectionValue"
  :end="historicalCorrectionMaximum"
  @confirm="confirmHistoricalCorrectionSelection"
  @cancel="closeHistoricalCorrectionPicker"
  @close="closeHistoricalCorrectionPicker"
/>
```

data 增加三个独立字段；computed 增加：

```js
canCorrectHistoricalTime() {
  return canCorrectHistoricalSession(this.session.start_at);
}
```

- [x] **Step 3: 增加确认、提交和刷新**

methods 使用独立 helper，并以现有 `busyAction` 防重入：

```js
async correctHistoricalTime(startAt) {
  if (this.busyAction) return;
  const auth = await this.ensureManageActionLogin();
  if (!auth) return;
  this.busyAction = true;
  this.busyText = "正在纠正历史时间，请稍候...";
  try {
    await request({
      url: `/api/sessions/${this.sessionId}/start-time-corrections`,
      method: "POST",
      data: { startAt }
    });
    await this.reload();
    this.statusText = "历史时间已纠正。";
    showToast({ title: "历史时间已纠正", icon: "none" });
  } catch (error) {
    this.statusText = historicalTimeCorrectionErrorText(error);
    if (historicalTimeCorrectionErrorRequiresRefresh(error)) await this.reload();
  } finally {
    this.busyAction = false;
    this.busyText = "";
  }
}
```

确认弹窗必须使用 `buildHistoricalTimeCorrectionConfirmation`，标题“确认纠正时间”，确认按钮“确认纠正”，取消按钮“再检查一下”。

- [x] **Step 4: 运行 D52 定向验证与小程序构建**

Run: `npm run session-time-correction:verify`

Expected: PASS。

Run: `npm run build:mp-weixin`

Expected: PASS，UniApp 构建退出码 0。

- [x] **Step 5: 提交管理页功能**

```bash
git add apps/miniprogram/src/pages/session/manage.vue scripts/d52-session-history-time-correction-check.js package.json apps/api/package.json
git commit -m "feat(miniprogram): correct historical session time"
```

### Task 6: 完成全量回归、文档勾选与最终提交

> 进度：已完成；独立审查问题已修复并复审为 merge-ready，全部自动化验证通过。

**Files:**
- Modify: `specs/d52-session-history-time-correction/tasks.md`

- [x] **Step 1: 运行现有未来改期回归**

Run: `npm --workspace apps/api run test:session-reschedule`

Expected: PASS，现有未来时间、成员确认和通知测试全部通过。

- [x] **Step 2: 运行根检查**

Run: `npm run check`

Expected: PASS，退出码 0。

- [x] **Step 3: 再次运行小程序生产构建**

Run: `npm run build:mp-weixin`

Expected: PASS，退出码 0。

- [x] **Step 4: 检查补丁完整性和改动范围**

Run: `git diff --check`

Expected: PASS，无空白错误。

Run: `git status --short`

Expected: 只包含 D52 文件或用户原有的无关改动；不得暂存或修改无关文件。

- [x] **Step 4a: 修复独立审查发现的端侧问题**

先补失败测试，再修复以下两点：

- “纠正时间”入口同时校验当前登录用户就是最新 `organizer_user_id`；负责人变更后不得保留入口。
- 成功提交后直接合并接口返回的权威 `session`，不得依赖会吞掉加载错误的 `reload()` 后误报成功。
- 增加真实 HTTP 端点测试，并让该接口先鉴权、后解析请求体，确保未登录请求稳定返回 `401`。

Run: `node --test apps/miniprogram/test/sessionTimeCorrection.test.mjs`

Expected: 新增测试先因 helper 未导出而失败，完成最小实现后全部通过。

- [x] **Step 5: 更新本清单的勾选与验证记录**

将实际完成步骤改为 `[x]`，并在文末记录每条验证命令、退出码和未执行的外部联调项。不能把未运行的检查标记为通过。

- [x] **Step 6: 提交验证记录**

```bash
git add specs/d52-session-history-time-correction/tasks.md
git commit -m "docs: record D52 verification"
```

## D52 验收清单

- [x] 历史车局显示“纠正时间”，未来车局仍只显示“改期”。
- [x] 只有当前车头可以调用历史纠错接口。
- [x] 原时间和目标时间都必须是过去时间。
- [x] 秒级相同、非法时区和未来目标被稳定拒绝。
- [x] 时间更新和追加审计位于同一事务。
- [x] 不修改状态、座位、报名、相册、游后感或聊天。
- [x] 不创建站内通知，不发送微信订阅消息。
- [x] 普通未来改期回归保持通过。
- [x] D52 定向验证、根检查和小程序构建通过。

## 验证记录

- 2026-07-22：requirements 与 design 已获用户确认；implementation plan 已生成，业务代码尚未开始。
- 2026-07-22：隔离 worktree 初始化时发现 `packages/talk` 子模块未初始化；远端 SSH 不可用且沙箱拒绝本地 hardlink clone，最终以同一固定提交 `58c7c70` 的本地 `--no-hardlinks` clone 恢复环境。恢复后既有 API 改期 22/22、小程序改期 11/11 通过。
- 2026-07-22：D52 采用 TDD 完成；服务端 helper 首次因模块缺失红灯，事务测试首次因导出缺失红灯，端侧 helper 首次因模块缺失红灯，管理页契约首次因入口缺失红灯，随后分别转绿。
- 2026-07-22：独立审查发现入口未核对当前车头、成功后依赖吞错刷新，以及端点鉴权顺序缺少 HTTP 覆盖；均以新增失败测试复现后修复。复审结论为 merge-ready，无 Critical 或 Important 问题。
- 2026-07-22：最终 `npm run session-time-correction:verify` 通过（API 10/10、小程序 8/8、静态契约通过）；未来改期回归 22/22 通过；最新 `npm run check` 退出码 0；最新 `npm run build:mp-weixin` 退出码 0；`git diff --check` 退出码 0。构建只报告仓库既有的 UniApp 更新提示与 Sass `@import`/legacy API 弃用警告。
- 2026-07-22：未连接真实业务数据库执行迁移，也未在微信开发者工具进行人工点击联调；本次完成范围为迁移、服务、HTTP、小程序代码、自动化测试与生产构建验证。
