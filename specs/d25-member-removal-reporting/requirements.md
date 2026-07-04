# D25 Requirements: 恶意骚扰成员移除与举报

更新日期：2026-07-04

## Introduction

D25 允许车头在发现已上车玩家恶意骚扰、垃圾信息或疑似诈骗时，将该玩家从本车移除并举报。该能力复用现有座位释放、报名状态和聊天隔离规则；新增安全审计记录和禁止重进同一车局的限制，避免被移除用户继续通过分享页或直接上车接口回到同一车内。

本阶段只处理玩家座位成员。NPC 角色移除、退款仲裁、后台举报审核台和封号处罚不纳入本阶段。

## Requirements

### Requirement 1: 车头可以移除已上车玩家

**User Story:** 作为车头，我希望发现已上车玩家恶意骚扰时可以立即将其移出本车，保护其他成员。

#### Acceptance Criteria

1. WHEN 车头或系统管理员对已确认或已锁定座位执行移除 THEN 系统 SHALL 清空该座位 `confirmed_user_id`。
2. WHEN 移除完成 THEN 系统 SHALL 将该座位状态恢复为 `open`，如果车局已取消则保持 `cancelled`。
3. WHEN 移除完成 THEN 系统 SHALL 将被移除用户在该车局的 `pending` 或 `approved` 座位报名标记为 `cancelled`。
4. WHEN 非车头且非系统管理员执行移除 THEN 系统 SHALL 返回 403。
5. WHEN 座位没有已上车玩家且请求举报移除 THEN 系统 SHALL 返回业务冲突错误。

### Requirement 2: 恶意原因会创建举报审计并禁止重进

**User Story:** 作为车头，我希望恶意骚扰移除不是普通释放座位，而是留下证据并阻止该用户再次加入本车。

#### Acceptance Criteria

1. WHEN 移除请求包含 `report = true` THEN 系统 SHALL 创建一条成员移除举报记录。
2. WHEN 举报记录创建 THEN 系统 SHALL 保存车局、座位、被移除用户、操作者、原因类型、补充说明和创建时间。
3. WHEN 原因类型是 `harassment`、`spam`、`scam` 或 `safety_other` THEN 系统 SHALL 将该记录标记为禁止重进。
4. WHEN 被禁止重进的用户再次提交本车座位申请 THEN 系统 SHALL 返回 403。
5. WHEN 被禁止重进的用户在 `direct` 车局直接占座 THEN 系统 SHALL 返回 403。
6. WHEN 车头普通释放座位且未举报 THEN 系统 SHALL 保持现有释放能力，不创建举报记录，也不禁止该用户重进。

### Requirement 3: 车内聊天和相册权限即时失效

**User Story:** 作为车头，我希望被移除的人不能继续查看车内聊天或完整相册。

#### Acceptance Criteria

1. WHEN 玩家被移除 THEN 该用户 SHALL 不再满足车局聊天参与者条件。
2. WHEN 玩家被移除 THEN 该用户 SHALL 不再满足车局完整相册成员条件。
3. WHEN 玩家被移除后继续读取聊天 THEN API SHALL 返回 403。
4. WHEN 玩家被移除后继续发送聊天消息 THEN API SHALL 返回 403。
5. WHEN 玩家被移除后访问完整相册 THEN API SHALL 返回 403。

### Requirement 4: 车内留下克制的系统提示

**User Story:** 作为车内成员，我希望知道座位发生了成员移除，但不在群里暴露过多举报细节。

#### Acceptance Criteria

1. WHEN 车头普通释放座位 THEN 系统 SHALL 保留现有车内系统消息。
2. WHEN 车头移除并举报成员 THEN 系统 SHALL 写入一条系统消息说明该座位成员已被移除。
3. WHEN 系统消息包含原因 THEN 系统 SHALL 只展示原因类型的安全文案，不展示补充说明全文。
4. WHEN 补充说明包含交易风险词 THEN 系统 SHALL 拒绝该补充说明，避免聊天系统消息扩散违规内容。

### Requirement 5: 小程序管理页提供“移除并举报”入口

**User Story:** 作为车头，我希望在管理页对已上车成员选择移除原因，而不是只能点一个含糊的“踢出/释放”。

#### Acceptance Criteria

1. WHEN 座位已有确认成员 THEN 管理页 SHALL 展示“移除成员”操作。
2. WHEN 车头点击移除成员 THEN 小程序 SHALL 允许选择普通释放、恶意骚扰、垃圾信息、疑似诈骗或其他安全原因。
3. WHEN 车头选择普通释放 THEN 小程序 SHALL 调用现有释放接口且不带举报标记。
4. WHEN 车头选择恶意原因 THEN 小程序 SHALL 调用释放接口并带 `report = true`、`reasonType` 和可选说明。
5. WHEN 移除并举报成功 THEN 小程序 SHALL 展示该成员已移除且不能再次加入本车的结果文案。
6. WHEN 座位没有确认成员 THEN 管理页 SHALL 继续提供普通释放座位能力。

### Requirement 6: D25 交付物和验证

**User Story:** 作为开发团队，我希望 D25 有明确 spec 三件套和自动检查，便于后续维护。

#### Acceptance Criteria

1. WHEN D25 spec 完成 THEN SHALL 产出 `requirements.md`。
2. WHEN D25 spec 完成 THEN SHALL 产出 `design.md`。
3. WHEN D25 spec 完成 THEN SHALL 产出 `tasks.md`。
4. WHEN D25 实现完成 THEN SHALL 新增安全迁移和静态检查脚本。
5. WHEN D25 实现完成 THEN SHALL 将 D25 检查加入 `npm run check`。
6. WHEN D25 实现完成 THEN SHALL 通过 `npm --workspace apps/api run check`。
7. WHEN D25 实现完成 THEN SHALL 通过 `node scripts/d25-member-removal-reporting-check.js`。
8. WHEN D25 实现完成 THEN SHALL 通过 `node scripts/check-miniprogram.js`。
