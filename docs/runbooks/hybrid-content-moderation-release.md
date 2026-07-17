# D45 混合内容审核生产发布与回滚手册

## D46 作者私有可见性

D46 gate 与 D45 intake 完全独立。D46 只决定待审内容能否对创建者本人形成私有投影或短时媒体预览，不改变 `CONTENT_MODERATION_*_INTAKE_MODE`、provider、回调、Worker 或公共发布门禁。部署 D46 代码时必须保持以下配置：

```dotenv
CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ENABLED=false
CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ACTIONS=
CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED=false
CONTENT_MODERATION_AUTHOR_PRIVATE_VIDEO_ENABLED=false
CONTENT_MODERATION_AUTHOR_PREVIEW_TTL_SECONDS=60
```

文本 action 仅允许批准 spec 中的十个固定 action 的显式子集；空集保持关闭。作者预览 TTL 只允许 `1..60` 秒。未知、重复 action 或非法 TTL 必须让 API/Worker 启动失败，错误中不得打印原配置值。

### D46 观察与容量边界

重试 Worker 只统计 `author_visibility_version=1`、`active`、`rejected` 的图片/视频对象数量、图片/视频字节数和超过 30 天的长期保留数量。达到阈值只发高优先级告警，不触发删除。系统不得根据容量告警自动删除用户内容。

普通 reject 只阻止公开，不删除 D46 媒体。紧急 purge 是独立合规操作，只允许 `system_admin`，必须填写原因并输入字面量 `PURGE` 二次确认；它复用作者删除的耐久 cleanup，并保留审计。purge 不得作为普通审核默认动作。

### D46 回滚顺序

1. 先关闭 `CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ENABLED`、`CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED`、`CONTENT_MODERATION_AUTHOR_PRIVATE_VIDEO_ENABLED`，并清空文本 action 子集，停止新的 D46 写入和作者 URL 签发。
2. 保持 D45 intake 原状态，继续运行 provider、审核回调、重试 Worker、公共发布门禁和 cleanup Worker。
3. 已保留的拒绝媒体继续保持私有；不得批量批准、恢复公开、改成孤儿或自动清理。
4. 如确认单个对象必须紧急移除，只走上述管理员 purge，不放宽公共门禁。

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

- API、`content-moderation-retry`、`content-moderation-orphan-scan`、`content-moderation-production-preflight-timeout` 和迁移任务必须使用同一个 `PINCHE_API_IMAGE` 镜像 digest；不得让不同 schema 版本的 Worker 混跑。
- 先备份数据库，执行迁移至 `0030_author_private_content_visibility.sql`，确认 `npm run migrate` 成功后再启动 API 与 Worker。
- 所有密钥只从生产密钥管理系统注入 `.env.production`；示例文件中的占位值不可用于生产。
- COS Bucket 必须保持私有。客户端不得拥有任意对象读权限；只有服务端在权限、隐私和审核门禁均通过后签发短时 URL。
- 上线与联调使用无害测试样本及测试账号；不要将违规样本正文、完整媒体、token 或可复用 URL 保存到记录中。

### 1.1 新内容接收门禁与开关语义

D46 的新内容策略只由两类状态共同决定：进程启动时的审核配置能力快照，以及后台“内容安全”页面持久化的四个 DB 开关。能力快照由全局开关和对应 provider enabled 配置决定；生产预演是发布前对凭证、权限、回调和网络链路的确认，不是逐请求动态健康检查。快照为可用时始终进入自动审核；快照为不可用时，只有“全局不可用时阻断”和对应内容类型开关同时开启才拒绝提交并返回 `503 CONTENT_MODERATION_INTAKE_CLOSED`，否则按 `approved_legacy` 兼容直发。后台保存与最终业务写共享设置行锁，避免策略切换与发布竞态。

`CONTENT_MODERATION_TEXT_INTAKE_MODE`、`CONTENT_MODERATION_IMAGE_INTAKE_MODE`、`CONTENT_MODERATION_VIDEO_INTAKE_MODE` 仅为旧配置兼容字段，D46 不再把 `closed`、`moderated` 或 `legacy` 当作发布或隔离开关。provider enabled 配置也不是维护开关，变更后必须重启/滚动发布才形成新的能力快照。任务创建后发生的权限、额度、网络或 provider 错误不会动态翻转能力，必须保持内容隐藏并按既有任务重试/人工处置。若真实事故需要让后续新提交进入 unavailable fallback，能力必须先通过关闭对应 provider enabled 配置并重启/滚动发布变为 unavailable；之后 DB 双开关才决定直发或阻断（需要阻断时可在发布前预置双开关）。若必须立即停止某类或全部正常流量，应使用经审批的网关/部署维护机制。不得只开 DB 开关却继续保持 provider enabled 并期待动态阻断。

## 2. 微信文本与图片审核

### 2.1 控制台、权限与额度

在微信小程序后台为当前小程序确认内容安全接口权限、调用主体资质、调用额度、事件推送能力和当前平台政策。`msgSecCheck` 与 `mediaCheckAsync` 是否可用、免费额度、频控和配额均以发布当天微信后台与官方文档为准。

“微信免费”仅表示当前平台允许的免费额度内可能不按次收费，**不是永久 SLA、容量承诺或成本保证**。上线后必须观察 `content_moderation_submissions_total`、`content_moderation_results_total`、`content_moderation_token_refresh_failures_total` 和高优先级额度告警；达到平台额度或出现权限错误时保持内容隐藏并进入人工处置。

上线前逐项确认：

1. `WECHAT_APP_ID`、`WECHAT_APP_SECRET` 与实际小程序一致，AppSecret 只在服务端密钥配置中存在。
2. 生产 Redis 可用，且所有 API/Worker 实例使用同一 Redis。共享 access token 模块负责缓存、提前刷新和分布式单飞；禁止自行新增第二套 token 缓存。
3. 文本审核使用生产者的已验证 `openid` 和正确的 scene；缺少 `openid` 必须返回 `CONTENT_MODERATION_OPENID_REQUIRED`，不得跳过审核。
4. 图片审核只提交单个私有对象的短时 GET URL；该 URL 仅供微信抓取，不写入数据库、日志或用户响应。
5. 微信上线配置前，先部署包含[微信官方 GET URL 验证](https://developers.weixin.qq.com/miniprogram/dev/framework/server-ability/message-push.html)的 API 镜像；微信保存时会立即向同一路由发起验证。**安全模式**与 **JSON 数据格式**约束保存后的 POST 事件，GET 保存验证始终使用微信规定的明文 `echostr` 协议。回调地址为：

   ```text
   https://api.pinche.jubenmi.com/api/internal/content-moderation/wechat-image/callback
   ```

   Token 必须是 3–32 位英文或数字；EncodingAESKey 使用后台“随机生成”的 43 位值。二者均只保存到批准的密钥管理处，先写入 `WECHAT_CONTENT_SECURITY_EVENT_TOKEN` 和 `WECHAT_CONTENT_SECURITY_EVENT_AES_KEY`，再在微信后台填写同一组值。GET 验证只读取 `signature`、timestamp、nonce 和明文 `echostr`，以 Token、timestamp、nonce 的三参数 SHA-1 结果校验 `signature`，通过后原样回显 `echostr`；GET 不使用 EncodingAESKey、AppID、`msg_signature` 或 body。安全模式 POST 事件才校验 `msg_signature`、时间戳、nonce、加密 body、AES 解密、AppID 和 JSON 事件结构。

6. 保存失败时不得切换为明文或 XML 规避问题；先核对 API 镜像版本、443 HTTPS 与路由是否可达、Token 是否完全一致，以及反向代理是否保留 GET 的 `signature`、timestamp、nonce 和 `echostr`。AESKey 与 AppID 只排查保存后的安全模式 POST，不应作为 GET 保存验证条件。只查看不含 Token、签名、`echostr` 或密钥的脱敏日志；未完成前不得开启生产图片审核。

建议配置基线：

```text
CONTENT_MODERATION_ENABLED=true
CONTENT_MODERATION_WECHAT_TEXT_ENABLED=false
CONTENT_MODERATION_TEXT_INTAKE_MODE=legacy  # 兼容字段，不控制 D46 流量
CONTENT_MODERATION_WECHAT_IMAGE_ENABLED=false
CONTENT_MODERATION_IMAGE_INTAKE_MODE=legacy # 兼容字段，不控制 D46 流量
CONTENT_MODERATION_TENCENT_VIDEO_ENABLED=false
CONTENT_MODERATION_VIDEO_INTAKE_MODE=legacy # 兼容字段，不控制 D46 流量
CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED=false
CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CALLBACK_TIMEOUT_MS=900000
CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TIMEOUT_POLL_MS=60000
CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TIMEOUT_BATCH_SIZE=10
REDIS_ENABLED=true
REDIS_URL=redis://...                 # 或有效 REDIS_HOST/REDIS_PORT
WECHAT_APP_ID=...
WECHAT_APP_SECRET=...
WECHAT_CONTENT_SECURITY_EVENT_TOKEN=...
WECHAT_CONTENT_SECURITY_EVENT_AES_KEY=...  # 精确 43 位
```

provider 开关可以在没有历史任务的初始阶段保持未启用；此时默认 DB 开关为关闭，内容按 `approved_legacy` 兼容直发。某类型完成凭证、权限和非生产验证后再启用 provider，启用后该类型自动进入审核。若发布期间不允许能力缺失时直发，先在后台开启全局与对应类型的不可用阻断开关。不要一次性全开。

### 2.2 微信故障处置

- `WECHAT_CONTENT_SECURITY_TOKEN_*`：检查 Redis、AppID/AppSecret、时钟和微信后台权限；共享模块只会强制刷新并重试一次。
- `WECHAT_CONTENT_SECURITY_PERMISSION_DENIED` 或 `WECHAT_CONTENT_SECURITY_QUOTA_EXHAUSTED`：已经创建的任务保持隐藏并由重试/人工队列处置，不能走 fallback。若后续新提交需要进入 unavailable fallback，关闭对应微信 provider enabled 配置并重启/滚动发布，使能力快照先变为 unavailable；DB 双开关随后决定直发或阻断，所需阻断值可在发布前预置。仅修改 DB 开关而保持 provider enabled 不会生效。恢复前重新完成生产预演并按审批重新启用 provider。
- GET 保存验证失败：检查 Token、API 版本、HTTPS/路由，以及反向代理是否改写 `signature`、timestamp、nonce 或 `echostr`；GET 不应读取 `msg_signature`、AESKey、AppID 或 body。
- 安全模式 POST 回调鉴权或结构失败：检查 Token、AESKey、AppID、反向代理是否改写 query/body；不要在日志中打印密文、签名、`echostr` 或原始 body。
- 文本 `review`/`error` 和图片 `review`/`error` 均必须保持隐藏，交给管理员队列或重试 Worker，不能人工改数据库为 `approved` 绕过流程。

## 3. 腾讯云 CI 视频审核

腾讯云只承担视频审核。当前实现只接受稳定的 `uploads/session-album/videos/source/*.mp4` 源对象，使用视频画面和音轨审核、Average 截帧、Detail 回调；转码 ready 本身不能发布内容。

### 3.1 策略、回调和 CAM

在腾讯云数据万象控制台创建或核对视频审核策略，并将策略 ID 写入 `TENCENT_CI_VIDEO_BIZ_TYPE`。策略、地区、Bucket 和回调 URL 必须匹配同一生产环境。腾讯云的视频审核能力与费用以其[官方视频审核文档](https://cloud.tencent.com/document/product/460/47488)和[设置视频审核说明](https://cloud.tencent.com/document/product/460/46494)为准；不要把试用资源包、历史报价或测试账号余额当作长期成本承诺。

```text
CONTENT_MODERATION_TENCENT_VIDEO_ENABLED=false
CONTENT_MODERATION_VIDEO_INTAKE_MODE=legacy # 兼容字段，不控制 D46 流量
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

这些故障必须让已创建的视频任务维持 `error`/隐藏状态。先修复权限、策略、余额或额度，再由管理员重试；不得因回调延迟、转码成功或人工“看起来正常”直接发布。若后续新视频需要进入 unavailable fallback，关闭 `CONTENT_MODERATION_TENCENT_VIDEO_ENABLED` 并重启/滚动发布，使能力快照先变为 unavailable；DB 双开关随后决定直发或阻断，所需阻断值可在发布前预置。不能把运行中 provider 调用失败伪装成动态 capability health。

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

1. **数据结构与门禁**：执行迁移，部署 API、后台、三个 Worker；确认内容安全 DB 开关默认关闭。未启用审核能力时，普通流量按 DB 开关降级：默认以 `approved_legacy` 兼容发布，仅当全局与对应类型阻断开关同时开启时返回 `CONTENT_MODERATION_INTAKE_CLOSED`。验证未批准媒体仍无法通过公开列表、下载、range、封面或分享读取；D46 作者私有内容仅允许作者通过受控预览读取。
2. **后台、指标与扫描**：确认管理员队列、审计、上述指标和告警可见。先开启孤儿扫描的 report-only，保持 cleanup 为 `false`。
3. **生产受控预演（D45.18A）**：部署常驻 API 与预演超时 Worker 时设置 `CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED=true`，再运行一次性预演 Job；三个正式 provider 开关必须全程保持 `false`。预演使用隔离的预演表、对象前缀和回调关联，不依赖 `*_INTAKE_MODE`，也不会改变普通流量的 D46 直发/阻断决策。该步骤只验证 harmless pass、鉴权、私有 COS 读取、回调、标准化结果和清理。
4. **微信文本**：D45.18A 与 D45.18B 均完成并人工复核后，才可设置 `CONTENT_MODERATION_WECHAT_TEXT_ENABLED=true`；启用后自动进入审核，观察至少一个业务高峰窗口。
5. **微信图片**：D45.18A 与 D45.18B 均完成并人工复核后，才可设置 `CONTENT_MODERATION_WECHAT_IMAGE_ENABLED=true`；启用后自动进入审核。
6. **腾讯视频**：D45.18A 与 D45.18B 均完成并人工复核后，才可设置 `CONTENT_MODERATION_TENCENT_VIDEO_ENABLED=true`；启用后自动进入审核。

每个阶段只在前一阶段的错误率、队列年龄、回调认证失败和人工队列容量满足预设阈值后继续；任何不确定状态均停止推进而不是放宽门禁。

## 7. 回滚与事件处置

- 单一服务商异常：已有任务保持隐藏、重试和审计。若后续新提交需要进入 unavailable fallback，关闭对应 provider enabled 配置并重启/滚动发布，使能力快照先变为 unavailable；DB 双开关随后决定直发或阻断，所需阻断值可在发布前预置。此时暂停的 provider 任务要等配置恢复后继续处理。若不能等待配置发布，使用平台级维护。仅打开 DB 开关并保持 provider enabled 不会动态阻断。
- 全局提交异常：已有任务仍保持隐藏。若要让全部后续提交进入 unavailable fallback，关闭对应 provider enabled 配置并重启/滚动发布，使能力快照先变为 unavailable；全局与三个类型 DB 开关随后决定直发或阻断，所需阻断值可在发布前预置。若必须立即停止流量，使用经审批的网关/部署维护机制。不得把 `pending`/`processing`/`review`/`error` 批量改成 `approved`，也不得依赖旧 `*_INTAKE_MODE`。
- 重试 Worker 异常：优先修复后恢复 Worker，让租约和重试状态自行接管；不要手工清空任务或伪造 provider attempt。
- 回调异常：保留事件入口和门禁，修复 token/AES key/反向代理/CAM 配置后用无害样本重试；不要关闭签名校验以换取可用性。
- 孤儿清理异常：立即把 `CONTENT_MODERATION_ORPHAN_CLEANUP_ENABLED=false`，保留 report-only 扫描，核对引用、历史回填和 CAM 范围。
- 数据库迁移或门禁异常：停止下一阶段发布，保留迁移结果和受限读取；不要回滚审核状态来恢复流量。

## 8. 生产受控预演（D45.18A）

此步骤只使用代码白名单无害样本和专用测试管理员身份。它不接收调用方正文、openid、对象 Key、URL、回调地址或 provider 参数，不写普通审核任务、提案、相册媒体、普通重试队列、通知或用户 URL。

预演使用独立的数据表、私有对象前缀与 HMAC 回调关联，不写普通业务内容，因此不读取或要求任何 `*_INTAKE_MODE`。它也不会暂停、隔离或证明正常用户流量已停止；如变更流程要求维护窗口，必须另行启用经审批的网关/部署维护机制。

前置条件：

- `CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED=true`
- 常驻 API、一次性预演 Job 和预演超时 Worker 使用同一组预演配置；图片/视频等待异步回调期间，常驻 API 必须保持预演开关开启
- `CONTENT_MODERATION_WECHAT_TEXT_ENABLED=false`
- `CONTENT_MODERATION_WECHAT_IMAGE_ENABLED=false`
- `CONTENT_MODERATION_TENCENT_VIDEO_ENABLED=false`
- 操作人是仍然 active 的 `system_admin`
- `D45_PREFLIGHT_CONFIRMATION` 由当次人工确认提供，不写入仓库、日志或截图

预演开关启用后会独立校验 Redis、微信凭据、私有 COS、微信安全回调和腾讯 CI 视频策略/回调配置，但不把普通业务能力标记为 available。三个 case 均为 `passed`、图片和视频对象均确认删除并完成人工复核前，不得开启任何正式 provider 开关；完成后也必须按文本、图片、视频顺序逐项启用并分别观察。

手动执行：

```bash
PINCHE_API_IMAGE="<当前 API 已验证的不可变镜像引用（repo@sha256:...）>" \
  D45_PREFLIGHT_CONFIRMATION="<当次人工确认值>" \
  docker compose run --pull never --rm --no-deps \
  -e CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED=true \
  -e D45_PREFLIGHT_CONFIRMATION \
  api \
  npm run job:content-moderation-production-preflight -- --case=wechat-text-v1

PINCHE_API_IMAGE="<当前 API 已验证的不可变镜像引用（repo@sha256:...）>" \
  D45_PREFLIGHT_CONFIRMATION="<当次人工确认值>" \
  docker compose run --pull never --rm --no-deps \
  -e CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED=true \
  -e D45_PREFLIGHT_CONFIRMATION \
  api \
  npm run job:content-moderation-production-preflight -- --case=wechat-image-v1

PINCHE_API_IMAGE="<当前 API 已验证的不可变镜像引用（repo@sha256:...）>" \
  D45_PREFLIGHT_CONFIRMATION="<当次人工确认值>" \
  docker compose run --pull never --rm --no-deps \
  -e CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED=true \
  -e D45_PREFLIGHT_CONFIRMATION \
  api \
  npm run job:content-moderation-production-preflight -- --case=tencent-video-v1
```

`PINCHE_API_IMAGE` 必须替换为当前 API 已核验的 **同一不可变 digest**，不得使用 `latest`。`--pull never` 使本机未缓存该 digest 时关闭式失败，而不是拉取新镜像。`-e D45_PREFLIGHT_CONFIRMATION` 显式把仅本次有效的宿主机变量传入一次性容器；不得将该值写入 `.env.production`、Compose 文件、日志或截图。一次性容器上的 `-e CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED=true` 只负责允许本次提交；等待图片/视频异步结果时，常驻 API 也必须用同一预演开关、HMAC 和回调配置完成认证与收口。普通用户流量仍由三个保持为 `false` 的正式 provider 开关和 D46 DB 兜底设置决定，不会因预演开关而进入审核。

文本预演是同步结果，成功时应记录为 `passed`。图片与视频预演是异步结果：一次性 Job 提交成功后可能先返回 `awaiting_callback`，此时必须继续等待微信安全事件或腾讯云 CI Detail 回调命中预演 HMAC。只有对应 preflight run 最终变为 `passed`，且 `cleanup_status=deleted`，才算该 case 完成。若回调返回 `review`、`block`、`error`、超时或清理失败，均视为预演失败；查看脱敏 preflight run 状态，先处理清理失败、鉴权失败或回调失败，再重试。是否暂停正常流量由独立变更决定，不得依赖旧 intake mode。不要上传危险样本做真实生产验证。

`content-moderation-production-preflight-timeout` 是与普通重试队列隔离的常驻 Worker。它默认每分钟检查一次已超过 15 分钟的 `started`、`submitting` 或 `awaiting_callback` 预演；文本只写失败并释放锁，图片/视频删除并核验对应私有对象后再原子写失败和释放 provider 锁。可通过上述三个有界配置调整超时、轮询和批量；该 Worker 即使预演功能当前关闭也应保持运行，以便清理之前遗留的预演对象。清理失败同样记录 `cleanup_failed` 并发出高优先级告警，不得开启任何 intake。

若需暂停或回滚预演，先将 `CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED=false`，但在所有既有 run 终态且对象清理完成前保留 `REFERENCE_HMAC_KEY`、两个认证回调路由和该超时 Worker。回调命中旧预演关联后仍会按关闭后的 guard 将其失败收口并清理；未命中的普通用户回调继续走原链，不因旧预演而被延迟。正常完成时同样必须等全部既有 run 终态、图片/视频 `cleanup_status=deleted` 后，才可移除 HMAC/回调清理配置或停止相应 Worker。

记录仅保存 case、服务商、结果类别、耗时、配置/镜像指纹和清理结论；不保存完整敏感文本、违规媒体、原始 trace/job/DataId、对象 key、callback body、token 或可复用 URL。
