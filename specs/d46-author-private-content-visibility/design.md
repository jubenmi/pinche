# D46 Design：作者私有可见与审核后公开

更新日期：2026-07-15

版本：v1.0

状态：用户已确认，实施中

## 1. 决策

D46 采用方案 A：在现有 D45 审核数据和业务实体之上增加“作者私有投影”，不建设通用内容版本平台，也不允许作者绕过公共审核门禁。

该决策与公开可验证的行业行为一致：抖音开放平台明确说明视频进入审核时“仅用户自见”；小红书公开规则显示内容在审核/限制期间不进入正常曝光，修改后重新审核。公开资料不证明其内部表结构，因此 D46 只借鉴产品行为，不声称复制平台内部实现。

- 抖音开放平台：[拍摄器能力接入方案](https://open.douyin.com/platform/resource/docs/ability/content-management/douyin-camera-solution/)
- 小红书：[内容审核规范](https://pgy.xiaohongshu.com/help/detail?id=6495c527d1eedeeb48fb18b1f875650e&userType=4)
- 小红书：[笔记审核与话题曝光说明](https://school.xiaohongshu.com/helper/detail/790)

## 2. 设计原则

1. **公共判断不变**：`isModerationPublished` 永远只认 `approved`/`approved_legacy`。
2. **作者能力是独立授权**：只在已认证作者专属 DTO 和 URL 签发器中判断作者身份。
3. **公开实体与作者提案分离**：新建提案通过前不产生正式业务副作用；修改提案通过前不改旧公开实体。
4. **服务端先过滤**：客户端只负责展示，不能承担安全隐藏职责。
5. **动作白名单投影**：十个文本动作各自定义安全 DTO，不做任意 JSON 透传。
6. **异步结果不可复活**：取消、替代、删除或版本变化后，迟到回调只能 stale。
7. **发布门禁独立**：D46 可部署为关闭状态，不隐式开启 D45 intake。

## 3. 总体架构

```text
                           ┌────────────────────────────┐
作者提交文本/媒体 ────────→│ D45 审核任务/提案/媒体记录 │
                           └─────────────┬──────────────┘
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   │                                           │
          作者私有解析器                               公共发布解析器
  身份=创建者 + policy_version=1                  isModerationPublished=true
  动作白名单投影 / 作者短时媒体 URL                  原业务隐私与分享规则
                   │                                           │
                   ▼                                           ▼
       作者在原位置看到真实内容                       其他用户只见已批准版本
```

服务商结果只改变审核状态。最终响应由两个互不复用的序列化路径决定：

- `resolveAuthorTextProjection(...)`：仅为提案作者生成私有文本 DTO。
- `serializeAlbumMediaForViewer(...)`：先走公共批准分支；未批准时只允许 uploader 分支生成作者预览能力。

任何公共列表、公开分享或匿名路径都不得调用作者序列化分支。

## 4. 数据模型

### 4.1 文本提案扩展

在 `content_moderation_text_proposals` 增加：

```text
target_subject_id           VARCHAR(128) NULL
author_visibility_version   SMALLINT UNSIGNED NOT NULL DEFAULT 0
cancelled_at                DATETIME NULL
superseded_by_proposal_id   BIGINT UNSIGNED NULL
```

- `target_subject_id` 是动作白名单解析出的真实目标；新建动作使用稳定的创建目标标识，修改动作使用正式业务 ID。历史行允许为空，D46 新行必须有效。
- `author_visibility_version=1` 表示该提案可使用 D46 作者投影；历史行为 `0`。
- `superseded_by_proposal_id` 只指向同一作者、动作和目标的新提案。
- 新索引：`(created_by_user_id, action, target_subject_id, status, updated_at)`，支持原业务读取合并且不扫描 JSON。

提案状态扩展：

```text
pending → approved | rejected | stale | cancelled
rejected → superseded | cancelled
error/review 仍由 job 表表达；proposal 在决定前保持 pending
approved | stale | cancelled | superseded 为终态
```

### 4.2 审核任务扩展

`content_moderation_jobs.status` 增加 `cancelled` 终态，并增加 `source=user` 的受限迁移：

```text
pending | processing | review | error | rejected → cancelled
cancelled → 无后续迁移
```

取消时在同一事务中：锁定 job/proposal、校验作者、更新 proposal、更新 job、退休当前 attempt、清除租约。迟到 provider 结果按现有 stale 规则结束。

### 4.3 媒体策略版本

`session_album_photos` 增加：

```text
author_visibility_version SMALLINT UNSIGNED NOT NULL DEFAULT 0
```

D46 开启后新 finalize 的媒体写 `1`。历史媒体为 `0`，避免配置切换让旧拒绝对象突然具备作者预览语义。

不新增通用媒体版本表：当前产品不支持修改已发布的二进制图片/视频，拒绝媒体通过删除并重传产生新媒体 ID 和新对象版本。

## 5. 可见性策略

### 5.1 纯策略函数

新增独立模块 `apps/api/src/modules/content-moderation/author-visibility.js`，只返回能力，不生成 URL：

```text
resolveAuthorVisibility({ viewerUserId, authorUserId, moderationStatus,
  authorVisibilityVersion, recordStatus })
→ { scope, canPreview, canEdit, canDelete, canResubmit }
```

规则：

- 已批准：`scope=public`，继续走现有隐私逻辑。
- 未批准且 viewer=author、版本 1、记录 active：`scope=author_only`。
- 其他情况：`scope=hidden`。
- `isModerationPublished` 不调用也不依赖本函数。

### 5.2 读取矩阵

| 读取方 | 新建待审文本 | 已公开文本的新待审版本 | 待审/拒绝媒体 |
|---|---|---|---|
| 创建者 | 原位置显示投影 | 新值覆盖本人页面 | 显示真实媒体 |
| 其他成员/组织者 | 不存在 | 继续看旧公开值 | 不存在 |
| 匿名/分享 token | 不存在 | 继续看旧公开值 | 不存在 |
| system_admin 普通接口 | 与普通用户相同 | 与普通用户相同 | 与普通用户相同 |
| system_admin 审核后台 | 审核详情可见 | 审核详情可见 | 专用管理员 URL 可见 |

## 6. 文本双版本设计

### 6.1 统一作者 DTO

```json
{
  "draft_id": 123,
  "content_ref": "text-proposal:123",
  "publication_state": "author_only",
  "moderation_status": "review",
  "moderation_message": "仅自己可见 · 进一步审核",
  "published_id": 45,
  "content": {},
  "can_edit": false,
  "can_delete": true,
  "can_resubmit": false
}
```

`content` 由动作投影器生成。`published_id` 只在修改已有实体时返回；新建动作保持 `null`。审核中只允许取消；`rejected` 才允许修改后重新提交。

### 6.2 动作投影表

| action | 作者原位置 | 作者投影 | 其他用户行为 |
|---|---|---|---|
| `update_nickname` | 我的资料/身份栏 | 新昵称覆盖本人显示 | 继续看旧昵称 |
| `create_private_store` | 我的私有门店列表 | 临时门店卡片 | 不存在；通过安全审核后进入既有目录审核 |
| `create_private_script` | 我的剧本资料列表 | 临时剧本卡片 | 不存在；通过安全审核后进入既有目录审核 |
| `create_session` | 本人的日历/车局列表 | 禁用分享与报名的临时车局卡 | 不存在 |
| `update_session` | 车局详情/管理页 | 新文本字段覆盖本人页面 | 继续看旧车局文本 |
| `create_session_npc_role` | 车局设置 NPC 列表 | 禁用认领的临时 NPC 行 | 不存在 |
| `update_session_npc_role` | 车局设置/详情 | 新 NPC 文本覆盖本人页面 | 继续看旧 NPC 文本 |
| `upsert_session_review` | 我的评价编辑区 | 新评价投影 | 旧评价继续公开；新建评价不计入聚合 |
| `create_session_message` | 聊天气泡流 | 仅本人可见临时气泡 | 不存在且不增加未读数 |
| `update_session_pinned_message` | 聊天置顶区 | 新置顶文本只给操作者 | 继续看旧置顶文本 |

新增 `text-author-projection.js`，每个 action 独立 projector，只接收解析后的最小 payload，不允许默认分支透传。创建类投影必须携带 `is_draft=true`，客户端不得调用正式实体动作。

### 6.3 提交结果

- `Pass`：继续应用原业务方法，返回原 200/201 DTO。
- `Review`：保存提案/job，返回 202 作者 DTO。
- `Block`：保存 `rejected` 提案/job，返回 202 作者 DTO；不改正式实体。
- `Error`：保存/保留可重试提案，返回 202 作者 DTO，文案只说审核中。
- intake/身份/格式/业务失败：返回现有错误，不创建投影。

D45 当前将 Block 作为公开错误返回；D46 只在对应作者私有功能门禁开启且提案成功持久化时改为 202。门禁关闭时保持 D45 行为，便于回滚。

### 6.4 取消与重新提交

新增：

```text
DELETE /api/content-moderation/author-drafts/:draftId
```

它只做取消，不物理删除。重新提交复用原业务接口，在请求元数据中携带 `replaces_draft_id`。服务端根据当前 action/target 校验旧提案后，在一个事务中将旧提案标记为 `superseded` 并创建新提案；不提供通用 action 分发接口。

## 7. 图片与视频设计

### 7.1 作者媒体响应

现有 `listSessionAlbum` 已查询“已批准媒体或本人上传媒体”，但 D45 会把未批准 URL 全部清空。D46 保留该 SQL 边界，仅修改经过认证的本人序列化分支：

```text
approved → 现有公共/隐私序列化
unapproved + is_mine + policy_version=1 → 作者私有序列化
unapproved + 非本人 → SQL 不返回；详情/媒体端点再次 404/403
```

作者私有图片返回短时预览和缩略图，不返回批量下载候选。作者私有视频返回短时 `video_url`：优先合法 display 对象，否则合法 source 对象；封面不存在时使用安全占位，不向客户端生成帧。

### 7.2 URL 签发

新增作者专属签发函数，不复用管理员预览入口：

```text
getAuthorAlbumImagePreview(user, mediaId)
getAuthorAlbumVideoPreview(user, mediaId)
```

签发前检查：认证用户、uploader、active、policy version、moderation 非公开、对象路径白名单、对象版本。签发 URL 最长 60 秒，响应 `private, no-store`。公开图片/视频端点继续调用 `getVisible...`，永远不接受作者分支。

### 7.3 拒绝与清理

D45 当前 provider/admin Block 会 `enqueueRejectedMediaCleanup`。D46 对 `author_visibility_version=1` 改为：

```text
Block/reject → moderation_status=rejected → 保留私有对象
作者 delete  → media.status=deleting + job.cancelled → 幂等清理全部对象
管理员 purge → 审计 + 同一清理路径
```

policy version 0 继续保持 D45 清理语义，确保渐进发布和回滚可预测。迟到转码回调可合并发现的 display/cover 对象到“已明确删除”的清理任务，但普通 rejected 保留记录不得被 orphan scanner 当作孤儿。

## 8. 业务读取集成

文本作者投影不创建通用 Feed。各业务读取在完成原权限校验后，显式请求该 action/target 的最新作者提案并合并：

- `/api/users/me`：只给本人覆盖昵称。
- 私有门店/剧本本人列表：追加创建类草稿卡。
- 本人日历/车局列表：追加 `create_session` 草稿卡；公共近期/城市发现不读取。
- 车局详情和 NPC 列表：只给对应创建者覆盖修改或追加创建草稿。
- `GET /api/sessions/:id/review`：本人评价投影；公开评价列表不读取。
- 聊天本人响应：追加临时消息气泡/置顶覆盖；其他连接、推送、未读计数不读取。

合并发生在 DTO 层，不修改正式表查询结果。这样取消投影后自然回退到原公开实体。

## 9. 缓存与防泄漏

### 9.1 服务端

- 任何包含作者投影或作者媒体 URL 的响应使用 `Cache-Control: private, no-store`。
- 公共响应不含 `draft_id`、`content_ref`、`publication_state=author_only` 或作者 URL 字段。
- 公开 SQL、计数和分享序列化保持 D45 的批准过滤。
- 作者签发失败统一返回安全 404/403，不暴露媒体是否存在、作者 ID 或对象 Key。
- 访问日志不记录签名查询值；指标只记录 `subject_type/outcome/reason_code`。

### 9.2 小程序

- 作者私有数据只存在当前账号内存状态；退出、切换账号、页面隐藏或服务端刷新时按服务端权威结果清理。
- 不把短时 URL写入 storage、分享参数、剪贴板、埋点或错误上报。
- 当前图片工具会过滤所有未批准媒体；D46 改为识别服务端 `publication_state=author_only && is_mine`，但下载、标签和分享工具继续只认 `isModerationPublished`。
- 时间线/公开分享模式绝不渲染作者私有分支。

## 10. UI 设计

作者私有内容出现在原位置，统一使用低干扰角标：

| 状态 | 文案 | 操作 |
|---|---|---|
| pending/processing/error | 仅自己可见 · 审核中 | 取消/删除 |
| review | 仅自己可见 · 进一步审核 | 取消/删除 |
| rejected 文本 | 仅自己可见 · 未通过 | 编辑后重新提交、删除 |
| rejected 图片/视频 | 仅自己可见 · 未通过 | 删除并重新上传 |

创建类临时卡必须禁用分享、报名、标记、选择、管理等正式业务按钮。作者媒体可以预览/播放，但不能下载、标记或分享。服务商标签、分数和命中词不展示。

## 11. 管理员与紧急 purge

现有审核队列继续以 job 为中心。详情增加 `author_private_retained` 布尔值，不返回作者专属 URL。普通 reject 仅拒绝公开；独立 purge 动作要求 `system_admin`、原因、二次确认和审计，然后调用与作者删除相同的对象清理服务。

purge 是合规兜底，不是普通审核默认动作。它会让作者只看到“内容已被移除”的安全状态，不再预览实际媒体。

## 12. 配置与发布

新增默认关闭配置：

```text
CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ENABLED=false
CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ACTIONS=
CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED=false
CONTENT_MODERATION_AUTHOR_PRIVATE_VIDEO_ENABLED=false
CONTENT_MODERATION_AUTHOR_PREVIEW_TTL_SECONDS=60
```

TTL 生产只接受 `1..60`。`TEXT_ACTIONS` 只接受 requirements 中十个 action 的显式逗号分隔子集，默认空集；未知或重复值关闭式失败。三类功能门禁只决定 D46 私有写入/读取；D45 的 `*_INTAKE_MODE`、provider gate 和公共发布状态保持独立。

发布顺序：

1. 迁移与兼容读取，所有 D46 gate 关闭。
2. 发布作者投影/媒体代码，验证公共响应无差异。
3. 先对测试管理员开启文本动作白名单，再分动作观察。
4. 开启图片作者预览，观察 URL 拒绝与保留对象。
5. 开启视频作者预览，观察源视频播放、Range 与容量。
6. 独立审批后才讨论 D45 intake；D46 发布本身不接收真实新内容。

回滚只关闭 D46 gate；公共 D45 读取门禁、回调和 Worker 继续运行。已保留的拒绝对象保持私有，不能因回滚改回 D45 自动清理或公开。

## 13. 错误处理

- 身份/作者不匹配：404 或 403，不返回作者/对象细节。
- D46 gate 未开启：保持 D45 原行为，不生成版本 1 投影。
- URL 对象缺失：作者显示安全占位和状态，不把缺失当作审核通过。
- 提案已取消/替代/stale：409 安全错误并刷新业务页面。
- 新提案创建失败：旧 `rejected` 投影保持不变，不提前 supersede。
- 清理失败：记录现有 cleanup 重试与高优先级告警，内容仍不可公开。
- 缓存或序列化断言发现私有字段进入公共响应：请求失败关闭式结束并告警。

## 14. 测试策略

1. 纯函数：作者/非作者/管理员普通接口、全部状态、policy version 和记录状态矩阵。
2. 仓储：最新活动投影、锁、取消、替代、并发、幂等和索引契约。
3. 十个文本动作：创建/修改投影、公开旧值、批准应用、拒绝保留、取消、重新提交、stale。
4. 媒体：图片/视频作者 URL、非作者拒绝、60 秒 TTL、源/display 选择、Block 保留、delete/purge 清理、迟到回调。
5. 泄漏：公共列表/详情/搜索/计数/分享/下载/播放/标签/通知/缓存均无私有字段或 URL。
6. 小程序：原位置卡片/气泡、状态文案、禁用动作、删除/重提、账号切换清理。
7. 回归：D45 全量测试、根 `npm run check`、迁移与构建。

## 15. 难度评审

总体难度：**中高**。

现有媒体列表已经查询本人未批准记录，因此图片/视频主要工作是安全 URL、客户端渲染和拒绝清理语义；真正复杂的是十个文本动作分布在资料、目录、车局、NPC、评价和聊天多个读取面，且创建类内容没有正式业务 ID。

按一名熟悉仓库的全职工程师估算：

| 阶段 | 人日 |
|---|---:|
| 数据模型、状态机、作者策略与通用 API | 3–4 |
| 十个文本动作投影及业务读取集成 | 6–9 |
| 图片/视频作者预览与拒绝保留/清理 | 3–4 |
| 小程序各原位置体验 | 3–4 |
| 防泄漏、回归、迁移和受控发布 | 3–4 |
| **合计** | **18–25 人日** |

此前 12–18 人日的初估只按媒体和少量社交文本计算；对照现有代码后确认 D45 实际覆盖十个文本动作，因此本版把完整范围修正为 18–25 人日。可按动作门禁分阶段交付，每阶段均保持公共门禁完整。

## 16. 非目标

- 不建设通用 revision/history 平台。
- 不支持多人协作草稿或其他成员预览。
- 不允许作者私有内容进入公开搜索、分享、通知或互动。
- 不支持媒体原地编辑。
- 不改变审核服务商、内容策略或生产 intake。

## 17. D46.16 本地隔离 HTTP 验收

为完成不触碰生产入口的多账号/API 级验收，D46.16 增加一套仅本机可运行的隔离验证路径。它不替代 D45 已完成的微信/腾讯云真实服务商前置预检，也不改变任何生产功能门禁。

启动条件必须同时满足：`NODE_ENV=test`、`WECHAT_MOCK_LOGIN=true`、`D46_SMOKE_ISOLATED=1`；API 精确监听 `127.0.0.1:3046` 且 `APP_BASE_URL=http://127.0.0.1:3046`；MySQL 为回环地址、端口 `3346`、用户/密码为专用本机值且数据库名精确为 `pinche_d46_test`；Redis 精确为 `redis://127.0.0.1:6446/15`；`DATABASE_TARGET_LOCK` 与 `DATABASE_TARGET_LOCK_HOST` 均为空；COS 未启用。D46 标志一旦为 `1`，配置加载器必须完全跳过 `.env`，使任何未在启动命令中显式提供的云配置都不能被回填，并且在构造任何配置/数据库连接前复用严格 guard。微信回调材料、COS ID/key/bucket/region、腾讯视频业务类型/回调 token 必须逐项匹配代码中固定的无害本地占位值，且腾讯视频回调 URL 必须精确为本机 loopback 地址；`TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN`、`COS_CI_CALLBACK_TOKEN` 与 `D45_PREFLIGHT_CONFIRMATION` 必须作为环境变量显式传入空字符串，不能缺失（双重防止旧云回调材料继承）。生产预检、孤儿扫描/清理与订阅消息开关必须显式为 `false`，其余预检确认/HMAC/指纹、地图 key aliases 和订阅模板 ID 必须显式为空。六个通用后台 job（图片清理/回填、审核重试、孤儿扫描、预检及其超时）在 D46 标志下必须在执行前关闭式拒绝；验收仅允许迁移、严格 API 和 fixture-scoped 专用清理。不得继承任何云凭证、云回调、地图 key 或订阅消息配置。任一条件不满足时，验收启动器、目标探针和本地审核适配器均关闭式失败；数据库和 Redis 也仅绑定回环端口。即使经常规 `node src/server.js` 启动，只要严格 D46 runtime 成立也必须强制绑定 loopback。

该路径继续使用真实 API 认证、权限、DTO、MySQL 事务、审核状态机、回调解析、缓存头和清理路径。为避免测试触达微信、腾讯云或 COS，仅在上述全部条件成立时替换审核网络客户端为确定性、无网络的 provider-shaped adapter：文本根据无害固定标记产生 `pass`/`review`/`risky`，视频产生可被真实腾讯回调解析器关联的 JobId，图片/视频结果仍经现有回调与 `applyMediaResult` 写入。普通公开读取器、公开分享/下载/播放端点不接收该适配器产生的作者能力。

本地图片夹具可用事务后的受控元数据和 provider attempt 模拟 COS finalize 的已持久化事实；它只作用于随机 D46 fixture 行。本地未批准视频预览使用独立的、严格 gated 的短时作者 capability 并再次锁定作者/版本后读取本地文件；生产环境仍只签发私有 COS URL。验收必须在 `pending` 回调前读取图片真实字节、读取视频真实 Range 字节，再分别验证 `review`/`rejected` 后的作者预览和非作者不可发现性。拒绝后的对象清理使用只接受当前 fixture cleanup job ID 的专用 runner：它不执行全库过期/领取，也不进行 COS I/O。夹具创建可能触发自动通过的文本审核时，脚本必须先记录该作者提案 ID 的高水位、再只记录本次夹具产生的精确新增 ID；不能用用户范围、时间范围或前缀范围删除。同一专用数据库一次只允许一个验收写入者：在数据库身份校验后、任何登录或 fixture 写入前，以同一连接非阻塞获取 `GET_LOCK('pinche-d46-isolated-acceptance', 0)`；未获锁立即失败，获锁后必须覆盖 cleanup 与七表归零断言，并在断开连接前 `RELEASE_LOCK`。`finally` 清理后，专用空库中的审核 job/提案/attempt/audit 及相册媒体/upload intent/cleanup job 七张临时表必须全部为零，否则验收失败。Compose 启动前还必须拒绝 `DOCKER_HOST` 覆盖并确认当前 Docker context 的 endpoint 为本机 Unix/npipe socket。验收脚本不记录正文、对象 Key、URL、token 或云凭证。

本地图片在创建响应阶段尚未持久化 COS `object_key/object_etag` 时，作者预览只接受受控 display `photo_url`、两项对象事实均为空、正整数图片大小和精确 `local:${photo_url}:${image_byte_size}` 版本的组合；其余缺失或混合事实均关闭式拒绝。该回退还必须显式收到 `allowLocalD46Preview=true`，且该参数只能由严格 D46 runtime 注入；普通 development/test 或仅打开图片 gate 的路径不能启用它。回退不回填对象字段，因而保留本地对象的原有删除清理语义；验收夹具后续模拟 finalize 时才写入受控对象事实。
