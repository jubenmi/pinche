# 相册图片预览稳定化重设计

## 背景

小程序相册全屏预览当前使用 TDesign ImageViewer。用户在快速左右滑动照片时，偶尔会看到黑屏、无法继续载入、来回闪动或跳回某一张。近期尝试过在滑动时动态下载并回填 `images[index]`，可以缓解部分黑屏，但仍然容易触发插件内部重置。

这份 spec 的目标是从第一性原理重新设计预览链路：先确认 TDesign ImageViewer 在正确使用条件下不会出现该类 bug，再决定是否引入自研渐进式预览器来支持 `thumbnail -> preview` 的视觉体验。

## 第一性条件

### TDesign ImageViewer 的输入条件

TDesign ImageViewer 更适合消费稳定的最终图片数组：

1. `images` 应该是稳定数组，数组内每项应是微信 `<image>` 可直接加载的 URL 或本地文件路径。
2. `initialIndex` 只用于打开时定位，不应用于滑动过程中的 live current。
3. `visible`、`initialIndex`、`images` 任一变化都会触发组件 observer，清空 `loadedImageIndexes` 并把内部 swiper current 设置为 `initialIndex`。
4. `lazy=true` 时，插件只渲染当前图片、前后一张、以及已加载成功过的图片。
5. 插件没有 per-item slot，不能表达“这一页先显示缩略图，稍后覆盖展示图”的两层状态。

因此，滑动期间频繁修改 `images` 或 `initialIndex` 会破坏插件假设，导致跳动、黑屏或加载状态丢失。

### 相册媒体条件

相册实际存在两种展示媒体：

1. `thumbnail`：缩略图，服务端通过 `imageMogr2/auto-orient/thumbnail/640x640>/format/jpg/quality/75/strip` 生成。
2. `preview`：全屏展示图，上传时处理为最长边 2048、jpg、quality 85、strip 后保存到 `uploads/session-album/display/*.jpg`。

当前没有保存或暴露上传原始大图。所谓“原始大图”在本系统内实际是 `preview` 展示图。

完整相册的媒体接口当前还依赖登录态 Authorization。微信 `<image>` 无法带 Authorization header，所以前端曾用 `uni.request` 下载图片到本地缓存，再把本地路径交给 ImageViewer。这个“异步下载后替换路径”的模式正是和 TDesign `images` 稳定假设冲突的根源。

## 目标

1. 先做一个严格遵守 TDesign 使用条件的版本，验证插件在稳定输入下不会出现快速滑动黑屏、无法载入、跳动。
2. 全屏预览顺序必须来自当前筛选后的照片集合，左右滑动只在这个集合里切换。
3. 不加载全相册本地文件，不在打开预览前阻塞等待全部图片下载。
4. 不 patch TDesign ImageViewer 内部源码。
5. 不在滑动过程中修改 TDesign 的 `initialIndex`。
6. 不在滑动过程中把 TDesign 的 `images` 当作媒体状态机反复修改。
7. 如果后续需要“先 thumbnail 占位，再 preview 覆盖”，使用自研轻量预览器实现，而不是继续强塞到 TDesign `images`。

## 非目标

1. 不恢复或新增上传原始大图保存。
2. 不把一次预览打开变成全量下载 200+ 张照片。
3. 不改变相册隐私、筛选、标注、下载、多选逻辑。
4. 不改变 `thumbnail` 和 `preview` 的图像处理规格。
5. 不在朋友圈公开相册里扩大完整相册权限。

## 方案比较

### 方案 A：严格标准使用 TDesign，推荐先做

后端为完整相册返回微信 `<image>` 可直接加载的短期签名媒体 URL。权限在签发 URL 时校验，图片 GET 请求本身不再要求 Authorization header。

前端打开 ImageViewer 时：

1. 构建稳定的 `previewPhotos`。
2. 构建稳定的 `previewImageUrls = previewPhotos.map(photo => photo.preview_load_url)`。
3. `initialIndex` 只设置为点击照片的 index。
4. `handleChange` 只更新 `previewCurrentIndex` 并预热 current 前后两张 URL。
5. 不动态替换 `images[index]`。
6. 不修改 `initialIndex`。

优点：最大程度满足插件原始条件，能验证插件本身是否稳定。  
缺点：无法在插件内部实现 thumbnail 到 preview 的渐进覆盖；如果网络慢，当前页会显示插件 loading，而不是缩略图占位。

### 方案 B：自研渐进式预览器，作为第二阶段

使用小程序原生 `swiper` 做一个 `AlbumProgressiveImageViewer`。每个 item 自己管理两层图片：

1. 底层 `thumbnail`，优先显示 640 缩略图。
2. 顶层 `preview`，2048 展示图加载成功后淡入覆盖。
3. DOM 只保留 current 前后两张，最多 5 个 item。
4. 当前 index 由页面状态控制，不使用 TDesign 的 `initialIndex/images` observer。
5. 快速滑动时，即使 preview 未完成，也能显示 thumbnail，不出现纯黑空页。

优点：完全满足“先小图占位，再快速切换到 2048 展示图”。  
缺点：需要自维护关闭、索引、滑动、图片 fit、失败态和性能细节，不能再把这些交给 TDesign。

### 方案 C：继续动态回填 TDesign images，不推荐

保持 TDesign，但在 `thumbnail` 或 `preview` 下载完成后修改 `images[index]`。

优点：代码改动看似小。  
缺点：每次修改 `images` 都可能触发 TDesign observer 重置 `loadedImageIndexes/currentSwiperIndex`，快速滑动时仍可能跳动或闪黑。这是当前问题的结构性来源。

## 推荐路线

先实施方案 A，建立稳定基线。只有当方案 A 在快速滑动验证中稳定后，再决定是否做方案 B。

这条路线的判断标准是：

1. 如果方案 A 快速滑动稳定，则说明 TDesign 插件本身没有该 bug，之前的问题来自我们破坏了插件输入条件。
2. 如果用户仍强烈需要 thumbnail 占位体验，再做方案 B，而不是继续修改 TDesign 的 `images`。
3. 如果方案 A 在稳定 URL 输入下仍复现跳动，再回到插件层定位，才考虑替换插件。

## 后端设计

### 完整相册媒体可加载 URL

新增或调整完整相册媒体 URL，让小程序 `<image>` 可以直接加载：

```http
GET /api/session-album/photos/:photoId/image?token=<media_token>&variant=preview
GET /api/session-album/photos/:photoId/image?token=<media_token>&variant=thumbnail
```

`media_token` 由后端在相册列表接口返回前签发。签发时必须完成当前用户权限校验：

1. 用户已登录。
2. 用户是该车相册成员。
3. 照片对该用户可见，包含现有隐私和标签规则。
4. token 绑定 photoId、sessionId、userId、variant 或允许的 variant、exp。
5. token 有短有效期，例如 10 分钟。

图片 GET 请求只验证 token，不再读取 Authorization header。这样 URL 才能被 `<image>`、TDesign ImageViewer 和小程序图片缓存直接消费。

### 返回字段

相册照片对象保留现有字段，并新增直接加载字段：

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

`preview_url` 和 `thumbnail_url` 可以继续服务现有下载路径；`preview_load_url` 和 `thumbnail_load_url` 专门用于 `<image>` 直接加载。

## 小程序设计：TDesign 稳定基线

### 状态

相册页保留：

- `previewOverlayVisible`
- `previewPhotos`
- `previewImageUrls`
- `previewInitialIndex`
- `previewCurrentIndex`

但重设语义：

1. `previewImageUrls` 只在打开预览时生成一次。
2. `previewInitialIndex` 只在打开预览时设置一次。
3. `previewCurrentIndex` 是 live state，只用于预热和索引逻辑，不绑定到 `initial-index`。
4. 打开期间不再执行 `syncPreviewImageUrlAtIndex` 这类动态回填。

### 打开预览

`openPhotoPreview(photo)`：

1. `previewPhotos = previewContextPhotosForPhoto(photo)`。
2. `currentIndex = clicked photo index`。
3. `previewImageUrls = previewPhotos.map(photo => photo.preview_load_url)`。
4. 如果某张缺少 `preview_load_url`，使用可直接加载的错误占位图，而不是透明 data URL。
5. `previewInitialIndex = currentIndex`。
6. `previewCurrentIndex = currentIndex`。
7. `previewOverlayVisible = true`。
8. 触发 `prewarmPreviewUrls(currentIndex)`。

### 滑动

`handlePreviewImageViewerChange(event)`：

1. 读取 `event.detail.index`。
2. 只更新 `previewCurrentIndex`。
3. 触发 `prewarmPreviewUrls(index)`。
4. 不修改 `previewImageUrls`。
5. 不修改 `previewInitialIndex`。

### 预热

`prewarmPreviewUrls(index)`：

1. 取 `index - 2` 到 `index + 2` 的照片。
2. 对这些照片的 `preview_load_url` 调用 `uni.getImageInfo` 或渲染隐藏 `<image>` 进行图片缓存预热。
3. 预热失败只记录状态，不影响 ImageViewer 的 `images` 数组。
4. 如果 token 过期导致 401/403，后台刷新相册媒体 URL 后仅在下一次打开预览时使用新数组；不在当前 ImageViewer 打开态动态替换整组 `images`。

### 失败态

1. 某张 preview 加载失败时，TDesign item 显示错误态或统一占位，不触发 swiper 重置。
2. 用户可以继续左右滑动。
3. 关闭再打开时会重新获取最新媒体 URL。

## 小程序设计：后续渐进式预览器

如果方案 A 稳定，但还需要 thumbnail 占位体验，则新增自研组件 `AlbumProgressiveImageViewer`。

### 组件输入

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

`photos` 在打开期间保持顺序稳定，但每个 item 内部可管理自己的 thumbnail 和 preview 加载状态。

### item 渲染

每个 swiper item：

1. 先显示 thumbnail。
2. preview `<image>` 同时加载。
3. preview load 成功后淡入，thumbnail 保留或隐藏。
4. preview 失败时保留 thumbnail，并展示轻量失败提示。
5. thumbnail 也失败时显示非透明占位和重试入口。

### 窗口化

为了避免加载全相册，组件只创建 current 前后两张，共最多 5 个 item。索引到真实照片数组的映射由组件内部完成。

## 迁移步骤

1. 后端新增 `preview_load_url` 和 `thumbnail_load_url`，保证 `<image>` 可直接加载。
2. 小程序相册页切回 TDesign 稳定基线：删除滑动过程中的 `images` 动态回填和 `initialIndex` 更新。
3. 检查脚本增加约束：禁止 `handlePreviewImageViewerChange` 修改 `previewImageUrls` 或 `previewInitialIndex`。
4. 在 DevTools 中快速滑动 20 张以上，验证 TDesign 稳定基线。
5. 如果体验可接受，停止在此阶段。
6. 如果仍需要 thumbnail 到 preview 的渐进效果，再开发 `AlbumProgressiveImageViewer` 并替换 TDesign 全屏预览。

## 测试与验收

### 后端

1. 登录成员请求相册列表时，每张可见照片返回 `preview_load_url` 和 `thumbnail_load_url`。
2. 非成员不能获得完整相册媒体 token。
3. token 只能访问绑定的照片和允许的 variant。
4. 过期 token 返回 403。
5. `thumbnail` 输出仍为 640、jpg、quality 75。
6. `preview` 输出仍为最长边 2048、jpg、quality 85。

### 小程序 TDesign 基线

1. 打开预览时，计数显示当前筛选集合总数，不出现 `1/1`。
2. 快速左右滑动 20 次，不跳回打开时照片。
3. 滑动过程中不修改 `previewImageUrls`。
4. 滑动过程中不修改 `previewInitialIndex`。
5. 后台预热失败不影响当前 swiper index。
6. 关闭再打开能重新获取最新可加载 URL。

### 渐进式预览器

仅当进入方案 B 时验收：

1. preview 未完成时显示 thumbnail，不出现纯黑页。
2. preview 完成后在同一 item 内覆盖 thumbnail，不重置 swiper。
3. 快速滑动时 DOM item 数量保持在 current 前后两张范围内。
4. preview 失败时仍可继续左右滑动。

## 自检

- 本 spec 先验证正确使用 TDesign 的稳定输入条件，没有直接假定插件有 bug。
- 本 spec 没有要求加载全相册本地文件。
- 本 spec 保留 thumbnail 和 preview 的现有图像规格。
- 本 spec 明确把 thumbnail 到 preview 的渐进体验放到自研组件，而不是继续用 TDesign `images` 做动态状态机。
- 本 spec 没有扩大相册访问权限；直接加载 URL 通过短期 token 和签发时权限校验控制。
