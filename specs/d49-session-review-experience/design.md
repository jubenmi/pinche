# D49 Design：车局游后感

更新日期：2026-07-19

版本：v1.0

状态：产品与界面方向已确认，实施中

## 1. 设计摘要

D49 复用已有 `session_reviews`、记录资格、内容审核和相册上传能力，只调整四条边界：

1. 将文字上限从 500 提升到 900，评价仍是一条综合记录。
2. 在 `session_review_photos` 增加相册照片外键；新写入使用 `albumPhotoIds`，历史 `photo_url/image_asset_id` 继续只读兼容。
3. 现有写记录页改成用户确认的第三版增量布局；相册选择和手机上传两种来源互斥，手机上传调用既有 `uploadAlbumPhoto`。
4. 增加一个最小只读评价分享页和公开读取接口，承接微信好友/群聊和朋友圈。

不新建评价媒体文件系统、不复制相册图片、不新增标签或第二条评价模型。

## 2. 页面与交互

### 2.1 写记录页

继续使用 `pages/session/review.vue`，保留当前路由和进入条件。视觉参考：

![D49 选定界面](../../docs/superpowers/specs/assets/2026-07-19-session-review-experience-selected.png)

页面结构：

```text
写记录
到发车时间后，你可以留下自己的星级、文字和相册素材。

[ 星级       ☆ ☆ ☆ ☆ ☆ ]
[ 文字记录                  ]
[ 这一次最让我难忘的是……  ]
[                    N/900 ]
[ 照片（最多 9 张）         ]
[从本场相册选择][从手机上传]
 两种方式只能选一种……
 [缩略图……]
 已选 N/9 张

发布后可分享给好友、群聊或朋友圈
[ 发布并分享 ]
```

行为：

- 加载本人评价和本场相册；相册只保留当前可见、approved、ready 的图片。
- 没有可选相册图片时隐藏相册来源按钮，手机上传成为唯一入口。
- 选择相册来源后打开轻量底部选择层；点击图片切换选择，最多 9 张。
- 选择手机来源后调用 `uni.chooseImage`，逐张走 `uploadAlbumPhoto`；已批准结果自动加入选择。
- 已有选择时切换来源需确认并清空。
- 历史评价如果没有 `album_photo_ids`，先展示旧 `photos`；只改文字/星级时请求省略 `albumPhotoIds` 以保留旧图。用户选择新来源后才发送数组并替换旧图。
- 保存成功后跳转 `pages/session/review-share?id=<reviewId>&published=1`。

### 2.2 分享页

新增 `pages/session/review-share.vue`，只承担一条已发布评价的展示和微信分享：

- 头部：剧本名、店名、游玩日期。
- 作者：安全昵称、已批准头像、角色名。
- 正文：星级、最多 900 字文字、可见照片九宫格。
- 作者本人从发布动作进入时显示“分享给好友或群”原生 `open-type="share"` 按钮，并提示朋友圈使用右上角。
- 注册 `onShareAppMessage` 与 `onShareTimeline`，两者都指向同一个评价 ID。
- 不显示编辑、报名、完整车局、完整相册或人物标签。

## 3. 数据模型

新增迁移 `apps/api/migrations/0032_session_review_album_photos.sql`：

```sql
ALTER TABLE session_review_photos
  MODIFY COLUMN photo_url VARCHAR(512) NULL,
  MODIFY COLUMN image_asset_id BIGINT UNSIGNED NULL,
  ADD COLUMN album_photo_id BIGINT UNSIGNED NULL AFTER image_asset_id,
  ADD INDEX idx_session_review_photos_album_photo (album_photo_id),
  ADD CONSTRAINT fk_session_review_photos_album_photo
    FOREIGN KEY (album_photo_id) REFERENCES session_album_photos(id)
    ON DELETE CASCADE;
```

兼容规则：

- 历史行：`image_asset_id/photo_url` 有值，`album_photo_id` 为空。
- D49 新行：`album_photo_id` 有值，`image_asset_id/photo_url` 为空。
- 读取以 `album_photo_id` 为新路径，旧字段作为回退。
- 删除相册照片时外键级联删除引用，不删除评价主体。

## 4. 服务端设计

### 4.1 请求规范化

新增纯 helper：

```text
normalizeSessionReviewAlbumPhotoIds(value)
```

规则：

- `undefined` 表示不修改现有照片，用于历史评价只改文字/星级。
- 显式 `[]` 表示清空照片。
- 只接受数组、去重后的正整数，顺序按客户端顺序保留，最多 9 个。

`PUT /api/sessions/:id/review` 接受：

```json
{
  "rating": 5,
  "content": "这一场最让我难忘的是……",
  "albumPhotoIds": [101, 102]
}
```

为历史审核提案读取保留 `photoUrls` 兼容，但 D49 客户端不再发送它。文字边界统一改为 900。

### 4.2 相册引用校验

事务保存前批量查询 ID，并要求每行：

- `session_id` 等于当前车局；
- `media_type = 'image'`；
- `status = 'active'`；
- `processing_status = 'ready'`；
- 审核结果为现有 `isModerationPublished` 判定的公开状态；
- 对当前作者通过既有 `isAlbumPhotoVisibleToUser` 隐私门禁。

任一 ID 缺失或失败则整个请求返回 400。验证通过后删除旧关联并按顺序插入新引用。若被替换的是历史 `image_asset_id`，继续调用现有延迟清理逻辑；相册照片本体不删除。

### 4.3 读取与图片输出

现有 `reviewPhotos` 查询同时读取两类行：

- 新相册引用返回受控地址 `/api/session-reviews/:reviewId/photos/:albumPhotoId/image`；
- 历史图片返回现有已批准 `photo_url`。

新增图片接口在每次读取时重新验证：评价 active、引用关系存在、相册照片 active/ready/published 且为图片，然后复用现有相册图片输出函数。相册照片失效即返回 404。

本人评价响应增加：

```json
{
  "id": 88,
  "rating": 5,
  "content": "……",
  "photos": ["/api/session-reviews/88/photos/101/image"],
  "album_photo_ids": [101]
}
```

### 4.4 公开评价

新增：

```text
GET /api/session-reviews/:reviewId
```

只返回 active 且已通过文本审核公开门禁的评价：

```json
{
  "id": 88,
  "rating": 5,
  "content": "……",
  "photos": ["/api/session-reviews/88/photos/101/image"],
  "author": { "nickname": "小林", "avatar_url": "..." },
  "role_name": "沈青",
  "script_name": "雾夜",
  "store_name": "谜雾剧场",
  "played_on": "2026-07-19"
}
```

不返回 `user_id`、`session_id`、openid、手机号、精确时间、完整席位、相册标签或对象存储字段。

## 5. 小程序状态设计

照片编辑状态由独立纯 helper 管理，便于单测：

```text
source: '' | 'album' | 'upload'
selectedAlbumPhotoIds: number[]
legacyPhotoUrls: string[]
photosTouched: boolean
```

- 选择来源：`source` 从空变为目标来源。
- 已有新选择时切换：确认后清空 `selectedAlbumPhotoIds`。
- `photosTouched=false` 且历史评价没有相册 ID：保存请求省略 `albumPhotoIds`。
- 其他情况：发送 `albumPhotoIds`，包括显式空数组。

## 6. 内容审核兼容

- `upsert_session_review` 的文字长度边界改为 900。
- 新提案投影保存 `albumPhotoIds`；旧 `photoUrls` 仍可读取，以保证部署前待审核提案可完成。
- 公开分享只使用现有“可公开”评价读取门禁；作者私有、待审或拒绝内容不会从新公开接口泄漏。
- 本期不改审核策略、供应商、重试或后台界面。

## 7. 失败处理

- 星级或文字非法：保留编辑内容，显示服务端错误。
- 相册照片不可用：提示“所选照片已不可用，请重新选择”，不部分保存。
- 本地上传部分失败：保留成功且已批准的相册项，汇总提示失败数量。
- 本地上传待审核：照片已进入相册，但不加入本次选择。
- 分享页 404：展示“这条记录暂时无法查看”，不回退到车局详情。

## 8. 安全与隐私

- 所有写操作继续要求登录和记录资格。
- 客户端传入相册 ID 不代表授权；服务端重新验证车局、媒体类型、审核和当前可见性。
- 公开评价图片接口不接受任意相册 ID，只接受已绑定到该评价的 ID。
- 公开 DTO 最小化；分享页不放大为完整相册访问凭证。

