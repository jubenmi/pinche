# D52 本人未标注图片便捷分享设计

## 1. 架构结论

D52 复用 D48 的固定公开快照和 D50 的单图 `focusMediaId`。未标注资格保存在 `session_album_public_shares`，不保存到图片标签或长期媒体开关。

服务端统一负责候选资格、排序、快照摘要、动态复核和自定义范围校验；小程序负责成员页入口、分享预览、可选多选调整和原生微信分享状态。

## 2. 数据模型

新增迁移 `apps/api/migrations/0033_album_untagged_share_preview.sql`：

```sql
ALTER TABLE session_album_photos
  ADD COLUMN tag_version BIGINT UNSIGNED NOT NULL DEFAULT 0;

ALTER TABLE session_album_public_shares
  ADD COLUMN implicit_untagged_media JSON NULL AFTER media_ids;
```

旧分享的 `implicit_untagged_media` 为 `NULL`，服务端投影为空数组并使用旧摘要格式，保证现有 token 和快照继续有效。

新快照条目格式：

```json
[{ "media_id": 123, "tag_version": 0 }]
```

条目必须唯一、最多 30 项、属于 `media_ids` 子集，`tag_version` 必须为非负安全整数。

## 3. 快照摘要兼容

`publicShareSnapshotDigest` 增加可选 `implicitUntaggedMedia`：

- 空数组时不写入摘要 JSON，保持旧快照哈希不变。
- 非空时按 `media_id` 排序后写入摘要。
- 摘要继续覆盖 session、sharer、seat、排序无关的媒体集合与封面集合。

## 4. 统一资格函数

`isAlbumPhotoVisibleInPublicShare` 增加快照上下文：

```js
{
  implicitUntaggedByMediaId: Map<number, number>,
  allowOwnedUntaggedImages: boolean
}
```

逻辑顺序：

1. 校验 session、active、审核通过及 ready 视频。
2. 读取上传者隐私并执行一票否决。
3. 标签为空时，只允许图片、本人上传，且满足创建期显式开关或读取期 `media_id + tag_version` 匹配。
4. 标签非空时执行既有分享者关联、席位绑定和被标注用户隐私逻辑。

封面选择不传未标注上下文，因此空标签继续不可成为封面。

## 5. 选择与自定义范围

`selectPublicShareMedia` 支持：

```js
{
  requiredMediaId,
  allowOwnedUntaggedImages,
  selectedMediaIds
}
```

- 默认范围：按四级优先级选满 30 项，视频最多 3 项。
- 单图：目标先入选，再补齐默认范围。
- 自定义范围：只返回请求 ID 中仍合规的媒体；任一请求 ID 失效时返回 `ALBUM_PUBLIC_SHARE_SELECTION_CHANGED`，不补入其他媒体。
- 自定义展示继续由公开列表按稳定时间顺序返回。

## 6. 创建与读取快照

`POST /api/sessions/:id/album/share-token` 扩展请求：

```json
{
  "includeOwnedUntaggedImages": true,
  "selectedMediaIds": [1, 2, 3],
  "focusMediaId": 1
}
```

`selectedMediaIds` 与 `focusMediaId` 不同时使用。服务端返回：

```json
{
  "visible_count": 3,
  "implicit_untagged_count": 1,
  "token": "..."
}
```

公开列表、图片文件、视频封面和视频播放读取都从快照建立 `implicitUntaggedByMediaId`，并传入统一资格函数。公开 DTO 不返回内部条目和标签版本。

## 7. 标签写入

`updateSessionAlbumPhotoTags` 在锁定上传者图片、删除旧标签和写入新标签的同一事务内执行：

```sql
UPDATE session_album_photos
SET tag_version = tag_version + 1
WHERE id = ?;
```

返回 DTO 可带新的 `tag_version` 给本人客户端，但公开 DTO 不返回。

## 8. 小程序状态

新增 `apps/miniprogram/src/utils/albumSharePreview.js` 管理纯状态：

- `albumSharePreviewRoute`：构造 `source=share_preview` 的安全路由。
- `albumSharePreviewRouteState`：识别分享者预览并读取安全计数。
- `normalizeShareSelection`：去重、限制 30 项和 3 个视频。
- `albumSharePreviewNotice`：生成准确提示文案。

`album.vue` 新增：

- 成员页 `预览并分享` 按钮。
- `sharePreviewMode`、`sharePreviewUntaggedCount` 和 `selectionModePurpose = share`。
- 默认分享预览创建、公开页 owner-only 预览提示和调整入口。
- 分享多选工具栏，默认选中当前快照媒体，保存后重新创建快照。
- 成员页隐藏整册分享菜单；分享预览页 token ready 后启用。
- 单图 token 请求传 `includeOwnedUntaggedImages: true`。

## 9. 错误处理

- 默认候选局部失效：服务端跳过，全部为空返回 `ALBUM_PUBLIC_SHARE_EMPTY`。
- 自定义选择局部失效：返回 `ALBUM_PUBLIC_SHARE_SELECTION_CHANGED`。
- 单图目标失效：返回 `ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE`。
- 数量超限：返回 400，不创建或复用快照。
- token/封面失败：保持入口禁用并允许重试。

## 10. 安全与兼容

- 旧客户端未发送 include 标志时不包含未标注图片。
- 旧分享隐式条目为空且旧摘要继续有效。
- 分享链接仍可被转发，文案不得描述为私密。
- 未标注图片永不参与微信封面选择。
- 所有媒体字节读取继续执行快照、隐私、审核与标签版本复核。
