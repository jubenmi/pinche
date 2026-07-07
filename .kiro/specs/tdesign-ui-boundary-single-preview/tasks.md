# TDesign 常规 UI 边界与相册单图预览任务

## 事实来源

需求：`.kiro/specs/tdesign-ui-boundary-single-preview/requirements.md`

设计：`.kiro/specs/tdesign-ui-boundary-single-preview/design.md`

被取代的旧方向：`.kiro/specs/album-preview-viewer-redesign`

## 任务

- [x] 1. Spec 和预检
  - [x] 1.1 阅读本 spec 的 `requirements.md` 和 `design.md`。
  - [x] 1.2 检查当前 dirty working tree，确认只修改本任务相关文件，不回滚用户或其他任务改动。
  - [x] 1.3 对照旧 `.kiro/specs/album-preview-viewer-redesign`，确认本任务不再实现全屏多图左右滑动。
  - [x] 1.4 确认 TDesign 常规 UI 组件继续保留，不启动完全移除 TDesign 的迁移。

- [x] 2. 更新静态检查为单图预览边界
  - [x] 2.1 修改 `scripts/check-miniprogram.js`，删除旧的“相册预览必须使用当前筛选集合多图数据”的检查。
  - [x] 2.2 增加检查：相册页不得绑定 `@change="handlePreviewImageViewerChange"`。
  - [x] 2.3 增加检查：相册页不得包含 `previewContextPhotosForPhoto`、`prewarmPreviewUrls`、`hydratePreviewPhoto`、`previewPreloadRadius`。
  - [x] 2.4 增加检查：相册页不得重新引入 `syncPreviewImageUrlAtIndex`、`syncPreviewImageUrlsForWindow`、`preparePhotoPreviewUrls`。
  - [x] 2.5 增加检查：`openPhotoPreview` 必须把预览照片收窄为当前点击照片的一张。
  - [x] 2.6 运行 `node scripts/check-miniprogram.js`，确认当前多图滑动实现会失败。

- [x] 3. 将相册全屏预览改为单图模式
  - [x] 3.1 修改 `apps/miniprogram/src/pages/session/album.vue`，移除 `t-image-viewer` 上的 `@change="handlePreviewImageViewerChange"`。
  - [x] 3.2 删除或停用 `previewCurrentIndex`、`previewPreloadRadius` 等多图滑动状态。
  - [x] 3.3 修改 `openPhotoPreview(photo)`，使 `previewPhotos` 只包含 `[photo]`。
  - [x] 3.4 修改 `openPhotoPreview(photo)`，使 `previewInitialIndex` 固定为 `0`。
  - [x] 3.5 修改 `openPhotoPreview(photo)`，使 `previewImageUrls` 只包含当前照片的一个初始 URL。
  - [x] 3.6 保留当前照片展示图异步加载；加载成功后只替换 `previewImageUrls[0]`。
  - [x] 3.7 删除 `previewContextPhotosForPhoto`、`uniquePreviewPhotos`、`prewarmPreviewUrls`、`hydratePreviewPhoto` 和 `handlePreviewImageViewerChange`。
  - [x] 3.8 保留 `closePhotoPreview()` 清理预览状态，且不触发整页相册刷新。

- [x] 4. 保留 TDesign 常规 UI 边界
  - [x] 4.1 确认 `apps/miniprogram/src/pages.json` 仍注册已批准的 TDesign 常规组件。
  - [x] 4.2 确认 `apps/miniprogram/vite.config.js` 仍复制 TDesign 常规组件和运行时依赖。
  - [x] 4.3 确认本任务没有把按钮、标签、筛选器、空状态、弹窗、toast 等常规 UI 迁回自研组件。
  - [x] 4.4 确认本任务没有新增 TDesign ImageViewer 内部业务 patch。

- [x] 5. 验证小程序静态检查和构建
  - [x] 5.1 运行 `node scripts/check-miniprogram.js`，确认通过。
  - [x] 5.2 运行 `npm --workspace apps/miniprogram run build:mp-weixin`，确认通过。
  - [x] 5.3 如构建输出里已有 `pages/session/album.wxml`，确认 `t-image-viewer` 仍接收原生 `images` 和 `visible` 绑定，不退化成 `u-p` 组件。

- [ ] 6. 在微信开发者工具中验证
  - 进度：已用微信开发者工具打开 `apps/miniprogram/dist/build/mp-weixin`，当前可进入相册页；DevTools 的模拟器拖拽未能滚动到隐藏在列表下方的 `[冯厚敦·流芳] 相册` 卡片，因此有图相册的手动预览交互验证未完成。
  - 补充验证：通过当前 DevTools 登录态请求远端接口，确认 `流芳` session id 为 `29`，相册返回 263 张照片；当前线上接口仍是旧字段，263 张均有 `preview_url` 和 `thumbnail_url`，但暂无 `preview_load_url` / `thumbnail_load_url`；抽样 `thumbnail_url` 与 `preview_url` 带鉴权下载均返回 `200 image/jpeg`。
  - [x] 6.1 重新编译或打开 `apps/miniprogram/dist/build/mp-weixin`。
  - [ ] 6.2 进入 `[冯厚敦·流芳] 相册` 或其他有照片的相册。
  - [ ] 6.3 点击任意照片，确认全屏预览打开。
  - [ ] 6.4 确认全屏预览显示单图语义 `1/1`。
  - [ ] 6.5 快速左右滑动全屏预览，确认不会切换到其他照片。
  - [ ] 6.6 快速左右滑动全屏预览，确认没有黑屏、闪动、跳回或永久加载失败。
  - [ ] 6.7 关闭预览，确认仍停留在相册页。
  - [ ] 6.8 打开“多选下载”，确认底部浮动 toolbar 出现。
  - [ ] 6.9 打开“批量标注”，确认底部浮动 toolbar 出现。

- [x] 7. 收尾
  - [x] 7.1 更新本 `tasks.md` 的完成状态。
  - [x] 7.2 在最终说明中明确：TDesign 保留为常规 UI；相册全屏预览已退回单图；全屏左右滑动多图浏览不再支持。
  - [x] 7.3 如后续重新需要 263 张高速浏览，另开新 spec 设计自研相册浏览器，不复用本 spec 范围。
