# D10 Requirements: 聊天房间隔离检查

更新日期：2026-06-12

## Requirements

### Requirement 1: 一车一房

1. WHEN 车局创建成功 THEN 系统 SHALL 为该车局创建一个聊天房间。
2. WHEN 查询任意车局聊天 THEN 系统 SHALL 通过车局 ID 找到唯一聊天房间。
3. WHEN 数据库中存在同一车局多个聊天房间 THEN 检查脚本 SHALL 报错。
4. WHEN 聊天 API 返回房间信息 THEN 前端 SHALL 不依赖可猜测的公开 room id 来读取其他房间。

### Requirement 2: 消息归属

1. WHEN 用户发送聊天消息 THEN 消息 SHALL 写入该车局唯一聊天房间。
2. WHEN 系统生成踢人、取消等系统消息 THEN 消息 SHALL 写入该车局唯一聊天房间。
3. WHEN 查询聊天消息 THEN SQL SHALL 按当前车局对应的 room id 过滤。
4. WHEN 消息表存在未绑定房间的聊天消息 THEN 检查脚本 SHALL 报错。

### Requirement 3: 单一置顶帖

1. WHEN 车局进入可分享或可报名状态 THEN 该车局聊天房间 SHALL 有且只有一个当前置顶帖。
2. WHEN 车头保存置顶内容 THEN 系统 SHALL 在聊天消息表中创建或更新该房间的置顶帖。
3. WHEN 保存置顶帖 THEN 置顶帖 `sender_user_id` SHALL 等于该车局 `organizer_user_id`。
4. WHEN 普通玩家尝试创建、更新或删除置顶帖 THEN API SHALL 返回禁止访问。
5. WHEN 一个房间存在多个当前置顶帖 THEN 检查脚本 SHALL 报错。
6. WHEN 前端展示置顶内容 THEN 前端 SHALL 从聊天房间的置顶消息读取，不再从 `sessions.pinned_message_text` 读取。

### Requirement 4: 房间访问隔离

1. WHEN 车头访问自己车局聊天 THEN API SHALL 允许读取和发送消息。
2. WHEN 已确认或已锁座玩家访问本车局聊天 THEN API SHALL 允许读取和发送普通消息。
3. WHEN 待审核、被拒绝、被踢出或不属于该车局的用户访问聊天 THEN API SHALL 返回禁止访问。
4. WHEN 用户属于车局 A 但不属于车局 B THEN 用户 SHALL 不能读取、发送或看到车局 B 的任何聊天消息。
5. WHEN 后台管理员访问聊天 THEN API MAY 允许管理访问，但小程序普通入口 SHALL 不主动展示非本人车局聊天。

### Requirement 5: 取消和下车后的行为

1. WHEN 车局已取消 THEN API SHALL 拒绝新的普通聊天消息。
2. WHEN 车局已取消 THEN 已有合法成员 MAY 继续查看历史聊天，用于确认取消通知。
3. WHEN 玩家被踢出或座位释放 THEN 玩家 SHALL 立即失去该房间聊天访问权限。
4. WHEN 玩家失去访问权限 THEN 前端 SHALL 停止轮询该房间并清空本页聊天输入状态。

### Requirement 6: 检查交付物

1. WHEN D10 完成 THEN SHALL 有静态检查脚本覆盖数据表、API 和前端字段引用。
2. WHEN D10 完成 THEN SHALL 有 smoke 脚本覆盖两个车局之间的聊天隔离。
3. WHEN D10 完成 THEN SHALL 有数据库检查项验证一车一房、一房一置顶、置顶作者为车头。
4. WHEN D10 完成 THEN SHALL 更新微信开发者工具可运行页面，聊天区域显示置顶帖和本房间消息。
