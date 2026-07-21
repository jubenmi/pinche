# 角色认领必备资料设计

## 背景

当前小程序通过 `uni.login` 获取微信临时 code，后端换取 `openid` 并创建用户。新用户可以只有 `openid`，没有昵称和头像。角色展示又存在 `nickname || open_id` 回退，因此车头可能在审核列表中只看到一串 `openid`，无法判断申请人是谁。

当前车局同时有 `join_policy` 和 `join_phone_required` 两个设置。前者控制直接上车或车头审核，后者允许车头关闭手机号要求。新的产品决策是保留 `join_policy`，取消手机号可选性；昵称和已验证手机号成为所有角色认领的固定条件。新用户还要主动选择一次头像，但头像内容审核是异步的，不能阻塞认领。

## 方案选择

### 采用：后端统一准入和现有资料弹窗复用

后端提供唯一的角色认领资料断言，四条角色认领路径共同调用。小程序复用 `AuthIdentityBar` 的资料与手机号弹窗，通过事件请求补齐资料，然后重试原动作。用户表增加持久的头像选择完成时间，以区分“从未选择头像”和“头像正在审核或已被拒绝”。

该方案可以阻止旧客户端绕过，复用现有上传、资料、手机号和内容审核基础设施，改动边界最小。

### 不采用：仅前端校验

仅在 `share.vue` 判断本地资料不能阻止旧版客户端和手工 API 调用，也会让玩家座位与 NPC 路径继续分叉。

### 不采用：独立认领资料表

单独复制昵称、手机号和头像状态会产生双份用户资料及同步问题。当前没有保存每次认领资料快照的产品要求，因此不新增表。

## 数据模型

### users.role_claim_avatar_completed_at

新增迁移 `apps/api/migrations/0033_role_claim_required_profile.sql`：

```sql
ALTER TABLE users
  ADD COLUMN role_claim_avatar_completed_at DATETIME(3) NULL AFTER avatar_image_asset_id;

UPDATE users
SET role_claim_avatar_completed_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP(3))
WHERE role_claim_avatar_completed_at IS NULL;
```

迁移完成后，新建用户不会显式填写该字段，因此默认是 `NULL`。历史用户已经被回填，获得头像选择豁免。

字段语义只表示“曾经成功提交头像并建立资产”，不表示当前有可展示头像，也不表示头像审核通过。

### 写入时机

`finalizeUploadedUserImage` 完成头像资产事务时，对 `kind = avatar` 的用户执行幂等更新，并把刚建立的资产关联为当前头像候选：

```sql
UPDATE users
SET role_claim_avatar_completed_at = COALESCE(role_claim_avatar_completed_at, CURRENT_TIMESTAMP(3)),
    avatar_url = ?,
    avatar_image_asset_id = ?
WHERE id = ?;
```

该关联不代表头像可以展示。当前用户 DTO、角色 DTO 和申请 DTO 都必须联查关联资产状态；只有 `active + approved/approved_legacy` 才返回 `avatarUrl`，其余状态返回空值并由小程序展示默认头像。审核回调把候选资产改为 approved 后，下一次读取会自动返回真实头像，不需要用户重新打开资料弹窗保存。

更新必须与头像资产建立采用一致的成功边界。若对象上传失败、资产事务失败或内容安全 intake 未建立，不能标记完成或替换候选。新的候选取代旧头像后，旧头像沿用现有清理任务；若新候选后来被拒绝，用户按产品规则使用默认头像，不恢复旧头像。后续审核为 `pending`、`review`、`approved`、`rejected` 或 `error` 都不回滚完成时间。

当前用户 DTO 增加 `roleClaimAvatarCompletedAt`，由 `publicUser()`、登录、`GET /api/users/me`、资料更新和手机号更新统一返回。

### 迁移协调

项目存在启动时迁移协调逻辑。实现需要同时更新 SQL migration 与对应 schema reconciler/check，遵守以下首次迁移边界：

- 字段类型和 nullable 正确；
- 只有在字段首次新增的同一迁移中回填当时已有用户；
- 新用户 insert 不主动赋值；
- 字段已经存在后的重启不再执行全表空值回填，否则会错误豁免新用户。

## 后端准入

### 统一断言

在 core service 增加 `requireRoleClaimProfile(user)`，固定按以下顺序检查：

1. 当前已持久化的 `nickname.trim()` 非空，否则抛出 `403 ROLE_CLAIM_NICKNAME_REQUIRED`；作者私有待审昵称不算满足。
2. `phoneVerifiedAt` 存在，否则抛出现有 `403 PHONE_REQUIRED`。
3. `roleClaimAvatarCompletedAt` 存在，否则抛出 `403 ROLE_CLAIM_AVATAR_REQUIRED`。

错误消息分别为：

- `认领角色前请先填写昵称`
- `认领角色前请先授权手机号`
- `认领角色前请先选择头像`

昵称和头像错误在 `apps/api/src/http/errors.js` 中使用独立构造器，避免前端解析自然语言。

### 调用边界

以下服务在改变座位、角色或申请数据前调用统一断言：

- `createSignup`
- `claimSessionSeat`
- `claimSessionNpcRole`

`claimSessionNpcRole` 同时承载 direct 和 review_required 两个分支，因此一次调用覆盖 NPC 两种结果。管理员和车头通过管理接口手工安排角色不属于“用户认领”，不新增资料门槛。

原 `requireJoinPhoneIfNeeded` 不再用于角色认领。其他明确要求手机号的业务继续使用 `requireVerifiedPhone`。`join_phone_required` 可以留在查询 DTO 中兼容旧客户端，但对外统一投影为 `true`，创建和更新服务忽略客户端传入的 `false` 并持久化 `1`。

## 前端资料补全编排

### 通用 helper

在 `apps/miniprogram/src/utils/api.js` 增加角色认领资料 helper，例如：

```js
ensureRoleClaimProfile(auth, {
  requireNewUserAvatar: true,
  profileRequiredTitle: "完善认领资料"
})
```

执行顺序：

1. 刷新当前用户资料。
2. 若昵称为空，或 `roleClaimAvatarCompletedAt` 为空，打开必填资料弹窗。
3. 资料弹窗成功后刷新 auth。
4. 若手机号未验证，打开必填手机号授权弹窗。
5. 全部满足后返回最新 auth；用户拒绝或关闭时返回 `null`。

`share.vue` 的玩家 `chooseRole` 和 NPC `chooseNpcRole` 在确认换选、性别适配和发请求前使用该 helper。补全完成后继续用户原先点击的目标角色，不要求再次点击。

### AuthIdentityBar 必填资料模式

现有资料弹窗只在 `profileRequired` 时强制性别。扩展 profile request payload，支持明确的 requirement：

```js
{
  required: true,
  requireNickname: true,
  requireAvatarSelection: true | false,
  title: "完善认领资料",
  content: "填写昵称并选择头像后继续认领角色。"
}
```

规则：

- 昵称为空时保存按钮禁用并给出明确提示。
- `roleClaimAvatarCompletedAt` 已存在时，不强制重新选头像，包括历史用户无头像的情况。
- 该状态为空时，必须在本次流程选择头像。
- 性别继续遵循现有角色选择要求，不因本 spec 新增或取消。
- 必填弹窗不能通过蒙层或取消按钮跳过。

### 异步头像审核

当前 `uploadUserAvatar()` 在 moderation pending 时抛出带 `assetId` 的 `202 CONTENT_MODERATION_REVIEW_PENDING`。资料保存逻辑调整为：

1. 用户选择头像并点击保存。
2. 上传返回已批准 URL 时，按现有方式更新 `avatarUrl` 与昵称。
3. 上传返回 `CONTENT_MODERATION_REVIEW_PENDING` 时，把它视为“头像选择已成功提交”：服务端已经关联候选头像，前端不要求取得可展示 `avatarUrl`，继续保存昵称和其他资料。
4. 刷新当前用户，读取后端已写入的 `roleClaimAvatarCompletedAt`。
5. 关闭资料弹窗并继续手机号授权。
6. 其他上传错误仍保留在资料弹窗中提示并允许重试。

待审头像仍由现有恢复机制轮询；因为候选关联已经建立，通过后下一次读取即可显示。被拒绝时恢复机制清理待处理记录，用户继续使用默认头像，且 `roleClaimAvatarCompletedAt` 不清空。

昵称仍使用现有文字安全审核。角色认领准入只接受 `users.nickname` 中已经批准并持久化的昵称；如果资料更新返回作者私有待审结果，资料弹窗提示“昵称正在安全审核”，保持原角色目标但不提交认领，直到昵称审核通过。这是昵称必填和不可展示待审文本的既有安全边界；本 spec 只有头像审核被明确设计为不阻塞。

## 头像展示安全

### 服务端投影

任何角色、成员、申请人或分享响应只能在头像资产满足以下条件时返回 `avatar_url`：

```sql
avatar_asset.status = 'active'
AND avatar_asset.moderation_status IN ('approved', 'approved_legacy')
```

需要覆盖玩家座位、NPC 角色、待审核申请、车局详情、分享页和管理页使用的查询。不能只依赖静态文件路由拦截，因为返回一个不可加载的敏感路径仍会泄露资产存在。

小程序 `RoleSeatBoard` 继续在 URL 为空时按角色/用户性别展示已有默认头像，不新增另一套默认图组件。

### 名称投影

后端和小程序删除普通展示中的 `nickname || open_id` 回退：

- 角色占用者：`nickname || "车友"`
- 待审核申请人：`nickname || "车友"`
- 相册/评价等不属于本任务的现有公开名称，只在复用同一角色 DTO 时同步修正。

`openid` 仍可保留在受保护的内部 DTO 以兼容诊断，但 UI 不读取、不展示。

## 车局设置兼容

### 创建页和管理页

从 `apps/miniprogram/src/pages/session/setup.vue` 和 `manage.vue` 删除手机号开关、状态、dirty 比较和请求字段。说明文案改为“认领角色固定需要昵称和已验证手机号；这里只控制是否由车头审核”。

### API

`createSession` 和 `updateSession` 固定 `join_phone_required = 1`。传入 `joinPhoneRequired: false` 或 `join_phone_required: false` 不报错，以兼容旧客户端，但不生效。详情 DTO 的 `join_phone_required` 固定返回 `true`，直到将来单独删除兼容字段。

现有 `join_policy`、`npc_join_enabled`、车头审核和通知行为保持不变。

## 错误恢复

- 收到 `ROLE_CLAIM_NICKNAME_REQUIRED`：重新打开必填资料弹窗。
- 收到 `ROLE_CLAIM_AVATAR_REQUIRED`：重新打开要求选择头像的资料弹窗。
- 收到 `PHONE_REQUIRED`：打开必填手机号弹窗。
- 用户拒绝手机号授权：保持在分享页，不创建申请、不占用角色。
- 资料保存或上传网络失败：保持资料弹窗，原角色目标不丢失。
- 补全后目标已被其他人占用：沿用现有 `409` 提示，不自动选择其他角色。

## 测试设计

### 静态与单元检查

- 更新 D25 上车设置检查，要求手机号开关消失、后端固定要求手机号。
- 增加专用 Dxx 检查，锁定统一准入 helper、稳定错误码、历史迁移和 `openid` 展示禁令。
- 为前端资料 helper 增加纯函数/脚本断言，覆盖已有资料、缺昵称、缺头像选择和缺手机号顺序。

### API smoke

创建历史豁免用户和迁移后新用户，覆盖：

- 玩家 direct 成功与三种缺资料拒绝；
- 玩家 review_required 成功与三种缺资料拒绝；
- NPC direct 成功与三种缺资料拒绝；
- NPC review_required 成功与三种缺资料拒绝；
- pending/rejected 头像返回空展示 URL；
- approved 头像返回 URL；
- 旧客户端关闭手机号开关后仍要求手机号。

### 构建和手动验证

- `node scripts/check-miniprogram.js`
- 新增/更新的专用 Node smoke
- `npm --workspace apps/miniprogram run build:mp-weixin`
- 微信开发者工具验证新用户头像待审后可继续 direct 与 review_required 各一条流程。

## 风险与控制

- **异步头像上传已经成功但前端未刷新状态**：以服务端持久字段和候选关联为事实来源，前端收到 pending 后刷新 `/api/users/me`。
- **头像待审路径泄露**：所有角色 DTO 使用审核状态过滤，静态媒体路由继续 fail closed。
- **旧客户端绕过**：统一准入位于 service 事务内部，且在任何角色状态写入前执行。
- **迁移误伤历史用户**：迁移对执行前全部用户回填完成时间，新用户才保持 NULL。
- **用户补资料期间角色被抢**：资料完成后重新发起原请求，由现有锁与冲突处理给出结果。

## 实施边界

只修改角色认领资料门槛、相关资料弹窗、头像安全投影、车局手机号开关和对应测试。不得顺带重做登录页、个人中心、车局设置布局、手机号展示或其他内容审核产品规则。
