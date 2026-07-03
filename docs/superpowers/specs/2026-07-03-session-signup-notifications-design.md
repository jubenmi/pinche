# 上车审核与订阅通知设计

日期：2026-07-03

## 背景

Pinche 已经有“申请上车 -> 车头审核”的核心模型：

- `POST /api/signups` 创建 `pending` 报名，并把空座位改为 `applied`。
- `PATCH /api/signups/:id/approve` 通过申请，把申请人确认到座位上。
- `PATCH /api/signups/:id/reject` 拒绝申请，并在没有其他活跃申请时释放座位。
- `pages/session/manage` 是车头审核待处理申请的管理页。

当前小程序 `pages/session/share` 的角色选择仍在调用 `POST /api/session-seats/:id/claim`，会把用户直接确认到角色。这和新的产品规则冲突：所有上车、包括发车后补位，都必须先由车头审核；否则玩家可能绕过角色绑定审核，获得相册等按角色控制的隐私权限。

## 目标

实现严格的车头审核上车流程，并补齐微信订阅通知：

1. 玩家每次选择角色都创建待审核申请，不能直接占座。
2. 有人申请上车时，车头可收到微信订阅消息。
3. 车头通过或拒绝后，申请人可收到微信订阅消息。
4. 用户拒绝订阅不影响申请、审核或管理主流程。
5. 相册和角色隐私只认审核通过后的座位归属，不认待审核申请。

## 非目标

- 不为订阅提供奖励、积分、权益或补贴。
- 不发送营销、拉新、转发诱导或无关消息。
- 不新增一套和 `signups` 并行的报名状态机。
- 不允许小程序在发车后直接占空位。
- 不要求本地开发或烟测依赖真实微信消息下发。

## 产品规则

### 上车

所有玩家上车，包括发车后补位，都必须走同一条链路：

```text
玩家选择角色
  -> 玩家提交待审核申请
  -> 车头审核申请
  -> 通过后玩家绑定到座位和角色
  -> 拒绝后玩家不获得座位、角色或相册权限
```

小程序不能再用 direct claim 完成角色选择。后端也必须阻止普通玩家直接自助占座，包括发车后的空位。任何保留的直接分配能力都必须限定为车头或管理员维护行为，不能让玩家在没有车头意图的情况下获得成员身份。

### 隐私

待审核申请人不是已上车成员，不能获得：

- 已确认座位归属
- 按角色绑定的相册可见权限
- 同车成员权限
- 车友记录资格
- 发车后仅凭申请获得的相册访问权

只有 `confirmed` 或 `locked` 座位上的 `confirmed_user_id` 才能授予这些权限。

### 通知

通知必须绑定明确业务动作：

- 车头在发布车后或进入管理页时，可订阅“新申请提醒”。
- 玩家在提交申请后，可订阅“审核结果提醒”。

用户拒绝、关闭或无法订阅时，主流程仍成功。订阅结果记录到现有订阅请求记录接口，方便后续排查或分析。

## 小程序设计

### 角色选择页

`apps/miniprogram/src/pages/session/share.vue` 的已发布车确认动作需要调整：

- 调整前：调用 `POST /api/session-seats/:id/claim`。
- 调整后：调用 `POST /api/signups`，提交 `seatId`、联系方式和备注。

申请成功文案：

```text
已提交申请，等待车头审核。
```

提交后重新加载车局，选中的角色卡应显示为待审核，因为座位已变为 `applied`。只有当前用户确实是座位 `confirmed_user_id` 时，才显示“我选”。

已经发车的车局也使用相同逻辑：可以选择开放座位，但确认后创建待审核申请，不能直接占座。

### 详情页

`apps/miniprogram/src/pages/session/detail.vue` 可以继续让 `open` 或 `applied` 座位进入角色选择。发车后的补位入口也必须指向同一套申请流程。

座位状态文案：

- `open`：可申请
- `applied`：待审核
- `confirmed`：已上车
- `locked`：已锁定

### 管理页

`apps/miniprogram/src/pages/session/manage.vue` 继续作为车头审核入口。可以在刷新按钮附近提供一个轻量的订阅入口：

```text
申请提醒
```

点击后请求车头“新申请提醒”订阅模板。拒绝时只给温和提示，并记录订阅结果。

### 订阅工具

新增一个小程序订阅工具，负责：

- 检查 `wx.requestSubscribeMessage` 是否可用。
- 每次请求一个模板。
- 归一化 `accept`、`reject`、`ban`、`filter`、API 不可用和非微信环境。
- 把结果提交到 `/api/subscriptions/request-result`。

订阅场景：

- `organizer_signup_created`
- `player_signup_reviewed`

模板 ID 由小程序环境变量提供。空值视为未启用。

## 后端设计

### 配置

新增通知配置：

- `WECHAT_SUBSCRIBE_MESSAGE_ENABLED`
- `WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_CREATED`
- `WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_REVIEWED`

未启用或缺少模板 ID 时，后端通知调用返回跳过结果，不抛错。这保证本地开发和 CI 不依赖微信网络。

### 微信客户端

新增一个聚焦的后端订阅消息模块，负责：

- 使用 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET` 获取接口调用凭证。
- 调用 `/cgi-bin/message/subscribe/send`。
- 在未启用或配置不完整时返回 no-op。
- 返回结构化的已发送、已跳过或发送失败结果。

通知失败不能回滚申请创建或审核结果。业务 API 的成功与否由数据库事务决定，微信发送失败只作为通知层结果记录或日志。

### 新申请通知

`createSignup` 事务成功后，满足以下条件时通知车头：

- 报名创建成功。
- 车头在 `users.open_id` 中有 openid。
- 报名能关联到真实车局和座位。
- 新申请模板 ID 已配置。

消息跳转：

```text
/pages/session/manage?id=<session_id>
```

模板字段必须使用微信审核通过的关键词，语义包括：

- 车局或剧本名称
- 座位或角色名称
- 申请人昵称或“新申请”
- 开车时间
- 状态“待审核”

### 审核结果通知

`approveSignup` 或 `rejectSignup` 事务成功后，满足以下条件时通知申请人：

- 审核操作成功。
- 申请人在 `users.open_id` 中有 openid。
- 审核结果模板 ID 已配置。

消息跳转：

```text
/pages/session/detail?id=<session_id>
```

模板字段语义包括：

- 车局或剧本名称
- 座位或角色名称
- 审核结果
- 开车时间

### Direct Claim 接口

`POST /api/session-seats/:id/claim` 不能再作为普通玩家上车入口。它应当：

- 拒绝普通玩家调用；或
- 在后续维护 spec 中替换为仅车头/管理员可用的直接分配接口。

现有依赖玩家自助 claim 的烟测，需要改为：

```text
POST /api/signups
PATCH /api/signups/:id/approve
```

这样 API 行为和相册隐私一致，而不只是把 direct claim 从小程序 UI 上藏起来。

## 数据模型

本次不新增表。

复用现有表：

- `signups`：保存 `pending`、`approved`、`rejected` 状态。
- `session_seats.confirmed_user_id`：保存实际角色成员归属。
- `subscription_requests`：记录小程序侧订阅请求结果。

后端发送尝试本阶段不持久化。如果后续需要投递审计，再单独新增通知日志表。

## API 行为

### `POST /api/signups`

行为保持：

- 要求登录。
- 创建待审核申请。
- 继续使用现有用户-座位唯一约束，防止重复申请同一座位。
- 把 `open` 座位更新为 `applied`。
- 事务成功后触发车头通知。

### `PATCH /api/signups/:id/approve`

行为保持：

- 要求车头或管理员。
- 只允许通过 `pending` 申请。
- 自动拒绝同座其他待审核申请。
- 把座位确认给通过的申请人。
- 事务成功后触发申请人审核结果通知。

### `PATCH /api/signups/:id/reject`

行为保持：

- 要求车头或管理员。
- 把申请更新为 `rejected`。
- 没有其他活跃申请时释放座位。
- 事务成功后触发申请人审核结果通知。

### `POST /api/session-seats/:id/claim`

行为改变：

- 不能允许普通登录玩家直接成为已确认成员。
- 不能允许发车后的空位绕过审核直接被占。
- 普通玩家自助 claim 应返回权限或业务错误。
- 车头审核接口仍是确认成员的唯一正式路径。

## 错误处理

- 申请和审核失败继续返回现有 API 错误。
- 小程序订阅弹窗失败不阻断 UI 主操作。
- 后端微信下发失败不改变申请或审核 API 成功结果。
- 通知配置缺失时返回明确的跳过结果，不抛异常。
- 重复申请仍返回冲突；小程序提示用户已经申请过该角色。

## 合规

本设计遵循现有微信合规护栏：

- 只在明确业务动作后请求订阅。
- 拒绝订阅不影响申请或管理。
- 下发内容和订阅用途一致。
- 不把订阅和奖励、营销、分享诱导绑定。

## 测试

新增或更新检查，证明：

- 小程序角色确认不再引用 `/api/session-seats/:id/claim`。
- 已发布车角色确认调用 `POST /api/signups`。
- 发车后开放座位也走申请语义。
- 后端 direct claim 不再允许普通玩家绕过车头审核。
- `POST /api/signups` 仍创建待审核申请并把座位改为 `applied`。
- 审核通过/拒绝烟测仍通过。
- 后端通知 helper 在未启用或缺少模板 ID 时返回跳过结果。
- 现有 `npm run check` 语法和静态检查继续通过。

## 上线步骤

1. 先部署带通知 no-op 和配置项的后端。
2. 再部署小程序申请流程调整。
3. 在微信公众平台配置订阅消息模板。
4. 模板审核通过后开启 `WECHAT_SUBSCRIBE_MESSAGE_ENABLED`。
5. 使用微信开发者工具或体验版验证订阅弹窗和消息跳转，因为 `wx.requestSubscribeMessage` 无法完全通过 Node 烟测验证。
