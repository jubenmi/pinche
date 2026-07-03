# D14 Requirements: 上车审核与订阅通知

更新日期：2026-07-03

## Requirements

### Requirement 1: 所有上车必须审核

1. WHEN 玩家在已发布车局选择角色 THEN 系统 SHALL 创建 `pending` 上车申请，而不是直接确认座位。
2. WHEN 车局已经发车且仍有空位 THEN 玩家补位 SHALL 仍然创建 `pending` 上车申请。
3. WHEN 申请未被车头通过 THEN 系统 SHALL NOT 把玩家写入 `session_seats.confirmed_user_id`。
4. WHEN 申请未被车头通过 THEN 系统 SHALL NOT 授予该玩家按角色或同车成员控制的相册权限。
5. WHEN 座位状态为 `open` THEN 提交申请 SHALL 把座位状态更新为 `applied`。

### Requirement 2: 禁止普通玩家绕过审核

1. WHEN 普通玩家调用直接占座接口 THEN 系统 SHALL 拒绝该玩家直接成为已确认成员。
2. WHEN 普通玩家尝试发车后直接占空位 THEN 系统 SHALL 拒绝该绕过审核的操作。
3. WHEN 需要确认成员身份 THEN 系统 SHALL 只通过车头或管理员审核申请完成。

### Requirement 3: 车头新申请提醒

1. WHEN 玩家成功创建上车申请 AND 车头订阅了新申请提醒 THEN 系统 SHOULD 向车头下发微信订阅消息。
2. WHEN 新申请提醒模板未配置或通知能力未启用 THEN 系统 SHALL 跳过通知且不影响申请创建。
3. WHEN 新申请通知下发 THEN 消息 SHALL 跳转到该车局的车头管理页。

### Requirement 4: 玩家审核结果提醒

1. WHEN 车头通过申请 AND 玩家订阅了审核结果提醒 THEN 系统 SHOULD 向玩家下发通过结果订阅消息。
2. WHEN 车头拒绝申请 AND 玩家订阅了审核结果提醒 THEN 系统 SHOULD 向玩家下发拒绝结果订阅消息。
3. WHEN 审核结果提醒模板未配置或通知能力未启用 THEN 系统 SHALL 跳过通知且不影响审核结果。
4. WHEN 审核结果通知下发 THEN 消息 SHALL 跳转到该车局详情页。

### Requirement 5: 订阅请求合规

1. WHEN 小程序请求订阅 THEN 系统 SHALL 只在明确业务动作后请求对应场景模板。
2. WHEN 用户拒绝订阅 THEN 小程序 SHALL 继续完成申请或管理主流程。
3. WHEN 订阅请求结束 THEN 小程序 SHALL 记录订阅请求结果。
4. WHEN 订阅消息内容生成 THEN 系统 SHALL 保持内容与订阅用途一致，不发送营销、奖励或诱导分享内容。

### Requirement 6: D14交付物

1. WHEN D14完成 THEN SHALL 完成小程序申请流程、车头管理提醒入口、后端通知配置和下发模块。
2. WHEN D14完成 THEN SHALL 更新直接占座相关 smoke/static 检查，确保普通玩家不能绕过审核。
3. WHEN D14完成 THEN SHALL 通过相关 smoke、静态检查和小程序构建检查。
