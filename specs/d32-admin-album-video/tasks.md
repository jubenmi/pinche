# D32 Tasks: 管理员相册短视频测试执行清单

更新日期：2026-07-08

## D32 执行任务

- [x] D32.1 建立 D32 spec 三件套。
  - [x] `requirements.md` 描述管理员测试、短视频限制、混排相册、COS/数据万象、签名 URL 播放、公开分享和验证要求。
  - [x] `design.md` 描述数据模型、存储处理、后端接口、小程序上传、Web 管理、错误处理和测试范围。
  - [x] `tasks.md` 描述后续实现和验收清单。

- [ ] D32.2 新增相册媒体数据模型迁移。
  - [ ] 将 `session_album_photos.photo_url` 改为允许 NULL，以支持视频记录。
  - [ ] 新增 `media_type` 字段，默认 `image`。
  - [ ] 新增 `processing_status` 字段，默认 `ready`。
  - [ ] 新增视频源文件、展示文件和封面字段：`source_url`、`display_url`、`cover_url`。
  - [ ] 新增视频元数据字段：`duration_seconds`、`video_width`、`video_height`、`video_byte_size`、`video_content_type`。
  - [ ] 新增数据万象处理字段：`ci_job_id`、`processing_error`。
  - [ ] 确认旧照片行迁移后仍为 `media_type=image`、`processing_status=ready`。
  - [ ] 保持 `session_album_photo_tags` 继续引用媒体项 id，不新增视频标签表。

- [ ] D32.3 实现视频 COS intent 和授权。
  - [ ] 新增 upload kind `adminSessionAlbumVideo`。
  - [ ] intent 只允许 `system_admin` 且满足现有相册成员上传边界。
  - [ ] COS key 生成到 `uploads/session-album/videos/source/`。
  - [ ] key 包含 session id、user id、时间戳和随机后缀。
  - [ ] 第一阶段只接受 `.mp4` 和 `video/mp4`。
  - [ ] `directUploadKindForKey` 能识别 `adminSessionAlbumVideo`。
  - [ ] `authorizeCosDirectUpload` 再次校验 bucket、region、method、key、上传者和权限。
  - [ ] 添加静态检查或后端烟测，确认非管理员不能获得视频 intent。

- [ ] D32.4 实现视频媒体记录创建和处理任务。
  - [ ] 新增 `POST /api/admin/sessions/:id/album/videos`。
  - [ ] 新增服务函数 `createSessionAlbumVideo(user, sessionId, body)`。
  - [ ] 校验 `system_admin`、相册已开放、成员上传边界和 source URL 前缀。
  - [ ] 后端再次校验 `durationSeconds <= 60`。
  - [ ] 写入 `media_type=video`、`processing_status=processing`。
  - [ ] 提交数据万象任务，生成 display MP4 和 cover JPG。
  - [ ] 记录 `ci_job_id`。
  - [ ] 本地无 COS 时提供可测的 fallback，不引入本地 ffmpeg。

- [ ] D32.5 实现数据万象回调或轮询更新。
  - [ ] 新增处理成功更新逻辑：写入 `display_url`、`cover_url` 和视频元数据。
  - [ ] 新增处理失败更新逻辑：写入 `processing_status=failed` 和 `processing_error`。
  - [ ] 重复回调必须幂等，不创建重复媒体项。
  - [ ] 处理超时不影响相册照片列表。
  - [ ] 删除视频时清理或登记清理 source、display、cover 对象。

- [ ] D32.6 改造相册列表为媒体混排。
  - [ ] 以现有相册服务和接口为主体增加 `media_type` 分支，不新建平行视频列表服务。
  - [ ] `listSessionAlbum` 查询图片和视频媒体项，并按 `created_at DESC, id DESC` 排序。
  - [ ] 返回图片项时补充 `media_type=image` 和 `processing_status=ready`。
  - [ ] 返回视频项时包含 `cover_url`、`video_url`、时长和元数据。
  - [ ] 第一阶段保留 `photos` 兼容字段，并可新增 `media` 字段。
  - [ ] 复用现有相册标签和隐私过滤，确保管理员不绕过成员隐私。
  - [ ] `processing` 和 `failed` 视频只对上传者和有上传权限管理员显示。
  - [ ] 处理失败视频不计入普通成员可见数量。

- [ ] D32.7 实现视频封面和播放签名接口。
  - [ ] 新增或复用受保护封面接口。
  - [ ] 新增 `GET /api/session-album/media/:id/video-url`。
  - [ ] 接口校验登录、相册成员、媒体可见性、`media_type=video` 和 `processing_status=ready`。
  - [ ] 返回 5-10 分钟有效的 COS 签名 URL。
  - [ ] 确认 API 服务器不代理视频字节流。
  - [ ] 签名 URL 过期后前端可重新请求。

- [ ] D32.8 改造小程序管理员视频上传。
  - [ ] 只给 `system_admin` 展示视频上传入口。
  - [ ] 使用 `wx.chooseMedia` 单选视频。
  - [ ] 超过 60 秒时提示先剪辑后上传，并停止流程。
  - [ ] 60 秒以内视频调用 `wx.compressVideo`。
  - [ ] 选择压缩后更小的文件上传，否则在限制内上传原文件。
  - [ ] 上传前确认展示时长、预计大小和“按相册隐私展示”。
  - [ ] 直传 COS source 对象。
  - [ ] 创建视频媒体记录后显示 `processing` 卡片。

- [ ] D32.9 改造小程序相册视频展示和播放。
  - [ ] 在当前相册页内增加视频卡片、状态和播放，不新增独立视频相册页。
  - [ ] 相册卡片按 `media_type` 渲染图片或视频。
  - [ ] 视频 ready 卡片展示封面、播放图标和时长。
  - [ ] 视频 processing 卡片展示“处理中”文字，不可播放。
  - [ ] 视频 failed 卡片展示“处理失败”文字，只对上传者和有权限管理员可见。
  - [ ] 点击 ready 视频时请求 `video-url` 并打开 `<video>` 播放。
  - [ ] 不自动播放视频。
  - [ ] 状态表达不能只依赖颜色或图标。
  - [ ] `全部下载` 只下载照片。
  - [ ] `多选下载` 只允许选择照片，视频不可选。

- [ ] D32.10 改造管理员 Web 相册视频能力。
  - [ ] 相册流显示视频卡片。
  - [ ] ready 视频可播放。
  - [ ] 视频可标注。
  - [ ] 有权限视频可删除。
  - [ ] 显示 processing 和 failed 状态。
  - [ ] Web 上传视频暂不实现；如实现则使用更严格时长和大小限制。

- [ ] D32.11 收紧朋友圈公开分享边界。
  - [ ] 公开相册接口可返回视频封面和时长。
  - [ ] 公开相册接口不返回视频播放 URL。
  - [ ] 公开分享视频卡片展示“打开小程序查看视频”。
  - [ ] 公开分享视频卡片不显示可播放但点不动的状态。
  - [ ] 后续公开视频播放另写 claim 级签名和成本保护规格。

- [ ] D32.12 更新静态检查、烟测和构建验证。
  - [ ] 更新 `scripts/check-miniprogram.js`，检查普通用户不展示视频上传入口。
  - [ ] 检查小程序视频上传流程包含 `wx.chooseMedia`、`wx.compressVideo` 和 60 秒拦截。
  - [ ] 检查下载流程只作用于 `media_type=image`。
  - [ ] 新增后端烟测覆盖管理员/非管理员 intent、创建视频、可见性和签名 URL。
  - [ ] 新增公开分享烟测，确认不返回视频播放 URL。
  - [ ] 运行 `npm run check`。
  - [ ] 运行 `npm run build:mp-weixin`。
  - [ ] 记录无法自动验证的微信开发者工具手工场景。

## D32 验收

- [x] D32 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D32 design 已落地到 [design.md](./design.md)。
- [x] D32 tasks 已落地到本文件。
- [ ] 只有 `system_admin` 可以上传视频。
- [ ] 普通成员可以按相册权限查看 ready 视频，但不能上传。
- [ ] 视频和照片在同一相册混排。
- [ ] 视频管理能力是在现有相册页面和服务上扩展，不形成独立视频管理模块。
- [ ] 视频复用现有相册标签和隐私规则。
- [ ] 超过 60 秒视频不压缩、不上传、不创建 intent。
- [ ] 小程序上传前使用 `wx.compressVideo`。
- [ ] 视频源文件直传 COS source 前缀。
- [ ] 数据万象生成单一 display MP4 和 cover JPG。
- [ ] API 只返回短期签名 URL，不代理视频字节流。
- [ ] 视频不参与全部下载和多选下载。
- [ ] 朋友圈公开只读不返回视频播放 URL。
- [ ] 现有照片上传、展示、预览、标注、隐私和下载不回归。
- [ ] `npm run check` 通过。
- [ ] `npm run build:mp-weixin` 通过。

## 验证记录

- D32 spec 三件套已创建，后续实现时在本节补充红绿灯、烟测、构建和微信开发者工具验证记录。
