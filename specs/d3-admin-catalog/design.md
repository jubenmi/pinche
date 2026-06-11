# D3 Design: 管理员资料录入设计

更新日期：2026-06-11

## Overview

D3把D2的资料API骨架做成可用的管理员资料管理能力。设计重点：

- 管理员入口只对 `system_admin` 可见。
- 管理员页使用三个tab：店家、剧本、新增申请。
- 店家和剧本支持管理员列表、关键词搜索、创建、编辑、上下架。
- 剧本新增 `default_seat_template_json`，用于后续D4建车座位模板。
- 建车页只做D3范围的资料搜索和缺资料申请，不实现完整建车。

## Database

D3迁移文件：

```text
apps/api/migrations/0003_admin_catalog_seed_and_templates.sql
```

迁移内容：

- `scripts.default_seat_template_json`：JSON，可为空。
- 基础店家种子数据。
- 基础剧本种子数据。

## API Design

### Admin Stores

| Method | Path | 权限 | 行为 |
| --- | --- | --- | --- |
| `GET` | `/api/admin/stores?keyword=&status=` | `system_admin` | 管理员店家列表，含下架资料 |
| `POST` | `/api/admin/stores` | `system_admin` | 创建店家 |
| `PATCH` | `/api/admin/stores/:id` | `system_admin` | 编辑、上下架店家 |

### Admin Scripts

| Method | Path | 权限 | 行为 |
| --- | --- | --- | --- |
| `GET` | `/api/admin/scripts?keyword=&status=` | `system_admin` | 管理员剧本列表，含下架资料 |
| `POST` | `/api/admin/scripts` | `system_admin` | 创建剧本，支持默认座位模板 |
| `PATCH` | `/api/admin/scripts/:id` | `system_admin` | 编辑、上下架剧本 |

### Catalog Requests

| Method | Path | 权限 | 行为 |
| --- | --- | --- | --- |
| `GET` | `/api/admin/catalog-requests?status=` | `system_admin` | 管理员查看申请 |
| `PATCH` | `/api/admin/catalog-requests/:id` | `system_admin` | 通过或驳回 |
| `POST` | `/api/catalog-requests` | auth | 车头提交新增申请 |

### Public Search

| Method | Path | 权限 | 行为 |
| --- | --- | --- | --- |
| `GET` | `/api/stores?keyword=` | public | active店家搜索 |
| `GET` | `/api/scripts?keyword=` | public | active剧本搜索 |

## UniApp Pages

### `pages/mine/index`

- 登录后读取 `roles`。
- 仅 `roles.includes("system_admin")` 时展示管理员入口。

### `pages/admin/catalog`

三个tab：

```text
店家
剧本
新增申请
```

店家tab：

- 关键词搜索。
- 店家表单：店名、城市、区域、地址、状态。
- 列表展示和编辑。
- 上下架按钮。

剧本tab：

- 关键词搜索。
- 剧本表单：本名、类型标签、人数、无剧透简介、默认座位模板、状态。
- 列表展示和编辑。
- 上下架按钮。

新增申请tab：

- 查看申请类型、名称、城市、描述、状态。
- 通过。
- 驳回并填写备注。

### `pages/session/create`

D3范围只做资料选择前置能力：

- 搜索店家。
- 搜索剧本。
- 找不到店家时提交新增申请。
- 找不到剧本时提交新增申请。

完整建车、座位模板和发布进入D4。

## Default Seat Template

D3先用JSON数组保存默认座位模板：

```json
[
  {
    "name": "恋陪位",
    "seatType": "love_companion",
    "basePrice": 50000,
    "adjustment": 10000
  },
  {
    "name": "F4位",
    "seatType": "f4",
    "basePrice": 50000,
    "adjustment": -10000
  }
]
```

D4再读取该模板生成座位。

## Smoke Test

D3新增：

```text
npm run d3:smoke
```

烟测覆盖：

- 管理员登录可见 `system_admin`。
- 普通用户无法访问管理员店家列表。
- 管理员创建10个店家、20个剧本。
- 管理员搜索店家/剧本。
- 管理员下架店家/剧本后，公开搜索不可见。
- 车头公开搜索可看到 active 店家/剧本。
- 车头提交缺资料申请。
- 管理员通过店家/剧本申请后，公开搜索可见。
- 管理员驳回申请时保存审核备注。

## D4 Entry Gate

D4可以开始的条件：

- 管理员资料页能录入、搜索、编辑、上下架。
- 建车页能搜索店家/剧本。
- 建车页能提交缺资料申请。
- 管理员审核通过后，资料进入可选列表。
- D3烟测通过。
