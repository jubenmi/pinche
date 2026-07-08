# D32 Tasks: 管理员相册短视频测试执行清单

更新日期：2026-07-08

## D32 执行任务

- [x] D32.1 建立 D32 spec 三件套。
  - [x] `requirements.md` 描述管理员测试、短视频限制、混排相册、COS/数据万象、签名 URL 播放、公开分享和验证要求。
  - [x] `design.md` 描述数据模型、存储处理、后端接口、小程序上传、Web 管理、错误处理和测试范围。
  - [x] `tasks.md` 描述后续实现和验收清单。

- [x] D32.2 新增相册媒体数据模型迁移。
  - 进度：2026-07-08 开始按 D32 spec 实现，先新增红灯检查，再落地迁移和现有相册媒体分支。
  - [x] 将 `session_album_photos.photo_url` 改为允许 NULL，以支持视频记录。
  - [x] 新增 `media_type` 字段，默认 `image`。
  - [x] 新增 `processing_status` 字段，默认 `ready`。
  - [x] 新增视频源文件、展示文件和封面字段：`source_url`、`display_url`、`cover_url`。
  - [x] 新增视频元数据字段：`duration_seconds`、`video_width`、`video_height`、`video_byte_size`、`video_content_type`。
  - [x] 新增数据万象处理字段：`ci_job_id`、`processing_error`。
  - [x] 确认旧照片行迁移后仍为 `media_type=image`、`processing_status=ready`。
  - [x] 保持 `session_album_photo_tags` 继续引用媒体项 id，不新增视频标签表。

- [x] D32.3 实现视频 COS intent 和授权。
  - [x] 新增 upload kind `adminSessionAlbumVideo`。
  - [x] intent 只允许 `system_admin` 且满足现有相册成员上传边界。
  - [x] COS key 生成到 `uploads/session-album/videos/source/`。
  - [x] key 包含 session id、user id、时间戳和随机后缀。
  - [x] 第一阶段只接受 `.mp4` 和 `video/mp4`。
  - [x] `directUploadKindForKey` 能识别 `adminSessionAlbumVideo`。
  - [x] `authorizeCosDirectUpload` 再次校验 bucket、region、method、key、上传者和权限。
  - [x] 添加静态检查或后端烟测，确认非管理员不能获得视频 intent。

- [x] D32.4 实现视频媒体记录创建和处理任务。
  - 进度：2026-07-08 用户确认最终低成本通路：视频上传前本地压缩，COS source 即展示 MP4，不再使用云端转码；封面继续由后端按需生成短期签名 `ci-process=snapshot&time=1&format=jpg` URL。后端创建状态已从等待 workflow 回调调整为直接 ready，腾讯云 workflow 上传触发已关闭以避免转码费用。
  - [x] 新增 `POST /api/admin/sessions/:id/album/videos`。
  - [x] 新增服务函数 `createSessionAlbumVideo(user, sessionId, body)`。
  - [x] 校验 `system_admin`、相册已开放、成员上传边界和 source URL 前缀。
  - [x] 后端再次校验 `durationSeconds <= 60`。
  - [x] 写入 `media_type=video`、`processing_status=ready`、`display_url=source_url`，不再等待云端转码回调。
  - [x] 在腾讯云控制台关闭 `pinche_album_short_video_transcode` 上传触发，避免本地已压缩 MP4 再产生云端转码费用；封面继续使用 URL 截帧。
    - 2026-07-08：曾创建 `pinche_album_short_video_transcode` workflow，输入 `uploads/session-album/videos/source/`，输出 `uploads/session-album/videos/display/${InputName}.${ext}`，使用系统 `H264-MP4-标清` 模版。
    - 2026-07-08：真实生产测试显示 source 上传成功、workflow 实例执行成功，但 API 记录仍停在 `processing`，用户确认云端不用再压缩，改为本地压缩直出。
    - 2026-07-08：`pinche_album_short_video_cover` workflow 已删除；封面保留后端生成短期签名 URL 截帧。
    - 2026-07-08：腾讯云控制台已暂停 `pinche_album_short_video_transcode` 的上传触发执行，开关显示灰色关闭态。
  - [x] 历史回调到达时记录 `ci_job_id`。
  - [x] 本地无 COS 时提供可测的 fallback，不引入本地 ffmpeg。

- [x] D32.5 实现数据万象回调或轮询更新。
  - 进度：2026-07-08 已新增 `POST /api/cos/ci/session-album-video-callback`，支持 JSON/XML 回调、token 校验、按 mediaId/source/jobId 幂等更新同一个媒体项；当前作为历史兼容能力保留，不再作为 D32 第一阶段主链路。
  - [x] 新增处理成功更新逻辑：写入 `display_url` 和视频元数据；历史 snapshot 回调可兼容写入 `cover_url`，但第一阶段不依赖。
  - [x] 新增处理失败更新逻辑：写入 `processing_status=failed` 和 `processing_error`。
  - [x] 重复回调必须幂等，不创建重复媒体项。
  - [x] 处理超时不影响相册照片列表。
  - [x] 删除视频时清理或登记清理 source、display、cover 对象。

- [x] D32.6 改造相册列表为媒体混排。
  - [x] 以现有相册服务和接口为主体增加 `media_type` 分支，不新建平行视频列表服务。
  - [x] `listSessionAlbum` 查询图片和视频媒体项，并按 `created_at DESC, id DESC` 排序。
  - [x] 返回图片项时补充 `media_type=image` 和 `processing_status=ready`。
  - [x] 返回视频项时包含 `cover_url`、`video_url`、时长和元数据。
  - [x] 第一阶段保留 `photos` 兼容字段，并可新增 `media` 字段。
  - [x] 复用现有相册标签和隐私过滤，确保管理员不绕过成员隐私。
  - [x] `processing` 和 `failed` 视频只对上传者和有上传权限管理员显示。
  - [x] 处理失败视频不计入普通成员可见数量。

- [x] D32.7 实现视频封面和播放签名接口。
  - [x] 封面使用短期签名 COS URL 截帧，不代理封面字节流。
  - [x] 新增 `GET /api/session-album/media/:id/video-url`。
  - [x] 接口校验登录、相册成员、媒体可见性、`media_type=video` 和 `processing_status=ready`。
  - [x] 返回 5-10 分钟有效的 COS 签名 URL。
  - [x] 确认 API 服务器不代理视频字节流。
  - [x] 签名 URL 过期后前端可重新请求。

- [x] D32.8 改造小程序管理员视频上传。
  - [x] 只给 `system_admin` 展示视频上传入口。
  - [x] 使用 `wx.chooseMedia` 单选视频。
  - [x] 超过 60 秒时提示先剪辑后上传，并停止流程。
  - [x] 60 秒以内视频调用 `wx.compressVideo`。
  - [x] 选择压缩后更小的文件上传，否则在限制内上传原文件。
  - [x] 上传前确认展示时长、预计大小和“按相册隐私展示”。
  - [x] 直传 COS source 对象。
  - [x] 创建视频媒体记录后直接显示 ready 视频卡片。

- [x] D32.9 改造小程序相册视频展示和播放。
  - [x] 在当前相册页内增加视频卡片、状态和播放，不新增独立视频相册页。
  - [x] 相册卡片按 `media_type` 渲染图片或视频。
  - [x] 视频 ready 卡片展示封面、播放图标和时长。
  - [x] 视频 processing 卡片展示“处理中”文字，不可播放。
  - [x] 视频 failed 卡片展示“处理失败”文字，只对上传者和有权限管理员可见。
  - [x] 点击 ready 视频时请求 `video-url` 并打开 `<video>` 播放。
  - [x] 不自动播放视频。
  - [x] 状态表达不能只依赖颜色或图标。
  - [x] `全部下载` 只下载照片。
  - [x] `多选下载` 只允许选择照片，视频不可选。

- [x] D32.10 改造管理员 Web 相册视频能力。
  - [x] 相册流显示视频卡片。
  - [x] ready 视频可播放。
  - [x] 视频可标注。
  - [x] 有权限视频可删除。
  - [x] 显示 processing 和 failed 状态。
  - [x] Web 上传视频暂不实现；如实现则使用更严格时长和大小限制。

- [x] D32.11 收紧朋友圈公开分享边界。
  - [x] 公开相册接口可返回视频封面和时长。
  - [x] 公开相册接口不返回视频播放 URL。
  - [x] 公开分享视频卡片展示“打开小程序查看视频”。
  - [x] 公开分享视频卡片不显示可播放但点不动的状态。
  - [ ] 后续公开视频播放另写 claim 级签名和成本保护规格。

- [x] D32.12 更新静态检查、烟测和构建验证。
  - 进度：2026-07-08 已追加 D32 后端 smoke，覆盖非管理员拒绝、管理员视频创建、本地 fallback、CI 转码回调即 ready、URL 截帧封面、签名播放 URL、公开视频不返回播放 URL。
  - [x] 更新 `scripts/check-miniprogram.js`，检查普通用户不展示视频上传入口。
  - [x] 检查小程序视频上传流程包含 `wx.chooseMedia`、`wx.compressVideo` 和 60 秒拦截。
  - [x] 检查下载流程只作用于 `media_type=image`。
  - [x] 新增后端烟测覆盖非管理员创建拒绝、管理员创建视频、回调可见性和签名 URL。
  - [x] 新增公开分享烟测，确认不返回视频播放 URL。
  - [x] 运行 `npm run check`。
  - [x] 运行 `npm run build:mp-weixin`。
  - [x] 记录无法自动验证的微信开发者工具手工场景。

## D32 验收

- [x] D32 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D32 design 已落地到 [design.md](./design.md)。
- [x] D32 tasks 已落地到本文件。
- [x] 只有 `system_admin` 可以上传视频。
- [x] 普通成员可以按相册权限查看 ready 视频，但不能上传。
- [x] 视频和照片在同一相册混排。
- [x] 视频管理能力是在现有相册页面和服务上扩展，不形成独立视频管理模块。
- [x] 视频复用现有相册标签和隐私规则。
- [x] 超过 60 秒视频不压缩、不上传、不创建 intent。
- [x] 小程序上传前使用 `wx.compressVideo`。
- [x] 视频源文件直传 COS source 前缀。
- [x] 本地压缩 MP4 直出播放，封面使用短期签名 URL 截帧。
- [x] API 只返回短期签名 URL，不代理视频字节流。
- [x] 视频不参与全部下载和多选下载。
- [x] 朋友圈公开只读不返回视频播放 URL。
- [x] 现有照片上传、展示、预览、标注、隐私和下载不回归。
- [x] `npm run check` 通过。
- [x] `npm run build:mp-weixin` 通过。

## 验证记录

- D32 spec 三件套已创建，后续实现时在本节补充红绿灯、烟测、构建和微信开发者工具验证记录。
- 2026-07-08：开始实现前新增 D32 红灯检查，先确认现有代码尚不具备短视频媒体模型、视频 intent、视频创建接口和小程序上传前压缩流程。
- 2026-07-08：`node scripts/d32-admin-album-video-check.js` 红灯失败于缺少 `0021_session_album_video.sql`，随后实现完成后通过。
- 2026-07-08：`npm run check` 通过。
- 2026-07-08：`npm run build:mp-weixin` 通过，存在 Sass legacy/import deprecation warning。
- 2026-07-08：`npm run build:admin-web` 通过。
- 2026-07-08：历史方案曾改为腾讯云 COS 数据工作流触发展示版 MP4 转码、封面 URL 截帧；后端保留 `POST /api/cos/ci/session-album-video-callback` 作为兼容回调。
- 2026-07-08：`env MYSQL_HOST=127.0.0.1 MYSQL_PORT=3307 MYSQL_DATABASE=pinche MYSQL_USER=pinche MYSQL_PASSWORD=pinche_dev_password npm run d32:smoke` 通过。
- 2026-07-08：`npm run check` 通过。
- 2026-07-08：`npm run build:mp-weixin` 通过，存在 Sass legacy/import deprecation warning。
- 2026-07-08：`npm run build:admin-web` 通过。
- 2026-07-08：微信开发者工具内真实 `wx.chooseMedia` / `wx.compressVideo` 交互仍需手工验证；当前自动验证覆盖源码检查和构建。
- 2026-07-08：腾讯云 COS 数据工作流曾收口为一个 workflow：`pinche_album_short_video_transcode` 负责 source -> display MP4；`pinche_album_short_video_cover` 已删除。最终路线确认云端不用再压缩，该 workflow 不再作为主链路。
- 2026-07-08：腾讯云 workflow 创建后复跑 `env MYSQL_HOST=127.0.0.1 MYSQL_PORT=3307 MYSQL_DATABASE=pinche MYSQL_USER=pinche MYSQL_PASSWORD=pinche_dev_password npm run d32:smoke` 通过；该历史验证覆盖本地 API、视频媒体创建、本地 fallback 和模拟数据万象转码/截帧回调。
- 2026-07-08：按最终低配置路线改为 URL 截帧封面；`env MYSQL_HOST=127.0.0.1 MYSQL_PORT=3307 MYSQL_DATABASE=pinche MYSQL_USER=pinche MYSQL_PASSWORD=pinche_dev_password npm run d32:smoke` 通过，覆盖转码回调即 ready、列表和公开分享返回 `ci-process=snapshot` 封面 URL。
- 2026-07-08：真实生产测试显示 source 上传成功、workflow 实例执行成功，但 API 记录仍停在 `processing`；随后按用户确认改为本地压缩直出、云端不转码，只保留 URL 截帧封面。
- 2026-07-08：按最终路线更新后复跑 `node --check apps/api/src/server.js`、`node --check apps/api/src/modules/core/service.js`、`node scripts/d32-admin-album-video-check.js` 和 `git diff --check` 通过。
- 2026-07-08：启动本地 API 后复跑 `BASE_URL=http://127.0.0.1:3032 MYSQL_HOST=127.0.0.1 MYSQL_PORT=3307 MYSQL_DATABASE=pinche MYSQL_USER=pinche MYSQL_PASSWORD=pinche_dev_password npm run d32:smoke` 通过，覆盖管理员创建视频后直接 ready、URL 截帧封面和签名播放 URL。
- 2026-07-08：`npm run build:mp-weixin` 通过，存在 Sass legacy/import deprecation warning；`npm run check` 单独复跑通过；`npm run build:admin-web` 通过。
- 2026-07-08：腾讯云控制台已暂停 `pinche_album_short_video_transcode` 的上传触发执行；后续 source MP4 上传不再自动触发云端转码，封面仍由短期签名 URL 截帧按需生成。
