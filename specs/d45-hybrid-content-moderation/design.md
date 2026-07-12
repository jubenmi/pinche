# D45 Design：微信文本/图片与腾讯云视频混合内容审核

更新日期：2026-07-12

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
  wechat-token.js           # access_token 缓存、单飞刷新
  wechat-client.js          # msgSecCheck/mediaCheckAsync
  wechat-callback.js        # 微信事件签名、解包和结构校验
  tencent-video-client.js   # 仅腾讯云 CI 视频
  tencent-video-callback.js # 仅视频回调
  retry.js                  # 错误分类、退避和租约
  telemetry.js              # 无敏感数据的事件/指标
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

### 媒体字段

`session_album_photos.moderation_status` 默认仅用于历史回填 `approved_legacy`，新建记录必须显式为 `pending`。`moderation_object_version` 固定审核对应的 ETag。清理队列允许保存视频多个对象 Key。

## 5. 微信接入设计

### access token

`wechat-token.js` 使用缓存记录 token 与过期时间，提前刷新；同一进程内只允许一个刷新请求。收到微信 token 失效错误时清缓存、强制刷新并仅重试一次。多实例部署可使用数据库/Redis 共享缓存；若当前没有 Redis，先使用数据库行锁与加密/受限配置存储。

AppSecret 永不写日志或响应。配置：

```text
CONTENT_MODERATION_WECHAT_ENABLED
WECHAT_MINIPROGRAM_APP_ID
WECHAT_MINIPROGRAM_APP_SECRET
WECHAT_CONTENT_SECURITY_EVENT_TOKEN
WECHAT_CONTENT_SECURITY_EVENT_AES_KEY   # 若启用安全模式
```

### 文本

业务边界把可审核字段整理成稳定格式：

```text
[nickname]\n张三
[note]\n周末拼车说明
```

调用 `msgSecCheck` 时传生产者 openid、scene 和固定版本。统一映射：微信“正常”→ Pass；“疑似”→ Review；“违规”→ Block；未知/异常→ Error。同步 Pass 后才执行原业务方法，其余结果只保存提案。

### 图片

图片 finalize 在同一事务创建媒体和审核任务。事务提交后生成只供微信抓取的短时 COS URL并调用 `mediaCheckAsync(media_type=2)`，保存 `trace_id`，状态进入 processing。

微信通过小程序消息/事件服务器推送结果。接收端验证签名（安全模式还需验签解密），以 `trace_id` 查任务并锁行，再校验对象 Key、媒体 ID 与 ETag。任何无法明确识别的事件都进入 error，不能通过。

## 6. 腾讯云视频设计

只保留 CI 视频审核能力。视频源对象验证稳定后，以媒体 ID、对象 Key、ETag、内部 `data_id` 提交画面和音轨审核。转码回调只更新 processing 状态；内容审核 Pass 或管理员批准才更新 moderation 状态。

配置只保留：

```text
CONTENT_MODERATION_TENCENT_VIDEO_ENABLED
TENCENT_CLOUD_SECRET_ID
TENCENT_CLOUD_SECRET_KEY
TENCENT_CLOUD_REGION
TENCENT_CI_VIDEO_POLICY_ID
TENCENT_CI_VIDEO_CALLBACK_URL
TENCENT_CI_VIDEO_CALLBACK_TOKEN
```

删除 TMS 策略和 CI 图片策略配置。腾讯云回调与微信事件使用独立路由和鉴权器，避免协议混用。

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

回滚只关闭新提交，保留门禁和已有任务处理；不得把 pending/review/error 批量改为 approved。

## 11. 测试设计

- 单元：结果映射、文本规范化、token 缓存/刷新、签名验证、状态机、重试分类。
- 仓储：幂等创建、租约互斥、管理员优先、过期版本、审计。
- 集成：文本四结果、图片提交与异步事件、视频提交与回调、读取门禁。
- 安全：伪造签名、超大请求、未知结构、重复/过期事件、签名 URL 泄漏。
- UI：后台队列与操作、小程序状态文案。
- 非生产联调：微信文本与图片、腾讯云视频分别验证 Pass/Review/Block/Error。

所有本地自动化使用假服务商客户端，不依赖公网或生产凭证。

## 12. 明确非目标

- 不启用 COS 图片自动审核或全桶自动冻结。
- 不使用腾讯云 TMS 或 CI 图片审核。
- 不在小程序客户端运行 FFmpeg 或持有服务端密钥。
- 不审核历史媒体。
- 不实现自动处罚、封号或完整申诉产品。
