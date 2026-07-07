# TDesign 常规 UI 边界与相册单图预览设计

## 背景

小程序当前是 uni-app Vue 项目，目标平台是微信小程序 `mp-weixin`。项目已经集成 `tdesign-miniprogram`，并在页面中使用 `t-button`、`t-tag`、`t-popup`、`t-picker`、`t-empty`、`t-segmented`、`t-notice-bar`、`t-toast`、`t-dialog`、`t-image` 和 `t-image-viewer` 等组件。

近期相册全屏预览尝试过让 TDesign ImageViewer 承担当前筛选集合的多图左右滑动：打开时传入 263 张图片，滑动时预热前后图片，并尝试用缩略图、展示图和本地缓存动态替换 `images`。这个方向在快速滑动时仍出现黑屏、闪动、加载不到图片或内部状态跳动。

新的产品决策是：TDesign 继续作为常规 UI 组件体系，但不再让 TDesign ImageViewer 承担复杂相册浏览器职责。相册全屏预览先退回单图稳定查看。

## 架构边界

### TDesign 保留范围

TDesign 适合承担低业务状态密度的 UI 外壳：

- 按钮、禁用态、loading 态和基础点击反馈。
- 标签、徽标、空状态、骨架屏和提示条。
- 分段筛选、搜索、表单输入、开关、选择器和日期选择器。
- 弹窗、对话框、toast、action-sheet 和 popup。
- 普通图片展示和单图全屏查看。

这些组件的价值是统一视觉、减少重复样式、复用小程序端交互细节，并把常规控件的维护集中到一个组件体系。

### TDesign 不承担范围

TDesign 不应承担以下业务加载器职责：

- 263 张图片快速左右滑动。
- 当前筛选集合的预览索引状态机。
- 缩略图先占位、展示图后覆盖的多图渐进加载。
- COS 签名 URL 过期刷新。
- 图片下载到本地缓存后动态替换 viewer 输入数组。
- 快速滑动时的失败重试、窗口化渲染和预加载调度。

这些能力如果未来仍然需要，应通过单独的自研相册浏览器设计，而不是继续扩展 TDesign ImageViewer 的 `images` prop。

## 相册单图预览设计

### 数据状态

相册页保留最小预览状态：

- `previewOverlayVisible`：是否显示全屏预览。
- `previewPhotos`：当前预览照片数组，只保存当前点击照片，长度为 0 或 1。
- `previewImageUrls`：传给 TDesign ImageViewer 的图片数组，只保存当前点击照片的一个 URL。
- `previewInitialIndex`：固定为 0。
- `previewHydrationToken`：用于取消过期的当前照片异步加载结果。
- `previewPlaceholderImageUrl`：当前照片没有可用图片时的安全占位。

删除或停用多图滑动状态：

- `previewCurrentIndex`
- `previewPreloadRadius`
- `handlePreviewImageViewerChange`
- `previewContextPhotosForPhoto`
- `uniquePreviewPhotos`
- `samePhotoId` 中仅为多图预览服务的调用
- `prewarmPreviewUrls`
- `hydratePreviewPhoto`
- `replacePreviewImageUrlAtIndex`

如果 `samePhotoId` 仍被其他业务使用，可以保留；否则随多图预览清理。

### 打开流程

`previewPhoto(photo)` 仍作为照片点击入口。

`openPhotoPreview(photo)` 的职责收窄为：

1. 如果正在删除照片，直接返回。
2. 增加 `previewHydrationToken`，让旧的异步加载结果失效。
3. 将 `previewPhotos` 设置为 `[photo]`。
4. 将 `previewInitialIndex` 设置为 `0`。
5. 通过 `stableSinglePreviewImageUrl(photo)` 生成当前图片 URL。
6. 将 `previewImageUrls` 设置为 `[url]`。
7. 设置 `previewOverlayVisible = true`。
8. 如果当前只有缩略图或占位图，则异步加载当前照片的 `preview` 展示图；加载成功后只替换 `previewImageUrls[0]`。

这里允许替换 `previewImageUrls[0]`，因为数组长度始终为 1，不存在多图 swiper 的索引重置和跨图片跳动问题。

### 图片 URL 选择

当前照片全屏预览按以下顺序选择初始图片：

1. `visiblePhotoMedia[photo.id].preview`
2. `photo.display_url`
3. `visiblePhotoMedia[photo.id].thumbnail`
4. `apiUrl(photo.thumbnail_load_url)`
5. `previewPlaceholderImageUrl`

异步展示图加载按现有 `loadVisiblePhotoMedia(photo, "preview")` 完成。加载成功后更新当前照片的 `display_url`，并在预览仍打开、token 仍匹配、当前预览仍是同一照片时，把 `previewImageUrls` 改成 `[previewUrl]`。

不得把旧的 Authorization-only `preview_url` 或 `image_url` 直接传给 `<image>` 或 ImageViewer。直接展示应使用本地缓存路径或后端提供的可直接加载 URL。

### 关闭流程

`closePhotoPreview()`：

1. 设置 `previewOverlayVisible = false`。
2. 清空 `previewPhotos` 和 `previewImageUrls`。
3. 重置 `previewInitialIndex = 0`。
4. 增加 `previewHydrationToken`。
5. 不触发整页相册刷新。

关闭预览后，相册筛选、瀑布流、批量标注、多选下载和底部 toolbar 状态保持原样。

## 静态检查设计

`scripts/check-miniprogram.js` 需要从旧的“多图 TDesign 稳定基线”约束改成“单图预览边界”约束：

- 要求相册页仍注册并使用 `t-image-viewer`。
- 要求相册页包含 `previewImageUrls: []`、`previewInitialIndex: 0`、`previewOverlayVisible`。
- 要求 `openPhotoPreview` 中出现 `this.previewPhotos = [photo]` 或等价单图赋值。
- 要求 `openPhotoPreview` 中出现 `this.previewImageUrls = [ ... ]` 或等价单图数组赋值。
- 禁止 `@change="handlePreviewImageViewerChange"`。
- 禁止 `previewContextPhotosForPhoto`。
- 禁止 `prewarmPreviewUrls`。
- 禁止 `hydratePreviewPhoto`。
- 禁止 `previewPreloadRadius`。
- 禁止滑动 handler 修改或预热多图。
- 禁止重新引入 `syncPreviewImageUrlAtIndex`、`syncPreviewImageUrlsForWindow`、`preparePhotoPreviewUrls` 等旧动态回填路径。

检查脚本仍保留 TDesign 常规组件注册、复制、构建输出和本地 wxcomponents 兼容性检查。

## 构建设计

继续保留 `apps/miniprogram/src/pages.json` 中已批准的 TDesign 组件注册，以及 `apps/miniprogram/vite.config.js` 中复制 TDesign 组件资源的逻辑。

但构建逻辑不应为了相册多图预览继续 patch TDesign ImageViewer 内部源码。已经为了兼容小程序事件或已验证的轻量行为补丁，需要在检查脚本中显式记录边界，避免后续把复杂业务加载逻辑写进 vendored TDesign 组件。

## 风险与取舍

### 收益

- 立即消除全屏多图快速滑动导致的黑屏、跳动、闪动和永久加载失败路径。
- 保留 TDesign 作为常规 UI 体系，避免大规模 UI 回滚。
- 相册点击查看仍可用，用户不会失去全屏查看能力。
- 后续若要重新做高速相册浏览器，可以独立设计，不再和 TDesign ImageViewer 的输入假设冲突。

### 成本

- 全屏状态下不能左右滑到当前筛选集合的上一张或下一张。
- 计数会回到 `1/1`，但这是明确的单图查看语义，不再是 bug。
- 如果用户希望浏览多张，需要关闭当前图后在瀑布流中点另一张。

## 验证策略

1. 先更新静态检查，让旧的多图滑动预览实现失败。
2. 修改相册页为单图预览。
3. 运行 `node scripts/check-miniprogram.js`。
4. 运行 `npm --workspace apps/miniprogram run build:mp-weixin`。
5. 在微信开发者工具中验证：
   - 点击照片可全屏打开。
   - 预览显示 `1/1`。
   - 左右滑动不会切换到其他图片。
   - 快速左右滑不会黑屏、闪动或跳回。
   - 关闭后仍在相册页。
   - 多选下载和批量标注底部 toolbar 正常显示。
