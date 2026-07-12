# 相册预览 5 项窗口化设计

更新日期：2026-07-12

## 背景与运行时证据

第一阶段已经切断 `AlbumImageViewer` 的原生 `change` 与受控 `current` 反馈环，自动化检查、构建和代码审查均通过。真实 263 项相册中的相邻页持续往返已经消失，但快速连续滑动后仍能观察到明显的事件与渲染积压：同一轮验收中，松手约 1 秒、10 秒、30 秒的可见页码分别为 `11/263`、`14/263`、`14/263`。开发者工具同时出现 58–115 ms 的定时器处理警告，诊断轮次还记录过约 282–309 ms 的消息处理耗时。

进一步的事件诊断表明，最后一次 `touchend` 后没有新的业务 `change`；页面继续变化来自已经排队的原生滑动、渲染和媒体工作，而不是反馈环复发。当前组件一次挂载全部 263 个 `swiper-item`，父页面又会在单个媒体完成时通过 `.map()` 替换整个 263 项数组，这会放大每次状态同步和视图更新的成本。

DCloud 的[性能优化指南](https://uniapp.dcloud.net.cn/tutorial/performance.html)建议长列表分页、减少一次性节点数量和逻辑层/视图层的高频通信；[`swiper` 文档](https://uniapp.dcloud.net.cn/component/swiper.html)也明确建议复杂横向长列表只缓存少量列。第二阶段因此针对渲染规模和热路径更新做独立优化，不再改变第一阶段已经验证的一向索引所有权。

## 目标

1. 无论相册有多少项，原生 `swiper` 实际挂载的 `swiper-item` 最多为 5 个。
2. 逻辑照片集合、页码总数和业务事件继续使用完整相册索引；263 项仍显示并遍历为 `1/263` 到 `263/263`。
3. 快速滑动停止后不再因大量节点、全量数组替换或无关媒体请求产生数秒级延迟更新。
4. 保留现有打开指定照片、图片/视频混排、失败重试、下载、关闭和下滑关闭接口与行为。
5. 媒体完成只更新对应照片，并将预加载/进度活动限制在当前页前后两项。

## 非目标

1. 不修改后端接口、鉴权、隐私、筛选、排序、上传、分享或相册数据模型。
2. 不新增循环轮播；完整相册的第一项和最后一项仍是不可越过的真实边界。
3. 不实现缩放、旋转或新的手势系统。
4. 不使用定时器防抖、`source` 锁、延长动画、WXS 自定义滑动或忽略真实触摸事件来掩盖积压。
5. 不一次性重写所有媒体缓存逻辑；只收窄与预览热路径直接相关的更新和预加载范围。

## 方案比较

### 方案 A：5 项窗口 + 动画结束后边缘重建（采用）

父页面保留完整稳定的逻辑照片列表，预览组件只切出当前项前后各两项。用户滑到窗口边缘且完整列表在该方向仍有内容时，在 `animationfinish` 后以当前逻辑照片为中心重建窗口，并通过新的 `swiper` 实例直接挂载到对应物理位置。

优点：节点上限固定；索引映射明确；重建发生在原生动画结束后，不会在 `change` 中修改数据结构；无需复制首尾项或引入循环语义。

代价：中间区域通常每两次滑动需要重建一次原生 `swiper`；必须显式过滤重建产生的同页空来源事件。

### 方案 B：动态窗口 + `current-item-id` 原地换项

持续修改同一个 `swiper` 的子项，并依赖 `current-item-id` 在子项重排后保持活动页。

优点：理论上不需要销毁原生 `swiper`。

缺点：小程序平台对动画期间子项增删、重排和活动项解析的时序依赖较强，容易重新引入跳页竞态；验证成本高于明确的代际重建。

### 方案 C：保留 263 项并启用 `skip-hidden-item-layout`

继续渲染完整列表，只跳过隐藏项布局计算。

优点：改动最小。

缺点：仍保留 263 个 Vue/小程序节点、图片或视频条件分支以及全列表响应式依赖，不能消除主要的节点与同步规模，因此不采用。

## 核心状态与不变量

组件维护以下状态：

- `currentIndex`：完整 `photos` 中的逻辑索引，是当前照片的事实状态。
- `windowStart`：当前窗口第一项在完整 `photos` 中的逻辑索引。
- `windowPhotos`：`photos.slice(windowStart, windowStart + 5)`，长度始终不超过 5。
- `activeWindowIndex`：原生 `change` 最后报告的窗口内物理索引，是当前物理位置的观察状态。
- `swiperIndex`：当前 `swiper` 代际的程序化物理定位命令；只在打开、窗口重建或列表结构纠正时写入，不跟随每次原生 `change` 镜像更新。
- `swiperGeneration`：窗口重建时递增，作为 `swiper` 的 `key`，确保旧原生实例销毁后以新窗口和新物理索引重新挂载。
- `pendingWindowRebase`：空值或 `{ generation, logicalIndex }`；记录哪个代际、哪一逻辑页在动画结束后需要重新居中，不改变业务当前页。

必须始终满足：

```text
0 <= windowPhotos.length <= 5
0 <= windowStart <= max(0, photos.length - 5)
currentIndex = windowStart + activeWindowIndex
windowPhotos[activeWindowIndex] = photos[currentIndex]
```

空相册是例外：`currentIndex`、`activeWindowIndex` 和 `swiperIndex` 均归零，`windowPhotos` 为空，不发出包含虚构照片的业务 `change`。

## 窗口计算

窗口大小固定为 5。给定完整列表长度 `length` 和已经 clamp 的逻辑索引 `currentIndex`：

```js
const maxStart = Math.max(0, length - 5);
const windowStart = Math.min(Math.max(currentIndex - 2, 0), maxStart);
const activeWindowIndex = currentIndex - windowStart;
```

因此：

- 开头区域窗口为逻辑 `0...4`，当前项可以位于物理 `0...2`。
- 中间区域当前项位于物理索引 `2`，窗口覆盖当前项前后各两项。
- 末尾区域窗口为逻辑 `length-5...length-1`，当前项可以位于物理 `2...4`。
- 列表少于 5 项时使用全部项目，不补占位项。

每个窗口条目同时携带或可计算其 `logicalIndex = windowStart + physicalIndex`。模板、视频活动判断、下载与事件都不得把物理索引当成逻辑索引。

## 生命周期与事件流

### 打开和外部初始定位

1. 将 `initialIndex` clamp 到完整列表范围。
2. 设置逻辑 `currentIndex`。
3. 按窗口公式计算 `windowStart` 和 `activeWindowIndex`，并将 `swiperIndex` 设置为同一物理值。
4. 创建或递增 `swiperGeneration`，使新原生实例直接以 `swiperIndex` 为当前项。
5. 预加载范围只覆盖 `currentIndex - 2 ... currentIndex + 2` 的有效项。

打开过程不发出模拟的用户滑动事件；既有可见性与视频资源请求时机保持不变。

### 原生 `change`

`handleSwiperChange(event)` 只执行本代际内的物理到逻辑映射：

```js
const physicalIndex = clampToWindow(event.detail.current);
const nextIndex = windowStart + physicalIndex;
```

随后：

1. 若 `nextIndex` 与 `currentIndex` 不同，暂停上一逻辑页的视频。
2. 更新 `currentIndex` 和 `activeWindowIndex`；不改写命令状态 `swiperIndex`。
3. 仅在逻辑索引确实变化时，以完整照片对象发出原有 `change({ index: nextIndex, photo: photos[nextIndex] })`；同一逻辑页的重复原生事件是幂等的。
4. 仅在逻辑索引变化时请求当前视频资源，并预加载当前逻辑页前后两项。
5. 每次 `change` 都重新计算 pending：若物理位置已经到达窗口的第 0 项或最后一项，且完整列表在对应方向还有窗口外内容，则设置 `pendingWindowRebase = { generation: swiperGeneration, logicalIndex: nextIndex }`；否则清空它。

`change` 内不得切片、重排窗口、递增 `swiperGeneration`，也不得把观察到的物理索引反写成下一条原生跳页命令。

### 原生 `animationfinish` 与窗口重建

`swiper` 节点使用 `swiperGeneration` 作为 `key`，并在 `data-generation` 中写入同一值。`change` 和 `animationfinish` 先比较 `event.currentTarget.dataset.generation` 与当前 generation，旧节点晚到的事件直接忽略。

只有当前代际的 `animationfinish` 且 `pendingWindowRebase` 中的 generation 和 logicalIndex 仍分别等于当前 `swiperGeneration`、`currentIndex` 时才允许重建：

1. 重新按当前 `currentIndex` 计算居中的 `nextWindowStart` 和 `nextActiveWindowIndex`。
2. 若 `nextWindowStart === windowStart`，清除 pending 状态，不重建；这覆盖完整列表的真实首尾边界。
3. 否则先清除 pending，写入新窗口起点，将 `activeWindowIndex` 与 `swiperIndex` 同时设为 `nextActiveWindowIndex`，再递增 `swiperGeneration`。
4. 新实例挂载时活动照片的逻辑 ID 和 `currentIndex` 保持不变，不再次发出业务 `change`，也不再次暂停/播放视频。

重建可能产生 `source` 为空的原生 `change`。它映射到当前同一逻辑页时按上述幂等规则忽略；若映射结果不同，仍必须正常处理。不能笼统忽略所有空 `source`，因为平台的真实变化也可能不提供来源。

### 快速连续手势

原生实例在一次动画完成前继续拥有当前窗口，不在手势中途更换子项。若快速手势最终停在窗口边缘，最后一次有效 `change` 决定逻辑当前页，随后的同代际 `animationfinish` 只围绕该页做一次重建。旧代际晚到的事件通过节点 `data-generation` 校验被忽略，不能修改新窗口。

每次重建后窗口两侧重新提供最多两项，因此用户可以继续向同一方向滑动，直至完整列表的真实边界。前进和后退使用完全对称的映射与重建逻辑。

## 完整列表变化

照片数组变化分为两类：

### 媒体字段更新

照片 ID、顺序和长度不变时，只替换对应逻辑索引的单个对象。当前窗口通过稳定 ID/索引收到该字段变化，但不得重算 `currentIndex`、`windowStart` 或递增 `swiperGeneration`。

### 结构变化

照片被增删或重新排序时：

1. 优先用当前照片稳定 ID 在新列表中恢复逻辑索引。
2. 若该 ID 已不存在，再将原 `currentIndex` clamp 到新范围。
3. 重新计算窗口并只递增一次 `swiperGeneration`。
4. 若列表变空，暂停当前视频并清空窗口。

本阶段不主动引入相册编辑流程，但该规则防止下载/加载状态更新被误判为结构变化。

## 媒体更新和预加载

父页面继续持有完整逻辑数组，但热路径改为定点更新：

- `updatePreviewPhotoDisplayMedia` 先按稳定照片 ID 找到逻辑索引，再通过 `splice` 或等价的单项响应式替换更新该对象。
- 禁止为了更新一个媒体字段对完整 `previewPhotos` 执行 `.map()` 并替换 263 个对象引用。
- `setAlbumMediaProgress` 通过 `this.mediaProgressById[key] = nextEntry` 只响应式替换 `${photoId}:${variant}` 对应的单个进度条目，不再通过对象展开替换整个 `mediaProgressById`。
- 父页面新增 `previewMediaProgress` 计算属性：取 `previewCurrentIndex - 2 ... previewCurrentIndex + 2` 的有效照片 ID，只读取并返回这些 ID 的 `thumbnail`、`preview` 进度条目。模板把该对象传给 `AlbumImageViewer`，不再把全量 `mediaProgressById` 直传。
- 因为计算属性只依赖当前五项对应的 map key，而进度 map 根引用保持稳定，列表观察器或旧请求对窗口外 key 的晚到进度更新不会使 `previewMediaProgress` 失效，也不会改变传给预览器的 prop。
- 展示图请求、下载进度和预加载只覆盖当前逻辑项及前后两项；离开窗口的请求不再驱动可见预览进度更新。
- 同一照片的晚到结果仍按稳定 ID 合并；它不得改变当前索引或触发窗口重建。

完整数组仍可在每次打开预览时构建一次。优化目标是消除每个媒体事件上的全量重建，不是把父页面业务数据也改成窗口数据。

## 图片、视频与现有接口

- 模板 `v-for` 改为遍历 `windowPhotos`，key 使用稳定照片 ID，不使用物理索引。
- 图片点击、加载失败、重试、下载等事件先从窗口条目取得 `logicalIndex`，再传回完整照片对象。
- `isActiveVideo`、`pauseVideoAt` 和当前视频请求都使用逻辑索引。
- 视频元素 ID 继续由稳定照片 ID 生成，索引回退值也使用逻辑索引而非物理索引；窗口重建后同一逻辑照片仍被识别为同一媒体。
- 只有窗口内项目挂载媒体节点，且只有当前逻辑页的视频处于活动状态。
- 页码显示继续使用 `currentIndex + 1` 和完整 `photos.length`。
- 关闭按钮、下滑关闭、下载按钮及其对外事件名称和 payload 保持不变。

## 异常与竞态处理

1. 窗口只在 `animationfinish` 后重建；不以固定延时猜测原生动画何时完成。
2. 没有收到 `animationfinish` 时维持当前有效页面和窗口，不用补偿定时器强行重建。后续真实事件仍可重新评估 pending 状态。
3. 组件关闭、照片结构变化或 generation 改变时清除旧 `pendingWindowRebase`。
4. 旧 generation 的 `change`、`animationfinish`、媒体完成回调不能覆盖新 generation 的索引状态。
5. 重建产生的同逻辑页空来源事件不发业务 `change`；映射结果不同的事件仍按正常变化处理并进入诊断。
6. 第一阶段原则继续有效：原生观察状态不持续回写程序化 `current` 命令。

## 测试设计

### 行为回归

迁移并扩展 `scripts/d31-album-viewer-sequence-check.js`，以组件方法和事件序列验证。现有测试把 `event.detail.current` 当成完整列表索引；窗口化后必须把这些序列改为“窗口物理 `change` + 必要的 `animationfinish`”，不能在旧全局索引断言后简单叠加新检查。第一阶段的单向所有权契约仍保留，但其命令值改为窗口内物理索引。

1. 列表长度为 0、1、2、5、263 时，`windowPhotos.length <= 5`。
2. 打开逻辑索引 0、131、262 时，窗口起点、物理索引和显示计数正确。
3. 本代际 `change` 能把物理索引精确映射为逻辑索引，并只发一次业务 `change`。
4. 到窗口边缘前不重建；边缘 `change` 后仍不重建；匹配的 `animationfinish` 才重建。
5. 重建前后活动逻辑照片不变，`swiperGeneration` 只增加一次，重建产生的同页事件不重复 emit。
6. 模拟从第 1 项逐项前进到第 263 项，再逐项后退到第 1 项；不得跳项、重复或越界。
7. 第一项和最后一项不会产生循环或无意义重建。
8. 单项媒体 hydration 不改变 `currentIndex`、`windowStart`、`activeWindowIndex`、`swiperIndex` 或 generation。
9. 快速 change 序列与旧 generation 晚到事件不能覆盖最终逻辑页。
10. 图片/视频混排时只激活当前逻辑页视频，窗口重建后视频事件仍指向同一完整照片。
11. 预览可见时动态修改 `initialIndex`，只重建一次并定位到正确逻辑页和物理页，随后预加载新的 ±2 范围；该程序化定位不伪造用户 `change`。
12. 完整列表按稳定 ID 重排时恢复同一当前照片；当前照片被删除时按旧逻辑位置 clamp；列表变空时清空窗口并暂停视频。每种结构变化都至多递增一次 generation。
13. `ensurePreviewMediaAround` 在开头、中间、末尾分别精确选择有效的当前 ±2 项，不遗漏、不越界。
14. 使用真实 Vue 响应式 `computed`/effect 或组件挂载验证 `previewMediaProgress` 只包含当前 ±2 照片的进度 key；更新窗口外 key 后 computed 不失效、传给 viewer 的对象引用和内容均保持不变，更新窗口内 key 后只改变对应条目。
15. 父页面收到的 `change.index`、当前照片和预加载中心始终是逻辑索引，不泄漏物理索引。

### 静态契约

迁移 `scripts/check-miniprogram.js` 中与旧索引模型冲突的断言，再加入窗口契约：旧检查不得继续要求 `syncInitialIndex()` 把完整逻辑 `nextIndex` 直接写给 `swiperIndex`，也不得继续把模板 `v-for` 的物理 `index` 直接传给 `isActiveVideo(index)`。对应断言改为要求窗口物理命令和显式逻辑索引。随后检查：

- 模板必须遍历窗口数据，不能直接对完整 `photos` 生成 `swiper-item`。
- 窗口切片上限必须为 5。
- `change` 处理器不得重建窗口或把观察索引直接写回受控命令。
- 重建必须位于 `animationfinish` 路径，并使用 generation key 和节点 generation 校验。
- 父页面单项媒体更新不得通过 `.map()` 替换完整 `previewPhotos`。
- 单项进度更新不得替换整个 `mediaProgressById` 根对象。
- `AlbumImageViewer` 必须接收过滤后的 `previewMediaProgress`，不能接收全量进度 map。

### 既有验证

1. `node scripts/d31-album-viewer-sequence-check.js`
2. `node scripts/check-miniprogram.js`
3. `node scripts/d42-miniprogram-album-video-check.js`
4. `npm run build:mp-weixin`

### 真实运行时验收

在真实 `[冯厚敦·流芳] 相册`的 263 项预览中：

1. 向前快速连续滑动 20 次，松手后在约 1 秒、10 秒、30 秒各截图一次；三次页码和主体照片必须一致。
2. 向后快速连续滑动 20 次，重复相同的三时点验收。
3. 两轮均不得出现相邻页自动往返、松手数秒后继续换页、黑屏或手势锁死。
4. 抽查窗口重建前后的图片到图片；若附近有视频，再验证图片到视频和视频到图片。
5. 验证关闭、下滑关闭、下载和单项加载失败后继续滑动。
6. 记录开发者工具中的长任务/消息处理警告，与第一阶段基线比较；行为稳定是硬性条件，警告数量下降作为性能证据记录。

## 实施边界与提交策略

第二阶段应保持测试先行，并拆为可审查的步骤：先建立窗口数学与事件序列的失败检查，再实现组件窗口；随后改父页面定点媒体更新，最后执行构建和真实运行时验收。不得在同一阶段顺带修改相册产品功能。

第一阶段提交 `ab822876` 保持为独立安全基线。若窗口化在目标平台出现不可接受的新行为，可以回退第二阶段实现提交，继续保留已经验证的反馈环修复。

## 验收结论标准

只有同时满足以下条件才可声明第二阶段完成：

1. 自动化证明最多 5 个已渲染 slide，并能无遗漏遍历完整 263 项。
2. 既有小程序、混合媒体检查和生产构建全部通过。
3. 真实相册正反两个方向的 1/10/30 秒页码均稳定。
4. 下载、关闭、下滑关闭、加载失败恢复和附近视频没有回归。
5. 工作树只包含设计批准范围内的必要改动，且可独立回退到第一阶段基线。
