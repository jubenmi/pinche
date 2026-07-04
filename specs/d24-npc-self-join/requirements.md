# D24 Requirements: NPC 工作人员自选角色上车

更新日期：2026-07-04

## Introduction

D24 让 NPC 工作人员像玩家一样通过分享页选择自己的角色，但 NPC 不占用玩家座位。车局默认允许 NPC 自选角色，车头可以关闭。NPC 角色绑定复用 D23 的 `join_policy`：`direct` 车局直接绑定，`review_required` 车局先提交给车头审核，审核通过后才成为相册成员。

## Requirements

### Requirement 1: 车局支持 NPC 自选开关

**User Story:** 作为车头，我希望创建车局时可以决定 NPC 工作人员是否能自行选择本场 NPC 角色，以便适配不同门店安排方式。

#### Acceptance Criteria

1. WHEN 创建车局时没有传 NPC 自选设置 THEN 系统 SHALL 默认保存 `npc_join_enabled = true`。
2. WHEN 创建车局时关闭 NPC 自选 THEN 系统 SHALL 保存 `npc_join_enabled = false`。
3. WHEN 后端返回车局详情 THEN 车局数据 SHALL 包含 `npc_join_enabled`。
4. WHEN 旧车局没有显式 NPC 自选设置 THEN 系统 SHALL 按 `npc_join_enabled = true` 处理。
5. WHEN NPC 自选设置值无法归一化为布尔值 THEN 后端 SHALL 返回 400。
6. WHEN 车头或管理员更新车局 THEN 系统 SHALL 允许修改 `npc_join_enabled`。
7. WHEN 修改 `npc_join_enabled` THEN 系统 SHALL NOT 回溯解绑已经绑定的 NPC 角色。

### Requirement 2: NPC 申请复用报名审核记录

**User Story:** 作为车头，我希望 NPC 工作人员申请角色也出现在现有审核入口，而不是多一套审核产品线。

#### Acceptance Criteria

1. WHEN 玩家申请座位 THEN `signups` SHALL 继续保存 `signup_type = seat`、`seat_id`，且不改变现有玩家申请行为。
2. WHEN NPC 工作人员申请 NPC 角色 THEN `signups` SHALL 保存 `signup_type = session_npc_role` 和 `session_npc_role_id`。
3. WHEN NPC 申请处于 pending THEN `session_npc_roles.bound_user_id` SHALL NOT 被设置。
4. WHEN 同一用户重复申请同一 NPC 角色且已有 pending 申请 THEN 后端 SHALL 返回同一待审核结果。
5. WHEN 同一 NPC 角色已有其他用户 pending 申请 THEN 后端 SHALL 阻止新的普通工作人员申请。
6. WHEN 同一 NPC 角色已绑定其他用户 THEN 后端 SHALL 阻止新的普通工作人员申请。
7. WHEN 旧报名记录没有 `signup_type` THEN 系统 SHALL 按玩家座位申请处理。

### Requirement 3: NPC 直接上车复用 `join_policy = direct`

**User Story:** 作为 NPC 工作人员，我希望免审车局中选择 NPC 角色后立刻成为本场工作人员并进入相册。

#### Acceptance Criteria

1. WHEN 车局 `join_policy = direct` 且 `npc_join_enabled = true` THEN 登录且已授权手机号的工作人员 SHALL 可以选择未绑定 NPC 角色。
2. WHEN NPC 直接上车成功 THEN `session_npc_roles.bound_user_id` SHALL 设置为当前用户。
3. WHEN NPC 直接上车成功 THEN 系统 SHALL 写入或更新一条 `approved` NPC signup。
4. WHEN 已绑定该 NPC 角色的用户重复选择该角色 THEN 系统 SHALL 返回成功且保持同一绑定。
5. WHEN NPC 角色 inactive THEN 系统 SHALL 返回冲突或不可选错误。
6. WHEN 车局已取消 THEN 系统 SHALL 拒绝 NPC 直接上车。
7. WHEN NPC 自选关闭且调用者不是车头或管理员 THEN 系统 SHALL 拒绝 NPC 直接上车。

### Requirement 4: NPC 审核上车复用 `join_policy = review_required`

**User Story:** 作为车头，我希望需要审核的车局中，NPC 工作人员选择角色后也需要我确认。

#### Acceptance Criteria

1. WHEN 车局 `join_policy = review_required` 且 `npc_join_enabled = true` THEN NPC 工作人员选择未绑定 NPC 角色 SHALL 创建 pending NPC signup。
2. WHEN NPC signup 处于 pending THEN 申请人 SHALL NOT 获得完整相册权限。
3. WHEN 车头通过 NPC signup THEN 系统 SHALL 设置 `session_npc_roles.bound_user_id = signup.user_id`。
4. WHEN 车头通过 NPC signup THEN 系统 SHALL 将该 signup 标记为 `approved`。
5. WHEN 车头通过 NPC signup THEN 系统 SHALL 拒绝同一 NPC 角色的其他 pending signup。
6. WHEN 车头拒绝 NPC signup THEN 系统 SHALL NOT 修改 `session_npc_roles.bound_user_id`。
7. WHEN NPC 自选关闭且调用者不是车头或管理员 THEN 系统 SHALL 拒绝创建 NPC signup。

### Requirement 5: 分享页支持 NPC 工作人员选择角色

**User Story:** 作为 NPC 工作人员，我希望从车局分享页看到本场 NPC 角色并选择自己的角色。

#### Acceptance Criteria

1. WHEN 车局有 active NPC 角色且 `npc_join_enabled = true` THEN 分享页 SHALL 展示 NPC 角色区。
2. WHEN NPC 角色未绑定且未被他人 pending 申请占用 THEN 分享页 SHALL 展示该角色为可选。
3. WHEN NPC 角色已绑定当前用户 THEN 分享页 SHALL 展示该角色为我选。
4. WHEN 当前用户已对该 NPC 角色提交 pending 申请 THEN 分享页 SHALL 展示该角色为待审。
5. WHEN NPC 角色已绑定其他用户或被其他用户 pending 申请占用 THEN 分享页 SHALL 展示该角色为已选或不可选。
6. WHEN NPC 自选关闭 THEN 分享页 SHALL 不提供 NPC 自选操作，并展示或保留只读说明。
7. WHEN NPC 选择返回 `npc_joined` 且入口为相册分享 THEN 分享页 SHALL 跳转完整相册。
8. WHEN NPC 选择返回 `pending_review` THEN 分享页 SHALL 提示等待车头审核并停留当前页。
9. WHEN 玩家座位选择统计展示可选/已选数量 THEN NPC 角色 SHALL NOT 计入玩家座位人数。

### Requirement 6: NPC 相册逻辑与玩家相同

**User Story:** 作为 NPC 工作人员，我希望绑定 NPC 角色后能使用完整相册，并且我的隐私规则能影响标注到我的照片。

#### Acceptance Criteria

1. WHEN 用户已绑定 active NPC 角色 THEN `isSessionAlbumMember` SHALL 将该用户视为本场相册成员。
2. WHEN 用户只有 pending NPC signup THEN `isSessionAlbumMember` SHALL NOT 将该用户视为本场相册成员。
3. WHEN 用户已绑定 NPC 角色 THEN 我的相册车局列表 SHALL 包含该车局。
4. WHEN 相册 people 返回 NPC 角色 THEN 该 person SHALL 使用 `key = session-npc:<id>`。
5. WHEN 相册 people 返回已绑定 NPC 角色 THEN 该 person SHALL 包含绑定用户 `user_id`。
6. WHEN 照片标注 `session-npc:<id>` 且 NPC 角色已绑定用户 THEN 相册可见性 SHALL 使用该用户的相册隐私设置。
7. WHEN NPC 工作人员上传照片 THEN 上传权限 SHALL 与玩家相册成员一致。

### Requirement 7: 管理端识别 NPC 申请

**User Story:** 作为车头，我希望审核列表能看出申请人申请的是玩家座位还是 NPC 角色。

#### Acceptance Criteria

1. WHEN 获取车局报名列表 THEN 后端 SHALL 返回玩家座位申请和 NPC 角色申请。
2. WHEN 返回 NPC 申请 THEN 数据 SHALL 包含 `signup_type`、`session_npc_role_id` 和 `npc_role_name`。
3. WHEN 小程序车头管理页展示 NPC 申请 THEN 页面 SHALL 展示 NPC 角色名，而不是空座位名。
4. WHEN admin web 审核列表展示 NPC 申请 THEN 页面 SHALL 展示 NPC 角色名，而不是空座位名。
5. WHEN 车头通过 NPC 申请 THEN 管理端 SHALL 刷新审核列表和 NPC 角色绑定状态。
6. WHEN 车头拒绝 NPC 申请 THEN 管理端 SHALL 刷新审核列表且不改变 NPC 角色绑定状态。

### Requirement 8: D24 交付物和验证

**User Story:** 作为开发团队，我希望 D24 有明确 spec 三件套和验收清单，以便后续按 spec 实现。

#### Acceptance Criteria

1. WHEN D24 spec 完成 THEN SHALL 产出 `requirements.md`。
2. WHEN D24 spec 完成 THEN SHALL 产出 `design.md`。
3. WHEN D24 spec 完成 THEN SHALL 产出 `tasks.md`。
4. WHEN D24 实现完成 THEN SHALL 更新相关静态检查和烟测。
5. WHEN D24 实现完成 THEN SHALL 通过 `npm run check`。
6. WHEN D24 实现完成 THEN SHALL 通过 `npm run build:mp-weixin`。
