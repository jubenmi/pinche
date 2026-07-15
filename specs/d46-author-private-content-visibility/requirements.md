# D46 Requirements：作者私有可见与审核后公开

更新日期：2026-07-15

版本：v1.0

状态：待用户复核

## 1. 目标与范围

D46 在 D45 混合内容审核之上增加“作者私有版本 + 审核后公开”的双视图发布能力：用户提交文本、图片或视频后，创建者可以在原业务位置立即看到自己提交的真实内容和审核状态；其他终端用户只能看到已审核通过的公开版本。审核不通过的内容继续仅创建者可见，创建者可取消/删除，文本可修改后重新提交，图片和视频通过删除后重新上传替换。

D46 不改变 D45 的审核服务商：文本和图片仍使用微信内容安全，视频仍使用腾讯云 CI，COS 仍为私有存储。D46 只改变作者读取与拒绝后保留策略，不放宽公共发布门禁，也不在本任务中把生产 intake 从 `closed` 切为 `moderated`。

本期覆盖 D45 已纳入审核的全部用户文本动作，以及相册图片和视频。历史已批准内容保持不变；D46 启用前已经被 D45 清理的拒绝媒体不恢复。

对于 `author_visibility_version=1` 的新媒体，D46 明确替代 D45 中“provider/admin 拒绝立即清理媒体对象”的规则；D45 的服务商、审核状态、公开门禁、回调认证和作者删除清理继续有效。版本 `0` 内容仍按 D45 处理。

## 2. 术语与核心决策

- **创建者（author）**：文本提案的 `created_by_user_id`，或媒体的 `uploader_user_id`。车局组织者、被标记用户、同车成员均不因业务关系成为创建者。
- **公开版本（published version）**：已经通过安全审核并完成业务写入的实体版本；媒体为 `approved`/`approved_legacy`。
- **作者私有版本（author-private version）**：已被服务器接受、仅创建者与审核后台可读、尚未公开或已被拒绝的内容版本。
- **作者投影（author projection）**：从受限文本提案生成、只供创建者业务接口展示的 DTO；它不是正式业务实体，不授予车局、相册、分享、通知或成员权限。
- **公共读取**：任何面向非创建者的列表、详情、搜索、推荐、计数、分享、下载、播放、缓存、通知或索引。
- **安全清除（purge）**：因创建者删除或管理员紧急处置而删除媒体对象和私有展示；它不同于普通审核拒绝。

审核状态与可见性是两个独立维度：

| 审核状态 | 创建者普通页面 | 其他终端用户 | 系统管理员审核后台 |
|---|---|---|---|
| `pending` / `processing` / `error` | 真实内容 + “仅自己可见 · 审核中” | 不可发现 | 可见 |
| `review` | 真实内容 + “仅自己可见 · 进一步审核” | 不可发现 | 可见 |
| `rejected` | 真实内容 + “仅自己可见 · 未通过” | 永久不可发现 | 可见 |
| `approved` / `approved_legacy` | 公开内容 | 按现有业务隐私规则可见 | 可见 |
| `cancelled` / `superseded` / `stale` / 已删除 | 不展示 | 不可发现 | 只保留最小审计或历史记录 |

## 3. 验收需求

### Requirement 1：作者身份与双视图不变量

1. 系统 SHALL 只使用服务端认证用户 ID 与持久化作者 ID 判断“本人”，不得相信客户端提交的作者、上传者或可见范围。
2. 普通产品页面 SHALL 只允许创建者读取自己的作者私有版本；车局组织者、同车成员、被标记用户和分享 token 均不得获得该权限。
3. `system_admin` SHALL 只通过现有审核后台读取作者私有内容，不得通过普通用户接口伪装成创建者。
4. 系统 SHALL 保持 `isModerationPublished(status)` 的严格语义：只有 `approved` 与 `approved_legacy` 为公开内容；不得把“本人”条件加入该公共判断。
5. 作者私有投影 SHALL NOT 创建或暗示任何正式业务权限、公开 ID、公开分享能力、消息通知、互动计数或搜索索引。

### Requirement 2：新内容提交后的作者即时可见

1. 文本请求被服务端校验并创建提案后，若未同步公开，SHALL 返回作者私有 DTO，使创建者在原业务位置看到所提交文本和审核状态。
2. 图片上传 finalize 成功后，SHALL 返回带作者私有预览能力的媒体 DTO；视频源对象 finalize 成功后，SHALL 允许创建者播放自己的源视频，不等待转码或内容审核完成。
3. “立即可见”从服务端接受文本提案或媒体对象 finalize 成功开始计算；上传仍在进行、格式校验失败、身份无效或 intake `closed` 不属于已发表内容。
4. 其他用户在相同时间 SHALL NOT 看到内容、占位、ID、计数变化或审核状态。

### Requirement 3：文本作者投影

1. D46 SHALL 覆盖 D45 的十个文本动作：`update_nickname`、`create_private_store`、`create_private_script`、`create_session`、`update_session`、`create_session_npc_role`、`update_session_npc_role`、`upsert_session_review`、`create_session_message`、`update_session_pinned_message`。
2. 作者投影 SHALL 由动作白名单和 `normalized_payload_json` 中的最小业务字段生成；不得返回 `openid`、手机号、内部上下文、基线、幂等键、服务商结果、命中标签或完整审核原文副本。
3. 创建类提案 SHALL 使用不与正式数字业务 ID 混淆的 `draft_id`/`content_ref` 展示；通过前不得创建车局、消息、评价、NPC、门店或剧本的正式业务副作用。
4. 修改类提案 SHALL 在创建者响应中覆盖对应公开实体的可编辑字段；非创建者继续读取公开实体。
5. `approved` 提案应用后 SHALL 停止返回作者投影；`cancelled`、`superseded` 和 `stale` 提案 SHALL NOT 出现在普通作者页面。
6. 私有门店/剧本的安全审核通过只进入原有业务审核流程，不得绕过既有目录审核或公开规则。

### Requirement 4：已公开文本的双版本修改

1. 修改已公开文本时，系统 SHALL 保留旧公开版本供其他用户读取，直到新提案审核通过并由现有 applicator 原子应用。
2. 创建者 SHALL 在相同业务详情中看到待审新版本，而不是旧公开字段，并看到明确的仅本人可见状态。
3. 新版本 `review`、`rejected` 或 `error` SHALL NOT 隐藏、覆盖或污染旧公开版本。
4. 新版本通过时 SHALL 继续执行 D45 的权限、领域约束与 `base_version` 复核；基线变化 SHALL 标记 `stale`，不得覆盖较新的业务数据。
5. 置顶消息、评价、昵称和车局/NPC 修改均 SHALL 遵循相同旧版公开、新版作者私有规则。

### Requirement 5：文本取消、删除与重新提交

1. 创建者 SHALL 可取消自己的 `pending`、`review`、`error` 或 `rejected` 文本私有版本；取消操作 SHALL 原子校验作者、提案状态与当前审核任务。
2. 取消创建类提案后，其作者卡片/气泡 SHALL 消失；取消修改类提案后，创建者 SHALL 重新看到旧公开版本。
3. 取消 SHALL 使用终态 `cancelled` 并使当前 provider attempt/重试租约失效；迟到结果 SHALL 幂等记为 stale，不得应用业务写入。
4. 创建者修改 `rejected` 文本后 SHALL 通过原业务提交接口和新的幂等键创建新提案，并显式携带 `replaces_draft_id`；服务器 SHALL 校验旧提案属于同一作者、动作和目标，再把旧提案标记为 `superseded`。
5. `pending`/`processing` 内容第一版 SHALL 只允许取消后重新提交，不允许在同一活动审核上原地覆盖，以避免服务商迟到结果竞争。
6. 提案记录 SHALL 软终结而非物理删除，以保留最小审计；普通接口不得返回已取消/被替代内容。

### Requirement 6：图片与视频作者专属预览

1. 私有 COS SHALL 继续作为媒体唯一存储；作者预览不得把桶、对象 Key、长期 URL 或云凭证直接返回客户端。
2. 只有经过认证且 `current_user.id = uploader_user_id` 的请求可获得未批准媒体的短时预览 URL；URL 有效期 SHALL 不超过 60 秒。
3. 未批准图片 SHALL 只返回显示所需的预览/缩略图能力，不返回批量下载候选；未批准视频 SHALL 优先播放已验证 display 对象，否则播放已验证 source 对象。
4. 作者预览响应 SHALL 使用 `Cache-Control: private, no-store`，并不得进入公共 CDN、共享缓存、小程序跨账号持久缓存或公开分享 DTO。
5. 未批准媒体 SHALL 禁止人物标记、公开分享、批量下载和其他会把内容传播给第三方的动作。
6. URL 签发前 SHALL 再次锁定/读取媒体状态、作者、对象 Key 与对象版本；已删除、已替换、非活动或版本不匹配时关闭式失败。

### Requirement 7：拒绝媒体保留与删除

1. D46 策略版本的新图片/视频收到 provider `Block` 或管理员普通 `reject` 后 SHALL 保持 `rejected`、仅作者可见，不再自动创建拒绝清理任务。
2. 拒绝结果 SHALL 清除所有公共展示能力，但 SHALL 保留仍受数据库记录约束的私有对象，直到创建者删除或管理员执行紧急安全清除。
3. 创建者删除图片或视频 SHALL 复用现有幂等清理队列，删除 source/display/cover/thumbnail 等全部受控对象，并使审核任务与迟到回调失效。
4. 图片和视频二进制第一版 SHALL 不支持原地编辑；创建者修改内容的产品路径为删除旧媒体后重新上传。
5. D46 启用前已经清理或缺失对象的拒绝媒体 SHALL 只显示状态，不得伪造预览或尝试恢复。
6. 管理员因法律、合规或紧急安全原因执行 purge SHALL 优先于作者保留权，必须审计且不得把内容恢复为公开。

### Requirement 8：公共发布门禁与不可发现性

1. 公共/成员列表、详情、搜索、推荐、首页、日历、话题、计数、评价聚合、未读数、标签、通知和分享 SHALL 只消费公开业务实体或 `approved`/`approved_legacy` 媒体。
2. 未批准的新建文本投影 SHALL NOT 预占正式 ID、车局座位、消息序号、评价统计、相册数量、目录条目或任何公共排序位置。
3. 未批准的修改投影 SHALL NOT 改变公共缓存键、ETag、更新时间、排序、推荐特征或通知。
4. 公开图片预览/缩略图/下载和视频播放/range/封面/下载接口 SHALL 保持现有审核校验，不得接受作者私有 URL 的 token 或参数作为公开授权。
5. 分享 token、邀请 token、车局组织者权限、相册成员资格和被标记身份 SHALL NOT 提升为作者私有读取权限。
6. 所有公共 SQL 和序列化器 SHALL 在构造响应前排除私有内容；不得先序列化再依赖客户端隐藏。

### Requirement 9：API 与 DTO 契约

1. 文本同步 Pass SHALL 保持原业务成功状态码与公开 DTO；Review/Block/Error 或异步等待 SHALL 返回 HTTP `202` 和统一作者私有 DTO，而不是伪装成已公开实体。
2. 作者私有 DTO SHALL 仅包含：`draft_id`、`content_ref`、`publication_state=author_only`、安全的 `moderation_status`/`moderation_message`、动作白名单业务字段、`published_id`（修改已有实体时）、`can_edit`、`can_delete`、`can_resubmit`。
3. 创建类私有 DTO 的 `published_id` SHALL 为 `null`；客户端不得把 `draft_id` 传给要求正式业务 ID 的接口。
4. `DELETE /api/content-moderation/author-drafts/:draftId` SHALL 只允许提案作者取消，并返回最小终态结果。
5. 重新提交 SHALL 复用原业务 POST/PATCH/PUT 接口，通过受限的 `replaces_draft_id` 关联旧提案，不新增可执行任意 action 的通用写接口。
6. 认证、权限、格式、业务约束或 intake 失败 SHALL 继续返回现有 4xx/503，不得创建可见私有版本。

### Requirement 10：状态机、并发与幂等

1. `content_moderation_jobs` SHALL 增加用户来源的终态 `cancelled`；provider、管理员和 Worker 不得从该状态继续迁移。
2. 文本提案 SHALL 增加终态 `cancelled` 与 `superseded`；同一作者、动作和目标同时最多有一个可展示私有提案。
3. 取消、替代、批准、拒绝、回调和重试 SHALL 在数据库锁与条件更新下竞争；只有一个结果可成为当前有效状态。
4. 迟到 provider 结果、旧 attempt、旧对象版本、失效租约和重复请求 SHALL 幂等结束，不能恢复被删除内容、覆盖新提案或公开私有版本。
5. 作者删除媒体 SHALL 使当前审核任务不可再发布；回调先发现取消/删除状态，再执行任何媒体状态修改。
6. 所有创建与重新提交 SHALL 使用现有幂等键；网络重试不得产生重复作者卡片、重复消息气泡或重复媒体。
7. `rejected` 版本本身 SHALL 永远保持不可公开终态；文本重提必须创建新提案/新 job，媒体重传必须创建新媒体/新对象版本，禁止把原拒绝版本重置为 `pending` 或 `approved`。

### Requirement 11：小程序体验

1. 作者私有内容 SHALL 出现在其正常业务位置，而不是要求进入独立“待审中心”。
2. 状态文案 SHALL 为“仅自己可见 · 审核中”“仅自己可见 · 进一步审核”“仅自己可见 · 未通过”；不得展示服务商、标签、分数、命中词或政治/色情等具体分类。
3. 作者 SHALL 能在原位置删除/取消；`rejected` 文本显示编辑后重新提交，`rejected` 图片/视频显示删除并重新上传。
4. 新建车局、NPC、消息、评价、私有门店/剧本等作者投影 SHALL 明确禁用依赖正式实体的分享、报名、互动、相册、选择或管理动作。
5. 修改已有公开文本时，创建者看到私有新值和状态；取消后立即回退到旧公开值。
6. 切换账号、退出登录、页面隐藏或服务端刷新 SHALL 清除不再属于当前账号的作者私有内容与媒体 URL。

### Requirement 12：管理员审核与紧急清除

1. 现有审核后台 SHALL 继续查看 Review/Error/Rejected 内容，并显示是否启用 D46 作者私有保留。
2. 管理员普通批准/拒绝 SHALL 保持审计；普通拒绝不清除 D46 媒体，紧急 purge 必须为独立明确动作、要求原因并二次确认。
3. 管理员决定后的 provider 迟到结果 SHALL 继续幂等，不得改变公开或作者私有版本。
4. 管理后台预览 URL 与作者预览 URL SHALL 使用不同授权入口和审计维度。

### Requirement 13：缓存、隐私与日志

1. 作者私有响应 SHALL `private, no-store`；任何包含可变身份数据的接口 SHALL 正确设置 `Vary` 或完全禁用共享缓存。
2. 服务端日志、指标、错误、审计摘要和追踪 SHALL NOT 包含私有正文、对象 Key、可复用 URL、access token 或服务商敏感结果。
3. 小程序 SHALL NOT 把作者私有媒体 URL 写入跨账号持久缓存、分享参数、剪贴板或埋点。
4. 作者预览 URL 泄漏监控 SHALL 使用低基数原因码，不记录 URL 本身。

### Requirement 14：迁移、功能门禁与回滚

1. 文本提案和媒体 SHALL 保存 `author_visibility_version`；只有创建时明确写入 D46 策略版本的内容可使用作者私有真实内容能力。
2. 历史提案和媒体 SHALL 默认版本 `0`，不回填私有正文或恢复已删除对象。
3. 文本、图片、视频 SHALL 使用独立、默认关闭的 D46 功能门禁；D45 intake/provider 能力开关仍独立生效。
4. 文本门禁 SHALL 额外使用 `CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ACTIONS` 配置固定十个 action 的显式子集；默认空集保持关闭，未知、重复或超出白名单的值 SHALL 启动失败，不能默认为全部动作。
5. 回滚 SHALL 先关闭新的 D46 写入与作者 URL 签发，保留 D45 公共门禁、审核回调和 Worker；不得批量批准、恢复或公开任何私有内容。
6. 已按 D46 保留的拒绝媒体在回滚时 SHALL 保持私有并由受控清理流程处理，不得因配置切换成为孤儿或公开对象。
7. D46 发布 SHALL NOT 自动把生产 intake 切为 `moderated`；真实流量启用需独立审批和观察。

### Requirement 15：可观测性

1. 系统 SHALL 按内容类型和安全状态统计作者私有创建、读取、取消、替代、批准、拒绝和 purge；指标不得包含作者 ID 或正文。
2. 系统 SHALL 监控作者 URL 签发拒绝、公共门禁拒绝、私有 DTO 泄漏断言、被取消任务迟到结果和保留媒体对象数量/字节。
3. 公共接口返回私有 `draft_id`、私有 URL 或未批准内容 SHALL 触发高优先级告警。
4. 拒绝媒体保留量和长期未删除数量 SHALL 有容量告警，但本期不自动替作者删除。

### Requirement 16：测试与验收

1. SHALL 先写失败测试，再实现状态机、仓储、投影、API、媒体 URL、小程序和泄漏门禁。
2. 每个文本动作 SHALL 测试：新建/修改作者视图、非作者视图、批准、拒绝、取消、替代、基线 stale 与重复请求。
3. 图片和视频 SHALL 测试：作者真实预览、非作者 404/403、分享隔离、60 秒 URL、版本竞争、拒绝保留、作者删除清理和迟到回调。
4. SHALL 验证公共列表、详情、搜索、计数、分享、下载、播放、标签、通知、缓存和客户端本地状态无私有内容泄漏。
5. SHALL 通过迁移检查、D45 回归、D46 专项单测、管理后台/小程序构建、根 `npm run check` 和受控发布验证。

## 4. 非目标

- 不改变微信/腾讯云审核策略、阈值或服务商。
- 不向其他成员、车局组织者或被标记用户开放待审内容。
- 不做公开草稿协作、共同编辑、评论草稿或内容版本历史 UI。
- 不支持图片/视频二进制原地编辑；通过删除并重新上传替换。
- 不做产品化申诉、自动封号或自动处罚。
- 不恢复 D46 上线前已删除的拒绝媒体。
- 不在本任务中开启生产真实流量。
