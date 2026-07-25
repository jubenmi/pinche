# D57 设计：相册标签与公开分享读取模型

## 1. 架构结论

D57 使用三个服务端能力和一个客户端纯状态模型：

```text
AlbumTagResolver
  media tag reference -> current role label

PublicShareManifest
  immutable share items -> ordinal pagination

PublicMediaState
  loaded media ids -> patches + unavailable ids

PublicAlbumReadState
  INITIAL_PAGE | NEXT_PAGE | MEDIA_PATCH | UNLOAD
```

标签名称解析、隐私资格、分享清单和媒体凭证各自只有一个职责。成员相册和公开分享复用 `AlbumTagResolver`。公开分享分页不再读取 JSON 数组切片；媒体地址续期不再重读第一页或已加载分页前缀。

## 2. 文件结构

新增文件：

- `apps/api/migrations/0035_album_tag_public_share_read_model.sql`
  - 创建规范化标签与分享清单表并执行可信回填。
- `apps/api/src/modules/core/album-tags.js`
  - 规范化 tag key、读取标签引用、解析最新角色名、序列化标签 DTO。
- `apps/api/src/modules/core/public-album-share-manifest.js`
  - 写入/读取清单项、签名 ordinal cursor、稳定分页。
- `apps/api/src/modules/core/public-album-media-state.js`
  - 规范化媒体 ID 批次并编排当前媒体状态读取。
- `apps/api/test/album-tag-model.test.mjs`
  - 标签模型、resolver、写入和迁移契约测试。
- `apps/api/test/album-public-share-manifest.test.mjs`
  - 清单创建、历史回填、分页和授权成员测试。
- `apps/api/test/album-public-media-state.test.mjs`
  - 媒体状态 DTO、撤回和批次限制测试。
- `apps/miniprogram/src/utils/publicAlbumReadState.js`
  - 四事件 reducer、批次切分和 generation guard。
- `apps/miniprogram/test/publicAlbumReadState.test.mjs`
  - 纯状态与并发排列测试。
- `scripts/d57-album-tag-public-share-read-model-check.js`
  - D57 静态契约门禁。

修改文件：

- `apps/api/src/modules/core/service.js`
  - 将相册标签和公开分享编排委托给新模块；新分享同事务写清单项；旧标签表不再参与运行时读取。
- `apps/api/src/modules/album-image/repository.js`
  - 删除媒体时清理规范化标签表，不再写旧标签表。
- `apps/api/src/legacy-app.js`
  - 增加 media-state 路由和公开媒体状态 URL 附加。
- `apps/miniprogram/src/pages/session/album.vue`
  - 接入四事件状态，删除前缀重读和共享公开列表 authority。
- `apps/miniprogram/src/utils/albumPublicSharePagination.js`
  - 只保留分页 URL 和追加合并；删除前缀重读、序列比较和整表替换 helper。
- `apps/miniprogram/src/utils/albumMediaUrls.js`
  - 成员相册继续使用完整相册刷新；公开相册改由 media-state 控制器，不再调用完整列表 reload。
- `package.json`
  - 新增 D57 unit/check 并加入 `postcheck`。
- `scripts/migration-filename-history.json`
  - 追加 `0035_album_tag_public_share_read_model.sql`。
- D48/D50/D52/D54 相关规格
  - 只更新被 D57 明确替换的标签与公开刷新契约。

## 3. 数据库设计

### 3.1 `session_album_media_tags`

```sql
CREATE TABLE IF NOT EXISTS session_album_media_tags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  media_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  seat_id BIGINT UNSIGNED NULL,
  session_npc_role_id BIGINT UNSIGNED NULL,
  subject_ref_id BIGINT UNSIGNED
    GENERATED ALWAYS AS (
      CASE
        WHEN CAST(kind AS BINARY) = CAST('role' AS BINARY) THEN seat_id
        WHEN CAST(kind AS BINARY) = CAST('npc_role' AS BINARY)
          THEN session_npc_role_id
        ELSE 0
      END
    ) STORED,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_album_media_tag_shape CHECK (
    (
      CAST(kind AS BINARY) = CAST('role' AS BINARY)
      AND seat_id IS NOT NULL
      AND session_npc_role_id IS NULL
    )
    OR
    (
      CAST(kind AS BINARY) = CAST('npc_role' AS BINARY)
      AND seat_id IS NULL
      AND session_npc_role_id IS NOT NULL
    )
    OR
    (
      CAST(kind AS BINARY) = CAST('other' AS BINARY)
      AND seat_id IS NULL
      AND session_npc_role_id IS NULL
    )
  ),
  UNIQUE KEY uniq_album_media_tag_subject (media_id, kind, subject_ref_id),
  FOREIGN KEY (media_id) REFERENCES session_album_photos(id)
    ON DELETE CASCADE,
  FOREIGN KEY (seat_id) REFERENCES session_seats(id)
    ON DELETE RESTRICT,
  FOREIGN KEY (session_npc_role_id) REFERENCES session_npc_roles(id)
    ON DELETE RESTRICT
);
```

跨表“媒体与角色属于同一场次”由写入事务验证，迁移通过带 `session_id` 条件的 join 只回填可信行。`kind` 使用字节级精确比较，拒绝大小写和尾空格变体。媒体是标签行的所有者，因此删除媒体时标签级联删除；角色引用使用显式 `RESTRICT`，避免 MySQL 对生成列依赖字段的级联限制。

回填映射：

```text
seat              -> role
session_npc_role  -> npc_role
other             -> other
dm/npc/organizer  -> 丢弃
```

旧 `session_album_photo_tags` 在 D57 运行时不再读取或写入，但本次发布保留物理表用于回滚。0035 的隔离 migration preparer 将其 `photo_id` 外键原子协调为 `ON DELETE CASCADE`，保证历史标签不会阻断媒体或场次删除；该 preparer 可识别已协调和约束缺失状态并安全重跑，不属于运行时标签读取。后续独立迁移在至少一个稳定发布周期后删除旧表。

### 3.2 `session_album_public_share_items`

```sql
CREATE TABLE IF NOT EXISTS session_album_public_share_items (
  share_id BIGINT UNSIGNED NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  media_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (share_id, ordinal),
  UNIQUE KEY uniq_album_public_share_media (share_id, media_id),
  FOREIGN KEY (share_id) REFERENCES session_album_public_shares(id)
    ON DELETE CASCADE
);
```

清单项故意不对 `media_id` 建外键：分享创建后媒体可能被物理删除，但冻结清单仍需保留该 ordinal 作为不可见墓碑，避免旧 cursor 的位置语义改变。媒体读取始终重新关联 `session_album_photos` 并执行当前资格复核。

迁移使用 MySQL 8 `JSON_TABLE(... FOR ORDINALITY ...)` 按 `media_ids` 原顺序回填。回填先按 JSON 原始类型、正整数字面量和 unsigned bigint 范围严格筛选，重复媒体确定保留第一次出现的原 ordinal；已存在的 ordinal 或 media 通过反连接跳过，使 DDL 中途失败后的重跑安全且不依赖 `INSERT IGNORE`。迁移测试验证非法标量、越界值、重复 ID、重试和已删除媒体墓碑。

新分享仍写入兼容用 `media_ids`、摘要和封面字段，保证旧 token 与 D48/D50/D52/D55 逻辑可读；同一事务随后写入 share items。运行时清单成员、顺序和分页只读取 share items。加载分享时先验证兼容 JSON 摘要，再验证其 ID 序列与 share items 完全一致；不一致时关闭式失败。

## 4. 标签服务

### 4.1 输入与写入

客户端 tag key 改为：

```text
role:<seatId>
npc-role:<sessionNpcRoleId>
other
```

`normalizeAlbumTagKeys` 只接受上述三种形式并去重。写入事务：

1. 锁定媒体并验证上传者、状态与审核。
2. 加载媒体所属场次的角色位和 NPC 角色。
3. 将 key 解析为规范化引用。
4. 删除该媒体的新标签行并按顺序插入。
5. 增加 `tag_version`。

不再调用含玩家昵称的 `sessionAlbumPeople` 作为标签写入来源。成员标签选择器使用新的 `listSessionAlbumTagOptions`：

```json
{
  "kind": "role",
  "ref_id": 12,
  "key": "role:12",
  "label": "沈清商"
}
```

NPC 角色同理；最后追加固定 `other`。

### 4.2 读取与序列化

`resolveAlbumTagReadContext(connection, sessionId, mediaIds)` 用一次 SQL 快照查询：

- `session_album_media_tags`
- `session_album_photos`
- `session_seats`
- `session_npc_roles`

查询 join 同时限制角色表的 `session_id = media.session_id = sessionId`。同一批行分别投影显示标签和内部隐私主体；显示投影输出：

```js
new Map([
  [mediaId, [
    { kind: "role", ref_id: seatId, label: roleName },
    { kind: "npc_role", ref_id: npcRoleId, label: npcName },
    { kind: "other", ref_id: null, label: "其他" }
  ]]
])
```

缺失名称或跨场次引用不输出。resolver 不查询 `users`，不读取旧 `label`。`resolveAlbumTags` 与 `resolveAlbumTagPrivacySubjects` 是该 read context 的安全投影接口；所有可见性、选择、封面和媒体授权路径必须接收完整 context，不得自行组合两次查询。任一 map 或目标媒体项缺失时关闭式失败。

### 4.3 隐私资格

显示标签和隐私资格分开：

- `AlbumTagResolver` 只对外输出显示语义。
- 同一 SQL 快照根据相同引用读取 `session_seats.confirmed_user_id` 或 `session_npc_roles.bound_user_id`，并投影为独立的 `privacySubjectsByMediaId`。
- `albumPrivacyMap` 使用这些内部 user ID 复核 `allow_tagged_visible`。
- 内部 user ID 只存在于授权调用栈，不进入 tag DTO 或公共响应。

`other` 保持成员相册公共标签语义。无标签媒体继续沿用 D52 的分享者自有未标注图片规则。

## 5. 分享清单服务

### 5.1 创建

`createOrReuseSessionAlbumPublicShare` 继续计算安全 `mediaIds` 和兼容摘要。新建分享时：

1. 插入 `session_album_public_shares`。
2. 按 `created_at ASC, id ASC` 的既有稳定顺序写入 share items。
3. 两步处于同一事务，任一步失败则全部回滚。

复用已有分享时，验证 share items 与兼容 JSON 一致；迁移前历史行已经由 0035 回填。

### 5.2 ordinal cursor

游标签名载荷改为：

```json
{ "share_id": 123, "after_ordinal": 59 }
```

首次请求视为 `after_ordinal = -1`。服务按：

```sql
SELECT ordinal, media_id
FROM session_album_public_share_items
WHERE share_id = ?
  AND ordinal > ?
ORDER BY ordinal
LIMIT ?
```

分段读取。动态失效时继续向后扫描；`next_cursor` 记录最后扫描的 ordinal，而不是返回数量。

旧 offset cursor 只在过渡兼容期解析为对应 ordinal；新响应只签发 ordinal cursor。

### 5.3 所有媒体授权

`loadSessionAlbumPublicShareWithConnection` 在验证 token、兼容摘要和分享状态后加载 share items。图片、视频封面、视频地址和视频字节路径继续调用该加载器，并用 items 构造的 ID 集合判断成员资格。任何路径不得直接以兼容 JSON 作为授权真相。

## 6. PublicMediaState

新增路由：

```http
POST /api/sessions/:id/album/public-share/media-state?token=<share-token>
Content-Type: application/json

{ "media_ids": [1, 2, 3] }
```

单次最多 100 个去重正整数。响应：

```json
{
  "patches": [
    {
      "id": 1,
      "media_type": "image",
      "public_tag_labels": ["沈清商"],
      "thumbnail_display_url": "/api/...",
      "preview_display_url": "/api/...",
      "media_url_expires_at": "..."
    }
  ],
  "unavailable_ids": [2]
}
```

服务流程：

1. 验证 token 与 session。
2. 验证请求 ID 全部属于 share items；清单外 ID 关闭式失败。
3. 使用与分页相同的当前公开资格函数复核每个媒体。
4. 对可见媒体生成完整安全公开 DTO 并附加短期 URL。
5. 对清单内但当前不可见的媒体只返回 ID。

图片、缩略图、视频封面和视频文件能力与 DTO 的 `media_url_expires_at`
共用同一个绝对到期值：`min(share claims.exp, now + 600 seconds)`。
公开 patch 使用显式字段白名单，不从数据库媒体行扩散账号或存储字段。

客户端超过 100 个已加载媒体时按稳定 ID 顺序分批请求；任一批失败则本轮整体不提交部分结果，随后有界重试。

## 7. 客户端状态与渲染

### 7.1 纯 reducer

`publicAlbumReadState.js` 导出：

```js
createPublicAlbumReadState()
reducePublicAlbumReadState(state, event)
publicAlbumMediaStateBatches(mediaIds, limit = 100)
```

状态：

```js
{
  cards: [],
  nextCursor: null,
  pageLoading: false,
  pageError: "",
  generation: 0
}
```

事件：

- `INITIAL_PAGE`
  - 替换 cards，设置 cursor，清空分页错误。
- `NEXT_PAGE`
  - 按 ID 去重追加，设置 cursor，结束 page loading。
- `MEDIA_PATCH`
  - 按 ID 合并 patch，过滤 unavailable ID，不改 cursor。
- `UNLOAD`
  - generation 加一，清空 loading/error；晚到提交由捕获 generation 拒绝。

reducer 对输入不做原地修改并冻结测试快照。

### 7.2 `album.vue` 接入

公开模式新增一个 `publicAlbumRead` 状态对象。`photos` 在公开模式是 `publicAlbumRead.cards` 的页面投影；成员模式继续使用现有 `photos`。

方法边界：

- `loadPublicAlbum`
  - 捕获 generation，请求首屏，提交 `INITIAL_PAGE`，唯一一次调用 `refreshWaterfall`。
- `loadMorePublicAlbum`
  - 设置分页 loading，请求下一页，提交 `NEXT_PAGE`，只调用 `appendPublicAlbumWaterfallPhotos(appended)`.
- `refreshLoadedPublicAlbumMedia`
  - 对当前 card IDs 分批调用 media-state；全部成功且 generation 仍有效时提交一次 `MEDIA_PATCH`。
- `applyPublicAlbumMediaPatchToWaterfall`
  - 按 ID 更新或过滤 `waterfallPhotos`、`waterfallList1`、`waterfallList2`，不调用 `clear`。
- `onUnload`
  - 提交 `UNLOAD` 并 dispose 媒体状态 timer。

删除：

- `publicShareLoadedPageCount`
- `reloadLoadedPublicAlbumPrefix`
- `reloadPublicAlbumSharePrefix`
- 公开模式对 `createAlbumMediaRefreshController.reloadAlbum` 的调用
- 公开分页与后台刷新共享的 `albumListRequestAuthority`

成员相册仍可使用现有 `albumMediaRefresh` 完整刷新，不受 D57 影响。

### 7.3 媒体状态 timer

新建轻量 `createPublicAlbumMediaStateController` 或在 `publicAlbumReadState.js` 中实现：

- single-flight `refresh`
- 依据最早 `media_url_expires_at - 30s` 排期
- 正常与重试 timer 都夹在 `1000..2147483647ms`
- 失败后 30s 有界重试
- `dispose` 后不写入、不重排期

控制器只调用 `refreshLoadedPublicAlbumMedia`，不读取分页 cursor，不修改分页 loading/error。

## 8. 迁移与兼容

0035 在一个迁移中创建两个新表并回填。迁移必须可在已有生产数据上执行：

- 规范化标签只回填同场次可信引用；
- `other` 不读取旧 label；
- 账号身份标签不回填；
- share items 保持 JSON 顺序；
- 已删除媒体 ID 仍产生 item 墓碑，并在读取时进入 unavailable；
- 重复执行通过 `INSERT IGNORE` 保持结果不变。

`scripts/migration-filename-history.json` 追加 0035，迁移 registry/checksum 测试同步更新。

旧表保留一个发布周期，但 D57 静态门禁禁止生产代码读取或写入 `session_album_photo_tags`。现有测试 fixture 和 smoke 脚本在 D57 中迁移到新表；旧迁移历史文件本身不受门禁限制。

## 9. 安全与可观察性

- media-state ID 不得作为授权凭证；token 和 manifest membership 必须同时有效。
- 服务端批次最多 100 个去重 ID；重复项保留首次顺序，非 number 正整数、越界或去重后过多返回 400。
- `assertPublicResponseSafe` 继续应用于分页和 media-state 响应。
- 结构化事件：
  - `public_share_manifest_page`
  - `public_media_state_refresh`
  - `public_media_state_unavailable`
  - `public_share_manifest_mismatch`
- 事件只记录 session/share 的数值 ID、数量、结果码和耗时，不记录 token、标签文字、账号或 URL。

## 10. 测试策略

### 10.1 迁移与标签

- SQL 结构、CHECK、唯一键、外键和历史文件名；
- 可信 backfill 与账号标签丢弃；
- role/NPC 改名实时生效；
- 成员与公开 DTO 标签完全一致；
- resolver 查询不含 `users` 和旧 `label`；
- 隐私 subject 只进入授权结果。

### 10.2 manifest 与 media-state

- 新分享同事务写完整 items；
- 历史 JSON 顺序回填和幂等；
- items/JSON mismatch 关闭式失败；
- 首中末页、失效填补、cursor 篡改/跨分享；
- 清单外 media-state ID 拒绝；
- 撤回返回 unavailable；
- 图片、视频封面、视频地址和字节都从 items 授权。

### 10.3 客户端

- reducer 四事件；
- `NEXT_PAGE -> MEDIA_PATCH` 与 `MEDIA_PATCH -> NEXT_PAGE` 最终等价；
- 批次任一失败不提交部分 patch；
- generation 失效无写入；
- 分页失败保留 cursor；
- 首屏之外没有全量 waterfall refresh；
- 单项移除不清空其他列；
- timer single-flight、retry 和 dispose。

### 10.4 回归

新增：

```text
npm run d57:unit
npm run d57:check
```

最终运行：

```text
npm run d51:migrations
npm run d48:check
npm run d50:unit
npm run d50:check
npm run d54:unit
npm run d54:check
npm run d55:unit
npm run d55:check
npm run d56:unit
npm run d56:check
npm run d57:unit
npm run d57:check
npm run check
npm run build:mp-weixin
git diff --check
```

## 11. 发布与验收

代码通过本地与整体审查后按仓库 CI 规则：

1. 合入并推送 `develop`，等待 CI 成功。
2. 将相同工作提升到 `main`，等待 CI 成功。
3. 将已验证 `main` 提升到 `publish`，等待 CI 成功。
4. 使用微信开发者工具导入 `dist/build/mp-weixin`，验证角色标签、触底分页、`onShow` 媒体续期、撤回和失效页。
5. 真机确认滚动连续后上传小程序版本并提交微信审核。
