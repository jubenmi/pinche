# D14 Design: 上车审核与订阅通知

更新日期：2026-07-03

## Flow

```text
玩家选择角色
  -> POST /api/signups
  -> signups.status = pending
  -> session_seats.status = applied
  -> 通知车头有新申请
  -> 车头进入 pages/session/manage
  -> PATCH /api/signups/:id/approve 或 reject
  -> 通过后 session_seats.confirmed_user_id 绑定玩家
  -> 通知玩家审核结果
```

发车后补位也走同一流程，不允许直接占空位。

## Pages

- `pages/session/share`：已发布车局选择角色时提交 `POST /api/signups`，不再调用 `POST /api/session-seats/:id/claim`。成功后展示“已提交申请，等待车头审核。”
- `pages/session/detail`：继续展示座位和入口，但发车后补位也跳转到申请流程。`open` 显示可申请，`applied` 显示待审核。
- `pages/session/manage`：继续展示申请列表和通过/拒绝操作，并新增轻量“申请提醒”订阅入口。

## State Rules

- `pending` 申请不产生角色归属。
- `pending` 申请不产生相册角色权限。
- `approved` 申请通过后，座位进入 `confirmed`，`confirmed_user_id` 指向申请人。
- 同座位其他 `pending` 申请在审批通过后自动变为 `rejected`。
- 拒绝最后一个活跃申请后，仍处于 `applied` 的座位回到 `open`。
- 普通玩家不能通过 direct claim 成为 `confirmed` 成员。

## Mini Program Subscription

新增小程序订阅工具，封装：

- 模板 ID 是否存在。
- `wx.requestSubscribeMessage` 是否可用。
- `accept`、`reject`、`ban`、`filter` 等结果归一化。
- 调用 `/api/subscriptions/request-result` 记录结果。

场景：

- `organizer_signup_created`：车头订阅新申请提醒。
- `player_signup_reviewed`：玩家订阅审核结果提醒。

拒绝订阅只提示，不阻断主流程。

## Backend Notification

新增后端订阅消息模块：

- 读取 `WECHAT_SUBSCRIBE_MESSAGE_ENABLED`。
- 读取 `WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_CREATED`。
- 读取 `WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_REVIEWED`。
- 未启用或缺少模板 ID 时返回 skipped。
- 已启用时获取微信 access token 并调用订阅消息发送接口。

通知发送在业务事务成功后执行。发送失败不回滚申请或审核。

## API Changes

### `POST /api/signups`

继续负责创建待审核申请。成功后尝试通知车头。

### `PATCH /api/signups/:id/approve`

继续负责通过申请并绑定座位。成功后尝试通知玩家审核结果。

### `PATCH /api/signups/:id/reject`

继续负责拒绝申请并按规则释放座位。成功后尝试通知玩家审核结果。

### `POST /api/session-seats/:id/claim`

不能再允许普通玩家自助占座。保留时必须拒绝普通玩家调用，避免绕过审核和相册隐私。

## Data Model

本阶段不新增表。

- 申请状态继续使用 `signups`。
- 真实角色归属继续使用 `session_seats.confirmed_user_id`。
- 小程序订阅请求结果继续使用 `subscription_requests`。

## Compliance

- 不强制订阅。
- 不把订阅和奖励、分享、营销绑定。
- 订阅文案只表达新申请或审核结果。
- 用户拒绝订阅后，申请和审核仍继续。

## Verification

- 静态检查小程序不再在角色确认路径调用 `/api/session-seats/:id/claim`。
- smoke 覆盖发车后补位也必须先申请再审核。
- smoke 覆盖普通玩家 direct claim 被拒绝。
- smoke 覆盖申请创建、审核通过、审核拒绝原有状态规则。
- 后端通知模块在未配置模板时返回 skipped。
- `npm run check` 和小程序构建检查通过。
