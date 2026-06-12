# D6 Design: 车头管理设计

更新日期：2026-06-12

## Flow

```text
GET /api/users/me/sessions
GET /api/sessions/:id/signups
PATCH /api/signups/:id/approve
PATCH /api/signups/:id/reject
PATCH /api/signups/:id/deposit
POST /api/session-seats/:id/lock
```

## Pages

- `pages/mine/index`：登录后展示“我的发车”，每辆车显示状态、座位数、待审数，并进入管理页。
- `pages/session/manage`：车头查看申请联系方式、审核申请、更新押金状态、锁座。

## State Rules

- 通过一个申请后，该座位变为 `confirmed`，同座位其他 `pending` 申请自动变为 `rejected`。
- 拒绝一个申请后，如果该座位没有其他 `pending` 或 `approved` 申请，且座位仍为 `applied`，则座位回到 `open`。
- 押金状态只更新报名记录：`unpaid | pending_confirm | confirmed | refunded`。
- 锁座只允许从 `confirmed` 座位进入 `locked`。

## Security

- 报名联系方式只在 owner/admin 接口返回或展示。
- 审核、押金、锁座都要求本车车头或 system_admin。
- 审核通过和锁座使用数据库事务。
