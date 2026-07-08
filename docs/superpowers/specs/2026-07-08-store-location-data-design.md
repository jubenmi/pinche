# Store Location Data Design

更新日期：2026-07-08

## 背景

当前店家资料只有文本 `address` 字段。管理员 web、用户端私有店家创建和小程序建车流程都能录入地址，但没有保存经纬度，也没有在车局详情中打开地图。

产品目标是让剧本店地址具备地图定位能力，同时让 web 端 admin 和小程序使用同一套店家位置数据。已确认采用数据优先方案：本次先统一保存 `address + latitude + longitude`，小程序使用微信原生地图选点和打开地图；admin web 先支持手填经纬度，不接第三方地图 SDK。

统一边界是数据层，不是地图组件层。小程序内置地图能力只能在小程序运行环境中使用；admin web 后续需要地图选点时，应接腾讯位置服务 Web SDK 或 WebService API，但读写同一套 `stores` 坐标字段。

## 目标

1. 店家资料统一保存地址、纬度和经度。
2. 管理员 web 创建和编辑店家时可以录入、查看、保存纬度和经度。
3. 小程序用户补录私有店家时可以通过地图选点回填地址、纬度和经度。
4. 车局详情页在有经纬度时可以打开微信地图查看或导航。
5. 旧店家数据继续可用；没有经纬度时仍展示文本地址，不阻塞建车。
6. API 对 admin web 和小程序返回同一套位置字段。
7. 小程序和 web 端统一使用 GCJ-02 坐标写入 `latitude` 和 `longitude`。

## 非目标

- 不在 admin web 本次接入腾讯地图、高德地图或其他 web 地图 SDK。
- 不做附近店家、距离排序、按用户当前位置筛选。
- 不调用 `getLocation` 主动读取或保存用户当前位置；小程序 `chooseLocation` 可能触发微信位置接口授权和后台声明，但只用于用户主动地图选点。
- 不批量地理编码历史地址。
- 不混存 WGS-84、BD-09 或其他坐标系。
- 不改变店家审核、私有资料、店剧关联和建车主流程。

## 已确认方案

采用方案 C：先打通统一位置数据，web 端地图选点后续再做。

原因：

- 数据模型和 API 是地图能力的基础，先统一能减少后续返工。
- 小程序已有微信原生 `chooseLocation` 和 `openLocation`，可以低成本实现选点和打开地图。
- 小程序内置地图能力不能直接复用到普通 web 页面。admin web 地图选点需要腾讯位置服务 key、域名白名单、加载策略和授权配置，适合作为后续单独迭代。
- 小程序内置地图和腾讯位置服务均可围绕 GCJ-02 坐标工作，适合作为跨端共享坐标格式。

## 数据模型

在 `stores` 增加两个可空字段：

```sql
ALTER TABLE stores
  ADD COLUMN latitude DECIMAL(10, 7) NULL AFTER address,
  ADD COLUMN longitude DECIMAL(10, 7) NULL AFTER latitude;
```

字段语义：

- `address`: 文本地址，继续保留。
- `latitude`: GCJ-02 纬度，允许为空，范围 `-90` 到 `90`。
- `longitude`: GCJ-02 经度，允许为空，范围 `-180` 到 `180`。

本次不新增 `coordinate_system` 字段。业务约定 `stores.latitude` 和 `stores.longitude` 永远按 GCJ-02 保存；如果后续从其他地图或 GPS 来源导入坐标，必须在写入前转换为 GCJ-02。

兼容规则：

- 旧数据默认 `latitude = NULL`、`longitude = NULL`。
- 只有地址没有经纬度时，前端只展示地址，不显示地图打开动作。
- 有经纬度但地址为空时，地图仍可打开，名称使用店名。
- admin web 手填坐标时，表单需要标注坐标系为 GCJ-02，避免运营把 WGS-84 或百度 BD-09 坐标直接填入。

## 后端设计

### 字段透传

以下接口需要接收并返回 `latitude` 和 `longitude`：

- `GET /api/stores`
- `POST /api/stores`
- `GET /api/admin/stores`
- `POST /api/admin/stores`
- `PATCH /api/admin/stores/:id`
- 管理员审核店家资料时涉及的店家编辑和列表响应

已有 `SELECT * FROM stores` 的列表可以自然返回新增字段，但创建、更新和审核编辑路径需要显式允许写入。

### 坐标系约定

后端不按请求来源保存不同坐标系，统一把入库值视为 GCJ-02：

- 小程序 `chooseLocation` 返回的坐标可直接入库。
- 小程序 `openLocation` 读取入库坐标可直接打开。
- admin web 手填坐标按 GCJ-02 解释。
- 后续接入腾讯位置服务 Web SDK 时，选点结果应直接写入同一字段。
- 后续如接入其他来源的 WGS-84 或 BD-09 坐标，转换应发生在写入前，不在展示时临时猜测。

### 校验

后端增加统一数字校验：

- 空字符串、`null`、`undefined` 统一保存为 `NULL`。
- 纬度必须是有限数字，范围 `-90 <= latitude <= 90`。
- 经度必须是有限数字，范围 `-180 <= longitude <= 180`。
- 只填一个坐标时允许保存，但前端打开地图时要求两个坐标都存在。

坐标校验失败返回 `400`，错误信息指出字段和值域。

### 建车快照

本次不新增 `sessions` 的地址或坐标快照字段。车局详情需要地图信息时，通过 `session.store_id` 读取当前店家资料，或在详情接口中附带店家位置字段。

第一版推荐在详情响应中附带：

```json
{
  "store_id": 123,
  "store_name_snapshot": "谜雾剧场（望京店）",
  "store_address": "北京市朝阳区...",
  "store_latitude": 39.9981,
  "store_longitude": 116.4803
}
```

名称继续使用 `store_name_snapshot`，避免店家改名影响历史车局标题；地址和坐标用于当下导航，允许随店家资料修正而更新。

## Admin Web 设计

`StoreDrawer` 在现有地址字段后增加两个输入：

- 纬度（GCJ-02）
- 经度（GCJ-02）

行为：

- 新增店家和编辑店家都显示这两个字段。
- 保存时把 `latitude`、`longitude` 与 `address` 一起提交。
- 列表仍以店名、城市、区域、地址为主要信息，不强制新增列表列，避免表格拥挤。
- 有经纬度时可以在详情/表单附近显示轻量提示，例如 `已填写坐标`；这不是本次必需项。
- 输入帮助文案说明：小程序地图和后续腾讯地图 web 选点共用 GCJ-02 坐标。

本次不做：

- 地图弹窗选点。
- 自动把地址转经纬度。
- 第三方地图脚本加载和 key 配置。
- 从小程序内置地图能力迁移或复用 web 地图组件。

## 小程序设计

### 私有店家创建

`pages/session/create.vue` 的“添加给自己用”表单增加地图选点动作：

- 点击 `地图选点` 调用 `uni.chooseLocation`。
- 成功后回填 `storeForm.address`、`storeForm.latitude`、`storeForm.longitude`。坐标按 GCJ-02 入库。
- 如果用户取消选点，保留原表单，不报错。
- 如果运行环境不支持 `chooseLocation`，提示用户手动填写地址。
- `chooseLocation` 需要按微信要求完成位置接口权限开通和 app 配置声明；本功能不调用 `getLocation` 读取用户当前位置，也不保存用户位置。

表单仍允许只填写文本地址；坐标不是必填。

### 创建流程传递

选中的店家对象需要保留 `address`、`latitude`、`longitude`，以便后续页面或提交时使用同一数据。创建车局仍只提交 `storeId`，不把坐标复制到创建请求里。

### 车局详情打开地图

`pages/session/detail.vue` 的基础信息中增加地址显示：

- 有 `store_address` 时显示店家地址。
- 同时存在 `store_latitude` 和 `store_longitude` 时显示 `查看地图` 按钮。
- 点击后调用 `uni.openLocation`，传入店名、地址、纬度、经度。
- 缺坐标时不显示地图按钮，只展示地址文本。
- `openLocation` 使用入库 GCJ-02 坐标，不做坐标转换。

失败处理：

- `openLocation` 失败时展示轻量 toast，例如 `地图打开失败，请稍后再试`。
- 坐标缺失或非法时不调用 `openLocation`。

## 测试与验收

1. 迁移文件给 `stores` 增加 `latitude` 和 `longitude`，且可重复执行。
2. 后端创建私有店家时能保存合法坐标。
3. 后端管理员创建和编辑店家时能保存合法坐标。
4. 后端拒绝超出范围的纬度和经度。
5. `GET /api/stores` 和 `GET /api/admin/stores` 返回坐标字段。
6. 车局详情响应包含店家地址和坐标字段。
7. admin web 店家表单展示 GCJ-02 纬度和经度输入，并随保存 payload 提交。
8. 小程序添加店家表单存在地图选点入口，选点成功后回填地址和 GCJ-02 坐标。
9. 小程序车局详情有坐标时显示地图入口，缺坐标时不显示。
10. 没有坐标的旧店家仍可搜索、选择和建车。
11. spec 和代码注释不把小程序内置地图能力描述为可直接复用于 admin web。

## 自检

- 本设计把 admin web 和小程序统一到同一套 `stores` 位置字段，而不是试图统一地图组件。
- 本设计明确 web 地图 SDK 选点不在本次范围，避免引入地图供应商配置风险。
- 旧数据和现有建车流程保持兼容。
- 坐标校验范围、空值策略和 GCJ-02 坐标系约定明确。
- 小程序只在有完整坐标时打开地图，不会因为旧数据缺坐标而报错。
