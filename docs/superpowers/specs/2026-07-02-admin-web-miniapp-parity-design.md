# Admin Web Miniapp Parity Design

更新日期：2026-07-02

## 背景

`apps/admin-web` 当前把资料管理、网页小程序和车局相册放在同一个后台壳里。`MiniProgramWorkspace.vue` 已经覆盖了部分小程序用户侧流程，但它仍是后台化的单组件工作台，缺少小程序 `share` 页的角色状态机、分享入口替代、车内聊天、置顶信息编辑、退出车头等用户侧能力。

新目标是把 admin-web 拆成两块：

1. 管理界面：管理员维护店家、剧本、角色模板、店家剧本关联。
2. 网页小程序：给管理员在浏览器里代替手机小程序操作内容，功能和逻辑对齐微信小程序用户侧页面。

视觉不要求一比一。网页端继续沿用 admin-web 当前的工作台样式，重点是一比一复制小程序用户侧功能、状态流转、API 调用和操作结果。

## 目标

1. admin-web 左侧导航只保留“管理界面”和“网页小程序”两块；车局相册成为网页小程序内部能力。
2. 网页小程序覆盖小程序用户侧页面能力：首页、创建、选店、选本、选角色、设置、分享/选角色、车详情、我的、车头管理、写记录、车局相册、相册隐私。
3. 微信独有能力用 Web 替代动作处理：
   - 微信分享菜单替换为复制详情链接、复制分享链接和复制指定座位链接。
   - 微信登录、手机号授权、昵称头像授权不复制，使用 admin-web 已登录管理员身份。
   - 微信图片选择替换为浏览器文件选择或拖拽上传。
4. 分享/选角色逻辑对齐小程序 `pages/session/share.vue`：
   - 从已发布车局加载座位为角色卡。
   - 展示可选、我选、换选、已选、待审、不可选状态。
   - 支持反串确认。
   - 支持从详情指定座位进入分享页。
   - 已选角色再次选择给出提示；换选成功后释放原角色。
5. 创建车局逻辑对齐小程序 `pages/session/setup.vue`：
   - 发布车局、创建座位、车头占位。
   - 保存聊天置顶信息到 `/api/sessions/:id/chat/pin`。
   - 创建完成进入网页小程序分享页。
6. 车详情逻辑对齐小程序 `pages/session/detail.vue`：
   - 展示基础信息、座位、分享统计、车友记录。
   - 从详情进入分享页选择角色，而不是直接绕过分享状态机。
   - 支持复制详情链接、复制座位分享链接。
   - 支持车内聊天入口、加载置顶消息、收发消息。
   - 支持带 `sessionId`、`seatId`、`shareCode`、`source` 的 URL 进入并上报分享访问。
7. 车头管理逻辑对齐小程序 `pages/session/manage.vue`：
   - 审核、拒绝、锁座、释放、转让车头、取消本车。
   - 补齐退出车头。
   - 支持加载和保存置顶信息。
8. 我的、记录、相册和隐私功能继续使用现有 API，补齐从网页小程序内部的跳转和状态衔接。
9. 增加静态 parity 检查，防止网页小程序入口、分享状态机、聊天、置顶、退出车头和管理/网页两块导航被误删。

## 非目标

- 不追求微信小程序视觉像素级还原。
- 不把 UniApp 源码构建成 H5，也不引入新的跨端框架。
- 不新增后端数据模型。
- 不开放给普通用户。第一版仍只有 admin-web 登录后的管理员可用。
- 不复制微信平台特有能力，例如 `open-type="share"`、微信手机号授权、微信昵称头像授权、微信扫码。
- 不重做资料管理界面。小程序 `pages/admin/catalog` 的能力仍归管理界面。

## 方案

采用“在 admin-web 里实现一套 Vue 网页小程序功能层”的方案。

### 管理界面

`App.vue` 中的后台导航调整为：

- 管理界面：渲染 `CatalogWorkspace`，用于管理员资料维护。
- 网页小程序：渲染 `MiniProgramWorkspace`，用于复制小程序用户侧业务能力。

`SessionAlbumWorkspace` 不再作为左侧独立导航项出现。相册只从网页小程序的某个车局详情进入，和微信小程序一致：先判断相册已到发车时间开放，再加载该 `sessionId` 的单场相册。

### 网页小程序容器

第一版保留 `MiniProgramWorkspace.vue` 作为状态容器，先补齐功能 parity，再逐步拆分为更小组件。这样可以最大限度复用现有工作，避免为了拆文件而打断已有流程。

容器内部页面状态包括：

- `home`
- `create`
- `mine`
- `detail`
- `share`
- `manage`
- `review`
- `album`

创建流程仍使用当前 `createStep` 管理选店、选本、选角色、设置。

### API 封装

在 `apps/admin-web/src/api.js` 补齐网页小程序需要的用户侧 API wrapper：

- `pinSessionChatMessage(sessionId, pinnedMessageText)`
- `getSessionChat(sessionId)`
- `sendSessionMessage(sessionId, content)`
- `trackShareView(body)`

现有的会话、座位、报名、记录、相册 API 保持不变。

### 分享和角色状态机

新增 `share` 页面状态：

- `shareSession`
- `shareRoleOptions`
- `pendingShareRole`
- `currentShareRole`
- `confirmedCrossCastRoleKey`
- `focusedSeatId`
- `shareStatusText`

角色卡从 `shareSession.seats` 映射，使用当前管理员 `user.id` 和 `user.gender` 判断“我选”和“反串”。

确认选择调用 `/api/session-seats/:id/claim`。当用户已选择其他角色时，确认新角色触发换选，成功后重新加载车局。

### 创建车局

创建流程保持当前顺序，但创建完成后补充：

1. 调用 `pinSessionChatMessage(session.id, pinnedMessageText)`。
2. 保存成功状态。
3. 进入 `share` 页面，而不是直接进入详情。

如果置顶保存失败，车局仍创建成功，但展示提示并允许进入车头管理页再次保存。

### 车详情和分享访问

详情页新增：

- `选择角色` 按钮进入 `share`。
- 每个可选座位的按钮进入 `share` 并携带 `seatId`。
- 复制详情链接。
- 复制指定座位分享链接。
- 当 URL 带 `sessionId`、`seatId`、`shareCode` 或 `source` 时，加载详情并调用 `trackShareView`。
- `车局相册` 按钮执行和微信小程序一样的开放时间判断；未发车只提示，不进入相册页。

### 车局相册

网页小程序相册不提供“可访问车局”总列表，也不调用 `scope=album` 批量查询。它只接收当前 `activeSessionId`，调用：

- `/api/sessions/:id/album`
- `/api/sessions/:id/album/people`
- `/api/sessions/:id/album/privacy`

这样和微信小程序 `pages/session/album.vue` 一样，用户必须从具体车局进入具体车局相册。

### 车内聊天

详情页新增一个简化 Web 聊天区：

- 加载 `/api/sessions/:id/chat`。
- 显示置顶消息和消息列表。
- 输入文字后调用 `/api/sessions/:id/messages`。
- 支持手动刷新。第一版不要求完全复制小程序的悬浮按钮视觉。

### 车头管理

管理页新增：

- 置顶信息文本框，加载当前 chat pinned message，保存时调用 `/api/sessions/:id/chat/pin`。
- 退出车头按钮，调用 `/api/sessions/:id/organizer/leave`。

其他管理动作沿用现有实现。

### 验收

静态检查：

- `scripts/d12-admin-web-check.js` 要求左侧导航只保留管理界面和网页小程序两块。
- 要求 `MiniProgramWorkspace.vue` 包含 `share` 页面、角色状态机、反串确认、复制分享链接、分享访问上报、聊天、置顶、退出车头。
- 要求 `api.js` 导出聊天、置顶和分享访问 API wrapper。

构建检查：

- `node scripts/d12-admin-web-check.js`
- `npm --workspace apps/admin-web run build`

## 风险与约束

- 当前工作树已有与本任务无关的改动，实施时只追加/修改本任务需要的片段，不回退既有改动。
- `MiniProgramWorkspace.vue` 已经较大。第一版优先补齐功能；后续可以把各页面拆成 `components/miniapp/*`。
- Web 端管理员身份替代微信登录，因此手机号授权类 gate 不复制。需要手机号的原小程序流程在 Web 端视为已由管理员身份覆盖。
