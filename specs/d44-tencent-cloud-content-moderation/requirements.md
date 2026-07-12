# D44 Requirements：腾讯云内容安全审核

更新日期：2026-07-12

## Introduction

D44 为上线后新增的用户图片、视频和指定用户文本增加腾讯云内容安全审核。系统采用“业务状态机控制发布 + COS 自动审核冻结兜底”的混合方案：内容只有在腾讯云机审通过或管理员人工批准后才能公开；审核超时、欠费、权限错误或服务异常时保持隐藏并重试。

D44 只审核功能切换后的新内容。切换前的相册媒体标记为 `approved_legacy` 并继续可用，不执行历史扫描。本期不增加自动封号和产品化申诉流程。

## Requirements

### Requirement 1：统一审核状态和任务记录

**User Story：** 作为平台运营者，我希望所有内容审核都有统一、可追踪的状态，以便可靠控制发布并处理异常。

#### Acceptance Criteria

1. WHEN D44 数据迁移执行 THEN 系统 SHALL 创建 `content_moderation_jobs` 审核任务表。
2. WHEN 审核任务创建 THEN 系统 SHALL 记录内容类型、业务对象、不可变版本、服务商、策略标识和状态。
3. WHEN 媒体审核任务创建 THEN 系统 SHALL 使用对象 ETag 标识不可变版本。
4. WHEN 文本审核任务创建 THEN 系统 SHALL 使用标准化文本的 SHA-256 摘要标识不可变版本。
5. WHEN 同一业务对象的同一不可变版本被重复送审 THEN 数据库 SHALL 通过唯一约束避免冲突任务。
6. WHEN 腾讯云返回审核结果 THEN 系统 SHALL 保存处置建议、标签、子标签、分数和受长度限制的响应摘要。
7. WHEN 系统记录审核日志 THEN 日志 SHALL NOT 包含密钥、用户令牌、可复用签名 URL 或完整私密文本。

### Requirement 2：现有媒体兼容和新媒体默认隔离

**User Story：** 作为现有用户，我希望历史相册继续可用；作为平台运营者，我希望所有新媒体默认先隐藏。

#### Acceptance Criteria

1. WHEN D44 迁移现有 `session_album_photos` THEN 系统 SHALL 将现有记录回填为 `moderation_status = approved_legacy`。
2. WHEN D44 上线后创建新图片或视频 THEN 系统 SHALL 显式写入 `moderation_status = pending`。
3. WHEN 媒体处于 `pending`、`review`、`rejected` 或 `error` THEN 普通用户 SHALL NOT 获得该媒体的内容 URL。
4. WHEN 媒体处于 `approved` 或 `approved_legacy` THEN 系统 SHALL 按原有权限和隐私规则决定是否可见。
5. WHEN D44 上线 THEN 系统 SHALL NOT 自动提交现有媒体进行历史审核。
6. WHEN 媒体技术处理状态变为 ready THEN 系统 SHALL NOT 将其视为内容审核通过。

### Requirement 3：新图片先审后发

**User Story：** 作为相册成员，我希望新增图片经过安全审核后才对其他人可见。

#### Acceptance Criteria

1. WHEN 图片完成现有 COS 直传和格式校验 THEN 后端 SHALL 创建 `pending` 媒体和图片审核任务。
2. WHEN 图片审核任务创建 THEN 后端 SHALL 使用 COS 对象 Key、ETag、不可猜测的 `data_id` 和配置的图片策略提交 CI 审核。
3. WHEN CI 返回 Pass THEN 系统 SHALL 在事务中将审核任务和媒体更新为 `approved`。
4. WHEN CI 返回 Review THEN 系统 SHALL 将审核任务和媒体更新为 `review` 并进入人工复核队列。
5. WHEN CI 返回 Block THEN 系统 SHALL 将审核任务和媒体更新为 `rejected` 并创建幂等对象清理任务。
6. WHEN 图片尚未批准 THEN 上传者 SHALL 只能看到不含媒体 URL 的状态占位。
7. WHEN 图片尚未批准 THEN 其他成员和公开分享 SHALL NOT 感知该图片存在。

### Requirement 4：新视频画面和音轨先审后发

**User Story：** 作为相册成员，我希望新增视频的画面和声音都经过安全审核后才可以播放。

#### Acceptance Criteria

1. WHEN 视频源对象稳定且技术校验完成 THEN 后端 SHALL 创建 `pending` 审核任务。
2. WHEN 视频送审 THEN 系统 SHALL 按配置审核视频画面和音轨。
3. WHEN 视频转码或封面处理完成但内容审核未通过 THEN 系统 SHALL NOT 返回播放、封面、预览或下载 URL。
4. WHEN 视频审核返回 Pass、Review 或 Block THEN 系统 SHALL 执行与图片一致的批准、复核或拒绝状态迁移。
5. WHEN 视频被拒绝 THEN 系统 SHALL 为平台拥有的源对象、展示对象和封面对象创建幂等清理任务。
6. WHEN 视频审核仍在处理 THEN 上传者 SHALL 看到审核状态，其他用户 SHALL NOT 看到该视频。

### Requirement 5：所有媒体读取路径独立执行审核门禁

**User Story：** 作为平台运营者，我希望未批准媒体无法通过任何列表外的直连接口泄漏。

#### Acceptance Criteria

1. WHEN 普通用户请求相册列表 THEN 查询 SHALL 只包含 `approved` 和 `approved_legacy` 媒体。
2. WHEN 系统计算相册数量、标签或下载选择 THEN 计算 SHALL 只包含 `approved` 和 `approved_legacy` 媒体。
3. WHEN 用户通过公开分享访问相册 THEN 分享接口 SHALL NOT 返回未批准媒体或计入未批准媒体数量。
4. WHEN 用户请求图片预览、缩略图、视频流或下载 THEN 对应接口 SHALL 独立校验 `moderation_status`。
5. WHEN 用户请求 COS 直连签名 URL THEN 后端 SHALL 仅为 `approved` 或 `approved_legacy` 媒体签名。
6. WHEN 管理员查看待审媒体 THEN 系统 SHALL 通过管理员专用接口返回短时预览 URL 并记录审计。

### Requirement 6：指定用户文本通过 TMS 审核

**User Story：** 作为平台用户，我希望公开昵称、评价和说明文本不包含色情、政治敏感、暴恐或违法内容。

#### Acceptance Criteria

1. WHEN 用户创建或修改昵称 THEN API SHALL 在应用新昵称前调用 TMS。
2. WHEN 用户提交车友评价正文 THEN API SHALL 在公开评价前调用 TMS。
3. WHEN 用户提交车内留言或置顶留言 THEN API SHALL 在公开文本前调用 TMS。
4. WHEN 用户创建或编辑门店、剧本名称和介绍 THEN API SHALL 在应用文本前调用 TMS。
5. WHEN 用户提交创建或管理拼车的公开说明文本 THEN API SHALL 在公开文本前调用 TMS。
6. WHEN 一次业务提交包含多个短字段 THEN 系统 SHALL 标记字段后合并送审，并按最高风险结果处置整个提交。
7. WHEN 文本审核返回 Pass THEN 系统 SHALL 保存或应用文本并将任务标为 `approved`。
8. WHEN 文本审核返回 Block THEN 系统 SHALL 拒绝变更，并 SHALL NOT 修改当前线上实体。
9. WHEN 文本审核返回 Review THEN 系统 SHALL 保存隐藏提案并进入人工复核队列。
10. WHEN 文本审核服务异常 THEN 系统 SHALL 保持文本隐藏并重试，SHALL NOT 自动放行。
11. WHEN 文本为系统生成内容、手机号或管理员审核备注 THEN D44 SHALL NOT 将其纳入送审范围。

### Requirement 7：待审文本不覆盖已批准值

**User Story：** 作为修改资料的用户，我希望疑似内容复核期间，当前正常资料不受影响。

#### Acceptance Criteria

1. WHEN 昵称修改返回 Review 或 Error THEN 系统 SHALL 保留当前已批准昵称并保存待审提案。
2. WHEN 管理员批准文本提案 THEN 系统 SHALL 仅在提案基于的旧版本仍匹配时原子应用新值。
3. WHEN 提案基于的旧版本已变化 THEN 系统 SHALL 将提案标为过期且 SHALL NOT 覆盖新值。
4. WHEN 新评价或新说明文本返回 Review THEN 系统 SHALL 在批准前完全隐藏该内容。
5. WHEN 管理员拒绝文本提案 THEN 系统 SHALL 保持原值不变，并记录拒绝原因。

### Requirement 8：腾讯云回调安全且幂等

**User Story：** 作为平台运营者，我希望伪造、重复或过期回调不能错误发布内容。

#### Acceptance Criteria

1. WHEN 腾讯云调用审核回调 THEN 后端 SHALL 校验腾讯云支持的签名或高强度回调令牌。
2. WHEN 回调请求体超过限制或结构未知 THEN 后端 SHALL 拒绝请求。
3. WHEN 处理回调 THEN 后端 SHALL 同时匹配腾讯云任务 ID、`data_id`、业务对象、对象 Key 和 ETag 或文本摘要。
4. WHEN 回调与当前不可变版本不一致 THEN 系统 SHALL 记录过期事件且 SHALL NOT 改变当前内容状态。
5. WHEN 同一终态回调重复到达 THEN 后端 SHALL 幂等返回成功。
6. WHEN 管理员已对当前版本作出决定 THEN 之后到达的腾讯云回调 SHALL NOT 覆盖管理员决定。
7. WHEN 状态迁移执行 THEN 后端 SHALL 在事务中锁定审核任务和业务对象。

### Requirement 9：审核失败关闭、自动重试和告警

**User Story：** 作为平台运营者，我希望腾讯云故障时内容保持安全隔离，并能自动恢复或及时告警。

#### Acceptance Criteria

1. WHEN 审核遇到网络错误、超时、限流或腾讯云 5xx THEN Worker SHALL 使用带抖动的有限指数退避重试。
2. WHEN Worker 认领任务 THEN 系统 SHALL 使用租约避免多个 Worker 同时处理同一任务。
3. WHEN 审核遇到认证、权限、策略、额度或欠费错误 THEN 系统 SHALL 立即告警并保持内容隐藏。
4. WHEN 任务超过重试上限 THEN 系统 SHALL 保持 `error` 状态并进入管理员队列。
5. WHEN 任务处于 `error` THEN 管理员 SHALL 可以重新提交或拒绝。
6. WHEN 审核超过任意等待时间 THEN 系统 SHALL NOT 基于超时自动批准。

### Requirement 10：管理员最小人工复核

**User Story：** 作为管理员，我希望在现有 Web 后台处理疑似和错误内容，以减少误伤并控制风险。

#### Acceptance Criteria

1. WHEN 管理员进入“内容审核”页面 THEN 系统 SHALL 展示 `review` 和 `error` 内容队列。
2. WHEN 管理员筛选队列 THEN 页面 SHALL 支持内容类型、状态、腾讯云标签和提交时间筛选。
3. WHEN 管理员查看条目 THEN 页面 SHALL 展示安全预览、提交者、关联实体、机审建议、标签、分数、尝试次数和时间。
4. WHEN 管理员批准条目 THEN 系统 SHALL 发布当前不可变版本并记录审计。
5. WHEN 管理员拒绝条目 THEN 系统 SHALL 要求填写原因、保持或转为隐藏状态并安排必要清理。
6. WHEN 管理员重试错误条目 THEN 内容 SHALL 在重试期间继续隐藏。
7. WHEN 普通用户调用管理员审核接口 THEN 后端 SHALL 返回 403。
8. WHEN 管理员执行动作 THEN 系统 SHALL 记录管理员 ID、动作、原因、前后状态和时间。

### Requirement 11：COS 自动审核和最小权限配置

**User Story：** 作为平台运营者，我希望业务主动送审之外还有云侧兜底，并避免授予过大权限。

#### Acceptance Criteria

1. WHEN D44 部署到生产 THEN 运维 SHALL 为相册图片和视频上传前缀配置 COS 自动审核与自动冻结。
2. WHEN 配置审核策略 THEN 策略 SHALL 覆盖色情、政治或违法、暴恐，并按运营要求覆盖广告、二维码和 OCR 文本。
3. WHEN 配置视频策略 THEN 策略 SHALL 覆盖视频画面和音轨。
4. WHEN COS 自动冻结对象 THEN 应用 SHALL NOT 将冻结事件解释为审核通过。
5. WHEN 配置 CAM 权限 THEN 权限 SHALL 限制在必要审核操作和相关 COS 前缀。
6. WHEN 生产环境缺少必要审核配置 THEN 系统 SHALL 阻止相应新内容发布链路启用。
7. WHEN 每日审核额度接近上限 THEN 监控 SHALL 告警，系统 SHALL NOT 静默放行未审核内容。

### Requirement 12：发布、监控和回滚

**User Story：** 作为发布负责人，我希望按风险从低到高逐步开启审核，并能在异常时安全回滚。

#### Acceptance Criteria

1. WHEN D44 发布 THEN 系统 SHALL 先上线数据结构、访问门禁、后台队列、指标和功能开关。
2. WHEN 数据结构上线 THEN 切换前内容 SHALL 继续按 `approved_legacy` 可用。
3. WHEN 腾讯云配置在非生产环境验证完成 THEN 生产 SHALL 依次开启文本、图片、视频审核。
4. WHEN 任一阶段指标异常 THEN 发布 SHALL 停止推进下一阶段。
5. WHEN 回滚某类审核 THEN 系统 SHALL 关闭该类新提交，SHALL NOT 放宽可见性门禁或自动批准待审内容。
6. WHEN 系统运行 THEN 监控 SHALL 覆盖队列深度和年龄、提交与回调延迟、结果比例、回调认证失败、重试耗尽、权限、额度和欠费错误。
7. WHEN COS 出现没有对应业务审核任务的自动冻结 THEN 系统 SHALL 告警。

### Requirement 13：D44 交付物和验证

**User Story：** 作为开发团队，我希望 D44 有完整中文 spec 三件套和可重复验证，以便严格按范围落地。

#### Acceptance Criteria

1. WHEN D44 spec 完成 THEN SHALL 产出中文 `requirements.md`。
2. WHEN D44 spec 完成 THEN SHALL 产出中文 `design.md`。
3. WHEN D44 spec 完成 THEN SHALL 产出中文 `tasks.md`。
4. WHEN D44 实现 THEN SHALL 采用测试先行方式验证每项新增行为。
5. WHEN D44 实现完成 THEN SHALL 通过内容审核定向测试、相册图片和视频测试、管理后台测试及小程序媒体测试。
6. WHEN D44 实现完成 THEN SHALL 通过数据库迁移检查。
7. WHEN D44 实现完成 THEN SHALL 通过 `npm run check`。
8. WHEN D44 实现完成 THEN SHALL 在非生产环境完成真实腾讯云 Pass、Review、Block、超时和重复回调冒烟验证。

