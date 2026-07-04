# D24 Design: NPC 工作人员自选角色上车

更新日期：2026-07-04

## Overview

D24 将 NPC 工作人员上车建模为“选择本场 NPC 角色”，不占用玩家座位。车局新增 `npc_join_enabled` 总开关，默认开启；真正的直接/审核流程复用 D23 的 `join_policy`。`direct` 车局选择 NPC 角色后立即绑定，`review_required` 车局创建 pending 报名，车头审核通过后绑定。

设计延续 D19 的 `session_npc_roles`，相册成员、相册 people、照片标签和隐私仍以 `session_npc_roles.bound_user_id` 为准。为了让 NPC 审核使用现有审核入口，`signups` 扩展为同时支持玩家座位申请和 NPC 角色申请。

## Data Model

### `sessions.npc_join_enabled`

新增字段：

```sql
ALTER TABLE sessions
  ADD COLUMN npc_join_enabled TINYINT(1) NOT NULL DEFAULT 1
  AFTER join_policy;
```

迁移使用 `information_schema.columns` 做幂等检查。旧车局默认开启 NPC 自选。

归一化：

```text
normalizeNpcJoinEnabled(value)
  missing or empty -> true
  true / 1 / "true" / "1" / "enabled" -> true
  false / 0 / "false" / "0" / "disabled" -> false
  otherwise -> badRequest
```

`POST /api/sessions` 接收 `npcJoinEnabled` 或 `npc_join_enabled`。`PATCH /api/sessions/:id` 允许车头或管理员更新。更新开关不回溯解绑已经绑定的 NPC 角色。

### `signups` 扩展

新增 NPC 申请目标：

```sql
ALTER TABLE signups
  MODIFY seat_id BIGINT UNSIGNED NULL,
  ADD COLUMN session_npc_role_id BIGINT UNSIGNED NULL AFTER seat_id,
  ADD COLUMN signup_type VARCHAR(32) NOT NULL DEFAULT 'seat' AFTER session_npc_role_id,
  ADD UNIQUE KEY uniq_signup_user_npc_role (session_npc_role_id, user_id),
  ADD INDEX idx_signups_npc_role_status (session_npc_role_id, status),
  ADD CONSTRAINT fk_signups_session_npc_role FOREIGN KEY (session_npc_role_id) REFERENCES session_npc_roles(id);
```

应用层约束：

- 玩家座位申请：`signup_type = "seat"`，`seat_id` 必填，`session_npc_role_id = NULL`。
- NPC 角色申请：`signup_type = "session_npc_role"`，`session_npc_role_id` 必填，`seat_id = NULL`。

旧数据保持 `signup_type = "seat"`。

## Backend Design

### 车局创建和详情

`createSession` 写入归一化后的 `npc_join_enabled`。缺省请求写 `1`。

`updateSession` 支持 `npcJoinEnabled` / `npc_join_enabled`。

`getSession` 返回：

```json
{
  "npc_join_enabled": true,
  "join_policy": "review_required",
  "session_npc_roles": [
    {
      "id": 123,
      "name": "媒人",
      "bound_user_id": null,
      "status": "active"
    }
  ]
}
```

### NPC 角色选择接口

新增：

```text
POST /api/session-npc-roles/:id/claim
```

服务函数：

```text
claimSessionNpcRole(user, npcRoleId, body)
```

共同校验：

- 调用者已登录且手机号已验证。
- NPC 角色存在。
- NPC 角色 `status = active`。
- 所属车局未取消。
- `npc_join_enabled = 1`，除非调用者是车头或管理员。
- `bound_user_id` 为空或已等于当前用户。
- 不存在其他用户对该 NPC 角色的有效 pending 申请。

#### `direct` 分支

当 `session.join_policy = "direct"`：

```text
lock session_npc_roles row
reject conflicting bound user or pending signup
set bound_user_id = current user
insert or update approved signup
return join_result = npc_joined
```

响应：

```json
{
  "join_result": "npc_joined",
  "npc_role": {
    "id": 123,
    "session_id": 456,
    "name": "媒人",
    "bound_user_id": 789
  }
}
```

报名记录：

- `signup_type = "session_npc_role"`
- `session_npc_role_id = npc role id`
- `seat_id = NULL`
- `status = "approved"`
- `review_eligible_at = CURRENT_TIMESTAMP`

#### `review_required` 分支

当 `session.join_policy = "review_required"`：

```text
lock session_npc_roles row
reject conflicting bound user or pending signup
insert or update pending signup for current user
return join_result = pending_review
```

响应：

```json
{
  "join_result": "pending_review",
  "signup": {
    "id": 123,
    "status": "pending",
    "signup_type": "session_npc_role",
    "session_npc_role_id": 456
  }
}
```

该分支不写 `session_npc_roles.bound_user_id`。

### 报名列表和审核

`listSessionSignups` 返回两类申请。玩家申请继续返回座位字段；NPC 申请额外返回：

```json
{
  "signup_type": "session_npc_role",
  "session_npc_role_id": 456,
  "npc_role_name": "媒人",
  "seat_id": null,
  "seat_name": null
}
```

审核通过：

```text
approveSignup(user, signupId)
if signup_type = seat:
  keep existing seat approval flow
if signup_type = session_npc_role:
  require session owner/admin
  lock session_npc_roles row
  ensure role is active and unbound or bound to signup user
  set bound_user_id = signup.user_id
  set signup.status = approved
  set review_eligible_at = CURRENT_TIMESTAMP
  reject other pending signups for same session_npc_role_id
```

审核拒绝：

```text
rejectSignup(user, signupId)
if signup_type = seat:
  keep existing behavior
if signup_type = session_npc_role:
  set signup.status = rejected
  do not update session_npc_roles.bound_user_id
```

NPC pending 申请不授予相册成员权限。

### 相册成员和隐私

不新增相册成员表。现有逻辑继续以 `session_npc_roles.bound_user_id` 判断 NPC 成员：

- `isSessionAlbumMember`
- `listMyAlbumSessions`
- `sessionAlbumPeople`
- `albumPrivacyMap`
- 照片标签过滤

待审核 NPC 申请不写 `bound_user_id`，因此不会进入完整相册。

## Mini Program Design

### `pages/session/setup.vue`

在“上车权限”附近新增 NPC 自选开关：

- 默认开启。
- 文案：`允许NPC工作人员自选角色`。
- 说明：`关闭后由车头手动安排NPC角色`。

创建车局时提交：

```js
npcJoinEnabled: this.npcJoinEnabled
```

`createFlow` 保存 `npcJoinEnabled`，返回上一步后保持选择。

### `pages/session/share.vue`

保留玩家座位区。新增 NPC 角色区，不把 NPC 角色混进 `roleOptions`。

NPC 角色状态：

- 已绑定当前用户：`我选`
- 当前用户已有 pending 申请：`待审`
- 未绑定且未被 pending 占用：`可选`
- 已绑定他人或被他人 pending 占用：`已选`
- `npc_join_enabled = false`：不提供自选操作，展示 `本场NPC由车头安排`

点击可选 NPC 角色时：

```text
ensure login and phone
POST /api/session-npc-roles/:id/claim
if join_result = npc_joined:
  refresh session
  if entry = album: redirect to album
  else show joined toast
if join_result = pending_review:
  refresh session
  show waiting review message
```

玩家座位的 direct/review 流程保持 D23 行为。

## Admin Web And Organizer UI

小程序车头管理页和 admin web 审核列表需要识别 NPC 申请：

- `signup_type = "seat"`：展示原玩家座位名。
- `signup_type = "session_npc_role"`：展示 NPC 角色名。

审核按钮复用现有 approve/reject 接口。通过 NPC 申请后刷新报名列表和车局 NPC 角色状态。

小程序车头管理页的 NPC 角色卡与玩家座位保持同一管理语义：未绑定且无待审申请的 active NPC 角色显示 `关闭角色`，inactive NPC 角色显示 `开放角色`，已绑定工作人员的 NPC 角色显示 `移除成员`。

网页小程序创建车局时也提供 `npcJoinEnabled` 开关，默认开启，并在 `createUserSession` 中提交。

## Error Handling

- 角色不存在：`404 Session NPC role not found`
- 角色 inactive：`409 NPC role is not available`
- 车局已取消：`400 Session is not available`
- NPC 自选关闭：`403 NPC self join is disabled`
- 已绑定其他用户：`409 NPC role already has a bound user`
- 已被其他用户 pending 占用：`409 NPC role already has a pending signup`
- 缺少手机号：沿用现有 `phoneRequired`

前端将 409 映射为角色已被选择或正在审核，403 映射为本场 NPC 由车头安排。

## Testing

新增 `scripts/d24-npc-self-join-check.js` 静态检查：

- 迁移包含 `npc_join_enabled`、`session_npc_role_id`、`signup_type`、`uniq_signup_user_npc_role`。
- service 包含 `normalizeNpcJoinEnabled`、`claimSessionNpcRole`、`join_result: "npc_joined"`、`join_result: "pending_review"`。
- server 暴露 `POST /api/session-npc-roles/:id/claim`。
- 小程序 setup 和 share 包含 NPC 自选开关和 NPC 选择文案。
- admin web 创建车局 payload 包含 `npcJoinEnabled`。

扩展后端 smoke：

1. 默认开启 NPC 自选的 `direct` 车，工作人员选择 NPC 角色后绑定成功。
2. 重复选择同一 NPC 角色幂等成功。
3. 第二个工作人员选择已绑定 NPC 角色返回冲突。
4. 关闭 NPC 自选的车局，普通工作人员选择返回 forbidden。
5. `review_required` 车中选择 NPC 角色返回 pending。
6. pending NPC 申请审核前不能进入完整相册。
7. 车头审核通过后绑定 NPC 角色。
8. 绑定后的 NPC 工作人员出现在我的相册车局列表和相册 people 中。
9. `session-npc:<id>` 照片标签保存和读取保持 `session_npc_role`。

验证命令：

```bash
node scripts/d24-npc-self-join-check.js
node --check scripts/d18-session-album-privacy-smoke.js
npm --workspace apps/api run check
node scripts/check-miniprogram.js
node scripts/d12-admin-web-check.js
npm run check
npm run build:mp-weixin
```

## Out Of Scope

- NPC 工作人员公开主页。
- NPC 排名、投票或打赏。
- 多个工作人员共同绑定同一个 NPC 角色。
- NPC 工作人员占用玩家座位。
- 为 NPC 申请新增独立审核产品线。
