# D31 Design: 相册独立图片预览组件

更新日期：2026-07-07

## Overview

D31 新增 `AlbumImageViewer`，把相册全屏预览从 `pages/session/album.vue` 中抽离。相册页负责筛选照片、打开/关闭预览、确认下载和保存；组件负责看图交互，包括左右滑动、索引、关闭、缩略图占位、展示图淡入、失败态和显式下载事件。

该设计沿用后端已经返回的直载 URL：`thumbnail_load_url` 和 `preview_load_url`。组件直接把这些 URL 交给小程序 `<image>` 加载，不再依赖 `visiblePhotoMedia[photo.id].preview` 或 `uni.request` 写本地文件后再渲染预览。

## Component Design

### `apps/miniprogram/src/components/AlbumImageViewer.vue`

组件 props：

```js
props: {
  visible: { type: Boolean, default: false },
  photos: { type: Array, default: () => [] },
  initialIndex: { type: Number, default: 0 },
  allowDownload: { type: Boolean, default: false }
}
```

组件事件：

```text
close
change: { index, photo }
download: { index, photo, trigger }
```

组件内部状态：

```js
currentIndex: 0
swiperIndex: 0
touchStartX: 0
touchStartY: 0
previewLoadedById: {}
previewFailedById: {}
thumbnailFailedById: {}
```

状态语义：

- `currentIndex` 是组件内部当前 index。
- `swiperIndex` 绑定到 `<swiper :current>`。
- `previewLoadedById` 标记某张展示图是否加载成功，用来控制淡入。
- `previewFailedById` 和 `thumbnailFailedById` 控制失败提示与非透明占位。
- `initialIndex` 只在打开或照片集合重新打开时同步到内部状态。

## Rendering

模板结构：

```vue
<view v-if="visible" class="album-image-viewer" @touchstart="handleTouchStart" @touchend="handleTouchEnd">
  <swiper :current="swiperIndex" @change="handleSwiperChange">
    <swiper-item v-for="photo in photos" :key="photo.id || index">
      <view class="album-image-viewer__slide">
        <image
          v-if="thumbnailUrl(photo) && !thumbnailFailed(photo)"
          class="album-image-viewer__image album-image-viewer__image--thumbnail"
          :src="thumbnailUrl(photo)"
          mode="aspectFit"
          @error="handleThumbnailError(photo)"
        />
        <image
          v-if="previewUrl(photo)"
          class="album-image-viewer__image album-image-viewer__image--preview"
          :class="{ loaded: previewLoaded(photo) }"
          :src="previewUrl(photo)"
          mode="aspectFit"
          @load="handlePreviewLoad(photo)"
          @error="handlePreviewError(photo)"
        />
        <view v-if="showFallback(photo)" class="album-image-viewer__fallback">图片加载失败</view>
      </view>
    </swiper-item>
  </swiper>
  <view class="album-image-viewer__topbar">
    <view class="album-image-viewer__counter">{{ counterText }}</view>
    <view class="album-image-viewer__actions">
      <view v-if="allowDownload" class="album-image-viewer__icon-button" @tap.stop="requestDownload('button')">↓</view>
      <view class="album-image-viewer__icon-button" @tap.stop="close">×</view>
    </view>
  </view>
</view>
```

最终实现可调整 class 名和字符图标，但必须保留等价结构：swiper、缩略图层、展示图层、失败占位、顶部计数、下载入口和关闭入口。

## URL Selection

缩略图 URL：

```js
thumbnailUrl(photo) {
  return (
    photo?.thumbnail_load_url ||
    photo?.thumbnail_url ||
    photo?.preview_load_url ||
    photo?.preview_url ||
    photo?.image_url ||
    ""
  );
}
```

展示图 URL：

```js
previewUrl(photo) {
  return photo?.preview_load_url || photo?.preview_url || photo?.image_url || "";
}
```

组件不调用 `apiUrl()`。当前后端返回给小程序的数据已经是页面可消费的路径；相册页现有 `<image>` 也直接使用该路径风格。

## Interaction

### 打开

`visible` 从 false 变为 true 时：

1. 将 `initialIndex` clamp 到 `0..photos.length - 1`。
2. 设置 `currentIndex` 和 `swiperIndex`。
3. 清理 touch 起点。
4. 保留已加载状态不影响正确性；如果照片集合变化，可按 id 重新自然命中。

### 左右滑动

`swiper` change 时：

1. 读取 `event.detail.current`。
2. 更新 `currentIndex` 和 `swiperIndex`。
3. 抛出 `change({ index, photo })`。

### 下滑关闭

组件记录 touch 起点。touch 结束时：

```js
deltaX = endX - startX
deltaY = endY - startY
if deltaY > 90 && deltaY > abs(deltaX) * 1.2:
  close()
```

### 下载

`requestDownload(trigger)`：

1. 如果 `allowDownload=false`，直接返回。
2. 取 `photos[currentIndex]`。
3. 若当前照片不存在，直接返回。
4. 抛出 `download({ index: currentIndex, photo, trigger })`。

下载只由右上角下载按钮触发。预览 slide 和图片本体不绑定长按下载，避免打开照片时的持续按压误触发确认弹窗，导致用户以为进入了下载界面。

组件不弹确认框。确认框由相册页现有 `downloadSinglePhoto(photo)` 负责。

## Album Page Integration

`apps/miniprogram/src/pages/session/album.vue` 改动：

1. import 并注册 `AlbumImageViewer`。
2. 模板中用组件替换当前 `.photo-preview-mask` 内联 swiper。
3. `openPhotoPreview(photo)` 继续从当前 `filteredPhotos` 构建预览数组并计算 index。
4. 增加 `previewInitialIndex` 状态，打开时赋值，传给组件。
5. `handlePreviewChange(event)` 只更新 `previewCurrentIndex`。
6. `handlePreviewDownload(event)` 调用 `downloadSinglePhoto(event.detail.photo)`。
7. `allowDownload` 传 `!timelineMode`。
8. 关闭时保留当前 `closePhotoPreview()` 清理流程。

瀑布流缩略图仍可使用 `visiblePhotoMedia` 和现有懒加载逻辑。预览组件不依赖这套本地缓存。

## Static Checks

`scripts/check-miniprogram.js` 更新 D31 检查：

1. `AlbumImageViewer.vue` 必须存在。
2. 组件源码必须包含 `thumbnail_load_url`、`preview_load_url`、`previewLoadedById`、`previewFailedById`、`thumbnailFailedById`。
3. 组件源码不得包含 `getToken`、`downloadSinglePhoto`、`saveImageToPhotosAlbum`。
4. `album.vue` 必须 import/register/use `AlbumImageViewer`。
5. `album.vue` 必须绑定 `@download="handlePreviewDownload"`。
6. `handlePreviewDownload` 必须调用 `downloadSinglePhoto`，因此继续复用确认下载。
7. `album.vue` 必须传 `:allow-download="!timelineMode"`。
8. `album.vue` 不再保留 `.photo-preview-mask` 内联预览层。
9. `AlbumImageViewer.vue` 不得通过 `requestDownload("longpress")` 或 `requestDownload('longpress')` 绑定长按下载。

## Rollback

D31 的回退边界：

1. 删除或停用 `AlbumImageViewer.vue`。
2. 恢复 `album.vue` 中今天版本的内联 `.photo-preview-mask` swiper。
3. 恢复 `scripts/check-miniprogram.js` 中今天版本的预览检查。
4. 后端、媒体 token、上传处理和现有下载保存逻辑无需回退。

因为组件是新增文件，页面接入集中，回退不会影响相册上传、筛选、标注、多选下载和隐私规则。
