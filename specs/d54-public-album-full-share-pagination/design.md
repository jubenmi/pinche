# D54 设计：公开相册全量分享与九图封面

## 1. 架构结论

D54 将“正文快照范围”“封面分析候选范围”和“最终画布格数”明确分离：正文保存完整公开范围，`cover_media_ids` 保存其安全子集中的最多 30 项，仅供封面实际图片分析；渲染器在其中筛选、去重并最终输出 1～9 张。

D54 原始版本未新增数据库字段或迁移。旧快照仍保留原 JSON、摘要和 token 兼容语义。

### D57 后续权威契约

D57 supersedes 本文下方以 `media_ids` offset 切片和前缀重读作为运行时实现的历史描述。新写入和回填后的正文成员、ordinal 顺序、隐式资格和标签版本统一由 `session_album_public_share_items` 承载；JSON 只用于兼容与完整性校验。下一页按 ordinal 追加；公开 media-state 批量复核已加载 ID，并以 `MEDIA_PATCH` 原位更新，不重读前缀、不清空瀑布流，也不改变当前滚动位置。

## 2. 服务端

### 2.1 数量规则

在 `apps/api/src/modules/core/service.js` 中：

- 移除 `normalizePublicShareSelectedMediaIds` 的 30 项静态照片上限。
- `selectPublicShareMedia` 默认范围不再在第 30 项停止；保留 `ready` 视频最多 3 项。
- `normalizePublicShareSnapshotIds` 与 `normalizeImplicitUntaggedMedia` 继续校验兼容 JSON，但不再提供运行时成员授权。
- `publicShareSnapshotDigest` 继续覆盖兼容 JSON，保证旧 token 与历史快照的完整性核对不变。
- 新分享把全部正文媒体按稳定顺序写入 `session_album_public_share_items`；封面分析候选仍验证为正文子集并受独立上限约束。

`createOrReuseSessionAlbumPublicShare` 将 `selectedMedia` 的完整范围写入 normalized items，并同步兼容 JSON 用于摘要核对。封面继续调用 `selectPublicShareCoverMedia(selectedMedia, ...)`，从完整安全候选集合选出独立的有界候选；最终画布仍不得超过 9 张。

### 2.2 签名游标

在 service 模块新增纯函数：

```js
encodePublicShareOrdinalCursor(shareId, afterOrdinal)
decodePublicShareOrdinalCursor(cursor, shareId)
```

新游标载荷为 `{ share_id, after_ordinal }` 的 base64url JSON，并以 `config.sessionSecret` 做 HMAC-SHA256 签名。解析时使用 `timingSafeEqual`，要求 share ID 完全匹配、ordinal 为非负安全整数；错误统一为 `badRequest("Invalid album share cursor")`。历史 `{ share_id, offset }` 游标只在能安全映射到现有 manifest 范围时兼容读取，响应只签发 ordinal 游标。

公共页大小常量为 30。`listPublicSessionAlbumShare(claims, { cursor, limit })` 对外只接受 1～30 的 `limit`，默认 30；token 对应旧版非快照分享时维持原有单页读取行为。

### 2.3 分页读取

对 v2 分享 token：

1. 读取分享并解析游标得到 manifest `ordinal`。
2. 从 `session_album_public_share_items` 以 ordinal 查询不超过当前缺口的条目；每次查询最多 30 项。
3. 对每段执行现有审核、状态、标签、隐私、标签版本和视频 ready 复核。
4. 按 manifest ordinal 追加通过复核的 DTO；若某些项失效，继续向后扫描直到填满页面或 manifest 结束。
5. 下一个游标记录最后扫描的 ordinal，而非返回条数，避免失效项造成重复或跳项。

新创建分享的 items 在保存前以 `created_at ASC, id ASC` 分配 ordinal，保证跨页时间顺序。旧快照先回填 items，仍不改变历史链接的首屏效果。

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

`apps/miniprogram/src/utils/albumPublicSharePagination.js` 只负责构造带 token/cursor 的分页 URL及按媒体 ID 去重追加。`publicAlbumReadState.js` 持有 `INITIAL_PAGE`、`NEXT_PAGE` 与 `MEDIA_PATCH` reducer 状态；media-state refresh 只 patch 已加载项，不通过 `loadPage` 重读前缀。两者都不直接导入网络层或 Vue 状态，保持可独立单元测试。

`album.vue` 在公开分享模式新增：

- `publicShareNextCursor`、`publicShareHasMore`、`publicShareLoadingMore`、`publicShareLoadMoreError`；
- 首次 `loadPublicAlbum` 清空分页状态并加载首屏；
- `onReachBottom` 调用 `loadMorePublicAlbum`；
- 成功时使用 helper 按 ID 去重合并，只把 `appendedPhotos` 增量追加到瀑布流，不清空或重建首屏卡片；
- token、页面刷新、卸载和请求序列变化时清空游标并拒绝过期响应。

封面预热和分享菜单仍只使用 share token 与内部 `cover_media_ids` 候选，不依赖正文是否加载到最后一页；对外返回的是生成后的单张封面图，不暴露这些候选 ID。

## 4. 安全与兼容

- 游标只包含签名后的快照位置，不能作为媒体授权凭证；实际读取仍需要有效 token，并在 service 中绑定分享 ID。
- 分页 SQL 仅按 share ID 与 ordinal 查询本页 manifest items。
- 所有逐媒体读取路径继续从 `session_album_public_share_items` 判断 ID 是否属于该分享。
- 旧 30 项 JSON 不改写、不扩容、不重新计算摘要；迁移只回填等序 normalized items，并要求两者严格一致。

## 5. 测试策略

服务端测试以 31、100 张安全静态图片建立完整快照，断言正文未截断、封面分析候选最多 30 张、最终画布最多 9 张且能在前序重复图后补位、分页游标稳定且篡改关闭。小程序 helper 测试页 URL、去重合并和空/错误游标；页面静态契约测试触底加载、请求序列门禁和局部失败文案。D54 门禁脚本保证发布前检查仍覆盖上述边界。
