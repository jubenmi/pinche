# D32 Design: 管理员相册短视频测试设计

更新日期：2026-07-08

## Overview

D32 把视频定义为车局相册里的短视频媒体项。视频和照片混排，共用相册入口、标注、隐私、删除和可见性逻辑。第一阶段只开放 `system_admin` 管理员上传，用来灰测上传前压缩、COS 存储、数据万象处理成本和相册体验。

D32 的实现原则是“在现有相册上增加视频管理能力”。除 COS 视频处理、视频播放签名和视频上传前压缩这些类型差异外，优先沿用当前相册的页面、接口、服务、权限、标注、隐私、删除、分享和下载边界，不新建平行的视频管理系统。

推荐链路：

```text
小程序选择视频
  -> 时长和大小校验
  -> wx.compressVideo
  -> 上传前确认
  -> 直传 COS source
  -> 创建相册视频记录 ready，display_url 指向 source MP4
  -> 后端按需生成第 1 秒 snapshot 签名封面 URL
  -> 点击封面获取短期签名 URL 播放
```

视频形态按“朋友圈短视频分享”处理：15-30 秒最佳，60 秒硬上限。超过 60 秒的视频直接拒绝，不切片、不自动裁剪、不拆成多个相册项。

## Non-Goals

- 不开放普通成员、付费用户或免费用户上传视频。
- 不定义会员权益、免费额度、视频次数或存储配额。
- 不做独立视频相册、公开视频广场或长视频平台。
- 不做云端转码、云端压缩、HLS、多码率、多清晰度切换或服务端本地 ffmpeg 转码。
- 不做自动切片、自动裁剪、智能封面、增强、超分或水印。
- 不提供视频下载、批量保存或原片下载。
- 不保存或承诺长期保留未压缩原片；D32 的 COS source 是本地压缩后的播放资产。

## Product Model

### 相册扩展优先

D32 不把视频做成新的内容模块。实现时按以下顺序选择方案：

1. 能复用相册已有能力的，复用现有相册能力。
2. 能在相册媒体项上增加 `media_type = video` 分支解决的，不新建视频表或视频页面。
3. 能复用现有标签、隐私、删除和分享过滤的，不复制一套视频标签、视频隐私或视频分享规则。
4. 只有在视频客观不同的地方新增能力：上传前压缩、COS source 存储、处理状态、URL 截帧封面、播放签名 URL 和播放器。

### 权限

上传权限：

- 小程序只给 `system_admin` 展示视频上传入口。
- 后端在 COS intent 和创建视频媒体记录时都校验 `system_admin`。
- 上传者还必须满足现有相册上传边界：相册已开放，且上传者是该车局相册成员。
- 第一阶段不使用付费用户、免费用户、会员等级或额度字段。

查看权限：

- 视频复用现有相册成员和隐私规则。
- 未标注视频默认只对上传者可见。
- 标注真实车友后，按上传者和被标注者隐私设置计算可见性。
- 管理员不因 `system_admin` 身份绕过成员隐私。
- `processing` 和 `failed` 视频只对上传者和有视频上传权限的管理员显示。

### 列表表现

照片和视频按上传时间倒序混排。视频卡片状态：

- `processing`：占位封面，文字“处理中”，不可播放。
- `ready`：封面、播放图标、时长。
- `failed`：文字“处理失败”，只对上传者和有权限管理员显示，可删除或重传。
- 朋友圈公开只读：可显示封面和时长，但文案为“打开小程序查看视频”，不返回播放 URL。

下载边界：

- `全部下载` 只下载照片。
- `多选下载` 只允许选择照片。
- 视频不显示下载选择态。
- 文案避免把下载称为“全部媒体下载”。

## Data Model

推荐演进现有 `session_album_photos` 为相册媒体项，不新建 `session_album_videos`。这样可复用标签、隐私、删除、列表排序和公开分享过滤逻辑。

新增迁移建议：

```sql
ALTER TABLE session_album_photos
  MODIFY COLUMN photo_url VARCHAR(512) NULL,
  ADD COLUMN media_type VARCHAR(16) NOT NULL DEFAULT 'image' AFTER uploader_user_id,
  ADD COLUMN processing_status VARCHAR(32) NOT NULL DEFAULT 'ready' AFTER status,
  ADD COLUMN source_url VARCHAR(512) NULL AFTER photo_url,
  ADD COLUMN display_url VARCHAR(512) NULL AFTER source_url,
  ADD COLUMN cover_url VARCHAR(512) NULL AFTER display_url,
  ADD COLUMN duration_seconds INT UNSIGNED NULL AFTER image_content_type,
  ADD COLUMN video_width INT UNSIGNED NULL AFTER duration_seconds,
  ADD COLUMN video_height INT UNSIGNED NULL AFTER video_width,
  ADD COLUMN video_byte_size BIGINT UNSIGNED NULL AFTER video_height,
  ADD COLUMN video_content_type VARCHAR(64) NULL AFTER video_byte_size,
  ADD COLUMN ci_job_id VARCHAR(128) NULL AFTER video_content_type,
  ADD COLUMN processing_error VARCHAR(255) NULL AFTER ci_job_id,
  ADD INDEX idx_session_album_media_type_status (session_id, media_type, processing_status);
```

Existing image rows:

```text
media_type = image
processing_status = ready
photo_url = existing photo_url
```

Video rows:

```text
media_type = video
processing_status = ready
photo_url = NULL
source_url = /uploads/session-album/videos/source/...
display_url = same as source_url
cover_url = NULL  # 第一阶段使用 URL 截帧；字段保留给未来持久化 cover
```

`session_album_photo_tags.photo_id` 继续引用媒体项 id。D32 不新增 `session_album_video_tags`，也不在第一阶段重命名历史表。

## Storage And Processing

COS 前缀：

```text
uploads/session-album/videos/source/
uploads/session-album/videos/display/  # 历史兼容和未来云端转码预留，D32 第一阶段主链路不写入
```

对象命名沿用现有上传风格，包含 session id、user id、时间戳和随机后缀：

```text
admin-video-{sessionId}-{userId}-{timestamp}-{random}.mp4
admin-video-{sessionId}-{userId}-{timestamp}-{random}.jpg  # 未来持久化 cover 预留
```

D32 第一阶段不再提交云端转码任务。本地 `wx.compressVideo` 产出的 MP4 直传到 `source` 前缀后，即作为长期展示和播放资产。后端创建视频媒体记录时将 `display_url` 写为同一个 source path，并立即置为 `ready`。

封面第一阶段不创建长期 `cover` 对象。后端在相册列表和公开分享里，基于展示版 MP4 生成 5-10 分钟有效的 COS URL 截帧地址：

```text
ci-process=snapshot&time=1&format=jpg
```

source MP4 是第一阶段播放资产，不能作为转码源文件短期清理。删除视频媒体项时，应清理或登记清理 `source`，并兼容清理历史 `display` 和 `cover` 对象。

历史回调或轮询更新仍保持幂等，作为兼容能力而非主链路：

- 同一 `ci_job_id` 的成功回调重复到达时，只更新同一媒体项。
- 已 `ready` 的媒体项再次收到同样成功结果时，不创建新行。
- 失败回调写入 `processing_status = failed` 和 `processing_error`。

本地开发未启用 COS 时，不引入 ffmpeg。可把上传的 MP4 作为 `display_url`，使用本地 fallback URL 保证权限、列表和签名 URL 流程可测。

## Backend Design

### COS Intent

新增 upload kind：

```text
adminSessionAlbumVideo
```

继续使用：

```text
POST /api/uploads/cos-intent
POST /api/uploads/cos-authorization
```

intent 返回：

```json
{
  "direct": true,
  "kind": "adminSessionAlbumVideo",
  "sessionId": 123,
  "bucket": "bucket",
  "region": "ap-guangzhou",
  "key": "uploads/session-album/videos/source/admin-video-123-456-1783512000-a1b2c3d4e5f6a7b8.mp4",
  "uploadPath": "/uploads/session-album/videos/source/admin-video-123-456-1783512000-a1b2c3d4e5f6a7b8.mp4",
  "maxBytes": 104857600,
  "contentType": "video/mp4"
}
```

校验规则：

- 用户已登录。
- 用户有 `system_admin`。
- 车局相册已开放。
- 用户满足现有相册成员上传边界。
- key 必须匹配 `uploads/session-album/videos/source/admin-video-{sessionId}-{userId}-...mp4`。
- 第一阶段只接受 `.mp4` 和 `video/mp4`。
- COS authorization 再次校验 key、bucket、region、method 和上传者。

### Create Video Media

新增：

```text
POST /api/admin/sessions/:id/album/videos
```

请求体：

```json
{
  "sourceUrl": "/uploads/session-album/videos/source/admin-video-123-456-1783512000-a1b2c3d4e5f6a7b8.mp4",
  "durationSeconds": 23,
  "videoWidth": 1280,
  "videoHeight": 720,
  "videoByteSize": 18400000,
  "videoContentType": "video/mp4"
}
```

返回：

```json
{
  "id": 789,
  "media_type": "video",
  "processing_status": "ready",
  "duration_seconds": 23
}
```

服务层建议新增 `createSessionAlbumVideo(user, sessionId, body)`。创建记录时：

- 校验 `system_admin` 和现有相册成员边界。
- 校验 `sourceUrl` 前缀和文件名属于当前 session/user。
- 校验 `durationSeconds <= 60`。
- 写入 `media_type = video`、`processing_status = ready`。
- 写入 `display_url = source_url`，不提交数据万象转码任务。

### List Album

`GET /api/sessions/:id/album` 和 `GET /api/admin/sessions/:id/album` 继续可用。第一阶段返回兼容结构：

```json
{
  "photos": [],
  "media": []
}
```

图片项保留原字段，并补充：

```json
{
  "media_type": "image",
  "processing_status": "ready"
}
```

视频项字段：

```json
{
  "id": 789,
  "media_type": "video",
  "processing_status": "ready",
  "cover_url": "https://bucket.cos.ap-guangzhou.myqcloud.com/uploads/session-album/videos/source/...?ci-process=snapshot&time=1&format=jpg&...",
  "video_url": "/api/session-album/media/789/video-url",
  "duration_seconds": 23,
  "video_width": 1280,
  "video_height": 720,
  "video_byte_size": 18400000,
  "video_content_type": "video/mp4",
  "is_mine": true,
  "can_tag": true,
  "created_at": "2026-07-08T12:00:00.000Z",
  "tags": []
}
```

`visible_count` 第一阶段可继续表示当前可见媒体总数；需要区分时新增 `image_count` 和 `video_count`。

### Cover And Video Access

封面图不经 API 代理图片字节流。后端在相册列表、公开分享列表生成短期签名的 COS URL 截帧地址，参数固定为 `ci-process=snapshot&time=1&format=jpg`。该 URL 只在对应列表权限校验通过后返回。

视频播放必须使用短期签名 URL：

```text
GET /api/session-album/media/:id/video-url
```

返回：

```json
{
  "url": "https://bucket.cos.ap-guangzhou.myqcloud.com/uploads/session-album/videos/source/...?sign=...",
  "expires_in": 600
}
```

后端校验：

- 用户已登录。
- 媒体存在且 `status = active`。
- `media_type = video`。
- `processing_status = ready`。
- 用户是相册成员且媒体对该用户可见。

API 服务器只签名，不代理视频字节流。签名有效期建议 5-10 分钟。

### Public Share

`GET /api/sessions/:id/album/public-share` 第一阶段不返回可播放视频 URL。若公开分享过滤后有视频：

- 可返回封面、时长、`media_type = video`。
- 不返回 `video_url`。
- 前端展示“打开小程序查看视频”。
- 不显示播放失败或可播放按钮。

后续如开放公开视频播放，需要单独设计公开 claim 绑定的视频签名、有效期、频控和成本保护。

## Mini Program Design

### Upload Flow

管理员上传流程：

1. 点击“上传视频”。
2. `wx.chooseMedia({ count: 1, mediaType: ["video"] })`。
3. 读取时长、尺寸、大小和临时文件路径。
4. 若时长超过 60 秒，提示先剪辑后上传，并停止流程。
5. 若基础大小超过前端上限，提示换更短视频，并停止流程。
6. 调用 `wx.compressVideo`。
7. 选择压缩后更小的文件，否则在限制内使用原文件。
8. 展示确认弹窗：时长、预计上传大小、按相册隐私展示。
9. 创建 `adminSessionAlbumVideo` COS intent。
10. 直传 COS。
11. 调用 `POST /api/admin/sessions/:id/album/videos`。
12. 相册插入或刷新 ready 视频卡片，封面使用 URL 截帧。

建议限制：

| 项 | 建议 |
| --- | --- |
| 单次选择 | 1 个视频 |
| 推荐时长 | 15-30 秒 |
| 最大时长 | 60 秒硬上限 |
| 上传前原文件上限 | 100 MB |
| 压缩后目标上限 | 20-40 MB |
| 展示版 | 使用本地压缩后的 MP4 |
| 展示分辨率 | 由 `wx.compressVideo` 输出决定 |
| 展示码率 | 由 `wx.compressVideo` 输出决定 |

### Album UI

相册页从纯照片列表演进为媒体列表。为了降低迁移风险，代码可以先继续使用 `photos` 数据源，但每项必须依据 `media_type` 分支渲染。

视频卡片：

- 封面图使用 `cover_url`。
- 中央显示播放图标。
- 角落显示 `0:23` 形式时长。
- `processing` 仅作为历史兼容状态展示“处理中”。
- `failed` 展示“处理失败”，仅管理员/上传者可见。
- 点击 ready 视频后请求 `video-url`，再打开小程序 `<video>` 播放。
- 不自动播放。

下载相关：

- `downloadAllPhotos` 只统计和下载 `media_type = image`。
- 多选模式只允许选中图片。
- 视频卡片不显示下载勾选态。
- 有视频时，下载文案写“下载照片”而不是“下载全部媒体”。

### Admin Web

第一阶段 Web 管理端最低能力：

- 相册流显示视频卡片。
- ready 视频可播放。
- 视频可标注。
- 有权限视频可删除。
- 显示 processing 和 failed 状态。

Web 上传可后置。若必须支持 Web 上传，使用更严格的时长和大小限制，并提示管理员先压缩或剪短视频，因为 Web 没有微信小程序原生 `wx.compressVideo`。

## Error Handling

- 非管理员创建 `adminSessionAlbumVideo` intent：403。
- 非管理员创建视频媒体记录：403。
- 非 MP4 或 content type 不合法：400。
- 超过 60 秒：前端拦截，后端再次返回 400。
- 历史数据万象处理超时：保持 `processing`，前端显示处理中，不影响照片。
- 历史数据万象失败：更新 `failed`，只对上传者和有权限管理员可见。
- 视频签名 URL 过期：前端重新请求。
- 删除视频：删除数据库记录或置为 inactive，并清理或登记清理 COS 对象。

## Rollout

1. 仅在管理员测试环境或灰度开关下展示视频上传入口。
2. 先用小程序管理员上传完成端到端验证。
3. 观察平均压缩后大小、URL 截帧成功率、播放成功率和 COS 流量。
4. 确认成本稳定后，再另写付费/免费用户开放规格。

## Tests

后续实现至少覆盖：

- 非管理员看不到上传入口。
- 非管理员调用视频 intent 返回 403。
- 管理员可以创建 video intent，key 落在 source 前缀。
- 超过 60 秒不压缩、不上传、不创建 intent。
- 上传成功后列表出现 ready 视频封面和时长。
- 可见成员可获取视频签名 URL 并播放。
- 不可见成员不能获取视频签名 URL。
- API 不代理视频字节流。
- 历史处理失败只对管理员或上传者可见。
- 视频标注后复用现有隐私规则。
- 视频不参与全部下载和多选下载。
- 朋友圈公开只读不返回视频播放 URL。
- 现有照片上传、预览、标注、隐私和下载不回归。
