# D56 设计：相册操作栏与分享入口重映射

## 1. 设计结论

采用“统一分享意图路由 + 两类后台预热 + 单一 Canvas 协调器”：

```text
成员相册有效数据
  ├─ 后台预热 join-invite-token ─→ 招募按钮直接微信分享 ─→ /pages/session/share
  └─ 后台预热 album token(scope=all)
       └─ D55 本地预览优先 Canvas
            ├─ 好友封面 ─→ 右上角发送给朋友
            └─ 朋友圈封面 ─→ 右上角分享到朋友圈

页面“分享”工作台
  ├─ 分享全部 ─→ active 全部快照 ─→ 页面原生分享按钮
  └─ 分享选中 ─→ active 选中快照 ─→ 页面原生分享按钮
```

右上角默认全部快照与页面 active 快照并存。分享回调不再通过“当前是否恰好有某个 token”猜测意图，而是先解析来源，再读取该来源唯一允许的状态。

## 2. 操作栏

顶部第一排继续使用两列 grid：

```text
┌──────────────────────────────┬────────┐
│ 相册标题 / 上传入口           │   锁   │
└──────────────────────────────┴────────┘
```

- `.album-primary-actions` 改为 `minmax(0, 1fr) 78rpx`；
- `.album-privacy-action` 固定 `78rpx × 78rpx`，保留现有相近的 `12rpx` 圆角，清除水平文字 padding；
- 模板删除可见“隐私”文本，保留 `aria-label="相册隐私"`；
- 锁图标维持 36rpx，点击仍执行 `goPrivacy`。

第二排固定为：

```text
┌──────┬──────┬──────┬──────┐
│ 分享 │ 下载 │ 招募 │ 标注 │
└──────┴──────┴──────┴──────┘
```

“标注”保留绿色样式；只移动 DOM 顺序，不改变 `openTagSelectionMode`。招募按钮保留原图标，但改为按就绪状态动态设置 `open-type="share"`。

## 3. 分享意图路由

新增 `apps/miniprogram/src/utils/albumShareEntry.js`，只处理可单测的来源解析与邀请卡片构造：

```js
export const ALBUM_SHARE_INTENT = Object.freeze({
  RECRUIT: "recruit",
  ACTIVE: "active",
  SINGLE: "single",
  DEFAULT_ALL: "default_all",
  PUBLIC: "public",
  UNKNOWN: "unknown"
});

export function albumShareAppMessageIntent(options = {}, { timelineMode = false } = {}) {
  const dataset = options?.target?.dataset || {};
  if (options?.from === "button" && dataset.albumShare === "recruit") {
    return { kind: ALBUM_SHARE_INTENT.RECRUIT };
  }
  if (options?.from === "button" && dataset.albumShare === "active") {
    return { kind: ALBUM_SHARE_INTENT.ACTIVE };
  }
  if (options?.from === "button" && normalizeFocusedMediaId(dataset.mediaId)) {
    return {
      kind: ALBUM_SHARE_INTENT.SINGLE,
      mediaId: normalizeFocusedMediaId(dataset.mediaId)
    };
  }
  if (options?.from === "button") {
    return { kind: ALBUM_SHARE_INTENT.UNKNOWN };
  }
  return {
    kind: timelineMode
      ? ALBUM_SHARE_INTENT.PUBLIC
      : ALBUM_SHARE_INTENT.DEFAULT_ALL
  };
}
```

`recruitmentSharePayload` 只在 `sessionId`、`inviteToken` 和标题都合法时返回：

```js
{
  title: "剧本｜店家｜时间",
  path: "/pages/session/share?id=123&shareCode=s123-...&inviteToken=...&source=wechat_share",
  imageUrl: "/static/art/ticket-landscape.jpg"
}
```

参数使用 `queryString` 或等价的逐字段编码；token、标题或 session 缺失时返回 `null`，调用页使用 fail-closed payload。

### 3.1 来源矩阵

| 来源 | 识别方式 | 唯一允许的数据 |
| --- | --- | --- |
| 招募按钮 | `from=button`, `data-album-share=recruit` | `recruitInviteToken` |
| 页面分享按钮 | `from=button`, `data-album-share=active` | `activeAlbumShare*` |
| 单张照片按钮 | `from=button`, `data-media-id` | `singleMediaShareAuthority` |
| 成员页右上角 | 非 button 且非 timeline mode | `defaultAlbumShare*` |
| 公开页右上角 | timeline mode | 路由 `albumShareToken` 与现有公开封面 |

优先级固定为招募 → active → 单张 → 未知按钮关闭 → 菜单默认。招募 dataset 不得被单张 media dataset 抢占，未知 button 不得回落到菜单默认。

## 4. 状态边界

### 4.1 默认全部分享

在 `album.vue` 新增独立状态：

```js
defaultAlbumShareToken: "",
defaultAlbumShareFriendCoverUrl: "",
defaultAlbumShareTimelineCoverUrl: "",
defaultAlbumShareFriendCoverPrepared: false,
defaultAlbumShareTimelineCoverPrepared: false,
defaultAlbumShareSubject: null,
defaultAlbumShareCounts: { total: 0, photos: 0, videos: 0 },
defaultAlbumShareGeneration: 0,
defaultAlbumSharePromise: null
```

它不复用 `activeAlbumShare*`。`prepareDefaultAlbumShare()`：

1. 读取当前 `sessionId + currentUserId + mediaLoadSerial`；
2. 相同 key 已就绪或在途时直接复用；
3. `POST /api/sessions/:id/album/share-token`，body 固定 `{ scope: "all" }`；
4. 在写状态前再次校验 session、身份和 generation；
5. 从当前 `visiblePhotoMedia` 快照 recipe 对应的最多 3 个本地路径；
6. 通过 Canvas 协调器依次准备好友和朋友圈封面；
7. 每个渠道独立就绪并刷新右上角菜单，不显示 active 分享完成弹层。

### 4.2 招募分享

新增：

```js
recruitInviteToken: "",
recruitInviteGeneration: 0,
recruitInvitePromise: null
```

`prepareRecruitInvite()` 对相同 session/身份去重请求现有 join invite token。按钮：

```vue
<t-button
  :open-type="recruitInviteToken ? 'share' : ''"
  data-album-share="recruit"
  @tap="handleRecruitShareTap"
>
```

token 未就绪时 `handleRecruitShareTap` 只发起/复用准备并提示，不导航、不产生缺授权分享。

## 5. Canvas 协调

D55 当前 Canvas preparation 只允许一个 current request，且切换 context 会释放缓存。D56 必须保留默认全部和 active 两套已导出路径，因此在 `albumShareEntry.js` 新增 `createAlbumShareEntryCoordinator`：

- 所有使用页面 Canvas 的渲染进入同一串行队列，避免相同 hidden canvas 被两个上下文同时清空和绘制；
- 底层 `createAlbumShareCanvasPreparation` 在页面会话内保持一个实例，缓存键继续包含 token、recipe digest、channel 和标题；
- 从 default 切换到 active 不调用 `dispose()`，因此已完成的 default 临时路径仍有效；
- active 完成后，如果 default 在排队期间失效，则按最新 key 重新预热；
- 只有身份/session 失效、页面 hide/unload 或显式总清理才 dispose 并释放所有临时文件；
- generation 和 request authority 负责丢弃迟到结果，缓存命中不绕过当前性检查。

这避免增加第二对 1000px Canvas 节点和额外 RGBA 内存，也避免 active 分享破坏右上角默认封面。

## 6. 生命周期与菜单

### 6.1 启动

成员 `loadAlbum()` 成功应用当前响应后，非阻塞启动：

```js
this.primeAlbumShareEntries();
```

它并行启动 token 请求，但 Canvas 渲染由协调器串行执行。页面首屏、筛选和瀑布流不等待预热。

### 6.2 菜单

`showShareMenus()` 继续先隐藏所有菜单，再按来源显示：

- timeline mode：沿用当前公开 token 与公开封面；
- member mode：
  - `shareAppMessage` 仅在 default friend cover 就绪时显示；
  - `shareTimeline` 仅在 default timeline cover 就绪时显示；
  - selection mode 期间继续隐藏右上角分享菜单。

页面 active 分享按钮通过自己的 `open-type="share"` 触发，不把 active token安装为右上角默认值。

`onShareTimeline()` 在成员页只读取 default 状态；公开页仍读取路由 token。它不得读取 active token。

### 6.3 失效

以下事件使 default 与 recruit generation 增加并清空其状态：

- session 或当前身份变化；
- `loadAlbum()` 应用新的语义媒体版本；
- 上传、删除、标注完成后触发的新相册加载；
- 权限刷新返回 401/403；
- hide/unload。

过滤器、滚动、预览开关、公开分页和只更新签名 URL 不改变语义 key。`onShow` 在当前 member 数据存在但预热状态为空时重试。

## 7. 失败与降级

- 默认全部 token 请求失败：静默记录安全事件，保持右上角对应菜单隐藏；`onShow` 或下一次有效刷新重试；
- 默认 Canvas 单渠道失败：沿用 D55 该渠道本地静态图，并把该渠道标记为可分享；另一渠道不受影响；
- 招募 token 失败：按钮保持非 share 状态，点击触发去重重试与短提示；
- active/单张/公开分享失败：保持现有行为；
- 任何来源缺少自己的 token：返回 fail-closed payload，绝不借用另一来源的 token；
- 后台任务不得写 `statusText`、`albumShareReadyVisible` 或 `albumBusy`。

## 8. 文件职责

### 新增

- `apps/miniprogram/src/utils/albumShareEntry.js`
  - 分享来源解析；
  - 招募 payload；
  - default/recruit generation authority；
  - Canvas 串行协调器的纯状态部分。
- `apps/miniprogram/test/albumShareEntry.test.mjs`
  - 纯函数、状态并发和页面静态集成测试。
- `scripts/d56-album-share-entry-remap-check.js`
  - D56 结构门禁。

### 修改

- `apps/miniprogram/src/pages/session/album.vue`
  - 工具栏模板与样式；
  - default/recruit 状态与预热；
  - 分享回调路由；
  - 菜单与生命周期。
- `apps/miniprogram/src/utils/albumShareCover.js`
  - 仅在协调器需要复用现有封面当前性判断时做最小扩展。
- `apps/miniprogram/test/albumSharePreview.test.mjs`
  - 保留 D53/D54 行为并补 default 与 active 隔离断言。
- `package.json`
  - 新增 `d56:unit`、`d56:check`，在 `postcheck` 中接到 D55 后。

不修改 API、数据库、公开 recipe 或服务器图片处理代码。

## 9. 包体积预算

当前已发布主包为 1,570,813 / 1,572,864 bytes，只有 2,051 bytes 余量。D56 不提高限制，按以下固定顺序控制：

1. 删除被替代的 `openRecruitment` 导航、重复 menu 分支和可合并的页面内分享判断；
2. `albumShareEntry.js` 只保留纯路由、authority 和队列，不复制 D55 payload、recipe 或 Canvas 几何代码；
3. 构建后立即执行主包检查；
4. 若仍超限，只重新编码 D55 已使用的两张本地分享降级 JPEG，保持现有尺寸、两渠道不同文件与视觉内容，不删除降级能力；
5. 再次运行 D55/D56 与包体积门禁，禁止修改阈值。

## 10. 测试策略

### 10.1 单元测试

1. 分享意图优先级、公开模式和未知 button fail closed；
2. 招募路径完整编码、缺 token 返回 null、时间注入稳定；
3. default/recruit 同 key 去重，身份/session/generation 变化关闭迟到结果；
4. Canvas 协调器严格串行、保留不同 token 的缓存路径，只在总清理时释放；
5. 右上角 default 与 active 分享状态互不覆盖。

### 10.2 页面结构测试

1. 隐私按钮无可见文字、78rpx 方形、有无障碍名称；
2. DOM 顺序为分享、下载、招募、标注；
3. 招募使用动态 `open-type=share` 和明确 dataset；
4. `onShareAppMessage` 按来源分流；
5. 成员 `onShareTimeline` 只读 default；公开页仍读路由 token；
6. `loadAlbum` 后静默预热，hide/unload/auth change 清理；
7. 页面 active 分享仍支持全部和选中。

### 10.3 回归与门禁

```bash
npm run d53:unit
npm run d54:unit
npm run d55:unit
npm run d56:unit
npm run d56:check
npm run build:mp-weixin
node scripts/check-miniprogram.js
npm run check
```

D56 静态门禁还要拒绝：

- 招募仍调用 `navigateTo("/pages/session/share")`；
- 成员右上角回退读取 `activeAlbumShareToken`；
- 后台预热写入全局 busy/ready 弹层；
- 新增服务器封面合成、API 或迁移文件。
