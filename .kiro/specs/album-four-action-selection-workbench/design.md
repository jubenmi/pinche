# 相册四操作与批量选择工作台设计

## 1. 结论

采用最小界面重组和显式选择状态机：

- 普通状态使用一行四个等宽双字按钮：`分享`、`下载`、`标注`、`招募`。
- 分享和下载点击后直接进入相册现有多选表面，不再先选“全部 / 多选”。
- 分享多选底部提供 `分享全部` 与 `分享选中`。
- 下载多选底部提供 `下载全部` 与 `下载选中`。
- 标注直接复用现有批量标注。
- 招募直接进入现有角色邀请页。

分享仍需要先异步生成公开快照。为了符合微信小程序不能在异步请求完成后自动唤起系统分享面板的限制，快照完成后显示轻量分享就绪层；该层不展示媒体内容，因此不是预览页。

## 2. 当前实现与变化边界

主要页面是 `apps/miniprogram/src/pages/session/album.vue`。它已经具备：

- 上传与隐私双按钮。
- `全部下载`、`多选下载`、`批量标注`。
- `selectionMode`、`selectionModePurpose` 和 `selectedPhotoIds`。
- `downloadAllPhotos()`、`downloadSelectedPhotos()` 和现有批量标注流程。
- 相册公开分享 token、微信好友 / 群聊分享、朋友圈分享和单媒体分享。
- `album-floating-toolbar` 批量操作栏。

后端已经具备：

- `POST /api/sessions/:id/album/share-token`。
- `session_album_public_shares` 固定快照。
- 媒体公开资格、隐私、审核和作者私有内容门禁。
- 独立 `join-invite-token` 角色招募凭证。

本设计只重组入口、扩展选择用途、增加显式分享范围，并取消公开快照的 30 项产品上限。公开资格函数、公开页面、标注保存、下载保存和角色认领状态机保持不变。

## 3. 普通状态布局

### 3.1 顶部

继续保留：

- 相册标题与上传图标。
- `隐私` 按钮。
- 全部 / 上传 / 我的 / 待标筛选。
- 角色筛选。

标题中的向上箭头仍表示上传，不再承担相册分享语义。

### 3.2 四操作区

替换现有 `album-action-groups` 内容为四列等宽布局：

| 顺序 | 文案 | 图标语义 | 样式 | 点击结果 |
|---|---|---|---|---|
| 1 | 分享 | 三节点连接 | 描边 | 进入分享选择模式 |
| 2 | 下载 | 向下下载 | 描边 | 进入下载选择模式 |
| 3 | 标注 | 标签 | 墨绿实心 | 进入标注选择模式 |
| 4 | 招募 | 人物加号 | 描边 | 进入角色邀请页 |

实现优先复用现有静态图标或 TDesign 图标资产。不得用上传图标代替分享，不在页面内手绘临时 SVG。

按钮使用统一的：

- 四列 `grid` 或等价 flex 布局。
- 52rpx 现有紧凑高度。
- 相同横向 padding、图标尺寸和 8rpx 左右图文间距。
- 小屏下不换行；文案固定为两个汉字。

`标注` 延续当前绿色强调，是因为它是相册内部整理的主操作；分享、下载和招募都是离开或输出当前内容的次操作。

## 4. 选择状态机

### 4.1 状态

保留并扩展页面状态：

```js
selectionMode: false
selectionModePurpose: "tag" // "share" | "download" | "tag"
selectedPhotoIds: []
```

增加分享准备状态：

```js
albumSharePreparing: false
albumShareReadyVisible: false
activeAlbumShareScope: "" // "all" | "selected"
activeAlbumShareToken: ""
activeAlbumShareCount: 0
```

现有 `albumShareToken` 可以继续作为实际活动 token；新增字段只在需要区分准备状态和来源时使用，避免保存第二份互相竞争的 token。

### 4.2 进入模式

统一入口边界：

```text
openShareSelectionMode()
openDownloadSelectionMode()
openTagSelectionMode()
```

每个入口都先执行：

1. 检查 `timelineMode`、`albumBusy` 和对应候选集合。
2. 关闭单图预览与标签面板。
3. 清理上一个选择用途的 ID。
4. 设置 `selectionMode = true`。
5. 设置准确的 `selectionModePurpose`。
6. 隐藏四操作区和悬浮顶部操作。

`招募` 不进入该状态机，直接执行导航。

### 4.3 退出模式

`cancelSelectionMode()` 统一完成：

1. 清空 `selectedPhotoIds`。
2. 关闭选择和标签面板。
3. 把 `selectionModePurpose` 恢复为默认 `"tag"`。
4. 恢复四操作区与滚动悬浮行为。

页面隐藏、认证用户变化和公开只读入口也调用同一清理边界。

### 4.4 筛选与选择

普通状态切换筛选继续刷新瀑布流。

选择状态下：

- `share` 和 `download` 切换内容筛选或角色筛选时保留 `selectionMode` 与 `selectedPhotoIds`。
- 当前筛选只决定屏幕上显示哪些媒体，不决定已经选择的集合。
- `tag` 保持现有行为；若当前实现切换筛选会退出标注模式，本 spec 不强制改变。
- 取消选择或完成操作时一次性清理全部 ID。

`downloadSelectedPhotos()` 必须从完整 `downloadablePhotos` 解析 ID，不能继续从 `filteredDownloadablePhotos` 解析，否则跨筛选选择会丢失。

## 5. 候选集合

### 5.1 分享候选

客户端建立 `shareSelectableMedia`，只用于即时选择反馈：

- 当前完整相册中已发布的图片。
- 已发布、审核通过且处理状态为 `ready` 的视频。
- 本地已知为作者私有、审核中、被拒绝、处理中或删除的媒体不可选。

客户端候选不是权限来源。服务端仍使用现有统一公开资格计算最终集合。

### 5.2 下载候选

继续使用 `downloadablePhotos`：

- 仅图片。
- 已发布且审核通过。
- 当前用户有权下载。
- 具有可用下载或展示 URL。

视频始终不可选。

### 5.3 标注候选

继续使用 `taggablePhotos` 和 `photo.can_tag`，不扩展权限。

## 6. 底部批量操作栏

### 6.1 结构

继续复用 `root-portal` 和 `album-floating-toolbar`，内部调整为两层：

第一层是状态行：

- 左侧：`已选 N 项` 或下载场景的 `已选 N 张`。
- 右侧：文字操作 `取消`。

第二层是业务按钮行。分享和下载模式下必须恰好两个业务按钮，不把取消算作第三个业务按钮。

### 6.2 分享模式

```text
[ 分享全部（A） ] [ 分享选中（N） ]
```

- 左侧为描边次按钮。
- 右侧为墨绿主按钮。
- `N = 0` 时右侧禁用。
- `A` 是客户端当前已知候选数量，仅用于反馈。
- 两个动作提交后都以服务端返回的 `visible_count` 为准。

### 6.3 下载模式

```text
[ 下载全部（A） ] [ 下载选中（N） ]
```

样式和禁用规则与分享一致。`A` 来自完整 `downloadablePhotos`，不是当前筛选数量。

### 6.4 标注模式

标注模式继续显示已选数量、取消和现有 `批量标注` 主操作。本 spec 不要求把标注底栏强行改成两按钮。

## 7. 分享流程

### 7.1 分享全部

`shareAllAlbumMedia()`：

1. 保持当前勾选不参与请求。
2. 提交 `{ scope: "all" }`。
3. 服务端读取该车局全部当前媒体、标签和相关隐私。
4. 使用现有统一公开资格函数过滤。
5. 不应用 30 项或 3 个视频的产品数量裁剪。
6. 按现有稳定相册时间顺序写入完整媒体 ID 集合。
7. 封面候选仍最多选择 9 项。
8. 创建或复用完全相同的活动快照。

“全部”是服务端提交时语义。客户端显示 18 项但提交期间新增、撤回或收紧隐私时，返回 17 或 19 项都是有效的最新结果，最终就绪层展示服务端数量。

### 7.2 分享选中

`shareSelectedAlbumMedia()`：

1. 读取 `selectedPhotoIds`，空集合不提交。
2. 提交 `{ mediaIds: [...] }`。
3. 服务端将请求视为精确集合，不自动补齐。
4. 服务端验证数组非空、ID 为唯一正整数、媒体属于当前车局且全部符合公开资格。
5. 任一 ID 失效时返回 `ALBUM_PUBLIC_SHARE_SELECTION_INVALID`，请求整体失败。
6. 成功集合按相册稳定时间顺序写入快照，不按点击顺序展示。

多选没有产品级数量上限。安全边界来自：

- API 全局请求体大小。
- 数组长度不得大于该车局实际媒体数量。
- 每个 ID 必须唯一并逐项通过资格校验。
- 数据库 JSON 字段和摘要计算使用完整规范化集合。

### 7.3 API 形状

扩展：

```http
POST /api/sessions/:id/album/share-token
```

新客户端请求：

```json
{ "scope": "all" }
```

或：

```json
{ "mediaIds": [101, 102, 108] }
```

保留：

```json
{ "focusMediaId": 101 }
```

输入互斥：

- `scope === "all"` 时不能同时传 `mediaIds` 或 `focusMediaId`。
- `mediaIds` 存在时不能传 `scope` 或 `focusMediaId`。
- `focusMediaId` 存在时不能传其他范围字段。
- 全部缺失时继续走旧客户端兼容默认范围；新四按钮流程不使用省略范围的请求。

服务入口调整为：

```text
createOrReuseSessionAlbumPublicShare(
  user,
  sessionId,
  { scope, mediaIds, focusMediaId }
)
```

### 7.4 快照与封面

`session_album_public_shares.media_ids` 继续保存 JSON 数组，不新增明细表。设计原因：

- 当前相册规模和 API 请求体本身有界。
- 读取链路已经使用固定 JSON 快照。
- 本次目标是移除产品级 30 项裁剪，不是重构快照存储。

需要把 `normalizePublicShareSnapshotIds` 从固定 `max: 30` 改为按调用场景校验：

- `media_ids`：无产品级 30 项上限，但要满足安全数组和请求 / 相册规模约束。
- `cover_media_ids`：继续 `max: 9`，且必须是 `media_ids` 子集。

摘要覆盖完整规范化 `media_ids` 和 `cover_media_ids`。有效且摘要相同的快照继续复用。

### 7.5 分享就绪层

生成 token 和安全封面是异步操作，微信不允许完成异步请求后由代码直接拉起系统分享面板。因此成功后：

1. 退出选择模式。
2. 保存活动 token、封面和服务端计数。
3. 开启 `shareAppMessage` 和 `shareTimeline` 菜单。
4. 显示轻量底部就绪层：
   - `已准备分享 N 项`
   - `发送给好友或群聊`，使用微信原生 `open-type="share"`。
   - `朋友圈请使用右上角“…”分享`。
   - 关闭入口。

就绪层不渲染媒体缩略图、不允许调整选择，因此不属于预览页。

`onShareAppMessage({ from: "menu" })`、就绪层原生按钮和 `onShareTimeline()` 都读取同一个活动快照。没有活动快照时隐藏原生菜单并返回关闭式失败载荷。

### 7.6 公开读取

公开相册继续：

- 匿名只读。
- 只读取快照内当前仍有效媒体。
- 每次读取重新检查审核、删除和隐私。
- 隐藏上传、下载、标注、隐私、招募和上车动作。
- token 过期、撤销或用途错误时不回退完整相册。

## 8. 下载流程

### 8.1 下载全部

`downloadAllPhotos()` 继续使用完整 `downloadablePhotos`：

1. 显示 `确认下载`，内容包含完整数量。
2. 请求系统相册权限。
3. 按现有顺序逐张保存。
4. 显示 `正在保存 X/Y 张照片...`。
5. 全部成功、部分成功和全部失败使用现有反馈。
6. 完成后退出下载选择模式。

### 8.2 下载选中

`downloadSelectedPhotos()`：

1. 使用完整 `downloadablePhotos` 与 `selectedPhotoIds` 求交集。
2. 不使用 `filteredDownloadablePhotos`。
3. 空集合不提交。
4. 显示包含选择数量的确认提示。
5. 继续复用 `downloadPhotos(photos, { exitSelection: true })`。

过滤切换时保留选择可以让用户按角色分批勾选，再一次下载。

## 9. 标注流程

只调整普通状态入口文案和图标：

- `批量标注` 改为 `标注`。
- 入口继续调用 `openTagSelectionMode()`。
- 候选、人物选择、保存、错误反馈和退出逻辑不变。
- 底部仍可显示完整动作名称，避免“标注”在提交阶段含义不清。

## 10. 招募流程

`openRecruitment()` 直接导航：

```text
/pages/session/share?id={sessionId}
```

不传新的 `entry=album`。该历史参数只保留旧链接解析。

分享页继续：

- 页面标题“邀请好友认领角色”。
- 请求 `POST /api/sessions/:id/join-invite-token`。
- 只注册 `shareAppMessage`。
- 使用安全票根 / 车局封面。
- 接收者按 direct 或 review_required 完成资料补全和角色认领。

相册公开 token 与邀请 token 的 purpose、路由和权限继续严格隔离。

## 11. 错误和恢复

### 分享

- 无候选：`暂无可分享内容`。
- 选中为空：主按钮禁用。
- 选择包含失效项：保留选择并提示 `部分内容状态已变化，请重新选择`。
- 全部分享提交时为空：退出 busy，保留选择模式并提示公开条件。
- 封面准备失败：不开放原生菜单，允许重试。
- token 失效或账号切换：清理活动快照和就绪层。

### 下载

- 无候选：`暂无可下载照片`。
- 选中为空：主按钮禁用。
- 权限拒绝：沿用 `未获得保存权限`。
- 部分失败：沿用 `部分照片保存失败`。

### 标注与招募

- 标注无候选：`暂无可标注照片`。
- 招募无角色或车局关闭加入：由分享页展示实时不可用状态。

## 12. 文件边界

预计修改：

- `apps/miniprogram/src/pages/session/album.vue`
  - 四操作区、选择状态机、分享 / 下载底栏、分享就绪层和招募入口。
- `apps/miniprogram/src/static/icons/`
  - 仅当现有资产没有合适的深色分享、标签或人物加号图标时补充与现有体系一致的正式图标。
- `apps/api/src/server.js`
  - 解析 `scope` 和 `mediaIds`。
- `apps/api/src/modules/core/service.js`
  - 显式范围、精确选择、全部范围、无 30 项裁剪和完整摘要。
- `apps/api/test/album-share-selection.test.mjs`
  - 纯函数和输入契约。
- `scripts/d53-album-four-action-selection-check.js`
  - 小程序与 API 静态契约。
- `scripts/d53-album-four-action-selection-smoke.js`
  - 数据库集成和权限回归。
- `package.json`
  - 增加专项检查命令并纳入主检查。

不新增数据库迁移，不新增全局 UI 组件，不拆分 `album.vue` 的无关代码。

## 13. 测试策略

### 静态契约

- 四个双字按钮、顺序、图标和样式存在。
- 旧顶部按钮文案和直接全部下载入口消失。
- 分享 / 下载入口直接设置对应 `selectionModePurpose`。
- 分享和下载底部各有两个业务按钮。
- 招募不传 `entry=album`。
- 右上角菜单没有活动快照时关闭式失败。

### API 单元

- `scope: "all"`、`mediaIds`、`focusMediaId` 互斥。
- `mediaIds` 拒绝空、重复、非整数、跨车局和不可公开媒体。
- 超过 30 个合法 ID 可以成功规范化和生成摘要。
- 封面仍拒绝超过 9 项或快照外 ID。
- 相同完整集合摘要稳定，不同集合摘要不同。

### 数据库 smoke

- 全部分享返回全部符合资格内容，覆盖 31 项以上场景。
- 任意数量选中精确落入快照。
- 任一选择失效时整体失败。
- 隐私、审核、作者私有内容和跨车局 ID 继续关闭式拒绝。
- 公开读取只返回快照交集。
- 招募 token 和相册 token 互不越权。

### 小程序与人工验收

- 四按钮在目标小屏宽度下不换行、不溢出。
- 分享 / 下载跨筛选保留选择。
- 分享全部和下载全部不受当前筛选影响。
- 分享就绪层无媒体预览，好友 / 群聊和朋友圈使用同一快照。
- 下载确认、权限、进度和部分失败正常。
- 标注与招募没有回归。

## 14. 风险控制

- **大量 ID 请求**：不设产品上限，但继续使用全局 body 限制、车局实际媒体数量和逐项资格校验。
- **快照 JSON 变大**：仍受单车局媒体规模约束；专项 smoke 覆盖 31 项以上和较大集合摘要。
- **微信无法异步拉起分享**：使用无预览的分享就绪层，不伪造自动分享。
- **跨筛选丢选择**：分享 / 下载不再由筛选 watcher 重置，提交从完整候选集合解析。
- **相册分享与招募混淆**：入口、token、页面和朋友圈能力继续分流。
- **单媒体分享回归**：保留 `focusMediaId` 和独立 authority，不让批量活动快照覆盖单媒体状态。
