# D38 Design: “我的 / 同城”车局发现

更新日期：2026-07-10

## Overview

D38 将一个混合“管理 + 过滤”的日历改成两个稳定的数据域：

```text
我的
  数据源 = 我发起的车局 + 我的有效报名
  目标 = 管理、处理和回顾

同城
  数据源 = 独立发现接口
  目标 = 找到当前还能参加的新车局
```

同城不是“所有未开本”的字面集合，而是可行动集合。每张卡片必须同时满足：已发布招募、尚未开本、仍有开放座位、允许同城展示、不是我发起、我也没有有效报名。

定位只在用户主动点击“同城”后发生。定位成功时识别城市并在同日按距离排序；定位被拒绝、不可用或逆地址解析失败且没有有效缓存时，返回按开本时间排序的最近 5 辆候选车局。位置只保存在小程序本地 24 小时，不写服务端数据表。

## Product Rules

### “我的”

- 默认激活。
- 保留当前 `sessions + signups` 合并和去重语义。
- 保留发起身份、管理、退出/隐藏、待处理状态、历史和相册入口。
- 删除筛选级别的“发起”和“待处理”，卡片本身继续表达这些状态。

### “同城”

- 独立加载，首次切换时才请求。
- 只返回用户尚未参与的新机会。
- 同城模式按日期升序，同日按距离升序。
- 时间降级模式最多 5 辆，按精确开本时间升序。
- 卡片不显示管理、删除或退出动作。
- 点击整张卡进入现有 `/pages/session/detail?id=...`。

### 可发现性

复用现有 `sessions.visibility`：

```text
public      -> 允许进入同城发现
share_only  -> 仅通过已有分享链接传播
```

不增加数据库列，不迁移旧数据。创建流程增加“同城展示”开关，默认开启，新车局发送 `public`；关闭时发送 `share_only`。旧车局继续保留当前值，避免未经车头同意扩大曝光。

## Data Flow

### 首次进入

```text
首页加载
  -> 默认“我的”
  -> 只请求 /api/users/me/sessions 和 /api/users/me/signups
  -> 不请求位置
```

### 点击“同城”

```text
读取本地 D38 位置缓存
  缓存存在且小于 24h
    -> 请求 discovery，携带 city + latitude + longitude

  缓存不存在或过期
    -> uni.getLocation({ type: "gcj02" })
       成功 -> 请求 discovery，携带 latitude + longitude
       失败/拒绝 -> 请求 discovery，不携带位置
```

### 服务端 discovery

```text
有 city
  -> 校验 city 和坐标
  -> 按 city 查询，mode = city

无 city 但有坐标
  -> 腾讯逆地址解析
  -> 失败时高德逆地址解析
  -> 成功：按 city 查询，mode = city
  -> 全失败：时间降级，mode = time_fallback

无 city 且无坐标
  -> 时间降级，mode = time_fallback
```

### 客户端缓存

当 discovery 返回 `mode = city` 且包含城市时，小程序写入：

```json
{
  "city": "北京市",
  "latitude": 39.9042,
  "longitude": 116.4074,
  "cachedAt": 1783632000000
}
```

缓存 key：

```text
pinche_city_discovery_location
```

缓存只存在本地存储。超过 24 小时、字段不完整或坐标非法时立即忽略并删除。

## Backend Design

### Reverse Geocoding

扩展：

```text
apps/api/src/modules/location/geocoding.js
```

新增导出：

```js
export async function reverseGeocodeCity(input, options = {})
```

输入：

```json
{
  "latitude": 39.9042,
  "longitude": 116.4074
}
```

统一返回：

```json
{
  "provider": "tencent",
  "city": "北京市",
  "province": "北京市",
  "latitude": 39.9042,
  "longitude": 116.4074
}
```

Provider 顺序固定：

1. 腾讯 `https://apis.map.qq.com/ws/geocoder/v1/`，参数使用 `location=lat,lng`、`get_poi=0`。
2. 高德 `https://restapi.amap.com/v3/geocode/regeo`，参数使用 `location=lng,lat`。
3. 两者均失败时返回可识别的 location resolve error，由 discovery 路由降级，不把错误直接暴露给小程序。

城市归一化：

- 去首尾空白。
- 最大长度 64。
- 保留数据库 `stores.city` 当前使用的中文行政区名称。
- 查询时兼容 `北京` 与 `北京市` 这种末尾“市”差异，使用精确规范值优先、去“市”规范值兜底。

### Discovery Service

在 `apps/api/src/modules/core/service.js` 新增：

```js
export async function listDiscoverableSessions(user, filters = {})
```

基础候选条件：

```sql
session.status = 'recruiting'
AND session.start_at > CURRENT_TIMESTAMP
AND session.visibility = 'public'
AND session.organizer_user_id <> :userId
AND EXISTS (
  SELECT 1
  FROM session_seats open_seat
  WHERE open_seat.session_id = session.id
    AND open_seat.status = 'open'
)
AND NOT EXISTS (
  SELECT 1
  FROM signups mine
  WHERE mine.session_id = session.id
    AND mine.user_id = :userId
    AND mine.status IN ('pending', 'approved')
)
```

查询连接 `stores`，返回：

```text
session.id
session.script_name_snapshot
session.store_name_snapshot
session.start_at
session.status
session.visibility
store.city
store.district
store.latitude
store.longitude
seat_count
available_seat_count
distance_km（有请求坐标和店家坐标时）
```

不返回：

- organizer 手机号或 open_id。
- 车局私密 `note`。
- 报名联系方式。
- 用户请求坐标。

距离使用 MySQL Haversine 表达式，输入坐标先通过现有坐标范围规则校验。计算结果使用公里，响应保留一位小数。没有完整店家坐标时返回 `distance_km = null`。

排序：

```text
city mode:
  DATE(session.start_at) ASC
  distance_km IS NULL ASC
  distance_km ASC
  session.start_at ASC
  session.id ASC

time_fallback mode:
  session.start_at ASC
  session.id ASC
  LIMIT 5
```

同城 mode 默认上限 50，服务端硬上限 100。前端继续使用现有分段加载，每次显示 6 辆。

### API Route

新增：

```text
POST /api/sessions/discovery
```

路由在通用 `/api/sessions/:id` 之前匹配。

发现接口使用 POST，是因为请求包含精确坐标。坐标放在请求体中可以避免其默认进入浏览器历史、URL 和常见网关访问日志；该接口仍是只读操作，不产生业务数据。

认证：

- 使用 `getAuthUser(request)`。
- 未登录返回现有 401。

请求体：

```text
latitude   optional
longitude  optional
city       optional，来自服务端曾返回的本地缓存
limit      optional
```

响应：

```json
{
  "ok": true,
  "data": {
    "mode": "city",
    "city": "北京市",
    "location_provider": "tencent",
    "sessions": [
      {
        "id": 42,
        "script_name_snapshot": "秦风颂",
        "store_name_snapshot": "不羡仙",
        "store_city": "北京市",
        "store_district": "朝阳区",
        "start_at": "2026-07-12 13:00:00",
        "status": "recruiting",
        "seat_count": 6,
        "available_seat_count": 2,
        "distance_km": 4.3
      }
    ]
  }
}
```

降级响应：

```json
{
  "ok": true,
  "data": {
    "mode": "time_fallback",
    "city": null,
    "location_provider": null,
    "sessions": []
  }
}
```

逆地址解析失败不是接口失败。数据库失败、认证失败和非法输入仍使用现有统一错误响应。

## Mini Program Design

### Permission Declaration

更新 `apps/miniprogram/src/manifest.json`：

- `scope.userLocation.desc` 改为同时覆盖主动选店和同城车局发现。
- `requiredPrivateInfos` 保留 `chooseLocation`，增加 `getLocation`。
- 不增加后台持续定位。

### Discovery Utility

新增：

```text
apps/miniprogram/src/utils/cityDiscovery.js
```

职责：

- 校验 GCJ-02 坐标数值范围。
- 读取、校验、过期和写入 24 小时本地缓存。
- Promise 化 `uni.getLocation`。
- 区分拒绝授权、运行环境不可用和普通定位失败。
- 生成 discovery 请求体。

该模块不负责渲染，也不保存服务端状态。

### SessionCalendar State

`SessionCalendar.vue` 保持共享组件，并在组件内管理 discovery 状态，使首页和“我的”页行为一致：

```text
activeFilter: mine | city
citySessions: []
cityLoading: false
cityLoaded: false
cityMode: city | time_fallback | ""
cityName: ""
cityLocationState: idle | locating | located | denied | unavailable
cityStatusText: ""
```

标签固定：

```js
[
  { value: "mine", label: "我的", count: mineItems.length },
  { value: "city", label: "同城", count: cityItems.length }
]
```

两个标签始终显示，即使计数为 0。删除 `organizedCount`、`pendingCount` 和对应筛选分支；卡片级 `isOrganized`、`isPending` 继续保留。

### Home Entry Contract

已登录用户的我的数据加载成功后，首页始终进入 `calendar` 状态，即使 `sessions` 和 `signups` 都为空。这样新用户仍能从“同城”发现可加入的车局；日历顶部现有“开始发车（点击创建）”入口继续保留。`first-session` 只用于未登录入口，不再由“我的为空”触发。

### Lazy Location Flow

`setFilter("city")`：

1. 切换 active filter 并重置分页和日期定位。
2. 若 `cityLoaded` 为 true，直接展示缓存结果。
3. 读取 24 小时位置缓存。
4. 有缓存时请求 discovery。
5. 无缓存时调用 `uni.getLocation({ type: "gcj02" })`。
6. 定位成功后请求 discovery。
7. 定位失败或拒绝后请求无位置 discovery，并保留授权提示。
8. 响应为 city mode 时写本地缓存。
9. 401 时沿用 `auth-expired` 事件。

下拉刷新职责：

- “我的”激活时继续 `emit("refresh")`，由页面重新加载 sessions 和 signups。
- “同城”激活时由组件重新校验缓存并调用 discovery，不触发页面的我的数据刷新。
- 有效缓存继续复用；缓存过期时才重新调用 `getLocation`。
- `scroll-view` 的 `refresher-triggered` 根据当前 scope 选择父级 `refreshing` 或组件 `cityRefreshing`，避免两个数据源互相结束刷新状态。

授权提示动作：

- 用户点击“开启定位”时调用 `uni.openSetting`。
- 设置页返回且位置权限已开启时重新定位和加载。
- `openSetting` 不可用时直接再次调用 `getLocation`。
- 不在定时器或页面 onShow 中反复弹授权。

### Calendar Items

“我的”继续使用：

```js
mergeCalendarItems(props.sessions, props.signups)
```

“同城”新增：

```js
createDiscoveryCalendarItems(citySessions)
```

发现卡字段：

```text
type = city
isOrganized = false
isJoined = false
canManage = false
canRemove = false
roleText = 剩余 N 位
metaText = 距离 4.3km 或 同城可报名
statusText = 招募中
albumFirst = false
```

模板把动作区改为仅在 `item.canManage || item.canRemove` 时渲染。同城卡点击继续走 `handleCalendarCardTap`，进入详情。

### Sort and Date Bands

“我的”保持现有日期降序。“同城”使用服务端顺序的日期升序。日期 gap、日期选择和“归位”辅助函数需要显式支持两种排序方向，不能依赖日期始终降序。

切换标签时：

- `loadedCalendarCount = 6`。
- 清空 `scrollIntoViewId`。
- 按当前数据源重新计算日期目标。
- 不让同城结果改变我的折叠状态；折叠 key 按 scope 隔离或切换时重置。

### Status and Empty States

同城状态优先级：

```text
loading -> 正在查找可参加的同城车局...
time_fallback -> 定位未开启，暂按开本时间推荐
city empty -> {city}暂无可报名车局
fallback empty -> 暂无可报名车局
request error -> 同城车局加载失败，请稍后重试
```

授权提示与降级卡片同时存在，不用整页错误替换结果。

## Create Flow Design

### State

`createFlow` 新增：

```text
cityVisible: boolean
```

默认值为 `true`。`setup.vue` 读取并持久化该字段。

### UI

在“上车权限”设置区增加一行：

```text
同城展示               已开启 [switch]
开启后，同城玩家可以发现这辆车；关闭后仅通过分享链接加入。
```

使用现有 `t-switch` 样式，不新增卡片或说明页。

### Payload

创建车局：

```js
visibility: this.cityVisible ? "public" : "share_only"
```

后端新增 `normalizeSessionVisibility`，创建和更新都只接受 `public`、`share_only`。不迁移现有车局。

## Error Handling

Backend:

- 非法坐标返回 400。
- 城市过长或非法返回 400。
- 逆地址解析 provider 缺 key、超额、超时或无城市时进入时间降级。
- 不在错误 details 中返回地图 key、完整 provider URL 或用户坐标。
- 单个店家缺坐标不影响城市列表，只让距离为空并排在同日末尾。

Mini program:

- 用户取消或拒绝定位不 toast 轰炸，使用同城区域内联提示。
- 定位 API 不存在时进入 time fallback。
- discovery 请求失败时保留已有结果，并显示轻量状态。
- 本地缓存损坏或过期时删除并重新定位。
- 位置设置返回仍未授权时保持 fallback，不循环打开设置。

## Testing Strategy

### D38 Static Check

新增：

```text
scripts/d38-city-session-discovery-check.js
```

检查：

- spec 三件套存在。
- SessionCalendar 标签固定为“我的 / 同城”，不存在旧筛选标签。
- 同城数据来自 `/api/sessions/discovery`。
- discovery 使用 POST 请求体，不把坐标拼进 URL。
- 同城卡片不显示管理/删除动作。
- 已登录且我的列表为空时首页仍渲染日历。
- setup 有“同城展示”开关并发送 visibility。
- manifest 声明 `getLocation`，描述包含同城发现。
- API route、service 和 reverse geocode 导出存在。
- 服务查询包含全部 eligibility 条件。
- `npm run check` 包含 D38 检查。

### Unit Checks

新增或扩展脚本覆盖：

- 位置缓存小于 24 小时有效，过期无效。
- 坐标校验和 discovery 请求体生成。
- 腾讯逆地址解析成功。
- 腾讯失败转高德。
- 两者失败进入 discovery time fallback。

### Backend Smoke

新增：

```text
scripts/d38-city-session-discovery-smoke.js
```

本地数据库场景至少包括：

- 同城公开、未来、招募中且有空位的其他用户车局被返回。
- 草稿、锁车、取消、已开本、满员、share_only 不返回。
- 自己发起和自己已报名不返回。
- city mode 返回距离并按日期/同日距离排序。
- 无位置 mode 最多 5 辆并按 start_at 排序。
- discovery 未登录返回 401。

### Final Verification

- `node scripts/d38-city-session-discovery-check.js`
- D38 location utility unit check
- D38 reverse geocode unit check
- `node --check apps/api/src/modules/core/service.js`
- `node --check apps/api/src/server.js`
- `node scripts/check-miniprogram.js`
- `npm run check`
- `npm run build:mp-weixin`

微信开发者工具验证：

- 我的标签和原有管理行为。
- 同城首次点击触发定位。
- 定位成功显示城市结果和距离。
- 拒绝定位显示授权提示和最近 5 辆时间推荐。
- 授权设置返回后刷新同城结果。
- 同城卡片无管理/删除，点击进入详情。

## Scope Boundaries

D38 不实现：

- 城市手动切换。
- 兴趣、剧本类型或性别偏好推荐。
- 候补报名。
- 历史车局 visibility 批量迁移。
- 服务端用户位置历史。
- 同城地图视图。
