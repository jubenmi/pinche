# 管理员相册视频设计

日期：2026-07-08

## 结论

视频作为车局相册里的媒体项存在，和照片混排、共用相册入口、标注、隐私、删除和可见性规则。第一版只允许管理员上传视频；普通同车成员仍只能上传照片，但可以按现有相册权限查看可见视频。

推荐路线是：小程序管理员上传前先压缩视频，直传 COS 源文件，数据万象异步生成单一展示版 MP4 和封面 JPG。相册展示使用封面卡片，点击后播放展示版视频。源文件只短期保留，用 COS 生命周期自动清理。

## 背景

现有相册已经具备发车后开放、同车成员访问、上传者标注、成员隐私和受保护图片访问。图片链路也已经采用“客户端直传 COS，后端只签名，数据万象生成长期展示资产”的模式。

视频能力需要继续服从这些边界：

- 不把相册变成公开内容平台。
- 不让管理员绕过成员隐私查看不可见内容。
- 不让普通成员一开始上传视频，避免内容安全和成本同时放大。
- 不把后端变成视频流量代理。

## 目标

1. 管理员可以向已发车车局相册上传短视频。
2. 视频和照片在同一个相册流里混排。
3. 普通成员可以查看自己有权限看到的视频，但不能上传视频。
4. 视频复用现有相册标注和隐私规则。
5. 视频上传和播放成本可控：上传前压缩、只生成一档展示版、不做 HLS 或多码率。
6. 视频播放不经由 API 服务器转发大文件。
7. 处理失败时不影响相册照片能力。

## 非目标

- 不开放普通成员上传视频。
- 不做独立视频相册。
- 不做公开视频广场。
- 不做 HLS、多清晰度、高清/标清切换。
- 不做会员原片下载。
- 不做服务端本地 ffmpeg 转码依赖。
- 不承诺长期保存视频源文件。

## 权限规则

### 上传权限

第一版视频上传只对 `system_admin` 开放，并且优先复用现有管理员相册上传边界：

- 小程序相册页只在当前用户有 `system_admin` 角色时展示视频上传入口。
- 普通成员、车头但非 `system_admin`、DM、NPC 和玩家都不展示视频上传入口。
- 后端必须在创建视频上传 intent 和创建视频媒体记录时校验 `system_admin`。
- 第一版明确不做全局管理员代传。上传者必须同时拥有 `system_admin` 并满足现有相册成员权限；管理后台若继续复用 `adminSessionAlbumPhoto` 语义，可以更严格地要求上传者同时是该车局 organizer。

### 查看权限

视频查看复用相册照片查看规则：

- 相册必须已开放。
- 访问者必须满足当前相册成员规则。
- 未标注视频默认只对上传者可见。
- 标注为“其他”或 NPC 相关对象后，按现有同车成员相册规则展示。
- 标注具体车友后，按被标注者和上传者隐私设置展示。
- 管理员不能因为自己有 `system_admin` 就绕过这些可见性规则。

处理中的视频仅上传者和有上传权限的管理员可见。处理失败的视频只对上传者和有上传权限的管理员显示，并提供删除或重传入口。

## 产品体验

### 相册列表

照片和视频混排，按上传时间倒序排列。

照片卡片保持现状。视频卡片使用数据万象生成的 `cover.jpg`：

- 中间显示播放图标。
- 角落显示时长，例如 `0:23`。
- 处理中显示封面占位和“处理中”状态。
- 处理失败显示“处理失败”，只对管理员可见。

相册统计文案从“照片”扩展为“媒体”或“照片/视频”：

- `全部可见 36 项`
- `筛选待标注 8 项`
- 单独需要展示类型时再写 `34 张照片 · 2 个视频`

### 上传入口

第一版推荐只在小程序管理员相册页开放视频上传。原因是小程序端可使用微信原生视频压缩能力，能显著降低上传体积。

小程序上传流程：

1. 管理员点击“上传视频”。
2. 使用 `wx.chooseMedia` 选择单个视频。
3. 校验时长和大小。
4. 使用 `wx.compressVideo` 主动压缩。
5. 压缩结果比原文件小时上传压缩版，否则在限制内上传原文件。
6. 直传 COS。
7. 创建相册视频记录，进入 `processing` 状态。

管理员 Web 第一版可以只支持查看、播放、标注和删除视频。Web 上传视频可以后置；如果必须同时支持，应使用更严格的大小限制，并提示管理员先上传短视频。

## 视频限制

第一版建议限制：

| 项 | 建议 |
| --- | --- |
| 单次选择 | 1 个视频 |
| 最大时长 | 30 秒，最多可配置到 60 秒 |
| 上传前原文件上限 | 100 MB |
| 压缩后目标上限 | 20-40 MB |
| 展示版 | MP4, H.264, AAC |
| 展示分辨率 | 最长边 1280 或 720p |
| 展示码率 | 1200-1800 kbps |
| 帧率 | 24 或 30 fps |

超过限制时前端直接提示用户换短一点的视频，不创建上传 intent。

## 存储路径

生产环境启用 COS 时使用三个前缀：

```text
uploads/session-album/videos/source/...
uploads/session-album/videos/display/...
uploads/session-album/videos/cover/...
```

对象命名沿用现有上传文件名模式，带 session id、user id、时间戳和随机后缀：

```text
admin-video-{sessionId}-{userId}-{timestamp}-{random}.mp4
admin-video-{sessionId}-{userId}-{timestamp}-{random}.jpg
```

源文件只用于数据万象处理。处理成功后，源文件进入 COS 生命周期清理，建议保留 7-30 天。相册长期使用 `display` 和 `cover`。

## 数据模型

推荐把现有 `session_album_photos` 演进为“相册媒体项”，不新建独立视频表。这样可以复用现有相册查询、标签、隐私、删除和可见性逻辑。

新增字段建议：

```text
media_type VARCHAR(16) NOT NULL DEFAULT 'image'
processing_status VARCHAR(32) NOT NULL DEFAULT 'ready'
source_url VARCHAR(512) NULL
display_url VARCHAR(512) NULL
cover_url VARCHAR(512) NULL
duration_seconds INT UNSIGNED NULL
video_width INT UNSIGNED NULL
video_height INT UNSIGNED NULL
video_byte_size BIGINT UNSIGNED NULL
video_content_type VARCHAR(64) NULL
ci_job_id VARCHAR(128) NULL
processing_error VARCHAR(255) NULL
```

现有图片数据迁移为：

```text
media_type = image
processing_status = ready
photo_url = existing photo_url
```

视频数据为：

```text
media_type = video
processing_status = processing | ready | failed
source_url = source mp4 path
display_url = processed mp4 path
cover_url = cover jpg path
photo_url = NULL
```

如果保持 `photo_url NOT NULL` 会让视频记录变得别扭，因此迁移时应允许 `photo_url` 为 NULL，并让所有图片读取逻辑按 `media_type = image` 使用 `photo_url`。

`session_album_photo_tags` 可以继续引用媒体项 id，不需要新建 `session_album_video_tags`。

## 接口设计

### 上传 intent

新增 COS intent kind：

```text
adminSessionAlbumVideo
```

请求仍走：

```text
POST /api/uploads/cos-intent
POST /api/uploads/cos-authorization
```

后端校验：

- 用户已登录。
- 用户有 `system_admin`。
- 车局相册已开放。
- 用户满足本次定义的管理员上传边界。
- COS key 必须落在 `uploads/session-album/videos/source/`。
- 文件扩展名只允许 `.mp4` 或平台实际可处理的视频格式；第一版推荐只接受 `.mp4`。

### 创建视频媒体记录

新增：

```text
POST /api/admin/sessions/:id/album/videos
```

请求体：

```json
{
  "sourceUrl": "/uploads/session-album/videos/source/admin-video-1-2-123-a.mp4",
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
  "id": 123,
  "media_type": "video",
  "processing_status": "processing"
}
```

### 处理回调

数据万象任务完成后，后端接收回调或由后台任务轮询任务结果，更新：

- `processing_status = ready`
- `display_url`
- `cover_url`
- `duration_seconds`
- `video_width`
- `video_height`
- `video_byte_size`
- `video_content_type`

失败时更新：

- `processing_status = failed`
- `processing_error`

### 列表返回

`GET /api/sessions/:id/album` 保持原接口，但 `photos` 可以逐步改名为 `media`。为兼容前端，第一版可以同时返回：

```json
{
  "photos": [],
  "media": []
}
```

媒体项字段：

```json
{
  "id": 123,
  "media_type": "video",
  "processing_status": "ready",
  "cover_url": "/api/session-album/media/123/cover?...",
  "video_url": "/api/session-album/media/123/video-url",
  "duration_seconds": 23,
  "video_width": 1280,
  "video_height": 720,
  "is_mine": true,
  "can_tag": true,
  "tags": []
}
```

## 媒体访问

封面图可以复用现有受保护图片读取方式，因为封面体积小。

视频播放不能让 API 服务器读取 COS 对象再返回。推荐接口：

```text
GET /api/session-album/media/:id/video-url
```

该接口完成登录态、相册成员、媒体可见性和短期签名校验后，返回短期 COS 签名 URL：

```json
{
  "url": "https://...signed..."
}
```

小程序和 Web 播放器直接使用该签名 URL 拉取视频。签名有效期建议 5-10 分钟。

本地开发未启用 COS 时，不引入 ffmpeg。后端可以把上传的 MP4 作为 `display_url`，使用通用视频占位封面，保证权限、列表和播放流程可测。

## 数据万象处理

第一版只做两个长期资产：

1. 展示版 MP4：单一规格，H.264/AAC，最长边 1280 或 720p。
2. 封面 JPG：取首帧或固定时间点截图，例如第 1 秒。

不做：

- HLS
- 多码率
- 智能封面
- 视频增强
- 超分
- 水印

数据万象任务必须可重试。重复回调应幂等：同一个 `ci_job_id` 或同一个媒体 id 的 ready 更新可以重复执行，不创建新媒体项。

## 前端设计

### 小程序

相册页增加管理员视频上传按钮：

- 普通成员不展示。
- `system_admin` 展示。
- 上传状态文案区分“上传中”和“处理中”。

视频卡片：

- `processing`：显示占位，不可播放。
- `ready`：显示封面和播放按钮。
- `failed`：仅管理员可见，显示删除/重传。

播放：

1. 点击视频卡片。
2. 请求 `video-url`。
3. 使用小程序 video 组件播放签名 URL。

### 管理员 Web

第一版至少支持：

- 在相册流里显示视频卡片。
- 播放 ready 视频。
- 标注视频。
- 删除自己上传或有权限删除的视频。
- 显示 processing/failed 状态。

Web 上传视频可以作为后续增强。如果第一版也支持 Web 上传，必须设置更严格的文件大小和时长限制，并明确 Web 端没有微信原生压缩能力。

## 错误和边界

- 普通成员调用视频上传 intent 返回 403。
- 管理员上传非 MP4 或超限视频返回 400。
- 数据万象处理超时后媒体项保持 `processing`，前端显示处理中，不影响其他照片。
- 处理失败只对管理员显示，不计入普通成员可见数量。
- 视频签名 URL 过期后重新请求 `video-url`。
- 已取消车局不引导上传视频。
- 删除视频媒体项时，应删除或标记清理 `source`、`display` 和 `cover` 三类对象。

## 公开分享边界

如果当前相册分享存在无登录 claim 视角，第一版不开放视频播放。公开分享可以：

- 显示视频封面和时长。
- 不返回可播放视频 URL。
- 文案提示“打开小程序查看视频”。

后续若要开放分享播放，需要单独设计 claim 级视频签名、有效期、频控和成本保护。

## 测试与验收

1. 普通成员相册页不展示视频上传入口。
2. 普通成员调用 `adminSessionAlbumVideo` intent 返回 403。
3. `system_admin` 可以创建视频上传 intent。
4. 超过时长或大小的视频不会发起上传。
5. 成功上传后，相册出现 processing 视频卡片。
6. 数据万象成功回调后，视频卡片变为 ready，展示封面和时长。
7. 可见成员可以播放 ready 视频。
8. 不可见成员不能获取视频签名 URL。
9. 复制视频签名 URL 过期后不可继续播放。
10. 处理失败的视频只对管理员可见。
11. 视频标注后按现有隐私规则影响可见性。
12. 删除视频后，相册列表不再展示该视频，并触发 COS 对象清理。
13. 现有照片上传、展示、标注、隐私设置和图片预览不回归。

## 路线对比

### A. 扩展相册照片表为媒体项

推荐。复用相册、标签和隐私逻辑，用户体验也是同一个相册。代价是需要谨慎迁移 `photo_url` 和前端字段命名。

### B. 新建视频表

表结构更干净，但会复制标签、隐私、可见性、删除和列表排序逻辑。后续维护成本更高。

### C. 独立视频相册

开发时边界清晰，但用户需要理解两个相册入口，也容易和现有发车后相册主路径冲突。不适合当前产品阶段。

## 自检

- 本设计没有开放普通成员上传视频。
- 本设计没有新增公开内容平台。
- 本设计没有让管理员绕过成员隐私查看视频。
- 本设计没有让 API 服务器代理视频大文件。
- 本设计只生成一档展示版，成本可控。
- 本设计保留现有图片相册路径，老照片可以平滑迁移。
