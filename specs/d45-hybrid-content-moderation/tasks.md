# D45 Tasks：微信文本/图片与腾讯云视频混合内容审核

更新日期：2026-07-14

版本：v1.2

> 本清单替代旧“腾讯云全内容审核”路线。此前实现只作为待清理代码，不代表新路线任务完成；除三件套外全部重新按新需求验证后勾选。

## D45 执行任务

- [x] D45.1 重写中文 D45 spec 三件套。
  - [x] requirements 明确微信文本/图片、腾讯云视频、私有 COS 与 API 门禁。
  - [x] design 明确双服务商适配、状态机、回调、重试、后台和发布设计。
  - [x] tasks 重置为新路线的 Kiro 风格执行清单。

- [x] D45.2 清理旧腾讯云全内容审核方案。
  - [x] 先增加静态检查，证明 TMS、CI 图片策略和 COS 自动审核配置仍存在时失败。
  - [x] 删除腾讯云 TMS 文本客户端、调用和配置。
  - [x] 删除腾讯云 CI 图片审核客户端、调用和配置。
  - [x] 删除 COS 图片自动审核/全桶冻结依赖与文档。
  - [x] 保留统一数据模型、状态机、读取门禁和腾讯云视频代码。
  - [x] 将通用命名与 provider 值迁移为混合方案。

- [x] D45.3 校准审核数据模型和状态机。
  - [x] 以 `stale` 作为文本提案终态；审核任务沿用统一终态并记录 `CONTENT_MODERATION_PROPOSAL_STALE`，避免扩展未约定的全局任务状态。
  - [x] 测试微信 trace_id、腾讯云视频 JobId、不可变版本和 provider 唯一约束。
  - [x] 新增 provider attempts，保证 `(provider, provider_job_id)` 唯一并标识当前尝试。
  - [x] 修复 provider attempts 的 MySQL 生成列与级联外键兼容性。
    - 2026-07-13：生产迁移 `0025` 在创建外键时返回 `Cannot add foreign key constraint`；已定位为 `STORED` 生成列的基列不能与 `ON DELETE CASCADE` 共用。当前以最小兼容修复与回归验证处理中，未重试生产迁移。
    - 2026-07-13：`0025` 兼容修复发布后，生产迁移在 `0026` 的 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 被目标 MySQL 8.0 语法拒绝；`0027` 存在同类写法。API 与 Worker 尚未更新，当前按同一 D45.3 子项以幂等 schema reconciliation、失败回归和完整验证修复，三类 intake 继续保持 `closed`。
    - 2026-07-13：`0026` 与 `0027` 已改为迁移 runner 的幂等 schema reconciliation：先严格校验锚点/目标列形状，只在目标列缺失时执行兼容的裸 `ADD COLUMN`；目标列正确但此前未记版本时安全补记，不匹配时关闭式失败。已覆盖 DDL 成功但迁移记录失败后的两次重跑，并完成定向 40/40、`d45:unit` 436/436、`d45:check`、`d45:smoke` 71/71；待完整根检查、发布和生产一次性迁移成功后才勾选本项。
    - 2026-07-13：已重新执行完整 `npm run check`，退出码 0。生产一次性迁移第三次创建仍被 Portainer 的“从现有 API 复制”流程错误解析为旧摘要镜像并重复拼接私有仓库前缀，容器未创建；现有 API 和三个审核 Worker 未改动。待获得 Docker 宿主机受控命令入口后，使用同一已发布镜像和现有运行配置执行一次性迁移，再继续服务替换。
    - 2026-07-14：已获得目标 Docker 宿主机的交互终端，并确认现有 API 与三个 D45 Worker 均在运行。当前仅核验 API 容器的镜像、网络和启动配置；未读取或输出环境变量/密钥，未执行迁移或替换，三个 intake 继续保持 `closed`。
    - 2026-07-14：主机现运行镜像已核验为 `hkccr.ccs.tencentyun.com/murder/pinche:latest`（本地镜像 ID `sha256:486a79aa2bdbcc1bb09bba7f36acfdaa10ea6ff21850da9c4a45a1098dd0a5d5`），并确认镜像内含 `0025`–`0029` 及显式 `npm run migrate` 入口。已重新执行完整 `npm run check`，退出码 0。待当次生产数据库迁移确认后，以现有 API 的受保护运行环境在 `pinche_internal` 网络执行一次性迁移；API/Worker 仍未替换，三个 intake 保持 `closed`。
    - 2026-07-14：生产 API 入口日志已实证迁移结果 `ok: true`、`database: pinche`、`executed: []`、`total: 31`，说明包括 `0025`–`0029` 在内的全部迁移版本已成功记录；本项据此完成。随后发现该镜像因 API 包未声明直接导入的 `@pinche/shared` 而在迁移后重启，未监听端口；新建的测试先失败再通过，修复正待发布为新镜像。三个 intake 未打开，D45.18 仍未执行。
    - 2026-07-14：恢复后的预检超时 Worker 在目标集群报 `ER_WRONG_ARGUMENTS`；根因是该兼容 MySQL 实现不接受预编译语句中的 `LIMIT ?`。查询仅将已验证的 1–100 批大小内联，仍只绑定截止时间；回归测试同时断言不再向 `LIMIT` 传参。完整 `npm run check` 已通过，待发布修复镜像并恢复该 Worker。
    - 2026-07-14：兼容性修复已按 develop → main → publish 受控流水线发布；生产使用不可变 API 镜像摘要 `sha256:1292232da897279e8d9faf9a931e865abb5c1cc9be4c1dc7cfce5b024757b618`。API、retry、orphan scan 与 preflight timeout 四个目标容器均持续运行且重启次数为 0；内部和外部 `/health` 均返回 200、数据库 schema 就绪，三类 intake 明确为 `closed`。未执行 D45.18 真实服务商/预检调用。
  - [x] 保留历史媒体 `approved_legacy`，新媒体显式 pending。
  - [x] 文本 Review/Error 使用隐藏提案。
  - [x] 管理员决定优先于服务商事件。
  - [x] 重复和过期结果幂等且不覆盖有效终态。

- [x] D45.4 实现微信 access token 管理与客户端。
  - [x] 先测试 Redis token 缓存、提前刷新、进程/分布式单飞和失效后单次重试。
  - [x] 新增共享 `modules/wechat/access-token.js`，并让订阅消息改用共享模块。
  - [x] 复用 `WECHAT_APP_ID`/`WECHAT_APP_SECRET`，生产开启微信审核但缺少 Redis 或凭证时关闭式失败。
  - [x] 实现 `msgSecCheck` 客户端。
  - [x] 实现 `mediaCheckAsync(media_type=2)` 客户端。
  - [x] 确认日志和错误摘要不含密钥、token、完整文本或签名 URL。

- [x] D45.5 接入微信文本审核。
  - [x] 必要兼容解释：同请求 `nickname`+`avatarUrl`/`gender` 视为严格白名单的 profile-patch 提案：仅 `nickname` 送审，三字段仅在 Pass/批准/重试的同一 applicator 中应用；待审期间任一资料字段变化均标记 stale，不覆盖新值。
  - [x] 覆盖昵称、评价、留言、置顶留言、私有门店/剧本和拼车说明的四类结果测试。
  - [x] 多字段按稳定标签合并，并按固定映射传生产者 openid 与 scene 1/2/3/4。
  - [x] 映射 `suggest=pass/review/risky`，未知值进入 error。
  - [x] Pass 应用业务变更。
  - [x] Review/Error 保存隐藏提案且不修改实体。
  - [x] Block 返回稳定错误且不修改实体。
  - [x] 排除系统文本、手机号和管理员审核备注。
  - [x] 实现统一事务型提案 applicator，重新验证权限/基线并保证创建动作幂等。
  - [x] 缺少有效 openid 时返回 `CONTENT_MODERATION_OPENID_REQUIRED`。
  - [x] 独立 `session-npc-roles` 创建/编辑在 scene=4 下先审后写，并覆盖字符串、别名、空值回退等全部输入形状。
  - [x] 管理员批准/重试创建动作保存安全结果并且恰好应用一次。
  - [x] 文本提案只保存 action 必需的最小 payload，不保存无关敏感字段。
  - [x] 文本基线在同一秒内的并发变更后仍可检测为 stale。
  - [x] 资料 PATCH 提案只保存 nickname/avatarUrl/gender 白名单；待审期间三者任一变化均 stale，不覆盖新值。
  - [x] 可判定的权限/领域约束失效统一标记为 stale，系统错误保持错误。

- [x] D45.6 接入微信异步图片审核。
  - [x] 按 v1.1 在图片 finalize 事务内创建微信任务，提交在提交事务后执行；短时 URL 仅供微信抓取，绝不持久化或返回给用户。相册图片按动态/社交内容固定使用微信 `scene=4`。
  - [x] 图片 finalize 在事务内创建 pending 媒体和微信任务。
  - [x] 复用 JPEG/PNG 与 4 MB 校验，拒绝不支持格式和超限文件。
  - [x] 只生成供微信抓取的短时 COS URL，不返回用户。
  - [x] 提交 `mediaCheckAsync` 并把 trace_id 保存为当前 provider attempt。
  - [x] 提交失败保持隐藏并进入 `error`。
    - 限制：当前 retry Worker 仅认领腾讯云相册视频；微信图片失败保持隐藏 `error`，自动微信重试分发留待 D45.10。
  - [x] Pass 批准；Review 入后台；Block 隐藏并幂等清理。

- [x] D45.7 实现微信图片审核事件接收。
  - 已完成：按微信安全模式在通用 body parser 前读取受限原始请求体；只按 trace_id 关联当前 attempt，再从数据库校验媒体版本与对象 Key。
  - [x] 测试错误签名、错误密文、超大请求、未知结构、合法、重复、旧 attempt 和过期事件。
  - [x] 在通用 body parser 前读取受限原始 body，生产安全模式下验签并 AES 解密。
  - [x] 以 trace_id 找到当前 attempt/任务，再用任务版本校验媒体 ID、对象 Key 和 ETag。
  - [x] 使用事务行锁执行状态迁移。
  - [x] 管理员决定后的事件不得覆盖当前状态。

- [x] D45.8 收窄并验证腾讯云视频审核。
  - 已完成：CI 仅提交视频源对象，使用 Average 截帧、`DetectContent=1`、Detail 回调与当前令牌；Detail 回调独立限为 1 MiB（微信安全事件仍为 256 KiB），不提前实施 D45.10 的多 provider 重试调度。
  - [x] 客户端只暴露视频画面与音轨审核方法。
  - [x] 源对象稳定后按媒体 ID 与 ETag 幂等提交。
  - [x] 转码 ready 不修改内容审核状态。
  - [x] 回调验证任务、data_id、对象 Key 与 ETag。
  - [x] 回调 URL 令牌在网关和应用日志中脱敏并支持轮换。
  - [x] Block 幂等清理源、展示和封面对象。
  - [x] 已拒绝视频的迟到转码输出原子合并至同一清理任务；同 key 重写也重新排队、撤销旧租约，且不恢复媒体字段。

- [x] D45.9 封闭全部媒体读取路径。
  - 已完成：统一复用严格的 `isModerationPublished`；刷新后的服务端列表为权威状态，审核撤销时同步清除小程序本地缓存、预览、瀑布流与异步回写。
  - [x] 普通列表、公开分享、计数、标签和批量下载只包含 approved/approved_legacy。
  - [x] 图片预览、缩略图、下载独立校验。
  - [x] 视频 range、封面、播放和下载独立校验。
  - [x] 只有 approved/approved_legacy 生成短时签名 URL。
  - [x] 上传者只收到无 URL 状态占位。

- [x] D45.10 实现混合审核重试 Worker。
  - 已完成：严格枚举微信文本、微信图片与腾讯视频 provider/内容类型路由；外发前以同一令牌按数据库时间原子续租至少 90 秒。微信图片仅在续租成功后签发单对象私有 GET URL，5 分钟有效期覆盖提交链与异步抓取余量，且从不持久化或返回用户。
  - [x] 使用 `FOR UPDATE SKIP LOCKED` 和租约令牌。
  - [x] 网络、超时、限流和 5xx 使用有限指数退避与抖动。
  - [x] 微信 token/权限/额度和腾讯云 CAM/策略/额度/欠费保持隐藏并告警。
  - [x] 重试耗尽后保持 error 并停止自动认领。
  - [x] 提供生产 Worker 命令与运行配置。

- [x] D45.11 实现管理员审核 API。
  - 已完成：所有管理员路由先验证 `system_admin`，列表/详情只消费 `review`/`error`，并通过显式 DTO 隔离 provider job、租约、对象键和原始 URL。
  - [x] 普通用户 403；队列支持 provider、类型、状态、标签和时间筛选。
  - [x] 提供详情、approve、reject、retry。
  - [x] reject 必填原因，所有动作写审计。
  - [x] 文本批准原子校验基线，变化时 stale。
  - [x] retry 不改变内容可见性；条件重入成功后同一事务退役旧 provider attempt，迟到回调只能 stale。

- [x] D45.12 实现管理后台最小复核页面。
  - 已完成：基于 D45.11 的受限管理员 API 增加独立审核导航、筛选队列、详情抽屉与人工决定，未改小程序或 API 契约。
  - [x] 增加内容审核导航、筛选队列、详情和操作。
  - [x] 展示服务商、提交者、关联实体、建议、标签、重试和时间。
  - [x] 媒体使用管理员短时预览 URL。
  - [x] 运行后台测试与构建。

- [x] D45.13 改造小程序审核体验。
  - 已完成：统一安全中文文案，接入上传者媒体状态与文本 Review 失败路径，未改变发布门禁或 API 契约。
  - [x] pending/error、review、rejected 使用规定中文文案。
  - [x] 文本 Review 不更新页面当前值。
  - [x] 不展示服务商标签、分数或敏感命中词。
  - [x] 运行小程序测试与构建。

- [x] D45.14 增加指标、告警与孤儿对象扫描。
  - [x] 指标覆盖创建、提交、延迟、结果、重试和未批准访问。
  - [x] 告警覆盖微信 token/权限/额度和腾讯云视频 CAM/额度/欠费。
  - [x] 监控队列深度、最老年龄、回调认证失败和重试耗尽。
  - [x] 扫描 COS 对象、媒体记录和审核任务不一致。
  - [x] 日志与指标不包含敏感凭证、完整私密文本或签名 URL。

- [x] D45.15 编写混合方案生产手册。
  - [x] 微信内容安全权限、access token、事件推送和调用额度。
  - [x] 明确微信免费能力受当前平台额度和政策约束，不作为永久 SLA。
  - [x] 腾讯云 CI 视频画面/音轨策略、CAM、费用和欠费告警。
  - [x] COS 私有桶、上传权限和短时签名 URL。
  - [x] 分阶段启用、观察指标与安全回滚。
  - [x] 明确不启用腾讯云 TMS、CI 图片和 COS 图片自动审核。

- [x] D45.16 增加 D45 自动检查与烟测。
  - [x] `d45:unit` 覆盖微信 token/客户端、映射、状态机、双回调和重试。
  - [x] `d45:check` 覆盖迁移、入口、配置清理和读取门禁。
  - [x] `d45:smoke` 覆盖微信文本、微信图片、腾讯云视频和人工复核主链路。
  - [x] 加入根 `npm run check`，本地测试不依赖公网或生产凭证。

- [x] D45.17 执行本地完整验证。
  - [x] 运行 D45 unit/check/smoke。
  - [x] 运行相册图片和视频现有测试。
  - [x] 运行管理后台测试与构建。
  - [x] 运行小程序媒体测试与构建。
  - [x] 运行数据库迁移检查和根 `npm run check`。
  - 为保留 D31/D32 兼容前置重建集成候选，talk 子模块提交纳入 d45:unit；仍不代表 D45.18 完成。

- [x] D45.18 执行生产受控预演与完整放行验证。
  - 2026-07-13：用户明确将当前联调路线改为生产受控预演，并确认一次性容器内 CLI、独立预演数据/回调、三类 intake 始终 `closed`、无害样本与有限验证边界。中文三件套已获用户复核确认；实施计划已完成，等待选择执行方式；尚未实现预演模块、部署、读取密钥或发送真实请求。以下新子项为当前权威路线；此前非生产方案记录保留作审计历史。
  - 历史解释：以下提及“非生产”或“不得以生产环境代替”的 2026-07-13 记录仅描述当时路线与已完成操作，不改变当前 D45.18A 的生产受控预演约束。
  - 2026-07-13：进行中；先仅核验非生产凭证、回调与隔离环境，不输出密钥、违规样本正文或可复用 URL。未确认前不发送真实审核请求，也不打开任何接收门禁。
  - 2026-07-13：完成本地联调前置：新增严格 opt-in 的离线契约脚本，只接受源码锁定的 `.invalid` 测试目标和无害样本对，任何通过前置条件的路径仍只输出 `dry_run_deferred`，不联网、不调用服务商且不读取 `.env` 文件。已验证默认拒绝、精确门禁、凭证 canary 不输出和任务仍未完成。当前进程、工作树及仓库级 Actions 密钥名称均未发现可安全使用的 D45 非生产配置；真实 endpoint/样本必须在隔离环境准备后通过单独审阅的代码变更加入，D45.18 继续保持未勾选。
  - 2026-07-13：上线前置复核完成：本地 `npm run check` 已通过，尚未发送真实审核请求、改动生产门禁或部署。仓库仅有生产 compose/示例，未发现可安全使用的非生产部署入口；当前仍缺隔离 MySQL/Redis/私有 COS、公开 HTTPS 回调域名，以及微信与腾讯云 CI 的实际非生产配置。三类生产接收门禁继续保持 `closed`，不得以生产环境代替 D45.18 联调或将任一类型切为 `moderated`。
  - 2026-07-13：用户确认复用现有 TDSQL-C MySQL 8.0 Serverless 集群，并以新逻辑库 `pinche_d45_staging` 承载 D45 非生产联调；该方式只有逻辑库隔离，不等同于独立 MySQL 实例，作为本阶段经确认的窄化偏差记录。已创建同名专用账号并限制来源与连接数，只授予 `pinche_d45_staging` 库级读写/迁移权限；复核确认无全局权限、无 `GRANT OPTION`，且对生产库 `pinche` 无任何权限。凭证未写入文档或仓库。数据库前置已就绪，但 Redis、私有 COS、公开 HTTPS 回调和服务商非生产配置仍缺，D45.18 继续保持未勾选。
  - 2026-07-13：用户确认新建南京同 VPC 的 Redis 7 共享产品实例，作为现有 `cache` 的安全渐进替代；实例采用专用安全组、密码认证和 TLS。该实例服务未来生产迁移，不得作为 D45 非生产的强隔离边界；生产 API 与 Worker 必须成组切换，旧 token/锁不迁移。资源、密码和迁移尚未完成，D45.18 与三类接收门禁状态不变。
  - 2026-07-13：购买页的自动化访问受浏览器安全策略阻止，未创建安全组、未提交订单、未读取任何密码；需由用户在腾讯云控制台手动完成资源订单后再继续连通与迁移验证。
  - 2026-07-13：用户随后明确授权创建专用安全组，已在南京默认项目创建 `pinche-redis-shared-sg`（`sg-cz9zc5tw`），入站仅允许 `10.206.0.0/20` 与 `10.206.16.0/20` 访问 `TCP:6379`；无公网入站规则。Redis 实例、密码、订单与迁移仍未完成，D45.18 与三类接收门禁状态不变。
  - 2026-07-13：用户确认停止新 Redis 采购；未提交订单、未读取密码，已建安全组保留但不绑定实例。当前只保留本地假客户端与离线 `dry_run_deferred` 调试，不使用旧 `cache`、生产数据库/COS/回调或真实服务商请求；三类生产接收门禁继续 `closed`。这不替代隔离非生产环境，D45.18 继续未完成。
  - 2026-07-13：用户确认释放此前仅为 D45 非生产联调创建的逻辑库 `pinche_d45_staging` 及同名专用账号；已先核验账号仅有该库的授权，随后依次删除账号与逻辑库，并在腾讯云控制台复核两者均已不存在。生产库 `pinche`、TDSQL-C 集群、现有 Redis 和未绑定安全组未改动；此前的逻辑库隔离前置已撤销，D45.18 与三类生产接收门禁状态不变。
  - 2026-07-13：撤库后的本地/离线复核完成：`npm run d45:unit` 366/366、`npm run d45:check` 通过、`npm run d45:smoke` 71/71；在空环境中运行源码锁定的 `.invalid` 契约只得到 `dry_run_deferred`。未读取实际密钥、未联网、未发送真实审核请求，也未改变生产接收门禁。历史实现计划已标注 D45.18 延期并以本任务清单为准；真实联调继续未完成。
  - [x] D45.18A 实现并验证生产受控预演（有限验证）。
    - 2026-07-14：API、retry、orphan scan 与 preflight timeout 已按用户确认原地重建为同一不可变镜像 `sha256:428e1501f2412e38474d50715d7e7317994ab46b38049eec5e2e2e447590971b`；API `/health`、`/health/db`、数据库 schema 与 `pinche_internal`/`proxy` 网络正常，三个 intake 仍为 `closed`。用户已当次确认执行微信文本与图片无害预检；当前按 `wechat-text-v1` → `wechat-image-v1` 顺序进行，尚未获得真实结果，故本项保持未勾选。
    - 2026-07-14：首次 `wechat-text-v1` 一次性 Job 在任何微信出站请求前关闭式失败，脱敏错误为 `valid WECHAT_CONTENT_SECURITY_EVENT_AES_KEY`；核验确认运行时密钥为微信后台允许的 43 位字符并可解码为 32 字节，根因是应用额外要求 Base64 规范重编码完全一致。已先新增回归用例复现，再将校验收敛为“合法 43 位字符且解码为 32 字节”；`npm run d45:unit` 446/446、`npm run d45:check` 通过。修复尚待 CI 发布并重新执行文本、图片预检，三个 intake 仍为 `closed`，故本项保持未勾选。
    - 2026-07-14：上述启动校验修复经 develop/main/publish CI 成功发布，API 与三个 D45 Worker 已更新到不可变镜像 `sha256:7227dcc1217d91bd57bf1f455ea8fccb9a4d0e2c48d5736a92e6484d97ce6e34`；四容器均 running，API 健康检查、数据库 schema、双网络与三个 `closed` 门禁正常。真实 `wechat-text-v1` 已返回 `passed`；`wechat-image-v1` 已提交并进入 `awaiting_callback`，但首次真实回调被内部重复的 AES 规范重编码校验关闭式拒绝为 `CONTENT_MODERATION_INVALID_CALLBACK`，未发布内容。已以失败测试复现并将回调解密校验收敛为同一微信 43 位/32 字节规则，`npm run d45:unit` 447/447、`npm run d45:check` 通过；待再次 CI 发布并由微信重试该回调或在受控超时后重新预检，故本项保持未勾选。
    - 2026-07-14：回调解密修复已按 develop/main/publish 成功发布至不可变镜像 `sha256:9aa6b980313a4629ad992fe9255c62e11b1eb8faa3d58b0f07ba0a7230e3a0b0`。替换时发现 Portainer 的复制/编辑流程把三个 Worker 的覆盖命令静默恢复为 API 默认命令；已逐一恢复并在容器详情核对 retry、orphan scan、preflight timeout 的实际 CMD，未触碰其他服务。随后旧图片预检超过 15 分钟仍未被 timeout Worker 选中；生产证据与失败回归定位为应用 UTC 截止字符串直接比较数据库会话时区下的 `DATETIME`，造成最长约 8 小时延迟。现已改为使用数据库 `CURRENT_TIMESTAMP(3)` 计算相对截止时间，完整 `npm run d45:unit` 448/448、`npm run d45:check` 与差异检查通过；待发布新镜像、由 timeout Worker 清理旧预检并重新执行图片预检，三个 intake 仍为 `closed`，故本项保持未勾选。
    - 2026-07-14：数据库时钟修复已由 develop `c2326d6`（Actions `29325425715`）、main `d43867b`（Actions `29325541035`）和 publish `da0d113`（Actions `29325659911`）依次成功发布，生产 API 不可变摘要为 `sha256:562fd0e0ee21b54a88afbce633e445db6a75b2268f2c385a6feeb85bbc8efb86`。仅原地替换 API、retry、orphan scan、preflight timeout 四个目标容器；四者均 running，三个 Worker 的实际 CMD、timeout/API 发布指纹、API 双网络及三个 `closed` intake 已在容器详情复核，外部 `/health` 与同网络 `/health/db` 均返回数据库/schema 就绪。旧图片运行 `776bc657-5ddb-42d5-b91d-00d5d3cbe9c9` 已安全终结为 `failed/error`、`cleanup_status=deleted`、provider 锁释放；新 `wechat-image-v1` 运行 `ac295ab7-d89c-418f-bc4c-f1363ac2e7c3` 已由真实微信回调终结为 `passed/pass`、`cleanup_status=deleted`、无失败码且锁释放。结合此前 `wechat-text-v1` 的真实 `passed`，本次确认的文本与图片预检已完成；全部 `pinche-d45-preflight-*` 临时容器已停止并删除。腾讯视频预检仍未执行，故 D45.18A 及“文本、图片、视频”合并验收项继续保持未勾选。
    - 2026-07-14：用户确认继续执行 `tencent-video-v1`。当前先只读核对腾讯视频 provider/COS/回调配置、不可变镜像摘要、固定无害样本指纹、单活动运行/限频和三个 `closed` 门禁；尚未提交真实视频审核请求，D45.18A 继续保持未勾选。
    - 2026-07-14：随后以隔离的一次性预检容器提交两次 `tencent-video-v1`。两次均安全终结为 `failed/error`、`cleanup_status=deleted` 且 provider 锁释放，未创建普通用户审核/媒体状态；CI 控制台与预演 provider-attempt 存储均无任务记录。基于腾讯云文档完成最小 CAM 修正：仅为生产子账号新增 `ci:CreateAuditingJobs` 与对精确 `CI_QCSRole` 的 `cam:PassRole`，保留原 COS 权限且未改动 API/Worker/门禁。上游错误当时被归一化为泛化的 `CONTENT_MODERATION_UPSTREAM_RESPONSE_INVALID`，无法据此继续猜测配置；现以失败回归补齐 `CIRoleNotExist`、`AccessDenied`、`InvalidArgument` 三类安全错误码和告警分类，定向回归 38/38、`npm run d45:unit` 448/448、`npm run d45:check`、差异检查已通过。该可观测性修复尚未发布，发布后只以新的临时预检容器复测；三个 intake 继续 `closed`，D45.18A 保持未勾选。
    - 2026-07-14：可观测性修复发布后，第三次隔离 `tencent-video-v1` 预检实际以正确的一次性 Job 命令运行，未发布端口、只接入 `pinche_internal`，随后安全终结为 `failed/error`、`failure_code=AccessDenied`、`cleanup_status=deleted`。只读核对确认：运行 COS 凭证归属已关联最小 CI 策略的子账号；策略同时精确允许 `ci:CreateAuditingJobs` 和向 `CI_QCSRole` 传递角色；该角色具备 CI/COS 权限且受信任主体为 CI；目标 COS 桶已绑定数据万象，运行时桶、地域和视频 BizType 均与控制台默认视频策略一致。操作审计在近一天 CI 范围内仍未出现对应事件。故当前问题收敛为腾讯云侧内容审核服务授权或账号状态，未扩大 CAM 权限、未改变 API/Worker/门禁；待获取腾讯云支持的账号侧诊断后再复测，D45.18A 保持未勾选。
    - 2026-07-15：腾讯云工单 `202607144002` 已确认账号、欠费/封禁、桶 ACL、Bucket Policy 与防盗链无异常，并要求补充失败请求的 RequestId；控制台重新核对 `CI_QCSRole` 已关联 `QcloudCOSDataFullControl`、`QcloudAccessForCIRole`、`QcloudPartAccessForCIRole` 且未设置权限边界。经用户确认，以不可变镜像创建一次严格隔离的诊断预检容器：无发布端口、无卷挂载、无生产标签、仅连接 `pinche_internal`、重启策略为 `Never`，且未替换或重启任何现有容器。`tencent-video-v1` 于 2026-07-15 09:46（UTC+8）获得腾讯真实响应 HTTP `401`、provider Code `AccessDenied` 与有效 RequestId；运行 `fd2f0f17-0932-4d8b-9ebb-b32a7582b530` 已终结为 `failed/error`、`cleanup_status=deleted`，`tencent_video` 活动锁为空。RequestId 仅回填腾讯云工单，未写入应用数据或仓库；工单已于 09:52 补充并恢复“处理中”。诊断容器随后已删除，未删除卷、未扩大 CAM 权限、未改变三个 `closed` intake。由于视频审核仍未通过且运行表中的失败码仍归一化为 `CONTENT_MODERATION_UPSTREAM_RESPONSE_INVALID`，当前继续等待腾讯云定位实际拒绝点，D45.18A 保持未勾选。
    - 2026-07-15：腾讯云工程师已基于上述 RequestId 定位错误码 `11009`，结论为请求未通过签名校验，腾讯服务端计算签名与客户端签名不一致；首要核对项为签名时与实际发送时的 `Content-Type` 一致性，并建议按官方 COS 签名规范或 SDK 对照。官方视频审核实际案例在仍发送 `Host`、`Content-Length` 和 `Content-Type: application/xml` 的同时使用空 `q-header-list`；新增回归先以旧实现的 `content-length;content-type;date;host` 签名头失败（28/29），再将腾讯视频 transport 的参与签名头收窄为空并保持实际请求头不变后转绿（29/29）。本地 `d45:unit` 449/449、`d45:check`、`d45:smoke` 71/71、API 语法、完整 `npm run check` 与差异检查均通过；未改 CAM、COS、回调、状态机或三个 `closed` intake。修复尚未发布且真实视频预检仍未重跑，D45.18A 保持未勾选。
    - 2026-07-15：签名修复提交 `fec0563` 已按 develop（Actions `29386266113`）→ main `3860241`（Actions `29386365146`）→ publish `95fc86e`（Actions `29386450669`）逐级成功发布，生产 API 不可变摘要为 `sha256:65577299838f2d196f62ecf40f62d71fb3f62fa51d5fc4e1c247e900ea01b1a5`。经用户确认仅原地替换 API、retry、orphan scan 与 preflight timeout 四个 D45 目标容器，四者均为该摘要并保持 running；替换后容器内回环与 `proxy` 地址均返回 200、同一 Traefik 的其他 HTTPS 路由正常，但 `api.pinche.jubenmi.com` 真实源站超时，该现象判断与动态路由仍使用替换前后端端点一致。因此仅重启 `pinche-api-1` 触发 Docker 路由事件，未重启 Traefik或其他服务；随后真实源站 `/health` 与 `/health/db` 均恢复 200、数据库 schema 完整。
    - 2026-07-15：以同一不可变摘要运行唯一一次 `tencent-video-v1` 隔离容器：禁止拉取、无发布端口、无卷、无标签、仅连接 `pinche_internal`、重启策略 `Never` 且退出自动删除；启动前 provider 无活动锁且距上次运行已超过 15 分钟，三个 intake 均为 `closed`。腾讯真实审核与 Detail 回调将运行 `7abfa600-e08a-4fbb-b9da-8161725b99b6` 于 2026-07-15 16:30:20（UTC+8）终结为 `passed/pass`、`cleanup_status=deleted`、失败码为空，`tencent_video` 活动锁已释放；从该运行开始至完成，普通审核任务、普通 provider attempt、文本提案、审核日志和相册媒体新增数均为 0。一次性容器已自动删除，三个 D45 Worker 继续 running，三个 intake 仍为 `closed`。结合既有 `wechat-text-v1` 与 `wechat-image-v1` 的真实 `passed/pass` 和清理证据，D45.18A 完成；脱敏结果已实际补充至腾讯云工单 `202607144002`。D45.18B 仍未完成，不据此开启任何 intake。
    - 2026-07-14：执行前只读审计发现手册中的一次性 Job 命令未显式把 `D45_PREFLIGHT_CONFIRMATION` 传给容器，且未将 `PINCHE_API_IMAGE` 固定为已核验 digest，直接执行会关闭式失败或存在拉取 `latest` 的版本偏差。已先以回归锁定并修正手册为 `--pull never`、不可变镜像引用和仅该 `--rm` 容器的 `-e` 传入；未运行 Job、未读取密钥、未改变 API/Worker/门禁。下一步仅做运行时脱敏前置核验。
    - 2026-07-14：微信后台真实保存返回“服务器地址验证失败”。只读核对线上路由与微信官方文档后确认，首版 GET 错用了安全模式 POST 的 `msg_signature`、AES 解密和 AppID 校验；官方 GET 实际只以 `signature=SHA1(sort(Token,timestamp,nonce))` 验签并原样返回明文 `echostr`。用户确认采用最小方案 A：仅纠正 GET 及其 spec/测试/手册，安全模式 JSON POST、状态机、门禁和预演保持不变；修复、部署和真实保存通过前，本项与三个 intake 继续保持未完成/`closed`。
    - 2026-07-14（首版 GET 实现前的历史记录）：已根据微信后台实际“消息推送配置”页面确认，保存安全模式回调前必须完成 GET URL 验证，且生产配置必须选择 JSON。当时服务只实现 POST 加密 JSON 事件；经用户确认，按 Requirement 5/13 先补同一路由的最小 GET 验证与自动化回归，三个 intake 继续 `closed`，不提交控制台配置。
    - 2026-07-13：已按实施计划进入开发；仍不读取密钥、不发真实请求、不改变三类 intake。
    - 2026-07-13：代码实现与本地验证完成；生产真实 harmless 预演、密钥读取和服务商请求尚未执行，因此本项保持未勾选。
    - 2026-07-13：完成发布后完成性审计修正：生产预演图片/视频提交现按真实异步服务商语义进入 `awaiting_callback`，不在提交阶段误判 `Pass`，预演私有 COS 对象由命中 HMAC 的微信/腾讯回调清理并释放 provider 锁；本地回归已覆盖异步提交、回调清理和不泄漏 raw trace/job。真实 harmless 预演仍未执行，因此本项继续保持未勾选。
    - 2026-07-13：上线前实证发现真实微信文本客户端返回 `suggestion` 而非 `resultCategory`，预演会将无害 `pass` 误判为失败；同时异步回调完成、清理失败和超时缺少可证明的终态/解锁保障。当前按 Requirement 13 先补回归与最小状态机修正；生产 Stack、密钥和三个 intake 均未改动。
    - 2026-07-13：第二轮上线审查发现三个必须先修正的验收缺口：预演视频误走普通源对象白名单、`started`/终态运行可能遗留 provider 锁、以及图片预演的未知 trace 可能抢占普通用户回调。当前仅补这些 Requirement 13 所需的回归与最小修正；发布、密钥和三个 intake 继续不动。
    - 2026-07-13：上线前最终修正完成并经独立复核：真实微信文本按 `suggestion` 映射；图片/视频预演走独立严格 transport；`started`、同步、回调和超时终态均原子解锁；服务商外发在身份、URL 或关联准备完成后紧邻刷新 guard；关闭预演后保留关联 HMAC 以收口既有回调，未知普通图片回调不被抢占；同步、回调和超时的 COS 清理失败均发安全高优告警。完整 `npm run check` 通过，尚未部署、读取生产密钥、发送真实请求或改变任一 intake；D45.18A 继续未勾选。
    - [x] 新增默认关闭的一次性 API 容器 Job；仅在生产、精确确认、指定有效 `system_admin`、完整 provider 配置和三个 intake 均为 `closed` 时运行；不新增 HTTP 路由或后台入口。
    - [x] 新增隔离预演运行/尝试存储、单活动运行与 15 分钟人工限频；只保存不可逆 provider 关联摘要和最小审计，不复用用户审核、文本提案、媒体、普通重试或通知。
    - [x] 使用代码白名单无害 case：文本以专用测试管理员 openid 调用微信；图片/视频使用专用私有 COS 前缀和严格白名单；调用方不能提供正文、openid、对象 Key、URL、回调地址或 provider 参数。
    - [x] 微信/腾讯回调先解析预演关联，只更新预演状态；重复/迟到事件幂等，未命中保持现有用户回调链；任何结果不得调用用户状态机或签发用户 URL。
    - [x] 为同一路由补齐微信官方 GET URL 验证；以 `signature` 对 Token、timestamp、nonce 的三参数 SHA-1 结果验签并原样回显明文 `echostr`，GET 不读取或使用 `msg_signature`、AESKey、AppID、`encrypt_type` 或 body；无效验证无副作用且不泄漏请求参数或密钥。
      - [x] 复核 requirements v1.3、design v1.3、tasks v1.2 与生产手册中的 GET/POST 协议边界；2026-07-14 用户已确认该版 spec，可以进入 TDD 实施。
      - [x] 先补失败测试，再覆盖微信官方示例、伪造/缺失 `signature`、精确回显不裁剪，以及仅携带 `msg_signature` 与加密 `echostr` 的首版错误协议必须被拒绝；静态路由检查须区分 GET 的 `signature` 与 POST 的 `msg_signature`。
      - 2026-07-14：GET 协议纠偏实现由提交 `46fd0f0` 完成，live-contract 加固最终提交为 `1bb066c`；微信官方 GET 回调定向回归 17/17、live-contract 定向回归 11/11、`npm run d45:unit` talk 5/5 且主测试 445/445、`npm run d45:check` 与 `npm run d45:smoke` 71/71 均通过；完整 `npm run check` 通过。
      - [x] 按 develop → main → publish 顺序逐级完成 CI，记录三分支提交、Actions run 与发布镜像摘要；任一级失败立即停止。
        - 2026-07-14：develop `f2b702a`（Actions `29312085597`）、main `9dc3332`（Actions `29312212208`）和 publish `79f1bb9`（Actions `29312685672`）均成功；publish API 不可变摘要为 `sha256:428e1501f2412e38474d50715d7e7317994ab46b38049eec5e2e2e447590971b`。
      - 2026-07-14（历史部署边界，未满足；已由 2026-07-15 经用户确认的四个 D45 容器边界替代）：原计划仅替换 `pinche-api-1`，核对不可变镜像摘要、`/health`、`/health/db` 和三个 intake 仍为 `closed`，且不重启或改动其他容器。该次 publish 后 Watchtower 自动更新了 `pinche-api-1` 和 `pinche-admin-web-1`，未执行人工重建；API 已解析到当时不可变摘要，`/health` 与 `/health/db` 均为 200、裸回调为 400，admin 首页为 200，审核 Worker 未变。该失败记录不作为完成项；本轮最终部署证据以上方 2026-07-15 审计记录为准。
      - [x] 微信后台以安全模式与 JSON 数据格式真实保存成功，官方 GET 验证通过且配置持久化；脱敏确认未写入审核、媒体或预演状态。
        - 2026-07-14：用户在微信小程序后台完成保存，平台回显“服务器配置已完成”，并提示配置将在 5 分钟内生效；未记录 Token、AESKey、签名或回调请求参数。
      - 2026-07-14：历史首版曾以“加密 `echostr` + `msg_signature` + AES/AppID”实现并通过定向回归、`d45:unit`（438/438）、`d45:check`、`d45:smoke`（71/71）和完整 `npm run check`；该测试与错误实现互相印证，已被本次协议纠偏取代，不计作任务完成证据。真实微信后台保存失败，待按官方 GET 协议修复、重新验证、部署并完成真实保存后才能勾选；D45.18A 父项与三个 intake 继续未完成/`closed`。
    - [x] 依次验证文本、图片、视频无害 `Pass`、鉴权、私有对象抓取、回调认证与清理；完成/失败/超时均核验预演对象删除，且所有门禁仍为 `closed`。
    - [x] 新增预演单测、回调隔离/重复测试、门禁/配置/日志脱敏检查与生产手册；记录仅含 case、服务商、结果类别、耗时、配置/镜像指纹和清理结论。
  - [x] D45.18B 完整结果与故障放行验证（不由生产预演替代）。
    - 2026-07-15：新增只允许非生产执行的 `d45:release-matrix`，以 8 组假客户端、真实签名回放和清理测试覆盖微信文本/图片及腾讯视频的 `Review`/`Block`/`Error`、超时、权限、额度、重复/过期回调、租约失效和拒绝后图片/视频清理；116/116 通过。该入口已纳入根 `precheck`，不读取生产凭证、不访问公网，也不发送违规样本。
    - 2026-07-15：同轮 `d45:unit` 449/449、`d45:check`、`d45:smoke` 71/71 均通过；生产真实预演仍仅使用无害 `Pass`，三个 intake 继续为 `closed`。本次只完成代码与故障验证，不取得或代替独立放量审批，不执行 `moderated` 切换。
    - 2026-07-15：最终完整 `npm run check` 退出码 0。生产只读复核确认 API、retry、orphan scan、preflight timeout 四个 D45 容器均为 running，继续使用不可变摘要 `sha256:65577299838f2d196f62ecf40f62d71fb3f62fa51d5fc4e1c247e900ea01b1a5`；API 容器中的文本、图片、视频 intake 均为 `closed`，外部 `/health` 与 `/health/db` 返回 200 且数据库 schema 完整。复核过程中未重启、替换或修改任何容器。
    - [x] 以假客户端、签名回放或服务商正式支持的隔离能力验证微信/腾讯 `Review`/`Block`/`Error`、超时、权限、额度、重复/过期回调和拒绝后清理；不得在生产发送违规样本或故意破坏生产凭证。
    - [x] 只有 D45.18A 与本项均完成、独立放行审批通过且观察指标满足条件后，才可另行讨论将任一 intake 切为 `moderated`；本任务不执行该切换。

## D45 验收

- [x] 中文 requirements、design、tasks 已按混合方案重写。
- [x] 腾讯云 TMS、CI 图片及 COS 图片自动审核依赖已清理。
- [x] 微信文本与图片审核生效且异常不放行。
- [x] 腾讯云只审核完整视频画面与音轨。
- [x] 私有 COS 与全部 API 发布门禁阻止未批准内容访问。
- [x] 管理员可复核并保留审计，小程序状态提示正确。
- [x] 本地自动化验证全部通过。
- [x] 生产受控预演与完整结果/故障放行验证全部通过。

## 验证记录

- 2026-07-12：按用户确认路线重写三件套，当时尚未开始 D45.2 清理。
- 2026-07-12：完成 D45.2；腾讯云适配器收窄为视频，移除 TMS/CI 图片配置和运行时调用。内容审核测试 50/50、D42 视频创建 10/10、D42 媒体 47/47、D44 检查及 API 语法检查通过。
- 2026-07-12：完成 v1.1 spec 校验修正；统一真实配置名，补充共享 token、scene/结果映射、文本 applicator、provider attempts、微信安全回调和额度边界。
- 2026-07-12：完成 D45.3；腾讯云回调通过 provider attempt 定位并对旧/重复/管理员结果返回 200 幂等响应；版本或对象 Key 过期结果保持隐藏并返回 stale。0025 在任何数据修改或 DDL 前预检任务/提案重复键及现有表、索引、生成列形状，再可重入地规范化历史 provider JobId 冲突、创建/回填 attempts 与提案字段。文本幂等键仅在同任务且相同摘要时复用；没有 provider attempt 身份的媒体结果关闭式失败。内容审核及微信基础回归 98/98 通过。
- 2026-07-12：完成 D45.3 审查加固；0025 在 DML/DDL 前预检提案基表锚点、`action`/`idempotency_key` 的类型/长度/可恢复阶段/默认值及非生成列形状、`current_job_id` 完整表达式、索引顺序/BTree/非表达式形状，以及 attempts 表的引擎、默认值、必需列和外键。任何不匹配均关闭式失败，新增回归均断言未执行规范化写入。独立复审通过；定向内容审核、微信和迁移回归 112/112 通过，语法与差异检查通过。
- 2026-07-12：完成 D45.4 审查加固；共享 token 的单一截止时间覆盖请求、正文解析和条件缓存写入，旧 worker 不得覆盖新 token；生产微信审核校验 Redis URL/host/port。D45.4 定向测试 36/36、环境检查与 API 语法检查通过。
- 2026-07-12：完成 D45.5。微信文本审核覆盖昵称、私有门店/剧本、拼车创建/更新、独立 NPC 角色创建/编辑、评价、消息和置顶消息；通过结果仅在同一事务 applicator 中应用，Review/Error 保持隐藏提案，risky 拒绝、未知值关闭式进入 error。文本 `subject_version` 始终为标签化文本摘要；每次操作用独立 `text-op` 身份并在 applicator 重验真实业务目标。提案仅保存 action 白名单 payload 与安全结果 ID/类型；同秒基线、资料 PATCH、权限/领域变化、旧/新幂等键、管理员批准回放、终态重复请求和置顶 `null` 默认文案均有回归。独立规格复核与高风险质量复核通过；新鲜内容审核/微信回归 171/171、文本/API 定向 84/84、API 语法 48 files、D19/D24/D26/D28 与差异检查通过。真实 MySQL 并发集成留待 D45.17/D45.18 验证。
- 2026-07-12：完成 D45.6/D45.7。图片 finalize 在事务内创建 `wechat_sec_check` 任务，提交后以 60 秒 GET 签名 URL、上传者数据库 openid 和 `scene=4` 调用微信；仅 trace_id 作为当前 attempt 持久化，缺 openid/上游失败保持隐藏 error。旧 retry Worker 只认领当前支持的腾讯视频，防止在 D45.10 实现微信分发前抢占微信图片任务。安全回调仅接受本期约定的加密 JSON 事件，验证 SHA-1 签名、AES-256-CBC/PKCS#7/AppID、256KiB 上限，以 trace_id 关联并从锁定媒体读取对象 Key/ETag；重复、旧、删除、版本变化和管理员事件均 200 幂等且不覆盖。独立规格/安全/质量复核通过；新鲜图片+审核+微信回归 262/262、API 语法 49 files、环境和差异检查通过。微信控制台 URL 验证与真实回调协议在 D45.18 非生产联调中确认。
- 2026-07-12：完成 D45.7。新增微信安全模式 JSON 事件接收：`msg_signature` 验签、43 位 EncodingAESKey 的 AES-256-CBC/PKCS#7 解密、AppID 校验和严格 `wxa_media_check` 结构归一化；未知 suggestion 关闭式写 error。回调只通过 trace_id 定位 provider attempt/任务，媒体 ETag、对象 Key、当前尝试和管理员优先级在事务锁内重验，重复、旧、未知、删除或过期事件均 200 幂等且不放行。独立安全复核未发现 P0/P1；回调/服务/配置定向 40/40、内容审核与微信回归 196/196、相册图片 66/66、API 语法与差异检查通过。未实现 GET handshake：当前已确认范围仅为微信安全模式 POST JSON 事件，未引入未定义的握手协议。
- 2026-07-13：完成 D45.8。腾讯视频请求仅接受 `videos/source/*.mp4`，明确 Average 100 帧、画面+音轨、Detail 回调，提交响应严格要求 `JobId`/`DataId`/允许状态；Detail 回调严格按 `State=Success` 与 `Result=0/1/2` 映射，未知或失败保持 hidden error。当前/上一枚回调令牌可轮换，任何单独 provider 开关均不能绕过生产配置校验；已记录的旧 attempt 返回 200 stale，仅尚未记录 attempt 的已知 pending/error 任务返回 503 重试。腾讯 Detail raw body 独立上限为 1 MiB，微信保持 256 KiB。本地/COS 拒绝清理覆盖视频 source/display/cover，拒绝后转码回调不再恢复展示或封面。质量复核曾发现“迟到转码同 key 重写”会遗留对象的 P1；现已在媒体行锁内将经校验输出合并/重排同一清理任务，撤销旧 lease、保留对象与重试历史，普通重复 Block 不重排，修复后独立复审通过。D42 COS inspection 断言已补齐既有的 ETag 返回值，未修改生产行为。本轮 P1 聚焦 47/47、内容审核 210/210、相册 72/72、D42 API server 14/14 与 stream 10/10、环境/API 语法/差异检查通过。根 `npm run check` 仍仅由未改动 D14 静态断言（期望 `config.subscribeMessage.enabled`，实现为既有 `runtimeConfig.subscribeMessage.enabled`）失败。
- 2026-07-13：完成 D45.9。所有服务端读取、列表/计数/标签、创建响应与签名 URL 统一以 `approved`/`approved_legacy` 为发布条件；未批准上传者仅收到无 URL 占位。小程序同时收紧批量下载、预览和异步回写，并在 `onShow` 强制回源，使审核撤销后清除图片/视频本地缓存并关闭失效预览。独立安全复核未发现 P0/P1；内容审核/相册/API/后台回归 295/295、小程序与共享媒体回归 35/35、API 语法检查、小程序构建和差异检查通过。
- 2026-07-13：完成 D45.9 质量修正。成员直读、公开直读与 `onShow` 刷新共享不透明列表代次，旧 approved 响应在写入前二次验代次后不得回写；当前代次 401/403 统一写入空列表并清除缓存、请求状态和预览。新增 deferred 乱序、写入间隙和访问失效回归；独立复审未发现 P0/P1。小程序/共享媒体 41/41、内容审核/相册/API/后台 295/295、API 语法检查、小程序构建和差异检查通过。
- 2026-07-12：完成 D45.9 最终复核与修正。上传者未批准占位不再计入 `visible_count`；车头首页的 `active_album_photo_count`/`photo_count` 仅统计已发布媒体且保持原有失败视频计数口径。瀑布流以渲染代次和 `filteredPhotos` 当前规范行拒绝迟到 approved 事件，避免审核撤销或筛选切换后回写旧媒体；旧请求的 finally 也不能清除新请求槽位。两轮独立规格/质量复审均无 P0/P1；新鲜审核/相册 API 回归、小程序全部测试、后台共享测试、API 语法检查、小程序构建和差异检查均通过（构建仅有现有第三方 Sass 弃用提示）。
- 2026-07-12：完成 D45.10。Worker 仅认领明确的微信文本、微信图片和腾讯视频路由，使用 `FOR UPDATE SKIP LOCKED`、任务级 token 租约、有限指数退避/抖动、运营错误高优告警与耗尽排除。初始和重试的三类 provider 调用均在数据库 `CURRENT_TIMESTAMP` 下原子续租 90 秒；Redis/token、微信请求/正文及腾讯视频请求/正文均有有界 deadline。图片 URL 在续租后才生成，为单对象私有 GET、5 分钟有效且不写库/日志/响应，覆盖完整提交链及至少两分钟异步抓取余量。两轮独立规格与安全复核均无 P0/P1；内容审核/微信回归、相册签名 URL 回归、API 语法、环境与差异检查通过。根 `npm run check` 的其余链路通过，仍仅在未改动的 D14 静态断言（期望 `config.subscribeMessage.enabled`，现有实现为 `runtimeConfig.subscribeMessage.enabled`）处停止。
- 2026-07-12：完成 D45.11。新增 `system_admin` 管理员审核 API（列表、详情、批准、拒绝、重试），筛选参数和决定 body 均严格白名单；SQL 仅查询 review/error，详情用 DTO 脱敏 provider attempt、租约、对象键、原始 URL 与响应摘要。媒体预览只会在当前 active 媒体、provider/类型/不可变版本和受控私有路径均匹配时签发 60 秒 COS URL，响应禁止缓存。管理员媒体决定在行锁内校验对象版本和条件更新；重试在条件 requeue 成功后同一事务退役旧 attempt，使迟到 Pass/Review/Block 回调保持 stale。`CONTENT_MODERATION_CALLBACK_STALE` 对外稳定为 409。两轮独立规格/安全复核无未解决 P0/P1/P2；管理员定向回归 41/41、API 全量测试、内容审核/签名 URL/微信 token 回归、API 语法（53 files）、环境与差异检查通过。
- 2026-07-12：完成 D45.12。管理后台新增仅 `system_admin` 可见的“内容审核”独立入口、严格白名单筛选队列、详情抽屉及批准/拒绝（原因必填）/重试；直达路由对非系统管理员显示拒绝态。页面仅消费 D45.11 DTO，媒体只使用 60 秒 `preview_url`，COS 签名 GET 同时设置 `response-cache-control=no-store, private, max-age=0`，图片/视频预览均使用 `no-referrer`，不接触对象键或原始媒体 URL。独立规格与安全复核无 P0/P1；内容审核/微信 token/签名 URL 全量定向回归、后台内容审核 6/6、既有后台运行时与相册媒体测试、后台生产构建、API 语法和差异检查通过。因本地没有已认证的审核队列，未生成实机页面截图；真实联调仍按 D45.18 执行。
- 2026-07-12：完成 D45.13。小程序以关闭式白名单统一将 `pending`/`processing`/`error` 映射为“内容正在审核”、`review` 映射为“内容需要进一步审核”、`rejected` 映射为“内容未通过安全审核，如有疑问请联系客服”；只对上传者的未批准媒体显示状态，不读取服务端 `moderation_message` 或展示服务商、分数、标签、命中词。文本 Review/Error 通过稳定错误码映射，记录、昵称、私有店/剧本、建车、留言和置顶仅在请求成功后更新当前数据。独立规格/安全复核无 P0/P1；小程序审核呈现 3/3、相册 URL 17/17、既有小程序媒体 19/19、生产构建和差异检查通过（构建仅有既有第三方 Sass 弃用提示）。
- 2026-07-12：完成 D45.14。统一内容审核 telemetry 以 provider/subjectType/outcome 低基数维度记录创建、提交（含失败）、独立延迟直方图、结果、已安排/耗尽重试和未批准读取；队列深度与最老年龄分别作为 gauge 发布。微信 token/权限/额度、腾讯视频 CAM/策略/额度/欠费（含 `RequestLimitExceeded`）及重试耗尽均为高优先级告警；回调鉴权和 token 刷新失败独立计数。孤儿扫描对比受限 `uploads/session-album/` COS 清单、媒体和审核任务；默认仅报告，显式双开关清理时至少保留 48 小时、删除前再次核对引用、保护历史 `photo_url`，并在每个 COS/数据库边界续租，失租关闭式停止。日志/指标严格白名单，不含对象键、签名 URL、凭证或私密文本。独立规格与安全复核无未解决 P1/P2；内容审核回归 326/326、API 语法（56 files）、环境检查、差异检查和默认关闭的孤儿 Worker 烟测通过。
- 2026-07-12：完成 D45.15–D45.17。新增中文生产手册，明确微信免费能力受当前平台政策/额度约束而非永久 SLA，CI 仅承担视频画面与音轨审核，并明确不启用 TMS、CI 图片或 COS 图片自动审核。新增本地 `d45:unit`、`d45:check`、`d45:smoke` 并接入根检查；三者及完整 `npm run check` 均通过。验证覆盖相册图片/视频、后台内容审核测试与构建、小程序媒体测试与构建、迁移静态检查和完整根回归；小程序构建仅报告既有第三方 Sass 弃用提示。为使根检查验证真实的 D45 安全实现，同步修正了 D14、D23、D25、D31、D32、D33 的过时静态断言和 D31 测试夹具，不改变生产功能或放宽发布门禁。D45.18 真实云端联调仍未执行。
- 2026-07-12：D45.15–D45.17 复审修正完成。生产环境新增文本、图片、视频独立 `*_INTAKE_MODE`：默认 `closed`，`moderated` 必须同时满足全局与对应 provider，就绪前稳定返回 `CONTENT_MODERATION_INTAKE_CLOSED`，`legacy` 被生产配置拒绝；provider/全局开关不再承担流量暂停。文本、图片 intent/授权/finalize/旧上传、视频 intent/授权/对象检查/媒体创建均在写入前接收门禁；已有任务、回调和读取门禁不受关闭接收影响。纯资料类非文本更新保持兼容路径。小程序以不含服务商细节的中文文案提示暂停。`d45:unit` 355/355、`d45:check`、`d45:smoke` 71/71、管理后台生产构建和完整 `npm run check` 均通过；D45.18 真实云端联调仍未执行。
- 2026-07-13：D45.18 本地联调前置完成。新增 `d45-content-moderation-live-contract.js`：默认拒绝，只有源码锁定的 `.invalid` 目标与无害样本对才会以 `dry_run_deferred` 退出，输出严格限定为策略标识、结果和耗时；脚本全文由回归锁定为无依赖、无网络的离线预检。当前进程和工作树未注入微信、腾讯云 CI、COS、数据库、Redis、公开回调或审核开关配置；仓库级 Actions 密钥名称也未见 D45 审核配置，未读取主机密钥管理或实际密钥值。`d45:unit`、`d45:check`、`d45:smoke` 和完整根 `npm run check` 通过。真实非生产 Pass/Review/Block/Error、回调与故障演练因缺少隔离凭证、公开 HTTPS 回调和平台控制台配置而未执行，D45.18 保持未完成。
