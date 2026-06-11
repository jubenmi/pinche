# D0 Requirements: 情感本拼车MVP需求冻结

更新日期：2026-06-11

## Introduction

本spec用于冻结微信小程序MVP的第一版需求。D0完成后，D1-D9只围绕本文件定义的范围开发；支付、红包、完整店家后台、完整DM/NPC后台、发行商后台、评价体系、推荐算法等均不进入MVP。

MVP的核心验证目标是：管理员能录入店家和剧本，车头能基于这些基础资料创建并分享一辆车，玩家能从分享页申请上车，车头能审核、锁座并记录押金状态。

## Requirements

### Requirement 1: MVP主链路冻结

**User Story:** 作为开发团队，我希望在D0明确唯一主链路，以便后续阶段不扩大范围并能快速发布MVP。

#### Acceptance Criteria

1. WHEN D1开始 THEN 系统 SHALL 只围绕以下主链路开发：管理员录入店家/剧本、车头建车、配置座位和补贴、发布分享、玩家申请、车头审核、锁座和押金状态记录。
2. IF 新需求不影响主链路可用性或合规性 THEN 该需求 SHALL 进入后续版本池。
3. WHEN MVP发布 THEN 系统 SHALL 能完成从管理员录入基础资料到玩家申请上车的闭环。
4. WHEN 车头完成发车配置 THEN 系统 SHALL 支持通过微信分享卡片、复制招募文案或简单海报传播车详情。

### Requirement 2: 用户与角色模型

**User Story:** 作为平台，我希望把人和资料分开建模，以便DM/NPC和玩家都基于微信用户，而店家和剧本只是可被认领的数据。

#### Acceptance Criteria

1. WHEN 用户首次进入小程序 THEN 系统 SHALL 使用微信登录创建或读取用户。
2. WHEN 用户是自然人身份 THEN 系统 SHALL 将其建模为微信用户，可拥有 `player`、`organizer`、`performer`、`system_admin` 等角色。
3. WHEN 对象是店家或剧本 THEN 系统 SHALL 将其建模为纯数据资料，不要求绑定微信用户。
4. WHEN DM/NPC参与某辆车 THEN 系统 SHALL 允许其作为本车演绎人员快照存在，并预留绑定到微信用户的字段。
5. WHEN 店家或剧本尚未被官方主体认领 THEN 系统 SHALL 保持 `claim_status = unclaimed`，认领流程不进入MVP主链路。

### Requirement 3: 系统管理员资料录入

**User Story:** 作为系统管理员，我希望先录入店家和剧本基础资料，以便车头建车时可以选择可靠的基础数据。

#### Acceptance Criteria

1. WHEN 系统管理员进入管理员资料页 THEN 系统 SHALL 支持创建、编辑、下架店家资料。
2. WHEN 系统管理员进入管理员资料页 THEN 系统 SHALL 支持创建、编辑、下架剧本资料。
3. WHEN 店家或剧本状态为 `inactive` THEN 该资料 SHALL 不出现在车头可选列表中。
4. WHEN 车头找不到店家或剧本 THEN 系统 SHALL 允许车头提交新增资料申请。
5. WHEN 系统管理员审核新增资料申请 THEN 系统 SHALL 支持通过或驳回；驳回 SHALL 记录原因。
6. WHEN 管理员通过新增资料申请 THEN 系统 SHALL 创建正式店家或剧本资料，并保留申请来源。

### Requirement 4: 车头建车

**User Story:** 作为车头，我希望选择剧本、店家、时间、DM/NPC和座位补贴规则，以便快速组织一辆情感本车。

#### Acceptance Criteria

1. WHEN 车头创建车 THEN 系统 SHALL 要求选择已激活的剧本和店家。
2. WHEN 车头创建车 THEN 系统 SHALL 支持填写开始时间、预计时长、人数、车价、押金说明和报名说明。
3. WHEN 车头需要指定DM/NPC THEN 系统 SHALL 支持填写本车快照，包括名称、角色、是否爱D或重点NPC、可选绑定用户。
4. WHEN 车头保存草稿 THEN 系统 SHALL 允许车处于 `draft` 状态。
5. WHEN 车头发布车 THEN 系统 SHALL 校验座位、价格、补贴、联系方式和合规文案。

### Requirement 5: 座位与补贴规则

**User Story:** 作为车头，我希望用座位级补贴配置替代群里手算，以便公平地表达恋陪位、F4位、CP位等不同体验的价格差。

#### Acceptance Criteria

1. WHEN 车头配置座位 THEN 系统 SHALL 支持座位名、座位类型、角色标签、原价、补贴调整和实付价。
2. WHEN 座位需要吃补 THEN 系统 SHALL 使用负向补贴调整降低该座位实付价。
3. WHEN 座位需要出补 THEN 系统 SHALL 使用正向补贴调整提高该座位实付价。
4. WHEN 系统计算座位实付价 THEN SHALL 使用公式 `payablePrice = basePrice + adjustment`。
5. WHEN 车发布前 THEN 系统 SHALL 校验 `sum(all seat adjustment) = 0`。
6. WHEN 任一座位 `payablePrice < 0` THEN 系统 SHALL 阻止发布。
7. WHEN 展示补贴 THEN 系统 SHALL 将其描述为座位价格调整，不得描述为平台现金红包、返现或提现。

### Requirement 6: 玩家申请上车

**User Story:** 作为玩家，我希望从分享页看懂车况、座位体验和实付价格，以便选择合适座位申请上车。

#### Acceptance Criteria

1. WHEN 玩家打开分享页 THEN 系统 SHALL 展示剧本、店家、时间、座位、实付价、押金说明和报名状态。
2. WHEN 玩家未登录且点击申请 THEN 系统 SHALL 引导微信登录。
3. WHEN 玩家选择座位申请 THEN 系统 SHALL 要求填写报名信息和联系方式。
4. WHEN 玩家提交申请 THEN 系统 SHALL 创建 `pending` 报名记录。
5. WHEN 座位已锁定或车已取消 THEN 系统 SHALL 阻止新的报名申请。
6. WHEN 玩家查看自己报名 THEN 系统 SHALL 展示审核状态、座位和押金状态。

### Requirement 7: 车头审核与锁座

**User Story:** 作为车头，我希望集中处理报名、锁座和押金状态，以便替代微信群里的人工统计。

#### Acceptance Criteria

1. WHEN 车头进入管理页 THEN 系统 SHALL 展示本车所有座位和报名申请。
2. WHEN 车头通过某个报名 THEN 系统 SHALL 在同一事务里更新报名状态和座位确认人。
3. WHEN 一个座位已有最终通过玩家 THEN 系统 SHALL 阻止其他玩家再次成为该座位最终通过人。
4. WHEN 车头拒绝报名 THEN 系统 SHALL 保留拒绝记录。
5. WHEN 车头锁座 THEN 系统 SHALL 将座位状态更新为 `locked`，并可将整车状态更新为 `locked`。
6. WHEN 车头记录押金 THEN 系统 SHALL 支持 `unpaid`、`pending_confirm`、`confirmed`、`refunded` 状态。

### Requirement 8: 分享与基础增长

**User Story:** 作为车头，我希望方便地把车分享到朋友圈、微信群或单个玩家，以便更快拼齐人。

#### Acceptance Criteria

1. WHEN 车处于 `recruiting` 状态 THEN 系统 SHALL 支持微信分享卡片。
2. WHEN 车头需要发群 THEN 系统 SHALL 支持复制招募文案。
3. WHEN 车头需要发图 THEN 系统 SHALL 支持生成或展示简单海报。
4. WHEN 分享页被访问 THEN 系统 SHALL 记录分享来源、访问时间、车ID和可用的场景参数。
5. WHEN 玩家从分享页提交申请 THEN 系统 SHALL 记录申请转化来源。
6. WHEN 用户分享或邀请 THEN 系统 SHALL NOT 提供现金、红包、提现、返现、订阅奖励或强制诱导分享。

### Requirement 9: 微信小程序合规边界

**User Story:** 作为平台，我希望MVP避开微信规则高风险点，以便可以提交审核并降低封禁风险。

#### Acceptance Criteria

1. WHEN 系统展示补贴 THEN SHALL 避免使用平台发红包、现金奖励、提现、返现等表达。
2. WHEN 系统展示DM/NPC或恋陪相关内容 THEN SHALL 表述为剧本角色互动、演绎体验、NPC互动，不得承诺现实陪伴或线下陪伴服务。
3. WHEN 分享页对外公开 THEN 系统 SHALL NOT 公开手机号、微信号、真实姓名等敏感联系方式。
4. WHEN 用户填写联系方式 THEN 系统 SHALL 仅向有权限的车头展示，管理员原则上只在排查时查看。
5. WHEN 车被取消、下架或发现违规 THEN 系统 SHALL 阻止继续报名并允许管理员处理。
6. WHEN MVP实现支付相关能力 THEN SHALL 判定为越界；MVP SHALL NOT 接入微信支付、分账、提现或自动返补。

### Requirement 10: D0交付物

**User Story:** 作为开发团队，我希望D0有可检查的交付物，以便明确是否可以进入D1。

#### Acceptance Criteria

1. WHEN D0完成 THEN SHALL 产出MVP需求清单。
2. WHEN D0完成 THEN SHALL 产出页面列表。
3. WHEN D0完成 THEN SHALL 产出角色与权限说明。
4. WHEN D0完成 THEN SHALL 产出核心状态机。
5. WHEN D0完成 THEN SHALL 产出管理员录入字段清单。
6. WHEN D0完成 THEN SHALL 产出API清单草案。
7. WHEN D0完成 THEN SHALL 产出微信合规冻结规则。
