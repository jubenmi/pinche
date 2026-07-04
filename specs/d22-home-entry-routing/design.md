# D22 Design: 首页车局分流设计

更新日期：2026-07-04

## Overview

D22 将首页改造成用户下一步工作台。首页仍是 `/pages/index/index`，但不再只展示“创建 / 我的”两个入口。它会先处理维护态，再根据认证和车局数据展示：

- 首车入口：未登录用户和登录无车用户共用。
- 车局日历：登录且已有发起或参与车局的用户看到。

首页点击发车或开始发车后，仍进入当前发车流程第一步 `/pages/session/create`。D22 不改变发车流程页面顺序和后端业务模型。

## State Flow

```text
on home load/show
  -> sync backend status
  -> if maintenance:
       render maintenance state
       stop private calendar loading
  -> else if no user or no token:
       render first-session entry
  -> else:
       render loading state
       load /api/users/me/sessions?limit=50
       load /api/users/me/signups
       if either request fails:
         render load error
       else if merged calendar items length == 0:
         render first-session entry
       else:
         render session calendar
```

未登录用户点击 `开始发车` 后不是立即进入发车流程，而是：

```text
ensureLoggedIn()
  -> if cancelled or failed:
       stay on first-session entry
  -> if success:
       reload my sessions and my signups
       if merged calendar items length > 0:
         render session calendar
       else:
         clearCreateFlow()
         navigateTo /pages/session/create
```

## Frontend Structure

### `apps/miniprogram/src/pages/index/index.vue`

首页负责状态壳：

- 维护态。
- 首车入口。
- 登录后加载态。
- 加载错误态。
- 车局日历态。
- 首页分享回调。
- 首页级 `开始发车` 和 `发车` 导航。

首页应复用现有：

- `AuthIdentityBar`
- `checkBackendHealth()`
- `getBackendStatus()`
- `ensureLoggedIn()`
- `getCurrentUser()`
- `getToken()`
- `clearAuth()`
- `request()`
- `clearCreateFlow()`
- `showWechatShareMenus()`

### `apps/miniprogram/src/components/SessionCalendar.vue`

推荐新增组件承载日历展示和卡片行为。该组件从现有 `pages/mine/index.vue` 的日历 UI 与行为抽出，避免首页和“我的”复制两套逻辑。

组件职责：

- 接收 `sessions` 和 `signups`。
- 合并发起车局和参与车局。
- 计算全部、发起、参与、待处理数量。
- 渲染筛选、日期工具、日期分组、车局卡片和加载更多。
- 处理卡片点击、删除、退出车头、隐藏参与关系。
- 在操作后通过事件通知父页面重新加载。

组件不负责：

- 首页维护态。
- 首页分享。
- 是否展示首车入口。
- 用户是否登录。

### `apps/miniprogram/src/pages/mine/index.vue`

“我的”页继续保留，但应改为复用 `SessionCalendar`。它仍可以保留个人入口语义，例如管理员入口和退出入口；日历本体不应与首页分叉。

## UI Design

### 首车入口

首车入口使用现有首页品牌资产，但行动更单一：

- 标题：`发起第一辆车`
- 说明：`先选店家和剧本，几步就能生成分享卡片。`
- 主按钮：`开始发车`
- 辅助文案：`之后你的发车、报名和相册都会自动汇总到首页。`

按钮行为：

- 未登录：先登录，再重新判定。
- 已登录无车：清空创建流程，进入 `/pages/session/create`。

### 车局日历

日历顶部从“我的拼车日程”调整为首页工作台语义：

- 标题：`我的车局`
- 副文案：`X 场车局 · 最近更新刚刚`
- 主按钮：`发车`

管理员入口和退出入口保留为弱操作，不能抢占 `发车` 的主行动视觉。日历筛选和卡片布局沿用当前“我的”页的降噪版本。

### 加载和错误

登录后判定车局前展示加载态：

```text
正在整理你的车局...
```

加载失败时展示：

```text
车局加载失败，请稍后重试。
```

并提供重试按钮。加载失败不能自动进入首车入口，也不能自动进入发车流程。

## Data Model And Mapping

首页分流复用现有接口：

| 数据 | 接口 | 用途 |
| --- | --- | --- |
| 我的发车 | `GET /api/users/me/sessions?limit=50` | 车头发起的车局 |
| 我参与的车 | `GET /api/users/me/signups` | 报名、上车和待审核关系 |

“有车局”判定：

```text
mergedCalendarItems = merge(mySessions, mySignups)
hasCalendarItems = mergedCalendarItems.length > 0
```

合并逻辑沿用当前“我的”页：同一 session 同时出现在发起和参与时只展示一张卡片，并保留必要身份标记。

## Error Handling

- 无 token：展示首车入口。
- 用户缓存存在但无 token：清理认证并展示首车入口。
- 401：清理认证，展示首车入口，提示 `登录已过期，请重新登录。`
- 维护或网络失败：展示错误和重试，不误判无车。
- 单个私有列表接口失败：展示错误和重试，不误判无车。
- 登录取消：留在首车入口。

## Share Behavior

首页继续注册：

- `onShareAppMessage`
- `onShareTimeline`

分享路径继续为 `/pages/index/index`。分享接收者进入后按自己的账号状态展示首车入口或车局日历。D22 不新增公共增长落地页。

## Verification

自动验证：

```text
npm run check
npm run build:mp-weixin
```

建议扩展 `scripts/check-miniprogram.js`，覆盖：

- 首页包含首车入口文案 `发起第一辆车` 和 `开始发车`。
- 首页保留维护态。
- 首页保留微信分享回调。
- 首页未登录点击开始发车会先调用 `ensureLoggedIn()`。
- 首页登录成功后会加载 `/api/users/me/sessions` 和 `/api/users/me/signups`。
- 首页在已有车局时展示 `我的车局` 和 `发车`。
- 首页发车按钮调用 `clearCreateFlow()` 后进入 `/pages/session/create`。
- “我的”页和首页复用同一日历组件。

微信开发者工具验证：

```text
1. 无 token 进入首页，看到首车入口。
2. 未登录点击开始发车，先触发微信登录。
3. 登录后账号没有车局，进入发车流程。
4. 登录后账号已有车局，进入车局日历。
5. 日历点击发车，进入当前发车流程。
6. 日历卡片操作与原“我的”页一致。
7. 后端维护时只展示维护态。
```

## Non-Goals

- 不做公开车局发现页。
- 不做首页自动创建草稿。
- 不改变发车流程内部步骤。
- 不改变相册开放规则。
- 不改变删除、退出车头、隐藏参与关系的业务规则。
