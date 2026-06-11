# D2 Design: 身份权限与数据模型设计

更新日期：2026-06-11

## Overview

D2将D1的技术空壳升级为可持久化的API底座。设计原则：

- MySQL是唯一事实来源。
- 业务token只承载会话声明，权限以数据库角色为准。
- 店家和剧本由系统管理员创建，普通用户只能提交新增申请。
- 自然人都是微信用户；DM/NPC通过 `performer_profiles` 绑定用户。
- 发布、审核通过、锁座这些关键写入必须走事务。
- 小程序端使用 UniApp 开发，微信平台能力通过微信官方开发者工具验证。

## Mini Program Frontend

源码目录：

```text
apps/miniprogram/src
```

关键文件：

```text
src/App.vue
src/main.js
src/manifest.json
src/pages.json
src/pages/**/**.vue
```

开发命令：

```text
npm run dev:mp-weixin
```

微信开发者工具导入目录：

```text
apps/miniprogram/dist/dev/mp-weixin
```

发布构建：

```text
npm run build:mp-weixin
```

生产产物目录：

```text
apps/miniprogram/dist/build/mp-weixin
```

说明：

- UniApp负责源码组织和微信小程序产物生成。
- 微信开发者工具负责 `wx.login`、授权、分享、真机预览、上传体验版、提交审核。
- D2阶段小程序仍以页面空壳和登录联调为主，业务验收以API烟测为主。

## Database

D2迁移文件：

```text
apps/api/migrations/0002_identity_and_core_model.sql
```

核心表：

```text
users
user_roles
performer_profiles
stores
scripts
catalog_requests
entity_claims
sessions
session_seats
signups
share_events
subscription_requests
```

状态字段使用字符串：

- 资料状态：`active` / `inactive`
- 认领状态：`unclaimed` / `pending` / `claimed` / `rejected`
- 车状态：`draft` / `recruiting` / `locked` / `cancelled`
- 座位状态：`open` / `applied` / `confirmed` / `locked` / `cancelled`
- 报名状态：`pending` / `approved` / `rejected` / `withdrawn` / `no_show`
- 押金状态：`unpaid` / `pending_confirm` / `confirmed` / `refunded`

金额字段：

- `deposit_amount`
- `base_price`
- `adjustment`
- `payable_price`

均使用整数分。

## Auth and Roles

登录链路：

```text
POST /api/auth/wechat/login
  -> mock或微信jscode2session得到openid
  -> upsert users
  -> ensure user_roles(player)
  -> if openid in BOOTSTRAP_ADMIN_OPENIDS ensure user_roles(system_admin)
  -> sign token
```

Token：

- HMAC SHA-256签名。
- 载荷包含 `sub`、`openid`、`roles`、`iat`、`exp`。
- 接口授权时重新读取数据库角色，避免旧token保留已移除权限。

角色判断：

| 能力 | 规则 |
| --- | --- |
| 录入店家/剧本 | `system_admin` |
| 审核新增资料申请 | `system_admin` |
| 创建车 | 登录用户，自动获得 `organizer` |
| 发布车 | 本车 `organizer_user_id` 或 `system_admin` |
| 查看报名 | 本车 `organizer_user_id` 或 `system_admin` |
| 报名 | 登录用户 |
| 演绎档案 | 登录用户，自动获得 `performer` |

## API Design

### Auth

| Method | Path | 权限 | 行为 |
| --- | --- | --- | --- |
| `POST` | `/api/auth/wechat/login` | public | 登录写库并签发token |
| `POST` | `/api/auth/wechat/phone` | auth | 写入手机号加密占位 |
| `GET` | `/api/users/me` | auth | 当前用户与角色 |

### Admin Catalog

| Method | Path | 权限 | 行为 |
| --- | --- | --- | --- |
| `POST` | `/api/admin/stores` | `system_admin` | 创建店家 |
| `PATCH` | `/api/admin/stores/:id` | `system_admin` | 更新店家 |
| `POST` | `/api/admin/scripts` | `system_admin` | 创建剧本 |
| `PATCH` | `/api/admin/scripts/:id` | `system_admin` | 更新剧本 |
| `GET` | `/api/admin/catalog-requests` | `system_admin` | 查看新增申请 |
| `PATCH` | `/api/admin/catalog-requests/:id` | `system_admin` | 审核申请 |

### Public Catalog

| Method | Path | 权限 | 行为 |
| --- | --- | --- | --- |
| `GET` | `/api/stores` | public | active店家列表 |
| `GET` | `/api/scripts` | public | active剧本列表 |
| `POST` | `/api/catalog-requests` | auth | 提交新增资料申请 |
| `POST` | `/api/entity-claims` | auth | 提交认领申请 |
| `POST` | `/api/performer-profiles` | auth | 创建/更新演绎档案 |

### Sessions and Seats

| Method | Path | 权限 | 行为 |
| --- | --- | --- | --- |
| `POST` | `/api/sessions` | auth | 创建草稿车 |
| `GET` | `/api/sessions/:id` | public | 查看车详情 |
| `PATCH` | `/api/sessions/:id` | owner/admin | 编辑草稿车 |
| `POST` | `/api/sessions/:id/publish` | owner/admin | 发布并校验补贴 |
| `POST` | `/api/sessions/:id/seats` | owner/admin | 创建座位 |
| `PATCH` | `/api/session-seats/:id` | owner/admin | 更新座位 |
| `POST` | `/api/session-seats/:id/lock` | owner/admin | 锁座 |

### Signups

| Method | Path | 权限 | 行为 |
| --- | --- | --- | --- |
| `POST` | `/api/signups` | auth | 申请上车 |
| `GET` | `/api/users/me/signups` | auth | 我的报名 |
| `GET` | `/api/sessions/:id/signups` | owner/admin | 本车报名 |
| `PATCH` | `/api/signups/:id/approve` | owner/admin | 审核通过事务 |
| `PATCH` | `/api/signups/:id/reject` | owner/admin | 拒绝报名 |
| `PATCH` | `/api/signups/:id/deposit` | owner/admin | 更新押金 |

### Events

| Method | Path | 权限 | 行为 |
| --- | --- | --- | --- |
| `POST` | `/api/share-events/view` | public | 分享访问 |
| `POST` | `/api/share-events/convert` | public/auth | 分享转化 |
| `POST` | `/api/subscriptions/request-result` | auth | 订阅请求结果 |

## Key Transactions

### Publish Session

```text
begin
  select seats for session
  require count > 0
  require sum(adjustment) = 0
  require every payable_price >= 0
  update sessions.status = recruiting
commit
```

### Approve Signup

```text
begin
  select signup for update
  select seat for update
  require seat has no confirmed_user_id
  reject other pending signups for same seat
  update signup.status = approved
  update seat.status = confirmed, confirmed_user_id = signup.user_id
commit
```

### Lock Seat

```text
begin
  select seat for update
  require seat.status = confirmed
  update seat.status = locked
commit
```

## Smoke Test

D2新增：

```text
npm run d2:smoke
```

烟测覆盖：

- 管理员登录并获得 `system_admin`。
- 普通用户不能创建管理员资料。
- 管理员创建店家和剧本。
- 公共列表可读取 active 资料。
- 普通用户提交新增资料申请和演绎档案。
- 普通用户创建车并获得 `organizer`。
- 车头创建座位、发布车、查看报名。
- 玩家报名，车头审核通过、更新押金、锁座。
- 分享事件、订阅请求、认领申请可写入。

## D3 Entry Gate

D3可以开始的条件：

- D2迁移可重复执行。
- 登录写库可用。
- 当前用户接口可用。
- 管理员权限可拦截普通用户。
- 店家/剧本基础CRUD可用。
- 建车、座位、发布、报名、审核、锁座接口骨架可用。
- D2烟测通过。
