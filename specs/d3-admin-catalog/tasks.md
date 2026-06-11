# D3 Tasks: 管理员资料录入执行清单

更新日期：2026-06-11

## D3执行任务

- [x] D3.1 建立D3 spec目录：`specs/d3-admin-catalog/`。
- [x] D3.2 新增D3迁移：剧本默认座位模板字段和基础种子数据。
- [x] D3.3 补强管理员店家列表/搜索接口。
- [x] D3.4 补强管理员剧本列表/搜索接口。
- [x] D3.5 补强公开店家/剧本搜索接口。
- [x] D3.6 补强新增资料申请审核列表过滤和剧本默认模板写入。
- [x] D3.7 实现“我的”页管理员入口仅 `system_admin` 可见。
- [x] D3.8 实现UniApp管理员资料页：店家、剧本、新增申请tab。
- [x] D3.9 实现建车页资料搜索和缺资料申请入口。
- [x] D3.10 新增D3烟测脚本并执行验收。
- [x] D3.11 同步README和开发路线图D3入口。

## D3验收

- [x] D3 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D3 design 已落地到 [design.md](./design.md)。
- [x] D3 tasks 已落地到本文件。
- [x] 管理员入口仅 `system_admin` 可见。
- [x] 管理员能录入至少10个店家。
- [x] 管理员能录入至少20个剧本。
- [x] 管理员能搜索、编辑、下架店家和剧本。
- [x] 车头建车页能搜索 active 店家和剧本。
- [x] 车头找不到资料时能提交新增资料申请。
- [x] 管理员通过申请后资料进入公开搜索列表。
- [x] `npm run check` 通过。
- [x] `npm run migrate` 通过。
- [x] `npm run d3:smoke` 通过。
- [x] `npm run build:mp-weixin` 通过。
- [x] API Docker镜像可构建。

## 验证记录

- `npm run check`：通过。
- `npm run migrate`：通过，执行 `0003_admin_catalog_seed_and_templates.sql`。
- `BASE_URL=http://localhost:3029 npm run d3:smoke`：通过，本地源码实例创建10个店家和20个剧本。
- `npm run build:mp-weixin`：通过，生成 `apps/miniprogram/dist/build/mp-weixin`。
- `docker compose build api`：通过。
- `docker compose up -d api`：通过。
- `BASE_URL=http://localhost:3018 npm run d3:smoke`：通过，Docker API实例创建10个店家和20个剧本。
- `BASE_URL=http://localhost:3018 npm run d2:smoke`：通过，D2主链路无回归。
