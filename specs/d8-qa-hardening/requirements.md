# D8 Requirements: QA与内测修复

更新日期：2026-06-12

## Requirements

### Requirement 1: 主链路QA

1. WHEN D8执行 THEN 管理员录入店/本、车头建车、发布、分享、玩家申请、车头审核、锁座 SHALL 连续跑通。
2. WHEN 主链路失败 THEN SHALL 记录问题、级别、复现步骤和修复状态。

### Requirement 2: 异常和权限QA

1. WHEN 非管理员访问管理员能力 THEN 系统 SHALL 拒绝。
2. WHEN 非车头访问管理能力 THEN 系统 SHALL 拒绝。
3. WHEN 补贴不配平、实付小于0、重复报名、座位已锁 THEN 系统 SHALL 给出明确错误。

### Requirement 3: 合规QA

1. WHEN 提审前检查 THEN SHALL 无诱导分享、红包、返现、抽奖、现实陪伴承诺、公开联系方式。
2. WHEN 用户输入公开展示 THEN SHALL 有内容安全检查或人工审核路径。
3. WHEN 审核账号测试 THEN SHALL 能完整体验主链路。

### Requirement 4: D8交付物

1. WHEN D8完成 THEN SHALL 产出QA清单、问题列表、修复记录、提审说明草稿。
