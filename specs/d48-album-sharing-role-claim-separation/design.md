# D48 Design：相册分享与角色认领分流

更新日期：2026-07-19

版本：v1.0

状态：产品规则已确认，尚未实施

## 1. 设计摘要

D48 不新建第二套相册页面或第二套认领状态机，而是在现有 D23/D40 路径上做四组最小修正：

1. 相册页的 `onShareAppMessage` 与 `onShareTimeline` 都携带相册分享 token，均打开现有 `pages/session/album` 只读模式。
2. 现有 `pages/session/share` 只承担车局/角色邀请，继续复用 `join-invite-token`、`direct` 与 `review_required`，但不再开放朋友圈菜单。
3. 服务端把公开过滤改为“分享者角色标注或分享者上传”加上传者/被标注者隐私一票否决，并在签发 token 时保存最多 30 项的固定快照。
4. 分享 token 返回从快照内安全图片生成的封面 URL；客户端只有在无安全图片或读取失败时才使用现有固定票根图。

该方案保留现有公开相册接口、媒体签名、相册页模板和邀请页，不引入新的前端页面。为了可靠保存快照且避免把 30 个媒体 ID 塞进微信 query，只新增一张有界快照表。

## 2. 当前基线与最小差异

| 能力 | 当前实现 | D48 最小调整 |
|---|---|---|
| 相册发好友/群 | 打开 `/pages/session/share?entry=album` 并进入认领 | 改为打开 `/pages/session/album` 公开只读模式 |
| 相册发朋友圈 | 打开相册公开只读模式 | 保留路径，改用快照范围和相册照片封面 |
| 角色邀请 | `pages/session/share` + `join-invite-token` | 保留，只关闭朋友圈菜单并修正文案/封面 |
| 公开范围 | 必须标注分享者席位；分享者本人存在隐私例外 | 扩展为“分享者席位或分享者上传”，删除全部本人例外 |
| 分享集合 | 每次读取动态计算 | 签发时保存最多 30 项媒体 ID，读取时再做动态隐私门禁 |
| 相册封面 | 固定 `/static/art/ticket-landscape.jpg` | 优先返回快照内安全图片的受控衍生 URL |
| 公开 DTO | 仍携带完整 tags 与精确时间字段 | 清除标签/人物信息，只返回公开页需要的数据 |

内部变量 `timelineMode` 已在相册页被 60 余处用于控制只读行为。D48 为减少回归风险，不做全文件重命名；它在本期语义上代表“公开分享只读模式”，只修改用户文案为“公开只读展示”。后续可以独立重命名，不属于本期功能。

## 3. 数据模型

### 3.1 新表 `session_album_public_shares`

新增迁移 `apps/api/migrations/0032_session_album_public_shares.sql`：

```sql
CREATE TABLE session_album_public_shares (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  sharer_user_id BIGINT UNSIGNED NOT NULL,
  seat_id BIGINT UNSIGNED NOT NULL,
  media_ids JSON NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  cover_media_ids JSON NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_album_public_share_owner (
    session_id, sharer_user_id, seat_id, created_at
  ),
  INDEX idx_album_public_share_expiry (expires_at),
  CONSTRAINT fk_album_public_share_session
    FOREIGN KEY (session_id) REFERENCES sessions(id),
  CONSTRAINT fk_album_public_share_user
    FOREIGN KEY (sharer_user_id) REFERENCES users(id),
  CONSTRAINT fk_album_public_share_seat
    FOREIGN KEY (seat_id) REFERENCES session_seats(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

设计约束：

- `media_ids` 只能保存 1–30 个去重正整数，服务层读写时必须严格校验。
- `snapshot_digest` 是排序后媒体 ID、封面 ID 集合、分享者和席位的 SHA-256，用于复用未过期且内容相同的快照，避免每次进入相册都插入新行。
- `cover_media_ids` 只能保存 0–9 个去重正整数，并且每个 ID 都必须包含在 `media_ids` 中。
- 过期时间继续使用现有 30 天相册分享期限。
- `revoked_at` 非空的快照不得被复用，也不得继续签发列表、封面或媒体 URL。
- 不建立快照媒体明细表；公开上限固定为 30，使用有界 JSON 可以少一张表和一组写事务，同时不会产生任意大小字段。

### 3.2 不改动的数据

- `session_album_privacy.allow_uploaded_visible`
- `session_album_privacy.allow_tagged_visible`
- `session_album_photos` 与 `session_album_photo_tags`
- `sessions.join_policy`
- `signups` 与 `session_seats`

## 4. 后端领域设计

### 4.1 统一公开资格函数

保留 `isAlbumPhotoVisibleInPublicShare` 作为 D23 兼容入口，但把逻辑收敛为以下纯规则：

```text
publishedAndReady(media)
AND tags.length > 0
AND (
  media.uploader_user_id == sharerUserId
  OR tags contains seat_id == sharerSeatId
)
AND privacy(media.uploader_user_id).allow_uploaded_visible
AND every bound tag user allows allow_tagged_visible
AND no inconsistent occupied-seat tag is missing user_id
```

重要变化：

- 删除现有“上传者就是分享者时忽略 `allow_uploaded_visible`”例外。
- 删除现有“被标注者就是分享者时忽略 `allow_tagged_visible`”例外。
- 分享者上传且只标 NPC/场景/`other` 的媒体可以进入公开集合。
- 所有绑定真实用户的标签都逐人检查；任一失败整项排除。
- 图片、视频、列表、计数、封面和单媒体读取复用同一个资格函数，不能复制出不同规则。

### 4.2 快照选择

新增内部服务边界：

```text
createOrReuseSessionAlbumPublicShare(user, sessionId)
loadSessionAlbumPublicShare(claims)
selectPublicShareMedia(candidates, tagsMap, privacyMap, subject)
selectPublicShareCoverMedia(selectedMedia, tagsMap, subject)
```

选择步骤：

1. 读取当前有效且已批准媒体、标签及相关用户隐私。
2. 使用统一资格函数关闭式过滤。
3. 给候选分桶：
   - `0`：分享者上传且标注分享者席位；
   - `1`：其他人上传且标注分享者席位；
   - `2`：分享者上传的其他合规媒体。
4. 每个桶内按 `created_at DESC, id DESC` 选择，整体最多 30 项且视频最多 3 项。
5. 保存前把最终媒体 ID 按选择结果固定；公开响应再按 `created_at ASC, id ASC` 展示游玩过程。
6. 对规范化后的媒体 ID、封面 ID 集合、分享者和席位计算 `snapshot_digest`。
7. 如果最近未过期、未撤销快照的 digest 完全相同，则复用该行；否则插入新快照。

快照只固定“可能被读取的媒体 ID”，不冻结隐私或审核状态。公开列表和每个媒体 URL 读取仍重新执行统一资格函数，因此后续关闭隐私、删除或审核撤回可以立即隐藏内容。

### 4.3 封面选择与动态宫格

`selectPublicShareCoverMedia` 只检查已选快照中的图片：

第一优先级：

- `uploader_user_id == sharerUserId`；
- 标签包含分享者 `seat_id`；
- 不存在 `user_id != sharerUserId` 的真实玩家标签。

第二优先级：

- `uploader_user_id == sharerUserId`；
- 只包含 NPC、场景、道具、`other` 或未绑定真实用户的标签。

同级排序：

```text
image_width * image_height DESC
created_at DESC
id DESC
```

选择器最多返回前 9 张安全候选；不足 9 张时使用全部候选。宫格布局固定为：

| 图片数 | 行列布局 |
|---:|---|
| 1 | 单图 |
| 2 | `2` |
| 3 | `3` |
| 4 | `2 + 2` |
| 5 | `3 + 2` |
| 6 | `3 + 3` |
| 7 | `3 + 3 + 1` |
| 8 | `3 + 3 + 2` |
| 9 | `3 + 3 + 3` |

最后一行不足 3 张时左对齐，和朋友圈多图排列一致。每个格子使用相同正方形边长和固定间距；画布宽高随实际列数和行数计算，不补空白占位、不重复图片、不叠加文字。

封面不是原图地址。新增独立受控接口：

```text
GET /api/session-album/public-shares/:shareId/cover?token=<coverToken>
```

接口使用短期 cover token，并通过现有 Sharp/COS 图片读取链路取得 `cover_media_ids`，再由 Sharp 逐张裁切和合成为一张 JPEG：

- 自动方向纠正；
- 每张中心安全裁切为正方形格子；
- 按 1–9 张固定布局合成，末行左对齐；
- 不放大低分辨率源图；
- 质量压缩；
- strip 元数据；
- `private, no-store`。

cover token 绑定 `shareId`、完整 `cover_media_ids` 摘要和过期时间。读取时每一张图片都必须重新执行普通公开资格和严格安全封面资格；如果任意一张后来变成合照、被删除或隐私关闭，整个合成封面关闭式失败，不临时换图或缩减宫格。D48 不做服务端文字叠加，标题仍由微信分享标题承载。

### 4.4 新版相册分享 token

新版 claims：

```json
{
  "version": 2,
  "shareId": 123,
  "sessionId": 456,
  "sharerUserId": 789,
  "seatId": 1011,
  "exp": 1787040000
}
```

签发流程：

```text
POST /api/sessions/:id/album/share-token
  authenticate
  require album open + confirmed/locked seat
  createOrReuseSessionAlbumPublicShare
  sign version 2 claims
  attach short-lived share_cover URL
  return token + subject + safe sharer + counts + cover
```

响应结构：

```json
{
  "session_id": 456,
  "share_id": 123,
  "token": "payload.signature",
  "expires_at": "2026-08-18T12:00:00.000Z",
  "share_subject": {
    "seat_id": 1011,
    "role_name": "沈青",
    "seat_name": "角色A"
  },
  "share_owner": {
    "nickname": "小林",
    "avatar_url": "/api/user-assets/..."
  },
  "visible_count": 18,
  "photo_count": 16,
  "video_count": 2,
  "cover_url": "/api/session-album/public-shares/123/cover?token=..."
}
```

没有公开候选时返回 `409 ALBUM_PUBLIC_SHARE_EMPTY`。没有安全封面时 `cover_url` 为空，客户端使用静态票根图。

### 4.5 公开读取

现有接口保持不变：

```text
GET /api/sessions/:id/album/public-share?token=<albumShareToken>
```

新版读取：

1. 验证 version 2 token。
2. 读取 `session_album_public_shares` 并核对 share/session/sharer/seat/expiry。
3. 重新验证席位仍归分享者且状态为 `confirmed` 或 `locked`。
4. 只查询快照 `media_ids` 中的媒体。
5. 对每项重新执行审核、状态、关联和隐私门禁。
6. 生成公开媒体短期 URL。
7. 返回清理后的公开 DTO。

部署前的 D23 token 没有 `version/shareId`。验证器继续接受旧 claims 到其自然过期，使用旧的动态候选来源，但应用 D48 新隐私门禁；新签发接口只产生 version 2。

### 4.6 停止分享

复用现有相册隐私页作为管理入口，不新增分享管理页面：

```text
DELETE /api/sessions/:id/album/public-shares
```

接口要求当前用户是相册成员，并将该用户在该车局所有未过期、未撤销的 version 2 快照写入 `revoked_at = CURRENT_TIMESTAMP`。操作幂等；重复调用仍返回成功及本次实际撤销数量。公开列表、封面和单媒体 getter 都必须检查 `revoked_at IS NULL`。

`pages/session/albumPrivacy.vue` 增加独立危险操作“停止我的相册分享”，二次确认后调用该接口。它不修改两项隐私开关，也不删除相册媒体。用户之后再次从成员相册主动分享时可以创建新快照；已撤销的 shareId 永不恢复。

无状态的旧 D23 token 没有持久化 shareId，不能被该接口逐条撤销。兼容期内仍由新隐私门禁、媒体删除/审核状态和原 30 天过期控制；这是旧链接兼容的明确限制。

### 4.7 公开 DTO

公开相册返回：

```json
{
  "session_id": 456,
  "script_name_snapshot": "剧本名",
  "store_name_snapshot": "店名",
  "played_on": "2026-07-19",
  "share_subject": { "role_name": "沈青", "seat_name": "角色A" },
  "share_owner": { "nickname": "小林", "avatar_url": "/api/user-assets/..." },
  "visible_count": 18,
  "photo_count": 16,
  "video_count": 2,
  "photos": []
}
```

`albumMediaResponse(..., { publicShare: true })` 在 D48 必须把 `tags` 固定为空数组，并继续移除上传者、对象 Key、ETag、作者私有字段和内部 URL。精确 `start_at` 不再出现在公开 DTO；服务端返回北京时间 `played_on`。公开页不需要原始标签，只使用 `share_subject` 生成统一说明。

## 5. 小程序设计

### 5.1 相册分享

`apps/miniprogram/src/pages/session/album.vue` 继续在成员相册载入后预取分享 token。成员页新分享路径：

```js
onShareAppMessage() {
  return {
    title: `我在《${scriptName}》中饰演「${roleName}」｜游玩相册`,
    path: `/pages/session/album?id=${sessionId}&source=wechat_share&albumShareToken=${token}`,
    imageUrl: shareCoverUrl || "/static/art/ticket-landscape.jpg"
  };
}

onShareTimeline() {
  return {
    title: `这一晚，我是「${roleName}」｜《${scriptName}》`,
    query: `id=${sessionId}&source=wechat_timeline&albumShareToken=${token}`,
    imageUrl: shareCoverUrl || "/static/art/ticket-landscape.jpg"
  };
}
```

具体约束：

- 相册 token 和安全封面准备完成前，不开放朋友圈菜单；好友分享若没有 token 必须使用不可分享提示，不得退回邀请页。
- 上传、删除、标注或隐私设置返回相册后，重新载入相册并请求新快照；服务端 digest 相同会自动复用。
- 现有隐私页增加“停止我的相册分享”，只撤销该用户在该车局的新版快照，不修改照片或隐私开关。
- 公开访问仍由 token 存在触发现有只读分支，不要求重命名 `timelineMode`。
- 只读文案从“朋友圈只读展示”改为“公开只读展示”。
- 公开页新增紧凑头部，展示安全头像/昵称、角色、剧本、店名、日期及公开数量。
- 公开页不显示角色选择、车局加入或邀请 CTA。

### 5.2 角色邀请

`apps/miniprogram/src/pages/session/share.vue` 保留角色板、登录、手机号、direct/review 分支和 `join-invite-token`。

最小调整：

- 页面标题统一为“邀请好友认领角色”。
- `showShareMenus()` 只传 `menus: ["shareAppMessage"]`。
- 不再生成或注册 `onShareTimeline` 邀请能力。
- `onShareAppMessage` 使用现有票根图作为 `imageUrl`，不使用相册照片。
- 新相册分享不再传 `entry=album`；保留旧 `entry=album` 解析只为兼容历史链接。
- 邀请 token 仍是车局级邀请，不预占或绑定具体微信好友；最终角色状态以提交时为准。

## 6. 权限与安全边界

| 凭证 | 可读取公开相册 | 可读取完整相册 | 可查看邀请预览 | 可认领/报名 |
|---|---:|---:|---:|---:|
| 无凭证 | 否 | 否 | 仅公开车局规则允许时 | 按公开车局规则 |
| `albumShareToken` | 仅绑定快照 | 否 | 否 | 不提供邀请授权 |
| `inviteToken` | 否 | 否 | 是 | 按 direct/review 规则 |
| 已确认成员登录态 | 通过成员接口 | 是 | 可创建邀请 | 按现有成员规则 |

公共媒体 token 继续短期有效，并增加 `shareId`、`photoId` 与 `usage` 绑定。媒体 getter 必须确认 photoId 属于该快照；不能仅凭“当前仍符合公开规则”读取快照外媒体。

## 7. 错误处理

- `ALBUM_PUBLIC_SHARE_EMPTY`：没有可公开内容；成员页提示检查标注和隐私。
- token 无效、过期或快照不匹配：`分享相册已过期或不可访问。`
- 快照已被分享者撤销：与无效/过期使用同一公开提示，不泄漏撤销者或内部状态。
- 快照媒体后来失效：从列表静默排除；单媒体读取返回 404/403，不泄漏具体原因。
- 封面失效：微信卡片创建前降级票根；已缓存的外部微信封面无法由服务端追溯删除，因此封面候选禁止合照和他人上传照片。
- 邀请角色已被占：沿用现有刷新与“角色已被选择”提示。
- 邀请 token 过期：沿用现有邀请预览错误，不回退为相册访问。

## 8. 测试设计

### 8.1 静态契约

新增 `scripts/d48-album-sharing-role-claim-separation-check.js`，并更新：

- `scripts/check-miniprogram.js`
- `scripts/d23-album-share-join-policy-check.js`
- `package.json`

锁定新路径、无新 `entry=album` 生成、邀请页无朋友圈菜单、version 2 快照、封面 URL 和公开 DTO 清理。

### 8.2 后端烟测

新增 `scripts/d48-album-sharing-role-claim-separation-smoke.js`，复用 D18/D23 的隔离数据库夹具，覆盖：

- 分享者角色照、分享者上传场景照和其他无关照片的选择差异。
- 上传者关闭、任一被标注者关闭及分享者本人关闭两类隐私。
- 未标注、未批准、D46 作者私有、处理中视频排除。
- 30 项总上限、3 项视频上限、稳定排序和快照固定。
- 封面人物优先、场景降级、合照排除、1–9 图动态布局和无候选降级。
- v2 相册 token、旧 D23 token、邀请 token 三类隔离。
- 快照外媒体不能通过公开媒体接口读取。
- 停止分享后列表、封面和已签发的单媒体 URL 都立即失效；重新分享生成新 shareId，旧 shareId 不恢复。

### 8.3 回归与构建

定向命令：

```text
node scripts/d48-album-sharing-role-claim-separation-check.js
node scripts/d18-session-album-privacy-check.js
node scripts/d23-album-share-join-policy-check.js
node scripts/d40-guest-calendar-home-check.js
node scripts/d48-album-sharing-role-claim-separation-smoke.js
npm run build:mp-weixin
```

最终命令：

```text
npm run check
npm run build:mp-weixin
```

## 9. 发布与兼容

1. 先部署 `0032_session_album_public_shares.sql`，再部署 API 和小程序。
2. API 在新小程序发布前继续接受旧 D23 相册 token。
3. 新 API 可继续服务旧小程序的朋友圈相册；旧小程序的好友相册仍走历史邀请页，直到新小程序覆盖。
4. 新小程序只请求 version 2 快照 token。
5. 观察公开分享 403/404、空快照比例、封面降级比例与媒体权限拒绝；不记录 token、用户 ID 列表、对象 Key 或原始标签。

## 10. 自检结论

- 设计覆盖了已确认的分享/邀请分流、公开范围、隐私一票否决和相册照片封面。
- 新增范围限制为一张快照表、现有 API 增量、两个既有页面和专项测试，没有新页面或新认领状态机。
- 快照固定与动态隐私同时成立：ID 不增长，资格可收紧。
- 封面使用更严格的本人上传/非合照规则，符合微信外部缓存风险边界。
- 旧 D23 token 有明确只读兼容路径，新 token 不继续复制旧动态范围。
