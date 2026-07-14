# D45 Requirements：微信文本/图片与腾讯云视频混合内容审核

更新日期：2026-07-14

版本：v1.3

## 1. 目标与范围

D45 为上线后新增的用户文本、相册图片和相册视频增加“先审后发”能力。文本与图片使用微信小程序免费内容安全接口，视频保留腾讯云数据万象（CI）视频审核；COS 只作为私有对象存储，不启用图片自动审核或全桶自动冻结。数据库审核状态是唯一发布依据，所有服务异常均关闭式失败。

本期只审核切换后新内容。历史媒体回填为 `approved_legacy`，不执行历史扫描。本期不实现自动封号、产品化申诉、客户端 FFmpeg 拆帧，也不把微信密钥或 access token 下发客户端。

## 2. 术语与审核矩阵

| 内容 | 审核服务 | 接口 | 结果方式 |
|---|---|---|---|
| 昵称、评价、留言、置顶留言、私有门店/剧本、拼车说明 | 微信 | `msgSecCheck` | 同步 |
| 相册图片 | 微信 | `mediaCheckAsync`，`media_type=2` | 异步事件 |
| 相册视频画面和音轨 | 腾讯云 CI | 视频审核任务 | 异步回调/查询 |
| COS 对象 | 无自动审核 | 私有存储 | API 门禁 |

状态统一为 `pending`、`processing`、`approved`、`review`、`rejected`、`error`；历史媒体可为 `approved_legacy`。只有 `approved` 与 `approved_legacy` 可被普通用户读取。

## 3. 验收需求

### Requirement 1：统一数据模型与不可变版本

1. 系统 SHALL 使用统一审核任务表记录服务商、内容类型、业务 ID、不可变版本、状态、建议、标签、错误、重试和完成时间。
2. 系统 SHALL 使用 `(subject_type, subject_id, subject_version, provider)` 唯一约束保证幂等。
3. 图片和视频 SHALL 使用对象 ETag 或确定性版本作为 `subject_version`；文本 SHALL 使用带字段标签标准化内容的 SHA-256。
4. Review/Error 文本 SHALL 存为隐藏提案，不先修改线上实体。
5. 所有管理员动作 SHALL 写入审计记录。
6. 系统 SHALL 记录每次异步提交的 provider、provider_job_id/trace_id、attempt、提交时间和是否为当前有效尝试，并对 `(provider, provider_job_id)` 建立唯一约束。

### Requirement 2：历史兼容与新内容默认隐藏

1. 迁移前媒体 SHALL 回填为 `approved_legacy`。
2. 新图片和视频 SHALL 显式写 `moderation_status = pending`。
3. 技术处理状态与内容审核状态 SHALL 分离；视频转码 ready 不得使未审核视频可见。
4. D45 SHALL NOT 自动审核历史媒体。

### Requirement 3：微信鉴权与 access token

1. 微信 AppSecret SHALL 只存在服务端密钥配置中。
2. 系统 SHALL 由微信共享 access token 模块统一缓存 `access_token`，订阅消息和内容安全接口不得维护独立缓存。
3. 多实例生产环境 SHALL 使用现有 Redis 保存 token 和分布式单飞锁，并在过期前刷新。
4. 微信返回 token 失效错误时 SHALL 仅强制刷新一次并重试原请求。
5. 日志、指标和响应 SHALL NOT 暴露 AppSecret、access token、完整私密文本或长期媒体 URL。
6. 生产开启微信审核但缺少现有 `WECHAT_APP_ID`/`WECHAT_APP_SECRET` 或 Redis 时 SHALL 启动失败。

### Requirement 4：微信文本审核

1. 昵称、评价、留言、置顶留言、私有门店/剧本和拼车说明 SHALL 在业务写入前调用 `msgSecCheck`。
2. 一次变更中的多个短字段 SHALL 带稳定字段标签合并送审。
3. 请求 SHALL 携带内容生产者 `openid`、正确 `scene` 和版本参数；没有可验证 openid 时 SHALL 保持隐藏或拒绝写入，不能跳过审核。
4. Pass SHALL 应用业务变更；Review SHALL 保存隐藏提案；Block SHALL 拒绝且不修改实体；Error SHALL 保存隐藏提案并重试。
5. 昵称提案批准时 SHALL 原子校验旧版本；基线变化 SHALL 标记 stale，不能覆盖新值。
6. 系统文本、手机号和管理员审核备注 SHALL NOT 送审。
7. 文本提案 SHALL 保存 action、最小业务 payload、actor_user_id、base_version 和幂等键；Pass、重试后 Pass 或管理员批准都 SHALL 使用同一提案应用器。
8. 提案应用器 SHALL 在同一事务中重新验证权限、业务约束和基线；创建类操作 SHALL 幂等，实体或权限变化时 SHALL 标记 stale 且不得应用。
9. 没有有效 openid 时 SHALL 返回稳定的 `CONTENT_MODERATION_OPENID_REQUIRED`，不得静默跳过审核。

### Requirement 5：微信异步图片审核

1. 图片上传完成后 SHALL 先存入私有 COS，并创建 `pending` 媒体和微信审核任务。
2. 系统 SHALL 为微信可下载图片生成短时、最小权限 URL，再调用 `mediaCheckAsync(media_type=2)`。
3. 图片 SHALL 复用现有 JPEG/PNG 与 4 MB 上限校验，提交前拒绝微信不支持的格式或超限文件。
4. URL 有效期 SHALL 只覆盖微信抓取窗口，不得作为用户访问地址保存或返回。
5. 系统 SHALL 持久化微信 `trace_id` 及提交尝试，通过微信小程序事件推送接收审核结果。
6. 生产事件推送 SHALL 使用安全模式和 JSON 数据格式；POST 路由 SHALL 在通用 body parser 前读取受限原始请求体并完成验签、解密和结构校验。
7. 同一回调路由 SHALL 在微信保存消息推送配置时处理 GET URL 验证：读取 `signature`、`timestamp`、`nonce` 与明文 `echostr`，将 Token、timestamp、nonce 按字典序排序并拼接后计算 SHA-1，校验 `signature`；验证通过后 SHALL 在 1 秒内以 `text/plain; charset=utf-8` 原样返回收到的 `echostr`，不得裁剪、解密或替换。GET 验证 SHALL NOT 要求或使用 `msg_signature`、EncodingAESKey、AppID、`encrypt_type` 或请求体；任何无效验证均不得写入审核、媒体或预演状态，也不得回显 Token、密钥或其他请求参数。
8. 系统 SHALL 以 trace_id 找到提交尝试和审核任务，再从任务读取媒体 ID、对象 Key 与 ETag，并在事务内与当前媒体版本比较；不得假设回调包含对象 Key 或 ETag。
9. Pass SHALL 批准图片；Review SHALL 保持隐藏并进入人工队列；Block SHALL 保持隐藏并创建幂等清理任务；未知结构 SHALL 进入 error。
10. 重复、非当前尝试、过期或管理员决定后的事件 SHALL 幂等成功且不得覆盖当前有效状态。

### Requirement 6：腾讯云视频审核

1. 视频源对象稳定后 SHALL 按媒体 ID 与 ETag 幂等提交腾讯云 CI 视频审核。
2. 腾讯云视频策略 SHALL 同时覆盖画面与音轨；仅转码成功不得发布。
3. 回调 SHALL 验证高强度令牌或腾讯云签名，并匹配任务 ID、`data_id`、对象 Key 和 ETag。
4. Pass、Review、Block、Error SHALL 映射到统一状态机。
5. Block SHALL 为源、展示和封面对象创建一次幂等清理任务。被拒绝后迟到的转码回调如携带已通过路径校验的展示或封面对象，SHALL 在同一事务中将源、展示、封面合并到该清理任务、重新排队并撤销旧租约；不得恢复媒体 URL 或审核状态。
6. D45 SHALL 删除腾讯云 TMS 文本和 CI 图片审核代码、配置与文档，保留且收窄腾讯云视频能力。
7. 若腾讯云回调令牌必须位于 URL，网关和应用访问日志 SHALL 对令牌脱敏，并支持独立轮换。

### Requirement 7：私有 COS 与 API 发布门禁

1. COS 桶 SHALL 为私有读写，客户端不得拥有任意读取权限。
2. 未批准媒体 SHALL NOT 出现在普通列表、公开分享、计数、标签、批量下载候选中。
3. 图片预览/缩略图/下载以及视频播放/range/封面/下载接口 SHALL 独立校验审核状态。
4. 只有 approved/approved_legacy SHALL 生成短时签名 URL。
5. 上传者可看到无内容 URL 的状态占位；其他用户不可发现未批准媒体。
6. 系统 SHALL 扫描“COS 有对象但无业务记录或审核任务”的孤儿对象并告警/清理。

### Requirement 8：关闭式失败与重试

1. 网络、超时、限流和 5xx SHALL 使用带抖动的有限指数退避。
2. 微信 token、权限、额度及腾讯云 CAM、策略、额度、欠费错误 SHALL 保持内容隐藏并告警。
3. Worker SHALL 使用 `FOR UPDATE SKIP LOCKED` 与租约令牌防止重复处理。
4. 超过重试上限 SHALL 保持 error，停止自动认领并进入人工队列。
5. 任何异常或未知服务商响应 SHALL NOT 映射为 Pass。

### Requirement 9：管理员人工复核

1. 仅 `system_admin` 可筛选、查看、批准、拒绝和重试 review/error 项目。
2. 拒绝 SHALL 必填原因；所有动作 SHALL 审计。
3. 管理员批准只应用当前不可变版本；文本基线变化 SHALL stale。
4. 管理员决定 SHALL 优先于后续微信事件或腾讯云回调。
5. 管理员媒体预览 SHALL 使用短时 URL，且不得向普通用户开放。

### Requirement 10：用户体验

1. pending/error 向上传者显示“内容正在审核”。
2. review 显示“内容需要进一步审核”。
3. rejected 显示“内容未通过安全审核，如有疑问请联系客服”。
4. Review 文本 SHALL 保持页面当前数据不变并提示已进入审核。
5. 小程序 SHALL NOT 展示服务商标签、分数或敏感命中词。

### Requirement 11：指标、隐私与运维

1. 系统 SHALL 记录按 provider/subject_type/outcome 聚合的创建、提交、延迟、结果、重试和拒绝访问指标。
2. 系统 SHALL 监控队列深度、最老任务年龄、结果比例、token 刷新失败、回调认证失败和孤儿对象。
3. 微信权限/额度、腾讯云 CAM/额度/欠费、重试耗尽 SHALL 触发高优先级告警。
4. 指标标签和日志 SHALL NOT 包含完整私密文本、AppSecret、access token 或可复用签名 URL。

### Requirement 12：发布与回滚

1. 发布顺序 SHALL 为数据结构与门禁、后台与指标、微信文本、微信图片、腾讯云视频。
2. 每个媒体类型 SHALL 有独立开关和观察窗口。
3. 每种内容 SHALL 有独立的新提交接收门禁：生产只允许 `closed` 或 `moderated`；`closed` SHALL 稳定拒绝新提交，`moderated` SHALL 在全局审核与对应 provider 均就绪时才接收，任一未就绪不得退化为直写或上传；`legacy` 仅允许非生产兼容路径。
4. 回滚 SHALL 只把受影响内容的接收门禁关闭，保留读取门禁、回调和已有任务处理；不得用全局或 provider 能力开关替代接收门禁，也不得批量批准 pending/review/error 内容。
5. 运维手册 SHALL 记录微信接口权限、事件推送、额度，腾讯云视频策略/CAM/费用，以及 COS 私有桶设置。
6. “微信免费”仅表示当前微信平台免费额度内不按次付费；系统 SHALL 监控实际接口额度，不把免费政策作为永久 SLA 或成本保证。

### Requirement 13：验证

1. SHALL 采用测试先行实现新增行为，并使用假微信/腾讯云客户端完成本地自动化测试。
2. SHALL 通过审核单测、迁移检查、图片/视频门禁测试、管理后台和小程序构建以及 `npm run check`。
3. 系统 SHALL 提供只在生产 API 镜像内执行的一次性受控预演 Job；它不得监听端口、不得提供管理员网页或公网触发入口，也不得调用任何普通用户写入、上传或审核业务路径。
4. 受控预演 SHALL 在启动、每次真实服务商外发、每次异步回调落库和结束时同时验证：`NODE_ENV=production`、显式启用的预演开关与一次性确认、指定运维身份仍为 `system_admin`、目标服务商配置完整、且文本/图片/视频三个 `*_INTAKE_MODE` 全部为 `closed`。任一条件不满足 SHALL 中止，不得改变任何门禁。
5. 受控预演 SHALL 只接受编译进服务端的版本化无害样本 case；调用方不得输入正文、openid、对象 Key、URL、回调地址或服务商参数。它 SHALL 使用独立的预演运行/尝试记录、私有 COS 前缀和回调关联，且不得创建或修改用户文本提案、相册媒体、普通审核任务、普通管理员队列、用户通知或用户签名 URL。
6. 生产受控预演的真实范围仅为无害样本的 `Pass`、服务商鉴权、私有对象抓取、回调认证与结果归一化。它 SHALL NOT 被视为 `Review`/`Block`/真实额度或故障、真实用户写入链、并发/长时延或拒绝后清理的生产验证，也不得作为将任一 intake 切换为 `moderated` 的依据。
7. `Review`/`Block`/`Error`、超时、权限、额度、重复/过期回调和用户业务路径 SHALL 继续由本地假客户端、签名回放或服务商正式支持的隔离测试能力验证；不得为覆盖这些分支向生产服务商发送违规样本或故意破坏生产凭证。
8. 预演记录 SHALL 仅保存 case 标识、服务商、运行/配置与镜像指纹、安全结果类别、耗时、操作者、清理结论和必要的不可逆关联摘要；不得保存违规样本正文、openid、对象 Key、媒体或签名 URL、trace/job 原文、回调体、token 或密钥。
