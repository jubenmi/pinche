# D25 Design: 恶意骚扰成员移除与举报

更新日期：2026-07-04

## Overview

D25 在现有 `PATCH /api/session-seats/:id/kick` 上扩展安全语义。普通释放保持原行为；当请求带 `report = true` 时，后端在同一个事务中释放座位、取消被移除用户的有效报名、写入举报审计记录，并设置禁止该用户再次加入同一车局。

聊天和相册不新增独立黑名单判断。它们已经依赖 `session_seats.confirmed_user_id` 和座位状态判断成员身份；释放座位后，被移除用户自然失去聊天和完整相册访问。

## Data Model

新增迁移 `apps/api/migrations/0018_session_member_removal_reports.sql`。

新增表：

```sql
CREATE TABLE IF NOT EXISTS session_member_removal_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  seat_id BIGINT UNSIGNED NOT NULL,
  removed_user_id BIGINT UNSIGNED NOT NULL,
  removed_by_user_id BIGINT UNSIGNED NOT NULL,
  reason_type VARCHAR(64) NOT NULL,
  reason_text TEXT NULL,
  block_rejoin TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_review',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_member_removal_session_user (session_id, removed_user_id, block_rejoin),
  INDEX idx_member_removal_status_created (status, created_at),
  CONSTRAINT fk_member_removal_session FOREIGN KEY (session_id) REFERENCES sessions(id),
  CONSTRAINT fk_member_removal_seat FOREIGN KEY (seat_id) REFERENCES session_seats(id),
  CONSTRAINT fk_member_removal_removed_user FOREIGN KEY (removed_user_id) REFERENCES users(id),
  CONSTRAINT fk_member_removal_removed_by FOREIGN KEY (removed_by_user_id) REFERENCES users(id)
);
```

`reason_type` 合法值：

- `normal_release`
- `harassment`
- `spam`
- `scam`
- `safety_other`

只有 `harassment`、`spam`、`scam`、`safety_other` 默认 `block_rejoin = 1`。小程序普通释放不带 `report`，因此不创建举报记录；如果后端收到 `report = true` 且 `reason_type = normal_release`，仍会创建审计记录但 `block_rejoin = 0`。

## Backend Design

### 原因归一化

新增内部函数：

```text
normalizeRemovalReasonType(value, report)
  report=false -> normal_release
  missing with report=true -> harassment
  harassment/spam/scam/safety_other/normal_release -> value
  otherwise -> badRequest
```

补充说明使用现有 `assertMessageTextSafe("reason", reason)` 校验，避免违规交易词进入系统消息。

### 禁止重进检查

新增内部函数：

```text
assertUserCanJoinSession(connection, sessionId, userId)
```

查询 `session_member_removal_reports`：

```sql
SELECT id
FROM session_member_removal_reports
WHERE session_id = ?
  AND removed_user_id = ?
  AND block_rejoin = 1
LIMIT 1
```

命中时抛出 403：`User has been removed from this session`。

调用点：

- `createSignup`：玩家提交审核申请前检查。
- `claimSessionSeat`：`direct` 上车或车头/管理员直接确认前检查当前用户。

管理员和车头仍不能替被禁止重进用户绕过该限制；本阶段没有后台撤销禁止重进能力。

### 扩展 `kickSessionSeat`

请求体：

```json
{
  "report": true,
  "reasonType": "harassment",
  "reason": "可选补充说明"
}
```

事务流程：

1. `FOR UPDATE` 读取座位和车局。
2. 校验调用者是车头或系统管理员。
3. 如果 `report = true`，要求座位当前存在 `confirmed_user_id` 且状态为 `confirmed` 或 `locked`。
4. 保存 `removed_user_id = seat.confirmed_user_id`。
5. 取消该用户在本车局的 `pending` 或 `approved` 座位报名。
6. 清理该座位的发车前评价资格。
7. 将座位状态改为 `open`，车局已取消时改为 `cancelled`，并清空 `confirmed_user_id`。
8. 如果 `report = true`，插入 `session_member_removal_reports`；恶意原因设置 `block_rejoin = 1`，`normal_release` 设置 `block_rejoin = 0`。
9. 调用 `afterSessionSeatKicked`，写入车内系统消息。
10. 返回更新后的座位，并带上 `removal_reported`。

系统消息：

- 普通释放：沿用 `车头已释放「座位名」`。
- 恶意骚扰：`车头已将「座位名」移出本车，原因：恶意骚扰`。
- 垃圾信息：`车头已将「座位名」移出本车，原因：垃圾信息`。
- 疑似诈骗：`车头已将「座位名」移出本车，原因：疑似诈骗`。
- 其他安全原因：`车头已将「座位名」移出本车，原因：其他安全原因`。

补充说明只保存在举报表，不写入聊天系统消息。

## Mini Program Design

### `pages/session/manage.vue`

座位卡操作文案：

- 已确认或已锁定且有 `confirmed_user_id`：`移除成员`
- 其他座位：`关闭座位`

点击已上车成员时：

1. 调用 `uni.showActionSheet` 展示：
   - 普通释放
   - 恶意骚扰
   - 垃圾信息
   - 疑似诈骗
   - 其他安全原因
2. 选择普通释放时，二次确认后调用：

```json
PATCH /api/session-seats/:id/kick
{}
```

3. 选择恶意原因时，二次确认后调用：

```json
PATCH /api/session-seats/:id/kick
{
  "report": true,
  "reasonType": "harassment"
}
```

4. 成功后刷新车局和报名列表。

本阶段不做自由文本输入，先用原因枚举保证小程序交互轻量稳定；后端仍保留 `reason` 字段，供后续后台或更完整弹窗使用。

## Security

- 只有车头和系统管理员可以调用移除。
- 举报移除必须针对当前已上车成员，避免空座位产生虚假举报。
- 禁止重进由后端检查，前端状态不可绕过。
- 补充说明不进入系统消息，减少二次曝光。
- 系统消息只展示原因类型，不展示敏感细节。

## Out Of Scope

- 不实现 NPC 角色移除。
- 不实现后台举报审核、撤销禁止重进或封号。
- 不自动处理押金退款。
- 不新增微信订阅消息通知。
- 不为被移除用户提供站内申诉页。

## Verification

- 新增 `scripts/d25-member-removal-reporting-check.js` 静态检查迁移、服务函数、接口复用、前端文案和 `package.json` check 接入。
- `node scripts/d25-member-removal-reporting-check.js` 应通过。
- `npm --workspace apps/api run check` 应通过。
- `node scripts/check-miniprogram.js` 应通过。
- `npm run check` 应包含 D25 静态检查。
