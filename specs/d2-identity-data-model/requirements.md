# D2 Requirements: 身份权限与数据模型

更新日期：2026-06-11

## Introduction

D2在D1技术初始化基础上实现MVP核心数据底座。完成后，API应能持久化微信登录用户、角色、店家、剧本、车、座位、报名、分享事件、订阅请求和认领申请，并通过业务token执行权限判断。

## Requirements

### Requirement 1: 微信登录持久化

**User Story:** 作为用户，我希望微信登录后平台能识别我的身份，以便后续发车、报名和管理资料。

#### Acceptance Criteria

1. WHEN 调用 `POST /api/auth/wechat/login` 并传入合法 `code` THEN 系统 SHALL 创建或更新 `users` 记录。
2. WHEN 用户首次登录 THEN 系统 SHALL 自动授予 `player` 角色。
3. WHEN 用户 `openid` 出现在 `BOOTSTRAP_ADMIN_OPENIDS` THEN 系统 SHALL 自动授予 `system_admin` 角色。
4. WHEN 登录成功 THEN 系统 SHALL 返回 `user`、`roles`、`openid`、`token` 和 `expiresAt`。
5. WHEN 调用 `GET /api/users/me` 并携带有效token THEN 系统 SHALL 返回当前用户和角色。

### Requirement 2: 业务Token与权限中间件

**User Story:** 作为开发者，我希望后端能统一校验业务token和角色，以便所有接口按同一套规则授权。

#### Acceptance Criteria

1. WHEN 请求需要登录的接口但缺少token THEN 系统 SHALL 返回 `401 UNAUTHORIZED`。
2. WHEN 请求携带无效或过期token THEN 系统 SHALL 返回 `401 UNAUTHORIZED`。
3. WHEN 请求需要 `system_admin` 但用户没有该角色 THEN 系统 SHALL 返回 `403 FORBIDDEN`。
4. WHEN 请求车头私有资源 THEN 系统 SHALL 校验资源 `organizer_user_id` 等于当前用户ID，除非当前用户是 `system_admin`。
5. WHEN 登录用户创建车 THEN 系统 SHALL 自动授予或保持 `organizer` 角色。

### Requirement 3: 核心数据库迁移

**User Story:** 作为开发者，我希望D2核心表和索引一次性落地，以便后续业务接口都能基于MySQL唯一事实来源开发。

#### Acceptance Criteria

1. WHEN 执行 `npm run migrate` THEN 系统 SHALL 创建或保持D2核心表。
2. WHEN 迁移完成 THEN SHALL 存在 `users`、`user_roles`、`performer_profiles`、`stores`、`scripts`、`catalog_requests`、`entity_claims`、`sessions`、`session_seats`、`signups`、`share_events`、`subscription_requests`。
3. WHEN 金额字段落库 THEN SHALL 使用整数分。
4. WHEN 状态字段落库 THEN SHALL 使用稳定字符串值。
5. WHEN 关键查询执行 THEN SHALL 有基础索引支持用户、角色、状态、车、座位、报名查询。

### Requirement 4: 管理员资料接口

**User Story:** 作为系统管理员，我希望能录入和维护店家、剧本，以便车头可以基于可靠数据建车。

#### Acceptance Criteria

1. WHEN `system_admin` 调用 `POST /api/admin/stores` THEN 系统 SHALL 创建店家。
2. WHEN 非管理员调用 `POST /api/admin/stores` THEN 系统 SHALL 返回 `403 FORBIDDEN`。
3. WHEN `system_admin` 调用 `PATCH /api/admin/stores/:id` THEN 系统 SHALL 更新店家基础资料或上下架状态。
4. WHEN `system_admin` 调用 `POST /api/admin/scripts` THEN 系统 SHALL 创建剧本。
5. WHEN `system_admin` 调用 `PATCH /api/admin/scripts/:id` THEN 系统 SHALL 更新剧本基础资料或上下架状态。
6. WHEN 用户调用 `GET /api/stores` 或 `GET /api/scripts` THEN 系统 SHALL 只返回 `active` 资料。

### Requirement 5: 新增资料申请与认领预留

**User Story:** 作为普通用户，我希望找不到店家或剧本时能提交申请，而不是直接创建公开资料。

#### Acceptance Criteria

1. WHEN 登录用户调用 `POST /api/catalog-requests` THEN 系统 SHALL 创建 `pending` 新增资料申请。
2. WHEN 管理员调用 `GET /api/admin/catalog-requests` THEN 系统 SHALL 返回申请列表。
3. WHEN 管理员审批新增资料申请 THEN 系统 SHALL 支持 `approved` 或 `rejected`。
4. WHEN 管理员通过申请 THEN 系统 SHALL 创建对应店家或剧本，并写入 `created_entity_id`。
5. WHEN 登录用户调用 `POST /api/entity-claims` THEN 系统 SHALL 创建认领申请，状态为 `pending`。

### Requirement 6: 演绎人员档案

**User Story:** 作为DM/NPC，我希望能预留演绎人员档案，以便后续被车头选择或绑定到车。

#### Acceptance Criteria

1. WHEN 登录用户调用 `POST /api/performer-profiles` THEN 系统 SHALL 创建或更新自己的演绎人员档案。
2. WHEN 用户创建演绎人员档案 THEN 系统 SHALL 自动授予或保持 `performer` 角色。
3. WHEN 演绎人员档案写入 THEN 系统 SHALL 保存展示名、城市和简介。

### Requirement 7: 建车、座位与发布

**User Story:** 作为车头，我希望后端能保存车和座位，并在发布时校验补贴配平。

#### Acceptance Criteria

1. WHEN 登录用户调用 `POST /api/sessions` THEN 系统 SHALL 创建 `draft` 车，并记录剧本/店家快照。
2. WHEN 登录用户创建车 THEN 系统 SHALL 自动授予或保持 `organizer` 角色。
3. WHEN 非车头用户修改他人的车 THEN 系统 SHALL 返回 `403 FORBIDDEN`。
4. WHEN 车头调用 `POST /api/sessions/:id/seats` THEN 系统 SHALL 创建座位并计算 `payable_price = base_price + adjustment`。
5. WHEN 任一座位 `payable_price < 0` THEN 系统 SHALL 拒绝保存。
6. WHEN 车头调用 `POST /api/sessions/:id/publish` THEN 系统 SHALL 校验所有座位 `adjustment` 合计为0。
7. WHEN 发布校验通过 THEN 系统 SHALL 将车状态更新为 `recruiting`。

### Requirement 8: 报名、审核与锁座事务

**User Story:** 作为车头，我希望报名审核和锁座有事务保护，以便不会出现多人被通过到同一座位。

#### Acceptance Criteria

1. WHEN 登录用户调用 `POST /api/signups` THEN 系统 SHALL 创建 `pending` 报名。
2. WHEN 车头调用 `GET /api/sessions/:id/signups` THEN 系统 SHALL 返回自己车的报名列表。
3. WHEN 车头审批通过报名 THEN 系统 SHALL 在同一事务中更新报名为 `approved`、座位为 `confirmed`、座位 `confirmed_user_id` 为报名用户。
4. WHEN 座位已有确认用户 THEN 系统 SHALL 拒绝再次通过其他报名。
5. WHEN 车头拒绝报名 THEN 系统 SHALL 更新报名为 `rejected`。
6. WHEN 车头调用 `POST /api/session-seats/:id/lock` THEN 系统 SHALL 在事务中将确认座位锁为 `locked`。
7. WHEN 车头更新押金状态 THEN 系统 SHALL 写入报名 `deposit_status`。

### Requirement 9: 分享、订阅和公开事件

**User Story:** 作为平台，我希望记录分享访问、转化和订阅请求结果，以便后续分析增长漏斗。

#### Acceptance Criteria

1. WHEN 调用 `POST /api/share-events/view` THEN 系统 SHALL 记录分享访问事件。
2. WHEN 调用 `POST /api/share-events/convert` THEN 系统 SHALL 记录分享转化事件。
3. WHEN 登录用户调用 `POST /api/subscriptions/request-result` THEN 系统 SHALL 记录订阅请求结果。

### Requirement 10: D2交付物

**User Story:** 作为开发团队，我希望D2有可检查交付物，以便明确是否可以进入D3。

#### Acceptance Criteria

1. WHEN D2完成 THEN SHALL 产出D2 requirements、design、tasks。
2. WHEN D2完成 THEN SHALL 补充根 README。
3. WHEN D2完成 THEN SHALL 完成核心数据库迁移。
4. WHEN D2完成 THEN SHALL 完成登录写库和当前用户接口。
5. WHEN D2完成 THEN SHALL 完成权限中间件。
6. WHEN D2完成 THEN SHALL 完成核心API骨架和基础CRUD。
7. WHEN D2完成 THEN SHALL 完成关键事务接口。
8. WHEN D2完成 THEN SHALL 通过D2烟测。
