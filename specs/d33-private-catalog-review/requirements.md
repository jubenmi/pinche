# D33 Requirements: 用户私有资料与审核公开

更新日期：2026-07-08

## Introduction

D33 让用户在建车时可以补录缺失的剧本杀店家或剧本，并立即用于自己的拼车。用户补录的资料在审核前只对自己可见，不进入公共资料库；管理员验证、补全、修改并批准后，该资料才变为公共店家或公共剧本，供所有用户搜索和使用。

D33 采用“私有资料优先，审核后公开”的方案。它替代当前“只能提交缺资料申请并等待管理员”的阻塞体验，同时保留公共资料的审核门槛。

## Requirements

### Requirement 1: 用户可创建私有店家

**User Story:** 作为想发起拼车的用户，我希望找不到店家时可以先创建一条自己可用的店家资料，以便继续建车。

#### Acceptance Criteria

1. WHEN 登录用户在选店页找不到店家 THEN 小程序 SHALL 提供“添加给自己用”的入口。
2. WHEN 用户提交私有店家 THEN 系统 SHALL 要求填写店家名称和城市。
3. WHEN 用户提交私有店家且字段合法 THEN 后端 SHALL 创建 `visibility = private`、`review_status = pending`、`status = active` 的店家。
4. WHEN 私有店家创建成功 THEN 响应 SHALL 返回新店家基础字段、`visibility`、`review_status` 和可展示的私有标记。
5. WHEN 创建者重新加载店家列表 THEN 系统 SHALL 返回公共上架店家和该用户自己的可用私有店家。
6. WHEN 其他普通用户加载店家列表 THEN 系统 SHALL NOT 返回该私有店家。
7. WHEN 未登录用户尝试创建私有店家 THEN 后端 SHALL 返回 401。

### Requirement 2: 用户可创建私有剧本

**User Story:** 作为想发起拼车的用户，我希望找不到剧本时可以先创建一条自己可用的剧本资料，以便继续配置车局。

#### Acceptance Criteria

1. WHEN 登录用户在选剧本页找不到剧本 THEN 小程序 SHALL 提供“添加给自己用”的入口。
2. WHEN 用户提交私有剧本 THEN 系统 SHALL 要求填写剧本名称和玩家人数。
3. WHEN 玩家人数不是正整数 THEN 后端 SHALL 返回 400。
4. WHEN 用户提交私有剧本且字段合法 THEN 后端 SHALL 创建 `visibility = private`、`review_status = pending`、`status = active` 的剧本。
5. WHEN 请求没有提供角色模板 THEN 后端 SHALL 按玩家人数生成默认角色模板，角色名为 `角色1` 到 `角色N`，性别为 `unlimited`。
6. WHEN 创建者重新加载剧本列表 THEN 系统 SHALL 返回公共上架剧本和该用户自己的可用私有剧本。
7. WHEN 其他普通用户加载剧本列表 THEN 系统 SHALL NOT 返回该私有剧本。

### Requirement 3: 私有资料可用于创建者建车

**User Story:** 作为创建私有资料的用户，我希望创建后可以马上用它继续建车，而不是等待审核。

#### Acceptance Criteria

1. WHEN 用户选择自己创建的私有店家 THEN 小程序 SHALL 允许进入下一步。
2. WHEN 用户选择自己创建的私有剧本 THEN 小程序 SHALL 允许进入角色和车局设置步骤。
3. WHEN 创建车局使用公共资料 THEN 后端 SHALL 要求资料满足 `visibility = public`、`review_status = approved`、`status = active`。
4. WHEN 创建车局使用私有资料 THEN 后端 SHALL 要求资料满足 `visibility = private`、`created_by_user_id = current user`、`review_status IN (pending, needs_changes)`、`status = active`。
5. WHEN 普通用户使用他人私有店家或剧本创建车局 THEN 后端 SHALL 返回 404 或 403，并 SHALL NOT 泄漏资料详情。
6. WHEN 用户使用被拒绝、已合并或已下架的私有资料创建车局 THEN 后端 SHALL 返回 400。
7. WHEN 车局创建成功 THEN 系统 SHALL 继续写入当前店家和剧本名称快照。

### Requirement 4: 未审核资料不污染公共搜索

**User Story:** 作为平台管理员，我希望未经验证的店家和剧本不被其他用户误用，以保持公共资料库可靠。

#### Acceptance Criteria

1. WHEN 匿名用户请求 `/api/stores` 或 `/api/scripts` THEN 系统 SHALL 只返回公共、已批准、上架资料。
2. WHEN 登录用户请求 `/api/stores` THEN 系统 SHALL 返回公共、已批准、上架店家，以及该用户自己的可用私有店家。
3. WHEN 登录用户请求 `/api/scripts` THEN 系统 SHALL 返回公共、已批准、上架剧本，以及该用户自己的可用私有剧本。
4. WHEN 用户在公共店家上下文请求剧本 THEN 系统 SHALL 返回该店已关联的公共剧本，并可追加当前用户自己的可用私有剧本。
5. WHEN 用户在私有店家上下文请求剧本 THEN 系统 SHALL 允许返回当前用户自己的可用私有剧本和公共可用剧本。
6. WHEN 资料处于 `rejected`、`merged` 或 `inactive` THEN 普通用户列表 SHALL NOT 返回该资料作为可选项。

### Requirement 5: 管理员可审核私有资料

**User Story:** 作为系统管理员，我希望看到用户提交的未审核店家和剧本，并在补全验证后决定是否公开。

#### Acceptance Criteria

1. WHEN 管理员进入待审核资料列表 THEN 系统 SHALL 展示 private/pending 或 private/needs_changes 的店家和剧本。
2. WHEN 管理员查看待审核资料 THEN 列表 SHALL 展示类型、名称、城市或人数、提交人、创建时间、使用车局数和审核状态。
3. WHEN 管理员编辑待审核店家 THEN 系统 SHALL 支持修改名称、城市、区域、地址、联系方式备注和审核备注。
4. WHEN 管理员编辑待审核剧本 THEN 系统 SHALL 支持修改名称、标签、人数、无剧透简介、角色模板、NPC 角色和审核备注。
5. WHEN 普通用户调用管理员审核接口 THEN 后端 SHALL 返回 403。

### Requirement 6: 管理员批准资料后公开

**User Story:** 作为管理员，我希望批准后的资料进入公共库，让所有用户后续都能使用。

#### Acceptance Criteria

1. WHEN 管理员批准待审核店家 THEN 后端 SHALL 将其更新为 `visibility = public`、`review_status = approved`、`status = active`。
2. WHEN 管理员批准待审核剧本 THEN 后端 SHALL 将其更新为 `visibility = public`、`review_status = approved`、`status = active`。
3. WHEN 管理员批准资料 THEN 后端 SHALL 写入 `reviewed_by_admin_user_id` 和 `reviewed_at`。
4. WHEN 管理员批准剧本并提供店家关联 THEN 后端 SHALL 同步写入 `store_scripts`。
5. WHEN 资料批准成功 THEN 所有用户的公共列表 SHALL 可以搜索到该资料。
6. WHEN 资料批准成功 THEN 已有车局 SHALL 继续使用创建时快照，不批量改写历史展示。

### Requirement 7: 管理员可要求补充、拒绝或合并

**User Story:** 作为管理员，我希望能处理资料不完整、错误或重复的情况，而不是只能通过或拒绝。

#### Acceptance Criteria

1. WHEN 管理员要求补充资料 THEN 后端 SHALL 将 `review_status` 更新为 `needs_changes` 并保存 `review_note`。
2. WHEN 资料为 `needs_changes` THEN 创建者 SHALL 仍可在自己的建车流程中使用该资料。
3. WHEN 创建者编辑 `needs_changes` 私有资料并重新提交 THEN 后端 SHALL 将 `review_status` 更新回 `pending`。
4. WHEN 管理员拒绝资料 THEN 后端 SHALL 将 `review_status = rejected` 且 `status = inactive`，并保存审核备注。
5. WHEN 资料被拒绝 THEN 创建者 SHALL NOT 再用该资料新建车局。
6. WHEN 管理员合并资料 THEN 后端 SHALL 只允许合并到同类型、公共、已批准资料。
7. WHEN 私有资料被合并 THEN 后端 SHALL 将其更新为 `review_status = merged`、`status = inactive`、`merged_into_id = targetId`。
8. WHEN 私有资料被合并 THEN 创建者后续列表 SHALL 展示目标公共资料，而不是被合并资料。

### Requirement 8: 用户可查看自己的资料提交状态

**User Story:** 作为提交者，我希望知道自己补录的资料是否待审核、需要补充、已公开、被拒绝或已合并。

#### Acceptance Criteria

1. WHEN 登录用户进入“我的资料提交” THEN 系统 SHALL 展示自己创建的私有资料和审核结果。
2. WHEN 提交记录展示 THEN 页面 SHALL 显示资料类型、名称、审核状态和审核备注。
3. WHEN 资料状态为 `needs_changes` THEN 页面 SHALL 提供编辑并重新提交入口。
4. WHEN 资料状态为 `approved` THEN 页面 SHALL 展示“已公开”。
5. WHEN 资料状态为 `rejected` THEN 页面 SHALL 展示审核备注，且 SHALL NOT 提供继续建车入口。
6. WHEN 资料状态为 `merged` THEN 页面 SHALL 展示合并后的公共资料名称。

### Requirement 9: 内容安全和历史车局边界

**User Story:** 作为平台运营者，我希望私有资料即使还未审核，也不会通过分享页扩散高风险文本或破坏已有车局。

#### Acceptance Criteria

1. WHEN 用户创建或编辑私有资料 THEN 后端 SHALL 复用公开文本风险词检查。
2. WHEN 私有资料包含手机号、微信号、返现、红包、抽奖或其他既有风险词 THEN 后端 SHALL 返回 400。
3. WHEN 私有资料已被用于车局后被拒绝 THEN 已有车局 SHALL 保留，不自动删除。
4. WHEN 私有资料已被用于车局后被合并 THEN 已有车局 SHALL 保留创建时快照，不自动替换为目标资料名称。
5. WHEN 管理员发现已有车局内容存在风险 THEN 系统 SHALL 依赖现有车局管理或强制删除能力处理，不在 D33 中新增自动清理。

### Requirement 10: D33 交付物和验证

**User Story:** 作为开发团队，我希望 D33 有明确 spec 三件套和验收清单，方便后续按边界实现。

#### Acceptance Criteria

1. WHEN D33 spec 完成 THEN SHALL 产出 `requirements.md`。
2. WHEN D33 spec 完成 THEN SHALL 产出 `design.md`。
3. WHEN D33 spec 完成 THEN SHALL 产出 `tasks.md`。
4. WHEN D33 实现完成 THEN SHALL 更新相关静态检查和后端烟测。
5. WHEN D33 实现完成 THEN SHALL 通过 `npm run check`。
6. WHEN D33 实现完成 THEN SHALL 通过 `npm run build:mp-weixin`。
