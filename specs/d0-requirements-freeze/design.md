# D0 Design: 情感本拼车MVP规格设计

更新日期：2026-06-11

## Overview

本设计服务于D0需求冻结，不实现代码。设计目标是把微信小程序MVP拆成最小页面、最小状态机、最小数据模型和最小API集合，确保D1可以直接进入技术初始化。

主链路：

```text
管理员录入店/本
  -> 车头建车
  -> 配座位和补贴
  -> 发布分享
  -> 玩家申请
  -> 车头审核
  -> 锁座
```

## Architecture

### MVP边界

```text
微信小程序
  -> Node.js API
  -> MySQL
  -> Redis optional
  -> Docker deployment
```

D0只冻结产品和接口边界。D1再初始化小程序、Node.js后端、Docker、MySQL和可选Redis。

### 微信侧能力

- 微信登录用于识别自然人用户。
- 微信分享卡片用于车详情传播。
- 海报和复制文案作为辅助分享方式。
- 不做微信支付、红包、提现、分账。

## Roles and Permissions

### 角色

| 角色 | 是否微信用户 | MVP用途 |
| --- | --- | --- |
| `player` | 是 | 申请上车、查看自己报名 |
| `organizer` | 是 | 建车、发车、审核、锁座 |
| `performer` | 是 | DM/NPC身份预留，可作为本车快照绑定用户 |
| `system_admin` | 是 | 录入店家、录入剧本、审核新增资料申请 |
| 店家 | 否 | 纯数据，可后续认领 |
| 剧本 | 否 | 纯数据，可后续认领 |

### 权限矩阵

| 功能 | 未登录 | 玩家 | 车头 | DM/NPC | 系统管理员 |
| --- | --- | --- | --- | --- | --- |
| 查看分享页公开信息 | 可 | 可 | 可 | 可 | 可 |
| 申请上车 | 不可 | 可 | 可 | 可 | 可 |
| 创建车 | 不可 | 可成为车头 | 可 | 可 | 可 |
| 审核报名 | 不可 | 不可 | 仅自己的车 | 不可 | 可排查 |
| 锁座 | 不可 | 不可 | 仅自己的车 | 不可 | 可排查 |
| 录入店家 | 不可 | 不可 | 不可 | 不可 | 可 |
| 录入剧本 | 不可 | 不可 | 不可 | 不可 | 可 |
| 审核新增资料申请 | 不可 | 不可 | 不可 | 不可 | 可 |

## Page Design

### 小程序页面收敛

| 页面 | 路径建议 | 使用者 | 核心功能 |
| --- | --- | --- | --- |
| 首页 | `pages/index/index` | 车头/玩家 | 建车入口、我的入口、分享页跳转兜底 |
| 我的 | `pages/mine/index` | 全部用户 | 登录、我的报名、我的发车、管理员入口 |
| 管理员资料页 | `pages/admin/catalog` | 系统管理员 | 店家、剧本、新增申请三个tab |
| 建车页 | `pages/session/create` | 车头 | 选择店/本、时间、DM/NPC、押金、座位入口 |
| 车详情/分享页 | `pages/session/detail` | 玩家/车头 | 车况、座位、实付价、申请入口、分享 |
| 申请上车页 | `pages/session/apply` | 玩家 | 选座、联系方式、报名说明 |
| 车头管理页 | `pages/session/manage` | 车头 | 审核、锁座、押金状态 |

### 管理员资料页结构

`pages/admin/catalog` 使用tabs或segmented control：

```text
店家
剧本
新增申请
```

## State Machines

### 店家/剧本资料状态

```text
active
  -> inactive

claim_status:
unclaimed
  -> pending
  -> claimed
  -> rejected
```

规则：

- MVP由系统管理员创建资料，默认 `claim_status = unclaimed`。
- `active` 可被车头选择。
- `inactive` 不可被车头选择。
- 认领流程只预留状态，不进入MVP主链路。

### 新增资料申请状态

```text
pending
  -> approved
  -> rejected
```

规则：

- 车头找不到店家或剧本时提交申请。
- 管理员通过后创建正式资料。
- 管理员驳回时必须填写原因。

### 车状态

```text
draft
  -> recruiting
  -> locked
  -> cancelled
```

规则：

- `draft`：可编辑，不可分享报名。
- `recruiting`：可分享、可报名。
- `locked`：停止报名，用于开车前锁定座位。
- `cancelled`：不可报名，保留历史记录。

### 座位状态

```text
open
  -> applied
  -> confirmed
  -> locked
  -> cancelled
```

规则：

- `open`：可申请。
- `applied`：有待审核申请。
- `confirmed`：车头已通过某个玩家。
- `locked`：座位最终锁定。
- `cancelled`：该座位取消。

### 报名状态

```text
pending
  -> approved
  -> rejected
  -> withdrawn
  -> no_show
```

规则：

- 同一座位只能有一个最终通过玩家。
- 审核通过和座位确认必须在同一事务中完成。

### 押金状态

```text
unpaid
  -> pending_confirm
  -> confirmed
  -> refunded
```

规则：

- MVP只记录押金状态，不接入支付。
- 押金状态由车头手动维护。

## Data Model Draft

### `users`

| 字段 | 说明 |
| --- | --- |
| `id` | 用户ID |
| `openid` | 微信openid |
| `unionid` | 可选 |
| `nickname` | 昵称 |
| `avatar_url` | 头像 |
| `phone` | 可选手机号 |
| `created_at` | 创建时间 |

### `user_roles`

| 字段 | 说明 |
| --- | --- |
| `user_id` | 用户ID |
| `role` | `player` / `organizer` / `performer` / `system_admin` |

### `stores`

| 字段 | 说明 |
| --- | --- |
| `id` | 店家ID |
| `name` | 店名 |
| `city` | 城市，MVP默认为北京优先 |
| `district` | 区域 |
| `address` | 地址 |
| `contact_note` | 联系备注，内部可见 |
| `status` | `active` / `inactive` |
| `claim_status` | `unclaimed` / `pending` / `claimed` / `rejected` |
| `created_by_admin_user_id` | 创建管理员 |

### `scripts`

| 字段 | 说明 |
| --- | --- |
| `id` | 剧本ID |
| `name` | 剧本名 |
| `publisher_name` | 发行名称，可为空 |
| `player_count` | 人数 |
| `duration_minutes` | 时长 |
| `theme_tags` | 标签，如情感、恋陪、沉浸 |
| `seat_notes` | 座位说明 |
| `status` | `active` / `inactive` |
| `claim_status` | `unclaimed` / `pending` / `claimed` / `rejected` |
| `created_by_admin_user_id` | 创建管理员 |

### `catalog_requests`

| 字段 | 说明 |
| --- | --- |
| `id` | 申请ID |
| `type` | `store` / `script` |
| `name` | 名称 |
| `city` | 城市 |
| `detail` | 补充信息 |
| `requested_by_user_id` | 申请人 |
| `status` | `pending` / `approved` / `rejected` |
| `reviewed_by_admin_user_id` | 审核管理员 |
| `review_note` | 审核备注 |

### `sessions`

| 字段 | 说明 |
| --- | --- |
| `id` | 车ID |
| `organizer_user_id` | 车头 |
| `store_id` | 店家 |
| `script_id` | 剧本 |
| `start_time` | 开始时间 |
| `duration_minutes` | 预计时长 |
| `status` | `draft` / `recruiting` / `locked` / `cancelled` |
| `deposit_note` | 押金说明 |
| `recruitment_note` | 招募说明 |
| `share_code` | 分享码 |

### `session_staff_snapshots`

| 字段 | 说明 |
| --- | --- |
| `id` | 快照ID |
| `session_id` | 车ID |
| `bound_user_id` | 可选，绑定DM/NPC微信用户 |
| `display_name` | 展示名 |
| `staff_type` | `dm` / `npc` |
| `role_note` | 角色说明，如爱D、重点NPC |

### `session_seats`

| 字段 | 说明 |
| --- | --- |
| `id` | 座位ID |
| `session_id` | 车ID |
| `name` | 座位名 |
| `seat_type` | `love_companion` / `f4` / `cp` / `normal` |
| `base_price` | 原价，单位分 |
| `adjustment` | 补贴调整，单位分 |
| `payable_price` | 实付价，单位分 |
| `status` | 座位状态 |
| `confirmed_user_id` | 最终通过玩家 |

### `applications`

| 字段 | 说明 |
| --- | --- |
| `id` | 报名ID |
| `session_id` | 车ID |
| `seat_id` | 座位ID |
| `user_id` | 玩家 |
| `contact_text` | 联系方式，受权限保护 |
| `note` | 报名备注 |
| `status` | 报名状态 |
| `deposit_status` | 押金状态 |

### `share_events`

| 字段 | 说明 |
| --- | --- |
| `id` | 事件ID |
| `session_id` | 车ID |
| `share_code` | 分享码 |
| `source` | 分享来源 |
| `visitor_user_id` | 可选访问用户 |
| `event_type` | `view` / `apply` / `copy_text` / `poster` |
| `created_at` | 记录时间 |

## Price Rules

```text
payablePrice = basePrice + adjustment
sum(all seat adjustment) = 0
payablePrice >= 0
```

解释：

- `adjustment > 0`：该座位承担更多费用，等价于出补。
- `adjustment < 0`：该座位减少费用，等价于吃补。
- 平台只做座位价格调整记录，不做现金补贴、返现、提现。

## API Draft

### Auth

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/api/auth/wechat/login` | 微信登录 |
| `GET` | `/api/users/me` | 当前用户与角色 |

### Admin Catalog

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/api/admin/stores` | 创建店家 |
| `PATCH` | `/api/admin/stores/:id` | 编辑/上下架店家 |
| `POST` | `/api/admin/scripts` | 创建剧本 |
| `PATCH` | `/api/admin/scripts/:id` | 编辑/上下架剧本 |
| `GET` | `/api/admin/catalog-requests` | 查看新增资料申请 |
| `POST` | `/api/admin/catalog-requests/:id/approve` | 通过新增申请 |
| `POST` | `/api/admin/catalog-requests/:id/reject` | 驳回新增申请 |

### Public Catalog

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/api/stores` | 可选店家列表 |
| `GET` | `/api/scripts` | 可选剧本列表 |
| `POST` | `/api/catalog-requests` | 车头提交新增资料申请 |

### Sessions

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/api/sessions` | 创建车草稿 |
| `PATCH` | `/api/sessions/:id` | 编辑车草稿 |
| `POST` | `/api/sessions/:id/publish` | 发布车 |
| `GET` | `/api/sessions/:id` | 车详情 |
| `GET` | `/api/users/me/sessions` | 我的发车 |
| `POST` | `/api/sessions/:id/cancel` | 取消车 |

### Applications and Seats

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/api/sessions/:id/applications` | 申请上车 |
| `GET` | `/api/users/me/applications` | 我的报名 |
| `GET` | `/api/sessions/:id/applications` | 车头查看报名 |
| `POST` | `/api/applications/:id/approve` | 通过报名 |
| `POST` | `/api/applications/:id/reject` | 拒绝报名 |
| `POST` | `/api/session-seats/:id/lock` | 锁座 |
| `PATCH` | `/api/applications/:id/deposit` | 标记押金状态 |

### Share Events

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/api/sessions/:id/share-events` | 记录分享访问/申请/复制/海报事件 |

## Compliance Design

- 分享只做传播能力，不给分享奖励。
- 补贴只做同一车内座位价格调整，不做现金红包。
- 押金只做状态记录，不接入支付。
- DM/NPC相关文案使用剧本角色互动、演绎体验、NPC互动，避免现实陪伴承诺。
- 公开页不展示手机号、微信号、真实姓名。
- 管理员可下架违规店家、剧本或车。

## D1 Entry Gate

D1可以开始的条件：

- D0 requirements、design、tasks均已落地。
- MVP主链路、页面、状态、API草案均已冻结。
- 管理员录入店家/剧本作为MVP前置路径。
- 微信合规禁区已明确排除。
