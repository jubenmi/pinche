# D4 Design: 车头建车流程设计

更新日期：2026-06-12

## Overview

D4不新增数据库表，复用D2已建立的 `sessions` 和 `session_seats`。小程序建车页负责一次性收集表单和座位列表，提交时按后端现有事务边界执行：

```text
POST /api/sessions
  -> POST /api/sessions/:id/seats * n
  -> POST /api/sessions/:id/publish
  -> navigateTo detail
```

后端仍是最终校验点，前端实时计算只用于提升体验。

## Data Mapping

### Session

| UI字段 | API字段 | 说明 |
| --- | --- | --- |
| 店家 | `storeId` | 只能来自 active 店家列表 |
| 剧本 | `scriptId` | 只能来自 active 剧本列表 |
| 开车时间 | `startAt` | MVP使用文本输入，格式 `YYYY-MM-DD HH:mm:ss` |
| 指定DM | `dmNameSnapshot` | 手填快照，不展示认证 |
| 指定NPC | `npcNameSnapshot` | 手填快照，不展示认证 |
| 押金金额 | `depositAmount` | 前端按元展示，提交为分 |
| 备注 | `note` | 不应包含联系方式或违规承诺 |

### Seat

| UI字段 | API字段 | 说明 |
| --- | --- | --- |
| 座位名 | `name` | 如“情感沉浸位”“F4-1” |
| 座位类型 | `seatType` | `love_companion`、`f4`、`cp`、`support`、`normal` |
| 角色名 | `roleName` | 公开页不使用暧昧承诺 |
| 原价 | `basePrice` | 分 |
| 调整 | `adjustment` | 分，正数为多付，负数为少付 |
| 实付 | `payablePrice` | 后端计算并保存 |

## Frontend Flow

1. `onMounted` 加载 active 店家和剧本。
2. 选择剧本后调用 `applyScriptTemplate()`：
   - 优先解析 `default_seat_template_json`。
   - 无模板则应用本地默认5人模板。
3. 车头可新增、删除、编辑座位。
4. `computed` 派生：
   - `adjustmentSum`
   - `payableTotal`
   - `hasNegativePayable`
   - `canPublish`
5. 发布时执行 `publishSession()`：
   - 本地校验。
   - 创建 session。
   - 顺序创建 seat，避免并发错误难以回滚。
   - 调用 publish。
   - 成功后跳转车详情。

## Validation

前端校验：

```text
登录存在
storeId存在
scriptId存在
startAt存在
seats.length > 0
sum(adjustment) == 0
every basePrice >= 0
every payablePrice >= 0
depositAmount >= 0
```

后端校验：

```text
store.status == active
script.status == active
owner/admin 权限
至少一个座位
sum(adjustment) == 0
payable_price >= 0
```

## Compliance Notes

- 默认公开文案使用“情感沉浸位”“指定DM/NPC”“座位价格调整”“实付价”。
- 页面不出现现金红包、返现、提现、分享奖励、现实陪伴承诺。
- 押金只记录线下锁位状态，不做平台代收。
- DM/NPC手填名只作为快照，不展示头像、主页或认证。

## Verification

自动验证：

```text
npm run check
npm run d4:smoke
npm run build:mp-weixin
```

微信开发者工具验证：

```text
1. 编译无业务错误。
2. 登录后进入建车页。
3. 选择店家和剧本，应用模板。
4. 修改座位补贴，观察合计实时变化。
5. 不配平时发布被阻止。
6. 配平后发布并跳转车详情页。
```
