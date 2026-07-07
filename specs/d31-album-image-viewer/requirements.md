# D31 Requirements: 相册独立图片预览组件

更新日期：2026-07-07

## Introduction

D31 将相册全屏预览从页面内联 swiper 抽成独立 `AlbumImageViewer` 组件。组件直接消费后端已经返回的 `thumbnail_load_url` 和 `preview_load_url`，先显示缩略图，再在同一页加载并淡入展示图，避免快速左右滑动时依赖本地缓存回填造成黑屏、跳回或加载空洞。

第一版只做 TDesign ImageViewer 同级基础体验：左右滑动、顶部关闭、索引计数、下滑关闭、缩略图占位、大图淡入、失败态可继续滑动。完整相册提供下载入口，但下载必须先确认；分享相册不提供下载。

## Requirements

### Requirement 1: 独立预览组件

**User Story:** 作为用户，我希望打开相册照片后可以稳定左右滑动，而不是因为图片异步处理方式导致预览卡住或跳动。

#### Acceptance Criteria

1. WHEN 相册页打开照片预览 THEN 系统 SHALL 渲染独立 `AlbumImageViewer` 组件。
2. WHEN 组件打开 THEN 组件 SHALL 使用打开时传入的稳定 `photos` 数组和 `initialIndex`。
3. WHEN 用户左右滑动 THEN 组件 SHALL 在内部维护当前 index，不要求页面反向控制 swiper current。
4. WHEN 用户滑动过程中 THEN 组件 SHALL NOT 改写 `photos` 数组。
5. WHEN 组件关闭 THEN 相册页 SHALL 清空预览可见状态和预览照片集合。

### Requirement 2: 缩略图占位和展示图淡入

**User Story:** 作为用户，我希望网络慢或快速滑动时先看到照片缩略图，而不是黑屏或空白加载。

#### Acceptance Criteria

1. WHEN 某页开始渲染 THEN 组件 SHALL 优先显示 `thumbnail_load_url`。
2. WHEN `thumbnail_load_url` 缺失 THEN 组件 SHALL 回退到 `thumbnail_url`、`preview_load_url`、`preview_url`、`image_url`。
3. WHEN 某页开始渲染 THEN 组件 SHALL 同时加载 `preview_load_url`。
4. WHEN `preview_load_url` 缺失 THEN 组件 SHALL 回退到 `preview_url`、`image_url`。
5. WHEN 展示图加载成功 THEN 组件 SHALL 在同一 swiper item 内淡入覆盖缩略图。
6. WHEN 展示图加载失败 THEN 组件 SHALL 保留缩略图并显示轻量失败提示。
7. WHEN 缩略图和展示图都不可用或加载失败 THEN 组件 SHALL 显示非透明失败占位。

### Requirement 3: TDesign 同级基础操作

**User Story:** 作为用户，我希望预览体验保持熟悉的基础看图操作。

#### Acceptance Criteria

1. WHEN 组件打开 THEN 顶部 SHALL 显示关闭按钮。
2. WHEN 组件打开 THEN 顶部 SHALL 显示当前索引和总数。
3. WHEN 用户点击关闭按钮 THEN 组件 SHALL 抛出 `close` 事件。
4. WHEN 用户向下滑动超过关闭阈值 THEN 组件 SHALL 抛出 `close` 事件。
5. WHEN 用户左右滑动 THEN 组件 SHALL 抛出 `change({ index, photo })` 事件。
6. WHEN 单张照片加载失败 THEN 用户 SHALL 仍可继续左右滑动。

### Requirement 4: 下载入口必须确认

**User Story:** 作为完整相册用户，我希望可以从预览中保存照片，但保存前必须确认，避免误触。

#### Acceptance Criteria

1. WHEN 完整相册预览打开且 `allowDownload = true` THEN 组件 SHALL 显示右上角下载图标。
2. WHEN 完整相册用户点击下载图标 THEN 组件 SHALL 抛出 `download({ index, photo, trigger: "button" })`。
3. WHEN 完整相册用户长按当前图片 THEN 组件 SHALL 抛出 `download({ index, photo, trigger: "longpress" })`。
4. WHEN 相册页收到下载事件 THEN 页面 SHALL 调用现有 `downloadSinglePhoto(photo)`。
5. WHEN `downloadSinglePhoto(photo)` 执行 THEN 页面 SHALL 先展示确认弹窗。
6. WHEN 用户取消确认 THEN 系统 SHALL NOT 下载或保存照片。
7. WHEN 用户确认 THEN 系统 SHALL 复用现有权限检查、token 刷新、下载和保存逻辑。
8. WHEN 分享相册预览打开 THEN 组件 SHALL NOT 显示下载图标。
9. WHEN 分享相册用户长按图片 THEN 系统 SHALL NOT 触发保存。

### Requirement 5: 不扩大范围并保留回退

**User Story:** 作为开发团队，我希望本次改动集中且可回退，如果新组件验证不理想，可以恢复今天的预览版本。

#### Acceptance Criteria

1. WHEN D31 实现 THEN 系统 SHALL NOT 修改后端媒体 token、权限和图片处理规格。
2. WHEN D31 实现 THEN 系统 SHALL NOT 新增双指缩放、双击放大、旋转、编辑或删除。
3. WHEN D31 实现 THEN 组件 SHALL NOT 引用 `getToken`、`downloadSinglePhoto`、`uni.saveImageToPhotosAlbum`。
4. WHEN D31 实现 THEN 相册页现有下载确认链路 SHALL 保持可用。
5. WHEN D31 实现验证失败 THEN 开发者 SHALL 能通过恢复 `album.vue` 预览接入并移除新组件回退到今天版本。

### Requirement 6: D31 交付物和验证

**User Story:** 作为开发团队，我希望 D31 有明确中文 spec 三件套和验收记录。

#### Acceptance Criteria

1. WHEN D31 spec 完成 THEN SHALL 产出 `requirements.md`。
2. WHEN D31 spec 完成 THEN SHALL 产出 `design.md`。
3. WHEN D31 spec 完成 THEN SHALL 产出 `tasks.md`。
4. WHEN D31 实现完成 THEN SHALL 更新小程序静态检查。
5. WHEN D31 实现完成 THEN SHALL 通过 `node scripts/check-miniprogram.js`。
6. WHEN D31 实现完成 THEN SHALL 通过小程序构建或说明无法构建的原因。
