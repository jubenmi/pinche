# D46 设计：自动内容审核能力与降级拦截

## 决策表

| 自动审核能力 | 无能力时拦截开关 | 发布策略 |
| --- | --- | --- |
| 可用 | 任意 | auto_moderate：自动审核通过后发布 |
| 不可用 | 关闭 | publish_directly：沿用旧逻辑 |
| 不可用 | 开启 | block_unavailable：拒绝发布 |

能力可用要求腾讯云凭证、地域、对应策略、回调配置和健康检查均完整。已选定 auto_moderate 的内容必须保持隐藏到终态，不再走降级直发。

## 模块

新增 API 内容审核模块：

- getModerationCapability(type)：返回能力是否可用及脱敏原因。
- resolvePublicationPolicy(type, settings, capability)：返回三种发布策略之一。
- submitModerationJob(subject)：为不可变媒体或文本版本创建任务并调用腾讯云。
- applyModerationOutcome(job, outcome)：执行合法状态迁移。

新增单行 content_security_settings，初始四个布尔值都为 false：总开关 block_when_unavailable 及图片、视频、文本类型开关。设置只控制“能力不可用时”，绝不关闭可用的自动审核。

## 接入

各业务写入边界先调用统一策略：

- publish_directly：调用现有写入逻辑，不产生待审内容。
- block_unavailable：返回稳定 503 业务错误，不写入公开对象或内容。
- auto_moderate：创建隐藏媒体或版本化文本提案；通过后才发布。

所有媒体列表、分享、预览、下载、流和签名 URL 仅对 approved 与 approved_legacy 可见。上传者可见无 URL 的状态占位。

## 后台与体验

管理后台增加“内容安全”页：总开关、图片/视频/文本子开关、三个只读能力状态。仅系统管理员可访问，所有保存写审计。

小程序仅显示“内容正在安全审核”“内容未通过安全审核”与“内容安全服务暂未就绪，暂时无法发布，请稍后再试”。

## 验证

腾讯云客户端可注入假实现，稳定覆盖 Pass、Block、超时和重复回调。非生产环境执行真实腾讯云三类型联调。

