# D0需求冻结

更新日期：2026-06-11

本文是MVP进入开发前的D0冻结交付物。D0完成后，D1开始不得随意扩大MVP范围；新想法进入后续版本池。

开发执行以spec目录为准：

- [D0 Spec README](../specs/d0-requirements-freeze/README.md)
- [D0 Requirements](../specs/d0-requirements-freeze/requirements.md)
- [D0 Design](../specs/d0-requirements-freeze/design.md)
- [D0 Tasks](../specs/d0-requirements-freeze/tasks.md)

## 1. MVP目标

MVP只验证一条主链路：

```text
系统管理员录入店家/剧本
  -> 车头选择店家/剧本建车
  -> 车头配置座位和补贴
  -> 车头发布并分享
  -> 玩家从分享页申请上车
  -> 车头审核申请
  -> 车头锁座并标记押金状态
```

成功标准：

- 管理员能维护早期可选店家和剧本。
- 车头不需要拉群手算，也能完成发车配置。
- 玩家从微信分享页进入后能看懂实付价并申请。
- 车头能完成审核、锁座、押金状态记录。

## 2. MVP需求清单

### 必做

- 微信登录。
- 用户身份：
  - 玩家。
  - 车头。
  - DM/NPC。
  - 系统管理员。
- 系统管理员：
  - 录入店家。
  - 录入剧本。
  - 审核新增资料申请。
  - 下架错误或违规资料。
- 车头：
  - 选择管理员已录入的剧本。
  - 选择管理员已录入的店家。
  - 找不到剧本/店家时提交新增资料申请。
  - 填写DM/NPC本车快照。
  - 创建车。
  - 配置座位和补贴。
  - 发布车。
  - 分享车。
  - 审核玩家申请。
  - 锁座/取消锁座。
  - 标记押金状态。
- 玩家：
  - 从分享页进入。
  - 查看车详情。
  - 选择座位。
  - 填写报名信息。
  - 授权手机号或手动填写联系方式。
  - 提交申请。
- 分享与埋点：
  - 微信分享卡片。
  - 复制招募文案。
  - 简单海报。
  - 分享访问记录。
  - 报名转化记录。

### 不做

- 微信支付。
- 现金红包。
- 分享奖励。
- 订阅奖励。
- 返现、提现、补贴倒返。
- 店家完整后台。
- DM/NPC完整后台。
- 发行商完整后台。
- 自动分账。
- 评价体系。
- 黑名单系统。
- 推荐算法。
- 站内聊天。
- 复杂公开车列表。
- 车头直接创建公开店家/剧本资料。

## 3. 页面列表

### 小程序页面

| 页面 | 使用者 | D0范围 |
| --- | --- | --- |
| 首页 | 车头/玩家 | 展示入口：建车、我的、可选车详情入口 |
| 我的 | 全部用户 | 登录状态、我的报名、我的发车、管理员入口 |
| 管理员店家录入页 | 系统管理员 | 创建/编辑/下架店家 |
| 管理员剧本录入页 | 系统管理员 | 创建/编辑/下架剧本 |
| 管理员新增资料申请页 | 系统管理员 | 审核车头提交的店家/剧本新增申请 |
| 建车页 | 车头 | 选择剧本、选择店家、设置时间、DM/NPC快照、押金 |
| 座位配置页 | 车头 | 配置座位、原价、补贴调整、实付价 |
| 车详情/分享页 | 玩家/车头 | 展示车况、座位、实付价、押金、申请入口 |
| 申请上车页 | 玩家 | 填写报名信息并提交 |
| 我的车/车头管理页 | 车头 | 审核申请、锁座、押金状态 |

### MVP页面收敛

为了减少开发量，可以合并为：

```text
pages/index/index
pages/mine/index
pages/admin/catalog
pages/session/create
pages/session/detail
pages/session/apply
pages/session/manage
```

其中 `pages/admin/catalog` 用 tabs 或 segmented control 切换：

```text
店家
剧本
新增申请
```

## 4. 角色与权限

### 角色

```text
player
organizer
performer
store_admin
publisher_admin
system_admin
```

### 权限矩阵

| 功能 | 未登录 | 玩家 | 车头 | DM/NPC | 系统管理员 |
| --- | --- | --- | --- | --- | --- |
| 查看分享页 | 可看公开信息 | 可看 | 可看 | 可看 | 可看 |
| 申请上车 | 需登录 | 可 | 可 | 可 | 可 |
| 创建车 | 不可 | 可成为车头 | 可 | 可 | 可 |
| 发布车 | 不可 | 仅自己的车 | 仅自己的车 | 仅自己的车 | 可协助排查 |
| 审核报名 | 不可 | 不可 | 仅自己的车 | 不可 | 可协助排查 |
| 查看联系方式 | 不可 | 仅自己的报名 | 仅自己的车 | 不可 | 原则不看，除非排查 |
| 录入店家 | 不可 | 不可 | 不可 | 不可 | 可 |
| 录入剧本 | 不可 | 不可 | 不可 | 不可 | 可 |
| 审核新增资料申请 | 不可 | 不可 | 不可 | 不可 | 可 |

## 5. 状态机

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

说明：

- MVP由系统管理员创建资料，默认 `claim_status = unclaimed`。
- `active/inactive` 决定车头能否选择。
- 认领流程预留，不进入MVP主链路。

### 新增资料申请状态

```text
pending
  -> approved
  -> rejected
```

规则：

- 车头找不到店家或剧本时提交申请。
- 管理员通过后创建正式 `Store` 或 `Script`。
- 管理员驳回时必须填写原因。

### 车状态

```text
draft
  -> recruiting
  -> locked
  -> cancelled
```

规则：

- `draft`：未发布，可编辑。
- `recruiting`：已发布，可分享，可报名。
- `locked`：车头锁车，不再接受申请。
- `cancelled`：取消后不可报名。

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
- `applied`：已有待审核申请。
- `confirmed`：车头通过某个玩家。
- `locked`：锁座完成。
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

- 一个玩家可申请一个座位。
- 同一座位只能有一个最终通过玩家。
- 审核通过和座位确认必须在同一个事务里完成。

### 押金状态

```text
none
  -> offline_pending
  -> offline_confirmed
  -> refunded
  -> forfeited
```

规则：

- MVP不接微信支付。
- 押金状态只记录线下确认结果。
- 押金规则必须在报名前展示。

## 6. 核心公式

```text
payablePrice = basePrice + adjustment
sum(sessionSeats.adjustment) = 0
payablePrice >= 0
```

解释：

- `adjustment > 0`：该座位多付，承担补贴。
- `adjustment < 0`：该座位少付，享受低实付。
- `adjustment = 0`：正常价格。
- 不允许负实付。
- 不允许倒返钱、返现、提现。

## 7. 管理员录入字段清单

### 店家 Store

必填：

```text
name
city
district
status: active | inactive
```

选填：

```text
address
businessHours
contactNote
adminNote
```

系统字段：

```text
id
claimStatus: unclaimed | pending | claimed | rejected
createdByAdminUserId
claimedByUserId
createdAt
updatedAt
```

### 剧本 Script

必填：

```text
name
typeTags
playerCount
status: active | inactive
```

选填：

```text
summaryNoSpoiler
defaultDurationMinutes
defaultSeatTemplate
adminNote
```

禁止录入：

```text
剧本正文
剧透角色信息
角色卡全文
未授权封面图
```

系统字段：

```text
id
claimStatus: unclaimed | pending | claimed | rejected
createdByAdminUserId
claimedByUserId
createdAt
updatedAt
```

### 新增资料申请 CatalogRequest

```text
requestType: store | script
requestedByUserId
name
city
district
description
status: pending | approved | rejected
reviewedByAdminUserId
reviewNote
createdEntityId
createdAt
reviewedAt
```

## 8. API清单草案

### 登录

```text
POST /auth/wechat-login
POST /auth/wechat-phone
```

### 管理员资料

```text
POST /admin/stores
PATCH /admin/stores/:id
GET /admin/stores

POST /admin/scripts
PATCH /admin/scripts/:id
GET /admin/scripts

GET /admin/catalog-requests
PATCH /admin/catalog-requests/:id
```

### 公开资料选择

```text
GET /stores
GET /scripts
POST /catalog-requests
```

### DM/NPC

```text
POST /performer-profiles
GET /performer-profiles
```

### 车

```text
POST /sessions
GET /sessions/:id
PATCH /sessions/:id
POST /sessions/:id/publish
POST /sessions/:id/seats
PATCH /seats/:id
```

### 报名与审核

```text
POST /signups
GET /sessions/:id/signups
PATCH /signups/:id/approve
PATCH /signups/:id/reject
PATCH /signups/:id/deposit
```

### 分享与订阅

```text
POST /share-events/view
POST /share-events/convert
POST /subscriptions/request-result
```

### 认领预留

```text
POST /entity-claims
GET /entity-claims/:id
```

## 9. 合规冻结

MVP明确不做：

- 分享后解锁。
- 分享奖励。
- 订阅奖励。
- 现金红包。
- 抽奖。
- 返现、提现、倒返钱。
- 现实陪伴承诺。
- 公开联系方式。
- 未授权剧本素材展示。
- 隐藏功能绕审核。

公开文案默认使用：

```text
情感沉浸位
演绎互动位
指定DM/NPC
座位实付
线下押金状态
```

## 10. D0验收清单

```text
[x] MVP需求清单完成
[x] 页面列表完成
[x] 状态机完成
[x] API清单草案完成
[x] 管理员录入字段清单完成
[x] 系统管理员录入店家/剧本的口径完成
[x] 车头不能直接创建公开店家/剧本的口径完成
[x] 微信合规禁区完成
```
