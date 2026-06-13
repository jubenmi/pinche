# D10 Design: 聊天房间隔离检查

更新日期：2026-06-12

## Current State

当前实现已经有 `session_messages`，并且普通聊天消息按 `session_id` 查询。这等价于“隐式房间”，但还没有显式的聊天房间模型。

当前置顶内容保存在 `sessions.pinned_message_text` 和 `sessions.pinned_message_updated_at`。这不符合“置顶聊天对话应该在聊天数据库里”的要求，也不方便检查“每个车房间只有一个置顶帖，且必须由车头发”。

## Target Model

D10 将聊天建模为显式房间：

```text
sessions
  1 -> 1 session_chat_rooms
          1 -> many session_messages
          1 -> 1 current pinned session_messages row
```

建议新增或调整为：

- `session_chat_rooms`
  - `id`
  - `session_id`，唯一索引，保证一车一房。
  - `pinned_message_id`，指向当前唯一置顶帖。
  - `status`
  - `created_at`
  - `updated_at`
- `session_messages`
  - `id`
  - `room_id`
  - `sender_user_id`
  - `message_type`：`normal`、`pinned`、`system`。
  - `content`
  - `status`
  - `created_at`
  - `updated_at`

`sessions.start_at` 继续作为车局时间来源，不在聊天房间里重复建时间字段。

## Pinned Post Rule

每个房间只有一个当前置顶帖。置顶帖不是 `sessions` 上的一段文本，而是 `session_messages` 里的 `message_type = 'pinned'` 消息。

创建或更新置顶帖时：

- 必须先通过 `requireSessionOwner`，只有车头和后台管理员可调用。
- 实际写入的 `sender_user_id` 必须是车局 `organizer_user_id`，保证“置顶帖是车头发的”。
- 如果该房间还没有置顶帖，则创建一条 pinned 消息并写入 `session_chat_rooms.pinned_message_id`。
- 如果该房间已有置顶帖，则更新同一条 pinned 消息内容，不创建第二条当前置顶帖。
- 前端展示的置顶内容来自聊天接口返回的 `pinnedMessage`。

## Access Control

所有聊天读写都先通过车局 ID 进入：

```text
GET /api/sessions/:id/chat
POST /api/sessions/:id/messages
PATCH /api/sessions/:id/chat/pin
```

服务端按顺序执行：

1. 根据 `:id` 读取 `sessions`。
2. 根据 `sessions.id` 读取唯一 `session_chat_rooms`。
3. 校验当前用户是否是后台管理员、车头，或本车已确认/锁座玩家。
4. 只使用该 room id 查询或写入 `session_messages`。

API 不接受客户端传入的任意 room id 来切换房间。即使未来接口返回 room id，服务端也必须用 session id 和成员关系重新校验房间归属。

## API Shape

聊天页建议读取一个聚合接口：

```json
{
  "room": {
    "id": 1,
    "session_id": 10,
    "status": "active"
  },
  "pinnedMessage": {
    "id": 20,
    "message_type": "pinned",
    "sender_user_id": 3,
    "sender_label": "车头",
    "content": "周六 19:30 店门口集合",
    "created_at": "2026-06-12T10:00:00.000Z",
    "updated_at": "2026-06-12T10:05:00.000Z"
  },
  "messages": []
}
```

普通消息列表可以继续保留 `/api/sessions/:id/messages`，但返回内容必须来自该车局唯一 room id。置顶帖不混入普通消息列表，避免重复展示。

## Frontend Behavior

车局详情页：

- 进入页面后读取当前车局聊天房间。
- 展示 `pinnedMessage.content`。
- 只轮询当前车局的消息接口。
- 遇到 403 时停止轮询并隐藏聊天输入。

车头管理页：

- 置顶输入框保存到聊天置顶接口。
- 保存成功后展示返回的 `pinnedMessage`。
- 不再读写 `session.pinned_message_text`。

## Check Strategy

静态检查：

- migration 中存在 `session_chat_rooms`。
- `session_chat_rooms.session_id` 有唯一约束。
- `session_chat_rooms.pinned_message_id` 指向 `session_messages`。
- `session_messages` 有 `room_id` 和 `message_type`。
- 前端不再引用 `pinned_message_text`。

Smoke 检查：

1. 创建车局 A 和车局 B。
2. 车头 A 创建或更新车局 A 的置顶帖。
3. 数据库验证车局 A 房间只有一个置顶帖，且 `sender_user_id = organizer_user_id`。
4. 玩家 A 上车后可以读取和发送车局 A 消息。
5. 玩家 A 访问车局 B 聊天返回 403。
6. 车局 B 的聊天内容不会出现在车局 A 返回结果中。
7. 待审核玩家、被踢玩家、非成员访问任意房间返回 403。
8. 车局取消后普通消息发送返回 400 或等价业务错误，历史消息仍可被原合法成员查看。

数据库检查：

```sql
SELECT session_id, COUNT(*) AS room_count
FROM session_chat_rooms
GROUP BY session_id
HAVING room_count <> 1;
```

```sql
SELECT room.id AS room_id, COUNT(message.id) AS pinned_count
FROM session_chat_rooms room
LEFT JOIN session_messages message
  ON message.id = room.pinned_message_id
  AND message.room_id = room.id
  AND message.message_type = 'pinned'
  AND message.status = 'active'
GROUP BY room.id
HAVING pinned_count <> 1;
```

```sql
SELECT room_id, COUNT(*) AS active_pinned_count
FROM session_messages
WHERE message_type = 'pinned'
  AND status = 'active'
GROUP BY room_id
HAVING active_pinned_count <> 1;
```

```sql
SELECT room.id AS room_id, pinned.id AS pinned_message_id
FROM session_chat_rooms room
JOIN sessions session ON session.id = room.session_id
JOIN session_messages pinned ON pinned.id = room.pinned_message_id
WHERE pinned.sender_user_id <> session.organizer_user_id;
```

以上四个查询都必须返回空结果。

## Migration Notes

现有 `session_messages.session_id` 数据需要迁移到新 room：

1. 为每个已有 `sessions.id` 创建一个 `session_chat_rooms`。
2. 为 `session_messages` 增加 `room_id`，根据旧 `session_id` 回填。
3. 将现有 `sessions.pinned_message_text` 转成一条 pinned 消息，发送人为 `sessions.organizer_user_id`，并写入 `session_chat_rooms.pinned_message_id`。
4. 前后端全部切到 room/pinned message 后，再停止使用 `sessions.pinned_message_text`。

## Out Of Scope

- 不做真实 WebSocket。
- 不做已读、撤回、图片和语音。
- 不新增聊天时间字段，车局时间继续使用 `sessions.start_at`。
