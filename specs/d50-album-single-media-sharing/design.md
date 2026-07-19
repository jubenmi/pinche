# D50 Design：相册单项媒体分享

更新日期：2026-07-19

版本：v1.0

状态：产品、权限与技术方向已确认，实施中

## 1. 设计摘要

D50 采用“一份公开快照、两种展示模式”：成员为当前媒体准备一份保证包含它的 D48 v2 公开快照；分享卡仍进入 `pages/session/album`，但先以 `focusMediaId` 打开只含单项的沉浸态；“查看完整相册”再展示同一 token 已授权的公开快照。

单项模式是展示边界，不是第二套权限范围。因为产品明确允许接收者点击 CTA 查看完整公开快照，token 继续授权该有界快照；`focusMediaId` 只能选择快照内项目，不能扩大授权。

当前公开相册只提供 ready 视频封面，没有匿名播放 URL。D50 新增绑定 v2 快照的短期公开视频 capability，并在应用层按请求复核资格与代理 Range 字节。

## 2. 组件与文件边界

| 单元 | 责任 |
|---|---|
| `apps/api/src/modules/core/service.js` | 有界选择时强制包含目标；公开 ready 视频按 share 快照和隐私授权 |
| `apps/api/src/server.js` | 读取 `focusMediaId`；签发/验证公开视频 capability；实现公开 video-url 与 video-file 路由 |
| `apps/miniprogram/src/utils/albumSingleMediaShare.js` | 纯状态 helper：ID 归一化、请求 authority、缓存写入、当前项投影、单项 DTO 解析、路径组装 |
| `apps/miniprogram/src/components/AlbumImageViewer.vue` | 渲染分享状态、原生 share button、可选隐藏计数和底部 CTA；不请求 API |
| `apps/miniprogram/src/pages/session/album.vue` | 拥有 token、分享缓存、路由模式、页面导航、公开视频 URL 请求和 `onShareAppMessage` |
| `scripts/d50-album-single-media-sharing-check.js` | 锁定 spec、接口、错误码、端侧入口和非目标 |
| D50 tests | 证明强制选择、capability、竞态和单项模式行为 |

不新增表、迁移或页面注册。

## 3. 后端设计

### 3.1 有界选择支持 required media

`selectPublicShareMedia` 增加可选参数：

```js
selectPublicShareMedia(candidates, tagsMap, privacyByUser, claims, {
  requiredMediaId
})
```

算法：

1. 使用 `isAlbumPhotoVisibleInPublicShare` 过滤候选。
2. 按现有 priority、`created_at DESC`、`id DESC` 排序。
3. 若提供 `requiredMediaId`，从过滤后的 ranked 集合中找到目标；找不到返回结构化 unavailable 结果或由调用方抛 409。
4. 先选择目标，再遍历 ranked 中其他项目，直到 30 项。
5. 目标视频先占用一个视频名额，其他视频仍最多补到 3 个。
6. 返回顺序保持选择顺序；最终公开 DTO 仍按 `created_at ASC, id ASC` 输出。

`createOrReuseSessionAlbumPublicShare` 从 `options.focusMediaId` 读取目标并传入 selector。目标不合规时抛：

```js
new AppError(
  409,
  "ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE",
  "The selected album media is not available to share"
)
```

返回对象增加 `focus_media_id`；未提供目标时为 `null`，保持旧调用兼容。

### 3.2 share-token 请求

现有路由解析 JSON body，并只读取：

```json
{ "focusMediaId": 123 }
```

传给 service 后，在 200 响应中返回 `focus_media_id`。普通整册调用继续可以发送空 body。

### 3.3 公开 ready 视频授权

新增 service：

```js
getPublicSessionAlbumVideoForPlayback(claims, mediaId)
```

它镜像现有 public image/video-cover getter，但额外要求：

- v2 claims 含 `shareId`；不为历史 v1 token 增加新播放能力；
- media 为 active video；
- moderation 已发布；
- processing 为 ready；
- `display_url` 存在；
- session 与 claims 一致；
- media ID 属于 share `media_ids`；
- 当前 `isAlbumPhotoVisibleInPublicShare` 仍为 true。

返回内部 media row，只供受控 server responder 使用。

### 3.4 公开 capability

新增路由：

```text
GET /api/session-album/public-share/media/:id/video-url?token=<albumShareToken>
GET|HEAD /api/session-album/public-share/media/:id/video-file?token=<capability>
```

`video-url` 验证 album token 和 service getter，随后签发 purpose `session-album-public-video-file`，claims 为：

```js
{
  version: 2,
  shareId,
  sessionId,
  sharerUserId,
  seatId,
  mediaId,
  shareTokenDigest,
  exp
}
```

`video-file` 验签并再次调用 service getter。响应使用 `private, no-store`。

### 3.5 Range 与 COS 代理

本地文件复用 `createLocalAlbumVideoResponse`/现有 responder 的 200、HEAD、206、416 语义。

COS 公开播放不能使用当前成员播放的 302 redirect，因为 redirect 后无法在后续 Range 请求上复核 share 状态。公开 responder 应：

1. HEAD COS 对象获得 content length/type/etag。
2. 对 HEAD 请求返回无 body 的 200 与 `Accept-Ranges`。
3. 解析客户端单 Range；无 Range 时按 bounded chunks 或完整受控 stream 读取。
4. 使用现有 COS range helper，并把 `If-Match` 绑定 authoritative ETag。
5. 把 200/206/416 与准确 header 写回客户端，不输出 COS URL。
6. 客户端断开时中止上游读取。

## 4. 小程序设计

### 4.1 纯状态 helper

`albumSingleMediaShare.js` 提供可独立测试的函数：

```js
normalizeFocusedMediaId(value) -> number | null
createSingleMediaShareAuthority()
beginSingleMediaShareRequest(state, mediaId)
resolveSingleMediaShareRequest(state, request, entry)
rejectSingleMediaShareRequest(state, request, error)
singleMediaShareEntryFor(state, mediaId)
focusedPublicMedia(photos, focusMediaId) -> photo | null
singleMediaSharePath({ sessionId, token, mediaId }) -> string
```

缓存键始终是规范化媒体 ID。authority 保证乱序响应只能写入自己的 key，当前 UI 只投影当前 ID 的 entry。

### 4.2 发送方 viewer

`AlbumImageViewer` 增加最小 props：

```js
shareStatus: "hidden" | "loading" | "ready" | "blocked" | "failed"
showCounter: Boolean
primaryActionLabel: String
```

当前项 ready 时渲染：

```html
<button
  open-type="share"
  :data-media-id="currentPhoto.id"
  @tap.stop
>分享</button>
```

非 ready 状态渲染普通 view，点击 emit `share-status-tap`，由 page 显示提示。底部 CTA emit `primary-action`。组件不持有 token 或 API。

### 4.3 页面分享缓存

成员打开预览或发生 change 时调用 `prepareSingleMediaShare(photo)`：

1. 校验当前是成员模式且媒体已发布、视频 ready。
2. 复用 ready cache；否则 POST share-token，body 为 `{ focusMediaId: photo.id }`。
3. 校验响应 `focus_media_id` 与请求 ID 相同。
4. 为图片准备当前 preview/thumbnail 本地 share image；视频准备 approved cover；失败时使用安全整册封面或票根图。
5. 把 `{ status, token, imageUrl, title, mediaId }` 写入对应 ID。
6. 只有当前 preview ID 的 entry 控制当前按钮。

`onShareAppMessage(options)` 在 `options.from === "button"` 时读取 `options.target.dataset.mediaId` 并返回同 ID cache 的 title/path/imageUrl。普通页面菜单继续返回现有整册分享。

### 4.4 接收方 focused mode

`onLoad` 解析：

```js
singleMediaShareMode = source === "single_media_share"
focusMediaId = normalizeFocusedMediaId(options.focusMediaId)
```

公开列表加载后：

- 若 token 无效，沿用整册不可访问错误并隐藏 CTA。
- 若 focus ID 无效或不在 `photos`，设置 focused unavailable，不打开 viewer。
- 若存在，`previewPhotos = [focusedPhoto]`、index 0、overlay visible。
- `showCounter=false`、download=false、`primaryActionLabel="查看完整相册"`。
- CTA 清除 focused mode、关闭 overlay并展示已加载的 public waterfall。

公开视频 URL 请求使用新 public video-url endpoint，并带 `albumShareToken`；成员视频仍用原 endpoint。两条路径共用现有 transition helper，不相互回退。

## 5. 失败与安全

- 409 `ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE` 映射为 blocked。
- 网络或封面准备失败映射为 failed；安全 fallback 可用时仍可 ready。
- 乱序请求不得替换当前项。
- 目标缺失不自动展示其他媒体。
- 整份 token 失效时隐藏 CTA；单项失效但整份 share 仍有效时可保留 CTA。
- 公开模式无下载、上传、标注、删除或登录提升。
- 不记录完整 token、签名 query、对象 key 或媒体字节。

## 6. 测试设计

### 6.1 RED/GREEN 顺序

1. 静态契约先因 D50 实现缺失失败。
2. selector 单测先因 `requiredMediaId` 未实现失败，再写最小选择逻辑。
3. API/service 授权单测先因 public video getter/route 缺失失败，再写 capability。
4. Range 测试先因 COS public proxy 缺失失败，再实现 responder。
5. 小程序 helper 单测先因模块缺失失败，再写纯 helper。
6. viewer/page 契约先因 props、按钮、focused mode 缺失失败，再接线。

### 6.2 回归

- D48 公开隐私、快照、撤销、封面与 DTO。
- D31 viewer sequence/windowing。
- D32 公开视频 DTO 仍不直接含 playback URL。
- D42 video URL、HEAD、200、206、416、COS helper。
- `check-miniprogram`、完整 `npm run check`、`npm run build:mp-weixin`。

## 7. 验收路径

1. 成员打开可公开图片，等待分享按钮 ready，分享给好友。
2. 好友打开后只看到该图，无计数/下载/左右浏览。
3. 点击“查看完整相册”，看到同一公开快照。
4. 对 ready 视频重复路径，验证封面、播放、拖动 Range、一次刷新与重试。
5. 撤销分享、关闭相关隐私或删除目标后，旧单项链接不再展示目标。
