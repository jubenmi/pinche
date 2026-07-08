# D31 Tasks: 相册独立图片预览组件执行清单

更新日期：2026-07-07

## D31 执行任务

- [x] D31.1 建立 D31 spec 三件套。
  - [x] `requirements.md` 描述独立组件、渐进加载、基础操作、下载确认、回退和验证要求。
  - [x] `design.md` 描述组件接口、渲染结构、URL 选择、交互、相册页接入和静态检查。
  - [x] `tasks.md` 描述实现和验收清单。

- [x] D31.2 先更新静态检查形成失败用例。
  - [x] `scripts/check-miniprogram.js` 读取 `AlbumImageViewer.vue`。
  - [x] 检查组件使用 `thumbnail_load_url` 和 `preview_load_url`。
  - [x] 检查组件不引用下载保存业务。
  - [x] 检查 `album.vue` 使用 `AlbumImageViewer` 并绑定下载事件。
  - [x] 检查分享相册传入 `allowDownload=false`。
  - [x] 运行 `node scripts/check-miniprogram.js`，确认因组件未实现而失败。

- [x] D31.3 实现 `AlbumImageViewer.vue`。
  - [x] 新增组件 props：`visible`、`photos`、`initialIndex`、`allowDownload`。
  - [x] 新增组件事件：`close`、`change`、`download`。
  - [x] 实现内部 current 状态和 `initialIndex` 打开同步。
  - [x] 实现缩略图 URL 和展示图 URL 回退。
  - [x] 实现缩略图层、展示图淡入层和失败占位。
  - [x] 实现左右滑动、关闭按钮、索引计数和下滑关闭。
  - [x] 实现右上角下载图标下载事件。
  - [x] 确保预览区域长按不触发下载确认或保存。
  - [x] 确保 `allowDownload=false` 时不显示下载入口、不响应下载。

- [x] D31.4 接入相册页。
  - [x] `album.vue` import/register `AlbumImageViewer`。
  - [x] 用组件替换内联 `.photo-preview-mask` swiper。
  - [x] 打开预览时设置稳定 `previewPhotos` 和 `previewInitialIndex`。
  - [x] 组件 `change` 事件只更新 `previewCurrentIndex`。
  - [x] 组件 `close` 事件复用 `closePhotoPreview()`。
  - [x] 组件 `download` 事件调用现有 `downloadSinglePhoto(photo)`。
  - [x] 完整相册传 `allowDownload=true`，分享相册传 `false`。

- [x] D31.5 执行自动验证。
  - [x] 运行 `node scripts/check-miniprogram.js`。
    - 结果：通过，输出 `UniApp miniprogram check passed: 13 pages`。
  - [x] 运行 `npm run build:mp-weixin`。
  - [x] 如果构建失败，记录失败命令、错误和是否与本次改动有关。

- [x] D31.6 手动验收。
  - 状态：已在微信开发者工具中直接打开 `apps/miniprogram/dist/dev/mp-weixin` 并进入真实相册 `[冯厚敦·流芳] 相册`；当前筛选集合为全部 263 张。排序回归已复验，列表第一张打开后稳定显示 `1/263`。
  - [x] 打开照片后索引计数对应当前筛选集合。
    - 排序修复后点击列表第一张时先显示并稳定保持 `1/263`；用户确认此前稳定后变为 `2/263` 是手动操作造成，不是自动跳转。
  - [x] 快速左右滑动 20 次，不跳回、不黑屏卡死。
    - 通过系统级手势连续执行 10 次左滑和 10 次右滑；预览仍停留在正常图片，最终计数回到 `2/263`，未出现黑屏卡死或下载弹窗。
  - [x] 展示图未加载完成时能看到缩略图或非透明占位。
  - [x] 展示图加载成功后淡入覆盖缩略图。
  - [x] 单张展示图加载失败时仍能继续滑动。
    - 运行态注入第 2 张展示图失败地址后显示 `展示图加载失败` 和缩略图层；可从 `2/3` 滑到 `3/3`，再回到 `2/3` 并继续滑到 `1/3`。
  - [x] 点击关闭和下滑关闭都生效。
    - 点击右上角关闭返回相册列表；向下拖动预览图后也返回相册列表。
  - [x] 完整相册点击下载图标后先出现确认弹窗。
  - [x] 完整相册长按预览图片不会触发下载确认或保存。
    - 完整相册预览图片加载后执行 1.6 秒长按，仍停留预览页，未出现 `确认下载`。
  - [x] 取消确认不会下载。
  - [x] 分享相册不出现下载入口，长按不触发下载确认或保存。
    - 真实分享页 `冯厚敦的相册` 未显示上传、完整下载、多选下载或单张下载入口。该分享页当前没有公开照片；补充使用同一 viewer 运行态切到 `timelineMode=true` 打开预览，右上角只显示关闭按钮，1.6 秒长按后未出现 `确认下载`。

## D31 验收

- [x] D31 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D31 design 已落地到 [design.md](./design.md)。
- [x] D31 tasks 已落地到本文件。
- [x] 相册页使用独立 `AlbumImageViewer`。
- [x] 预览组件直接消费 `thumbnail_load_url` 和 `preview_load_url`。
- [x] 快速滑动时不依赖 `visiblePhotoMedia.preview` 才显示内容。
- [x] 完整相册下载入口必须先确认。
- [x] 分享相册无下载入口。
- [x] `node scripts/check-miniprogram.js` 通过。
- [x] `npm run build:mp-weixin` 通过或记录明确失败原因。

## 验证记录

- `node scripts/check-miniprogram.js` 红灯通过：脚本退出 1，明确提示 `AlbumImageViewer component must exist for D31 preview`、相册页缺少 `AlbumImageViewer` 接入、旧内联预览仍存在。该命令还报告当前工作区既有 `.env.development` API 地址不是生产地址，后续自动验证需要单独处理或记录。
- `node scripts/check-miniprogram.js` 组件阶段红灯符合预期：脚本退出 1，不再提示组件缺失或组件边界缺失，剩余 D31 失败为 `album.vue` 尚未接入 `AlbumImageViewer` 和旧内联预览仍存在；仍有既有 `.env.development` API 地址检查失败。
- `node scripts/check-miniprogram.js` 接入阶段结果：D31 组件和相册页接入检查通过，旧内联预览检查不再失败；命令仍因当前工作区既有 `.env.development` API 地址为 `http://127.0.0.1:3018` 退出 1。
- `npm run build:mp-weixin` 通过：`DONE Build complete.`。Sass 仅输出 `legacy-js-api` 和 `@import` deprecation warnings。
- `node scripts/check-miniprogram.js` 最终自动验证：退出 1，唯一输出为 `Miniprogram development API base URL must be https://api.pinche.jubenmi.com`。未修改用户已有的 `apps/miniprogram/.env.development` 本地 API 指向。
- 按用户确认将 `apps/miniprogram/.env.development` 改回 `https://api.pinche.jubenmi.com` 后，`node scripts/check-miniprogram.js` 通过：`UniApp miniprogram check passed: 13 pages`。
- 改回线上 API 后重跑 `npm run build:mp-weixin` 通过：`DONE Build complete.`。Sass 仍仅输出 deprecation warnings。
- 微信开发者工具执行记录：首次直接打开 `dist/build/mp-weixin` 时工具将构建产物误当项目根，模拟器提示 `app.json is not found in the project root directory`；随后改为打开 `apps/miniprogram` 项目根，让工具按 `project.config.json` 的 `miniprogramRoot: dist/dev/mp-weixin/` 加载，点击“编译”后模拟器进入 `pages/index/index`。调试器无构建错误，仅有自动热重载、`SharedArrayBuffer` deprecation、全局自定义组件性能提示等 warning。
- 长按误触发下载回归红灯：新增禁止 `requestDownload('longpress')` 的静态检查后，`node scripts/check-miniprogram.js` 退出 1，输出 `AlbumImageViewer must not own album download business: requestDownload('longpress')`。
- 移除预览 slide 长按下载后，`node scripts/check-miniprogram.js` 通过：`UniApp miniprogram check passed: 13 pages`。
- 重跑 `npm run build:mp-weixin` 通过：`DONE Build complete.`。Sass 仍仅输出 deprecation warnings。
- 重跑 `npm run dev:mp-weixin` 刷新开发者工具使用的 `dist/dev/mp-weixin` 产物，输出 `DONE Build complete. Watching for changes...` 后手动中断 watch。
- 检查 `dist/build/mp-weixin/components/AlbumImageViewer.*` 和 `dist/dev/mp-weixin/components/AlbumImageViewer.*` 中无 `bindlongpress`、`catchlongpress` 或 `requestDownload("longpress")` 残留；build/dev 产物中的下载按钮仍为 `catchtap`。
- 图片直链相对 URL 回归红灯：新增检查要求 `normalizePhotoMedia()` 通过 `normalizeAlbumMediaUrl()` 处理媒体字段后，`node scripts/check-miniprogram.js` 退出 1，输出 `Album D31 preview media URLs must be normalized before image components receive them` 和 `Album D31 preview media URL normalization must expand /api relative URLs with apiUrl()`。
- `album.vue` 新增 `normalizeAlbumMediaUrl(path)` 并在 `normalizePhotoMedia()` 中统一把 `image_url`、`preview_url`、`thumbnail_url`、`preview_load_url`、`thumbnail_load_url` 通过 `apiUrl()` 展开，避免 `<image>` 把 `/api/...` 当成本地资源请求。
- 图片直链修复后，`node scripts/check-miniprogram.js` 通过：`UniApp miniprogram check passed: 13 pages`。
- 图片直链修复后，`npm run build:mp-weixin` 通过：`DONE Build complete.`。Sass 仍仅输出 deprecation warnings。
- 重跑 `npm run dev:mp-weixin` 刷新开发者工具使用的 `dist/dev/mp-weixin` 产物，输出 `DONE Build complete. Watching for changes...`。
- 微信开发者工具手工验证（排序修复前）：直接打开 `apps/miniprogram/dist/dev/mp-weixin` 后进入 `[冯厚敦·流芳] 相册`，列表缩略图正常显示，打开第一张照片后计数为 `263/263`，由此确认预览顺序与列表相反；打开预览不会弹下载确认，控制台未再出现 `[渲染层网络层错误] Failed to load local image resource /api/session-album/photos/...`。
- 预览图短暂显示黑色非透明占位后加载出对应照片；点击右上角下载图标出现 `确认下载` 弹窗，点击 `取消` 后弹窗关闭且仍停留预览图；点击右上角关闭后回到相册列表。
- 受当前工具限制未做真实长按和下滑手势：`cliclick` 未安装，Computer Use 当前只提供 click/key，不提供可靠 long press/drag。已用源码和 build/dev 产物检查补证 longpress/longtap 未绑定下载。
- 相册预览排序回归红灯：新增检查要求 `openPhotoPreview()` 使用 `const previewPhotos = [...this.filteredPhotos]` 且不包含 `.reverse()` 后，`node scripts/check-miniprogram.js` 退出 1，输出 `Album D31 preview order must match the visible filtered photo order`。
- 相册预览排序修复：`openPhotoPreview()` 改为使用和瀑布流相同的 `filteredPhotos` 顺序，避免列表第一张在预览中显示为最后一张。
- 排序修复后自动验证：`node scripts/check-miniprogram.js` 通过，输出 `UniApp miniprogram check passed: 13 pages`。
- 排序修复后构建验证：`npm run build:mp-weixin` 通过，输出 `DONE Build complete.`。Sass 仍仅输出 deprecation warnings。
- 排序修复后重跑 `npm run dev:mp-weixin` 刷新开发者工具使用的 `dist/dev/mp-weixin` 产物，输出 `DONE Build complete. Watching for changes...` 后手动中断 watch。后续手工复验因微信开发者工具运行态切到维护页/首页，仍需恢复相册页面后继续。
- 排序修复后微信开发者工具手工复验：进入真实相册 `[冯厚敦·流芳] 相册`（全部 263 张），点击列表第一张后预览计数为 `1/263`，图片加载稳定后仍为 `1/263`；用户确认此前变为 `2/263` 是手动操作。打开预览未弹出下载确认，也未再出现 `/api/session-album/photos/...` 本地图片资源加载错误。
- 快速滑动手工复验：在真实相册预览中先从 `1/263` 左滑到 `2/263`，随后通过系统级手势执行 10 次左滑和 10 次右滑；预览保持可用，最终回到 `2/263`，未跳回、未黑屏卡死、未弹下载确认。
- 关闭手工复验：点击右上角关闭按钮可回到相册列表；重新打开预览后向下拖动可关闭并回到相册列表。
- 完整相册下载和长按手工复验：点击下载按钮弹出 `确认下载`，点击 `取消` 后不下载且留在预览页；对已加载预览图执行 1.6 秒长按，未出现 `确认下载` 或保存流程。
- 分享相册手工复验：通过真实分享入口进入 `冯厚敦的相册`，页面只显示朋友圈只读说明，没有上传、完整下载、多选下载或单张下载入口。由于该真实分享页当前没有公开照片，补充将同一 viewer 运行态切到 `timelineMode=true` 打开预览，右上角仅剩关闭按钮，1.6 秒长按后未出现 `确认下载`。
- 断图滑动手工复验：运行态注入 3 张样本并让第 2 张展示图请求 `https://invalid.localhost.invalid/d31-broken-preview.jpg`，页面显示 `2/3` 与 `展示图加载失败`，缩略图层仍可见；从失败页可滑到 `3/3`，再滑回 `2/3` 并继续到 `1/3`。该测试中控制台出现预期的 invalid 域名加载错误，用于模拟断图。
- 严格两阶段加载修正：发现 `AlbumImageViewer` 原实现会同时挂载缩略图和展示图，只通过展示图透明度做淡入，缓存较快时视觉上会像直接打开大图；现改为展示图 `<image>` 必须等 `thumbnail` 加载成功、缩略图缺失或缩略图失败后才挂载，确保真实先小图再大图。
- 严格两阶段加载补充修正：真实相册第一张仍可能短暂黑屏，因为列表瀑布流已经缓存到 `visiblePhotoMedia.thumbnail`，但 viewer 只拿 `thumbnail_load_url` 重新请求远端缩略图。新增 `thumbnail_display_url` / `preview_display_url` 传入 viewer，优先使用列表已下载的本地缩略图/预览图，再回退远端直链。
- 严格两阶段加载补充红绿验证：先扩展 `node scripts/check-miniprogram.js` 要求 `thumbnail_display_url`、`viewerPhotoWithCachedMedia(photo)` 和 `thumbnail_display_url: visibleMedia.thumbnail`，红灯符合预期；实现后 `node scripts/check-miniprogram.js` 通过，输出 `UniApp miniprogram check passed: 13 pages`。
- 首图到第 20 张巡检记录：重新进入真实相册 `[冯厚敦·流芳] 相册`（全部 263 张），打开列表第一张后显示 `1/263`，无下载弹窗；左滑到第 2 张显示 `2/263`，图片正常。随后系统级滑动脚本只被 swiper 接收至 `8/263`，截图显示第 2 张和第 8 张均为正常图片、未黑屏、未出现失败提示或下载弹窗；用户要求停止使用真实鼠标事件后不再继续用该方式推进到第 20 张。
- 首图到第 20 张非鼠标补证：扩展 `node scripts/check-miniprogram.js` 覆盖 viewer 1-based 计数、`handleSwiperChange` 同步 `currentIndex`/`swiperIndex`、预览顺序使用 `filteredPhotos` 且不反转、viewer 优先消费缓存缩略图和缓存预览图。新增检查后 `node scripts/check-miniprogram.js` 通过，输出 `UniApp miniprogram check passed: 13 pages`。
