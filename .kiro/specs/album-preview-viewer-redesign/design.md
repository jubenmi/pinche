# 相册图片预览重设计方案

## 当前背景

相册页是 uni-app Vue 小程序页面，文件位于 `apps/miniprogram/src/pages/session/album.vue`。页面当前使用 `tdesign-miniprogram` 的 `t-image-viewer` 做全屏图片预览。

TDesign ImageViewer 在 `visible`、`initialIndex` 或 `images` 变化时，会重置内部已加载索引，并把内部 swiper current 设置回 `initialIndex`。这意味着插件天然期望一个稳定的图片 URL 数组，以及只在打开时使用的 `initialIndex`。近期的动态 URL hydration 方案在用户滑动时修改 `images` 和 `initialIndex`，正好破坏了这些假设。

后端当前把相册展示图保存为 `uploads/session-album/display/*.jpg` 下的处理后 JPEG。展示图规则是最长边 2048px、JPEG quality 85、去除元数据。缩略图变体基于展示图生成，规格为 640px、JPEG quality 75。系统不保存或提供上传原始大图。

## 架构

采用两阶段架构：

1. **TDesign 稳定基线**：继续使用 TDesign ImageViewer，但只给它稳定、可直接加载的 preview URL。这个阶段用于验证插件在正确使用条件下是否稳定。
2. **可选渐进式 viewer**：只有当 thumbnail-first 体验仍然必要时，再新增自研 `AlbumProgressiveImageViewer`，在每个 item 内部管理 thumbnail 和 preview 两层图片。

第一阶段必须先完成。若 TDesign 在直接加载 preview URL 的条件下稳定，则说明原问题来自我们破坏了插件输入条件，而不是 TDesign 的滑动逻辑本身。

## 后端媒体 URL 设计

为完整相册媒体新增可直接加载的短期 token URL。和当前依赖 Authorization header 的路径不同，这些 URL 必须能被微信 `<image>` 直接消费。

示例路由：

```http
GET /api/session-album/photos/:photoId/image?token=<media_token>&variant=preview
GET /api/session-album/photos/:photoId/image?token=<media_token>&variant=thumbnail
```

token 必须绑定：

- purpose：`session-album-media`
- `photoId`
- `sessionId`
- 当前 `userId`
- 允许的 variant 或 variant 集合
- 过期时间戳

相册列表接口在签发媒体 token 之前，必须完成和现有相册列表一致的可见性校验：

- 用户已登录
- 车局相册已开放
- 用户是有效相册成员
- 照片状态为 active
- 照片在隐私和标签规则下对该用户可见

媒体接口只校验 token 和 variant，不再要求 Authorization。无效、过期或不匹配的 token 返回 403。

迁移期间可以保留现有的认证媒体路径，用于下载或兼容旧逻辑。

## API 返回结构

完整相册接口返回的可见照片应包含：

```json
{
  "id": 123,
  "preview_url": "/api/session-album/photos/123/image?expires=...",
  "thumbnail_url": "/api/session-album/photos/123/image?expires=...&variant=thumbnail",
  "preview_load_url": "/api/session-album/photos/123/image?token=...&variant=preview",
  "thumbnail_load_url": "/api/session-album/photos/123/image?token=...&variant=thumbnail",
  "image_width": 1365,
  "image_height": 2048
}
```

`preview_load_url` 是 TDesign 基线中 ImageViewer 使用的标准 URL。`thumbnail_load_url` 保留给相册缩略图、预热逻辑或后续可选的渐进式 viewer。

## 小程序 TDesign 稳定基线

### 状态约定

相册页保留这些状态：

- `previewOverlayVisible`
- `previewPhotos`
- `previewImageUrls`
- `previewInitialIndex`
- `previewCurrentIndex`

但必须收窄语义：

- `previewImageUrls` 只在打开 viewer 时生成一次。
- `previewInitialIndex` 只在打开 viewer 时设置一次。
- `previewCurrentIndex` 可随滑动变化，但只用于预热或索引相关业务逻辑。
- viewer 打开期间，任何方法都不得修改 `previewImageUrls`。
- `handlePreviewImageViewerChange` 不得修改 `previewInitialIndex`。

### 打开流程

`openPhotoPreview(photo)`：

1. 通过 `previewContextPhotosForPhoto(photo)` 构建 `previewPhotos`。
2. 根据点击照片 id 找到 `currentIndex`。
3. 使用 `photo.preview_load_url` 构建 `previewImageUrls`。
4. 如果某张照片缺少 `preview_load_url`，使用非透明、可直接加载的 fallback 图片资源，确保 TDesign 拿到具体图片源。
5. 设置 `previewInitialIndex = currentIndex`。
6. 设置 `previewCurrentIndex = currentIndex`。
7. 设置 `previewOverlayVisible = true`。
8. 调用 `prewarmPreviewUrls(currentIndex)`。

### 滑动流程

`handlePreviewImageViewerChange(event)`：

1. 读取 `event.detail.index`。
2. 设置 `previewCurrentIndex`。
3. 调用 `prewarmPreviewUrls(nextIndex)`。
4. 不更新 `previewInitialIndex`。
5. 不更新 `previewImageUrls`。

### 预热流程

`prewarmPreviewUrls(index)`：

1. 选取 `index - 2` 到 `index + 2` 的照片。
2. 对每张照片的 `preview_load_url` 调用 `uni.getImageInfo` 或等价的隐藏图片预加载方式。
3. 预热状态单独保存，不进入 ImageViewer 的输入状态。
4. 预热失败不影响已经打开的 viewer；viewer 始终保留稳定 URL 数组。
5. 如果发现 token 过期，标记相册媒体 URL 已过期，并在关闭后或下一次打开前刷新；不要在当前 viewer 打开态替换 `images`。

## 可选渐进式 viewer

如果 TDesign 基线已经稳定，但产品体验仍要求先显示缩略图，则新增自研组件，例如 `apps/miniprogram/src/components/AlbumProgressiveImageViewer.vue`。

组件使用原生 `swiper`，接收稳定的 `photos` 数组，而不是 `images` 字符串数组：

```js
{
  visible: Boolean,
  photos: Array<{
    id,
    thumbnail_load_url,
    preview_load_url,
    image_width,
    image_height
  }>,
  initialIndex: Number
}
```

每个可见 item 渲染两层图片：

1. thumbnail 层先加载，用于避免黑页。
2. preview 层并行加载，成功后淡入覆盖 thumbnail。
3. preview 失败时保留 thumbnail，并显示轻量失败提示。
4. thumbnail 失败时显示非透明 fallback 状态。

组件应只渲染 current 前后两张的窗口范围。这样可以限制 DOM 数量，不依赖 TDesign 的 lazy 行为。

## 风险控制

- 保持 TDesign ImageViewer 无内部 patch。
- viewer 打开期间保持 `previewImageUrls` 稳定。
- `initialIndex` 只在打开时使用。
- 实施前先增加静态检查，防止回退到动态修改 `images` 的方案。
- 必须在微信开发者工具中验证插件稳定性，再决定是否实现可选的自研渐进式 viewer。

