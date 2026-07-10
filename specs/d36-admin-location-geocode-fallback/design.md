# D36 Design: admin 店家位置搜索与地址解析兜底

更新日期：2026-07-09

## Overview

D36 保持 admin web 当前“腾讯 POI 搜索 + 地图点选 + 手填坐标”的主体验，新增一个服务端地址解析代理作为兜底。链路顺序固定为：

```text
腾讯 POI 搜索
  有候选 -> 管理员选择 POI，回填地址和坐标
  无候选/超额/失败 -> 服务端地址解析代理

服务端地址解析代理
  腾讯地址解析可用且可信 -> 返回 GCJ-02 坐标
  腾讯不可用/低可信/失败 -> 高德地理编码
  高德可用 -> 返回 GCJ-02 坐标
  均失败 -> 返回错误，保留手填坐标
```

解析结果不自动保存。admin web 只把 `latitude` 和 `longitude` 写入表单，管理员可以看地图 marker、调整坐标或手填后再保存店家。

## Backend Design

### Config

在 `apps/api/src/config/env.js` 增加服务端地图配置：

```js
map: {
  tencentKey:
    process.env.TENCENT_MAP_SERVICE_KEY ||
    process.env.TENCENT_MAP_KEY ||
    process.env.VITE_TENCENT_MAP_KEY ||
    "",
  amapKey: process.env.AMAP_WEB_SERVICE_KEY || process.env.GAODE_MAP_KEY || ""
}
```

说明：

- `TENCENT_MAP_SERVICE_KEY` 是推荐的服务端腾讯地址解析 key。
- `TENCENT_MAP_KEY` 和 `VITE_TENCENT_MAP_KEY` 只是兼容已有部署命名。
- `AMAP_WEB_SERVICE_KEY` 是推荐的高德 Web 服务 key。
- 不新增 Docker ARG，不提交真实 key。

### Geocoding Module

新增：

```text
apps/api/src/modules/location/geocoding.js
```

职责：

- 归一化地址输入。
- 拼接腾讯地址解析请求。
- 检查腾讯返回 `result.location.lat/lng`、`reliability` 和 `level`。
- 腾讯失败后拼接高德地理编码请求。
- 解析高德 `geocodes[0].location` 的 `lng,lat`。
- 返回统一结构。

统一响应：

```json
{
  "provider": "tencent",
  "latitude": 39.9042,
  "longitude": 116.4074,
  "confidence": {
    "reliability": 9,
    "level": 10
  },
  "query": "北京市朝阳区..."
}
```

腾讯可信度规则：

- 必须有合法坐标。
- `reliability` 缺失时不因该字段拒绝。
- `reliability < 7` 视为低可信并转高德。
- `level` 缺失时不因该字段拒绝。
- `level < 7` 视为低精度并转高德。

高德规则：

- `status === "1"`。
- `geocodes` 至少一个。
- 第一个合法 `location` 作为结果。

### API Route

新增管理员路由：

```text
POST /api/admin/location/geocode
```

请求体：

```json
{
  "keyword": "不羡仙朝阳店",
  "name": "不羡仙",
  "city": "北京",
  "district": "朝阳区",
  "address": "阜通东大街6号"
}
```

路由规则：

- 使用 `getAuthUser`。
- `requireRole(user, "system_admin")`。
- 调用 `geocodeStoreLocation(body)`。
- 成功返回坐标和 provider。
- 失败返回 `502 LOCATION_GEOCODE_FAILED`。

## Admin Web Design

### API Wrapper

`apps/admin-web/src/api.js` 新增：

```js
export function geocodeStoreLocation(body) {
  return apiRequest("/api/admin/location/geocode", {
    method: "POST",
    body
  });
}
```

### StoreDrawer Flow

`searchPoiByKeyword` 保持单一入口：

1. 归一化关键词。
2. 如果有腾讯前端 key，先读 POI 本地缓存。
3. 如果缓存有候选，展示候选并停止。
4. 如果缓存为空候选，调用 `geocodeAddressFallback`。
5. 如果没有缓存，调用腾讯 POI。
6. 如果 POI 有候选，展示候选、写缓存并停止。
7. 如果 POI 无候选，写空缓存并调用 `geocodeAddressFallback`。
8. 如果 POI 报错，调用 `geocodeAddressFallback`。

`geocodeAddressFallback`：

- 调 `geocodeStoreLocation`。
- 传 `keyword/name/city/district/address`。
- 成功后只写：

```js
model.latitude = fixedCoordinate(result.latitude);
model.longitude = fixedCoordinate(result.longitude);
```

- 不改 `model.address`、`model.name`、`model.city`、`model.district`。
- 如果地图已打开，居中并更新 marker。
- 提示 `POI 不可用，已通过腾讯地址解析回填坐标` 或 `...高德地址解析...`。

### UI

位置搜索区仍展示在位置设置中：

- 有腾讯前端 key：按钮文案保持“搜索”，语义是“POI 优先，地址解析兜底”。
- 无腾讯前端 key：仍可使用服务端地址解析按钮，文案可为“解析坐标”。
- 帮助文案补充“POI 无候选或没额度时会用地址解析，只回填坐标”。

## Mini Program Boundary

D36 不改小程序：

- 小程序 admin catalog 继续只用 `uni.chooseLocation`、`uni.openLocation` 和手填坐标。
- 不新增 `qqmap-wx-jssdk`。
- 不调用腾讯 `/ws/place/v1/search` 或 `/ws/geocoder/v1`。
- 不下发高德 key。

## Error Handling

Backend:

- 地址为空返回 400。
- provider 缺 key 时跳过该 provider。
- provider 网络失败、非 0/1 状态、无坐标或低可信时记录为失败原因并尝试下一个 provider。
- 全部失败返回 502，details 只包含 provider/status/message，不包含 key。

Admin web:

- POI 成功时保持现有候选列表。
- POI 没额度或失败但地址解析成功时展示兜底成功文案。
- 兜底失败时展示“地点搜索和地址解析都失败，可地图点选或手填坐标”。
- 不清空已有坐标。

## Testing Strategy

新增 `scripts/d36-admin-location-geocode-check.js` 覆盖：

- 后端存在 `apps/api/src/modules/location/geocoding.js`。
- API config 包含 `TENCENT_MAP_SERVICE_KEY`、`TENCENT_MAP_KEY`、`AMAP_WEB_SERVICE_KEY`。
- server 暴露 `POST /api/admin/location/geocode`，且要求 `system_admin`。
- geocoding module 先调用腾讯 `apis.map.qq.com/ws/geocoder/v1`，再调用高德 `restapi.amap.com/v3/geocode/geo`。
- geocoding module 检查 `reliability`、`level` 和合法经纬度。
- admin web `searchPoiByKeyword` 中 `requestTencentPoiSearch` 出现在 `geocodeAddressFallback` 之前。
- admin web fallback 成功只写 `model.latitude` 和 `model.longitude`。
- `api.js` 有 `geocodeStoreLocation`。
- `package.json` 的 `npm run check` 包含 D36 检查。

最终验证：

- `node scripts/d36-admin-location-geocode-check.js`
- `node --check apps/api/src/modules/location/geocoding.js`
- `node --check apps/api/src/server.js`
- `npm --workspace apps/admin-web run build`
- `npm run check`
