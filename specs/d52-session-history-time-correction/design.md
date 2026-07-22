# D52 Design：历史车局时间纠错

更新日期：2026-07-22

版本：v1.0

状态：待产品复核

## 1. 设计摘要

D52 采用独立“历史时间纠错”流程，不放宽现有未来改期：

- `POST /api/sessions/:id/reschedule` 继续只接受未来时间。
- 新增 `POST /api/sessions/:id/start-time-corrections`，只接受过去时间到过去时间。
- 新增 `session_start_time_corrections` 追加式审计表。
- 车头管理页根据服务端返回的 `start_at` 在“改期”和“纠正时间”之间互斥展示。

更新车局和写审计在同一事务中完成。历史纠错不触发改期通知，不修改任何关联业务数据。

## 2. 数据模型

新增迁移 `apps/api/migrations/0033_session_start_time_corrections.sql`：

```sql
CREATE TABLE session_start_time_corrections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id BIGINT UNSIGNED NOT NULL,
  changed_by_user_id BIGINT UNSIGNED NOT NULL,
  old_start_at DATETIME NOT NULL,
  new_start_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_session_start_time_corrections_session_created
    (session_id, created_at, id),
  CONSTRAINT fk_session_start_time_corrections_session
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_session_start_time_corrections_user
    FOREIGN KEY (changed_by_user_id) REFERENCES users(id)
);
```

设计选择：

- 使用追加记录而不是在 `sessions` 上保存“最后一次修改”，保留每一次纠错链路。
- 车局按现有生命周期被删除时，审计随车局级联删除，不改变当前“删除车局即删除整辆车数据”的产品决定。
- 第一版不提供审计查询接口；记录用于问题排查与后续管理能力。

## 3. 服务端设计

### 3.1 时间规范化

新增聚焦的纯模块 `apps/api/src/modules/core/session-time-correction.js`，导出：

```text
normalizeSessionTimeCorrectionStartAt(value, currentStartAt, now)
```

规则：

1. 输入必须是带 `Z` 或明确偏移的合法 ISO-8601 时间。
2. 输入、原时间和 `now` 都比较到秒级，匹配 MySQL `DATETIME` 精度。
3. 新时间必须严格早于 `now`。
4. 新时间不能与原时间相同。
5. helper 不判断原车局是否已开始；原时间生命周期由数据库事务查询提供的 `session_started` 决定。

错误使用稳定 code：

| code | HTTP | 含义 |
|---|---:|---|
| `INVALID_START_AT` | 400 | 时间格式、日期或时区无效 |
| `CORRECTION_START_AT_NOT_PAST` | 400 | 新时间不是过去时间 |
| `UNCHANGED_START_AT` | 400 | 秒级精度下没有变化 |
| `SESSION_NOT_HISTORICAL` | 409 | 原车局尚未开始 |

### 3.2 事务服务

在 core service 增加：

```text
correctHistoricalSessionStartTime(user, sessionId, body)
correctHistoricalSessionStartTimeInTransaction(connection, user, sessionId, body)
```

事务步骤：

1. 使用 `SELECT *, (start_at <= CURRENT_TIMESTAMP) AS session_started FROM sessions WHERE id = ? FOR UPDATE` 锁定车局。
2. 不存在则返回 404。
3. 精确比较 `organizer_user_id` 与当前用户；不是当前车头返回 403，不继承管理员旁路。
4. `session_started !== 1` 返回 `SESSION_NOT_HISTORICAL`。
5. 从同一查询取得数据库 `CURRENT_TIMESTAMP AS database_now`，用它校验新时间，避免应用服务器与数据库时钟漂移。
6. `UPDATE sessions SET start_at = ? WHERE id = ?`。
7. 插入审计记录，`old_start_at` 使用锁定行中的原值。
8. 重新读取更新后的车局，并连同本次 correction 元数据返回。

服务不导入或调用 `notifySessionRescheduled`、订阅消息与用户通知模块。

### 3.3 HTTP 路由

在通用 `/api/sessions/:id` 路由之前匹配：

```text
POST /api/sessions/:id/start-time-corrections
```

请求：

```json
{
  "startAt": "2026-06-20T19:30:00+08:00"
}
```

成功响应：

```json
{
  "ok": true,
  "data": {
    "session": {
      "id": 42,
      "start_at": "2026-06-20T11:30:00.000Z"
    },
    "correction": {
      "id": 7,
      "old_start_at": "2026-06-20T10:30:00.000Z",
      "new_start_at": "2026-06-20T11:30:00.000Z",
      "created_at": "2026-07-22T08:00:00.000Z"
    }
  }
}
```

该请求不含公开文本，不进入内容审核提案流程。

## 4. 小程序设计

### 4.1 管理页入口

继续修改 `apps/miniprogram/src/pages/session/manage.vue`，不新增页面：

- `start_at` 晚于当前时间：显示现有“改期”。
- `start_at` 已到达或早于当前时间：显示“纠正时间”。
- 两个入口始终互斥。
- “纠正时间”与“改期”位于车局总览的同一操作区。

历史纠错使用独立 picker 状态，结束时间设为当前时间；不复用现有 `rescheduleMinimum`，防止未来/历史选择范围互相污染。

### 4.2 端侧纯 helper

新增 `apps/miniprogram/src/utils/sessionTimeCorrection.js`：

```text
canCorrectHistoricalSession(session, now)
validateHistoricalTimeCorrection(value, currentStartAt, now)
buildHistoricalTimeCorrectionConfirmation({ oldStartAt, newStartAt })
historicalTimeCorrectionErrorText(error)
historicalTimeCorrectionErrorRequiresRefresh(error)
```

端侧校验用于即时反馈，服务端仍是最终权威。

确认弹窗：

```text
确认纠正时间

原时间：2026年6月20日 18:30
新时间：2026年6月20日 19:30

仅修正历史记录，不会重新发车。
```

确认按钮为“确认纠正”，取消按钮为“再检查一下”。

### 4.3 提交与反馈

确认后请求独立接口。成功时：

1. 重新加载车局和报名数据。
2. 顶部时间自然显示新值。
3. 展示 toast“历史时间已纠正”。

失败时保留页面：

- `SESSION_NOT_HISTORICAL`：提示“这辆车还没有开始，请使用改期”，随后刷新。
- `CORRECTION_START_AT_NOT_PAST`：提示“历史纠错只能选择已经过去的时间”。
- `UNCHANGED_START_AT`：提示“新时间与原时间相同，请重新选择”。
- 403/404：展示权限或不存在提示并刷新车局状态。
- 其他错误：提示“时间纠错失败，请稍后重试”。

## 5. 数据流与并发

```text
车头打开管理页
  -> 客户端根据 start_at 显示“纠正时间”
  -> 选择过去时间
  -> 端侧校验与二次确认
  -> POST /start-time-corrections
  -> 事务锁定 sessions 行
  -> 用数据库时间重验生命周期、权限和目标时间
  -> 更新 start_at + 追加审计
  -> 提交事务
  -> 客户端重新加载详情
```

同一车局并发纠错时，第二个事务等待行锁。获得锁后，它读取第一个事务更新后的 `start_at`，因此审计链中的 `old_start_at` 始终与真实前一版本一致。

## 6. 失败与回滚

- 时间更新失败：不写审计。
- 审计写入失败：事务回滚时间更新。
- 客户端提交后网络断开：服务端可能已经成功；客户端再次进入或刷新即可读取权威时间。若重复提交相同目标时间，服务端以 `UNCHANGED_START_AT` 拒绝，不新增重复审计。
- 生命周期在页面打开后变化：服务端关闭式拒绝，客户端刷新后切换到正确入口。

## 7. 测试设计

### 7.1 RED：先建立失败覆盖

- API 纯 helper 测试：合法 `Z`/偏移、非法日期、缺时区、非法偏移、新时间未来、新旧相同、秒级归一化。
- API service 测试：404、403、原时间未来、成功更新、审计字段、事务顺序和无通知依赖。
- 小程序 helper 测试：未来/历史入口互斥、过去目标校验、确认文案和稳定错误提示。
- 静态契约：迁移表、独立路由、管理页按钮、根验证命令，并断言现有 reschedule 仍拒绝历史时间。

### 7.2 GREEN：最小实现顺序

1. 数据迁移与服务端纯 helper。
2. 事务服务和 HTTP 路由。
3. 小程序 helper。
4. 管理页入口、picker、确认和提交。
5. 将 D52 定向验证加入根检查。

### 7.3 最终验证

```text
node --test apps/api/test/session-time-correction*.test.mjs
node --test apps/miniprogram/test/sessionTimeCorrection.test.mjs
node scripts/d52-session-history-time-correction-check.js
npm --workspace apps/api run test:session-reschedule
npm run check
npm run build:mp-weixin
git diff --check
```

## 8. 安全与非目标确认

- 客户端不能通过修改请求体绕过过去时间限制。
- 管理员角色不会自动获得自助纠错权限。
- 不增加通用 revision/history 平台。
- 不修改普通改期通知语义。
- 不提供过去到未来、未来到过去或批量纠错。
