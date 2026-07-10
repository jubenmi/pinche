# 相册视频预览整合设计

## 产品简述

相册中的视频应被视为一种媒体项，而不是一个独立播放功能。用户点击视频后仍进入相册全屏预览，继续保留左右滑、计数、关闭和相册上下文。

## 组件边界

### `apps/miniprogram/src/pages/session/album.vue`

相册页继续负责权限、筛选、媒体 URL 规范化和接口请求：

- `previewPhoto(photo)` 只判断该媒体能否打开，随后统一调用 `openPhotoPreview(photo)`。
- `openPhotoPreview(photo)` 从 `filteredPhotos` 构建图片和视频混合的 `previewPhotos`。
- `viewerPhotoWithCachedMedia(photo)` 将列表缩略图、图片预览缓存、视频封面和视频播放地址整理成 viewer 可直接消费的字段。
- `ensurePreviewMediaAround(index)` 继续预热相邻图片；遇到视频时只预热封面，不预取播放地址。
- 新增或保留 `loadPreviewVideoUrl(photo)`，使用 `/api/session-album/media/:id/video-url` 获取签名播放地址，并写回 `previewPhotos`。

相册页不再维护 `videoPlayerVisible`、`videoPlayerUrl`、`videoPlayerTitle` 或独立视频弹层。

### `apps/miniprogram/src/components/AlbumImageViewer.vue`

viewer 负责混合媒体渲染和播放生命周期：

- 图片 slide 保持现有双层 image 逻辑。
- 视频 slide 在同一个 swiper item 中渲染：
  - 封面图：优先 `thumbnail_display_url`，其次 `cover_url`。
  - 播放器：当 `video_display_url` 存在时渲染 `<video>`。
  - 加载态：缺少 `video_display_url` 时显示“视频加载中”。
  - 失败态：`video_load_failed` 为 true 时显示“视频加载失败”。
- `handleSwiperChange` 在切换前暂停上一个视频，再更新索引并 emit `change`。
- `visible` 变为 false 时暂停所有已渲染视频。
- 如果当前 slide 是视频且缺少播放地址，viewer emit `need-video`，由相册页请求。

### `apps/api/src/server.js`

后端播放地址必须兼容小程序 video 的媒体探测：

- `/api/session-album/media/:id/video-url` 返回后端 token URL，而不是直接返回 COS GET 签名 URL。
- `HEAD /api/session-album/media/:id/video-file?token=...` 校验 token 和相册可见性后，在 COS 开启时重定向到按 `HEAD` 方法新签的 COS URL，由 COS 返回真实 `content-type`、`content-length` 和 `accept-ranges`。
- `GET /api/session-album/media/:id/video-file?token=...` 在 COS 开启时重定向到按 `GET` 方法新签的 COS URL，避免 API 服务器代理大视频字节。
- 本地存储模式继续由 API 服务器返回本地视频文件。

## 数据字段

viewer 使用以下字段：

```js
{
  id,
  media_type: "image" | "video",
  thumbnail_display_url,
  preview_display_url,
  cover_url,
  video_display_url,
  video_load_failed,
  duration_seconds
}
```

`video_display_url` 是可交给 `<video>` 的播放地址；它在 COS 场景中是后端 token URL，`GET` 时再重定向到 COS 签名直链。`video_url` 只作为接口路径来源或旧数据兼容，不直接交给 `<video>`。

## 交互流程

### 打开图片

1. 用户点击图片卡片。
2. 相册页构建混合 `previewPhotos`。
3. viewer 定位到对应 index。
4. 图片按现有 thumbnail-first 方式加载。

### 打开视频

1. 用户点击已就绪视频卡片。
2. 相册页构建混合 `previewPhotos`，定位到视频 index。
3. viewer 先显示视频封面。
4. 相册页请求 `/api/session-album/media/:id/video-url`。
5. 请求成功后写入 `video_display_url`，viewer 显示 `<video>`。
6. video 组件如先发 `HEAD` 探测，由后端 token URL 重定向到可通过的 COS `HEAD` 签名；正式 `GET` 播放再重定向到 COS `GET` 签名。
7. 用户可继续左右滑动到其他媒体。

### 切换和关闭

1. 用户滑动到下一项。
2. viewer 暂停上一个 slide 的视频。
3. viewer emit `change`，相册页预热相邻图片和视频封面；播放地址只由当前视频 slide 触发。
4. 关闭 viewer 时暂停所有视频并清空 `previewPhotos`。

## 错误处理

- 视频未就绪：沿用列表态文案，不打开 viewer。
- 视频地址获取失败：当前 slide 显示失败文案，不阻塞左右滑。
- 图片加载失败：保持现有图片 fallback。
- 下载视频：沿用当前“视频暂不支持下载”提示。

## 验证策略

先通过静态检查锁住架构约束，再用微信开发者工具验证实际行为：

- 静态检查禁止独立 `video-player-popup` 和 `openVideoPlayer` 回流。
- 静态检查要求 `AlbumImageViewer` 具备视频 slide、`need-video`、暂停视频和失败态。
- 静态检查要求后端播放 URL 支持 `HEAD`，并在 COS 场景中对 `GET` 重定向到新签的 COS URL。
- 构建通过后，在《坍缩的恋人》相册点击视频，确认进入混合 viewer，并能左右滑动。
