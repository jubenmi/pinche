# D46 Tasks：作者私有可见与审核后公开

更新日期：2026-07-17

版本：v1.0

状态：用户已确认，实施中

> 本清单以 D45 已完成的审核状态机、文本提案、私有 COS、媒体门禁和管理员审核为前置。所有任务遵循 TDD：先写失败测试并确认 RED，再做最小实现、运行定向测试、运行 D45/D46 回归并提交。D46 不在任务中开启生产 intake。

## D46 执行任务

- [x] D46.1 锁定 Spec 与防偏航契约。
  - [x] 新增 `scripts/d46-author-private-content-check.js`，静态检查 `isModerationPublished` 仍只允许 `approved/approved_legacy`，禁止公共路径出现作者绕过条件。
  - [x] 新增 `apps/api/test/content-moderation-author-visibility-contract.test.mjs`，锁定三个文档版本、十个文本 action、作者身份、202 DTO、60 秒 TTL、拒绝媒体保留与独立生产门禁。
  - [x] 在 `package.json` 增加 `d46:check` 并接入根 `precheck`；先运行并记录因实现缺失而 RED。
  - [x] 定向命令：`node --test apps/api/test/content-moderation-author-visibility-contract.test.mjs`；预期在实现前因缺少 D46 模块/迁移失败，而不是因测试语法失败。

- [x] D46.2 增加兼容迁移与状态机。
  - [x] 新增迁移 `apps/api/migrations/0030_author_private_content_visibility.sql`：为文本提案增加 `target_subject_id`、`author_visibility_version`、`cancelled_at`、`superseded_by_proposal_id` 与作者目标索引；为 `session_album_photos` 增加 `author_visibility_version`。
  - [x] 修改 `apps/api/src/modules/album-video/migration.js`，以 MySQL/TDSQL-C 兼容方式补齐、校验并幂等重跑上述列、索引和外键。
  - [x] 修改 `apps/api/src/modules/content-moderation/state-machine.js`：增加 job `cancelled` 用户终态，以及 proposal `cancelled`/`superseded` 终态；provider/admin 不得从这些状态迁移。
  - [x] 新增 `apps/api/test/content-moderation-author-visibility-migration.test.mjs` 与状态机用例，覆盖空库、升级库、重复迁移、历史版本 0、非法迁移和迟到结果。
  - [x] 运行：`node --test apps/api/test/content-moderation-author-visibility-migration.test.mjs apps/api/test/content-moderation-state-machine.test.mjs`；预期全绿。

- [x] D46.3 实现纯作者可见性策略与安全 DTO。
  - [x] 先新增失败测试 `apps/api/test/content-moderation-author-visibility.test.mjs`，覆盖 author/organizer/member/tagged/admin/anonymous、全部审核状态、policy version 和 record status 矩阵。
  - [x] 新增 `apps/api/src/modules/content-moderation/author-visibility.js`，实现 `resolveAuthorVisibility`；不得修改 `packages/shared/src/albumMedia.js` 中 `isModerationPublished` 的公开语义。
  - [x] 新增 `apps/api/src/modules/content-moderation/author-dto.js`，只序列化 Spec 允许的字段和三类安全文案，拒绝未知 action/status/字段。
  - [x] 验证普通 system_admin 请求不获得 author scope，管理员审核预览继续走 `admin-api.js`。
  - [x] 运行：`node --test apps/api/test/content-moderation-author-visibility.test.mjs apps/api/test/content-moderation-media-gates.test.mjs`；预期全绿。

- [x] D46.4 实现作者文本提案仓储、取消与替代。
  - [x] 先新增失败测试 `apps/api/test/content-moderation-author-drafts.test.mjs`，覆盖按作者/action/target 查询唯一最新投影、并发锁、取消、替代、重复请求和非作者拒绝。
  - [x] 修改 `apps/api/src/modules/content-moderation/repository.js`：创建提案时写入 `target_subject_id`/policy version；新增精确查询、原子 cancel、rejected→superseded、退休 attempt 和 lease 清理方法。
  - [x] 新增 `apps/api/src/modules/content-moderation/author-drafts.js`，封装所有权校验和取消事务；不得把任意 action/payload 执行能力暴露给通用 API。
  - [x] 修改 `apps/api/src/server.js`，新增 `DELETE /api/content-moderation/author-drafts/:draftId`，在通用业务路由之前精确匹配并使用现有认证。
  - [x] 确保取消 pending/review/error/rejected 后 Worker、管理员普通决定和迟到 provider 结果均不能应用。
  - [x] 运行：`node --test apps/api/test/content-moderation-author-drafts.test.mjs apps/api/test/content-moderation-retry.test.mjs apps/api/test/content-moderation-callback.test.mjs`；预期全绿。

- [x] D46.5 调整文本审核提交结果与重新提交协议。
  - [x] 先扩展 `apps/api/test/content-moderation-text-service.test.mjs`：D46 gate 开启时 Pass 返回公开实体，Review/Block/Error 返回作者 DTO；gate 关闭时保持 D45 行为。
  - [x] 修改 `apps/api/src/modules/content-moderation/service.js`，只有提案已持久化且 policy version=1 时把非 Pass 归一为 author-private outcome；不得把验证/身份/intake 错误变为 202。
  - [x] 修改 `apps/api/src/modules/content-moderation/text-boundaries.js`，从 action/context 生成并校验 `target_subject_id`，读取受限 `replaces_draft_id` 但不把它纳入审核正文。
  - [x] 修改 `apps/api/src/server.js` 的 `moderateCoveredText` 响应适配：公开实体保留原状态码，作者私有结果使用 202；业务路由不得 fall through 二次写入。
  - [x] 实现 rejected 重新提交：先成功创建新 job/proposal，再在同一事务 supersede 同作者/动作/目标旧提案；失败时旧投影保持可见。
  - [x] 运行：`node --test apps/api/test/content-moderation-text-service.test.mjs apps/api/test/content-moderation-text-server-wiring.test.mjs apps/api/test/content-moderation-text-boundaries.test.mjs`；预期全绿。

- [x] D46.6 实现十个动作的作者文本投影器。
  - [x] 先新增失败测试 `apps/api/test/content-moderation-author-text-projection.test.mjs`，逐个锁定十个 action 的允许字段、正式 ID/草稿 ID、禁用动作和敏感字段剔除。
  - [x] 新增 `apps/api/src/modules/content-moderation/text-author-projection.js`，为每个 action 写显式 projector；default 必须失败，禁止透传 `normalized_payload_json`。
  - [x] 创建类投影返回 `published_id=null`、`is_draft=true`；修改类投影保留正式 ID 并只覆盖被审核字段。
  - [x] 验证手机号、openid、context、base version、幂等键、provider 标签/分数和审核正文不进入 DTO。
  - [x] 运行：`node --test apps/api/test/content-moderation-author-text-projection.test.mjs apps/api/test/content-moderation-text-proposal-applicator.test.mjs`；预期全绿。

- [x] D46.7 集成昵称、私有门店和私有剧本作者视图。
  - [x] 先新增 API 契约测试：`GET /api/users/me` 只给本人覆盖 `update_nickname` 待审昵称，其他用户资料仍为旧值；门店/剧本本人列表追加 `create_private_store`/`create_private_script` 草稿，公共目录不追加。
  - [x] 修改 `apps/api/src/modules/core/service.js` 的本人资料、`listActiveStores`、`listActiveScripts` 读取，在完成原权限后显式合并对应 action 投影。
  - [x] 修改 `apps/api/src/server.js` 只对包含作者投影的认证响应设置 `private, no-store`；公共目录响应保持无 draft 字段。
  - [x] 修改 `apps/miniprogram/src/pages/mine/index.vue`、`apps/miniprogram/src/pages/session/script.vue` 和相关 API 适配，原位置显示草稿状态并禁用正式选择/分享动作。
  - [x] 验证安全审核通过后的门店/剧本仍进入 D33 目录审核，不因 D46 自动公开。

- [x] D46.8 集成车局创建/修改与 NPC 作者视图。
  - [x] 先新增后端测试：本人日历/车局列表追加 `create_session` 草稿卡；公共近期、城市发现、游客日历和分享详情完全不返回草稿。
  - [x] 修改 `apps/api/src/modules/core/service.js` 的本人车局读取、`getSessionForViewer` 和 NPC 列表，仅对创建者合并 `create_session`、`update_session`、`create_session_npc_role`、`update_session_npc_role` 投影。
  - [x] 修改 `apps/miniprogram/src/components/SessionCalendar.vue`、`pages/session/create.vue`、`detail.vue`、`manage.vue`、`setup.vue`，显示原位置私有值并禁用草稿车局的分享、报名、相册与管理动作。
  - [x] 验证车局组织者不是对应文本创建者时不能读取其他人的私有版本；普通成员继续看旧公开值。
  - [x] 运行 D38/D39/D40 城市与游客读取回归，证明公共日历无草稿泄漏。

- [x] D46.9 集成评价、聊天消息和置顶消息作者视图。
  - [x] 先新增测试：`getMySessionReview` 返回本人新投影，公共评价/平均分继续使用旧批准值；新建评价草稿不计数。
  - [x] 修改 `apps/api/src/modules/core/service.js` 的本人评价读取和公开评价聚合，显式分离 `upsert_session_review` 投影。
  - [x] 修改 `packages/talk/api/service.js`、`packages/talk/api/routes.js`、`packages/talk/miniprogram/ChatEntry.vue`、`packages/talk/miniprogram/ManagePinnedMessage.vue` 及 `apps/miniprogram/src/extensions/session-pseudo-chat/` 适配，只向发送者连接追加 `create_session_message` 临时气泡；不落正式消息、不增加未读、不广播。
  - [x] 置顶消息只给操作者返回 `update_session_pinned_message` 覆盖，其他连接继续看到旧置顶文本。
  - [x] 修改 `apps/miniprogram/src/pages/session/review.vue` 和聊天 UI，支持状态角标、取消及 rejected 编辑重提。
  - [x] 运行 talk 包测试、D18/D23 相册成员回归和 D45 文本测试；预期全绿。

- [x] D46.10 实现图片/视频作者专属预览。
  - [x] 先新增失败测试 `apps/api/test/content-moderation-author-media-preview.test.mjs`，覆盖图片/视频 author、organizer、member、tagged、admin 普通接口、anonymous 和分享 token。
  - [x] 修改 `apps/api/src/modules/core/service.js` 的 `albumMediaResponse`/媒体查找：已批准走原分支，未批准只在 uploader + policy version 1 时产生 author-private DTO。
  - [x] 修改 `apps/api/src/server.js` 的图片 URL 附加和视频 URL 路由，新增作者签发器；合法 TTL `1..60`，默认/最大 60 秒，响应 `private, no-store`。
  - [x] 视频作者预览优先合法 display，回退合法 source；路径/ETag/record status 变化时关闭式失败。
  - [x] 未批准媒体不得返回 `download_url`、标签能力、分享能力或公共媒体 token。
  - [x] 运行：`node --test apps/api/test/content-moderation-author-media-preview.test.mjs apps/api/test/content-moderation-media-gates.test.mjs apps/api/test/album-image-response-urls.test.mjs`；预期全绿（仓库中无任务草案所写的 `album-media-cos-direct.test.mjs`，使用现有等价直传 URL 回归文件）。

- [x] D46.11 改造拒绝媒体保留、作者删除与管理员 purge。
  - [x] 先扩展 `apps/api/test/content-moderation-service.test.mjs` 和管理员决定测试：policy version 1 的 provider/admin reject 不 enqueue cleanup；version 0 保持 D45 行为。
  - [x] 修改 `apps/api/src/modules/content-moderation/service.js`，按媒体持久化 policy version 决定普通 reject 是否清理，不能只读当前配置。
  - [x] 修改 `apps/api/src/modules/core/service.js` 的图片/视频删除事务：同时把活动审核 job 置 cancelled、退休 attempt，再复用现有 cleanup 队列删除所有对象。
  - [x] 修改 `apps/api/src/modules/content-moderation/orphan-scan.js`，有 active/rejected D46 媒体记录的对象不是孤儿；缺失业务记录仍按 D45 安全窗口处理。
  - [x] 在 `apps/api/src/modules/content-moderation/admin-api.js` 和 `apps/api/src/server.js` 增加独立 purge 动作：system_admin、必填原因、二次确认、审计、幂等清理；普通 reject 不 purge。
  - [x] 验证作者删除、purge、迟到转码输出、旧 lease、对象 404 和部分清理失败均安全重试且不恢复媒体。

- [x] D46.12 实现小程序统一作者私有媒体体验。
  - [x] 先新增 `apps/miniprogram/test/authorPrivateContent.test.mjs`，锁定三类文案、原位置显示、真实预览、禁用下载/标签/分享、删除与账号切换清理。
  - [x] 修改 `apps/miniprogram/src/utils/contentModeration.js`，增加带“仅自己可见”的作者文案映射；普通公开状态文案保持兼容。
  - [x] 修改 `apps/miniprogram/src/pages/session/album.vue`，允许 `publication_state=author_only && is_mine` 渲染预览/视频，但 `isDownloadableAlbumImage`、标签、分享和时间线继续只认公开状态。
  - [x] 修改 `apps/miniprogram/src/utils/albumMediaUrls.js`，把作者预览选择与公共下载候选拆成不同函数，禁止把作者 URL 进入下载/分享集合。
  - [x] 页面刷新、隐藏、退出或账号变化时清理作者 URL 和投影；服务端不再返回时立即移除本地卡片。
  - [x] 运行：`node --test apps/miniprogram/test/authorPrivateContent.test.mjs apps/miniprogram/test/contentModeration.test.mjs apps/miniprogram/test/albumMediaUrls.test.mjs`；预期全绿。

- [x] D46.13 完成公共路径、防缓存和防泄漏验证。
  - [x] 新增 `apps/api/test/content-moderation-author-leak-gates.test.mjs`，逐项检查公共列表、详情、搜索、推荐、首页、日历、计数、评价聚合、未读、标签、通知、分享、下载、播放、Range 和封面。
  - [x] 断言公共响应不含 `draft_id`、`content_ref`、`author_only`、未批准正文或作者 URL；包含作者数据的响应必须 `private, no-store`。
  - [x] 修改 `apps/api/src/modules/core/session-album-media-count.js`、相关 SQL/序列化器和 server 缓存头，只做满足断言的最小调整。
  - [x] 增加日志/指标 canary 测试，证明正文、对象 Key、签名 URL 和服务商敏感字段不进入输出。
  - [x] 运行 D31/D32/D38/D39/D40/D45 的静态与单测回归，任何公共行为变化即停止。

- [x] D46.14 补齐配置、指标与容量告警。
  - [x] 修改实际配置入口 `apps/api/src/config/env.js`、`.env.example` 和生产 compose 示例，增加三个默认关闭的 D46 gate、固定十个 action 的显式子集配置与严格 TTL 校验；空 action 集保持关闭，未知/重复 action 或非法 TTL 启动失败且不输出配置值。
  - [x] 修改 `apps/api/src/modules/content-moderation/telemetry.js`，增加低基数 author-private create/read/cancel/supersede/reject/purge 和访问拒绝指标。
  - [x] 增加保留拒绝媒体对象数量/字节和长期未删除数量告警；不自动删除用户内容。
  - [x] 管理后台详情显示 `author_private_retained`，但不显示作者 URL、对象 Key 或服务商敏感结果。
  - [x] 更新生产手册，明确 D46 gate 与 D45 intake 独立、回滚顺序和紧急 purge 操作边界。

- [x] D46.15 建立专项自动化与完整回归。
  - [x] 新增 `scripts/d46-author-private-content-smoke.js`，使用假 provider 与隔离数据验证文本新建/修改、图片、视频、取消、替代、拒绝保留、作者删除和非作者不可发现。
  - [x] 在 `package.json` 增加 `d46:unit`、`d46:check`、`d46:smoke` 并接入根 `precheck`。
  - [x] 运行迁移 dry run、`npm run d46:unit`、`npm run d46:check`、`npm run d46:smoke`、`npm run d45:unit`、`npm run d45:check`、`npm run d45:smoke` 和根 `npm run check`。
  - [x] 保留 RED→GREEN 命令与结果；不得以静态搜索代替业务/安全测试。

- [x] D46.15A 微信开发者工具本地运行验收。
  - [x] 从当前 D46 提交重新构建并导入微信开发者工具，确认编译和启动无阻断错误。
  - [x] 检查控制台、作者私有状态文案及关键交互门禁；不得修改生产数据，正式交互验收使用隔离 Mock，任何意外生产只读访问必须记录并立即停止。
  - [x] 记录开发者工具版本、构建提交和本地验收结论；不得据此勾选生产发布任务。

- [ ] D46.16 受控发布与验收。
  - 收口中（2026-07-17）：严格本机隔离 HTTP 验收实现、串行化复验、七表零残留断言和根级回归均已完成；当前仅处理该批验收基础设施的最终 spec/code review、提交及 develop→main→publish 受控 CI 发布。生产 D45 intake 与 D46 gate 不在本轮开启，真实流量仍属于 requirements 明确排除且需独立审批的后续事项。
  - 进行中（2026-07-16）：已完成全部 D46 gate=false 的生产迁移、镜像部署与基线核验；小程序源码及开发/生产构建产物继续指向 `https://api.pinche.jubenmi.com`。尚未开启任何 D46 gate，也未改变 D45 intake；后续真实流量验收仍需逐项独立审批。
  - 2026-07-16：已在无 `.env` 的隔离 worktree 完成 D46 专用 HTTP smoke 基础设施；它使用 D40 风格身份夹具、D42 风格本地数据库隔离/清理，并且只允许严格本机 runtime 选择无网络 provider-shaped adapter。
  - 2026-07-16：用户已明确授权完整受控验收；执行顺序固定为 D45 预演（intake 保持 `closed`）→ 文本 → 图片 → 视频。每一类完成验证后立即恢复对应 intake 与 D46 gate 为 `closed`/`false`，不得扩大到其他服务或用户流量。
  - 2026-07-16：当前生产镜像上的 D45 前置预检已完成：文本 `passed/pass/not_required`，图片、视频均为 `passed/pass/deleted`；预检临时容器已删除。最终 API 三类 intake 均为 `closed`，D46 文本/图片/视频 gate 均为 `false`，API 与数据库健康检查为 200。D46 多账号真实可见性条目仍未执行：缺少隔离测试账号/会话与经批准的无害非 Pass 固定结果，不能以向全体生产用户打开 gate 的方式替代。
  - 进行中（2026-07-16）：已新增并复核隔离 HTTP 验收实施计划 `docs/superpowers/plans/2026-07-16-d46-isolated-http-acceptance.md`。该计划固定为回环 MySQL/Redis、专用 `pinche_d46_test`、真实 HTTP/数据库/回调路径和严格 gated 本地 provider-shaped adapter；不得打开生产 intake 或 D46 gate。
  - 2026-07-16：本地 D46 专用 Compose 首次运行时，MySQL/Redis 虽健康但 Docker `internal: true` 未发布所需回环端口；已先以静态契约复现 RED，再仅移除该网络属性，保留专用项目/网络和精确 `127.0.0.1:3346`、`127.0.0.1:6446` 绑定。复建后两端口确认仅本机监听，迁移及真实本地 HTTP 验收完成后已删除该专用 Compose 项目、卷和网络。
  - [x] 先以全部 D46 gate=false 发布迁移与代码，核验公共 API 字段、缓存头、D45 Worker、回调、健康检查和三个 intake 无变化。
  - [x] 严格本机隔离多账号 HTTP 验收：D46 标志在读取 `.env` 前关闭式校验，严格锁定回环 MySQL/Redis、假微信/COS 值、回环视频回调及显式关闭的云能力；六个通用 job 在该标志下直接拒绝执行。Docker context 已验证为本机 Unix socket，32 项迁移在专用 `pinche_d46_test` 完成。夹具自动产生的 `session_create` 审核记录由高水位补收集，验收同连接以非阻塞 MySQL 命名锁串行化；实测占锁时第二轮在任何 fixture 写入前失败，七张临时审核/相册表独立统计为 `0/0/0/0/0/0/0`。释放锁后，诊断与正常多账号 HTTP 验收均通过，最终独立统计仍为 `0/0/0/0/0/0/0`；专用 API、容器、卷、网络及 3046/3346/6446 监听均已清理。独立安全复核通过。本项不代表生产真实流量开启或服务商替代验证。
  - [ ] 使用无害测试账号按 action 白名单分批开启文本作者投影；逐项验证作者原位置、其他账号、匿名/分享、取消、重提和公开旧版本。
  - [ ] 分别开启图片、视频作者预览，验证 60 秒 URL、源/display 选择、拒绝保留、作者删除清理、容量指标和非作者拒绝。
  - [ ] 记录功能 gate、镜像摘要、迁移版本、测试账号、结果类别和清理结论；不记录正文、对象 Key 或可复用 URL。
  - [ ] 任一私有内容进入公共响应、共享缓存或其他账号即关闭对应 D46 gate；不得通过放宽门禁修复。
  - [ ] D46 验收通过后仍保持 D45 intake 原状态；开启真实新内容必须另行审批。

## D46 验收清单

- [ ] 创建者在原位置立即看到自己的待审/拒绝文本、图片和视频真实内容。
- [ ] 其他终端用户、组织者、成员、被标记用户、匿名和分享 token 永远看不到未批准内容或其存在性。
- [ ] 修改已公开文本时，其他用户继续看到旧版本，创建者看到新私有版本。
- [ ] 文本取消/重新提交与媒体删除在并发、重试和迟到回调下保持幂等。
- [ ] D46 拒绝媒体保留给作者，作者删除或管理员 purge 才进入对象清理。
- [ ] 公共列表、详情、搜索、计数、分享、下载、播放、标签、通知和缓存无私有内容泄漏。
- [ ] 十个文本动作、图片、视频、管理员后台和小程序均通过专项及 D45 回归。
- [ ] 完整 `npm run check`、迁移检查和受控发布验证通过。
- [ ] D46 发布不改变生产 intake，任何真实流量开启均有独立审批。

## 验证记录

- 2026-07-15：完成需求梳理与行业公开行为核对；用户确认采用方案 A、原位置显示、旧公开版本保持、仅创建者可见，以及拒绝后由创建者删除/文本修改重提。本文件仅为待复核计划，尚未修改业务代码、数据库或生产环境。
- 2026-07-15 D46.1 RED-1：`node --test apps/api/test/content-moderation-author-visibility-contract.test.mjs` 按预期失败，原因是 `scripts/d46-author-private-content-check.js` 尚不存在，证明新契约测试已生效。
- 2026-07-15 D46.1 RED-2：补齐静态检查器和根命令后再次运行同一测试，按预期因缺少 `0030_author_private_content_visibility.sql` 失败；不是测试语法错误。D46.2/D46.3 补齐迁移和策略模块后再转 GREEN。
- 2026-07-15 D46.2 RED：迁移/状态机定向测试按预期因缺少 `AUTHOR_PRIVATE_CONTENT_VISIBILITY_MIGRATION` 导出、job `cancelled` 与 proposal `cancelled/superseded` 迁移失败。
- 2026-07-15 D46.2 GREEN：迁移、状态机及 D45 回归共 88 项通过；覆盖首次升级、历史默认版本 0、幂等重跑、DDL 后迁移记录失败重跑、错误结构关闭式失败和迟到结果不可复活。
- 2026-07-15 D46.3 RED：作者策略定向测试按预期因 `author-visibility.js` 尚不存在失败；随后独立 worktree 依赖解析回退到主目录旧版 shared，使用本机已有 submodule Git 对象和离线 workspace 安装修复测试环境，未访问生产。
- 2026-07-15 D46.3 GREEN：作者身份/状态/策略版本、安全 DTO、D45 媒体公共门禁、管理员审核回归及 D46 契约共 33 项通过；`npm run d46:check` 通过，D46.1 的预期 RED 已转 GREEN。
- 2026-07-15 D46.4 RED：作者草稿定向测试按预期因 `author-drafts.js` 尚不存在失败；补实现后又由路由源码定位断言发现测试匹配串过严，修正为匹配实际正则路由，不改变实现。
- 2026-07-15 D46.4 GREEN：作者草稿、仓储、重试、回调、管理员与 D45 仓储回归共 91 项通过；取消在单事务内条件更新 proposal/job、清 lease、退休 attempt，替代按固定锁顺序验证新旧提案，HTTP 只暴露精确 DELETE。
- 2026-07-15 D46.5 RED：文本服务、边界、HTTP 适配和替代幂等测试按预期因缺少 `parseTextDraftReplacement`、202 响应适配、author-private outcome 与替代重放失败；原 D45 用例继续通过。
- 2026-07-15 D46.5 GREEN：D46.5 定向用例 61 项通过；随后作者可见性、草稿、文本、仓储、重试、回调、管理员回归共 150 项通过，`npm run d46:check` 通过。非 Pass 仅在当前 gate/action 与持久化 version 1、作者、目标全部一致时返回安全 DTO；验证/身份/intake 仍走原错误，替换控制字段不进入审核正文。
- 2026-07-15 D46.6 RED：十动作投影定向测试按预期因 `text-author-projection.js` 不存在失败；不是测试语法错误。
- 2026-07-15 D46.6 GREEN：十个 action 显式投影、嵌套克隆、创建/修改身份和敏感字段剔除测试通过；联合 applicator、作者策略、草稿、文本、仓储、回调、重试与管理员回归共 156 项通过，`npm run d46:check` 与 `git diff --check` 通过。
- 2026-07-15 D46.7 RED：作者读取和小程序适配测试分别按预期因缺少 `author-text-read.js` 与 `authorPrivateText.js` 失败。D33 首次回归发现其源码断言写死两参数调用；确认认证用户参数未变后，仅扩展断言允许第三个受控读取器参数。
- 2026-07-15 D46.7 GREEN：作者读取器、资料覆盖、门店/剧本草稿追加、安全客户端适配共 37 项定向测试通过；`build:mp-weixin`、D33 私有目录检查、通用小程序检查和 `npm run d46:check` 通过。草稿 ID 未提升为正式 ID，创建流程中的待审门店/剧本不可选择。
- 2026-07-15 D46.8 RED：车局/NPC 作者读取测试按预期因 `author-session-read.js` 不存在失败；小程序扩展测试随后因缺少车局/NPC 草稿适配导出失败。
- 2026-07-15 D46.8 GREEN：车局/NPC 作者读取与客户端草稿约束共 6 项定向测试通过，`build:mp-weixin` 成功；D38 城市发现、D39 城市只读预览、D40 游客日历、D21 我的日历与 `npm run d46:check` 全部通过。创建类车局/NPC 无正式 ID，不能分享、报名、进入相册或管理；取消只调用作者草稿 DELETE。
- 2026-07-15 D46.9 RED：评价/聊天/置顶作者视图测试先因缺少 `author-social-read.js` 失败；客户端测试随后因缺少 202 投影适配、未读隔离和取消/替代 API 导出失败。talk 旧测试夹具也暴露未注入 D46 状态码辅助函数，按实际 server context 补齐。
- 2026-07-15 D46.9 GREEN：评价只在 `getMySessionReview` 覆盖本人编辑态，公开评价查询不读草稿；聊天只给发送者追加无正式 ID 的临时气泡，未读计算先排除作者投影；置顶仅覆盖操作者读取。状态角标、取消和 rejected 编辑重提已接入评价与 talk 两套小程序组件。talk 全包、D18/D23、D45 共 496 项、`build:mp-weixin`、`npm run d46:check` 与 diff 检查全部通过。D45 常量旧断言同步纳入 D46 用户取消终态 `cancelled`。
- 2026-07-15 D46.10 RED：作者媒体专项测试按预期因缺少 `author-media-preview.js` 失败；补齐纯策略后，路由静态断言继续因尚未接入专属图片能力路径失败，证明服务器接线检查有效。
- 2026-07-15 D46.10 GREEN：图片仅 uploader + v1 获得最长 60 秒的独立 HMAC 能力 URL，能力载荷只含对象版本指纹；视频 URL API 仅本人可把合法 display/source 签为 60 秒 COS URL。响应不含对象 Key/ETag、下载、标签、封面或分享能力，公共 getter 保持原批准门禁。专项与图片/视频/COS/D45 媒体回归共 94 项及 URL 定向 12 项通过。
- 2026-07-15 D46.11 RED：新增拒绝保留/删除/purge 契约测试后，按预期因缺少 `parseAdminModerationPurgeBody` 与持久化媒体保留判断导出失败；不是测试语法错误。补齐初版后，迟到删除中视频用例继续发现 processing lookup 只允许 active，证明 deleting 回调合并分支尚未真正可达。
- 2026-07-15 D46.11 GREEN：普通 provider/admin reject 仅对持久化 `author_visibility_version=1` 的 active 图片/视频保留对象，版本 0 继续 D45 清理。作者图片/视频 DELETE 统一取消精确版本审核、退休 attempt、标记 deleting 并复用耐久 cleanup；旧 lease 重排不丢 attempts。独立管理员 purge 要求 system_admin、原因和字面量 `PURGE`，重复/已完成请求只审计一次。active D46 拒绝视频可吸收合法迟到 display/cover，deleting 只扩充清理；orphan scan 将 active/rejected D46 记录视为受保护引用。D45 单元回归 514 项、D45/D46 静态检查、D42 删除兼容检查及 diff 检查全部通过。
- 2026-07-15 D46.12 RED：作者私有媒体客户端专项测试先因缺少作者文案与预览策略导出失败；补齐工具后，页面接线断言继续因相册仍未使用作者预览分支失败。账号切换顺序测试还识别出 `onShow` 的跳过刷新判断早于身份清理，证明生命周期边界测试有效。
- 2026-07-15 D46.12 GREEN：相册仅对当前 uploader 的 `author_only + can_preview` 行在原位置展示短时图片或视频，三类安全文案生效；下载、标签、分享与时间线仍只认批准状态。作者图片只保存在当前页面内存，不进入文件缓存；隐藏、退出、统一登录态事件、账号切换和服务端移除都会清理私有行、URL、异步请求与预览。D46.12 定向 27 项、小程序全量 51 项、D45 回归 514 项、`build:mp-weixin`、`npm run d46:check` 与 diff 检查全部通过。
- 2026-07-15 D46.13 RED：公共泄漏专项先因缺少 `response-privacy.js` 失败；补齐首版后，防御性测试证明公开相册序列化器仍会信任上游并保留注入的 `author_only` 行。D31 回归随后暴露其动态页面夹具缺少新预览方法，不是产品行为变化。
- 2026-07-15 D46.13 GREEN：新增有界、循环安全的作者私有响应识别与低基数泄漏 canary，告警只含 route/reason/priority，观测失败也不能阻止关闭式拒绝；所有作者响应统一 `private, no-store`。公开相册序列化器再次按批准状态过滤并重算可见数，即使上游误传私有行也不输出。计数 SQL 无需调整，继续只认批准状态；D31/D32/D38/D39/D40、D45 静态检查和含新增用例的 D45 520 项回归全部通过。
- 2026-07-15 D46.14 RED：新增作者私有运维专项测试后，按预期因缺少 `emitAuthorPrivateRetentionSnapshot` 导出失败；补齐初版后继续识别 TTL 错误会回显非法值片段、管理端测试路径写错两个独立问题，分别修正为不含配置值的稳定错误和正确仓库路径。
- 2026-07-15 D46.14 GREEN：五项 D46 配置进入实际运行时，三个 gate 默认关闭，文本 action 仅接受十项显式无重复子集，TTL 严格限制 `1..60`；生产媒体 gate 额外要求私有 COS。新增作者私有生命周期、访问拒绝和公共泄漏低基数指标；重试 Worker 统计 active/rejected/version 1 媒体数量、图片/视频字节与 30 天长期保留量，只告警不删除。后台列表纳入 Rejected，详情仅增加 `author_private_retained`；生产手册明确与 D45 intake 独立、回滚和 purge 边界。D46.14 专项 8 项、配置/仓储/服务/草稿/Worker/管理端定向回归 149 项、`npm run d46:check`、`npm run d45:check` 与 diff 检查全部通过。
- 2026-07-15 D46.15 RED：专项 smoke 与根级全回归接入后，完整 `npm run check` 先后识别出 D42 视频 INSERT 参数、通用小程序 URL/下载契约，以及 D15 日历去重、D18 图片耐久删除四组旧静态断言仍锁定改造前源码形态。逐项核对现行业务测试与实现后，仅更新兼容断言以覆盖 D46 新字段、作者 URL 分支和现有耐久删除协议，没有放宽公开可见性或修改业务逻辑。
- 2026-07-15 D46.15 GREEN：迁移模拟 dry run 5 项、首轮 `d46:unit` 134 项、进程内 smoke 96 项、`d45:unit` 529+8 项、`d45:smoke` 77 项全部通过；`d46:check`、`d45:check`、根级 `check` 及 D42/D15/D18/小程序兼容检查全绿。管理端生产构建和微信小程序构建成功。smoke 明确使用假 provider 与隔离的内存适配器，不伪装为数据库集成测试，也不连接 live API、数据库、Redis、COS、微信或腾讯云。
- 2026-07-15 D46.15 REVIEW RED：独立代码评审发现四项 Important：取消/替代提案可被幂等重放复活、作者媒体预览与删除存在 TOCTOU、视频迟到回调未绑定完整输入/任务/输出身份，以及十动作 smoke 只做行状态模拟。前三项定向失败测试均复现；真实十动作生命周期矩阵随后进一步复现了替换草稿进入 `review` 后同一请求无法幂等重放的问题。
- 2026-07-15 D46.15 REVIEW GREEN：取消/替代/失效提案重放关闭式失败；图片能力校验、图片读取和视频签名在同一媒体行锁内消费；视频回调绑定 media/source/provider job/output 对象身份。十动作矩阵现逐项穿过正式 `buildTextModerationDescriptor`、`createContentModerationService`、生产与服务器共用的 `createProductionTextProposalHandlers`、`createTextProposalApplicator` 与 `createAuthorDraftService`；逐动作验证 operation/target、真实 `assertProposalBase`、`current*TextBase(...,{forUpdate:true})`、显式业务 writer、正式写入、作者/非作者隔离、取消事务、驳回后替换、重复提交和 stale 不写入。置顶消息首次通过与幂等回放统一返回安全 `{id, kind}`。替换重放仅接受 `pending + pending/processing/review/error`、`rejected + rejected` 或 `approved + approved` 配对，cancelled/stale 继续拒绝。最终独立复核未发现 Blocker 或 Important；修复后 `d46:unit` 148 项、进程内 `d46:smoke` 121 项及 `d46:check` 全绿。
- 2026-07-15 D46.15 FINAL VERIFY：`d45:unit` API/小程序 545 项加 talk 8 项、`d45:smoke` 79 项、D46 迁移兼容 5 项、根级 `npm run check`、`git diff --check` 全部通过；管理端和微信小程序生产构建成功。D46.16 与整份生产验收清单继续保持未勾选，未连接或修改任何生产资源。
- 2026-07-16 D46.15A DEVTOOLS GREEN：在提交 `4741a0fc3e2585a5dc6f6ea03b8e1bb72769d12b` 上重新运行 `npm run build:mp-weixin`，退出码 0；作者私有小程序专项 `authorPrivateContent`、`authorPrivateSocial`、`authorPrivateText` 共 12/12 通过。微信开发者工具 Nightly `2.01.2512242`、基础库 `3.12.1` 从 `dist/dev/mp-weixin` 手动编译并稳定启动，首页和隔离相册复编译后均为 0 error；剩余提示仅为 SharedArrayBuffer 弃用、全局组件性能、关闭域名校验及本地 HTTP 图片夹具警告。最终验收临时把生成目录（未跟踪产物）的 API 地址切到 `127.0.0.1:3029`，只读 Mock 除本地登录会话外拒绝所有非 GET：记录到的请求只有本地登录、本人空列表、作者相册和夹具图片，无业务写入。作者卡片实际显示“仅自己可见 · 进一步审核”，只提供删除，不出现下载/标注；本地夹具预览可打开且无下载入口；删除仅打开二次确认后取消，Mock 未收到 DELETE。测试后已停止 Mock、恢复生成物 API 地址、移除本地编译模式并关闭项目。首次按仓库默认锁定地址启动时曾发生公开首页只读请求，确认无写入后立即切换到上述隔离验收；D46.16 和生产验收清单继续保持未勾选。
- 2026-07-16 D46.16 GATE-FALSE RELEASE GREEN：`develop`、`main`、`publish` 的 Docker Publish 分别通过运行 `29457740860`（第二次尝试；首次仅腾讯云仓库连接超时）、`29457954448`、`29458101273`；正式发布提交为 `e712faf9d25dc16dabba7612e5ea41af2e1a6f1c`。API 使用不可变 manifest `sha256:2a170eead6e496d2931d3514e6f70e17fd2410ab84d776f1a4f5f14273cc65ac`，管理端使用 `sha256:16e4ba3e929cc3f9fb1e2cd5fafa5bcf50160b7f43024d828b5cd92d89057075`；API 与三个审核 Worker 的本地 image ID 均为 `sha256:6874aa3a8e21ceaae2b682c1b1c7f09294e05ce487490cb4f796682ddd07ab37`。迁移前确认 TDSQL-C 集群 `cynosdbmysql-o6c4ezij` 的成功自动备份与连续日志覆盖恢复点 `2026-07-16 07:23:46 +08:00`；一次性容器 `pinche-d46-migrate-20260716-1` 退出码 0，记录 `0030_author_private_content_visibility.sql` 已执行、迁移总数 32。
- 2026-07-16 D46.16 BASELINE VERIFY GREEN：API 与三个 Worker 均使用同一不可变 API digest；命令分别为 `node src/server.js`、`job:content-moderation-retry`、`job:content-moderation-orphan-scan`、`job:content-moderation-production-preflight-timeout`，Worker 仅连接 `pinche_internal` 且均为 `unless-stopped`。四容器的 text/image/video intake 均为 `closed`，D46 三个 gate 均为 `false`、文本 action 为空、TTL 为 60；API Watchtower 标签为 `false`，三个 Worker 无启用标签。首次恢复 D45 开关时因遗漏四个 `TENCENT_CI_VIDEO_*` 变量，API 按配置契约关闭式拒绝启动；在启动任何 Worker 前即补回原生产变量并恢复健康，未放开 intake、未消费审核任务。超过一个 Watchtower 扫描周期后，API `/health` 与 `/health/db`、管理端均为 200；微信无效回调为预期 400、腾讯无 token 回调为预期 401；公共门店、剧本和近期车局 API 均为 200，顶层字段仍为 `ok/data`、公共缓存头未改变，响应不含 `draft_id`、`content_ref`、`author_only`、`publication_state` 或作者预览 URL 标记。真实 D46 gate 与生产 intake 均未开启。
- 2026-07-16 D46.16 LOCAL HTTP：此前在无继承环境的回环 MySQL/Redis 专用 Compose 项目中完成 32 个迁移；严格目标探针、诊断和普通输出的多账号 HTTP 验收均成功，残留计数为 0 且资源已清理。独立安全复核随后识别出旧版腾讯视频/COS 回调 token 及其他云能力配置可在启动 guard 后由 `.env` 继承的静态缺口；已将本机验收子项重新打开，改为 D46 标志下完全跳过 `.env`，并以两项 token 显式空值为纵深防御，待重新完整运行。此前及本次修复均不连接、修改或开启生产服务、D45 intake 或 D46 生产 gate。
- 2026-07-16 D46.16 LOCAL HTTP FINAL GREEN：严格 `env -i` 的负向探针按预期在顶层 guard 失败，未开始 HTTP/数据库 I/O；本机 Unix-socket Docker context 的全新专用 MySQL/Redis 完成 32 项迁移，严格目标探针、诊断与正常 HTTP 多账号验收均通过。修复自动通过 `session_create` 生成的未跟踪文本提案后，脚本将七张临时审核/相册表归零作为成功条件，独立统计为 `0/0/0/0/0/0/0`。专用 API、容器、卷、网络及 3046/3346/6446 监听均已清除；D46 专项 164 项、进程内 smoke 122 项、静态契约与根级 `npm run check` 全绿。生产 D45 intake 与 D46 gate 未连接、未修改，仍保持 `closed`/`false`；D46.16 父项及真实流量项继续不勾选。
- 2026-07-16 D46.16 LOCAL HTTP FINAL GREEN（串行化复验）：在干净的 `pinche-d46-smoke` 本机项目中，严格 launcher 的目标探针成功；临时占用专用 MySQL 命名锁后，第二个严格验收按预期在 fixture 写入前失败，相关七表仍为 `0/0/0/0/0/0/0`。锁释放后，诊断和正常 HTTP 多账号验收均通过，最终独立七表统计仍为 `0/0/0/0/0/0/0`。API、容器、卷、网络和 3046/3346/6446 监听均已删除；独立安全复核确认锁覆盖 cleanup 与归零断言且无云侧 I/O。生产 D45 intake 与 D46 gate 未连接、未修改，D46.16 父项和真实流量项继续不勾选。
- 2026-07-17 D46.16 ISOLATED ACCEPTANCE REVIEW GREEN：最终 spec 复核先发现主脚本依赖 import 早于严格 guard、图片缺少 `review` 整链两项 Important；均按 TDD 修复并复审通过。图片现真实穿过 `pending → 加密微信 review 回调 → 管理员 reject → rejected 保留 → 作者删除/精确 cleanup`，作者读取真实字节且 member、第二管理员、匿名、share 与 direct-public 全部不可发现。质量复核进一步修正图片/视频 capability 在 `now == exp` 仍有效的边界，现 `exp-1` 有效、`exp` 立即失效；cleanup trap 也会确认 launcher 退出后才删除 Compose。修复后严格本机诊断与正常 HTTP 两轮均通过，独立七表计数两次均为 `0/0/0/0/0/0/0`，专用容器、卷、网络和 3046/3346/6446 监听已清除；D46 单测 169 项、smoke 122 项、两项静态契约及 diff 检查全绿。生产 D45 intake 与 D46 gate 未连接、未修改，真实流量仍为本 spec 非目标。
