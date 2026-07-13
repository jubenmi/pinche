# D45 混合内容审核生产发布与回滚手册

本手册适用于 D45 的新用户文本、相册图片和相册视频。发布原则是“先审后发”：数据库审核状态是唯一发布依据，只有 `approved` 和 `approved_legacy` 能生成普通用户媒体 URL。任何服务商、回调、网络或配置异常都必须让新内容继续隐藏，不能默认通过。

审核分工固定如下：

| 内容 | 服务商与能力 | 结果路径 |
| --- | --- | --- |
| 昵称、评价、留言、置顶留言、私有门店/剧本、拼车说明 | 微信 `msgSecCheck` | 同步结果 + 隐藏提案 |
| 相册图片 | 微信 `mediaCheckAsync`，`media_type=2` | 微信安全模式异步事件 |
| 相册视频画面与音轨 | 腾讯云 CI 视频审核 | CI Detail 回调 |
| COS 对象 | 仅私有存储和受控签名 URL | API 发布门禁 |

明确不启用腾讯云 TMS、腾讯云 CI 图片审核、COS 图片自动审核或全桶自动冻结。不得把微信 AppSecret、access token、审核原文、对象键或可复用签名 URL 写进工单、日志、指标或截图。

## 1. 上线前的共同前提

- API、`content-moderation-retry`、`content-moderation-orphan-scan` 和迁移任务必须使用同一个 `PINCHE_API_IMAGE` 镜像 digest；不得让不同 schema 版本的 Worker 混跑。
- 先备份数据库，执行迁移至 `0029_content_moderation_production_preflight.sql`，确认 `npm run migrate` 成功后再启动 API 与 Worker。
- 所有密钥只从生产密钥管理系统注入 `.env.production`；示例文件中的占位值不可用于生产。
- COS Bucket 必须保持私有。客户端不得拥有任意对象读权限；只有服务端在权限、隐私和审核门禁均通过后签发短时 URL。
- 上线与联调使用无害测试样本及测试账号；不要将违规样本正文、完整媒体、token 或可复用 URL 保存到记录中。

### 1.1 新内容接收门禁与开关语义

每个 D45 内容类型都有独立的接收模式：`CONTENT_MODERATION_TEXT_INTAKE_MODE`、`CONTENT_MODERATION_IMAGE_INTAKE_MODE`、`CONTENT_MODERATION_VIDEO_INTAKE_MODE`。

- `closed`：拒绝该类型的所有新提交，稳定返回 `503 CONTENT_MODERATION_INTAKE_CLOSED`；不会关闭读取门禁、回调、管理员队列或已有任务的 Worker。
- `moderated`：只有全局审核能力和该类型 provider 都已就绪时才接收；任何一个未就绪都会拒绝，而不会退化成未审核直写、上传或媒体关联。
- `legacy`：仅用于本地开发/兼容路径；生产配置拒绝该模式，不能用于生产上线或回滚。

审核 provider 开关不是流量开关。`CONTENT_MODERATION_ENABLED` 和各 `*_ENABLED` 只表达审核能力是否已配置；在接受 D45 用户写入的生产环境中，不得用它们暂停新提交。暂停或回滚只切换相应 `*_INTAKE_MODE=closed`，并保持已启用 provider、Worker 与回调继续处理已有任务。

## 2. 微信文本与图片审核

### 2.1 控制台、权限与额度

在微信小程序后台为当前小程序确认内容安全接口权限、调用主体资质、调用额度、事件推送能力和当前平台政策。`msgSecCheck` 与 `mediaCheckAsync` 是否可用、免费额度、频控和配额均以发布当天微信后台与官方文档为准。

“微信免费”仅表示当前平台允许的免费额度内可能不按次收费，**不是永久 SLA、容量承诺或成本保证**。上线后必须观察 `content_moderation_submissions_total`、`content_moderation_results_total`、`content_moderation_token_refresh_failures_total` 和高优先级额度告警；达到平台额度或出现权限错误时保持内容隐藏并进入人工处置。

上线前逐项确认：

1. `WECHAT_APP_ID`、`WECHAT_APP_SECRET` 与实际小程序一致，AppSecret 只在服务端密钥配置中存在。
2. 生产 Redis 可用，且所有 API/Worker 实例使用同一 Redis。共享 access token 模块负责缓存、提前刷新和分布式单飞；禁止自行新增第二套 token 缓存。
3. 文本审核使用生产者的已验证 `openid` 和正确的 scene；缺少 `openid` 必须返回 `CONTENT_MODERATION_OPENID_REQUIRED`，不得跳过审核。
4. 图片审核只提交单个私有对象的短时 GET URL；该 URL 仅供微信抓取，不写入数据库、日志或用户响应。
5. 微信回调配置为安全模式，回调地址为：

   ```text
   https://api.pinche.jubenmi.com/api/internal/content-moderation/wechat-image/callback
   ```

   配置 `WECHAT_CONTENT_SECURITY_EVENT_TOKEN` 和 43 位 `WECHAT_CONTENT_SECURITY_EVENT_AES_KEY`。路由会校验签名、时间戳、nonce、AES 解密、AppID 和事件结构。

6. 真实控制台若要求额外 GET URL 验证握手，必须先在非生产环境按该正式协议验证并补齐回归；未完成前不得开启生产图片审核。

建议配置基线：

```text
CONTENT_MODERATION_ENABLED=true
CONTENT_MODERATION_WECHAT_TEXT_ENABLED=false
CONTENT_MODERATION_TEXT_INTAKE_MODE=closed
CONTENT_MODERATION_WECHAT_IMAGE_ENABLED=false
CONTENT_MODERATION_IMAGE_INTAKE_MODE=closed
CONTENT_MODERATION_TENCENT_VIDEO_ENABLED=false
CONTENT_MODERATION_VIDEO_INTAKE_MODE=closed
CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED=false
REDIS_ENABLED=true
REDIS_URL=redis://...                 # 或有效 REDIS_HOST/REDIS_PORT
WECHAT_APP_ID=...
WECHAT_APP_SECRET=...
WECHAT_CONTENT_SECURITY_EVENT_TOKEN=...
WECHAT_CONTENT_SECURITY_EVENT_AES_KEY=...  # 精确 43 位
```

首次发布前保持三个接收模式为 `closed`。provider 开关可以在没有历史任务的初始阶段保持未启用；在某类型准备好后，先完成其凭证、权限和非生产验证，再启用 provider 并把该类型接收模式改为 `moderated`。不要一次性全开。

### 2.2 微信故障处置

- `WECHAT_CONTENT_SECURITY_TOKEN_*`：检查 Redis、AppID/AppSecret、时钟和微信后台权限；共享模块只会强制刷新并重试一次。
- `WECHAT_CONTENT_SECURITY_PERMISSION_DENIED` 或 `WECHAT_CONTENT_SECURITY_QUOTA_EXHAUSTED`：立即把对应的文本或图片接收模式改为 `closed`，保留读取门禁与已有任务；保持 provider、Worker 和回调可用，核对后台权限/额度后再恢复为 `moderated`。
- 回调鉴权或结构失败：检查安全模式 token、AES key、AppID、反向代理是否改写 query/body；不要在日志中打印密文、签名或原始 body。
- 文本 `review`/`error` 和图片 `review`/`error` 均必须保持隐藏，交给管理员队列或重试 Worker，不能人工改数据库为 `approved` 绕过流程。

## 3. 腾讯云 CI 视频审核

腾讯云只承担视频审核。当前实现只接受稳定的 `uploads/session-album/videos/source/*.mp4` 源对象，使用视频画面和音轨审核、Average 截帧、Detail 回调；转码 ready 本身不能发布内容。

### 3.1 策略、回调和 CAM

在腾讯云数据万象控制台创建或核对视频审核策略，并将策略 ID 写入 `TENCENT_CI_VIDEO_BIZ_TYPE`。策略、地区、Bucket 和回调 URL 必须匹配同一生产环境。腾讯云的视频审核能力与费用以其[官方视频审核文档](https://cloud.tencent.com/document/product/460/47488)和[设置视频审核说明](https://cloud.tencent.com/document/product/460/46494)为准；不要把试用资源包、历史报价或测试账号余额当作长期成本承诺。

```text
CONTENT_MODERATION_TENCENT_VIDEO_ENABLED=false
CONTENT_MODERATION_VIDEO_INTAKE_MODE=closed
TENCENT_CI_VIDEO_REGION=ap-nanjing
TENCENT_CI_VIDEO_BIZ_TYPE=...
TENCENT_CI_VIDEO_CALLBACK_URL=https://api.pinche.jubenmi.com/api/internal/content-moderation/tencent-video/callback
TENCENT_CI_VIDEO_CALLBACK_TOKEN=<至少 32 位随机值>
TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN=
```

回调 token 轮换时：先把新 token 写入当前变量、把旧 token 放入 `TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN`，部署并确认旧任务回调耗尽后再清空 previous token。网关、负载均衡和应用访问日志都必须脱敏 `token` 查询参数。

为 API/Worker 使用独立 CAM 身份并按最小权限授权到对应 Bucket、Region、前缀和 CI 视频审核操作。必须在发布前用该身份实际验证：提交视频审核、读取必要对象元数据、接收回调和处理已拒绝视频的清理任务。对孤儿扫描，先只授予 List/Head 所需权限；只有经过变更审批才增加受限前缀的删除权限。腾讯云删除对象要求 `cos:DeleteObject`，具体 CAM action 与资源写法以[腾讯云 COS 文档](https://cloud.tencent.com/document/product/436/65939)和当日 CAM 操作列表为准。

### 3.2 费用、额度与欠费告警

必须为账户余额、欠费、CI 用量、并发/限流和 CAM 拒绝配置腾讯云侧告警，并将应用侧下列高优先级事件接入值班渠道：

- `tencent_video_cam`：`AuthFailure`、`UnauthorizedOperation`；
- `tencent_video_policy`：`InvalidParameter.BizType`；
- `tencent_video_quota`：`LimitExceeded`、`ResourceUnavailable`、`TENCENT_CI_VIDEO_RATE_LIMITED`/`RequestLimitExceeded`；
- `tencent_video_billing`：`FailedOperation.BalanceNotEnough`；
- `retry_exhausted`：达到应用重试上限。

这些故障必须让视频维持 `error`/隐藏状态。先修复权限、策略、余额或额度，再由管理员重试；不得因回调延迟、转码成功或人工“看起来正常”直接发布。

## 4. COS 私有存储、签名 URL 与孤儿扫描

### 4.1 Bucket 与上传权限

- Bucket 保持私有读写，禁止公共读、公共写和面向客户端的任意对象列举权限。
- 上传凭证仅允许所属会话的预期 Key 前缀、方法、大小和有效期；图片只允许 JPEG/PNG 且不超过 4 MB。
- 用户读取 URL 必须短时、最小权限，并且只能在 API 完成成员/公开分享隐私校验和审核发布门禁后生成。
- 管理员预览 URL 同样短时且 `no-store`；不可将对象 key、原始 URL 或签名 URL 返回给普通用户。

### 4.2 孤儿扫描与清理

`content-moderation-orphan-scan` 只扫描 `uploads/session-album/`，比较 COS 对象、媒体记录、审核任务、上传意图和未完成清理任务。默认只报告，不删除：

```text
CONTENT_MODERATION_ORPHAN_SCAN_ENABLED=false
CONTENT_MODERATION_ORPHAN_CLEANUP_ENABLED=false
CONTENT_MODERATION_ORPHAN_SCAN_POLL_MS=300000
CONTENT_MODERATION_ORPHAN_SCAN_BATCH_SIZE=100
CONTENT_MODERATION_ORPHAN_RETENTION_HOURS=48
```

启用顺序必须是：

1. 先设置 `CONTENT_MODERATION_ORPHAN_SCAN_ENABLED=true`、`CONTENT_MODERATION_ORPHAN_CLEANUP_ENABLED=false`，至少观察一个保留周期和告警结果。
2. 处理误报、历史 `photo_url` 回填、未完成上传和正常清理任务后，提交独立变更审批，确认 CAM 删除权限仅限该前缀。
3. 只有审批后才设置 `CONTENT_MODERATION_ORPHAN_CLEANUP_ENABLED=true`；保留期不得低于 24 小时，建议保持 48 小时。
4. 清理前实现会再次查询引用，并在每个 COS/数据库边界续租；失去租约即停止且不回报成功。删除失败、告警或数量异常时先关闭 cleanup 开关，保留 scan/report。

不得用孤儿扫描替代被拒绝媒体的既有清理队列，也不得用它扫描或删除 Bucket 的其他前缀。

## 5. Worker、指标与值班告警

启动 API 后必须同时运行：

```bash
npm --workspace apps/api run job:content-moderation-retry
npm --workspace apps/api run job:content-moderation-orphan-scan
```

`content-moderation-retry` 使用 90 秒以上的任务租约与有限指数退避；保持：

```text
CONTENT_MODERATION_RETRY_LIMIT=8
CONTENT_MODERATION_RETRY_POLL_MS=30000
CONTENT_MODERATION_RETRY_BATCH_SIZE=25
CONTENT_MODERATION_RETRY_LEASE_MS=90000
CONTENT_MODERATION_QUEUE_ALERT_AGE_SECONDS=900
```

按 `provider`、`subjectType`、`outcome` 聚合下列低基数指标；禁止把用户 ID、openid、媒体 ID、对象 key、完整文本、密钥、token 或签名 URL作为标签：

- `content_moderation_jobs_total`、`content_moderation_submissions_total`；
- `content_moderation_latency_ms`（直方图）、`content_moderation_results_total`；
- `content_moderation_retries_total`、`content_moderation_access_denied_total`；
- `content_moderation_queue_depth`、`content_moderation_queue_oldest_age_seconds`；
- `content_moderation_callback_failures_total`、`content_moderation_token_refresh_failures_total`；
- `content_moderation_orphans_total`、`content_moderation_orphans_cleaned_total`、`content_moderation_operational_alerts_total`。

值班必须为以下条件建立高优先级告警：微信 token/权限/额度、腾讯视频 CAM/策略/额度/欠费、`retry_exhausted`、队列最老年龄超过 `CONTENT_MODERATION_QUEUE_ALERT_AGE_SECONDS`、回调认证失败突然升高、孤儿对象异常增长、扫描失租或失败。

## 6. 分阶段发布与观察窗口

每一步必须记录部署版本、开关、观察开始/结束时间、指标摘要和回滚决定；记录不得包含敏感样本或 URL。

1. **数据结构与门禁**：执行迁移，部署 API、后台、两个 Worker；保持 `CONTENT_MODERATION_ENABLED=true`，并将三个 `*_INTAKE_MODE` 都设为 `closed`。验证新提交返回 `CONTENT_MODERATION_INTAKE_CLOSED`，且未批准媒体仍无法通过列表、预览、下载、range、封面或公开分享读取。
2. **后台、指标与扫描**：确认管理员队列、审计、上述指标和告警可见。先开启孤儿扫描的 report-only，保持 cleanup 为 `false`。
3. **生产受控预演（D45.18A）**：只在三个 `*_INTAKE_MODE` 均为 `closed` 时运行一次性预演 Job。该步骤只验证 harmless pass、鉴权、私有 COS 读取、回调、标准化结果和清理，不表示可以把任何正常用户入口切到 `moderated`。
4. **微信文本**：D45.18A 与 D45.18B 均完成并人工复核后，才可设置 `CONTENT_MODERATION_WECHAT_TEXT_ENABLED=true` 并另行讨论 `CONTENT_MODERATION_TEXT_INTAKE_MODE=moderated`；观察至少一个业务高峰窗口。
5. **微信图片**：D45.18A 与 D45.18B 均完成并人工复核后，才可设置 `CONTENT_MODERATION_WECHAT_IMAGE_ENABLED=true` 并另行讨论 `CONTENT_MODERATION_IMAGE_INTAKE_MODE=moderated`。
6. **腾讯视频**：D45.18A 与 D45.18B 均完成并人工复核后，才可设置 `CONTENT_MODERATION_TENCENT_VIDEO_ENABLED=true` 并另行讨论 `CONTENT_MODERATION_VIDEO_INTAKE_MODE=moderated`。

每个阶段只在前一阶段的错误率、队列年龄、回调认证失败和人工队列容量满足预设阈值后继续；任何不确定状态均停止推进而不是放宽门禁。

## 7. 回滚与事件处置

- 单一服务商异常：把对应的 `CONTENT_MODERATION_TEXT_INTAKE_MODE`、`CONTENT_MODERATION_IMAGE_INTAKE_MODE` 或 `CONTENT_MODERATION_VIDEO_INTAKE_MODE` 设为 `closed`，保留私有 COS、读取门禁、现有任务、管理员队列和审计。不要用 provider 开关代替该动作；只要存在已有任务，就保持相应 provider、Worker 和回调运行。
- 全局提交异常：把三个 `*_INTAKE_MODE` 全部设为 `closed`，仍不得把 `pending`/`processing`/`review`/`error` 批量改成 `approved`；先评估已有隐藏内容并修复服务商配置。不得在接受用户写入的环境中关闭 `CONTENT_MODERATION_ENABLED` 作为回滚手段。
- 重试 Worker 异常：优先修复后恢复 Worker，让租约和重试状态自行接管；不要手工清空任务或伪造 provider attempt。
- 回调异常：保留事件入口和门禁，修复 token/AES key/反向代理/CAM 配置后用无害样本重试；不要关闭签名校验以换取可用性。
- 孤儿清理异常：立即把 `CONTENT_MODERATION_ORPHAN_CLEANUP_ENABLED=false`，保留 report-only 扫描，核对引用、历史回填和 CAM 范围。
- 数据库迁移或门禁异常：停止下一阶段发布，保留迁移结果和受限读取；不要回滚审核状态来恢复流量。

## 8. 生产受控预演（D45.18A）

此步骤只使用代码白名单无害样本和专用测试管理员身份。它不接收调用方正文、openid、对象 Key、URL、回调地址或 provider 参数，不写普通审核任务、提案、相册媒体、普通重试队列、通知或用户 URL。

前置条件：

- `CONTENT_MODERATION_TEXT_INTAKE_MODE=closed`
- `CONTENT_MODERATION_IMAGE_INTAKE_MODE=closed`
- `CONTENT_MODERATION_VIDEO_INTAKE_MODE=closed`
- `CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED=true`
- 操作人是仍然 active 的 `system_admin`
- `D45_PREFLIGHT_CONFIRMATION` 由当次人工确认提供，不写入仓库、日志或截图

手动执行：

```bash
docker compose run --rm --no-deps api npm run job:content-moderation-production-preflight -- --case=wechat-text-v1
docker compose run --rm --no-deps api npm run job:content-moderation-production-preflight -- --case=wechat-image-v1
docker compose run --rm --no-deps api npm run job:content-moderation-production-preflight -- --case=tencent-video-v1
```

成功只代表固定 harmless 样本的生产链路可用。失败时保持三个入口 `closed`，查看脱敏 preflight run 状态，先处理清理失败、鉴权失败或回调失败，再重试。不要上传危险样本做真实生产验证。

记录仅保存 case、服务商、结果类别、耗时、配置/镜像指纹和清理结论；不保存完整敏感文本、违规媒体、原始 trace/job/DataId、对象 key、callback body、token 或可复用 URL。
