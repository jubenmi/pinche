# D33 Design: 用户私有资料与审核公开设计

更新日期：2026-07-08

## Overview

D33 将现有“缺资料申请”升级为“用户私有资料”。用户在建车选店或选剧本时找不到资料，可以创建 private store 或 private script；创建者立即可用，其他用户不可见。管理员在待审核资料中补全、修改并批准后，资料变为 public approved active，进入公共搜索。

设计保留现有 `stores`、`scripts`、`store_scripts` 和车局快照模型，不引入独立资料申请状态机。现有 `catalog_requests` 可作为历史申请保留，但新建车缺资料主链路写入真实资料表。

## Data Model

### `stores` 和 `scripts` 审核字段

新增迁移给 `stores` 和 `scripts` 增加相同字段：

```sql
ALTER TABLE stores
  ADD COLUMN visibility VARCHAR(32) NOT NULL DEFAULT 'public',
  ADD COLUMN review_status VARCHAR(32) NOT NULL DEFAULT 'approved',
  ADD COLUMN created_by_user_id BIGINT UNSIGNED NULL,
  ADD COLUMN reviewed_by_admin_user_id BIGINT UNSIGNED NULL,
  ADD COLUMN review_note TEXT NULL,
  ADD COLUMN reviewed_at DATETIME NULL,
  ADD COLUMN merged_into_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_stores_visibility_review (visibility, review_status, status),
  ADD INDEX idx_stores_created_by_review (created_by_user_id, review_status);

ALTER TABLE scripts
  ADD COLUMN visibility VARCHAR(32) NOT NULL DEFAULT 'public',
  ADD COLUMN review_status VARCHAR(32) NOT NULL DEFAULT 'approved',
  ADD COLUMN created_by_user_id BIGINT UNSIGNED NULL,
  ADD COLUMN reviewed_by_admin_user_id BIGINT UNSIGNED NULL,
  ADD COLUMN review_note TEXT NULL,
  ADD COLUMN reviewed_at DATETIME NULL,
  ADD COLUMN merged_into_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_scripts_visibility_review (visibility, review_status, status),
  ADD INDEX idx_scripts_created_by_review (created_by_user_id, review_status);
```

合法值：

- `visibility`: `public`、`private`
- `review_status`: `pending`、`needs_changes`、`approved`、`rejected`、`merged`
- `status`: 沿用 `active`、`inactive`

旧数据迁移后默认是公共已批准资料：

```text
visibility = public
review_status = approved
status = existing status
```

### 可用性规则

公共可用于搜索和建车：

```text
visibility = public
review_status = approved
status = active
```

私有可用于创建者搜索和建车：

```text
visibility = private
created_by_user_id = currentUser.id
review_status IN (pending, needs_changes)
status = active
```

不可用于新建车：

```text
review_status IN (rejected, merged)
OR status = inactive
```

## Backend Design

### 归一化和校验

在 `apps/api/src/modules/core/service.js` 增加内部 helper：

```text
normalizeCatalogVisibility(value)
normalizeCatalogReviewStatus(value)
isPublicCatalogUsable(row)
isPrivateCatalogUsableByUser(row, user)
assertCatalogUsableForSession(row, user, label)
catalogBadge(row)
```

校验规则：

- 普通用户只能创建 `visibility = private` 的资料。
- 管理员仍通过现有 `/api/admin/stores` 和 `/api/admin/scripts` 创建公共资料。
- 用户输入名称、简介、备注、角色名和 NPC 描述时复用 `assertPublicTextSafe`。
- 普通用户访问他人私有资料时返回 404 或泛化错误，不返回资料内容。

### 用户端列表

现有 `GET /api/stores` 和 `GET /api/scripts` 需要能感知可选登录用户。匿名请求只返回公共可用资料；登录请求额外混入自己的可用私有资料。

`GET /api/stores` 查询规则：

```text
WHERE public usable
OR (
  private usable
  AND created_by_user_id = currentUser.id
)
```

`GET /api/scripts` 不带 `storeId` 时使用同样规则。

`GET /api/scripts?storeId=` 带店家上下文时：

- 如果 `storeId` 是公共可用店家，返回该店已通过 `store_scripts` 关联的公共可用剧本，再追加当前用户自己的可用私有剧本。
- 如果 `storeId` 是当前用户自己的可用私有店家，返回公共可用剧本和当前用户自己的可用私有剧本。
- 如果 `storeId` 是他人私有店家、已拒绝资料或已合并资料，返回 404 或空列表。

响应中为私有资料增加前端可用字段：

```json
{
  "visibility": "private",
  "review_status": "pending",
  "catalog_badge": "仅自己可用"
}
```

### 用户创建私有资料接口

新增路由：

| Method | Path | 权限 | 行为 |
| --- | --- | --- | --- |
| `POST` | `/api/stores` | auth | 创建当前用户私有店家 |
| `POST` | `/api/scripts` | auth | 创建当前用户私有剧本 |
| `GET` | `/api/catalog-review-items/mine` | auth | 查看我提交的资料 |
| `PATCH` | `/api/catalog-review-items/:type/:id` | auth | 编辑自己的 needs_changes 资料并重新提交 |

`POST /api/stores` 写入：

```text
name = required
city = required
district/address/contact_note = optional
visibility = private
review_status = pending
status = active
created_by_user_id = currentUser.id
```

`POST /api/scripts` 写入：

```text
name = required
player_count = required positive integer
type_tags/summary_no_spoiler = optional
default_seat_template_json = provided template or generated role template
visibility = private
review_status = pending
status = active
created_by_user_id = currentUser.id
```

默认角色模板生成：

```json
[
  { "name": "角色1", "description": "", "roleGender": "unlimited" },
  { "name": "角色2", "description": "", "roleGender": "unlimited" }
]
```

数量等于 `playerCount`，最小为 1，最大遵守现有或新增的合理上限。

### 创建车局校验

`createSession` 当前通过 `findById` 取店家和剧本并检查 `status = active`。D33 改为：

1. 加载店家和剧本。
2. 对每条资料调用 `assertCatalogUsableForSession(row, user, label)`。
3. 公共资料必须是 public approved active。
4. 私有资料必须属于当前用户，且 pending 或 needs_changes。
5. rejected、merged、inactive 资料返回 400。
6. 创建车局继续写入 `script_name_snapshot` 和 `store_name_snapshot`。

审核变化不回写已有车局。历史车局通过已有快照保持稳定。

### 管理员审核接口

新增路由：

| Method | Path | 权限 | 行为 |
| --- | --- | --- | --- |
| `GET` | `/api/admin/catalog-review-items` | `system_admin` | 待审核资料列表 |
| `PATCH` | `/api/admin/catalog-review-items/:type/:id` | `system_admin` | 编辑待审核资料 |
| `POST` | `/api/admin/catalog-review-items/:type/:id/approve` | `system_admin` | 批准公开 |
| `POST` | `/api/admin/catalog-review-items/:type/:id/needs-changes` | `system_admin` | 要求补充 |
| `POST` | `/api/admin/catalog-review-items/:type/:id/reject` | `system_admin` | 拒绝 |
| `POST` | `/api/admin/catalog-review-items/:type/:id/merge` | `system_admin` | 合并到公共资料 |

`:type` 只接受 `store` 或 `script`。

列表字段：

```json
{
  "type": "script",
  "id": 123,
  "name": "长夜将尽",
  "review_status": "pending",
  "created_by_user_id": 456,
  "created_by_user_name": "用户昵称",
  "session_count": 2,
  "created_at": "2026-07-08T12:00:00.000Z"
}
```

批准流程：

- 在事务中锁定资料行。
- 校验资料仍是 private 且 review_status 为 pending 或 needs_changes。
- 允许先应用请求中的编辑字段。
- 更新 `visibility = public`、`review_status = approved`、`status = active`。
- 写入审核人、审核备注和审核时间。
- 如果批准剧本时传入 `storeIds` 或 `storeScriptLinks`，同步写入 `store_scripts`。

要求补充流程：

- 更新 `review_status = needs_changes`。
- 保存 `review_note`。
- 保持 `visibility = private` 和 `status = active`。

拒绝流程：

- 更新 `review_status = rejected`。
- 更新 `status = inactive`。
- 保存 `review_note`、审核人和审核时间。

合并流程：

- 校验目标资料存在、同类型、public approved active。
- 当前资料更新为 `review_status = merged`、`status = inactive`、`merged_into_id = targetId`。
- 已有车局不改写快照。

## Mini Program Design

### 选店页

修改 `apps/miniprogram/src/pages/session/create.vue`：

- 保留现有搜索和选择列表。
- 空列表时展示 `添加给自己用`。
- 列表非空时底部展示 `没有找到？添加一个店家`。
- 表单字段：名称、城市、区域、地址、备注。
- 创建成功后将新店家写入 `writeCreateFlow({ store, script: null, role: null })`。
- 新店家置顶并展示 `仅自己可用 · 待审核`。

### 选剧本页

修改 `apps/miniprogram/src/pages/session/script.vue`：

- 保留当前店家上下文加载剧本的逻辑。
- 空列表时展示 `添加给自己用`。
- 列表非空时底部展示 `没有找到？添加一个剧本`。
- 表单字段：名称、人数、标签、简介。
- 创建成功后写入 `writeCreateFlow({ script, role: null })`。
- 新剧本置顶并展示 `仅自己可用 · 待审核`。

### 我的资料提交

可以在 `apps/miniprogram/src/pages/mine/index.vue` 增加入口，第一阶段可作为轻量列表页面或折叠区：

- 待审核：展示 `待审核`。
- 需要补充：展示审核备注和编辑入口。
- 已公开：展示 `已公开`。
- 未通过：展示审核备注。
- 已合并：展示目标公共资料名称。

## Admin Design

### 小程序管理员页

`apps/miniprogram/src/pages/admin/catalog.vue` 当前有“申请”tab。D33 将它升级为“待审核资料”：

- 调用 `/api/admin/catalog-review-items`。
- 展示店家和剧本两种类型。
- 保留通过和拒绝。
- 增加需要补充和合并。
- 通过前允许管理员补充关键字段。

### Web 后台

`apps/admin-web/src/components/CatalogWorkspace.vue` 新增 `待审核` tab。该 tab 横跨店家和剧本，避免管理员在两个资料 tab 之间来回过滤。

抽屉复用：

- 店家审核复用 `StoreDrawer` 字段。
- 剧本审核复用 `ScriptDrawer` 字段。
- 审核动作固定在抽屉底部：`批准公开`、`合并`、`需要补充`、`拒绝`。

`apps/admin-web/src/api.js` 增加审核相关 API wrapper。

## Error Handling

- 未登录创建资料：401。
- 名称为空：400。
- 城市为空的店家：400。
- 剧本人数不是正整数：400。
- 普通用户访问他人私有资料：404。
- 使用 rejected、merged 或 inactive 资料建车：400，提示重新选择资料。
- 管理员合并到不存在、非公共或不同类型资料：400。
- 管理员批准剧本时角色模板不合法：400，前端保持抽屉内容。
- 私有资料包含既有公开文本风险词：400，提示移除风险内容。

## Testing Strategy

后端新增 `scripts/d33-private-catalog-review-check.js`，覆盖：

- 用户创建 private store 后自己可见、他人不可见。
- 用户创建 private script 后自己可见、他人不可见。
- 创建者可用 private store/script 创建车局。
- 其他用户不可用 private store/script 创建车局。
- 管理员可列出 pending private 资料。
- 管理员批准后资料进入公共列表。
- 管理员拒绝后资料不能新建车局。
- 管理员合并后被合并资料不再作为可选项返回。

扩展 `scripts/check-miniprogram.js`：

- 店家选择页包含 `添加给自己用`。
- 剧本选择页包含 `添加给自己用`。
- 私有资料展示 `仅自己可用`。
- 创建私有资料入口不要求管理员身份。

扩展 `scripts/d12-admin-web-check.js`：

- Web 后台存在 `待审核` tab。
- API wrapper 包含 approve、reject、needs changes、merge。
- 待审核抽屉复用店家和剧本编辑能力。

验证命令：

```bash
npm run check
npm run build:mp-weixin
node scripts/d33-private-catalog-review-check.js
```

## Scope Notes

- D33 不删除 `catalog_requests`，但建车缺资料入口改为创建 private store/script。
- D33 不实现自动去重，只提供管理员手动合并。
- D33 不新增普通用户公共资料编辑权。资料公开后由管理员维护，用户后续修正建议另行设计。
- D33 不把审核状态显示到车局分享页或报名页。
