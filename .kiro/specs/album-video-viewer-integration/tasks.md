# 相册视频预览整合任务

## 事实来源

需求：`.kiro/specs/album-video-viewer-integration/requirements.md`

设计：`.kiro/specs/album-video-viewer-integration/design.md`

## 任务

- [x] 1. Spec 和预检
  - [x] 1.1 播放 Product Design brief：视频整合进现有全屏相册 viewer。
  - [x] 1.2 检查现有 `.kiro/specs` 三件套格式。
  - [x] 1.3 检查当前 dirty working tree，保留无关改动。
  - [x] 1.4 阅读现有相册页和 `AlbumImageViewer` 的预览、视频播放、媒体缓存逻辑。

- [x] 2. 增加失败优先静态检查
  - [x] 2.1 禁止相册页继续保留独立视频播放弹层。
  - [x] 2.2 禁止 `previewPhoto` 对视频分叉调用 `openVideoPlayer`。
  - [x] 2.3 要求 `AlbumImageViewer` 支持视频 slide、`need-video` 事件和视频失败态。
  - [x] 2.4 要求 viewer 在切换或关闭时暂停视频。
  - [x] 2.5 运行 `node scripts/check-miniprogram.js`，确认新检查在当前实现上失败。
  - 说明：检查已按预期失败在独立视频弹层、视频分叉和 viewer 缺少 video slide 能力上。

- [x] 3. 改造 `AlbumImageViewer`
  - [x] 3.1 增加图片和视频 slide 的媒体类型分支。
  - [x] 3.2 视频 slide 先显示封面，拿到 `video_display_url` 后显示 `<video>`。
  - [x] 3.3 视频加载失败时显示轻量失败态。
  - [x] 3.4 切换 slide 时暂停上一个视频。
  - [x] 3.5 关闭 viewer 时暂停所有已渲染视频。
  - [x] 3.6 当前视频缺少播放地址时 emit `need-video`。

- [x] 4. 改造相册页
  - [x] 4.1 移除独立 `video-player-popup` 模板和相关状态。
  - [x] 4.2 删除 `openVideoPlayer`、全屏播放 helper 和独立弹层关闭逻辑。
  - [x] 4.3 `previewPhoto` 对图片和视频统一调用 `openPhotoPreview`。
  - [x] 4.4 `openPhotoPreview` 构建图片和视频混合的 `previewPhotos`。
  - [x] 4.5 增加视频播放地址请求、去重、错误写回和 `normalizeAlbumMediaUrl` 处理。
  - [x] 4.6 `ensurePreviewMediaAround` 仅预取视频封面，播放地址由当前激活 slide 触发。
  - [x] 4.7 `AlbumImageViewer` 仅为当前激活的视频 slide 挂载 `<video>` 节点。

- [x] 5. 验证
  - [x] 5.1 运行 `node scripts/check-miniprogram.js`。
  - [x] 5.2 运行 `git diff --check -- apps/miniprogram/src/pages/session/album.vue apps/miniprogram/src/components/AlbumImageViewer.vue scripts/check-miniprogram.js .kiro/specs/album-video-viewer-integration`。
  - [x] 5.3 运行 `npm -C apps/miniprogram run build:mp-weixin`。
  - [x] 5.4 启动小程序 dev 编译，并确认 `dist/dev/mp-weixin` 已包含当前 slide 才挂载视频的逻辑。
  - [x] 5.5 在微信开发者工具打开《坍缩的恋人》相册，点击视频确认进入混合 viewer。
  - [x] 5.6 在 viewer 中左右滑动确认可以从视频切到其他媒体。
  - [x] 5.7 更新本任务文件 checkbox 和验证说明。

- [x] 6. 修复视频播放 URL 的 HEAD 探测失败
  - [x] 6.1 用当前线上相册数据确认两个视频对象的 `GET Range` 均可从 COS 拉到 MP4 字节。
  - [x] 6.2 确认同一个 COS GET 签名直链在 `HEAD` 请求下返回 403，符合 DevTools `Failed to load media` 现象。
  - [x] 6.3 增加 D32 静态检查，要求播放 URL 使用后端 token route，且 `video-file` 支持 `HEAD`。
  - [x] 6.4 后端 `video-url` 改为返回 token URL。
  - [x] 6.5 后端 `video-file` 在 COS `HEAD` 和 `GET` 时分别重定向到按对应方法新签的 COS URL，避免使用可能不准的数据库 `video_byte_size` 回答 `HEAD`。
  - [x] 6.6 运行 `node scripts/d32-admin-album-video-check.js`。

## 验证说明

- 静态检查先按 TDD 红绿流程验证：新增检查在旧实现上失败，完成实现后通过。
- 微信开发者工具中，视频卡片进入的是同一个全屏相册 viewer，顶部计数和关闭/下载工具沿用相册 viewer。
- 当前激活的视频 slide 才请求播放地址和挂载 `<video>`，相邻视频只预取封面，避免打开 viewer 时提前触发非当前视频的播放失败。
- 线上当前旧后端返回的 COS GET 签名直链对 `HEAD` 返回 403；两个视频对象对 `GET Range` 返回 206 且 content-type 为 `video/mp4`，文件本身可拉取。
- media 578 的数据库 `video_byte_size` 为 37243，但 COS 对象实际约 38MB；因此 COS 场景下 `HEAD` 也必须跳到 COS 获取真实元信息，不能由 API 用数据库字段猜。
- 本次后端修复后，播放地址会先落到 API token URL，`HEAD` 和 `GET` 分别跳转到按对应方法签名的 COS URL。
