# Session Extension Pseudo Chat Design

更新日期：2026-06-13

## 背景

当前伪聊天能力已经不是单纯的前端假 UI。它包含：

- 后端 `session_chat_rooms` 和 `session_messages` 数据模型。
- 一车一房、一房一置顶、消息按房间隔离。
- 车头、管理员、已确认或已锁座玩家的访问控制。
- 小程序详情页的聊天入口、弹窗、轮询、未读数和发送。
- 小程序管理页的置顶信息编辑。
- 取消车、踢出座位时写入系统消息。

这些逻辑现在分散在 `core/service.js`、`server.js`、`detail.vue` 和 `manage.vue`。本次目标是把伪聊天提取成项目内第一个 session extension，让它作为“小程序扩展系统”的样板存在。扩展源码放入 Git submodule：

```text
packages/talk -> git@github.com:jubenmi/talk.git
```

## 目标

1. 建立轻量 session extension 机制，支持宿主按扩展注册表挂载详情页和管理页能力。
2. 将伪聊天拆成 `packages/talk` Git submodule 中的独立扩展模块，保留现有业务行为和 API 语义。
3. 保持当前数据库结构和 D10 聊天隔离规则，不引入新数据模型风险。
4. 让后续扩展，例如公告板、投票、任务卡，可以沿用同一注册和挂载方式。
5. 降低 `detail.vue`、`manage.vue`、`core/service.js` 的聊天耦合。

## 非目标

- 不做微信小程序原生插件。
- 不做远程动态加载扩展。
- 不做完整插件权限沙箱、生命周期市场或热插拔平台。
- 不把 `jubenmi/talk` 做成独立后端服务；它仍以包/源码模块形式被当前项目加载。
- 不改成 WebSocket，继续保留当前轮询策略。
- 不新增图片、语音、撤回、已读回执等聊天功能。
- 不重做 D10 数据库语义。

## 推荐方案

采用轻量项目内扩展注册表。

后端将聊天房间、消息、置顶和系统消息移动到 `packages/talk` 提供的 `session-pseudo-chat` 扩展模块。API 路由仍保持：

```text
GET /api/sessions/:id/chat
GET /api/sessions/:id/messages
POST /api/sessions/:id/messages
PATCH /api/sessions/:id/chat/pin
```

前端将聊天入口、弹窗、轮询和管理页置顶编辑移动到 `packages/talk` 的扩展组件。宿主页面只负责传入 `session`、`sessionId` 和用户上下文，并渲染扩展挂载点。

这个方案比只抽组件更有扩展价值，也比完整插件运行时更适合当前 MVP。

## 后端设计

### Submodule 位置

主仓库新增 Git submodule：

```text
packages/talk
```

`.gitmodules` 指向：

```text
git@github.com:jubenmi/talk.git
```

`packages/talk` 是 talk 扩展源码的来源。主仓库内保留薄适配层，用来注册扩展、稳定导入路径，并隔离未来 submodule 内部结构变化。

### 文件结构

主仓库建议新增：

```text
apps/api/src/modules/extensions/registry.js
apps/api/src/modules/extensions/session-pseudo-chat/index.js
apps/api/src/modules/core/session-access.js
packages/talk
```

`session-access.js` 放宿主和扩展都会用到的最小核心能力：

- `isAdmin(user)`
- `requireSessionOwner(connection, sessionId, user)`
- `requireSessionParticipant(connection, sessionId, user)`
- `findSessionById(connection, sessionId)`

`packages/talk` 建议提供：

```text
packages/talk/package.json
packages/talk/api/index.js
packages/talk/api/service.js
packages/talk/api/routes.js
packages/talk/miniprogram/index.js
packages/talk/miniprogram/api.js
packages/talk/miniprogram/ChatEntry.vue
packages/talk/miniprogram/ManagePinnedMessage.vue
```

`packages/talk/package.json` 建议使用稳定包名，例如：

```json
{
  "name": "@jubenmi/talk",
  "type": "module",
  "exports": {
    "./api": "./api/index.js",
    "./miniprogram": "./miniprogram/index.js"
  }
}
```

主仓库根 `package.json` 的 workspaces 后续应包含 `packages/talk`，让 API 和小程序都通过 `@jubenmi/talk` 的导出入口引用扩展。若 submodule 初始还没有 package metadata，实施时先在 submodule 中补齐最小 `package.json`。

`packages/talk/api/service.js` 放聊天私有能力：

- `ensureSessionChatRoom(connection, sessionId)`
- `getSessionChat(user, sessionId)`
- `listSessionMessages(user, sessionId)`
- `createSessionMessage(user, sessionId, body)`
- `updateSessionPinnedMessage(user, sessionId, body)`
- `createSystemSessionMessage(connection, sessionId, senderUserId, content)`
- `ensureDefaultPinnedMessage(connection, session, pinnedMessageText)`

`packages/talk/api/routes.js` 负责把聊天 API 挂到服务器路由，不让 `server.js` 直接 import 一堆聊天函数。

`apps/api/src/modules/extensions/session-pseudo-chat/index.js` 只负责从 `@jubenmi/talk/api` 导入并导出扩展定义。它是主仓库稳定入口，不承载聊天业务实现。

### 注册表

`registry.js` 提供一个简单的静态注册表：

```js
export const sessionExtensions = [
  pseudoChatExtension
];
```

每个扩展暴露：

```js
{
  id: "session-pseudo-chat",
  route(routeContext),
  hooks: {
    afterSessionCreated,
    afterSessionSeatKicked,
    afterSessionCancelled
  }
}
```

初始阶段只需要同步、静态注册，不支持运行时启停。

### 核心服务与扩展的边界

`core/service.js` 保留车局、座位、报名、分享、目录等主业务。它不再直接知道聊天表细节，只在关键业务点调用扩展 hook：

- 创建车局后：`afterSessionCreated` 创建房间和默认置顶。
- 踢出或释放座位后：`afterSessionSeatKicked` 写入系统消息。
- 取消车后：`afterSessionCancelled` 写入系统消息。

如果某个扩展 hook 失败，当前事务应回滚，保证“车局状态变化”和“扩展副作用”一致。

### 路由接入

`server.js` 保留通用 HTTP 能力：认证、JSON 响应、错误处理和基础路由工具。扩展路由通过统一入口注册。

路由上下文包含：

- `getAuthUser(request)`
- `jsonResponse(response, statusCode, payload)`
- `idMatch(pathname, pattern)`
- `request`
- `response`
- `url`
- `body`

为了保持改动小，第一版可以使用函数式匹配：

```js
for (const extension of sessionExtensions) {
  const handled = await extension.route?.(routeContext);
  if (handled) return;
}
```

后续如果路由增多，再升级成显式 router。

## 前端设计

### 文件结构

主仓库建议新增：

```text
apps/miniprogram/src/extensions/sessionExtensions.js
apps/miniprogram/src/extensions/session-pseudo-chat/index.js
```

聊天前端实现放在 submodule：

```text
packages/talk/miniprogram/api.js
packages/talk/miniprogram/ChatEntry.vue
packages/talk/miniprogram/ManagePinnedMessage.vue
```

`apps/miniprogram/src/extensions/session-pseudo-chat/index.js` 只做薄适配，从 `@jubenmi/talk/miniprogram` 导出 talk submodule 的组件和元信息。

`sessionExtensions.js` 暴露详情页和管理页扩展清单：

```js
import { ChatEntry, ManagePinnedMessage } from "./session-pseudo-chat/index.js";

export const sessionDetailExtensions = [
  {
    id: "session-pseudo-chat",
    component: ChatEntry
  }
];

export const sessionManageExtensions = [
  {
    id: "session-pseudo-chat",
    component: ManagePinnedMessage
  }
];
```

### 详情页挂载

`detail.vue` 只保留页面主体。聊天按钮、弹窗、消息轮询、未读数、输入框、发送逻辑全部移动到 `ChatEntry.vue`。

宿主传入：

- `session-id`
- `session`
- `focus-chat-on-load`
- `current-user-id`

扩展自行处理：

- 加载聊天聚合接口。
- 3 秒轮询。
- 403/401 时隐藏入口、清空输入和停止轮询。
- 未读数。
- 弹窗开关。
- 发送普通消息。

详情页 `onHide` 和 `onUnload` 需要通知扩展停止轮询。第一版可通过组件 `ref` 调用 `stop()`，避免引入全局事件总线。

### 管理页挂载

`manage.vue` 移除置顶信息区的内联逻辑，改为渲染 `ManagePinnedMessage.vue`。

宿主传入：

- `session-id`
- `session`
- `busy`

扩展提供：

- 加载当前 `pinnedMessage`。
- 编辑并保存置顶文本。
- 保存后触发 `updated` 事件，宿主刷新页面状态或显示提示。

### 样式

伪聊天扩展保留现有视觉表现，避免本次抽取引发设计变化。样式随组件迁移到扩展组件 scoped style 中。

## 数据流

### 创建车局

1. 宿主核心创建 `sessions`。
2. 核心触发 `afterSessionCreated`。
3. 伪聊天扩展创建 `session_chat_rooms`。
4. 伪聊天扩展创建或更新默认置顶消息。
5. 事务提交。

### 详情页聊天

1. `detail.vue` 加载车局。
2. `ChatEntry.vue` 调用 `GET /api/sessions/:id/chat`。
3. 后端通过 session id 找唯一房间，并校验成员权限。
4. 前端展示置顶、消息列表和输入框。
5. 发送消息调用 `POST /api/sessions/:id/messages`。

### 管理页置顶

1. `ManagePinnedMessage.vue` 加载当前聊天聚合数据。
2. 车头编辑置顶文本。
3. 保存调用 `PATCH /api/sessions/:id/chat/pin`。
4. 后端强制 `sender_user_id = organizer_user_id`。
5. 前端更新本地置顶文本并通知宿主。

### 业务系统消息

1. 核心服务完成踢人或取消车状态更新。
2. 核心触发对应扩展 hook。
3. 伪聊天扩展写入 `message_type = 'system'` 的消息。

## 错误处理

- 401：前端提示登录后使用聊天。
- 403：前端隐藏聊天入口、关闭弹窗、停止轮询并清空输入状态。
- 400：取消车后发送普通消息失败，提示聊天不可发送。
- 扩展 hook 在事务内失败时，事务回滚。
- 扩展组件加载失败不应阻塞详情页基础信息展示，但应显示轻量失败提示。

## 测试策略

### 静态检查

更新 `scripts/d10-pseudo-chat-check.js`：

- 确认 `.gitmodules` 包含 `packages/talk` 和 `git@github.com:jubenmi/talk.git`。
- 确认聊天服务不再留在 `core/service.js` 的大段内联实现中。
- 确认 `detail.vue` 不再包含聊天弹窗 DOM 和轮询实现。
- 确认 `manage.vue` 不再直接调用 `/chat/pin`。
- 确认存在 `packages/talk/api`、`packages/talk/miniprogram`、主仓库后端适配层和前端适配层。
- 继续禁止前端读取 `pinned_message_text`。

### JS 检查

`npm run check` 应继续通过。

### Smoke

保留并更新 `scripts/d10-pseudo-chat-smoke.js`：

- 两个车局聊天隔离。
- 车头和上车玩家可读写。
- 非成员、待审核、被踢出玩家不可读写。
- 置顶消息唯一且作者为车头。
- 取消车后历史可读、新消息不可发。

### 小程序检查

更新 `scripts/check-miniprogram.js`：

- 详情页存在扩展挂载。
- 管理页存在扩展挂载。
- 伪聊天组件存在聊天入口、未读数、弹窗、发送和置顶展示。

## 迁移与兼容

数据库 migration 不在本次重做。现有 `0004_session_interaction_board.sql` 和 `0005_chat_rooms_backfill.sql` 继续作为 D10 数据基础。

API 路径保持兼容，前端扩展内部继续调用原路径。这样抽取后不会影响现有 smoke 脚本和外部调用者。

主仓库通过 Git submodule 固定 `packages/talk` 的提交。后续修改 talk 扩展时，应在 `packages/talk` 内提交并推送，再在主仓库更新 submodule 指针。

## 实施顺序

1. 添加 Git submodule：`packages/talk -> git@github.com:jubenmi/talk.git`。
2. 在 `packages/talk` 建立最小 package metadata 和 `api`、`miniprogram` 目录。
3. 建立后端扩展目录和 `session-access.js`，移动聊天相关 helper 到 `packages/talk/api`。
4. 接入后端扩展路由，保持 API 返回 shape 不变。
5. 将创建车局、踢人、取消车的聊天副作用改为扩展 hooks。
6. 建立前端扩展注册表和主仓库薄适配层。
7. 从 `detail.vue` 抽出 `ChatEntry.vue` 到 `packages/talk/miniprogram`。
8. 从 `manage.vue` 抽出 `ManagePinnedMessage.vue` 到 `packages/talk/miniprogram`。
9. 更新静态检查和 smoke 检查。
10. 运行 `npm run check`，必要时运行 `npm run d10:smoke`。

## 验收标准

- 聊天表现与抽取前一致。
- 主仓库包含 `.gitmodules`，`packages/talk` 指向 `git@github.com:jubenmi/talk.git`。
- `packages/talk` 暴露 `@jubenmi/talk/api` 和 `@jubenmi/talk/miniprogram`。
- `detail.vue` 和 `manage.vue` 只通过扩展挂载使用伪聊天。
- `core/service.js` 不再直接承载聊天房间和消息实现。
- 所有聊天 API 路径和返回结构保持兼容。
- D10 聊天隔离检查继续通过。
- `npm run check` 通过。
