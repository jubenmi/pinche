# D36 Tasks: admin 店家位置搜索与地址解析兜底执行清单

更新日期：2026-07-09

## D36 执行任务

- [x] D36.1 建立 D36 spec 三件套。
  - [x] `requirements.md` 描述 POI 优先、腾讯地址解析兜底、高德二级兜底和只回填坐标。
  - [x] `design.md` 描述后端代理、admin web 流程、密钥边界、错误处理和测试策略。
  - [x] `tasks.md` 描述实现和验收清单。

- [x] D36.2 新增 D36 静态检查。
  - [x] 新增 `scripts/d36-admin-location-geocode-check.js`。
  - [x] 检查服务端 geocoding module 存在。
  - [x] 检查 API config 读取腾讯和高德服务端 key。
  - [x] 检查 `POST /api/admin/location/geocode` 需要 `system_admin`。
  - [x] 检查 provider 顺序为腾讯地址解析优先、高德兜底。
  - [x] 检查 admin web 搜索顺序为 POI 优先、地址解析兜底。
  - [x] 检查地址解析结果只回填坐标。
  - [x] 将 D36 检查接入 `npm run check`。
  - [x] 先运行 D36 检查并确认失败。
  - [x] 新增 `scripts/d36-geocoding-unit-check.js` 覆盖腾讯成功和腾讯低可信转高德。

- [x] D36.3 实现服务端地址解析代理。
  - [x] 在 API config 增加服务端地图 key 配置。
  - [x] 新增 `apps/api/src/modules/location/geocoding.js`。
  - [x] 实现地址输入归一化。
  - [x] 实现腾讯地址解析请求和可信度判断。
  - [x] 实现高德地理编码兜底。
  - [x] 实现统一坐标响应和失败错误。
  - [x] 在 `apps/api/src/server.js` 增加 `POST /api/admin/location/geocode`。

- [x] D36.4 改造 admin web 位置搜索链路。
  - [x] `apps/admin-web/src/api.js` 增加 `geocodeStoreLocation`。
  - [x] `StoreDrawer.vue` 在 POI 搜索失败、无候选或缓存空结果时调用地址解析兜底。
  - [x] 兜底成功只回填 `latitude` 和 `longitude`。
  - [x] 地图已展开时同步 marker 和中心点。
  - [x] UI 文案说明 POI 无候选或无额度时会地址解析兜底。
  - [x] 无腾讯前端 key 时仍允许使用服务端地址解析。

- [x] D36.5 执行自动验证。
  - [x] 运行 `node scripts/d36-admin-location-geocode-check.js`。
  - [x] 运行 `node scripts/d36-geocoding-unit-check.js`。
  - [x] 运行 `node --check apps/api/src/modules/location/geocoding.js`。
  - [x] 运行 `node --check apps/api/src/server.js`。
  - [x] 运行 `npm --workspace apps/admin-web run build`。
  - [x] 运行 `npm run check`。
  - [x] 运行 `npm run build:mp-weixin`。
  - [x] 修复 D36 范围内导致的检查或构建失败。

## D36 验收

- [x] admin web 位置搜索先走腾讯 POI。
- [x] POI 有候选时不调用地址解析兜底。
- [x] POI 无候选、超额或失败时调用服务端地址解析。
- [x] 服务端地址解析先走腾讯地址解析。
- [x] 腾讯地址解析不可用或低可信时走高德。
- [x] 地址解析结果只回填坐标，不覆盖地址或店名。
- [x] 高德 key 不出现在 admin web、小程序或 Docker ARG 中。
- [x] `npm run check` 包含 D36 检查并通过。

## 验证记录

- 2026-07-09：D36 spec 三件套已创建。随后新增静态检查并先运行 `node scripts/d36-admin-location-geocode-check.js`，初次失败于缺少 API geocoding module，确认检查先行。
- 2026-07-09：完成服务端 `POST /api/admin/location/geocode`，由 `system_admin` 调用；后端 provider 顺序为腾讯地址解析、高德地理编码，腾讯结果要求合法 GCJ-02 坐标且 `reliability`/`level` 不低于阈值。
- 2026-07-09：完成 admin web 搜索链路：搜索先走腾讯 POI；POI 缓存为空、无候选、每日额度耗尽或失败时调用服务端地址解析；服务端解析结果只回填 `latitude` 和 `longitude`，不覆盖店名、地址、城市或区域。
- 2026-07-09：自动验证通过：`node scripts/d36-admin-location-geocode-check.js`、`node scripts/d36-geocoding-unit-check.js`、`node --check apps/api/src/modules/location/geocoding.js`、`node --check apps/api/src/server.js`、`npm --workspace apps/admin-web run build`、`npm run check`、`npm run build:mp-weixin`。`npm run build:mp-weixin` 仅输出既有 Sass legacy API / `@import` deprecation warning。
