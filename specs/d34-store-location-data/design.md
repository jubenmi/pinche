# D34 Design: 店家地图定位数据统一设计

更新日期：2026-07-08

## Overview

D34 给店家资料增加统一位置数据：`address` 继续作为文本地址，新增 `latitude` 和 `longitude` 保存 GCJ-02 坐标。小程序用微信内置地图能力选点和打开地图；admin web 使用腾讯位置服务 Web SDK 选点，并在地图不可用时保留手填坐标。

本设计不迁移到微信云开发，不改变现有自建 API 架构。小程序、admin web 和后端继续通过现有 `apps/api` 交互。

## Data Model

### `stores` 位置字段

新增迁移给 `stores` 增加可空坐标字段：

```sql
ALTER TABLE stores
  ADD COLUMN latitude DECIMAL(10, 7) NULL AFTER address,
  ADD COLUMN longitude DECIMAL(10, 7) NULL AFTER latitude;
```

字段语义：

- `address`: 文本地址，保留现有字段。
- `latitude`: GCJ-02 纬度，范围 `-90..90`，允许为空。
- `longitude`: GCJ-02 经度，范围 `-180..180`，允许为空。

迁移要求：

- 使用与现有迁移一致的幂等写法，避免重复执行报错。
- 旧数据坐标为空，不改变店家上下架、审核、私有资料状态。
- 不新增 `coordinate_system` 字段。业务约定所有店家坐标均为 GCJ-02。

## Coordinate Convention

统一的是数据层：

```text
stores.address
stores.latitude   GCJ-02
stores.longitude  GCJ-02
```

前端能力分端实现：

- 小程序：`uni.chooseLocation` 写入坐标，`uni.openLocation` 打开坐标。
- admin web：使用腾讯位置服务 Web SDK 点选坐标，或手填和回显坐标。
- 后续地址解析：使用服务端 WebService API Key 代理，继续写入同一字段。

禁止混存：

- WGS-84 坐标必须先转换为 GCJ-02 再写入。
- 百度 BD-09 坐标必须先转换为 GCJ-02 再写入。
- 后端不按请求来源猜测坐标系。

## Backend Design

### 归一化和校验

在 `apps/api/src/modules/core/service.js` 增加内部 helper：

```text
optionalCoordinate(value, fieldName, min, max)
optionalLatitude(value)
optionalLongitude(value)
```

规则：

- `undefined`、`null`、空字符串保存为 `NULL`。
- 非有限数字返回 400。
- 纬度小于 `-90` 或大于 `90` 返回 400。
- 经度小于 `-180` 或大于 `180` 返回 400。
- 只填一个坐标允许保存，但前端只有两个坐标都存在时才打开地图。

### 店家创建和编辑

需要更新的服务路径：

- `createPrivateStore(user, body)`
- `createStore(user, body)`
- `updateStore(id, body)`
- 管理员待审核店家编辑路径中对 `stores` 字段的 allowlist

写入规则：

```text
latitude = optionalLatitude(body.latitude)
longitude = optionalLongitude(body.longitude)
```

现有 `assertPublicTextSafe` 继续只处理文本字段；坐标使用数字范围校验。

### 店家列表响应

现有列表大多使用 `SELECT * FROM stores`，新增字段会自然出现在响应中。实现时仍需要检查这些路径：

- `GET /api/stores`
- `GET /api/admin/stores`
- 管理员待审核资料列表和编辑返回

如果某个响应使用显式字段列表，需要追加：

```text
address
latitude
longitude
```

### 车局详情响应

`sessions` 不新增坐标快照字段。详情接口在读取车局时附带当前店家位置：

```json
{
  "store_id": 123,
  "store_name_snapshot": "谜雾剧场（望京店）",
  "store_address": "北京市朝阳区...",
  "store_latitude": 39.9981000,
  "store_longitude": 116.4803000
}
```

设计原因：

- 名称继续使用 `store_name_snapshot`，避免店家改名影响历史车局。
- 地址和坐标用于当前导航，允许管理员修正后即时生效。
- 旧车局对应店家没有坐标时，响应字段可为 `null`。

### 路由影响

`apps/api/src/server.js` 的路由结构不需要新增 path。D34 复用现有店家创建、编辑、列表和车局详情路由。

## Admin Web Design

### StoreDrawer

`apps/admin-web/src/components/StoreDrawer.vue` 在地址字段后增加位置设置区：

- `纬度（GCJ-02）`
- `经度（GCJ-02）`
- `地图选点`，仅在 `VITE_TENCENT_MAP_KEY` 存在时展示

model 字段：

```js
latitude: store.latitude ?? "",
longitude: store.longitude ?? ""
```

提交 payload 保留：

```js
{
  address: model.address,
  latitude: model.latitude,
  longitude: model.longitude
}
```

UI 约束：

- 坐标不是必填。
- 帮助文案说明“admin web 和微信小程序共用 GCJ-02 坐标”。
- 腾讯地图脚本只在管理员打开地图选点时按需加载。
- 地图点击只回填坐标，不自动逆地址解析；地址仍由管理员确认或手填。
- `VITE_TENCENT_MAP_KEY` 缺失或地图加载失败时，保留手填坐标。
- 列表暂不增加坐标列，避免表格拥挤。

## Mini Program Design

### 私有店家地图选点

`apps/miniprogram/src/pages/session/create.vue` 的私有店家表单增加 `地图选点` 动作。

数据结构：

```js
storeForm: {
  name: "",
  city: "北京",
  district: "",
  address: "",
  latitude: "",
  longitude: "",
  contactNote: ""
}
```

选点行为：

```text
tap 地图选点
  if uni.chooseLocation is unavailable:
    toast 手动填写地址
  else:
    uni.chooseLocation()
      success -> address/latitude/longitude 写入 storeForm
      cancel -> 保留原表单
      fail -> 非取消失败展示轻量提示
```

提交私有店家时带上坐标字段。创建成功后，写入 create flow 的店家对象也保留 `address`、`latitude`、`longitude`。

权限和合规：

- `chooseLocation` 需要按微信要求完成位置接口权限开通和 app 配置声明。
- D34 不调用 `getLocation`，不读取或保存用户当前位置。

### 车局详情打开地图

`apps/miniprogram/src/pages/session/detail.vue` 的基础信息增加店家地址和地图入口。

显示规则：

```text
if session.store_address:
  show 地址

if validNumber(session.store_latitude) && validNumber(session.store_longitude):
  show 查看地图
else:
  hide 查看地图
```

打开行为：

```js
uni.openLocation({
  latitude: Number(this.session.store_latitude),
  longitude: Number(this.session.store_longitude),
  name: this.session.store_name_snapshot || "店家",
  address: this.session.store_address || "",
  scale: 18
})
```

失败时展示 `地图打开失败，请稍后再试`。

## Error Handling

后端：

- 坐标非法返回 400。
- 缺坐标不影响创建店家、编辑店家或建车。
- 车局详情找不到店家位置时返回 `null` 字段，不让详情失败。

admin web：

- 后端返回坐标校验错误时沿用现有保存失败提示。
- 空坐标可保存。

小程序：

- 选点取消不提示错误。
- `chooseLocation` 不可用或失败时允许用户手动填写地址。
- 缺坐标时不展示地图入口。
- `openLocation` 失败展示 toast，不影响详情页其他信息。

## Testing Strategy

后端烟测或静态检查覆盖：

- 迁移包含 `latitude` 和 `longitude`。
- 私有店家创建保存合法坐标。
- 管理员创建和编辑保存合法坐标。
- 非法纬度和经度返回 400。
- 店家列表响应包含坐标字段。
- 车局详情响应包含 `store_address`、`store_latitude`、`store_longitude`。

小程序静态检查覆盖：

- 私有店家表单包含地图选点入口。
- 代码调用 `uni.chooseLocation`。
- 创建私有店家 payload 包含坐标字段。
- 详情页调用 `uni.openLocation`。
- 缺坐标时隐藏地图入口。

admin web 静态检查覆盖：

- `StoreDrawer` 包含 GCJ-02 纬度和经度输入。
- 保存 payload 包含 `latitude` 和 `longitude`。
- `StoreDrawer` 通过 `VITE_TENCENT_MAP_KEY` 按需加载腾讯地图 Web SDK。
- `StoreDrawer` 点击地图后回填 `latitude` 和 `longitude`。

最终验证：

- `npm run check`
- `npm run build:mp-weixin`

微信开发者工具内需要手工验证：

- `chooseLocation` 权限声明和真实选点。
- `openLocation` 在真机或开发者工具中打开微信内置地图。

## Scope Boundaries

D34 不实现：

- 地址自动解析经纬度。
- 附近店家和距离排序。
- 用户当前位置读取、存储和推荐。
- 历史地址批量地理编码。
