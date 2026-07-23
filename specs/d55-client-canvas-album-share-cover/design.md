# D55 设计：客户端三图分享封面

## 1. 架构

```text
公开相册完整快照
  → 服务端：安全复核 + 元数据排序（最多 3 张）
  → cover_recipe（3 个受 token 保护的 640px 缩略图 URL）
  → 小程序：下载 1～3 张缩略图 + Canvas
  → friend 5:4 / timeline 1:1 本地临时 JPEG
  → 微信 imageUrl
```

服务端的唯一图片处理仍是既有公开缩略图响应；它不再承担封面级别的对象读取、像素分析、拼图、字体绘制、JPEG 输出或缓存。Canvas 工作只在用户实际可分享的页面会话内执行。

## 2. 服务端契约

### 2.1 快照与兼容

新分享的 `cover_media_ids` 由 `selectPublicShareCoverMedia` 直接限制为 3 项。持久化和历史行规范化仍允许最多 30 项，以兼容 D54 及更早的 9 项快照；公开读取时只投影前 3 项。

`listPublicSessionAlbumShare` 在原有快照、席位、审核、标签和隐私复核之后附加内部 `cover_media` 投影。每项只含：`id`、`image_width`、`image_height`、`focus_x`、`focus_y` 与公开缩略图签名所需的最小资料。失效项被跳过，不额外暴露原因。

`attachPublicSessionAlbumMediaUrls` 删除 `cover_url` 和 `timeline_cover_url`，构造：

```json
{
  "cover_recipe": {
    "version": "client-canvas-v1",
    "images": [
      { "id": 41, "thumbnail_url": "/api/session-album/public-share/photos/41/image?…&variant=thumbnail", "width": 1200, "height": 1600, "focus_x": 0.5, "focus_y": 0.5 }
    ]
  }
}
```

`cover_recipe` 是公开 DTO 的唯一封面输入。服务端不返回 `cover_media_ids`、标签或原图地址。

### 2.2 删除项

删除 `/api/session-album/public-shares/:shareId/cover`，以及以下服务器专用模块和接线：

- `apps/api/src/modules/album-share-cover/cache.js`
- `apps/api/src/modules/album-share-cover/renderer.js`
- `apps/api/src/modules/album-share-cover/selection.js`
- `apps/api/src/modules/album-share-cover/layouts.js`
- `publicShareCoverMediaIdsDigest`、封面 capability token、`getPublicSessionAlbumShareCoverMedia`
- `publicShareCoverDependencies`、Sharp 图片分析和封面缓存依赖注入

仍被小程序使用的 1～3 图几何布局迁移为 `apps/miniprogram/src/utils/albumShareCanvas.js` 的纯数据函数；视频封面、正文缩略图和 `sharp` 的通用缩略图处理保留。

## 3. 小程序实现

新增 `albumShareCanvas.js`，分成可单测的纯函数与运行时适配器：

- `normalizeAlbumShareCoverRecipe`：只保留 1～3 个合法图片；
- `albumShareCanvasLayout(kind, count)`：返回好友 1000×800 或朋友圈 1000×1000 的单、双、三图槽位；
- `albumShareCanvasPlan`：按图片尺寸与可选焦点计算裁切源矩形与目标矩形；
- `renderAlbumShareCanvasCover`：使用 `uni.createOffscreenCanvas`（不可用时使用页面 canvas 适配器）绘制图片和文案，导出临时 JPEG；
- `createAlbumShareCanvasPreparation`：以 `shareId + recipe digest + kind` 为键去重/复用本地路径，提供 token 与请求序列门禁。

`albumShareCover.js` 改为处理 recipe 和本地 Canvas 结果；保留已有的好友/朋友圈分通道就绪状态、菜单门禁和本地降级图。`album.vue` 在首屏公开分享响应到达后开始预热，但不等待正文分页结束；失败只回退对应渠道。

## 4. 布局和文案

| 渠道 | 1 图 | 2 图 | 3 图 |
| --- | --- | --- | --- |
| 好友 | 满画幅 Hero | 62/38 双栏 | 62% Hero + 右侧上下两格 |
| 朋友圈 | 满画幅 | 58/42 双栏 | 上方 Hero + 下方两格 |

文案继续使用当前小程序分享标题。Canvas 仅绘制短标题和可选角色/剧本信息；任何文字绘制异常都不阻止图片画布导出。

## 5. 故障、缓存与安全

- recipe 为空、图片下载失败、Canvas 不可用或导出失败：回退为现有渠道本地图；
- 新 token、请求失效、页面隐藏/卸载：取消或忽略旧任务并清理内存映射；
- 本地临时路径仅在当前页面会话缓存，不能作为长期授权 URL；
- 所有 recipe 缩略图仍通过现有公开媒体 capability 路由动态复核，不向客户端暴露原图或封面候选列表之外的内容；
- share 路由不再有封面 JPEG 缓存命中，消除服务端封面对象读取和 Sharp CPU/内存峰值。

## 6. 验证策略

先写失败测试，再删服务器渲染链路并实现 recipe，最后接入 Canvas：

1. 服务端：新快照三图、旧 30 候选取前三、空/失效 recipe、DTO 无旧字段、无封面 route；
2. 小程序：recipe 规范化、三套布局、裁切计划、单渠道降级、同 recipe 复用、token 失效关闭；
3. 静态门禁：禁止服务端导入/路由/缓存/渲染模块，要求 recipe 与 Canvas 适配器；
4. 回归：D48/D50/D54 更新后的门禁、D55 聚焦测试、小程序构建、`npm run check` 和 `npm run devtools:refresh`。
