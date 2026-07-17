# D46 真实审核预演与正式发布能力隔离设计

日期：2026-07-17

## 背景与问题

D46 要求在正式开启微信文本、微信图片和腾讯 CI 视频审核前，先完成三类真实 provider 预演；预演必须使用固定无害样本、独立记录和不可伪造的回调关联，同时不能改变普通用户内容的发布策略。

当前正式能力快照由 `CONTENT_MODERATION_*_ENABLED` 控制。普通内容只有在对应开关开启时才进入自动审核，否则按 D46 的 DB 兜底设置继续旧直发或阻断。这个行为正确，必须保留。

问题出在生产预演运行时：`buildProductionPreflightRuntime()` 也把同一组正式 provider 开关作为预演就绪条件。结果是预演前必须先打开正式审核开关，与运行手册“预演通过后再启用 provider”矛盾。若直接照代码运行，预演窗口内新提交的普通用户内容会在回调和权限尚未验证时进入审核。

## 已确认约束

- 预演期间普通用户内容继续按当前 D46 逻辑发布，不因预演而进入审核。
- 正式 provider 开关保持关闭，直到对应真实预演通过并人工确认。
- 预演只允许代码内置无害样本和 active `system_admin` 操作人。
- 图片和视频异步回调必须命中独立 HMAC 关联；未命中的普通回调继续走原链路。
- 不增加新的后台页面、人工审核或动态 provider health。

## 方案选择

采用“预演就绪状态与正式能力快照分离”。

未采用的方案：

- 单独部署完整 staging：隔离最强，但需要新的小程序、域名、数据库和回调配置，本次已有受控生产预演机制，无需扩大基础设施范围。
- 短暂开启正式审核并维护：改动少，但会让正常流量进入尚未验证的审核链路，不满足已确认约束。

## 配置模型

保留现有正式能力字段及语义：

- `CONTENT_MODERATION_WECHAT_TEXT_ENABLED`
- `CONTENT_MODERATION_WECHAT_IMAGE_ENABLED`
- `CONTENT_MODERATION_TENCENT_VIDEO_ENABLED`

它们只决定普通业务内容的启动时能力快照，不再参与生产预演就绪判断。

生产预演继续由 `CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED` 显式控制。预演启用时，配置校验必须独立确认三类真实调用所需条件：

- 微信文本：AppID、AppSecret、共享 Redis、测试用户的有效 OpenID。
- 微信图片：微信文本条件、私有 COS、微信安全模式回调 Token 和 43 位 AES Key。
- 腾讯视频：私有 COS、Region、BizType、HTTPS 回调 URL、至少 32 位回调 Token。
- 共用：操作人、测试用户、确认值、reference HMAC、固定样本指纹、发布指纹。

预演可以在三个正式 provider 开关均为 `false` 时就绪。若上述真实调用条件缺失，预演关闭式失败，普通业务能力不受影响。

## 运行时与数据流

`buildProductionPreflightRuntime()` 生成两类互不混用的事实：

1. `preflightProviderReadiness`：只根据凭据、Redis、COS、策略和回调配置计算，用于当前预演 case 的 guard。
2. 正式能力快照：继续由现有 intake/capability 服务根据 provider enabled 开关计算，用于普通业务写入。

预演流程：

1. 校验 `NODE_ENV=production`、预演总开关、单次确认值和 active `system_admin`。
2. 按 case 校验 `preflightProviderReadiness`，不读取正式 provider enabled 开关。
3. 创建隔离的 preflight run，并在出站前再次刷新上述 guard。
4. 文本使用固定无害文本同步调用微信；图片和视频上传固定私有样本后异步调用 provider。
5. 图片以 trace ID、视频以 DataId/JobId 和 HMAC 关联回调；只允许匹配当前 run 的结果推进。
6. 最终只有 `pass` 且预演对象已删除才记录为 `passed`。

普通业务流程不调用 `preflightProviderReadiness`。正式开关关闭时，其行为保持当前 D46 默认兼容逻辑。

## 回调与暂停语义

- API 与预演超时 Worker 在预演窗口内使用 `CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED=true`，但三个正式 provider 开关保持 `false`。
- 回调处理器可在正式 provider 关闭时处理已关联的 active preflight run。
- 无有效 HMAC/关联的事件不得被预演处理器消费，继续进入普通回调判断或按现有规则拒绝。
- 关闭预演总开关后，既有异步 run 不再被批准；匹配回调只按现有关闭式失败和清理路径收口。
- 所有 run 终态且 `cleanup_status=deleted` 后，才可关闭超时 Worker 所需的预演密钥。

## 错误处理与安全边界

- 预演配置不完整时，在 provider 出站前失败，不创建普通审核任务或用户内容。
- 权限、额度、网络、回调认证、超时或清理失败均使预演失败，不自动开启正式 provider。
- 日志只记录脱敏错误码、case、provider、状态、耗时和配置指纹；不记录密钥、OpenID、对象 Key、完整回调或可复用 URL。
- 修改不放宽普通内容读取门禁，也不改变 D46 的 DB 兜底开关语义。

## 测试设计

先新增失败测试，再实施最小改动：

1. 三个正式 provider 开关均关闭、真实凭据完整时，三类预演 runtime 均判定就绪。
2. 同一配置下，普通 image/video/text 能力仍为 unavailable，并继续走 D46 默认直发或双开关阻断。
3. 每类预演缺少自身关键配置时关闭式失败；其他类型不被误判。
4. 正式开关关闭时，合法 HMAC 关联的图片/视频回调仍能完成预演。
5. 伪造、未知、过期或普通业务回调不能命中预演。
6. 现有 provider enabled=true 的正式自动审核测试保持通过。
7. 更新静态检查和运行手册，明确 API、预演 Job、超时 Worker 的配置窗口与正式开关隔离。

验证命令至少包括预演定向测试、D45/D46 检查、API 全量测试和根 `npm run check`。

## 发布顺序

1. 合并并部署修复后的 API 与 Worker，正式 provider 开关保持关闭。
2. 配置真实凭据、回调和预演密钥，开启预演总开关。
3. 在微信后台保存安全模式 JSON 回调并通过 GET 验证。
4. 依次运行微信文本、微信图片、腾讯视频预演；异步 case 等待 `passed` 且清理完成。
5. 逐类型开启正式 provider，并观察错误率、队列年龄和回调认证指标。
6. 全部稳定后关闭预演总开关；所有既有 run 终态并完成清理前保留 HMAC 和超时 Worker。

## 完成标准

- 正式 provider 开关关闭时，三类真实预演可以完成。
- 同一预演窗口内，普通用户内容仍保持 D46 当前发布逻辑。
- 三类真实 provider run 均为 `passed`，图片/视频 `cleanup_status=deleted`。
- 所有定向与全量检查通过，运行手册与实现无矛盾。
