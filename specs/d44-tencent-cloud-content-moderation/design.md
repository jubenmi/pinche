# D44 Design：腾讯云内容安全审核设计

更新日期：2026-07-12

## Overview

D44 使用腾讯云数据万象（CI）审核相册图片和视频，使用腾讯云文本内容安全（TMS）审核指定用户文本。数据库状态机是发布权限的唯一依据；COS 自动审核与冻结只作为第二道防线。

本设计严格限定为：新内容先审后发、疑似内容人工复核、异常时关闭式失败、切换前媒体不回扫。自动处罚、产品化申诉和范围外文本不在 D44 中实现。

## Architecture

```text
小程序 / 管理后台
        |
        v
API 业务服务 ---- 创建业务对象或文本提案（默认隐藏）
        |
        +---- content_moderation_jobs
        |
        +---- 图片/视频 -> Tencent CI（异步）
        |                       |
        |                       v
        |                 安全回调端点
        |
        +---- 文本 -> Tencent TMS（同步建议，状态持久化）
        |
        v
统一状态迁移：approved / review / rejected / error
        |
        +---- approved -> 允许原有权限链路读取
        +---- review/error -> 管理后台复核
        +---- rejected -> 媒体对象清理

COS 自动审核与冻结：独立云侧兜底，不决定业务发布
```

## Data Model

### `content_moderation_jobs`

新增迁移 `apps/api/migrations/0024_content_moderation.sql`：

```sql
CREATE TABLE content_moderation_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  subject_type VARCHAR(64) NOT NULL,
  subject_id VARCHAR(128) NOT NULL,
  subject_version VARCHAR(128) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  provider_job_id VARCHAR(128) NULL,
  data_id VARCHAR(128) NOT NULL,
  policy_id VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  suggestion VARCHAR(32) NULL,
  label VARCHAR(64) NULL,
  sub_label VARCHAR(128) NULL,
  score INT NULL,
  response_summary_json JSON NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  next_retry_at DATETIME NULL,
  lease_token VARCHAR(64) NULL,
  lease_expires_at DATETIME NULL,
  last_error_code VARCHAR(128) NULL,
  submitted_at DATETIME NULL,
  completed_at DATETIME NULL,
  decided_by_admin_user_id BIGINT UNSIGNED NULL,
  decision_reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_moderation_subject_version
    (subject_type, subject_id, subject_version),
  UNIQUE KEY uniq_moderation_data_id (data_id),
  INDEX idx_moderation_queue (status, next_retry_at, created_at),
  INDEX idx_moderation_provider_job (provider, provider_job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

`subject_id` 使用字符串以统一承载数字媒体 ID 和文本提案 ID。`subject_version` 对媒体使用规范化 ETag，对文本使用标准化带标签内容的 SHA-256 十六进制摘要。

### 相册媒体字段

```sql
ALTER TABLE session_album_photos
  ADD COLUMN moderation_status VARCHAR(32) NOT NULL DEFAULT 'approved_legacy'
    AFTER processing_status,
  ADD INDEX idx_album_moderation
    (session_id, status, moderation_status, created_at);
```

迁移默认值只用于历史回填。所有 D44 上线后的创建语句必须显式写入 `moderation_status = pending`。

### 文本提案与审计

新增 `content_moderation_text_proposals`：

```text
id
subject_type
subject_id
base_version
normalized_payload_json
payload_digest
status: pending / review / approved / rejected / error / stale
created_by_user_id
applied_at
created_at / updated_at
```

新增 `content_moderation_audit_logs`：

```text
moderation_job_id
admin_user_id
action: approve / reject / retry
previous_status
next_status
reason
created_at
```

文本提案只保存业务应用所需字段。响应摘要和日志都执行长度限制，不保存可复用签名 URL 或完整敏感命中详情。

## Moderation Module

新增目录 `apps/api/src/modules/content-moderation/`：

| 文件 | 职责 |
| --- | --- |
| `constants.js` | 状态、内容类型、服务商和错误码常量 |
| `config.js` | 环境配置解析、生产必填检查、功能开关 |
| `normalize.js` | 腾讯云结果映射、文本标准化和摘要 |
| `repository.js` | 审核任务、提案、租约和审计记录持久化 |
| `tencent-client.js` | CI/TMS 请求适配器，不包含业务状态迁移 |
| `service.js` | 创建任务、提交、回调和管理员决定编排 |
| `callback.js` | 回调认证、结构校验和不可变版本匹配 |
| `retry.js` | 错误分类、指数退避、重试认领 |

所有外部客户端通过依赖注入使用。自动化测试使用假客户端，不访问真实腾讯云。

## Configuration

在 `apps/api/src/config.js` 和 `.env.production.example` 增加：

```text
CONTENT_MODERATION_ENABLED=false
CONTENT_MODERATION_TEXT_ENABLED=false
CONTENT_MODERATION_IMAGE_ENABLED=false
CONTENT_MODERATION_VIDEO_ENABLED=false
TENCENT_MODERATION_REGION=
TENCENT_CI_IMAGE_BIZ_TYPE=
TENCENT_CI_VIDEO_BIZ_TYPE=
TENCENT_TMS_BIZ_TYPE=
TENCENT_MODERATION_CALLBACK_URL=
TENCENT_MODERATION_CALLBACK_TOKEN=
CONTENT_MODERATION_RETRY_LIMIT=8
```

复用现有 COS 腾讯云密钥配置，或在后续部署中切换工作负载身份。任何日志和响应不得暴露凭证。生产启用某类审核时，其对应策略和回调配置必须完整，否则启动检查或对应提交接口关闭式失败。

## Provider Result Mapping

统一内部结果：

```js
{
  decision: "pass" | "review" | "block",
  label: "...",
  subLabel: "...",
  score: 0,
  providerJobId: "...",
  summary: {}
}
```

映射规则：

- 腾讯云 `Pass/PASS` -> `pass`。
- 腾讯云 `Review/REVIEW` -> `review`。
- 腾讯云 `Block/BLOCK` -> `block`。
- 缺失建议、未知建议或畸形响应 -> 可重试 `error`，绝不按 Pass 处理。

## Image Integration

修改 `apps/api/src/modules/album-image/upload-service.js` 和 `apps/api/src/modules/core/service.js`：

1. `insertFinalizedSessionAlbumImage` 显式写 `moderation_status = pending`。
2. 图片技术 finalize 事务完成后创建审核任务；任务创建以媒体 ID + ETag 幂等。
3. 审核提交失败不回滚已上传对象，但媒体保持隐藏并进入重试。
4. finalize 响应返回审核状态占位，不返回 `preview_display_url`、`thumbnail_display_url` 或 `download_url`。
5. CI Pass 后才允许现有媒体 URL 装配逻辑工作。

图片技术校验仍只负责文件格式、大小、尺寸和 ETag 稳定性，不承担内容安全结论。

## Video Integration

修改 `apps/api/src/modules/core/service.js`、`apps/api/src/modules/album-video/` 和相关 CI 回调路由：

1. 新视频记录显式写 `moderation_status = pending`。
2. 源对象稳定后创建视频审核任务，策略启用画面与音轨审核。
3. 现有转码回调只更新 `processing_status` 和技术元数据，不修改 `moderation_status`。
4. 只有 `processing_status = ready` 且 `moderation_status IN (approved, approved_legacy)` 才返回播放和封面 URL。
5. Block 复用 `session_album_object_cleanup_jobs`，为源、展示和封面对象幂等排队清理。

## Media Access Gates

修改所有读取入口，而不只修改列表 SQL：

- `listSessionAlbum` 和公开分享相册查询。
- 相册媒体数量和“是否存在媒体”判断。
- 标签列表、批量下载候选和选择状态。
- 图片 preview/thumbnail/download 代理端点。
- 视频 range 流、封面和下载端点。
- COS 直连签名 URL 生成入口。

普通可读谓词统一为：

```text
status = active
AND moderation_status IN (approved, approved_legacy)
AND 原有成员、分享、隐私和媒体类型规则通过
```

上传者管理接口可返回：

```json
{
  "id": 123,
  "moderation_status": "pending",
  "moderation_message": "内容正在审核",
  "preview_url": null,
  "download_url": null
}
```

## Text Integration

在以下服务边界调用统一 `moderateTextMutation`，不在 Vue 页面或客户端调用腾讯云：

- `apps/api/src/modules/auth/users.js`：昵称。
- `apps/api/src/modules/core/service.js`：评价、车内留言、置顶留言、用户私有门店和剧本文本、拼车公开说明。

单次变更组合格式示例：

```text
[nickname]张三
[summary]周末欢乐本，欢迎新手
```

标准化必须稳定，以确保相同文本产生相同摘要。系统生成文本、手机号和管理员审核备注不加入组合。

同步返回处理：

- Pass：在当前事务中应用变更并记录 approved 任务。
- Block：抛出稳定错误码 `CONTENT_MODERATION_REJECTED`，实体不变。
- Review：写入隐藏提案，返回 `CONTENT_MODERATION_REVIEW_PENDING`。
- 调用异常：写入 error 提案和任务，返回 `CONTENT_MODERATION_UNAVAILABLE` 或业务允许的审核中结果，实体不变。

昵称提案使用用户 `updated_at` 或确定性版本值作为 `base_version`。管理员批准时使用条件更新，版本不匹配则标记 `stale`。

## Callback API

新增：

```text
POST /api/internal/content-moderation/tencent/callback
```

处理顺序：

1. 在读取大请求体前检查方法和基础认证信息。
2. 使用严格大小限制解析请求。
3. 校验腾讯云原生签名；若该回调类型不提供可验证签名，则使用 URL 或请求头中的高强度回调令牌。
4. 匹配 provider job ID、`data_id`、业务对象、对象 Key 和 ETag/摘要。
5. 事务锁定任务与业务对象。
6. 已存在管理员决定时幂等忽略腾讯云结果。
7. 精确重复的终态结果返回 200。
8. 过期版本记录为 stale callback，不改变当前状态。
9. 合法新结果执行统一状态迁移。

回调错误响应不返回内部对象详情。

## Retry Worker

新增：

```text
apps/api/src/jobs/content-moderation-retry.js
npm run job:content-moderation-retry
```

Worker 使用 `FOR UPDATE SKIP LOCKED` 和租约令牌认领 `pending/error` 到期任务。网络、超时、限流和 5xx 使用有限指数退避与抖动。认证、CAM 权限、策略不存在、额度和欠费错误仍保持 error，但提高告警级别。

超过 `CONTENT_MODERATION_RETRY_LIMIT` 后不再自动认领，管理员可手动重试或拒绝。不存在自动批准路径。

## Admin API and Web UI

新增管理员 API：

| Method | Path | 行为 |
| --- | --- | --- |
| `GET` | `/api/admin/content-moderation` | 分页、筛选 review/error 队列 |
| `GET` | `/api/admin/content-moderation/:id` | 获取安全详情和短时预览 |
| `POST` | `/api/admin/content-moderation/:id/approve` | 批准当前不可变版本 |
| `POST` | `/api/admin/content-moderation/:id/reject` | 必填原因并拒绝 |
| `POST` | `/api/admin/content-moderation/:id/retry` | 重新排队，继续隐藏 |

全部接口要求 `system_admin`。动作在事务中写入 `content_moderation_audit_logs`，管理员结论优先于后续回调。

在 `apps/admin-web/src/` 现有管理框架中增加“内容审核”入口、队列表格和详情抽屉。支持内容类型、状态、标签和时间筛选；展示安全预览、提交者、关联实体、建议、标签、分数、重试次数和时间。拒绝操作必须填写原因。

## Mini Program UX

小程序不展示腾讯云内部标签。统一状态提示：

- `pending/error`：内容正在审核。
- `review`：内容需要进一步审核。
- `rejected`：内容未通过安全审核，如有疑问请联系客服。

相册页上传完成后可以显示当前用户自己的占位项，但不加载媒体内容。文本 Review 返回后保持当前页面数据不变，并提示已进入审核。

## COS Automatic Moderation

发布手册需配置：

- 对相册图片和视频准确前缀开启增量自动审核。
- 图片策略覆盖色情、政治/违法、暴恐，并按运营要求开启广告、二维码和 OCR 文本。
- 视频策略覆盖画面和音轨。
- 对违规分值区间开启自动冻结。
- COS 保持私有读。
- 配置审核每日上限和费用告警。

自动冻结不能修改数据库为 approved。若发生“已冻结但无业务审核任务”，监控必须告警。

## Metrics and Logging

新增指标：

```text
moderation_job_created
moderation_submission_success
moderation_submission_failure
moderation_callback_latency
moderation_decision_pass
moderation_decision_review
moderation_decision_block
moderation_callback_auth_failure
moderation_stale_callback
moderation_retry_exhausted
moderation_nonapproved_access_denied
```

所有指标按内容类型和策略聚合，不使用完整用户文本作为标签。

## Rollout and Rollback

发布顺序：

1. 数据库迁移、读取门禁、审核模块、后台队列、指标和关闭状态的功能开关。
2. 腾讯云 CI/TMS、CAM、策略、回调、COS 自动审核冻结和费用告警配置。
3. 非生产环境真实腾讯云联调。
4. 生产依次开启文本、图片、视频，每阶段观察队列、错误率和延迟。

每种内容类型记录切换时间。切换时间后的内容没有有效任务时一律隐藏。回滚只关闭该类型新提交，不移除门禁、不自动批准待审内容。

## Testing Strategy

### 单元测试

- 结果映射、未知结果关闭式失败。
- 文本标准化和摘要稳定性。
- 状态迁移与管理员决定优先级。
- 回调认证、重复和过期事件。
- 租约、错误分类和退避。

### API 和集成测试

- 图片 finalize 后 pending 且无 URL。
- 视频 ready 不能绕过 moderation。
- 所有媒体读取路径拒绝非 approved 状态。
- Pass 发布一次，Block 清理一次。
- Review 进入后台，管理员批准或拒绝可审计。
- 昵称 Review 保留旧昵称。
- 文本 Block 不修改实体。
- 腾讯云异常保持隐藏并生成重试任务。

### 验证命令

新增定向命令：

```text
npm run d44:check
npm run d44:unit
npm run d44:smoke
```

最终运行：

```text
npm run check
```

发布前在非生产环境使用腾讯云允许的测试样本验证 Pass、Review、Block、超时和重复回调。

## Error Codes

```text
CONTENT_MODERATION_REJECTED
CONTENT_MODERATION_REVIEW_PENDING
CONTENT_MODERATION_UNAVAILABLE
CONTENT_MODERATION_CONFIGURATION_ERROR
CONTENT_MODERATION_CALLBACK_UNAUTHORIZED
CONTENT_MODERATION_CALLBACK_STALE
CONTENT_MODERATION_INVALID_TRANSITION
```

普通用户只看到中性中文提示；详细标签、分数和服务商错误仅对管理员和运维可见。

