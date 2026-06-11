# D6 Design: 车头管理设计

更新日期：2026-06-12

## Flow

```text
GET /api/sessions/:id/signups
PATCH /api/signups/:id/approve
PATCH /api/signups/:id/reject
PATCH /api/signups/:id/deposit
POST /api/session-seats/:id/lock
```

## Security

- 报名联系方式只在 owner/admin 接口返回或展示。
- 审核、押金、锁座都要求本车车头或 system_admin。
- 审核通过和锁座使用数据库事务。
