# D33 Tasks: 用户私有资料与审核公开执行清单

更新日期：2026-07-08

## D33 执行任务

- [x] D33.1 建立 D33 spec 三件套。
  - [x] `requirements.md` 描述用户私有店家/剧本、创建者可用、公共隔离、管理员审核、状态查询、内容安全和验证要求。
  - [x] `design.md` 描述数据模型、后端接口、建车校验、小程序入口、管理员审核、错误处理和测试范围。
  - [x] `tasks.md` 描述后续实现和验收清单。

- [ ] D33.2 新增资料审核数据模型迁移。
  - [ ] 给 `stores` 增加 `visibility`、`review_status`、`created_by_user_id`、`reviewed_by_admin_user_id`、`review_note`、`reviewed_at`、`merged_into_id`。
  - [ ] 给 `scripts` 增加同名审核字段。
  - [ ] 为 `visibility/review_status/status` 和 `created_by_user_id/review_status` 增加查询索引。
  - [ ] 确认旧店家和剧本默认迁移为 `visibility=public`、`review_status=approved`。
  - [ ] 确认迁移不改变现有 `status` 上下架语义。

- [ ] D33.3 新增后端资料可见性 helper。
  - [ ] 新增 `normalizeCatalogVisibility`。
  - [ ] 新增 `normalizeCatalogReviewStatus`。
  - [ ] 新增 `isPublicCatalogUsable`。
  - [ ] 新增 `isPrivateCatalogUsableByUser`。
  - [ ] 新增 `assertCatalogUsableForSession`。
  - [ ] 新增 `catalogBadge`。
  - [ ] 确认 helper 复用现有 `badRequest`、`forbidden`、`notFound` 错误风格。

- [ ] D33.4 实现用户创建私有店家接口。
  - [ ] 新增 `POST /api/stores` 登录路由。
  - [ ] 新增服务函数创建 private store。
  - [ ] 校验名称和城市必填。
  - [ ] 对名称、地址和备注执行公开文本风险词检查。
  - [ ] 写入 `visibility=private`、`review_status=pending`、`status=active`、`created_by_user_id=currentUser.id`。
  - [ ] 响应返回私有标记字段。
  - [ ] 未登录请求返回 401。

- [ ] D33.5 实现用户创建私有剧本接口。
  - [ ] 新增 `POST /api/scripts` 登录路由。
  - [ ] 新增服务函数创建 private script。
  - [ ] 校验名称必填。
  - [ ] 校验 `playerCount` 为正整数。
  - [ ] 对名称、标签、简介和角色模板执行公开文本风险词检查。
  - [ ] 未提供角色模板时按人数生成默认角色模板。
  - [ ] 写入 `visibility=private`、`review_status=pending`、`status=active`、`created_by_user_id=currentUser.id`。
  - [ ] 响应返回私有标记字段和角色模板。

- [ ] D33.6 改造用户端店家和剧本列表。
  - [ ] `GET /api/stores` 匿名请求只返回 public approved active。
  - [ ] `GET /api/stores` 登录请求追加当前用户自己的 pending/needs_changes private active 店家。
  - [ ] `GET /api/scripts` 匿名请求只返回 public approved active。
  - [ ] `GET /api/scripts` 登录请求追加当前用户自己的 pending/needs_changes private active 剧本。
  - [ ] `GET /api/scripts?storeId=` 在公共店家上下文返回已关联公共剧本并追加当前用户自己的私有剧本。
  - [ ] `GET /api/scripts?storeId=` 在当前用户私有店家上下文允许返回公共剧本和当前用户自己的私有剧本。
  - [ ] 他人私有店家上下文返回 404 或空结果，不泄漏资料详情。

- [ ] D33.7 改造创建车局资料校验。
  - [ ] 修改 `createSession` 店家校验为 public approved active 或当前用户 private pending/needs_changes active。
  - [ ] 修改 `createSession` 剧本校验为 public approved active 或当前用户 private pending/needs_changes active。
  - [ ] 使用 rejected、merged 或 inactive 资料时返回 400。
  - [ ] 其他用户使用私有资料时返回 404 或 403。
  - [ ] 保持 `script_name_snapshot` 和 `store_name_snapshot` 写入逻辑不变。
  - [ ] 确认历史车局不因审核状态变化被改写。

- [ ] D33.8 实现我的资料提交接口。
  - [ ] 新增 `GET /api/catalog-review-items/mine`。
  - [ ] 返回当前用户创建的 private 资料和审核结果。
  - [ ] 返回类型、名称、审核状态、审核备注、合并目标。
  - [ ] 新增 `PATCH /api/catalog-review-items/:type/:id` 允许创建者编辑 needs_changes 资料。
  - [ ] 创建者重新提交后将 `review_status` 改回 `pending`。
  - [ ] 不允许用户编辑 approved、rejected 或 merged 资料。

- [ ] D33.9 实现管理员待审核资料接口。
  - [ ] 新增 `GET /api/admin/catalog-review-items`。
  - [ ] 支持按类型、状态、关键词过滤。
  - [ ] 返回提交人、创建时间和使用车局数。
  - [ ] 新增 `PATCH /api/admin/catalog-review-items/:type/:id` 编辑待审核资料字段。
  - [ ] 管理员编辑继续执行公开文本风险词检查。
  - [ ] 普通用户访问管理员接口返回 403。

- [ ] D33.10 实现管理员审核动作。
  - [ ] 新增 approve 动作，将资料更新为 public approved active。
  - [ ] approve 写入审核人、审核备注和审核时间。
  - [ ] approve 剧本时支持同步 `store_scripts`。
  - [ ] 新增 needs-changes 动作，保存审核备注并保持 private active。
  - [ ] 新增 reject 动作，将资料更新为 rejected inactive。
  - [ ] 新增 merge 动作，只允许合并到同类型 public approved active 资料。
  - [ ] merge 写入 `merged_into_id` 并将原资料置为 inactive。
  - [ ] 所有审核动作使用事务锁定资料行。

- [ ] D33.11 改造小程序选店页。
  - [ ] `pages/session/create.vue` 增加空状态 `添加给自己用`。
  - [ ] 列表底部增加 `没有找到？添加一个店家`。
  - [ ] 增加私有店家表单：名称、城市、区域、地址、备注。
  - [ ] 提交表单调用 `POST /api/stores`。
  - [ ] 创建成功后置顶新店家。
  - [ ] 新店家展示 `仅自己可用 · 待审核`。
  - [ ] 创建成功后写入 create flow 并允许继续下一步。

- [ ] D33.12 改造小程序选剧本页。
  - [ ] `pages/session/script.vue` 增加空状态 `添加给自己用`。
  - [ ] 列表底部增加 `没有找到？添加一个剧本`。
  - [ ] 增加私有剧本表单：名称、人数、标签、简介。
  - [ ] 提交表单调用 `POST /api/scripts`。
  - [ ] 创建成功后置顶新剧本。
  - [ ] 新剧本展示 `仅自己可用 · 待审核`。
  - [ ] 创建成功后写入 create flow 并允许进入角色选择。

- [ ] D33.13 增加我的资料提交入口。
  - [ ] 在 `pages/mine/index.vue` 增加“我的资料提交”入口或区块。
  - [ ] 加载 `/api/catalog-review-items/mine`。
  - [ ] 展示待审核、需要补充、已公开、未通过、已合并状态。
  - [ ] 展示审核备注。
  - [ ] needs_changes 状态支持编辑并重新提交。

- [ ] D33.14 改造小程序管理员资料页。
  - [ ] 将 `pages/admin/catalog.vue` 的申请 tab 升级为待审核资料。
  - [ ] 列表调用 `/api/admin/catalog-review-items`。
  - [ ] 展示类型、名称、城市或人数、提交人、创建时间、使用车局数和状态。
  - [ ] 支持批准公开。
  - [ ] 支持需要补充。
  - [ ] 支持拒绝。
  - [ ] 支持合并到已有公共资料。

- [ ] D33.15 改造 Web 后台待审核资料。
  - [ ] `CatalogWorkspace.vue` 新增 `待审核` tab。
  - [ ] `api.js` 新增待审核资料列表、编辑、approve、needs changes、reject、merge wrapper。
  - [ ] 待审核表格展示类型、名称、提交人、使用车局数、状态和创建时间。
  - [ ] 店家审核复用 `StoreDrawer` 字段。
  - [ ] 剧本审核复用 `ScriptDrawer` 字段。
  - [ ] 抽屉底部提供批准公开、合并、需要补充和拒绝动作。

- [ ] D33.16 更新静态检查和烟测。
  - [ ] 新增 `scripts/d33-private-catalog-review-check.js`。
  - [ ] 后端烟测覆盖私有店家自己可见、他人不可见。
  - [ ] 后端烟测覆盖私有剧本自己可见、他人不可见。
  - [ ] 后端烟测覆盖创建者可用私有资料建车。
  - [ ] 后端烟测覆盖其他用户不可用私有资料建车。
  - [ ] 后端烟测覆盖管理员批准、拒绝和合并。
  - [ ] 更新 `scripts/check-miniprogram.js` 检查用户端添加入口和私有标记。
  - [ ] 更新 `scripts/d12-admin-web-check.js` 检查待审核 tab 和审核动作。
  - [ ] 将 D33 检查加入 `npm run check`。

- [ ] D33.17 执行自动验证。
  - [ ] 运行 `npm run check`。
  - [ ] 运行 `npm run build:mp-weixin`。
  - [ ] 运行 `node scripts/d33-private-catalog-review-check.js`。
  - [ ] 修复 D33 范围内导致的检查、烟测或构建失败。

## D33 验收

- [x] D33 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D33 design 已落地到 [design.md](./design.md)。
- [x] D33 tasks 已落地到本文件。
- [ ] 用户可创建私有店家。
- [ ] 用户可创建私有剧本。
- [ ] 私有资料创建者可立即用于建车。
- [ ] 私有资料不会出现在其他用户公共搜索中。
- [ ] 公共列表只返回 public approved active 资料和当前用户自己的可用私有资料。
- [ ] 管理员可以查看待审核资料。
- [ ] 管理员可以编辑并批准资料公开。
- [ ] 管理员可以要求补充、拒绝或合并资料。
- [ ] 用户可以查看自己的资料提交状态。
- [ ] 被拒绝或合并的私有资料不能再用于新建车局。
- [ ] 已创建车局继续使用创建时快照。
- [ ] 私有资料创建和编辑复用公开文本风险词检查。
- [ ] `npm run check` 通过。
- [ ] `npm run build:mp-weixin` 通过。

## 验证记录

- D33 spec 三件套已创建，后续实现时在本节补充后端烟测、静态检查、构建和微信开发者工具验证记录。
