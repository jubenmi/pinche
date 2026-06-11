# D3 Requirements: 管理员资料录入

更新日期：2026-06-11

## Introduction

D3在D2身份权限与数据模型基础上，实现管理员资料录入的最小可用闭环。完成后，系统管理员能在小程序内维护店家和剧本，普通用户不能看到或调用管理员能力；车头能搜索资料，找不到时提交新增申请；管理员审核通过后，资料进入车头可选列表。

## Requirements

### Requirement 1: 管理员入口

**User Story:** 作为系统管理员，我希望在“我的”页看到资料管理入口，以便进入管理员录入页面。

#### Acceptance Criteria

1. WHEN 用户未登录 THEN 系统 SHALL NOT 展示管理员入口。
2. WHEN 登录用户没有 `system_admin` 角色 THEN 系统 SHALL NOT 展示管理员入口。
3. WHEN 登录用户有 `system_admin` 角色 THEN 系统 SHALL 展示管理员入口。
4. WHEN 非管理员直接进入管理员资料页 THEN 页面 SHALL 提示无权限。

### Requirement 2: 店家录入与维护

**User Story:** 作为系统管理员，我希望录入、搜索、编辑和下架店家，以便车头选择可靠的店家资料。

#### Acceptance Criteria

1. WHEN 管理员进入资料管理页 THEN 系统 SHALL 支持查看店家列表。
2. WHEN 管理员输入关键词 THEN 系统 SHALL 支持按店名、城市、区域搜索店家。
3. WHEN 管理员提交店家表单 THEN 系统 SHALL 创建店家，字段包含店名、城市、区域、地址、状态。
4. WHEN 管理员编辑店家 THEN 系统 SHALL 更新基础信息。
5. WHEN 管理员下架店家 THEN 该店家 SHALL 不出现在车头可选列表。
6. WHEN 非管理员调用管理员店家接口 THEN 系统 SHALL 返回 `403 FORBIDDEN`。

### Requirement 3: 剧本录入与维护

**User Story:** 作为系统管理员，我希望录入、搜索、编辑和下架剧本，以便车头选择可靠的剧本资料。

#### Acceptance Criteria

1. WHEN 管理员进入资料管理页 THEN 系统 SHALL 支持查看剧本列表。
2. WHEN 管理员输入关键词 THEN 系统 SHALL 支持按本名、类型标签搜索剧本。
3. WHEN 管理员提交剧本表单 THEN 系统 SHALL 创建剧本，字段包含本名、类型标签、人数、无剧透简介、默认座位模板、状态。
4. WHEN 管理员编辑剧本 THEN 系统 SHALL 更新基础信息。
5. WHEN 管理员下架剧本 THEN 该剧本 SHALL 不出现在车头可选列表。
6. WHEN 非管理员调用管理员剧本接口 THEN 系统 SHALL 返回 `403 FORBIDDEN`。

### Requirement 4: 新增资料申请审核

**User Story:** 作为系统管理员，我希望审核车头提交的新增资料申请，以便通过后生成正式资料或驳回错误资料。

#### Acceptance Criteria

1. WHEN 管理员进入新增申请tab THEN 系统 SHALL 展示新增资料申请列表。
2. WHEN 管理员通过店家申请 THEN 系统 SHALL 创建正式店家并将申请状态改为 `approved`。
3. WHEN 管理员通过剧本申请 THEN 系统 SHALL 创建正式剧本并将申请状态改为 `approved`。
4. WHEN 管理员驳回申请 THEN 系统 SHALL 将申请状态改为 `rejected` 并保存审核备注。
5. WHEN 申请已通过 THEN 新资料 SHALL 出现在车头搜索列表里。

### Requirement 5: 车头搜索与缺资料申请

**User Story:** 作为车头，我希望在建车页能搜索店家和剧本，找不到资料时提交申请，以便不阻塞后续建车。

#### Acceptance Criteria

1. WHEN 车头打开建车页 THEN 系统 SHALL 支持搜索 active 店家。
2. WHEN 车头打开建车页 THEN 系统 SHALL 支持搜索 active 剧本。
3. WHEN 车头找不到店家 THEN 系统 SHALL 支持提交 `store` 新增资料申请。
4. WHEN 车头找不到剧本 THEN 系统 SHALL 支持提交 `script` 新增资料申请。
5. WHEN 车头提交申请成功 THEN 页面 SHALL 展示等待管理员处理的状态。
6. WHEN 车头提交申请 THEN 系统 SHALL NOT 直接创建公开店家或剧本资料。

### Requirement 6: 基础种子数据

**User Story:** 作为开发团队，我希望D3有基础店家和剧本数据，以便管理员录入与车头搜索可以快速验收。

#### Acceptance Criteria

1. WHEN D3迁移完成 THEN 系统 SHALL 有基础店家种子数据。
2. WHEN D3迁移完成 THEN 系统 SHALL 有基础剧本种子数据。
3. WHEN D3烟测执行 THEN 管理员 SHALL 能通过API录入至少10个店家。
4. WHEN D3烟测执行 THEN 管理员 SHALL 能通过API录入至少20个剧本。
5. WHEN D3烟测执行 THEN 车头 SHALL 能搜索到管理员录入的店家和剧本。

### Requirement 7: D3交付物

**User Story:** 作为开发团队，我希望D3有可检查交付物，以便明确是否可以进入D4。

#### Acceptance Criteria

1. WHEN D3完成 THEN SHALL 产出D3 requirements、design、tasks。
2. WHEN D3完成 THEN SHALL 完成管理员资料录入页面。
3. WHEN D3完成 THEN SHALL 完成店家录入、搜索、编辑、下架接口。
4. WHEN D3完成 THEN SHALL 完成剧本录入、搜索、编辑、下架接口。
5. WHEN D3完成 THEN SHALL 完成新增资料申请审核接口和页面。
6. WHEN D3完成 THEN SHALL 完成车头搜索资料和提交缺资料申请入口。
7. WHEN D3完成 THEN SHALL 完成基础种子数据。
8. WHEN D3完成 THEN SHALL 通过D3烟测。
