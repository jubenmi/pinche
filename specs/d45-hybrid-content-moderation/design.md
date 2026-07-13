# D45 Design：微信文本/图片与腾讯云视频混合内容审核

更新日期：2026-07-12

版本：v1.1

## 1. 决策

D45 采用混合审核：微信免费接口负责文本和图片，腾讯云 CI 只负责完整视频画面与音轨，COS 只作为私有存储。业务数据库状态机与 API 门禁是发布权限的唯一来源，不启用 COS 图片自动审核或全桶自动冻结。

选择该方案是为了消除文本和图片按量审核成本，同时避免在小程序客户端运行不可信且资源昂贵的 FFmpeg，并保留成熟的视频审核能力。

## 2. 总体架构

```text
小程序
  │ 文本请求 / 图片或视频上传
  ▼
API ───────────────→ 私有 COS
  │                    │
  │ 创建 pending 任务   │ 仅短时签名访问
  ├─ 文本 → 微信 msgSecCheck（同步）
  ├─ 图片 → 微信 mediaCheckAsync（异步事件）
  └─ 视频 → 腾讯云 CI 视频审核（异步回调）
                       │
                       ▼
             统一审核状态机与审计
                       │
              approved/approved_legacy
                       │
                       ▼
                API 发布门禁 → 用户
```

管理员后台只消费统一 review/error 队列，不关心底层服务商。服务商适配器只负责鉴权、请求、响应归一化，不决定内容是否发布。

## 3. 模块边界

建议目录：

```text
apps/api/src/modules/content-moderation/
  constants.js              # 统一状态、provider 和 subject type
  normalize.js              # 标准文本、摘要、结果映射
  state-machine.js          # 合法迁移与管理员优先级
  repository.js             # 任务、提案、租约、审计
  service.js                # 统一业务编排
  wechat-client.js          # msgSecCheck/mediaCheckAsync
  wechat-callback.js        # 微信事件签名、解包和结构校验
  tencent-video-client.js   # 仅腾讯云 CI 视频
  tencent-video-callback.js # 仅视频回调
  retry.js                  # 错误分类、退避和租约
  telemetry.js              # 无敏感数据的事件/指标
  production-preflight.js   # 生产受控预演编排与硬门禁
  production-preflight-repository.js # 预演运行/尝试的隔离存储
apps/api/src/modules/wechat/
  access-token.js           # 订阅消息与内容安全共享 token、Redis 单飞刷新
  subscribe-message.js      # 改为使用共享 access-token
apps/api/src/jobs/
  content-moderation-production-preflight.js # 仅容器内一次性运行，不监听端口
```

旧 `tencent-client.js` 中的 TMS 与图片方法应删除或拆分，不能保留无调用的密钥和策略配置。

## 4. 数据模型

### `content_moderation_jobs`

核心字段：

- `subject_type`：`user_text`、`album_image`、`album_video` 等明确业务类型。
- `subject_id`：业务实体或提案 ID。
- `subject_version`：文本摘要或媒体 ETag。
- `provider`：`wechat_sec_check` 或 `tencent_ci_video`。
- `provider_job_id`：微信 `trace_id` 或腾讯云 JobId。
- `data_id`：内部随机关联 ID。
- `status`、`suggestion`、`label`、`score`。
- `attempt_count`、`next_retry_at`、`lease_token`、`lease_expires_at`。
- `decided_by_admin_user_id`、`decision_reason`、时间字段。

唯一约束：

```text
(subject_type, subject_id, subject_version, provider)
```

### 文本提案和审计

`content_moderation_text_proposals` 保存最小业务请求、字段标签、摘要、创建用户和基线版本。Review/Error 不修改实体。管理员批准在同一事务内校验基线并应用；不匹配时标为 stale。

`content_moderation_audit_logs` 记录管理员、动作、前后状态、原因和时间。

### 服务商提交尝试

新增 `content_moderation_provider_attempts`，保存 `moderation_job_id`、`provider`、`provider_job_id`、`attempt_no`、`is_current`、`submitted_at` 和响应摘要。`(provider, provider_job_id)` 唯一。每次重试先把旧尝试置为非当前，再写入新 trace_id/JobId；旧结果只计入 stale 指标，不能改变任务。

### 媒体字段

`session_album_photos.moderation_status` 默认仅用于历史回填 `approved_legacy`，新建记录必须显式为 `pending`。`moderation_object_version` 固定审核对应的 ETag。清理队列允许保存视频多个对象 Key。

## 5. 微信接入设计

### access token

`apps/api/src/modules/wechat/access-token.js` 是唯一 token 来源。它复用现有微信 AppID/AppSecret，使用生产 Redis 保存 token、过期时间和短租约刷新锁；进程内 Promise 再做一层单飞。收到 token 失效错误时清缓存、强制刷新并仅重试一次。现有 `subscribe-message.js` 同步改为调用该模块，禁止维护第二套缓存。

AppSecret 永不写日志或响应。配置：

```text
CONTENT_MODERATION_WECHAT_TEXT_ENABLED
CONTENT_MODERATION_WECHAT_IMAGE_ENABLED
WECHAT_APP_ID
WECHAT_APP_SECRET
WECHAT_CONTENT_SECURITY_EVENT_TOKEN
WECHAT_CONTENT_SECURITY_EVENT_AES_KEY
```

### 文本

业务边界把可审核字段整理成稳定格式：

```text
[nickname]\n张三
[note]\n周末拼车说明
```

调用 `msgSecCheck` 时传生产者 openid、scene 和固定版本。微信 `result.suggest` 只按 `pass → Pass`、`review → Review`、`risky → Block` 映射，其他值一律 Error。

scene 使用固定映射，业务代码不得自行选择：

| 业务内容 | scene | 含义 |
|---|---:|---|
| 用户昵称、私有门店/剧本资料 | 1 | 资料 |
| 评价、留言、置顶留言 | 2 | 评论 |
| 论坛式扩展内容 | 3 | 论坛 |
| 拼车标题、说明、DM/NPC 名称等动态内容 | 4 | 社交日志 |

没有生产者 openid 时返回 `CONTENT_MODERATION_OPENID_REQUIRED`。同步 Pass 后才执行原业务方法；Review/Error 保存提案；risky 拒绝。提案统一保存 action、最小 payload、actor、base version 和幂等键。重试 Pass 或管理员批准调用同一个事务型 applicator：重新校验当前权限和领域约束，创建操作按幂等键执行，基线或权限变化则标记 stale。

### 图片

图片 finalize 在同一事务创建媒体和审核任务。图片继续使用现有 JPEG/PNG、4 MB 上限。事务提交后生成只供微信抓取的短时 COS URL并调用 `mediaCheckAsync(media_type=2)`，把 `trace_id` 写入 provider attempt，状态进入 processing；短时 URL 不进入数据库摘要或日志。

微信通过小程序消息/事件服务器推送结果。生产强制安全模式，回调路由在通用 JSON parser 前限制并读取原始 body，完成签名验证、AES 解密和结构校验。接收端以 `trace_id` 找到当前 provider attempt 和任务，再锁定媒体并比较任务保存的 subject ID/version 与当前 object key/ETag。回调不需要、也不假设携带对象 Key 或 ETag。任何无法明确识别的事件都进入 error，旧 attempt 结果记 stale。

## 6. 腾讯云视频设计

只保留 CI 视频审核能力。视频源对象验证稳定后，以媒体 ID、对象 Key、ETag、内部 `data_id` 提交画面和音轨审核。转码回调只更新 processing 状态；内容审核 Pass 或管理员批准才更新 moderation 状态。CI Detail 回调只接受 `State=Success` 且将总 `Result` 的 `0/1/2` 分别映射为 Pass/Block/Review；缺失或未知字段一律进入 hidden error。

若视频已 `rejected`，迟到转码回调不得恢复 `display_url`、`cover_url`、处理状态或审核状态。它携带的已校验展示/封面输出在同一事务内按 `media → cleanup job` 顺序合并到原清理任务；即使 CI 重用同一确定性对象 Key，也作为新的输出事件重新排队、撤销旧 lease 并清除完成标记。对象集合保持去重且保留既有 source/display/cover，重试次数与错误历史不重置；普通重复 Block 不带该输出事件标记，不重排已完成任务。旧 worker 用失效 lease 完成时安全失败，下一次清理对已删除对象按幂等删除。

配置只保留：

```text
CONTENT_MODERATION_TENCENT_VIDEO_ENABLED
COS_SECRET_ID
COS_SECRET_KEY
COS_BUCKET
TENCENT_CI_VIDEO_REGION
TENCENT_CI_VIDEO_BIZ_TYPE
TENCENT_CI_VIDEO_CALLBACK_URL
TENCENT_CI_VIDEO_CALLBACK_TOKEN
TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN  # 可选，仅令牌轮换期保留
```

删除 TMS 策略和 CI 图片策略配置。腾讯云回调与微信事件使用独立路由和鉴权器，避免协议混用。若 CI 只能在回调 URL 携带令牌，反向代理和应用日志必须对该参数脱敏；新提交只携带当前令牌，接收端在轮换窗口同时接受当前与上一枚令牌，旧任务完成后清空上一枚令牌。

腾讯视频 Detail 回调原始 body 仅此路由允许最多 1 MiB，以容纳 100 帧与全部音频片段的合法结果；仍在读取前后受限并且不持久化片段文本。微信安全事件继续保持 256 KiB 上限，不与腾讯回调共用该例外。

## 7. 状态机与错误处理

```text
pending → processing → approved
                    ├→ review → approved/rejected（管理员）
                    ├→ rejected
                    └→ error → pending（重试）/人工处理
```

- provider 不得覆盖管理员决定。
- 重复同终态结果幂等成功；冲突终态记过期事件。
- 网络、超时、限流、5xx 可重试。
- 鉴权、权限、额度、欠费、策略错误保持 error 并告警。
- 达到上限后停止自动重试，内容继续隐藏。

## 8. 发布门禁

所有普通读取都使用统一 `isModerationPublished(status)`，仅允许 approved/approved_legacy。SQL 列表和计数先过滤，媒体详情接口再独立校验，签名 URL 构造器最后防御。上传者管理视图可看到状态与元数据，但未批准时所有媒体 URL 必须为 null。

COS 桶保持私有；上传凭证限制 Key 前缀、方法、大小和有效期。定时任务对比 COS 清单、媒体表和审核任务，发现孤儿对象后先告警，再按安全保留期清理。

## 9. 管理后台与小程序

管理员 API：

```text
GET  /api/admin/content-moderation
GET  /api/admin/content-moderation/:id
POST /api/admin/content-moderation/:id/approve
POST /api/admin/content-moderation/:id/reject
POST /api/admin/content-moderation/:id/retry
```

列表支持 provider、内容类型、状态、标签和时间筛选。reject 必填原因。媒体预览使用管理员专用短时 URL。

小程序仅显示“正在审核 / 进一步审核 / 未通过”三类用户文案，不展示服务商、标签、分数和命中词。文本 Review 不乐观更新当前页面值。

## 10. 监控、发布与回滚

指标按低基数维度统计任务、提交、结果、延迟、重试、回调鉴权失败、未批准访问和孤儿对象。告警覆盖微信 token/权限/额度、腾讯云 CAM/策略/额度/欠费以及队列最老年龄。

发布顺序：

1. 数据迁移、私有 COS 与读取门禁。
2. 管理队列、指标、重试和孤儿扫描。
3. 微信文本开关。
4. 微信图片开关与事件推送。
5. 腾讯云视频开关。

每个内容类型使用独立接收模式：`TEXT`、`IMAGE`、`VIDEO` 的 `*_INTAKE_MODE` 为 `closed`、`moderated` 或仅限非生产的 `legacy`。`closed` 在任何业务写入、上传授权、对象检查或媒体插入前以稳定 503 拒绝新提交；`moderated` 要求全局审核和对应 provider 均就绪，否则同样拒绝，绝不回退为未经审核的业务写入。接收模式不影响读取门禁、回调、管理员队列和已有任务 Worker。

provider 与全局审核开关只表示能力是否已配置，不能作为流量开关。发布时生产先保持三个接收模式为 `closed`。生产受控预演只验证无害样本的服务能力与回调，并且不能使任何类型进入 `moderated`；是否打开某一类型仍须经过完整的独立放行验证。回滚只把受影响类型接收模式切回 `closed`，保留门禁和已有任务处理；不得把 pending/review/error 批量改为 approved。

### 10.1 生产受控预演

生产受控预演是用户确认的窄化例外，用于在不开放任何普通用户提交的前提下验证生产凭证、私有对象抓取与真实异步回调。入口是生产 API 镜像中的一次性 Job，而不是 HTTP 路由或后台按钮。Job 只接收代码内白名单 case，并在启动、外发前、回调落库前和完成后都断言：生产环境、预演显式开关、一次性确认、允许的仍有效 `system_admin` 运维身份、完整 provider 配置以及三个 intake 均为 `closed`。任一断言失败即停止；预演不拥有也不改变 intake 开关。

新增 `content_moderation_production_preflight_runs` 与专用尝试关联。运行记录保存 case、provider、状态、时间、操作者、配置/镜像指纹、结果类别和清理结论；provider trace/JobId/DataId 只保存用于回调查找的带独立密钥 HMAC 摘要，不保存原文。每个 provider 仅允许一个活动运行，且每 15 分钟仅可由运维 Job 手动发起一次；预演不进入普通重试 Worker。微信和腾讯回调先以摘要解析预演关联，命中时只更新预演记录，重复或过期事件幂等结束；未命中才维持现有用户审核回调链。预演路径绝不得调用文本提案 applicator、`applyMediaResult`、普通清理队列、通知或用户签名 URL。

样本固定、版本化且无害：文本使用专用测试管理员已绑定的 openid，但不记录或输出它；图片和视频使用每次运行写入 `system/content-moderation-preflight/<run-id>/` 的私有固定样本。视频客户端为预演使用单独的严格对象 Key 白名单，不能放宽正常 `uploads/session-album/videos/source/*.mp4` 约束。文本、图片、视频按顺序单独运行；图片/视频完成、超时或失败都必须删除预演对象并核验，清理失败告警且停止后续 provider。预演只允许无害 `Pass` 成功；任何 `review`、`block`、未知结果、回调失败或超时都记录为未通过，不触碰用户数据。

## 11. 测试设计

- 单元：结果映射、文本规范化、token 缓存/刷新、签名验证、状态机、重试分类。
- 仓储：幂等创建、租约互斥、管理员优先、过期版本、审计。
- 集成：文本四结果、图片提交与异步事件、视频提交与回调、读取门禁。
- 安全：伪造签名、超大请求、未知结构、重复/过期事件、签名 URL 泄漏。
- UI：后台队列与操作、小程序状态文案。
- 生产受控预演：默认拒绝、三个 intake 均关闭、固定样本、运维身份、单运行/限频、独立运行记录、回调隔离、重复/过期回调、对象清理和日志脱敏；真实调用只验证无害 `Pass`。
- 完整结果与故障验证：微信/腾讯的 Review/Block/Error、超时、额度、权限、用户业务路径和拒绝后清理继续由假客户端、签名回放或服务商正式支持的隔离能力验证，不能通过生产违规样本替代。

所有本地自动化使用假服务商客户端，不依赖公网或生产凭证。真实微信额度由后台和运行指标读取；“免费”仅表示当前平台免费额度内使用，不作为永久 SLA。

## 12. 明确非目标

- 不启用 COS 图片自动审核或全桶自动冻结。
- 不使用腾讯云 TMS 或 CI 图片审核。
- 不在小程序客户端运行 FFmpeg 或持有服务端密钥。
- 不审核历史媒体。
- 不实现自动处罚、封号或完整申诉产品。
