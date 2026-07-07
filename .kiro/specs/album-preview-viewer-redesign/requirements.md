# 相册图片预览重设计需求

## 目标

稳定小程序车局相册的全屏图片预览体验，确保用户快速左右滑动时不会出现黑屏、图片永久无法载入、索引跳回、反复闪动等问题。第一阶段必须先按 TDesign ImageViewer 的原始使用条件实现稳定基线，再决定是否进入自研渐进式预览器。

## 功能需求

1. 相册预览必须保留当前筛选后的照片顺序，左右滑动只能在这个筛选集合内切换。
2. 预览计数必须反映当前筛选集合总数，不能退化成 `1/1`。
3. TDesign ImageViewer 基线必须在打开预览时向 `images` 传入稳定的最终图片 URL 数组。
4. TDesign ImageViewer 基线必须把 `initialIndex` 视为打开时定位值，滑动过程中不得更新。
5. TDesign ImageViewer 基线不得在预览打开期间修改 `images`。
6. TDesign ImageViewer 基线可以预热当前 `index - 2` 到 `index + 2` 的图片，但预热过程不得改变 viewer 的 `images` prop。
7. ImageViewer 使用的完整相册媒体 URL 必须可以被微信 `<image>` 直接加载，不能依赖 Authorization 请求头。
8. 可直接加载的媒体 URL 仍必须受权限控制、短期有效，并绑定现有相册可见性规则。
9. `thumbnail` 必须保持现有 640px、JPEG、quality 75 的缩略图规格。
10. `preview` 必须保持现有展示图规格：最长边 2048px、JPEG、quality 85、去除元数据。
11. 系统不得暴露或依赖上传原始大图；相册全屏查看使用处理后的 `preview` 展示图。
12. 如果验证 TDesign 稳定基线后仍需要“先缩略图占位，再展示图覆盖”的体验，必须通过自研 viewer 实现，而不是动态修改 TDesign ImageViewer 的 `images`。

## 非目标

- 不重设计相册筛选、标注、删除、上传、下载、隐私、分享或多选流程。
- 不在打开预览前把整个相册下载到本地。
- 不 patch TDesign ImageViewer 内部源码。
- 不新增原始大图存储或访问路径。
- 不放宽完整相册成员权限或单张照片隐私校验。
- 不替换 `uv-waterfall`。

## 验收标准

1. `scripts/check-miniprogram.js` 在 `handlePreviewImageViewerChange` 修改 `previewImageUrls` 时失败。
2. `scripts/check-miniprogram.js` 在 `handlePreviewImageViewerChange` 修改 `previewInitialIndex` 时失败。
3. `scripts/check-miniprogram.js` 在 TDesign 基线重新引入 `syncPreviewImageUrlAtIndex` 这类动态修改 `images` 的逻辑时失败。
4. 完整相册 API 每张可见照片都返回可直接加载的 `preview_load_url` 和 `thumbnail_load_url`。
5. 直接加载媒体 URL 在 token 过期、格式错误、照片不匹配或超出当前用户可见范围时拒绝访问。
6. 小程序 TDesign 基线打开 viewer 时，使用由 `preview_load_url` 生成的稳定 `previewImageUrls` 数组。
7. 在微信开发者工具中快速滑动至少 20 张照片，不跳回最初打开的照片。
8. 快速滑动不产生永久黑页；图片加载失败时显示可恢复的图片错误状态，并且仍可继续滑动。
9. `node scripts/check-miniprogram.js` 执行成功。
10. `npm --workspace apps/miniprogram run build:mp-weixin` 执行成功。

