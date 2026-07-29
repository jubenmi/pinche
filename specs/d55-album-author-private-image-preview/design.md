# D55 Design：相册作者私有图片预览恢复

更新日期：2026-07-29

版本：v1.0

状态：用户已确认，实施中

## 1. 设计摘要

D55 采用“启用既有 D46 服务端能力 + 修复两个旧前端判断 + 补齐评价关联双视图”的渐进方案：

- 保持 `isModerationPublished` 的公共语义不变。
- 由服务端完整 `author_only` DTO 表达上传者专属预览资格。
- 共享 URL 合并只保留公开媒体或完整作者能力，并对作者能力强制剥离下载 URL。
- “写记录”使用当前认证用户 ID 识别自己的作者私有相册图片。
- 评价可以保存本人作者私有图片 ID，但所有公开评价路径继续只投影审核通过的图片。
- 真实环境通过显式 gate 启用，仅影响启用后的新上传。

该方案既恢复“自己上传立即看到”的体验，也不把“本人可见”混入任何公共发布、下载或分享判断。

## 2. 现状与根因

### 2.1 服务端能力已存在但真实配置未启用

D46 已实现：

```text
finalize
  -> author_visibility_version=1
  -> createAuthorPrivateMediaView
  -> publication_state=author_only
  -> 60 秒内 preview/thumbnail capability URL
```

但该链路同时受 `CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED` 控制。gate 关闭时新相册图片写版本 0，序列化回退为无 URL 的审核占位。开启 gate 只影响之后的新上传；历史版本 0 不回填。

### 2.2 共享刷新错误清除作者 URL

`packages/shared/src/albumMedia.js` 当前对所有未公开刷新行统一删除媒体字段，并在刷新列表出现新 ID 时直接返回原行。前者会删除合法 `author_only` capability，后者会让普通未公开 URL 绕过关闭式清理。

### 2.3 “写记录”仍使用旧的 approved-only 模型

`review.vue` 只用 `isModerationPublished` 判断相册图片能否显示和选择。即使 finalize 已返回完整作者能力，它仍被计为普通待审、从列表中移除并阻止保存。

### 2.4 评价服务端只允许公开图片关联

`upsertMySessionReviewWithConnection` 当前要求 `albumPhotoIds` 全部已经公开。评价公共读取的严格过滤是正确的，但“是否允许本人保存关联”和“是否允许公共读取图片”被错误地合成了同一个判断。

## 3. 方案比较

### 方案 A：只打开服务端 gate

优点是改动最小，相册首次加载即可恢复作者预览。缺点是 URL 刷新仍会清空图片，“写记录”仍把作者图片当成不可用，无法完整解决复现路径。

### 方案 B：gate + 完整作者资格 + 评价关联双视图（采用）

服务端 gate 产生可信作者 DTO；共享层保留合法短时 URL；编辑器额外接受当前用户的完整作者 DTO；评价关联允许本人版本 1 图片，但公共投影继续严格过滤。改动集中，隐私边界可独立测试。

### 方案 C：把本人待审加入 `isModerationPublished`

代码表面最短，但会同时影响下载、标签、分享、评价详情和所有复用公共 helper 的路径，破坏审核门禁。D55 明确禁止。

## 4. 可见性与关联矩阵

| 图片状态 | 上传者相册/写记录 | 其他成员相册 | 本人评价编辑 | 评价公开详情/分享 |
| --- | --- | --- | --- | --- |
| 版本 1 pending/processing/error | 真实图片 + 仅自己可见 · 审核中 | 无行、无占位 | 可显示、选择、保存 ID | 无图片 |
| 版本 1 review | 真实图片 + 仅自己可见 · 进一步审核 | 无行、无占位 | 可显示、选择、保存 ID | 无图片 |
| 版本 1 rejected | 真实图片 + 仅自己可见 · 未通过 | 无行、无占位 | 保留状态，删除后重传 | 无图片 |
| approved/approved_legacy | 按现有相册隐私显示 | 按现有相册隐私显示 | 可显示、选择、保存 | 按现有评价规则显示 |
| 版本 0 未公开 | 无 URL 状态占位 | 无行 | 不可选择 | 无图片 |
| deleted/inactive | 不显示 | 不显示 | 不保留 | 不显示 |

评价关联是持久化选择，不是媒体授权。公开读取每次重新检查相册图片当前状态，因此待审关联不会公开，审核通过后可自然出现，拒绝或删除后继续隐藏。

## 5. 共享媒体投影与 URL 合并

在 `packages/shared/src/albumMedia.js` 增加纯函数：

```js
isAuthorPrivateAlbumMediaProjection(photo)
```

完整投影要求：

```text
publication_state === "author_only"
is_mine === true
can_preview === true
uploader_user_id 为正整数
media_type 为 image 或 video
moderation_status 为 pending/processing/error/review/rejected
```

`mergeMediaCollection` 对每个刷新行统一构造 `{ ...current, ...refreshed }`，不再对新 ID 提前返回：

```text
公开状态
  -> 保留权威 URL 和现有页面内存字段

完整作者投影
  -> 保留 preview/thumbnail/capability 到期时间
  -> 强制删除 download_url

其他未公开状态
  -> 删除全部 URL_FIELDS 与 LOCAL_MEDIA_FIELDS
```

小程序 `isAuthorPrivateAlbumMedia(photo, viewerUserId)` 复用共享投影后再校验 `uploader_user_id === viewerUserId`。共享层只识别 DTO 结构；最终用户身份绑定仍在具体页面层完成。

## 6. “写记录”页面设计

### 6.1 纯资格 helper

在 `sessionReviewPhotos.js` 增加：

```js
isSelectableSessionReviewAlbumPhoto(photo, viewerUserId)
```

它先要求：

```text
id > 0
media_type !== video
status === active
processing_status === ready
```

再接受：

```text
isModerationPublished(photo.moderation_status)
  OR
isAuthorPrivateAlbumMedia(photo, viewerUserId)
```

### 6.2 页面状态

`review.vue` 在登录完成后保存 `currentUserId`。加载相册、手机上传结果与后续刷新统一调用纯 helper。完整作者图片直接加入 `albumPhotos` 并自动选中；`albumPhotoUrl` 继续优先使用短时 thumbnail/preview 字段。

`pendingPhotoCount` 只统计服务端未提供作者能力的普通待审结果。它保留旧的关闭式保护：gate 未启用、DTO 不完整或身份不匹配时，不发送无法验证的 ID。

作者图片使用 `contentModeration` 现有安全文案，不展示服务商、命中标签或内部原因。

## 7. 评价服务端双视图

### 7.1 写入资格

在 `session-review.js` 定义独立纯判断：

```text
isAuthorPrivateSessionReviewAlbumPhoto(photo, viewerUserId)
isAssociableSessionReviewAlbumPhoto(photo, viewerUserId, visibleToViewer)
```

公开图片继续要求现有相册隐私对本人可见。未公开图片只有在以下条件全部满足时可关联：

```text
session_id 与评价车局一致
status=active
media_type=image
processing_status=ready
author_visibility_version=1
uploader_user_id=current_user.id
审核状态解析为 author_only
```

`upsertMySessionReviewWithConnection` 在 `FOR UPDATE` 锁中调用该判断。任何客户端身份字段均不参与。

### 7.2 读取投影

`reviewPhotos` 查询补充相册上传者和策略版本字段，并将行投影拆为：

```text
photos
  仅公开图片的公共字节 URL

albumPhotoIds
  公共调用：仅公开图片 ID
  本人调用：公开图片 ID + 本人仍合法的作者私有关联 ID
```

`listSessionReviews` 与 `getPublicSessionReview` 不传 owner 上下文，因此不会返回作者私有 ID。`getMySessionReview` 只为当前评价作者传入服务端认证 ID。

评价写入响应也只把公开图片放入 `photos`；所有已验证关联放入 `album_photo_ids`。公共图片字节接口继续调用 `isPublishableSessionReviewAlbumPhoto`，不增加作者例外。

## 8. 服务端 finalize 与相册读取

D55 不重写既有能力签发。现有流程保持：

```text
POST finalize
  -> 服务端认证 uploader
  -> 在事务中按 gate 写 author_visibility_version
  -> 创建审核任务
  -> 生成 author_only DTO
  -> attachSessionAlbumMediaUrls 签发短时能力
  -> private, no-store
```

成员相册 SQL 继续只返回：

```text
approved/approved_legacy
  OR
uploader_user_id = current_user.id
```

未公开行进入 `createAuthorPrivateMediaView` 前再次验证 gate、版本、作者、记录状态、对象 Key 与对象版本。能力 URL 的字节读取再锁行验证一次。非作者列表、公共分享和评价图片接口不调用作者签发器。

## 9. 配置、发布与回滚

仓库中的 `.env.example`、`.env.production.example` 和 Compose 示例继续保留默认 `false`，避免新环境无审批自动开启。实际环境修复步骤为：

```dotenv
CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED=true
CONTENT_MODERATION_AUTHOR_PREVIEW_TTL_SECONDS=60
```

API、审核 Worker 和迁移容器应读取同一 `.env.production`。gate 变更后滚动重启，确认启动配置一致，再上传一张全新图片验证版本 1。已有版本 0 图片不回填，需删除重传。

回滚顺序：

1. 将实际环境图片作者私有 gate 改为 false。
2. 滚动重启 API 与相关 Worker。
3. 验证新上传回到版本 0 占位行为。
4. 验证所有公共读取仍只认公开状态。
5. 不删除或公开既有版本 1 记录；按 D46 生命周期继续处理。

## 10. 错误与并发

- URL 刷新返回过期或较旧列表：沿用列表 authority，旧响应不得覆盖新状态。
- 图片在保存评价前被删除或换状态：事务锁下重新验证并返回 400，不写评价关联。
- 图片在公开读取前被拒绝或删除：每次读取重新检查，返回无图片或 404。
- gate 未启用或版本 0：前端关闭式保留占位，不把原始 URL或本地临时路径伪装成服务端作者能力。
- capability 过期：成员相册刷新获取新 URL；失败时移除旧 URL并显示安全状态，不退回公共路径。
- 同一图片重复提交：评价 ID 规范化继续拒绝重复，关联顺序保持客户端顺序。

## 11. 测试矩阵

### 自动测试

```text
packages/shared/test/albumMedia.test.mjs
  完整作者投影
  author_only URL 刷新
  download_url 剥离
  普通未公开新/旧行清理

apps/miniprogram/test/albumMediaUrls.test.mjs
  当前用户身份绑定
  刷新控制器保留新 capability

apps/miniprogram/test/sessionReviewPhotos.test.mjs
  公开/本人 author_only 可选
  他人/不完整/版本 0/视频不可选

apps/miniprogram/test/contentModeration.test.mjs
  上传后自动选中
  普通待审仍阻断
  保存请求携带 albumPhotoIds

apps/api/test/session-review-album-photos.test.mjs
  关联与公共投影纯契约

apps/api/test/content-moderation-user-image-boundaries.test.mjs
  本人 author_only 关联成功
  非作者与版本 0 写入前失败
  公开读取门保持严格
```

### 运行验收

1. 上传账号在相册页上传一张触发待审的新图片。
2. finalize 后立即看到真实图片与“仅自己可见 · 审核中”。
3. 等待 capability 刷新周期后图片仍显示。
4. 在“写记录”上传同类图片，立即显示、自动选中并可保存评价。
5. 第二账号打开成员相册和评价列表，看不到图片、占位、ID 或计数变化。
6. 匿名评价详情、相册分享和单图分享均看不到待审图片。
7. 审核通过后两个账号按原相册隐私与评价规则看到图片。
8. 审核拒绝后只有上传者保留作者状态，公共入口继续无图。
