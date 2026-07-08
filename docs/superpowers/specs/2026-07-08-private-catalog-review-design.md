# Private Catalog Review Design

更新日期：2026-07-08

## 背景

当前建车流程要求车头先选择已经上架的店家和剧本。公共列表只返回 `status = active` 的 `stores` 和 `scripts`，创建车局时后端也要求店家和剧本都是 active。系统已有 `catalog_requests`：用户可以提交缺资料申请，管理员审核后才创建公共资料。

这个模型能保护公共数据，但会阻塞真实建车：用户想拼车时，如果店家或剧本不存在，只能等管理员处理。新的产品目标是让用户可以先补录店家或剧本并立即用于自己的拼车，同时保证未经验证的数据不会进入公共数据池。

## 目标

1. 用户在选店或选剧本时找不到数据，可以创建一条仅自己可用的店家或剧本。
2. 私有资料创建后立即出现在创建者自己的选择列表中，并可继续完成建车。
3. 未审核资料不进入公共列表，其他用户不能在建车搜索中选择。
4. 管理员可以看到用户提交的未审核店家和剧本，编辑、补全、关联、批准、合并、要求补充或拒绝。
5. 管理员批准后，资料变成公共 active 数据，所有用户可搜索和使用。
6. 已创建车局继续使用创建时快照；审核流不破坏历史车局。

## 非目标

- 不让普通用户直接创建公共资料。
- 不实现复杂商家认领、资料所有权转移或多人协作维护。
- 不新增剧本发行方、版权、库存、排期等更大资料体系。
- 不重做完整建车流程和角色选择体验，只在缺资料路径中补齐能力。
- 不在分享页或报名页向玩家暴露“该资料未审核”的标签，避免无关信任噪音。

## 已确认方案

采用方案 B：私有资料优先，审核后公开。

用户创建的是一条真实资料，而不是纯申请单。资料带有可见性和审核状态：创建者可立即使用，管理员可审核，公共列表在批准前不可见。相比只提交申请，这个方案不阻塞建车；相比车局内自由手填，它能沉淀可复用资料并支持管理员后续整理。

## 产品原则

- 建车优先：补录资料不能把用户拦在流程外。
- 公共数据干净：未经验证的店家和剧本只能创建者自己使用。
- 审核可修正：管理员批准前可以补字段、改错字、补角色、建店剧关联。
- 状态可解释：用户端看到“仅自己可用 / 待审核”，管理员端看到审核进度和处理动作。
- 历史不漂移：车局继续依赖 `*_name_snapshot` 等快照字段，审核后的资料变化不改写历史车局展示。

## 数据模型

### 推荐字段

在 `stores` 和 `scripts` 增加相同的资料治理字段：

```sql
ALTER TABLE stores
  ADD COLUMN visibility VARCHAR(32) NOT NULL DEFAULT 'public',
  ADD COLUMN review_status VARCHAR(32) NOT NULL DEFAULT 'approved',
  ADD COLUMN created_by_user_id BIGINT UNSIGNED NULL,
  ADD COLUMN reviewed_by_admin_user_id BIGINT UNSIGNED NULL,
  ADD COLUMN review_note TEXT NULL,
  ADD COLUMN reviewed_at DATETIME NULL,
  ADD COLUMN merged_into_id BIGINT UNSIGNED NULL;

ALTER TABLE scripts
  ADD COLUMN visibility VARCHAR(32) NOT NULL DEFAULT 'public',
  ADD COLUMN review_status VARCHAR(32) NOT NULL DEFAULT 'approved',
  ADD COLUMN created_by_user_id BIGINT UNSIGNED NULL,
  ADD COLUMN reviewed_by_admin_user_id BIGINT UNSIGNED NULL,
  ADD COLUMN review_note TEXT NULL,
  ADD COLUMN reviewed_at DATETIME NULL,
  ADD COLUMN merged_into_id BIGINT UNSIGNED NULL;
```

字段语义：

- `visibility`: `public` 或 `private`。公共资料所有用户可见；私有资料只对 `created_by_user_id` 和管理员可见。
- `review_status`: `pending`、`needs_changes`、`approved`、`rejected`、`merged`。
- `created_by_user_id`: 普通用户补录资料的创建者。管理员创建公共资料时可以为空，或写管理员用户 id。
- `reviewed_by_admin_user_id`: 最后一次审核动作的管理员。
- `review_note`: 给用户或管理员看的审核备注。
- `merged_into_id`: 重复资料被合并时指向保留的公共资料。

现有 `status` 继续表达上下架：`active` / `inactive`。第一版规则是：

- 公共可用：`visibility = 'public' AND review_status = 'approved' AND status = 'active'`
- 用户私有可用：`visibility = 'private' AND created_by_user_id = currentUser.id AND review_status IN ('pending', 'needs_changes') AND status = 'active'`
- 拒绝后不可用于新建车：`review_status = 'rejected'` 或 `status = 'inactive'`

### 兼容现有申请表

`catalog_requests` 已经存在。实现时可以选择两种兼容策略：

1. 保留 `catalog_requests` 作为旧申请历史，只让新能力写入 `stores` / `scripts` 主表。
2. 新建私有资料时同步创建一条 `catalog_requests` 记录，用于兼容旧管理员小程序申请 tab。

推荐第一版直接让审核围绕主表资料进行，避免“申请单”和“真实私有资料”双写后状态不一致。旧的 `catalog_requests` 入口可以保留，但用户建车缺资料入口应改为创建私有资料。

## 后端设计

### 用户端列表

`GET /api/stores` 在登录状态下返回：

- 公共 approved active 店家。
- 当前用户自己创建、仍可用的 private 店家。

未登录时只返回公共 approved active 店家。

私有店家在响应中增加轻量标记：

```json
{
  "id": 123,
  "name": "谜雾剧场（望京店）",
  "visibility": "private",
  "review_status": "pending",
  "catalog_badge": "仅自己可用"
}
```

`GET /api/scripts` 规则相同。带 `storeId` 时：

- 公共店家：返回该店已关联的公共 approved active 剧本，加上当前用户自己的 private 剧本。
- 私有店家：返回当前用户自己的 private 剧本，以及用户主动选择创建车时可用的公共 approved active 剧本。
- 如果 private 剧本和 private 店家同时被选中，允许继续建车；管理员审核后再决定是否建立公共 `store_scripts` 关联。

### 用户创建私有资料

新增用户端接口：

| Method | Path | 权限 | 行为 |
| --- | --- | --- | --- |
| `POST` | `/api/stores` | auth | 创建当前用户私有店家 |
| `POST` | `/api/scripts` | auth | 创建当前用户私有剧本 |
| `GET` | `/api/catalog-review-items/mine` | auth | 查看我提交的资料审核状态 |

店家创建最小请求：

```json
{
  "name": "谜雾剧场（望京店）",
  "city": "北京",
  "district": "朝阳",
  "address": "望京 SOHO 附近",
  "contactNote": "用户补录，待管理员核验"
}
```

剧本创建最小请求：

```json
{
  "name": "长夜将尽",
  "playerCount": 6,
  "typeTags": ["推理", "现代"],
  "summaryNoSpoiler": "用户补录，待管理员核验"
}
```

后端写入规则：

- `visibility = 'private'`
- `review_status = 'pending'`
- `status = 'active'`
- `created_by_user_id = currentUser.id`
- 剧本没有角色模板时，按 `playerCount` 自动生成 `角色1...角色N`，性别默认 `unlimited`。
- 所有用户输入沿用现有公开文本风险词检查，避免未审核资料通过车局分享扩散违规文本。

### 创建车局校验

`createSession` 当前只允许 active 店家和 active 剧本。新规则：

- 公共资料必须满足 public approved active。
- 私有资料必须满足 private active，创建者是当前用户，且 `review_status IN ('pending', 'needs_changes')`。
- 私有资料只能被创建者用来新建车局。
- `review_status = 'rejected'` 或 `merged` 的资料不能用于新建车局。
- 已有车局不因后续拒绝或合并被删除，继续使用快照字段展示。

### 管理员审核

新增或扩展管理端接口：

| Method | Path | 权限 | 行为 |
| --- | --- | --- | --- |
| `GET` | `/api/admin/catalog-review-items` | `system_admin` | 查看待审核资料，支持类型、状态、关键词过滤 |
| `PATCH` | `/api/admin/catalog-review-items/:type/:id` | `system_admin` | 编辑待审核资料字段 |
| `POST` | `/api/admin/catalog-review-items/:type/:id/approve` | `system_admin` | 批准为公共资料 |
| `POST` | `/api/admin/catalog-review-items/:type/:id/merge` | `system_admin` | 合并到已有公共资料 |
| `POST` | `/api/admin/catalog-review-items/:type/:id/needs-changes` | `system_admin` | 要求用户补充 |
| `POST` | `/api/admin/catalog-review-items/:type/:id/reject` | `system_admin` | 拒绝公开并禁止继续新建车使用 |

批准规则：

- 更新为 `visibility = 'public'`。
- 更新为 `review_status = 'approved'`。
- 保持 `status = 'active'`。
- 写入 `reviewed_by_admin_user_id` 和 `reviewed_at`。
- 管理员可以在批准前或批准请求中补全店家地址、剧本标签、角色模板。
- 如果审核的是剧本，并且请求提供 `storeIds` 或 `storeScriptLinks`，同步写入 `store_scripts`。

合并规则：

- 只允许合并到同类型公共 approved 资料。
- 当前私有资料更新为 `review_status = 'merged'`、`status = 'inactive'`、`merged_into_id = targetId`。
- 后续用户列表不再展示被合并资料，展示目标公共资料。
- 已有车局仍保留原快照，不批量改写历史。

拒绝规则：

- 更新为 `review_status = 'rejected'`、`status = 'inactive'`。
- 保留记录供管理员追溯。
- 用户不能再用该资料新建车局。
- 已经创建的车局继续存在，管理员如发现风险内容可走现有车局管理/删除能力处理。

## 小程序设计

### 选店页

在 `pages/session/create.vue` 中保留现有搜索列表。新增两个入口：

- 列表为空时显示空状态按钮：`添加给自己用`。
- 搜索有结果时，在列表底部提供弱入口：`没有找到？添加一个店家`。

表单建议使用底部弹层或新页面，字段保持轻量：

- 店家名称，必填。
- 城市，默认当前已有默认城市或北京，必填。
- 区域，选填。
- 地址，选填。
- 备注，选填。

提交成功后：

- 把新店家写入 create flow。
- 回到店家列表并置顶展示。
- 行内展示标签：`仅自己可用 · 待审核`。
- 用户可以继续点 `下一步`。

### 选剧本页

在 `pages/session/script.vue` 中新增同样的空状态和底部入口：

- `添加给自己用`
- `没有找到？添加一个剧本`

表单字段：

- 剧本名称，必填。
- 玩家人数，必填，默认 6。
- 标签，选填。
- 无剧透简介，选填。

提交成功后：

- 生成默认角色模板。
- 把新剧本写入 create flow。
- 列表置顶展示 `仅自己可用 · 待审核`。
- 用户继续进入角色选择。

### 我的提交

可以在“我的”页增加轻量入口：`我的资料提交`。第一版不是主链路必需，但建议提供，避免用户不知道审核结果。

列表展示：

- 资料类型。
- 名称。
- 状态：待审核、需要补充、已公开、未通过、已合并。
- 审核备注。

如果状态是 `needs_changes`，用户可以编辑自己的私有资料后重新提交为 `pending`。

## 管理端设计

### 小程序管理员页

现有 `pages/admin/catalog.vue` 已有“申请”tab。第一版可以将其升级为“待审核资料”：

- 列表不再只读 `catalog_requests`，而是读取 private/pending 的 `stores` 和 `scripts`。
- 卡片显示类型、名称、城市/人数、提交人、创建时间、使用车局数。
- 操作保留“通过/拒绝”，增加“需要补充”和“合并”。

### Web 后台

`CatalogWorkspace.vue` 当前有店家、剧本、车局 tab。新增 `待审核` tab，或在店家/剧本 tab 中增加状态过滤 `待审核`。推荐新增独立 tab，原因是审核任务横跨两种资料类型，管理员处理心智更清楚。

待审核表格列：

- 类型。
- 名称。
- 城市或人数。
- 提交人。
- 使用车局数。
- 审核状态。
- 创建时间。
- 操作。

点击行打开编辑抽屉：

- 店家字段复用 `StoreDrawer`。
- 剧本字段复用 `ScriptDrawer`。
- 剧本审核抽屉中可以维护角色模板和 NPC 角色。
- 审核动作固定在抽屉底部：批准公开、合并、需要补充、拒绝。

## 错误处理

- 未登录创建私有资料：返回 401，小程序触发登录。
- 名称为空：返回 400，前端提示填写名称。
- 剧本人数不是正整数：返回 400。
- 普通用户访问他人私有资料：返回 404，避免泄漏存在性。
- 使用被拒绝或已合并资料建车：返回 400，并提示“该资料审核未通过，请重新选择”。
- 管理员合并到不存在或非公共资料：返回 400。
- 管理员批准时角色模板 JSON 不合法：返回 400，保留抽屉内容让管理员修正。

## 测试与验收

新增后端检查脚本，例如 `scripts/d32-private-catalog-review-check.js`，覆盖：

- 普通用户创建 private store 后，自己能在 `/api/stores` 看到，其他用户看不到。
- 普通用户创建 private script 后，自己能在 `/api/scripts` 看到，其他用户看不到。
- 创建者可以用自己的 private store/script 创建车局。
- 其他用户不能用该 private store/script 创建车局。
- 管理员能列出 pending private 资料。
- 管理员批准后，资料出现在公共列表。
- 管理员拒绝后，资料不能再用于新建车局。
- 合并后，被合并资料不再出现在创建者列表，目标公共资料可见。

扩展小程序静态检查 `scripts/check-miniprogram.js`：

- 店家选择页包含“添加给自己用”入口。
- 剧本选择页包含“添加给自己用”入口。
- 私有资料行展示 `仅自己可用` 或等价状态标签。
- 创建私有资料入口不要求用户提前成为管理员。

扩展 Web 后台检查 `scripts/d12-admin-web-check.js`：

- 后台存在待审核资料入口。
- 待审核资料支持 approve、reject、needs changes、merge 动作。
- 审核抽屉复用店家/剧本编辑能力。

手动验收主链路：

1. 用户搜索不存在的店家。
2. 用户添加私有店家并继续下一步。
3. 用户搜索不存在的剧本。
4. 用户添加私有剧本并成功创建车局。
5. 另一个用户搜索不到这两个私有资料。
6. 管理员在待审核中补全并批准。
7. 另一个用户刷新后可以搜索到批准后的店家和剧本。

## 分阶段落地

### 第一阶段：最小闭环

- 数据库增加可见性和审核字段。
- 用户可以创建 private store/script。
- 用户自己的列表混入 private 资料。
- `createSession` 支持创建者使用 private 资料。
- 管理员可以批准或拒绝。
- 小程序选店/选剧本页增加最小表单入口。

### 第二阶段：审核效率

- Web 后台新增待审核 tab。
- 管理员可以合并重复资料。
- 管理员可以要求补充，用户可重新提交。
- 审核时维护店剧关联和角色模板。

### 第三阶段：体验完善

- “我的资料提交”展示审核进度。
- 对疑似重复名称做提示。
- 批量审核和批量合并。
- 审核通过后可选订阅消息通知提交者。

## 实现注意事项

- 现有 `created_by_admin_user_id` 不适合作为普通用户创建者字段，应新增 `created_by_user_id`，避免语义混乱。
- 现有公共列表函数 `listActiveStores` / `listActiveScripts` 需要区分匿名、普通用户和管理员上下文。
- 现有 `findById(connection, "stores", id)` 在建车校验中不能继续只看 active，需要额外校验资料可见性和审核状态。
- 管理员硬删除逻辑仍应要求资料先 inactive；pending private 资料如果被拒绝后需要删除，也必须遵守已有历史车局引用保护。
- 私有资料可能被公开文本扩散到车局分享页，所以创建和编辑阶段仍要走 `assertPublicTextSafe`。

## 自审

- 没有空白条目或含糊要求。
- 设计范围聚焦在私有资料创建、建车可用和管理员审核公开。
- 数据状态、可见性、审核动作和历史车局快照规则保持一致。
- 可以进入单一实现计划，按阶段拆任务即可。
