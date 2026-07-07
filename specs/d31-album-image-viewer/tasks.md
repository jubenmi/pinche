# D31 Tasks: 相册独立图片预览组件执行清单

更新日期：2026-07-07

## D31 执行任务

- [x] D31.1 建立 D31 spec 三件套。
  - [x] `requirements.md` 描述独立组件、渐进加载、基础操作、下载确认、回退和验证要求。
  - [x] `design.md` 描述组件接口、渲染结构、URL 选择、交互、相册页接入和静态检查。
  - [x] `tasks.md` 描述实现和验收清单。

- [ ] D31.2 先更新静态检查形成失败用例。
  - [ ] `scripts/check-miniprogram.js` 读取 `AlbumImageViewer.vue`。
  - [ ] 检查组件使用 `thumbnail_load_url` 和 `preview_load_url`。
  - [ ] 检查组件不引用下载保存业务。
  - [ ] 检查 `album.vue` 使用 `AlbumImageViewer` 并绑定下载事件。
  - [ ] 检查分享相册传入 `allowDownload=false`。
  - [ ] 运行 `node scripts/check-miniprogram.js`，确认因组件未实现而失败。

- [ ] D31.3 实现 `AlbumImageViewer.vue`。
  - [ ] 新增组件 props：`visible`、`photos`、`initialIndex`、`allowDownload`。
  - [ ] 新增组件事件：`close`、`change`、`download`。
  - [ ] 实现内部 current 状态和 `initialIndex` 打开同步。
  - [ ] 实现缩略图 URL 和展示图 URL 回退。
  - [ ] 实现缩略图层、展示图淡入层和失败占位。
  - [ ] 实现左右滑动、关闭按钮、索引计数和下滑关闭。
  - [ ] 实现右上角下载图标和长按下载事件。
  - [ ] 确保 `allowDownload=false` 时不显示下载入口、不响应长按下载。

- [ ] D31.4 接入相册页。
  - [ ] `album.vue` import/register `AlbumImageViewer`。
  - [ ] 用组件替换内联 `.photo-preview-mask` swiper。
  - [ ] 打开预览时设置稳定 `previewPhotos` 和 `previewInitialIndex`。
  - [ ] 组件 `change` 事件只更新 `previewCurrentIndex`。
  - [ ] 组件 `close` 事件复用 `closePhotoPreview()`。
  - [ ] 组件 `download` 事件调用现有 `downloadSinglePhoto(photo)`。
  - [ ] 完整相册传 `allowDownload=true`，分享相册传 `false`。

- [ ] D31.5 执行自动验证。
  - [ ] 运行 `node scripts/check-miniprogram.js`。
  - [ ] 运行 `npm run build:mp-weixin`。
  - [ ] 如果构建失败，记录失败命令、错误和是否与本次改动有关。

- [ ] D31.6 手动验收。
  - [ ] 打开照片后索引计数对应当前筛选集合。
  - [ ] 快速左右滑动 20 次，不跳回、不黑屏卡死。
  - [ ] 展示图未加载完成时能看到缩略图或非透明占位。
  - [ ] 展示图加载成功后淡入覆盖缩略图。
  - [ ] 单张展示图加载失败时仍能继续滑动。
  - [ ] 点击关闭和下滑关闭都生效。
  - [ ] 完整相册点击下载图标或长按后先出现确认弹窗。
  - [ ] 取消确认不会下载。
  - [ ] 分享相册不出现下载入口，长按不触发保存。

## D31 验收

- [x] D31 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D31 design 已落地到 [design.md](./design.md)。
- [x] D31 tasks 已落地到本文件。
- [ ] 相册页使用独立 `AlbumImageViewer`。
- [ ] 预览组件直接消费 `thumbnail_load_url` 和 `preview_load_url`。
- [ ] 快速滑动时不依赖 `visiblePhotoMedia.preview` 才显示内容。
- [ ] 完整相册下载入口必须先确认。
- [ ] 分享相册无下载入口。
- [ ] `node scripts/check-miniprogram.js` 通过。
- [ ] `npm run build:mp-weixin` 通过或记录明确失败原因。

## 验证记录

- D31.5 执行时在这里记录每条命令、退出结果和关键输出；没有新验证前不得勾选自动验证项。
