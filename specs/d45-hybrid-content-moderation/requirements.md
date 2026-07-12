# D45 Requirements：微信文本/图片与腾讯云视频混合内容审核

更新日期：2026-07-12

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

### Requirement 2：历史兼容与新内容默认隐藏

1. 迁移前媒体 SHALL 回填为 `approved_legacy`。
2. 新图片和视频 SHALL 显式写 `moderation_status = pending`。
3. 技术处理状态与内容审核状态 SHALL 分离；视频转码 ready 不得使未审核视频可见。
4. D45 SHALL NOT 自动审核历史媒体。

### Requirement 3：微信鉴权与 access token

1. 微信 AppSecret SHALL 只存在服务端密钥配置中。
2. 系统 SHALL 缓存 `access_token`，在过期前刷新，并以单飞锁避免并发刷新风暴。
3. 微信返回 token 失效错误时 SHALL 仅强制刷新一次并重试原请求。
4. 日志、指标和响应 SHALL NOT 暴露 AppSecret、access token、完整私密文本或长期媒体 URL。
5. 生产开启微信审核但缺少 AppID/AppSecret 时 SHALL 启动失败。

### Requirement 4：微信文本审核

1. 昵称、评价、留言、置顶留言、私有门店/剧本和拼车说明 SHALL 在业务写入前调用 `msgSecCheck`。
2. 一次变更中的多个短字段 SHALL 带稳定字段标签合并送审。
3. 请求 SHALL 携带内容生产者 `openid`、正确 `scene` 和版本参数；没有可验证 openid 时 SHALL 保持隐藏或拒绝写入，不能跳过审核。
4. Pass SHALL 应用业务变更；Review SHALL 保存隐藏提案；Block SHALL 拒绝且不修改实体；Error SHALL 保存隐藏提案并重试。
5. 昵称提案批准时 SHALL 原子校验旧版本；基线变化 SHALL 标记 stale，不能覆盖新值。
6. 系统文本、手机号和管理员审核备注 SHALL NOT 送审。

### Requirement 5：微信异步图片审核

1. 图片上传完成后 SHALL 先存入私有 COS，并创建 `pending` 媒体和微信审核任务。
2. 系统 SHALL 为微信可下载图片生成短时、最小权限 URL，再调用 `mediaCheckAsync(media_type=2)`。
3. URL 有效期 SHALL 只覆盖微信抓取窗口，不得作为用户访问地址保存或返回。
4. 系统 SHALL 持久化微信 `trace_id`，通过微信小程序事件推送接收审核结果。
5. 事件接收 SHALL 验证微信服务器签名，严格限制请求体大小并匹配 trace_id、媒体 ID、对象 Key 与版本。
6. Pass SHALL 批准图片；Review SHALL 保持隐藏并进入人工队列；Block SHALL 保持隐藏并创建幂等清理任务；未知结构 SHALL 进入 error。
7. 重复、过期或管理员决定后的事件 SHALL 幂等成功且不得覆盖当前有效状态。

### Requirement 6：腾讯云视频审核

1. 视频源对象稳定后 SHALL 按媒体 ID 与 ETag 幂等提交腾讯云 CI 视频审核。
2. 腾讯云视频策略 SHALL 同时覆盖画面与音轨；仅转码成功不得发布。
3. 回调 SHALL 验证高强度令牌或腾讯云签名，并匹配任务 ID、`data_id`、对象 Key 和 ETag。
4. Pass、Review、Block、Error SHALL 映射到统一状态机。
5. Block SHALL 为源、展示和封面对象创建一次幂等清理任务。
6. D45 SHALL 删除腾讯云 TMS 文本和 CI 图片审核代码、配置与文档，保留且收窄腾讯云视频能力。

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
3. 回滚 SHALL 关闭新审核提交但保留读取门禁，不得批量批准 pending/review/error 内容。
4. 运维手册 SHALL 记录微信接口权限、事件推送、额度，腾讯云视频策略/CAM/费用，以及 COS 私有桶设置。

### Requirement 13：验证

1. SHALL 采用测试先行实现新增行为，并使用假微信/腾讯云客户端完成本地自动化测试。
2. SHALL 通过审核单测、迁移检查、图片/视频门禁测试、管理后台和小程序构建以及 `npm run check`。
3. 非生产环境 SHALL 分别完成微信文本 Pass/Review/Block、微信图片异步事件、腾讯云视频 Pass/Review/Block、超时、重复和过期回调联调。
4. 联调记录 SHALL NOT 保存违规样本正文或可复用媒体 URL。
