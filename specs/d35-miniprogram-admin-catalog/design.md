# D35 Design: 小程序资料管理后台能力对齐设计

更新日期：2026-07-09

## Overview

D35 在现有小程序管理员资料页上扩展能力，使 `system_admin` 可以在手机端处理 web admin catalog 的核心资料管理工作。设计选择“1+3 混合”：一个管理工作台承载全局状态、扫码登录和快捷入口，三个资料域分别处理店家、剧本、待审核资料。

本设计保留现有自建 API、TDesign 小程序组件、`system_admin` 权限和 D33/D34 数据模型。地图定位在小程序端只使用微信原生地图能力和手填坐标，不引入腾讯位置服务 POI/WebService 搜索。

## Goals

- 小程序 admin catalog 对齐 web admin catalog 的资料管理能力。
- 管理员在移动端可完成店家、剧本、待审核资料的日常维护。
- 扫码登录 web admin 保持为全局工具。
- 店家定位不消耗腾讯位置服务 POI 搜索额度。
- UI 贴合当前小程序风格，适合高频移动端运营操作。

## Non-Goals

- 不重建 web admin。
- 不扩展车局、报名、相册或视频后台能力。
- 不新增腾讯位置服务商业授权流程。
- 不在小程序中接腾讯 POI 搜索、地址解析或逆地址解析。
- 不新增地图 SDK key 或服务端密钥下发。

## Current State

### 小程序资料管理页

`apps/miniprogram/src/pages/admin/catalog.vue` 当前已经包含：

- `system_admin` 权限入口。
- 店家、剧本、申请/待审核相关 tab。
- 基础店家表单：名称、城市、区域、地址、状态。
- 基础剧本表单：名称、标签、玩家人数、简介、角色模板 JSON 文本、状态。
- 待审核资料批准、需要补充、拒绝和合并动作。
- 扫码登录 web admin：解析 `pinche-admin-login://ticket/` 并调用 approve 接口。

主要缺口：

- 店家缺少移动端地图选点、手填坐标状态、店家关联剧本和价格维护。
- 剧本缺少结构化玩家角色和 NPC 角色编辑。
- 待审核编辑能力不如 web admin 完整。
- 批量上下架/删除能力不足。
- 扫码登录入口需要从局部 tab 升级为全局管理员工具。
- 页面信息密度和编辑流需要适配“工作台 + 聚焦编辑”的移动端模型。

### Web Admin 能力基线

`apps/admin-web/src/components/CatalogWorkspace.vue` 和相关 drawer 当前提供：

- 店家、剧本、会话、待审核等后台 tab。
- 店家新增/编辑、状态更新、删除。
- 店家关联剧本和每人价格维护。
- 剧本结构化角色和 NPC 角色编辑。
- 待审核资料编辑、批准、要求补充、拒绝、合并。
- 店家和剧本批量上下架/删除。

D35 只对齐其中 catalog 资料域：店家、剧本、待审核。

## Information Architecture

### 1+3 混合结构

```text
管理工作台
  全局工具: 扫码登录 Web 后台 / 刷新 / 选择模式入口
  概览指标: 店家 / 剧本 / 待审核
  最近状态: 最近保存、失败提示、待处理提醒

资料域
  店家
    搜索 + 状态筛选 + 城市筛选
    列表 + 批量操作
    店家编辑面板

  剧本
    搜索 + 状态筛选 + 标签筛选
    列表 + 批量操作
    剧本编辑面板

  待审核
    类型筛选 + 状态筛选 + 搜索
    待审核列表
    审核编辑面板 + 审核动作栏
```

移动端交互：

- 默认展示工作台和当前资料域列表。
- 新增或编辑时打开聚焦面板。
- 小屏使用底部面板或页面内分段表单。
- 长表单分为基础信息、位置/关联、角色模板、审核动作等 section。
- 批量操作使用底部固定栏，避免挤占列表操作按钮。

## Frontend Architecture

### Page Ownership

主入口继续是：

```text
apps/miniprogram/src/pages/admin/catalog.vue
```

建议在实现中逐步拆分，避免单文件继续膨胀：

```text
apps/miniprogram/src/components/admin/AdminCatalogShell.vue
apps/miniprogram/src/components/admin/AdminCatalogToolbar.vue
apps/miniprogram/src/components/admin/AdminStoreEditor.vue
apps/miniprogram/src/components/admin/AdminScriptEditor.vue
apps/miniprogram/src/components/admin/AdminReviewEditor.vue
apps/miniprogram/src/components/admin/AdminBulkBar.vue
apps/miniprogram/src/components/admin/ScriptRoleEditor.vue
apps/miniprogram/src/utils/adminCatalog.js
```

拆分原则：

- `catalog.vue` 负责权限、tab、数据加载和顶层状态。
- editor 组件负责表单状态、字段校验和提交 payload 组装。
- `adminCatalog.js` 放通用 normalizer、默认表单、角色模板转换和错误文案。
- 扫码登录逻辑可以保留在页面层，但入口必须在全局工具区。

如果实现时发现一次性拆分风险较高，可以先在 `catalog.vue` 内完成行为，再按功能块提取组件；但静态检查要覆盖最终行为，不依赖拆分形式。

### API Access

继续使用小程序现有 request 工具和现有后端路由：

| 能力 | Method | Path |
| --- | --- | --- |
| 店家列表 | `GET` | `/api/admin/stores` |
| 店家创建 | `POST` | `/api/admin/stores` |
| 店家更新 | `PATCH` | `/api/admin/stores/:id` |
| 店家删除 | `DELETE` | `/api/admin/stores/:id` |
| 店家关联剧本列表 | `GET` | `/api/admin/stores/:id/scripts` |
| 店家关联剧本保存 | `PUT` | `/api/admin/stores/:id/scripts` |
| 剧本列表 | `GET` | `/api/admin/scripts` |
| 剧本创建 | `POST` | `/api/admin/scripts` |
| 剧本更新 | `PATCH` | `/api/admin/scripts/:id` |
| 剧本删除 | `DELETE` | `/api/admin/scripts/:id` |
| 待审核列表 | `GET` | `/api/admin/catalog-review-items` |
| 待审核编辑 | `PATCH` | `/api/admin/catalog-review-items/:type/:id` |
| 批准公开 | `POST` | `/api/admin/catalog-review-items/:type/:id/approve` |
| 要求补充 | `POST` | `/api/admin/catalog-review-items/:type/:id/needs-changes` |
| 拒绝 | `POST` | `/api/admin/catalog-review-items/:type/:id/reject` |
| 合并 | `POST` | `/api/admin/catalog-review-items/:type/:id/merge` |
| 扫码登录批准 | `POST` | `/api/admin/web-login/tickets/:ticketId/approve` |

如果某个 endpoint 方法名与 web admin wrapper 存在差异，实现时以 `apps/api/src/server.js` 的实际路由为准，不新增重复路由。

## Store Management Design

### Store List

列表 item 展示：

- 店家名称。
- 城市/区域。
- 地址摘要。
- 状态：上架、下架、待审核、需要补充等。
- 坐标状态：已定位、缺坐标。
- 关联剧本数量或价格提示。

筛选：

- 关键词。
- 状态。
- 审核状态。
- 城市。

### Store Editor

字段：

```text
name
city
district
address
contact_note
status
latitude
longitude
linkedScripts[]
```

位置 section：

- 地址输入。
- “地图选点”按钮。
- 纬度（GCJ-02）。
- 经度（GCJ-02）。
- 已有完整坐标时显示“查看地图”。
- 坐标缺失时显示“可手填 GCJ-02 坐标”。

关联剧本 section：

```json
[
  {
    "scriptId": 123,
    "scriptName": "长夜将尽",
    "pricePerPerson": 168
  }
]
```

保存流程：

1. 校验必填字段和坐标格式。
2. 创建或更新店家。
3. 如果有关联剧本 section，调用店家关联剧本保存接口。
4. 刷新当前店家列表和工作台统计。
5. 保存失败时保留编辑面板和当前表单内容。

删除流程：

1. 如果店家不是 `inactive`，要求先下架。
2. 删除前二次确认。
3. 调用删除接口。
4. 如果后端返回被引用，展示错误并保留列表 item。

## Map Location Design

### 小程序原生选点

```text
tap 地图选点
  if typeof uni.chooseLocation !== "function"
    toast 当前环境不支持地图选点，请手填坐标
  else
    uni.chooseLocation()
      success -> 回填 address / latitude / longitude
      cancel -> 不提示错误，保留原值
      fail -> 非取消失败展示 toast
```

字段约定：

- `latitude`: GCJ-02 纬度。
- `longitude`: GCJ-02 经度。
- 坐标允许为空。
- 只有经纬度都存在且合法时才允许“查看地图”。

### 查看地图

```text
tap 查看地图
  uni.openLocation({
    latitude: Number(latitude),
    longitude: Number(longitude),
    name: store.name,
    address: store.address,
    scale: 18
  })
```

失败时只展示轻量 toast。

### 禁止能力

小程序 admin catalog 不应出现以下内容：

```text
qqmap-wx-jssdk
/ws/place/v1/search
/ws/geocoder/v1
WebServiceAPI
腾讯位置服务 key
uni.getLocation
wx.getLocation
```

设计原因：

- `chooseLocation` / `openLocation` 是微信小程序原生能力。
- D35 只需要管理员主动选点或手填坐标。
- POI 搜索额度问题来自腾讯位置服务 WebService Place Search，不能把该调用迁入小程序。

## Script Management Design

### Script List

列表 item 展示：

- 剧本名称。
- 玩家人数。
- 标签摘要。
- 状态。
- 角色模板状态：角色数匹配、角色数不匹配、模板异常。
- NPC 数量。

筛选：

- 关键词。
- 状态。
- 审核状态。
- 标签。

### Script Editor

基础字段：

```text
name
player_count
type_tags
summary_no_spoiler
status
```

角色模板编辑：

```json
[
  {
    "name": "角色1",
    "roleGender": "unlimited",
    "description": ""
  }
]
```

交互：

- 新增角色。
- 删除角色。
- 上移/下移。
- 性别分段选择。
- 一键按玩家人数补齐。
- 角色数不匹配时展示警告，但不静默删除管理员输入。

NPC 角色编辑：

```json
[
  {
    "name": "主持人",
    "description": "",
    "count": 1
  }
]
```

兼容策略：

- 进入编辑时解析现有模板 JSON。
- 可解析时转换为结构化列表。
- 不可解析时保留原始文本并提示修复。
- 保存前将结构化列表转回后端现有字段。

删除流程：

- 仅允许已下架剧本删除。
- 删除前二次确认。
- 后端返回被引用时展示明确错误。

## Review Management Design

### Review List

列表 item 展示：

- 类型：店家或剧本。
- 名称。
- 提交人。
- 创建时间。
- 使用车局数。
- 审核状态。
- 当前处理建议：待审核、需补充、已合并等。

筛选：

- 类型。
- 审核状态。
- 关键词。

### Review Editor

店家审核复用 Store Editor：

- 基础资料。
- 原生地图选点和手填坐标。
- 关联剧本可选。

剧本审核复用 Script Editor：

- 基础资料。
- 结构化玩家角色。
- NPC 角色。
- 批准时可选择关联店家和每人价格。

审核动作：

```text
批准公开
  可先保存编辑字段
  store -> approve
  script -> approve + optional storeScriptLinks

要求补充
  输入 reviewNote
  needs-changes

拒绝
  二次确认
  reject

合并
  选择同类型 public approved active 目标
  merge
```

动作完成后刷新：

- 待审核列表。
- 店家或剧本列表。
- 工作台统计。

## Bulk Operation Design

批量操作范围：

- 店家。
- 剧本。

不批量处理：

- 批量批准。
- 批量拒绝。
- 批量合并。

状态机：

```text
normal
  enter selection mode
selecting
  choose items
  bulk active / inactive / delete
running
  disable controls
  show progress
done
  show summary
  refresh list
```

删除规则：

- active 资料跳过并提示“需先下架”。
- inactive 资料才调用 delete。
- 每条失败保留原因。

## Error Handling

统一错误文案来源：

- HTTP 401/403：无权限或登录过期。
- HTTP 400：字段校验失败，尽量映射到字段。
- HTTP 404：资料不存在或已被处理。
- HTTP 409/RESOURCE_IN_USE：资料仍被引用，不能删除。
- 网络错误：展示重试。

表单保护：

- editor 内维护 `dirty` 状态。
- 切换 tab、关闭编辑、返回页面时二次确认。
- 保存失败不清空表单。
- 审核动作前如有未保存修改，提示先保存或将修改随动作提交。

## Security and Quota Boundaries

权限：

- 页面和接口均依赖 `system_admin`。
- 普通用户不得触发管理员列表和编辑请求。

扫码登录：

- 继续要求扫码内容包含 ticket id 和 secret。
- approve 前二次确认。
- 不在页面持久化 secret。

地图和额度：

- 小程序不包含腾讯位置服务 WebService key。
- 小程序不调用腾讯 POI 搜索。
- 小程序不调用主动定位。
- 管理员主动选点后保存 GCJ-02 坐标。

## Testing Strategy

### Static Checks

新增：

```text
scripts/d35-miniprogram-admin-catalog-check.js
```

覆盖：

- `pages/admin/catalog.vue` 保留扫码登录 QR 前缀和 approve 接口。
- 页面存在全局扫码登录入口文案。
- 页面存在店家、剧本、待审核三个资料域。
- 店家编辑包含 `latitude`、`longitude`、`uni.chooseLocation`。
- 店家定位不包含 `qqmap-wx-jssdk`、`/ws/place/v1/search`、`/ws/geocoder/v1`、`uni.getLocation`、`wx.getLocation`。
- 剧本编辑包含结构化角色和 NPC 角色操作。
- 待审核动作包含 approve、needs-changes、reject、merge。
- 批量上下架/删除入口存在。

更新：

- `scripts/check-miniprogram.js` 增加 D35 子检查或调用 D35 检查。
- 如涉及 web admin parity assumptions，可扩展 `scripts/d12-admin-web-check.js` 只做基线存在性检查。

### Manual QA

- system_admin 可进入工作台，普通用户不可进入。
- 扫码登录 web admin 成功、取消、无效码均正确。
- 新增店家，地图选点回填坐标，保存后列表可见。
- 手填 GCJ-02 坐标保存成功。
- 无坐标店家不展示查看地图或展示缺坐标状态。
- 店家关联剧本和价格保存成功。
- 剧本结构化角色/NPC 保存后重新打开仍一致。
- 待审核店家和剧本可编辑后批准。
- 要求补充、拒绝、合并动作正确刷新列表。
- 批量上下架和删除部分失败时有汇总。

### Verification Commands

D35 实现完成后运行：

```bash
node scripts/d35-miniprogram-admin-catalog-check.js
node scripts/check-miniprogram.js
npm run build:mp-weixin
npm run check
```

如果实现涉及新的工具文件，也运行对应 `node --check`。

## Rollout Notes

- 先交付小程序资料管理后台，不影响普通用户建车路径。
- 地图定位使用 D34 已有 `stores.latitude` / `stores.longitude` 字段。
- 若后端现有 endpoint 已满足保存字段，不新增 schema。
- 若发现小程序端缺少某个 admin wrapper，只在小程序 request 层补齐调用，不新增重复后端路由。
