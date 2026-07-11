# D35 Requirements: 小程序资料管理后台能力对齐

更新日期：2026-07-09

## Introduction

D35 将小程序 `pages/admin/catalog` 升级为移动端资料管理后台，让 `system_admin` 在微信小程序内也能完成 web admin 资料库的核心管理工作：店家、剧本、待审核资料、批量上下架/删除、店家关联剧本价格、结构化角色/NPC 模板，以及扫码登录 web admin。

本期采用“1+3 混合”方案：1 个紧凑管理工作台 + 3 个资料域（店家、剧本、待审核），每个资料域使用列表和聚焦编辑面板组合。地图定位只使用微信小程序原生 `uni.chooseLocation` / `uni.openLocation` 和手填 GCJ-02 坐标，不接入腾讯位置服务 WebService POI 搜索，不消耗当前腾讯位置服务 POI 搜索额度。

## Scope

### In Scope

- 小程序系统管理员资料管理页 `apps/miniprogram/src/pages/admin/catalog.vue`。
- 店家资料管理能力对齐 web admin catalog。
- 剧本资料管理能力对齐 web admin catalog。
- 待审核资料管理能力对齐 web admin catalog。
- 小程序端保留并强化扫码登录 web admin。
- 小程序端地图选点、坐标手填和地图打开，且不调用腾讯 POI/WebService。
- 必要的前端工具函数、组件拆分、静态检查和验证脚本。

### Out of Scope

- 车局管理、报名管理、相册管理、视频管理等非 catalog 后台域。
- 腾讯位置服务商业授权申请或付费方案。
- 小程序端腾讯 POI 搜索、地址关键词搜索、逆地址解析 WebService。
- 新增独立后台权限体系；继续使用现有 `system_admin`。
- 重新设计 admin web；web admin 只作为能力基线。

## Requirements

### Requirement 1: 只有系统管理员可进入资料管理后台

**User Story:** 作为平台负责人，我希望小程序资料管理能力只开放给系统管理员，以免普通用户修改公共资料库。

#### Acceptance Criteria

1. WHEN 普通用户进入小程序 admin catalog 页面 THEN 系统 SHALL 显示无权限状态，并 SHALL NOT 加载管理员资料接口。
2. WHEN `system_admin` 进入页面 THEN 系统 SHALL 展示资料管理工作台。
3. WHEN 管理员身份过期或接口返回 401/403 THEN 页面 SHALL 进入登录或无权限状态，不继续提交编辑请求。
4. WHEN 页面展示管理员操作 THEN SHALL 明确区分普通资料浏览和管理员资料修改。
5. WHEN 后续新增资料管理动作 THEN SHALL 复用同一套 `system_admin` 权限判断。

### Requirement 2: 扫码登录 web admin 保持为全局管理员工具

**User Story:** 作为系统管理员，我希望在小程序后台随时扫码登录 web admin，以便在电脑端继续处理更复杂的后台工作。

#### Acceptance Criteria

1. WHEN `system_admin` 打开资料管理工作台 THEN 页面 SHALL 在全局工具区展示“扫码登录 Web 后台”入口。
2. WHEN 管理员切换店家、剧本或待审核资料域 THEN 扫码登录入口 SHALL 保持可访问，不隐藏在某个单独 tab 深处。
3. WHEN 管理员扫码内容以 `pinche-admin-login://ticket/` 开头 THEN 小程序 SHALL 解析 ticket id 和 secret。
4. WHEN 扫码内容合法 THEN 小程序 SHALL 显示确认弹窗，说明将批准 web admin 登录。
5. WHEN 管理员确认 THEN 小程序 SHALL 调用 `POST /api/admin/web-login/tickets/:ticketId/approve` 并携带 secret。
6. WHEN 管理员取消确认 THEN 小程序 SHALL NOT 调用 approve 接口。
7. WHEN 扫码内容无效、ticket 过期或 secret 错误 THEN 小程序 SHALL 展示轻量错误提示。
8. WHEN 扫码登录实现升级资料管理页 THEN SHALL 保留现有 QR 前缀、确认和 approve 接口语义。

### Requirement 3: 资料管理使用“1+3 混合”信息架构

**User Story:** 作为移动端管理员，我希望一进后台就能看到待处理重点，并能快速进入店家、剧本或审核资料处理。

#### Acceptance Criteria

1. WHEN 管理员打开页面 THEN 系统 SHALL 展示一个紧凑工作台，包含店家数、剧本数、待审核数和最近处理状态。
2. WHEN 工作台展示资料域 THEN SHALL 提供店家、剧本、待审核三个主入口。
3. WHEN 管理员进入任一资料域 THEN 页面 SHALL 提供搜索、状态筛选、列表和聚焦编辑入口。
4. WHEN 管理员编辑一条资料 THEN 页面 SHALL 使用底部面板、分段表单或等效移动端聚焦编辑体验。
5. WHEN 管理员保存、取消或切换资料 THEN 页面 SHALL 避免丢失未保存编辑内容。
6. WHEN 页面运行在小屏手机 THEN 列表、筛选、批量操作和编辑控件 SHALL 不互相遮挡。
7. WHEN 页面使用视觉样式 THEN SHALL 贴合现有 TDesign 小程序风格，使用白底、紧凑间距和平台主色，不做营销型落地页。

### Requirement 4: 小程序店家管理对齐 web admin catalog

**User Story:** 作为系统管理员，我希望在小程序内完成店家新增、编辑、上下架、删除和剧本关联维护。

#### Acceptance Criteria

1. WHEN 管理员进入店家域 THEN 系统 SHALL 加载 `/api/admin/stores` 并展示店家列表。
2. WHEN 管理员搜索店家 THEN 列表 SHALL 支持按名称、城市、区域或地址筛选。
3. WHEN 管理员筛选店家 THEN 列表 SHALL 支持按 `status` 和审核状态筛选。
4. WHEN 管理员新增店家 THEN 表单 SHALL 支持名称、城市、区域、地址、联系方式备注、状态、纬度和经度。
5. WHEN 管理员编辑店家 THEN 表单 SHALL 回显现有字段和坐标。
6. WHEN 管理员保存店家 THEN 小程序 SHALL 调用现有管理员店家保存接口，并提交 `address`、`latitude`、`longitude`。
7. WHEN 管理员打开店家关联剧本 THEN 页面 SHALL 加载 `/api/admin/stores/:id/scripts`。
8. WHEN 管理员维护店家关联剧本 THEN 页面 SHALL 支持选择剧本、移除剧本和编辑每人价格。
9. WHEN 管理员保存店家关联剧本 THEN 页面 SHALL 调用 `/api/admin/stores/:id/scripts` 保存关联关系。
10. WHEN 管理员将店家下架 THEN 系统 SHALL 将 `status` 更新为 `inactive`。
11. WHEN 管理员删除店家 THEN 页面 SHALL 仅允许删除已下架店家，并在删除前二次确认。
12. WHEN 后端返回店家仍被引用或不能删除 THEN 页面 SHALL 展示明确错误，不吞掉失败状态。

### Requirement 5: 小程序地图定位不消耗腾讯 POI 搜索额度

**User Story:** 作为平台运营者，我希望小程序管理员设置店家位置时不再消耗腾讯位置服务 POI 搜索额度，同时仍能准确保存坐标。

#### Acceptance Criteria

1. WHEN 小程序管理员设置店家位置 THEN 页面 SHALL 提供“地图选点”和“手填坐标”两种方式。
2. WHEN 管理员点击“地图选点” THEN 小程序 SHALL 调用 `uni.chooseLocation`。
3. WHEN `uni.chooseLocation` 成功 THEN 页面 SHALL 回填地址、GCJ-02 纬度和 GCJ-02 经度。
4. WHEN 管理员取消选点 THEN 页面 SHALL 保留原表单内容，并 SHALL NOT 报错。
5. WHEN 当前环境不支持 `chooseLocation` 或调用失败 THEN 页面 SHALL 保留手填地址和坐标能力。
6. WHEN 管理员手填坐标 THEN 页面 SHALL 标明坐标系为 GCJ-02。
7. WHEN 店家已有完整坐标 THEN 页面 MAY 提供“查看地图”，并 SHALL 使用 `uni.openLocation`。
8. WHEN 小程序实现地图定位 THEN SHALL NOT 调用腾讯位置服务 WebService `/ws/place/v1/search`、`/ws/geocoder/v1` 或 qqmap-wx-jssdk POI 搜索。
9. WHEN 小程序实现地图定位 THEN SHALL NOT 在小程序代码中新增腾讯位置服务 WebService key。
10. WHEN 小程序实现地图定位 THEN SHALL NOT 主动调用 `uni.getLocation` 或 `wx.getLocation` 读取管理员当前位置。
11. WHEN 运行静态检查 THEN SHALL 能检查小程序 admin catalog 不包含腾讯 POI/WebService 调用。

### Requirement 6: 小程序剧本管理对齐 web admin catalog

**User Story:** 作为系统管理员，我希望在小程序内维护剧本基础信息、角色模板和 NPC 角色，而不是编辑大段 JSON。

#### Acceptance Criteria

1. WHEN 管理员进入剧本域 THEN 系统 SHALL 加载 `/api/admin/scripts` 并展示剧本列表。
2. WHEN 管理员搜索剧本 THEN 列表 SHALL 支持按名称、标签或简介筛选。
3. WHEN 管理员筛选剧本 THEN 列表 SHALL 支持按 `status` 和审核状态筛选。
4. WHEN 管理员新增或编辑剧本 THEN 表单 SHALL 支持名称、玩家人数、标签、无剧透简介和状态。
5. WHEN 管理员编辑玩家角色 THEN 页面 SHALL 提供结构化角色列表，支持新增、删除、排序、角色名、性别和描述。
6. WHEN 角色数量与玩家人数不一致 THEN 页面 SHALL 给出明确提示，并 SHALL 支持一键补齐默认角色。
7. WHEN 管理员编辑 NPC 角色 THEN 页面 SHALL 提供结构化 NPC 列表，支持名称、描述、人数或绑定信息所需字段。
8. WHEN 管理员保存剧本 THEN 小程序 SHALL 按后端现有字段提交 `default_seat_template` / `defaultSeatTemplate` 和 `npc_roles` / `npcRoles` 等价数据。
9. WHEN 现有剧本模板 JSON 无法解析 THEN 页面 SHALL 保留原始内容并提示修正，避免静默覆盖。
10. WHEN 管理员删除剧本 THEN 页面 SHALL 仅允许删除已下架剧本，并在删除前二次确认。
11. WHEN 后端返回剧本仍被引用或不能删除 THEN 页面 SHALL 展示明确错误。

### Requirement 7: 小程序待审核资料管理对齐 web admin catalog

**User Story:** 作为系统管理员，我希望在小程序内处理用户提交的私有店家和私有剧本，包括编辑后批准、要求补充、拒绝和合并。

#### Acceptance Criteria

1. WHEN 管理员进入待审核域 THEN 系统 SHALL 加载 `/api/admin/catalog-review-items`。
2. WHEN 待审核列表展示 THEN SHALL 显示资料类型、名称、提交人、创建时间、使用车局数和审核状态。
3. WHEN 管理员筛选待审核资料 THEN SHALL 支持按类型、审核状态和关键词筛选。
4. WHEN 管理员编辑待审核店家 THEN SHALL 使用与店家管理一致的字段和地图定位能力。
5. WHEN 管理员编辑待审核剧本 THEN SHALL 使用与剧本管理一致的结构化角色/NPC 编辑能力。
6. WHEN 管理员批准店家 THEN 小程序 SHALL 调用 approve 接口，并将资料公开。
7. WHEN 管理员批准剧本 THEN 小程序 SHALL 支持同时选择要关联的店家和每人价格。
8. WHEN 管理员要求补充 THEN 小程序 SHALL 要求或允许填写审核备注，并调用 needs-changes 接口。
9. WHEN 管理员拒绝 THEN 小程序 SHALL 二次确认并调用 reject 接口。
10. WHEN 管理员合并资料 THEN 小程序 SHALL 要求选择同类型公共目标资料，并调用 merge 接口。
11. WHEN 审核动作完成 THEN 页面 SHALL 刷新待审核列表、工作台统计和相关资料列表。

### Requirement 8: 店家和剧本支持移动端批量操作

**User Story:** 作为系统管理员，我希望在手机上批量上下架或删除资料，减少重复操作。

#### Acceptance Criteria

1. WHEN 管理员进入店家或剧本域 THEN 页面 SHALL 提供选择模式。
2. WHEN 管理员选择多条资料 THEN 页面 SHALL 展示固定批量操作栏。
3. WHEN 管理员批量上架 THEN 系统 SHALL 逐条调用保存接口或现有批量接口，将 `status` 更新为 `active`。
4. WHEN 管理员批量下架 THEN 系统 SHALL 逐条调用保存接口或现有批量接口，将 `status` 更新为 `inactive`。
5. WHEN 管理员批量删除 THEN 页面 SHALL 仅对已下架资料执行删除，并清楚列出跳过项。
6. WHEN 批量操作部分失败 THEN 页面 SHALL 展示成功数、失败数和失败原因。
7. WHEN 批量操作执行中 THEN 页面 SHALL 禁用重复提交，并保留可见进度。
8. WHEN 待审核资料域 THEN 本期 SHALL 不提供批量批准、批量拒绝或批量合并。

### Requirement 9: 移动端状态、错误和数据安全体验完整

**User Story:** 作为经常在移动端处理资料的管理员，我希望页面在加载、失败、保存和冲突时都有清楚反馈。

#### Acceptance Criteria

1. WHEN 页面首次加载 THEN SHALL 展示加载状态。
2. WHEN 列表为空 THEN SHALL 展示对应资料域的空状态和新增入口。
3. WHEN 接口请求失败 THEN SHALL 展示可理解的错误信息和重试入口。
4. WHEN 表单存在未保存修改 THEN 切换 tab、关闭编辑面板或返回前 SHALL 提醒管理员。
5. WHEN 保存成功 THEN SHALL 展示成功反馈，并更新本地列表。
6. WHEN 保存失败 THEN SHALL 保留表单内容，方便管理员修正后重试。
7. WHEN 执行删除、拒绝、合并或扫码登录 web admin THEN SHALL 二次确认。
8. WHEN 后端返回校验错误 THEN SHALL 尽量定位到对应表单字段。
9. WHEN 页面展示长文本或长名称 THEN SHALL 不溢出按钮、列表项或编辑面板。
10. WHEN 操作完成后刷新数据 THEN SHALL 避免覆盖其他未保存编辑。

### Requirement 10: D35 交付物和验证

**User Story:** 作为开发团队，我希望 D35 有明确 spec 三件套和验证清单，方便后续按边界实现。

#### Acceptance Criteria

1. WHEN D35 spec 完成 THEN SHALL 产出 `requirements.md`。
2. WHEN D35 spec 完成 THEN SHALL 产出 `design.md`。
3. WHEN D35 spec 完成 THEN SHALL 产出 `tasks.md`。
4. WHEN D35 实现完成 THEN SHALL 新增或更新静态检查，覆盖小程序资料管理后台能力和地图无 POI/WebService 调用。
5. WHEN D35 实现完成 THEN SHALL 通过 `node scripts/d35-miniprogram-admin-catalog-check.js`。
6. WHEN D35 实现完成 THEN SHALL 通过 `node scripts/check-miniprogram.js`。
7. WHEN D35 实现完成 THEN SHALL 通过 `npm run build:mp-weixin`。
8. WHEN D35 实现完成 THEN SHALL 通过 `npm run check`。
