# D54 设计：公开相册全量分享与九图封面

## 1. 架构结论

D54 将“正文快照范围”“封面分析候选范围”和“最终画布格数”明确分离：`media_ids` 保存完整公开正文范围，`cover_media_ids` 保存其安全子集中的最多 30 项，仅供封面实际图片分析；渲染器在其中筛选、去重并最终输出 1～9 张。公开页通过签名游标逐页读取 `media_ids`，每个数据库媒体查询最多处理 30 个 ID。

不新增数据库字段或迁移。`media_ids`、`cover_media_ids` 和 `implicit_untagged_media` 继续是同一分享快照的一部分，摘要继续绑定它们；旧快照保留原 JSON、摘要和 token 兼容语义。

## 2. 服务端

### 2.1 数量规则

在 `apps/api/src/modules/core/service.js` 中：

- 移除 `normalizePublicShareSelectedMediaIds` 的 30 项静态照片上限。
- `selectPublicShareMedia` 默认范围不再在第 30 项停止；保留 `ready` 视频最多 3 项。
- `normalizePublicShareSnapshotIds` 在未明确传入 `max` 时不施加媒体数量上限；`cover_media_ids` 显式使用 `PUBLIC_SHARE_COVER_CANDIDATE_LIMIT = 30`，而不是画布的 9 格上限。
- `normalizeImplicitUntaggedMedia` 跟随正文快照，不再独立限制为 30 项。
- `publicShareSnapshotDigest`、行规范化和创建快照对正文 ID 使用无上限规范化；封面分析候选仍验证为正文子集且最多 30 项。

`createOrReuseSessionAlbumPublicShare` 将 `selectedMedia` 的静态照片范围完整写入 `media_ids`。封面继续调用 `selectPublicShareCoverMedia(selectedMedia, ...)`，先从完整安全候选集合保留最多 30 项。随后封面路由读取这 30 项，`selectAlbumShareImages` 先处理清晰度、曝光、重复图和质量下限，最后才截到最多 9 项；因此重复的前九项不会阻止后续优质候选补位。

### 2.2 签名游标

在 service 模块新增纯函数：

```js
encodePublicSharePageCursor(shareId, offset)
decodePublicSharePageCursor(cursor, shareId)
```

游标载荷为 `{ share_id, offset }` 的 base64url JSON，并以 `config.sessionSecret` 做 HMAC-SHA256 签名。解析时使用 `timingSafeEqual`，要求 share ID 完全匹配、offset 为非负安全整数；错误统一为 `badRequest("Invalid album share cursor")`。

公共页大小常量为 30。`listPublicSessionAlbumShare(claims, { cursor, limit })` 对外只接受 1～30 的 `limit`，默认 30；token 对应旧版非快照分享时维持原有单页读取行为。

### 2.3 分页读取

对 v2 分享 token：

1. 读取并规范化分享快照，解析游标得到 `offset`。
2. 从 `share.media_ids` 以 offset 开始分段切出不超过当前缺口的 ID；每次查询最多 30 个 ID。
3. 对每段执行现有审核、状态、标签、隐私、标签版本和视频 ready 复核。
4. 按快照 ID 的顺序追加通过复核的 DTO；若某些项失效，继续取下一段直到填满页面或快照结束。
5. 下一个游标记录扫描后的 offset，而非返回条数，避免失效项造成重复或跳项。

新创建快照的 `media_ids` 在保存前以 `created_at ASC, id ASC` 排列，保证跨页时间顺序。旧快照最多 30 项，仍按既有请求内时间顺序响应，不改变历史链接的首屏效果。

响应新增：

```json
{
  "photos": ["最多 30 项"],
  "media": ["同 photos"],
  "visible_count": 100,
  "next_cursor": "签名游标或 null",
  "has_more": true
}
```

`visible_count` 表示该分享创建时的完整快照数量，供分享页标题稳定展示；单页实际返回数由 `photos.length` 表示。动态失效项不会在 DTO 中出现。

### 2.4 路由

`GET /api/sessions/:id/album/public-share` 从 query 读取 `cursor` 和可选 `limit`，传给 service。服务端继续在调用前验证分享 token 的 session ID，返回值再走 `attachPublicSessionAlbumMediaUrls`，因此每页媒体 URL 都保持短期授权。

## 3. 小程序

新增 `apps/miniprogram/src/utils/albumPublicSharePagination.js`，只处理三件事：构造带 token/cursor 的分页 URL、按媒体 ID 合并页面、规范化后续游标状态。它不包含网络或 Vue 状态，便于单元测试。

`album.vue` 在公开分享模式新增：

- `publicShareNextCursor`、`publicShareHasMore`、`publicShareLoadingMore`、`publicShareLoadMoreError`；
- 首次 `loadPublicAlbum` 清空分页状态并加载首屏；
- `onReachBottom` 调用 `loadMorePublicAlbum`；
- 成功时使用 helper 去重追加并刷新瀑布流；失败仅设置局部错误；
- token、页面刷新、卸载和请求序列变化时清空游标并拒绝过期响应。

封面预热和分享菜单仍只使用 share token 与内部 `cover_media_ids` 候选，不依赖正文是否加载到最后一页；对外返回的是生成后的单张封面图，不暴露这些候选 ID。

## 4. 安全与兼容

- 游标只包含签名后的快照位置，不能作为媒体授权凭证；实际读取仍需要有效 token，并在 service 中绑定分享 ID。
- 分页 SQL 仅接收本页快照 ID，避免把长 JSON 快照展开为无限占位符。
- 所有逐媒体读取路径不改变，继续从完整快照判断 ID 是否属于该分享。
- 旧 30 项快照不迁移、不扩容、不重新计算摘要。

## 5. 测试策略

服务端测试以 31、100 张安全静态图片建立完整快照，断言正文未截断、封面分析候选最多 30 张、最终画布最多 9 张且能在前序重复图后补位、分页游标稳定且篡改关闭。小程序 helper 测试页 URL、去重合并和空/错误游标；页面静态契约测试触底加载、请求序列门禁和局部失败文案。D54 门禁脚本保证发布前检查仍覆盖上述边界。
