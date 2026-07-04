# D23 Requirements: 相册分享与上车策略

更新日期：2026-07-04

## Introduction

D23 实现车局相册分享能力，并明确区分两种微信分享场景：

- 分享给好友或群聊：用于邀请上车，打开后进入现有选角色/选座位流程。
- 分享到朋友圈：用于公开展示相册，只展示发起分享人的角色相关照片，不提供上车能力。

D23 同时新增车局级上车策略：车头创建车局时可选择“直接上车”或“需要车头审核”。上车流程必须尽量复用现有发车前拼车逻辑、`signups` 报名状态、座位确认逻辑和车头管理审核页。

## Requirements

### Requirement 1: 车局支持上车策略

**User Story:** 作为车头，我希望每辆车可以设置玩家是直接上车还是需要我审核，以适配不同组织方式。

#### Acceptance Criteria

1. WHEN 创建车局时未选择上车策略 THEN 系统 SHALL 默认使用 `review_required`。
2. WHEN 创建车局时选择直接上车 THEN 系统 SHALL 保存 `join_policy = direct`。
3. WHEN 创建车局时选择需要审核 THEN 系统 SHALL 保存 `join_policy = review_required`。
4. WHEN 后端返回车局详情 THEN 车局数据 SHALL 包含 `join_policy`。
5. WHEN 旧车局没有显式上车策略 THEN 系统 SHALL 按 `review_required` 处理。
6. WHEN 上车策略值不是 `direct` 或 `review_required` THEN 后端 SHALL 返回 400。

### Requirement 2: 直接上车复用座位确认逻辑

**User Story:** 作为玩家，我希望免审车局中选择空位后能直接进入相册，而不是等待车头操作。

#### Acceptance Criteria

1. WHEN 车局 `join_policy = direct` 且座位开放 THEN 登录且已授权手机号的玩家 SHALL 可直接确认座位。
2. WHEN 直接上车成功 THEN `session_seats.confirmed_user_id` SHALL 设置为该玩家。
3. WHEN 直接上车成功 THEN 对应报名记录 SHALL 为 `approved`。
4. WHEN 直接上车成功且玩家已有同车其他确认座位 THEN 系统 SHALL 释放原座位。
5. WHEN 座位已被确认、锁定或取消 THEN 直接上车 SHALL 返回冲突或不可选错误。
6. WHEN 并发导致座位刚被别人确认 THEN 前端 SHALL 刷新座位状态并提示该角色刚被选走。

### Requirement 3: 审核上车复用报名申请逻辑

**User Story:** 作为车头，我希望需要审核的车仍保留当前申请上车和车头确认流程。

#### Acceptance Criteria

1. WHEN 车局 `join_policy = review_required` 且座位开放 THEN 玩家确认座位 SHALL 创建 `pending` 报名。
2. WHEN 报名创建成功 THEN 座位状态 SHALL 从 `open` 变为 `applied`。
3. WHEN 报名处于 `pending` THEN 玩家 SHALL NOT 获得完整相册成员权限。
4. WHEN 车头通过报名 THEN 玩家 SHALL 获得座位归属和完整相册成员权限。
5. WHEN 车头拒绝报名 THEN 玩家 SHALL 不获得座位归属和完整相册成员权限。
6. WHEN 普通玩家在审核车局调用直接占座接口 THEN 后端 SHALL 拒绝。

### Requirement 4: 相册分享到好友或群聊进入上车流程

**User Story:** 作为车友，我希望把相册发到群里后，新玩家可以从分享卡片进入上车流程。

#### Acceptance Criteria

1. WHEN 用户从相册页分享给好友或群聊 THEN 分享路径 SHALL 指向 `/pages/session/share`。
2. WHEN 好友或群聊分享打开 THEN query SHALL 包含 `id`、`entry=album`、`shareCode` 和 `source=wechat_share`。
3. WHEN 分享打开者已登录且已上车 THEN 系统 SHALL 直接进入完整相册页。
4. WHEN 分享打开者未登录 THEN 页面 SHALL 展示登录后查看相册或上车的提示。
5. WHEN 分享打开者登录但未上车 THEN 页面 SHALL 展示现有角色/座位选择。
6. WHEN 车局为 `direct` THEN 玩家确认角色后 SHALL 直接上车并进入相册。
7. WHEN 车局为 `review_required` THEN 玩家确认角色后 SHALL 提交申请并看到等待车头审核提示。

### Requirement 5: 相册分享到朋友圈进入只读展示

**User Story:** 作为车友，我希望把相册分享到朋友圈时，朋友只能看到我这个角色相关的照片，而不是完整车内相册或上车入口。

#### Acceptance Criteria

1. WHEN 用户从相册页分享到朋友圈 THEN 分享 SHALL 使用 `onShareTimeline` 的 `query`，且 SHALL NOT 返回自定义 `path`。
2. WHEN 朋友圈分享 query 生成 THEN query SHALL 包含 `id`、`source=wechat_timeline` 和 `albumShareToken`。
3. WHEN 访问者从朋友圈打开 THEN 相册页 SHALL 进入只读展示模式。
4. WHEN 相册页处于朋友圈只读模式 THEN 页面 SHALL NOT 强制登录。
5. WHEN 相册页处于朋友圈只读模式 THEN 页面 SHALL NOT 展示上传、删除、标注、多选、隐私设置或上车按钮。
6. WHEN 相册页处于朋友圈只读模式 THEN 页面 SHALL 只展示 `albumShareToken` 授权的照片。
7. WHEN 访问者已登录且已上车但从朋友圈打开 THEN 页面 SHALL 仍先展示朋友圈只读模式，不自动扩大为完整相册。

### Requirement 6: 朋友圈相册 token 绑定发起分享人的角色

**User Story:** 作为被拍到的玩家，我希望朋友圈只展示分享人自己角色相关照片，不能靠改参数看到别人的角色照片。

#### Acceptance Criteria

1. WHEN 同车成员请求朋友圈相册 token THEN 后端 SHALL 校验该用户有该车确认座位。
2. WHEN 用户没有该车确认座位 THEN 后端 SHALL 不签发角色相册 token。
3. WHEN token 签发成功 THEN token SHALL 绑定 `sessionId`、发起分享人、确认座位和过期时间。
4. WHEN 公开相册接口收到 token THEN 后端 SHALL 校验签名、过期时间和路径 `sessionId`。
5. WHEN 照片没有标注 token 绑定的座位 THEN 公开相册接口 SHALL NOT 返回该照片。
6. WHEN 照片是发起分享人上传但没有标注自己角色 THEN 公开相册接口 SHALL NOT 返回该照片。
7. WHEN token 无效或过期 THEN 公开相册接口 SHALL 返回可识别错误，前端 SHALL 展示分享失效或过期提示。

### Requirement 7: 公开相册展示尊重隐私

**User Story:** 作为同车成员，我希望朋友圈公开展示不会绕过我在相册中的隐私设置。

#### Acceptance Criteria

1. WHEN 照片标注了其他真实玩家 THEN 公开展示 SHALL 尊重这些玩家的被标注可见设置。
2. WHEN 上传者不允许上传照片公开可见 THEN 公开展示 SHALL 不返回该照片，除非上传者就是发起分享人且照片标注了发起分享人的座位。
3. WHEN 照片未标注任何人 THEN 公开展示 SHALL NOT 返回该照片。
4. WHEN 照片只标注 `other`、`npc` 或 `session_npc_role` THEN 公开展示 SHALL NOT 返回该照片。
5. WHEN 访问公开图片接口 THEN 后端 SHALL 再次校验图片属于 token 授权的公开照片集合。
6. WHEN 公开相册展示 THEN 页面 SHALL NOT 展示手机号、联系方式或完整车内成员列表。

### Requirement 8: D23 交付物和验证

**User Story:** 作为开发团队，我希望 D23 有明确 spec 三件套和验收清单，以便后续按 spec 实现。

#### Acceptance Criteria

1. WHEN D23 spec 完成 THEN SHALL 产出 `requirements.md`。
2. WHEN D23 spec 完成 THEN SHALL 产出 `design.md`。
3. WHEN D23 spec 完成 THEN SHALL 产出 `tasks.md`。
4. WHEN D23 实现完成 THEN SHALL 更新相关静态检查和烟测。
5. WHEN D23 实现完成 THEN SHALL 通过 `npm run check`。
6. WHEN D23 实现完成 THEN SHALL 通过 `npm run build:mp-weixin`。
