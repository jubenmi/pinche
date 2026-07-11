# 相册快速滑动反馈环止抖设计

更新日期：2026-07-11

## 背景与证据

用户在 263 张照片的全屏相册中快速横向滑动后，预览器会在相邻两张照片之间持续自动往返。录屏首帧已经处于异常状态；在没有可见后续触摸的情况下，页码和照片主体仍在 `2/263` 与 `3/263` 之间往返至少 5.97 秒。

当前 `AlbumImageViewer` 同时存在两种索引状态：

- `currentIndex`：组件观察到的当前照片，用于计数、视频生命周期和向父页面发出 `change`。
- `swiperIndex`：绑定到原生 `<swiper :current>`，用于程序化定位。

但是 `handleSwiperChange()` 在收到原生 `change` 后，会同时写入 `currentIndex` 和 `swiperIndex`。这使“原生 swiper 告知当前页”和“业务代码命令 swiper 跳页”形成闭环。快速连续手势、媒体加载引起的异步渲染和微信小程序原生动画交错时，旧页与新页可能互相成为新的程序化目标，表现为相邻页持续抖动。

当前预览一次渲染全部 263 个 `swiper-item`，并在媒体下载进度和完成时频繁更新响应式状态。这是明确的性能风险，但不能单独解释松手后相邻页持续自动互换，因此本设计把它作为后续独立优化，不与本次根因修复混合。

## 目标

1. 切断原生 `change` 与受控 `current` 之间的反馈环。
2. 保留打开指定照片、照片集合缩减时越界纠正、计数、视频暂停与预加载行为。
3. 为快速滑动反馈环增加能够先失败、修复后通过的自动回归检查。
4. 在真实 263 张相册中验证快速滑动后能够稳定停在最终页。

## 非目标

1. 本次不实现最多 5 个 slide 的窗口化。
2. 不调整图片下载并发、媒体缓存、缩略图到展示图的加载策略。
3. 不修改相册筛选、排序、下载、分享、隐私或视频业务。
4. 不通过延长动画时间、加防抖定时器或忽略连续手势来掩盖症状。

## 方案比较

### 方案 A：分离“观察状态”和“跳页命令”（采用）

原生 `change` 只更新 `currentIndex`，不写入 `swiperIndex`。`swiperIndex` 仅在组件打开、外部 `initialIndex` 明确变化，或照片集合缩减导致当前页越界时更新。

优点：直接切断反馈环，改动小，保持现有组件接口和父页面逻辑。

缺点：不解决 263 个 item 带来的长期性能压力。

### 方案 B：根据 `event.detail.source` 或 `animationfinish` 加锁

区分触摸与程序化事件，并通过动画锁避免重复更新。

优点：可以继续让 `swiperIndex` 跟随每次 change。

缺点：引入平台相关事件时序和额外状态；空 `source` 同时覆盖多种原因，仍可能出现竞态。

### 方案 C：立即改为最多 5 个 slide 的窗口化

只渲染当前页前后两张，并维护真实照片索引与窗口索引映射。

优点：长期性能最好。

缺点：需要同步改造图片/视频挂载、计数、下载、预加载和边界切换；与反馈环修复同时进行会失去单变量验证能力。

## 设计

### 状态语义

`currentIndex` 是事实状态：表示原生 swiper 最后报告的真实照片索引。

`swiperIndex` 是命令状态：只有业务代码确实需要程序化定位时才修改。它不再持续镜像 `currentIndex`。

### 打开与外部定位

`syncInitialIndex()` 保持现有行为：

1. 将 `initialIndex` clamp 到有效范围。
2. 同时设置 `currentIndex` 和 `swiperIndex`。

组件重新挂载时，即使索引值与上一次相同，新建的 swiper 节点也会消费该初始值。

### 用户滑动

`handleSwiperChange(event)`：

1. 读取并 clamp `event.detail.current`。
2. 如果索引变化，暂停上一页视频。
3. 只设置 `currentIndex = nextIndex`。
4. 不设置 `swiperIndex`。
5. 保持现有 `change({ index, photo })` 事件。
6. 在下一次渲染后继续请求当前视频资源。

因此，媒体进度或父组件状态引起的后续渲染不会生成新的程序化 `current` 变化。

### 照片集合变化

`syncCurrentIndexAfterPhotosChange()` 保持越界纠正：

- 当前索引仍有效时，不写任何索引。
- 当前索引越界时，同时修正 `currentIndex` 和 `swiperIndex`，命令原生 swiper 移动到新的最后一页。

### 父页面

`album.vue` 的 `handlePreviewChange()` 继续只保存 `previewCurrentIndex` 并预加载当前页附近媒体，不反向控制组件的 `initialIndex` 或 `swiperIndex`。组件公开接口不变。

## 测试设计

### RED：反馈环回归

先修改 `scripts/d31-album-viewer-sequence-check.js`：

1. 组件打开在第 1 张，记录 `swiperIndex` 的写入次数。
2. 模拟原生快速滑动依次报告多个 `change`。
3. 断言 `currentIndex` 跟随最终事件。
4. 断言 `change` 事件的照片与顺序正确。
5. 断言用户滑动期间 `swiperIndex` 写入次数为 0，且仍保留打开时的命令值。

该检查在当前实现上必须因为 `handleSwiperChange()` 回写 `swiperIndex` 而失败。

### GREEN：最小实现

从 `handleSwiperChange()` 删除 `this.swiperIndex = nextIndex`，不改其他生产逻辑，使新增回归通过。

### 静态契约

更新 `scripts/check-miniprogram.js`：

- 继续要求 `handleSwiperChange()` 读取原生 current、更新 `currentIndex` 并发出 `change`。
- 改为禁止该方法写入 `swiperIndex`。
- 继续要求 `syncInitialIndex()` 和越界纠正路径能够写入 `swiperIndex`。

### 自动验证

1. `node scripts/d31-album-viewer-sequence-check.js`
2. `node scripts/check-miniprogram.js`
3. `node scripts/d42-miniprogram-album-video-check.js`
4. `npm run build:mp-weixin`

### 运行时验收

在微信开发者工具或同一台 iPhone 的真实 `[冯厚敦·流芳] 相册`中：

1. 打开包含 263 张照片的预览。
2. 连续快速横滑至少 20 次后松手。
3. 预览必须在最终页稳定停留，不得在相邻页之间自行往返。
4. 页码、图片和 `change` 事件最终索引一致。
5. 验证图片到图片；若当前集合包含视频，再验证视频到图片和图片到视频。
6. 关闭、下滑关闭、下载按钮及单张加载失败后继续滑动仍可用。

## 失败处理与后续阶段

如果切断反馈环后仍能复现相同的自动往返，不叠加定时器或事件锁；应记录 `change.detail.current/source` 与媒体更新时序，重新进入根因调查。

如果自动往返消失，但 263 张相册仍有明显掉帧或加载压力，则另立第二阶段设计，实施最多 5 个 slide 的窗口化和媒体请求限流。两阶段分别验收，避免把行为正确性修复和性能重构混在一起。

## 回退

本次生产改动仅涉及 `handleSwiperChange()` 的单向状态更新；如验证失败，可恢复该行并同时恢复对应回归检查。父页面、组件接口和媒体数据无需回退。
