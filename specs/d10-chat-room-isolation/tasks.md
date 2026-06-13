# D10 Tasks: 聊天房间隔离检查执行清单

更新日期：2026-06-12

- [ ] D10.1 建立或调整聊天房间 migration，新增 `session_chat_rooms`。
- [ ] D10.2 将 `session_messages` 绑定到 `room_id`，保留或迁移旧 `session_id` 数据。
- [ ] D10.3 将 `sessions.pinned_message_text` 迁移为 `session_messages.message_type = 'pinned'`。
- [ ] D10.4 实现按车局 ID 获取唯一聊天房间的服务函数。
- [ ] D10.5 调整消息列表和发送逻辑，所有 SQL 按 room id 隔离。
- [ ] D10.6 调整置顶接口，保证一房一置顶且 `sender_user_id = organizer_user_id`。
- [ ] D10.7 调整小程序详情页和管理页，置顶内容来自聊天接口。
- [ ] D10.8 增加静态检查脚本，禁止继续依赖 `pinned_message_text`。
- [ ] D10.9 增加 smoke 脚本，覆盖两个车局互相不可见。
- [ ] D10.10 增加数据库检查项，验证一车一房、一房一置顶、置顶作者为车头。
- [ ] D10.11 在微信开发者工具中验证详情页、管理页和 403 状态。

## Verification Target

- `npm run check`：通过。
- `npm run d10:check`：通过。
- `npm run d10:smoke`：通过。
- 数据库隔离检查 SQL：全部返回空结果。
- 微信开发者工具：本车聊天可见，其他车聊天不可见，置顶帖显示为车头发布。
