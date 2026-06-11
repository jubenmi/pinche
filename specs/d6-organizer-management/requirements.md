# D6 Requirements: 车头管理

更新日期：2026-06-12

## Requirements

### Requirement 1: 我的发车

1. WHEN 车头登录 THEN 系统 SHALL 展示自己创建的车。
2. WHEN 非车头访问他人管理页 THEN 系统 SHALL 拒绝联系方式和审核能力。

### Requirement 2: 审核报名

1. WHEN 车头查看报名 THEN 系统 SHALL 展示本车申请列表。
2. WHEN 车头通过申请 THEN 系统 SHALL 在事务中确认座位并拒绝同座其他 pending 申请。
3. WHEN 车头拒绝申请 THEN 系统 SHALL 更新报名为 `rejected`。
4. WHEN 座位已确认或锁座 THEN 系统 SHALL 阻止其他玩家被确认。

### Requirement 3: 押金和锁座

1. WHEN 车头更新押金状态 THEN 系统 SHALL 保存 `unpaid`、`pending_confirm`、`confirmed` 或 `refunded`。
2. WHEN 座位状态为 `confirmed` THEN 车头 SHALL 能锁座。
3. WHEN 座位不是 `confirmed` THEN 系统 SHALL 阻止锁座。

### Requirement 4: D6交付物

1. WHEN D6完成 THEN SHALL 完成管理页、审核接口联调、押金状态、锁座接口联调。
2. WHEN D6完成 THEN SHALL 通过D6烟测和微信开发者工具验证。
