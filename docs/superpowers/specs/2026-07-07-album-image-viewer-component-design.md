# 相册独立图片预览组件设计

## 背景

小程序相册预览曾使用 TDesign ImageViewer。TDesign 的 `images`、`initialIndex` 和内部 swiper 状态假设输入稳定，而相册页过去会在滑动和异步下载过程中回填图片路径，导致快速左右滑动时出现黑屏、跳回、闪动或加载丢失。

当前页面已经改为内联 swiper 预览层，但仍依赖 `visiblePhotoMedia[photo.id].preview` 这种异步下载到本地缓存后的状态。用户快速滑到未缓存照片时，会看到黑底 loading 或加载空洞。后端已经提供 `thumbnail_load_url` 和 `preview_load_url`，可以被微信 `<image>` 直接加载，因此前端应直接消费稳定照片模型，而不是把预览体验建立在本地缓存回填上。

## 目标

1. 新增独立 `AlbumImageViewer` 组件，替代 `album.vue` 内联预览层。
2. 组件达到 TDesign ImageViewer 同级基础体验：左右滑动、顶部关闭、索引计数、下滑关闭。
3. 每页先展示缩略图，再加载展示图；展示图加载成功后在同一页淡入覆盖。
4. 某张展示图加载失败时保留缩略图和失败提示，用户仍可继续左右滑动。
5. 完整相册模式提供下载入口：右上角小下载图标和长按快捷入口。
6. 下载必须由相册页确认后执行，组件只抛出事件，不直接保存图片。
7. 实现保持可回退：组件和接入点集中，保留今天已有预览逻辑的恢复路径。

## 非目标

1. 第一版不做双指缩放、双击放大、旋转、编辑或删除。
2. 不修改后端媒体 URL、token、权限校验和图像处理规格。
3. 不让组件处理登录态、相册保存权限、token 刷新或本地文件写入。
4. 不扩大分享相册的下载能力。
5. 不 patch TDesign 源码，也不重新引入 TDesign ImageViewer。

## 方案选择

采用独立 `AlbumImageViewer` 组件。

已比较的方案：

1. 独立组件：正确性和边界最好。页面只传稳定照片数组和初始索引，组件负责看图体验，下载通过事件交回页面。
2. 继续内联在 `album.vue`：改动较短，但相册页会继续承载筛选、下载、缓存和预览状态，后续维护风险高。
3. 回到 TDesign 稳定输入版：可以验证插件稳定性，但无法优雅表达缩略图到展示图的渐进覆盖。

最终选择 1。

## 组件接口

组件位置为：

```text
apps/miniprogram/src/components/AlbumImageViewer.vue
```

输入：

```js
{
  visible: Boolean,
  photos: Array<{
    id,
    thumbnail_load_url,
    preview_load_url,
    thumbnail_url,
    preview_url,
    image_url,
    image_width,
    image_height
  }>,
  initialIndex: Number,
  allowDownload: Boolean
}
```

事件：

```js
close()
change({ index, photo })
download({ index, photo, trigger })
```

接口语义：

1. `initialIndex` 只在 `visible` 从 false 变为 true 或照片集合重新打开时使用。
2. 打开期间 `photos` 的顺序由页面保持稳定；组件不重新排序。
3. `change` 只报告当前页，不要求页面反向控制 swiper current。
4. `download` 不保存图片，只请求页面进入确认下载流程。

## 组件行为

### 打开

相册页点击照片时：

1. 从当前筛选后的 `filteredPhotos` 构建稳定预览数组。
2. 计算点击照片在数组中的 index。
3. 设置 `previewPhotos`、`previewInitialIndex`、`previewOverlayVisible`。
4. 渲染 `AlbumImageViewer`。

组件打开后：

1. swiper 定位到 `initialIndex`。
2. 顶部显示关闭、索引计数。
3. 完整相册模式且 `allowDownload=true` 时显示右上角下载图标。

### 图片加载

每个 swiper item：

1. 优先使用 `thumbnail_load_url`，缺失时回退 `thumbnail_url`、`preview_load_url`、`preview_url`、`image_url`。
2. 同时加载 `preview_load_url`，缺失时回退 `preview_url`、`image_url`。
3. 缩略图成功后立即显示。
4. 展示图成功后在同一 item 内淡入覆盖缩略图。
5. 展示图失败时保留缩略图，展示轻量失败提示。
6. 缩略图和展示图都失败时显示非透明占位和失败提示。

### 滑动

1. 使用小程序原生 `swiper`。
2. `current` 由组件内部状态维护。
3. `change` 更新组件当前 index 并抛出 `change` 事件。
4. 组件不在滑动过程中改写照片数组。
5. 组件不依赖相册页的 `visiblePhotoMedia` 本地缓存状态。

### 关闭

1. 点击顶部关闭按钮关闭。
2. 下滑超过阈值关闭。
3. 关闭时组件抛出 `close`，页面清空预览状态。

### 下载

完整相册模式：

1. 右上角下载图标触发 `download({ trigger: "button" })`。
2. 长按当前图片触发 `download({ trigger: "longpress" })`。
3. 页面收到事件后调用现有 `downloadSinglePhoto(photo)`。
4. `downloadSinglePhoto` 必须继续弹确认框，例如“将保存这张照片到系统相册，是否继续？”。
5. 用户确认后再走现有权限检查、token 刷新、下载和保存逻辑。

分享相册模式：

1. `allowDownload=false`。
2. 不显示下载图标。
3. 长按不触发下载。

## 相册页改动

`album.vue` 保留相册业务逻辑，移除内联预览 UI 的主要职责：

1. 引入 `AlbumImageViewer`。
2. 用组件替换 `.photo-preview-mask` 内联 swiper。
3. 保留 `previewOverlayVisible`、`previewPhotos`、`previewCurrentIndex` 或等价状态。
4. 新增或保留 `handlePreviewDownload(event)`，调用 `downloadSinglePhoto(event.detail.photo)`。
5. 完整相册传 `allowDownload=true`，分享相册传 `false`。
6. 缩略图瀑布流仍可继续使用现有 `visiblePhotoMedia` 逻辑，预览组件不依赖它。

## 回退策略

为了满足“如果不行退回今天版本”的要求：

1. 新组件文件独立新增。
2. `album.vue` 接入点集中在预览模板、组件注册和少量预览方法。
3. 不删除后端直载 URL、下载逻辑和媒体缓存逻辑。
4. 实现完成前保留今天内联预览逻辑的 git diff 上下文，若验证失败，可以恢复 `album.vue` 的预览区域并移除新组件。
5. 检查脚本只在新组件验证通过后收紧规则，避免半成品把回退路径锁死。

## 测试与验收

静态检查：

1. `AlbumImageViewer.vue` 存在并使用 `thumbnail_load_url`、`preview_load_url`。
2. 组件不引用 `downloadSinglePhoto`、`getToken`、`uni.saveImageToPhotosAlbum`。
3. `album.vue` 不再内联主要预览 swiper。
4. `album.vue` 处理 `download` 事件并复用确认下载逻辑。
5. 分享相册模式传入 `allowDownload=false`。

行为验收：

1. 打开照片后索引计数对应当前筛选集合。
2. 快速左右滑动 20 次，不跳回、不黑屏卡死。
3. 展示图未加载完成时能看到缩略图或非透明占位。
4. 展示图加载成功后淡入覆盖缩略图。
5. 单张展示图加载失败时仍能继续滑动。
6. 点击关闭和下滑关闭都生效。
7. 完整相册点击下载图标或长按后先出现确认弹窗。
8. 取消确认不会下载。
9. 分享相册不出现下载入口，长按不触发保存。
