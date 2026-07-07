# TDesign 常规 UI 边界与相册单图预览需求

## 目标

继续保留 `tdesign-miniprogram` 作为小程序常规 UI 组件体系，避免把已经完成的按钮、弹窗、标签、筛选器、空状态和提示迁移回自研组件；同时把车局相册全屏预览收窄为单图稳定查看，删除全屏左右滑动切换上一张/下一张照片的能力。

本 spec 取代 `.kiro/specs/album-preview-viewer-redesign` 中关于“在 TDesign ImageViewer 内支持当前筛选集合多图左右滑动”的方向。旧 spec 中的后端直连媒体 URL、缩略图和预览图规格仍可作为媒体基础设施参考，但不再作为全屏多图滑动体验的验收目标。

## 功能需求

1. 小程序应继续使用 TDesign 承担常规 UI 组件职责，包括按钮、标签、徽标、空状态、提示条、分段筛选、表单输入、选择器、弹窗、对话框、toast 和 action-sheet。
2. TDesign 不应承担复杂业务状态机职责，尤其是不应通过 `t-image-viewer` 管理 200+ 张相册图片的快速左右滑动、缩略图到预览图渐进加载、COS 签名刷新或失败重试。
3. 相册瀑布流列表仍按当前筛选、角色筛选、隐私规则、上传者和标注规则展示可见照片。
4. 用户点击某一张相册照片时，仍应打开全屏预览。
5. 全屏预览只展示用户点击的当前照片，TDesign ImageViewer 的 `images` prop 必须只包含这一张照片。
6. 全屏预览计数允许显示 `1/1`，因为该模式明确是单图查看，不再表示当前筛选集合总数。
7. 全屏预览不得通过左右滑动切换当前筛选集合中的上一张或下一张照片。
8. 相册预览打开前不得批量下载当前筛选集合，也不得为了预览一次性加载整个相册。
9. 相册预览应优先使用已缓存的 `preview` 展示图；没有展示图时可以使用当前照片的缩略图或安全占位图，随后只为当前照片加载展示图。
10. 当前照片展示图规格保持为最长边 2048px、JPEG、quality 85、去除元数据；缩略图规格保持为最长边 640px、JPEG、quality 75。
11. 系统不得暴露上传原始大图；全屏预览使用处理后的展示图。
12. 多选下载、批量标注、单张下载、删除、上传、隐私设置、分享和相册筛选逻辑不得因为删除全屏滑动而改变。
13. 静态检查必须防止重新引入 TDesign ImageViewer 的多图筛选集合预览和滑动过程中的 `images` 动态回填。
14. 构建脚本仍应复制常规 TDesign 组件所需资源，但不应为了相册预览继续 patch TDesign ImageViewer 内部源码。

## 非目标

- 不完全移除 TDesign。
- 不把常规 UI 组件迁回自研组件或 uni 原生组件。
- 不重做相册瀑布流布局，不替换 `uv-waterfall`。
- 不实现自研全屏相册浏览器。
- 不支持全屏左右滑动浏览当前筛选集合。
- 不实现 thumbnail-first 的多图渐进式 viewer。
- 不改变相册权限、隐私、标注、上传、下载或分享 API。
- 不新增原始大图存储、原始大图下载或原始大图预览。

## 验收标准

1. `apps/miniprogram/src/pages/session/album.vue` 中 `t-image-viewer` 仍用于单图全屏预览。
2. 打开预览时，传给 `t-image-viewer` 的 `previewImageUrls` 只包含当前点击照片的一张图片。
3. 相册页不再绑定 `@change="handlePreviewImageViewerChange"` 来处理左右滑动切换。
4. 相册页不再包含 `previewContextPhotosForPhoto`、`uniquePreviewPhotos`、`prewarmPreviewUrls`、`hydratePreviewPhoto` 等为多图滑动预览服务的逻辑。
5. `scripts/check-miniprogram.js` 在相册页重新引入多图预览上下文或滑动时动态修改 `previewImageUrls` 时失败。
6. `node scripts/check-miniprogram.js` 执行成功。
7. `npm --workspace apps/miniprogram run build:mp-weixin` 执行成功。
8. 微信开发者工具中点击相册照片可以打开全屏查看，关闭后仍留在相册页。
9. 微信开发者工具中左右滑动全屏预览不应切换到其他照片，也不应出现多图快速滑动导致的黑屏、跳回或闪动。
10. 批量标注和多选下载模式下，底部浮动 toolbar 仍能出现并可操作。
