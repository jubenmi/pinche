# 相册图片预览重设计任务

## 事实来源

需求：`.kiro/specs/album-preview-viewer-redesign/requirements.md`

设计：`.kiro/specs/album-preview-viewer-redesign/design.md`

相关设计说明：`docs/superpowers/specs/2026-07-07-album-preview-viewer-redesign.md`

## 任务

- [ ] 1. Spec 和预检
  - [ ] 1.1 阅读 `.kiro/specs/album-preview-viewer-redesign/requirements.md` 和 `.kiro/specs/album-preview-viewer-redesign/design.md`。
  - [ ] 1.2 检查当前 dirty working tree，保留无关改动。
  - [ ] 1.3 确认当前 TDesign ImageViewer 源码保留原始 `visible,initialIndex,images` observer，且没有本地 patch。
  - [ ] 1.4 确认当前相册媒体规则：`preview` 为 2048px JPEG quality 85，`thumbnail` 为 640px JPEG quality 75。

- [ ] 2. 为 TDesign 稳定使用方式增加失败优先的静态检查
  - [ ] 2.1 更新 `scripts/check-miniprogram.js`，当 `handlePreviewImageViewerChange` 修改 `previewImageUrls` 时失败。
  - [ ] 2.2 更新 `scripts/check-miniprogram.js`，当 `handlePreviewImageViewerChange` 修改 `previewInitialIndex` 时失败。
  - [ ] 2.3 更新 `scripts/check-miniprogram.js`，当相册预览基线重新引入 `syncPreviewImageUrlAtIndex` 这类动态修改 TDesign `images` 的逻辑时失败。
  - [ ] 2.4 运行 `node scripts/check-miniprogram.js`，确认它会在当前动态 hydration 实现上失败。

- [ ] 3. 在后端增加相册媒体直接加载 URL
  - [ ] 3.1 在 `apps/api/src/server.js` 中新增完整相册媒体签名 token helper。
  - [ ] 3.2 将 token payload 绑定到 purpose、`photoId`、`sessionId`、`userId`、允许的 variant 和过期时间。
  - [ ] 3.3 增加 `preview_load_url` 和 `thumbnail_load_url` 的媒体路径生成逻辑。
  - [ ] 3.4 仅在现有相册可见性校验通过后，从完整相册列表接口返回 `preview_load_url` 和 `thumbnail_load_url`。
  - [ ] 3.5 增加媒体端点校验，使直接加载 token 可以在没有 Authorization 的情况下访问。
  - [ ] 3.6 保留现有认证媒体 URL，以便迁移期间兼容旧逻辑。

- [ ] 4. 增加后端验证
  - [ ] 4.1 扩展后端 smoke 或静态检查，要求完整相册响应包含 `preview_load_url` 和 `thumbnail_load_url`。
  - [ ] 4.2 验证过期或格式错误的直接加载媒体 token 返回 403。
  - [ ] 4.3 验证某一张照片的 token 不能访问另一张照片。
  - [ ] 4.4 验证 `variant=thumbnail` 继续使用 640px 缩略图规则。
  - [ ] 4.5 验证 `variant=preview` 继续使用处理后的 display 展示图。

- [ ] 5. 将小程序相册预览改为 TDesign 稳定基线
  - [ ] 5.1 在 `apps/miniprogram/src/pages/session/album.vue` 中规范化相册照片媒体，保留 `preview_load_url` 和 `thumbnail_load_url`。
  - [ ] 5.2 在 `openPhotoPreview` 中只基于 `preview_load_url` 构建一次 `previewImageUrls`。
  - [ ] 5.3 保持 `previewInitialIndex` 只在打开时赋值，移除滑动时赋值。
  - [ ] 5.4 从 TDesign 基线中移除 `syncPreviewImageUrlAtIndex` 和其他 viewer 打开期间修改 `images` 的路径。
  - [ ] 5.5 将 `hydratePreviewWindow` 重命名或替换为 `prewarmPreviewUrls`，确保预热不修改 `previewImageUrls`。
  - [ ] 5.6 将 `handlePreviewImageViewerChange` 限定为只更新 `previewCurrentIndex` 并调用 `prewarmPreviewUrls`。

- [ ] 6. 增加小程序验证
  - [ ] 6.1 运行 `node scripts/check-miniprogram.js`，确认 TDesign 稳定使用检查通过。
  - [ ] 6.2 运行 `npm --workspace apps/miniprogram run build:mp-weixin`。
  - [ ] 6.3 在微信开发者工具中运行小程序。
  - [ ] 6.4 打开一个至少包含 20 张筛选照片的相册。
  - [ ] 6.5 快速滑动至少 20 张照片，确认 viewer 不会跳回最初打开的图片。
  - [ ] 6.6 确认计数保持当前筛选集合总数，不退化为 `1/1`。

- [ ] 7. TDesign 基线后的决策点
  - [ ] 7.1 记录使用直接加载 `preview_load_url` 后快速滑动是否稳定。
  - [ ] 7.2 如果稳定且体验可接受，到此停止，不开发自定义 viewer。
  - [ ] 7.3 如果仍需要 thumbnail-first 体验，继续执行任务 8。
  - [ ] 7.4 如果 TDesign 在稳定直接加载 URL 下仍然跳动，先调查 TDesign 或插件行为，再决定是否替换。

- [ ] 8. 可选自研渐进式 viewer
  - [ ] 8.1 创建 `apps/miniprogram/src/components/AlbumProgressiveImageViewer.vue`。
  - [ ] 8.2 使用原生 `swiper`，只渲染当前图片和前后两张邻居。
  - [ ] 8.3 每个 item 渲染 thumbnail 和 preview 两层图片。
  - [ ] 8.4 在 preview 加载成功前保持 thumbnail 可见。
  - [ ] 8.5 preview 淡入覆盖 thumbnail，不改变 swiper current。
  - [ ] 8.6 preview 失败时保留 thumbnail，并显示轻量重试或错误提示。
  - [ ] 8.7 只有在 TDesign 基线决策点批准该路径后，才替换相册页的 `t-image-viewer`。

- [ ] 9. 最终验证
  - [ ] 9.1 运行 `node scripts/check-miniprogram.js`。
  - [ ] 9.2 运行 `npm --workspace apps/miniprogram run build:mp-weixin`。
  - [ ] 9.3 对小程序项目运行微信开发者工具 `auto`。
  - [ ] 9.4 更新本任务文件的 checkbox，并记录最终选择：仅 TDesign 稳定基线，或自研渐进式 viewer。

