# NPC Self Join Design

更新日期：2026-07-04

## Overview

NPC 是剧本杀车局中的工作人员，不占用玩家座位。车局创建时默认允许工作人员自行选择本场 NPC 角色，也允许车头关闭该能力。工作人员选择 NPC 角色后绑定到 `session_npc_roles.bound_user_id`，成为本场相册成员；相册可见性、人物标签、照片隐私和相册入口沿用玩家成员逻辑。

本设计延续 D19 的 NPC 角色模型。玩家仍通过 `session_seats` 和 `signups` 上车；NPC 工作人员通过独立的 NPC 角色认领流程上车。两条流程共享相册成员判断，但不共享座位占用状态。

## Existing Context

- `script_npc_roles` 定义剧本固定 NPC 角色。
- `session_npc_roles` 保存本场 NPC 角色，可来自剧本模板或车头额外添加。
- `session_npc_roles.bound_user_id` 已用于相册成员、相册 people 和照片隐私判断。
- 分享页目前只展示玩家座位，玩家按 `join_policy` 直接上车或提交审核。
- 车局创建页已有玩家上车策略和本场额外 NPC 输入，但没有 NPC 自选开关。

## Requirements

1. 车局设置默认允许 NPC 工作人员自选本场 NPC 角色。
2. 车头可以在创建车局时关闭 NPC 自选。
3. `GET /api/sessions/:id` 返回 NPC 自选开关，供小程序分享页和设置流使用。
4. 登录且手机号已验证的工作人员可以在分享页选择一个未绑定的本场 NPC 角色。
5. 已绑定该 NPC 角色的工作人员再次选择同一角色时返回成功，保证重复点击幂等。
6. 已绑定给其他用户的 NPC 角色不能被抢占。
7. NPC 自选关闭时，普通工作人员不能自行绑定 NPC 角色，车头和管理员仍可通过管理接口手动绑定。
8. 成功绑定 NPC 角色的工作人员是本场相册成员。
9. 成功绑定 NPC 角色后，工作人员在相册入口分享页可直接进入相册。
10. 相册 people 返回该 NPC 角色时保留 `session_npc_role` 标签类型和 `user_id`。
11. 标注到 NPC 角色的照片继续使用该绑定用户的相册隐私设置。
12. 玩家座位、报名审核、直接上车和换选逻辑不因 NPC 自选而改变。

## Data Model

新增 `sessions.npc_join_enabled`：

```sql
ALTER TABLE sessions
  ADD COLUMN npc_join_enabled TINYINT(1) NOT NULL DEFAULT 1
  AFTER join_policy;
```

迁移使用 `information_schema.columns` 做幂等检查。旧车局默认 `1`，符合“默认 NPC 也可以上车”。

后端新增归一化函数：

```text
normalizeNpcJoinEnabled(value)
  missing or empty -> true
  true / 1 / "true" / "1" / "enabled" -> true
  false / 0 / "false" / "0" / "disabled" -> false
  otherwise -> badRequest
```

`POST /api/sessions` 接收 `npcJoinEnabled` 或 `npc_join_enabled`。`PATCH /api/sessions/:id` 允许车头或管理员修改该字段，不回溯已经绑定的 NPC 角色。

## Backend Design

### 车局详情

`createSession` 写入归一化后的 `npc_join_enabled`。如果请求没有提供该字段，默认写入 `1`。

`getSession` 返回：

```json
{
  "npc_join_enabled": true,
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

对旧库或旧数据读取时，缺失值按 `true` 展示。

### NPC 角色自选接口

新增接口：

```text
POST /api/session-npc-roles/:id/claim
```

请求要求：

- 已登录。
- 已授权手机号。
- NPC 角色存在且 `status = active`。
- 所属车局没有取消。
- `sessions.npc_join_enabled = 1`，除非调用者是车头或管理员。
- `bound_user_id` 为空或已等于当前用户。

成功响应：

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

冲突和错误：

- 角色不存在：`404 Session NPC role not found`
- 角色 inactive：`409 NPC role is not available`
- 车局已取消：`400 Session is not available`
- NPC 自选关闭：`403 NPC self join is disabled`
- 已绑定其他用户：`409 NPC role already has a bound user`

管理接口 `PATCH /api/session-npc-roles/:id` 保持现状，仍由车头或管理员手动绑定、解绑或停用 NPC 角色。

### 相册成员

不新增第二套相册成员表。`isSessionAlbumMember`、`listMyAlbumSessions`、`sessionAlbumPeople` 和标签隐私继续读取 `session_npc_roles.bound_user_id`。

NPC 工作人员进入相册后的权限与玩家相同：

- 可以查看完整相册，受相册开放时间限制。
- 可以上传照片。
- 可以设置自己的相册隐私。
- 被标注到 `session-npc:<id>` 的照片按该用户隐私参与过滤。

## Mini Program Design

### `pages/session/setup.vue`

在“上车权限”附近新增 NPC 自选开关：

- 默认开启。
- 文案：`允许NPC工作人员自选角色`
- 关闭说明：`关闭后由车头手动安排NPC角色`

创建车局时提交：

```js
npcJoinEnabled: this.npcJoinEnabled
```

草稿 `createFlow` 保存该字段，避免返回上一步后丢失选择。

### `pages/session/share.vue`

分享页继续以玩家座位为主，同时在角色状态下方展示 NPC 角色区：

- 当 `session.npc_join_enabled` 为真且存在 active NPC 角色时展示。
- 已绑定当前用户：状态 `我选`。
- 未绑定：状态 `可选`。
- 已绑定他人：状态 `已选`。
- 自选关闭：不展示操作入口，或展示只读说明 `本场NPC由车头安排`。

工作人员点击 NPC 角色后，调用 `POST /api/session-npc-roles/:id/claim`。成功后刷新车局详情；如果当前是 `entry=album`，直接跳转 `/pages/session/album?id=<sessionId>`。

玩家座位确认按钮仍只处理 `session_seats`，不把 NPC 角色混入 `roleOptions`，避免影响玩家人数、空位统计和报名审核。

## Admin Web Design

网页小程序创建车局时同样提供 `npcJoinEnabled` 开关，默认开启，并在 `createUserSession` payload 中提交。

现有 NPC 角色管理和相册管理界面不需要改变权限模型。若 NPC 自选关闭，车头仍可用管理接口绑定工作人员。

## Testing

新增静态检查 `scripts/d24-npc-self-join-check.js`，覆盖：

- 迁移包含 `npc_join_enabled` 和幂等 `information_schema.columns` 检查。
- service 包含 `normalizeNpcJoinEnabled`、`claimSessionNpcRole`、`npc_join_enabled` 和 `join_result: "npc_joined"`。
- server 暴露 `POST /api/session-npc-roles/:id/claim`。
- 小程序 setup 和分享页包含 `npcJoinEnabled`、`npc_join_enabled` 和 NPC 自选文案。
- admin web 创建车局 payload 包含 `npcJoinEnabled`。

扩展 smoke 覆盖：

1. 创建默认开启 NPC 自选的车局，工作人员认领未绑定 NPC 角色成功。
2. 工作人员重复认领同一 NPC 角色成功且保持同一绑定。
3. 第二个工作人员认领已绑定 NPC 角色返回冲突。
4. 关闭 NPC 自选的车局，普通工作人员认领返回 forbidden。
5. 绑定后的 NPC 工作人员出现在 `listMyAlbumSessions` 中。
6. `album/people` 返回 `session-npc:<id>`，且 `user_id` 是工作人员账号。
7. 标注到该 NPC 角色的照片保存和读取保持 `session_npc_role`。

验证命令：

```bash
node scripts/d24-npc-self-join-check.js
node --check scripts/d18-session-album-privacy-smoke.js
npm --workspace apps/api run check
node scripts/check-miniprogram.js
node scripts/d12-admin-web-check.js
```

## Out Of Scope

- NPC 工作人员公开主页。
- NPC 排名、投票或打赏。
- 多个工作人员共同绑定同一个 NPC 角色。
- NPC 工作人员占用玩家座位。
- 对已绑定 NPC 角色做审核流。

## Self-Review

- Placeholder scan: no TBD or open placeholder remains.
- Consistency check: NPC 自选只写 `session_npc_roles.bound_user_id`，玩家上车只写 `session_seats` 和 `signups`。
- Scope check: 单一功能，围绕车局开关、NPC 角色认领和相册成员复用，可以进入一个实现计划。
- Ambiguity check: “NPC 上车”在本文中明确为工作人员认领 NPC 角色，不占玩家座位。
