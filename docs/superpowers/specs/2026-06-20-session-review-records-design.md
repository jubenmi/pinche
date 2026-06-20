# 车局记录与评价设计

日期：2026-06-20

## 结论

采用方案 C：车局到 `start_at` 之后，已获得上车资格的用户可以独立写自己的记录、评星并上传照片。记录权不依赖车头确认，也不依赖其他玩家确认。

这次不新增全局“是否已发车”按钮。用户在“我的”里看到自己发起和自己参与的车；到时间后，参与者可以选择写或不写记录。这个选择只影响自己的记录，不改变整车状态。

## 背景

当前小程序已经有车局、座位、报名和“我的发车”：

- `apps/miniprogram/src/pages/mine/index.vue` 只展示车头创建的车。
- `GET /api/users/me/sessions` 返回我发起的车。
- `GET /api/users/me/signups` 存在，但当前只返回报名行，小程序“我的”页还没有展示我参与的车。
- 车局状态有 `draft`、`recruiting`、`locked`、`cancelled`，没有评价记录模型。
- 头像上传已经实现 `/api/users/me/avatar` 和 `/uploads/avatars/...`，评价照片可以复用同类上传与静态访问方式。

用户选择方案 C 的原因是：每个人都应该有记录权，不能因为车头或其他人的误操作导致自己无法记录。

## 目标

1. “我的”里可以看到我发起和我参与的车。
2. 到车局 `start_at` 之后，符合条件的参与者可以写记录。
3. 记录包含 1 到 5 星评分、文字评价和多张照片。
4. 其他车友进入这台车详情页，可以查看公开记录。
5. 记录权以个人参与资格为准，不依赖车头确认发车。
6. 开车时间之后，车头释放座位或取消车不应抹掉已经获得的记录资格。

## 非目标

- 不做全局“已发车/未发车”确认流。
- 不做多人投票确认发车。
- 不做商家、DM、NPC 的独立评分维度。
- 不做评价审核后台。第一版只支持用户自己的记录创建和修改。
- 不做视频上传。

## 核心规则

### 记录资格

当玩家被车头通过报名，或通过分享页直接选择角色成功时，后端写入 `signups.review_eligible_at`。这个时间表示用户曾经获得这台车的记录资格。

用户可以写记录必须同时满足：

- 用户已登录。
- 车局存在。
- 当前时间大于等于 `sessions.start_at`。
- 用户在该车局有 `review_eligible_at IS NOT NULL` 的报名记录。
- 如果车局被取消，只有取消发生在 `start_at` 之前时才阻止新记录；`start_at` 之后的取消不抹掉记录权。

这条规则保护开车时间后的个人记录权。车头在开车后误释放座位、误取消车，不能让已经获得资格的玩家失去记录入口。

### 记录数量

每个用户每台车最多一条记录。再次提交会更新自己的记录和照片列表。

### 照片

第一版每条记录最多 9 张照片。只接受 JPEG 和 PNG。单张最大 4MB。上传后返回站内路径 `/uploads/session-reviews/...`，记录保存时只接受这个前缀的路径。

### 公开展示

`GET /api/sessions/:id/reviews` 是公开接口，返回 active 记录。车详情页展示记录墙，包含：

- 昵称或登录名。
- 头像。
- 座位/角色名。
- 星级。
- 文字内容。
- 照片。
- 更新时间。

未登录用户也可以查看公开记录，但不能写记录。

## 数据模型

新增 migration：`apps/api/migrations/0010_session_review_records.sql`。

### signups

新增：

```sql
review_eligible_at DATETIME NULL
```

写入时机：

- `claimSessionSeat` 直接选角成功时写入当前时间。
- `approveSignup` 通过报名时写入当前时间。
- 同一用户换选座位时，旧座位如果在开车前释放，旧报名的资格清空；如果在开车后释放，保留资格。
- 车头踢出或释放座位时，如果车局未到 `start_at`，清空被释放报名的资格；如果已到 `start_at`，保留资格。
- 车头取消车时，如果取消发生在 `start_at` 前，清空本车所有未写记录用户的资格；如果取消发生在 `start_at` 后，保留资格。

### session_reviews

```sql
id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT
session_id BIGINT UNSIGNED NOT NULL
user_id BIGINT UNSIGNED NOT NULL
seat_id BIGINT UNSIGNED NULL
rating TINYINT UNSIGNED NOT NULL
content TEXT NULL
status VARCHAR(32) NOT NULL DEFAULT 'active'
created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
UNIQUE KEY uniq_session_reviews_user (session_id, user_id)
```

`rating` 只能是 1、2、3、4、5。

### session_review_photos

```sql
id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT
review_id BIGINT UNSIGNED NOT NULL
photo_url VARCHAR(512) NOT NULL
sort_order INT UNSIGNED NOT NULL DEFAULT 0
created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
```

照片归属由 `review_id` 决定。更新记录时，后端用事务删除旧照片并插入新照片列表。

## API 设计

### `GET /api/users/me/signups`

扩展返回我参与的车局信息：

```json
{
  "id": 12,
  "session_id": 5,
  "seat_id": 9,
  "status": "approved",
  "review_eligible_at": "2026-06-20T12:00:00.000Z",
  "seat_name": "A位",
  "seat_role_name": "侦探",
  "session_status": "recruiting",
  "script_name_snapshot": "雾夜",
  "store_name_snapshot": "谜雾剧场",
  "start_at": "2026-06-20T20:00:00.000Z",
  "can_review": true,
  "has_review": false
}
```

### `GET /api/sessions/:id/reviews`

公开返回记录列表：

```json
[
  {
    "id": 1,
    "session_id": 5,
    "user_id": 7,
    "seat_id": 9,
    "seat_name": "A位",
    "seat_role_name": "侦探",
    "rating": 5,
    "content": "这车节奏很好。",
    "photos": ["/uploads/session-reviews/review-7-...jpg"],
    "user_nickname": "小明",
    "user_avatar_url": "/uploads/avatars/user-7-...jpg",
    "updated_at": "2026-06-20T23:00:00.000Z"
  }
]
```

### `GET /api/sessions/:id/review`

登录后返回当前用户自己的记录和资格：

```json
{
  "can_review": true,
  "review": {
    "rating": 5,
    "content": "这车节奏很好。",
    "photos": ["/uploads/session-reviews/review-7-...jpg"]
  }
}
```

### `PUT /api/sessions/:id/review`

登录后创建或更新自己的记录：

```json
{
  "rating": 5,
  "content": "这车节奏很好。",
  "photoUrls": ["/uploads/session-reviews/review-7-...jpg"]
}
```

失败规则：

- 未登录：401。
- 未到 `start_at`：400。
- 没有记录资格：403。
- 评分不是 1 到 5：400。
- 照片超过 9 张：400。
- 照片路径不是 `/uploads/session-reviews/` 前缀：400。

### `POST /api/session-reviews/photos`

登录后上传一张评价照片。字段名为 `photo`。返回：

```json
{
  "photoUrl": "/uploads/session-reviews/review-7-1782000000000-a1b2c3d4.jpg"
}
```

## 小程序设计

### “我的”

`pages/mine/index.vue` 登录后展示：

- “我发起”：现有我的发车列表。
- “我参与”：调用 `/api/users/me/signups`，显示剧本、店家、时间、座位/角色、报名状态。

参与车到点且 `can_review` 为 true 时展示“写记录”按钮；已有记录时展示“编辑记录”。所有参与车都保留“详情”入口。

### 车详情

`pages/session/detail.vue` 增加“车友记录”区块：

- 加载 `/api/sessions/:id/reviews`。
- 空状态显示“还没有车友记录”。
- 展示星级、文字、照片、用户头像和昵称。
- 当前用户有资格时显示“写记录/编辑记录”入口。

### 写记录页

新增 `pages/session/review.vue`：

- 进入时读取 `id`。
- 加载当前用户自己的记录资格和已保存记录。
- 星级用 5 个可点按钮。
- 文本输入限制 500 字。
- 照片选择最多 9 张。
- 新照片先通过 `uploadSessionReviewPhoto(filePath)` 上传，再调用 `PUT /api/sessions/:id/review` 保存。
- 保存成功后返回详情页或“我的”页。

## 错误处理

- 未登录写记录时调用现有 `ensureLoggedIn`。
- 未到时间时提示“到发车时间后可以写记录”。
- 没有资格时提示“只有已上车玩家可以写记录”。
- 上传失败时保留已填写文字和星级。
- 保存失败时不清空草稿。

## 合规与隐私

评价是公开记录，因此文字进入后端前复用公开文本风险词检查，不允许联系方式、红包、返现、平台代收等高风险内容。照片第一版只做格式和大小限制，不做人脸识别或内容审核；如果后续上生产，需要接入平台内容安全能力。

## 验证

新增静态检查 `scripts/d15-session-review-records-check.js` 并接入根 `npm run check`。检查覆盖：

- migration 创建 `review_eligible_at`、`session_reviews`、`session_review_photos`。
- API 暴露列表、当前用户记录、保存记录、照片上传和静态照片访问。
- `listMySignups` 返回车局上下文、`can_review`、`has_review`。
- 小程序新增 `pages/session/review`。
- “我的”展示我参与的车。
- 详情页展示车友记录。
- 小程序 API helper 支持评价照片上传。

最终验证命令：

```bash
npm run check
node scripts/d15-session-review-records-check.js
```
