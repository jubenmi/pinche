# D4 Requirements: 车头建车流程

更新日期：2026-06-12

## Introduction

D4在D3管理员资料录入基础上，实现车头建车最小可用流程。D4不做玩家报名、审核、分享埋点和上传发布，只保证车头能把一辆可分享的招募中车创建出来。

## Requirements

### Requirement 1: 基础资料选择

**User Story:** 作为车头，我希望选择管理员录入的店家和剧本，以便基于可信资料建车。

#### Acceptance Criteria

1. WHEN 车头打开建车页 THEN 系统 SHALL 展示 active 店家和 active 剧本。
2. WHEN 车头选择店家 THEN 页面 SHALL 标记当前已选店家。
3. WHEN 车头选择剧本 THEN 页面 SHALL 标记当前已选剧本。
4. WHEN 店家或剧本缺失 THEN 页面 SHALL 支持提交新增资料申请。
5. WHEN 车头提交新增资料申请 THEN 系统 SHALL NOT 直接创建公开店家或剧本。

### Requirement 2: 建车基础信息

**User Story:** 作为车头，我希望填写时间、DM/NPC快照、押金和备注，以便分享页展示关键决策信息。

#### Acceptance Criteria

1. WHEN 创建车 THEN 系统 SHALL 要求选择店家、剧本和开车时间。
2. WHEN 填写DM/NPC名称 THEN 系统 SHALL 只保存为本车快照。
3. WHEN 填写押金金额 THEN 系统 SHALL 保存整数分，且不得小于0。
4. WHEN 填写备注 THEN 系统 SHALL 保存为本车备注。
5. WHEN 用户未登录 THEN 系统 SHALL 阻止创建并提示先登录。

### Requirement 3: 座位模板

**User Story:** 作为车头，我希望从剧本默认模板生成座位，以便快速配置常见恋陪/F4车。

#### Acceptance Criteria

1. WHEN 选择的剧本包含 `default_seat_template_json` THEN 页面 SHALL 支持应用该模板。
2. WHEN 剧本没有默认模板 THEN 页面 SHALL 提供“1情感沉浸位 + 4 F4”模板。
3. WHEN 车头选择空白模板 THEN 页面 SHALL 清空当前座位。
4. WHEN 应用模板 THEN 页面 SHALL 生成可编辑的座位列表。

### Requirement 4: 座位编辑和价格计算

**User Story:** 作为车头，我希望编辑座位和补贴调整，以便每个玩家看到清晰实付价。

#### Acceptance Criteria

1. WHEN 车头新增座位 THEN 页面 SHALL 新增一个开放座位。
2. WHEN 车头删除座位 THEN 页面 SHALL 从发布候选座位中移除该座位。
3. WHEN 车头修改座位名、类型、角色名、原价或调整 THEN 页面 SHALL 实时更新该座位实付价。
4. WHEN 任一座位实付价小于0 THEN 页面 SHALL 标记不可发布。
5. WHEN 所有座位调整合计不等于0 THEN 页面 SHALL 标记不可发布。
6. WHEN 座位为空 THEN 页面 SHALL 标记不可发布。

### Requirement 5: 发布车

**User Story:** 作为车头，我希望一键发布车，以便生成可发给玩家的车详情页。

#### Acceptance Criteria

1. WHEN 发布前校验通过 THEN 前端 SHALL 依次创建草稿车、创建座位并调用发布接口。
2. WHEN 后端发布车 THEN 后端 SHALL 重新校验至少一个座位、补贴合计为0、实付价不小于0。
3. WHEN 发布成功 THEN 车状态 SHALL 为 `recruiting`。
4. WHEN 发布成功 THEN 页面 SHALL 跳转到 `/pages/session/detail?id={sessionId}`。
5. WHEN 发布失败 THEN 页面 SHALL 展示失败提示且不跳转。

### Requirement 6: D4交付物

**User Story:** 作为开发团队，我希望D4有明确交付物，以便进入D5分享页与玩家报名。

#### Acceptance Criteria

1. WHEN D4完成 THEN SHALL 产出D4 requirements、design、tasks。
2. WHEN D4完成 THEN SHALL 完成建车页基础信息和座位编辑。
3. WHEN D4完成 THEN SHALL 完成剧本模板应用。
4. WHEN D4完成 THEN SHALL 完成发布车前端编排。
5. WHEN D4完成 THEN SHALL 完成D4烟测脚本。
6. WHEN D4完成 THEN SHALL 通过 `npm run check`、`npm run d4:smoke`、`npm run build:mp-weixin`。
7. WHEN D4完成 THEN SHALL 通过微信开发者工具建车页验证。
