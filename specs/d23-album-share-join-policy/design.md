# D23 Design: 相册分享与上车策略设计

更新日期：2026-07-04

## Overview

D23 将相册分享拆成两个产品路径：

- 好友或群聊分享：`onShareAppMessage` 返回自定义 `path`，打开 `pages/session/share`，用于上车。
- 朋友圈分享：`onShareTimeline` 只返回 `query`，仍打开当前相册页，用 `albumShareToken` 切到只读相册展示。

上车策略由车局字段 `join_policy` 控制。前端只展示策略和后端结果，不在页面里复制业务权限。后端复用现有 `signups`、座位确认、审核和相册成员模型，避免新增并行状态机。

## Data Model

### `sessions.join_policy`

新增字段：

```sql
ALTER TABLE sessions
  ADD COLUMN join_policy VARCHAR(32) NOT NULL DEFAULT 'review_required'
  AFTER visibility;
```

合法值：

- `direct`
- `review_required`

默认值为 `review_required`。旧车局和缺省创建请求都按需要审核处理。

后端新增归一化函数：

```text
normalizeJoinPolicy(value)
  missing or empty -> review_required
  direct -> direct
  review_required -> review_required
  otherwise -> badRequest
```

## Backend Design

### 车局创建和详情

`POST /api/sessions` 接收 `joinPolicy` 并写入 `sessions.join_policy`。

`GET /api/sessions/:id` 返回 `join_policy`，让小程序分享页和详情页能够展示上车策略和确认后文案。

`PATCH /api/sessions/:id` 可选择支持 `joinPolicy`。若本阶段实现修改能力，只允许车头或管理员改；修改不回溯已有 pending 报名或 confirmed 座位。

### 统一加入座位服务

新增内部服务：

```text
joinSessionSeat(user, seatId, body)
```

共同流程：

```text
require verified phone
lock seats for this session
load seat and session
validate session accepts joining
validate seat is selectable
if session.join_policy === direct:
  confirm seat immediately
else:
  create pending signup
```

共同规则复用现有发车前拼车规则：

- `recruiting` 车局可加入开放座位。
- `locked` 且已到 `start_at` 的车局可补开放座位。
- `confirmed`、`locked`、`cancelled` 座位不可被普通玩家加入。
- 直接上车和审核通过时都释放同车其他已确认座位。

#### `direct` 分支

复用 `claimSessionSeat` 的座位确认逻辑，但普通玩家只有在 `session.join_policy = direct` 时可用。

结果：

```json
{
  "join_result": "joined",
  "seat": {
    "id": 123,
    "status": "confirmed",
    "confirmed_user_id": 456
  }
}
```

数据库结果：

- `session_seats.status = confirmed`
- `session_seats.confirmed_user_id = current user`
- `signups.status = approved`
- `signups.review_eligible_at` 设置为当前时间或保持既有逻辑

#### `review_required` 分支

复用 `createSignup`。

结果：

```json
{
  "join_result": "pending_review",
  "signup": {
    "id": 123,
    "status": "pending"
  }
}
```

数据库结果：

- `signups.status = pending`
- `session_seats.status = applied`，如果原本是 `open`
- 不设置 `session_seats.confirmed_user_id`

### 接口调整

`POST /api/session-seats/:id/claim`：

- 车头和管理员仍可直接分配。
- 普通玩家仅在 `join_policy = direct` 时可直接确认座位。
- 普通玩家在 `review_required` 车局调用时返回 forbidden。

`POST /api/signups`：

- 继续作为审核申请入口。
- 在 `review_required` 车局中保持现有行为。
- 在 `direct` 车局中可继续接受申请作为兼容路径，但小程序主路径应调用直接确认；或者返回 400 提示该车可直接上车。推荐兼容接受，但前端不主动使用。

### 相册分享 token

新增接口：

```text
POST /api/sessions/:id/album/share-token
```

要求：

- 调用者已登录。
- 调用者是该车相册成员。
- 调用者在该车有 `confirmed` 或 `locked` 座位。

返回 HMAC token：

```json
{
  "session_id": 123,
  "token": "payload.signature",
  "expires_at": "2026-08-03T12:00:00.000Z",
  "share_subject": {
    "type": "seat",
    "seat_id": 456,
    "role_name": "沈青",
    "seat_name": "角色A"
  }
}
```

token payload：

```json
{
  "sessionId": 123,
  "sharerUserId": 456,
  "seatId": 789,
  "exp": 1783070400
}
```

签名使用 `config.sessionSecret`。不新增 token 表。

### 朋友圈公开相册接口

新增：

```text
GET /api/sessions/:id/album/public-share?token=<albumShareToken>
```

不要求登录。返回公开展示所需的车局标题、角色信息和照片列表。

过滤规则：

- token 签名有效且未过期。
- token `sessionId` 等于路径 `id`。
- 车局未取消，且相册已开放。
- 照片状态为 `active`。
- 照片标签必须包含 `tag_type = seat` 且 `seat_id = token.seatId`。
- 未标注照片不返回。
- 发起分享人上传但没有标自己角色的照片不返回。
- 只标注 `other`、`npc` 或 `session_npc_role` 的照片不返回。

隐私规则：

- 若照片标注其他真实玩家，必须尊重这些玩家的 `allow_tagged_visible`。
- 若上传者不允许上传照片可见，则不返回该照片；但上传者本人分享自己角色照片时可见。
- 完整相册成员权限不因为访问者登录而扩大。

### 朋友圈公开图片接口

新增：

```text
GET /api/session-album/public-share/photos/:photoId/image?token=<mediaToken>&variant=thumbnail|preview
```

`mediaToken` 绑定：

- `photoId`
- `albumShareToken` 或它的摘要
- 过期时间

服务端在出图前重新校验照片仍属于公开分享集合，防止图片 URL 被复用到其他照片。

## Mini Program Design

### `pages/session/setup.vue`

新增上车权限设置区：

- 默认 `需要车头审核`
- 可选 `可直接上车`

提交车局时带上：

```js
joinPolicy: this.joinPolicy
```

建议使用二选一分段控件，不增加复杂说明文案。

### `pages/session/album.vue`

相册页新增两种模式。

#### Member Mode

现有完整相册模式：

- 登录后访问。
- 同车成员可看。
- 支持上传、删除、标注、多选、隐私设置。
- 支持分享到好友/群和朋友圈。

#### Timeline Mode

朋友圈只读展示模式：

- `options.source === "wechat_timeline"` 或存在 `albumShareToken` 时进入。
- 不调用强制登录。
- 请求 `GET /api/sessions/:id/album/public-share`。
- 不展示上传、删除、标注、多选、隐私设置和上车按钮。
- 不自动切换为完整相册。

`onShareAppMessage`：

```js
return {
  title: `${this.scriptName}｜${this.storeName}｜相册邀请`,
  path: `/pages/session/share?id=${this.sessionId}&entry=album&shareCode=${shareCode}&source=wechat_share`,
  imageUrl: this.shareImage // 固定安全封面，不使用当前相册页截图
}
```

`onShareTimeline`：

```js
return {
  title: `${this.shareSubjectRoleName} 的相册｜${this.sessionTitle}`,
  query: `id=${this.sessionId}&source=wechat_timeline&albumShareToken=${this.albumShareToken}`,
  imageUrl: this.shareImage
}
```

朋友圈分享前，相册页尝试调用 `POST /api/sessions/:id/album/share-token`。如果当前用户没有确认座位，不生成 token，也不提供朋友圈分享入口。

### `pages/session/share.vue`

新增 `entry=album` 分支。

加载流程：

```text
load session
hydrate current user
if entry is album and user is confirmed member:
  redirect to /pages/session/album?id=<id>
else:
  render existing role selection
```

确认角色时：

```text
ensure login and phone
call join endpoint
if join_result = joined:
  redirect to album
if join_result = pending_review:
  show waiting organizer review
```

角色卡状态：

- `open`：可选。
- `applied`：待审核。
- `confirmed`：已上车。
- `locked`：已锁定。
- 当前用户已确认座位：展示“我已上车”，主操作进入相册。

## Static Checks And Smoke Tests

更新 `scripts/check-miniprogram.js`：

- 相册页 `onShareAppMessage` 必须指向 `pages/session/share`。
- 相册页 `onShareTimeline` 必须返回 `query`，不能返回 `path`。
- 相册页必须有朋友圈只读模式，且该模式不强制登录。
- 分享页必须识别 `entry=album`。
- 分享页必须支持 `direct` 和 `review_required` 两种上车结果。
- 分享页必须保留 `POST /api/signups` 审核分支。

新增或更新烟测：

- `review_required` 车局普通玩家 direct claim 被拒绝，报名后待审核。
- `direct` 车局普通玩家可直接确认座位。
- 朋友圈公开相册只返回 token 绑定座位的照片。
- 未标注自己角色的上传照片不返回。
- 公开图片接口不能越权访问其他照片。

## Error Handling

- token 无效：`相册分享已失效`。
- token 过期：`相册分享已过期，请让车友重新分享`。
- 当前用户没有确认座位：不生成朋友圈相册分享 token。
- 相册未开放：`相册会在发车后开放`。
- 公开集合为空：`还没有这位角色的公开照片`。
- 直接上车并发冲突：提示角色刚被选走并刷新座位。
- 重复申请：提示已提交申请，等待车头审核。

## Verification

自动验证：

```text
npm run check
npm run build:mp-weixin
```

建议后端烟测：

```text
node scripts/d23-album-share-join-policy-smoke.js
```

微信开发者工具验证：

1. 创建 `review_required` 车，从相册分享到群，未上车用户打开后提交申请，车头审核前不能看完整相册。
2. 创建 `direct` 车，从相册分享到群，未上车用户打开后选角色并直接进入相册。
3. 从相册分享到朋友圈，未登录访问者看到只读相册展示。
4. 朋友圈只读页不展示上传、删除、标注、隐私设置和上车按钮。
5. 朋友圈只读页只展示发起分享人角色相关照片。

## Non-Goals

- 不做公开相册广场。
- 不识别微信群主身份。
- 不做朋友圈上车入口。
- 不做跨车局相册瀑布流。
- 不新增分享奖励或诱导分享机制。
