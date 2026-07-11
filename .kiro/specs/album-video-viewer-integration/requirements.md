# 相册视频预览整合需求

## 目标

将车局相册里的短视频整合进现有全屏相册预览体验，使用户点击视频后仍处在相册 viewer 中，可以像图片一样左右滑动、查看计数并关闭返回相册列表。视频不再使用独立的 `t-popup` 播放弹层。

## 功能需求

1. 相册预览必须同时包含当前筛选集合中的图片和已就绪视频，顺序必须和瀑布流可见顺序一致。
2. 点击图片或已就绪视频时，必须打开同一个 `AlbumImageViewer`。
3. 点击待处理或失败视频时，不打开 viewer，并继续显示现有状态提示。
4. viewer 计数必须按图片和视频的混合集合计算，例如 `2/3`，不能只统计图片。
5. 图片 slide 必须保持现有 thumbnail-first、preview 覆盖、失败占位和下载行为。
6. 视频 slide 必须在 viewer 中渲染 `<video>`，使用全屏 viewer 容器承载播放，而不是调用独立播放弹层。
7. 视频 slide 必须先显示封面或缩略图，播放地址加载完成后再显示视频播放器。
8. 视频播放地址必须通过现有相对接口 `/api/session-album/media/:id/video-url` 获取，不能直接请求可能已被规范化成绝对地址的 `photo.video_url`。
9. 视频签名地址必须经 `normalizeAlbumMediaUrl` 处理，避免 `https//` 或双前缀 URL。
10. 当用户左右滑离开视频 slide 或关闭 viewer 时，当前视频必须暂停或卸载，避免后台继续播放。
11. viewer 中的视频播放地址获取失败时，必须显示轻量失败状态，并允许用户继续左右滑动或关闭。
12. `/api/session-album/media/:id/video-url` 返回的播放地址必须支持小程序 video 播放前的 `HEAD` 探测；COS 场景不能把只支持 `GET` 的签名直链直接交给 `<video>`，且 `HEAD` 必须能拿到 COS 真实媒体元信息。
13. 视频下载不在本轮范围内；现有下载入口遇到视频仍可提示暂不支持。

## 非目标

- 不新增保存视频到系统相册。
- 不修改视频上传、压缩、100MB 上限或 20MB 压缩阈值。
- 不修改后端视频上传和转码逻辑。
- 不把 COS 视频字节长期代理经过 API 服务器；后端只负责 token 校验、`HEAD` 响应和 `GET` 重定向。
- 不重设计相册列表、筛选、隐私、批量标注或下载流程。
- 不引入新的视觉语言或替换现有 `AlbumImageViewer` 的整体结构。
- 不使用微信原生系统全屏播放器作为主体验，因为它会脱离相册左右滑上下文。

## 验收标准

1. `scripts/check-miniprogram.js` 在视频仍调用 `openVideoPlayer` 或存在独立 `video-player-popup` 时失败。
2. `scripts/check-miniprogram.js` 要求 `AlbumImageViewer` 支持视频 slide、视频加载失败态和切换时暂停视频。
3. 点击《坍缩的恋人》相册中已就绪视频后，打开的是全屏相册 viewer，而不是独立弹层。
4. 在 viewer 中可以从视频左右滑到相邻图片或视频。
5. viewer 计数包含图片和视频，和当前筛选集合一致。
6. 视频 slide 能显示封面，播放地址获取完成后能播放视频；播放地址对 `HEAD` 返回成功，对 `GET` 可取得 COS 视频内容。
7. 离开视频 slide 或关闭 viewer 后，视频不继续播放。
8. `node scripts/check-miniprogram.js` 执行成功。
9. `npm -C apps/miniprogram run build:mp-weixin` 执行成功。
10. 微信开发者工具中完成一次视频打开和左右滑动验证。
11. `node scripts/d32-admin-album-video-check.js` 执行成功。
