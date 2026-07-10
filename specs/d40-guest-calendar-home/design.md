# D40 Design: 游客日历首页与发车后隐私

更新日期：2026-07-10

## Architecture

D40 不新建游客页面。首页始终渲染现有 `SessionCalendar`，认证状态只决定数据源、文案和权限：

```text
打开小程序
  -> 后端维护中：现有维护页
  -> 后端可用：日历首页
       -> 未登录：近期车局 + 公开只读详情
       -> 已登录：我的 / 同城 + 现有成员能力
```

首页不再根据“是否登录”或“是否有自己的车局”进入 `first-session`。`pages/index/index.vue` 负责认证状态和数据加载，`SessionCalendar.vue` 继续负责同一套视觉结构和日历交互。

后端增加明确的游客读取边界。公开列表只返回仍可招募的最小卡片字段；普通车局详情根据车局生命周期和访问者身份返回公开预览、成员详情或拒绝。客户端 `entry` 只用于界面模式，不是授权凭证。

## Home State Model

首页状态收敛为：

```text
maintenance
calendar_loading
calendar_ready
calendar_error
```

删除：

```text
first-session
```

认证状态独立于页面状态：

```text
guest
authenticated
```

游客和已登录用户都可能处于 loading、ready 或 error。登录过期时只把认证状态切到 `guest` 并加载公共近期列表，不进行页面级回退。

## Shared Calendar Contract

`SessionCalendar.vue` 增加明确的数据模式 prop，例如：

```js
calendarMode: "guest" | "member"
```

并继续从首页接收当前数据。组件不自行判断 token，避免展示逻辑和认证存储耦合。

### Guest Mode

```text
身份栏        游客浏览 / 登录
主按钮        我的车局（点击登录）
筛选分段      近期车局 N
归档          保持原位置；点击后登录
日期          保持原位置；无需登录
车包          保持原位置；点击后登录
车卡          复用现有卡片；无管理、删除或退出动作
车卡点击      /pages/session/detail?id=<id>&entry=guest
```

### Member Mode

```text
身份栏        现有已登录身份
主按钮        我的车局（点击创建）
筛选分段      我的 / 同城
归档、日期    现有行为
车包          现有行为
车卡          现有我的或同城权限
```

主按钮登录成功后只刷新首页状态，不调用 `goCreate()`。用户再次点击“我的车局（点击创建）”时才进入创建流程。

## Guest Data Flow

```text
首页确认无有效用户/token
  -> GET /api/sessions/public/upcoming?limit=20
  -> 映射成现有 SessionCalendar item
  -> 按现有时间轴、日期 gap、日期选择和分页渲染
```

游客首页不调用：

- `/api/users/me/sessions`
- `/api/users/me/signups`
- `/api/sessions/discovery`
- `uni.getLocation`
- `ensureLoggedIn`

登录成功后首页清空游客数据并并发加载现有“我的”两个接口；“同城”仍保持用户主动点击后才定位和懒加载。

退出登录或 token 过期后首页清空成员数据并加载公共近期接口。

## Public Upcoming API

新增：

```http
GET /api/sessions/public/upcoming?limit=20
```

路由必须位于动态 `/api/sessions/:id` 匹配之前。接口不调用 `getAuthUser()`，也不依赖位置。

服务函数建议为：

```js
export async function listPublicUpcomingSessions(filters = {})
```

基础 SQL：

```sql
session.visibility = 'public'
AND session.status = 'recruiting'
AND session.start_at > CURRENT_TIMESTAMP
AND (
  EXISTS (
    SELECT 1
    FROM session_seats seat
    WHERE seat.session_id = session.id
      AND seat.status = 'open'
  )
  OR EXISTS (
    SELECT 1
    FROM session_npc_roles npc
    WHERE npc.session_id = session.id
      AND npc.status = 'active'
      AND npc.bound_user_id IS NULL
  )
)
ORDER BY session.start_at ASC, session.id ASC
LIMIT :limit
```

`limit` 默认 20，范围固定为 1 到 20。接口不补齐最小数量。

响应只包含：

```json
{
  "sessions": [
    {
      "id": 123,
      "script_name_snapshot": "秦风颂",
      "store_name_snapshot": "不羡仙",
      "store_city": "北京市",
      "store_district": "朝阳区",
      "start_at": "2026-07-12T05:00:00.000Z",
      "status": "recruiting",
      "seat_count": 6,
      "available_seat_count": 3,
      "available_npc_count": 0
    }
  ]
}
```

不返回店家联系方式、用户 ID、open_id、手机号、精确坐标、内部备注、报名信息或相册统计。

测试数据使用隔离数据库。生产验收数据若必须保留，设置为 `share_only`；公共 SQL 不增加依赖命名或账号的脆弱“测试数据识别”条件。

## Session Detail Access

当前 `GET /api/sessions/:id` 无条件调用 `getSession(id)`，发车后普通链接仍可能获得详情。D40 将路由改为可选身份，并由服务端决定访问范围：

```js
const viewer = await optionalAuthUser(request);
const inviteToken = url.searchParams.get("inviteToken");
await getSessionForViewer(sessionId, { viewer, inviteToken });
```

访问范围：

```text
public_preview
  条件：public + recruiting + start_at > now
  可见：公开基础信息、角色开放状态、公开记录
  不可见：成员身份、联系方式、内部备注、相册

member
  条件：车头、确认/锁定座位成员、绑定 NPC 成员或管理员
  可见：按现有成员权限返回

invite_preview
  条件：有效的服务端签名邀请 token
  可见：分享上车所需公开摘要和可选角色
  不可见：完整相册；成功上车后再通过 member 权限获得

denied
  条件：已发车普通链接、share_only 普通链接、取消车局或无效 token
  返回：404 SESSION_NOT_FOUND
```

返回 404 而不是区分 403，避免通过 ID 枚举私密车局。详情响应增加 `access_scope`，前端只根据该服务端结果开放能力。

公开预览必须使用单独的序列化函数，不能直接返回当前包含座位用户字段的完整 `getSession()` 结果。公开座位只表达角色名称和开放、申请中、已占用等状态，不返回 `confirmed_user_open_id`、手机号或完整成员身份。

## Post-start Privacy

公共资格同时依赖状态和时间：

```text
status = recruiting AND start_at > now
```

只要任一条件不成立，普通公开预览立即关闭。这样即使状态更新任务延迟，开本时间到达后也不会继续公开。

客户端在以下时机重新拉取详情：

- 页面首次加载。
- 页面 `onShow` 从后台返回且已有缓存。
- 用户尝试任何受限动作之前。

若后端返回 404 或 `SESSION_POST_START_PRIVATE`，页面清空 session、seat、NPC 和公开记录状态，显示“车局已发车，仅同车成员可查看”，不得继续渲染旧缓存。

完整相册继续使用现有 `requireSessionParticipant`、车头和管理员权限。D23 朋友圈 token 只授权 token 对应的公开照片集合，不改变成员权限。

## Signed Invitation Compatibility

现有 `shareCode` 由客户端基于时间生成，主要用于分析，不能作为服务端授权。为了同时满足 D23 分享上车和 D40 发车后隐私，好友或群聊分享增加服务端签名邀请 token。

建议复用现有相册 token 的签名基础设施，增加用途：

```json
{
  "purpose": "session_join_invite",
  "sessionId": 123,
  "inviterUserId": 45,
  "expiresAt": 1784256000
}
```

规则：

- 只有车头或已确认车内成员可签发。
- token 绑定车局、签发人、用途和过期时间。
- 分享路径同时保留 `shareCode` 做分析，并增加 `inviteToken` 做授权。
- token 只允许邀请预览和现有上车流程，不直接授予相册权限。
- 上车成功后由座位或 NPC 成员关系授予完整相册权限。
- token 无效、过期或用途不匹配时返回分享失效提示。

D39 `entry=city` 不签发邀请 token，继续保持不可分享、不可直接上车。

## Authentication Interaction

统一封装受限动作入口，例如：

```js
async function requireIdentityFor(action) {
  return ensureLoggedIn({ content: loginPromptFor(action) });
}
```

动作分组：

```text
无需登录
  浏览近期列表、刷新、日期选择、折叠日期、打开公开详情、阅读公开信息

需要身份
  主按钮、车包、归档、联系店家、分享、聊天、相册

需要身份且写入
  创建、报名、上车、退出、上传、编辑、管理、删除
```

登录成功只更新身份和能力，不自动提交写入。主按钮明确停留首页；详情写入动作重新展示其原有确认步骤。

## Error Handling

### Public List Failure

日历保持渲染，状态区显示“近期车局加载失败，请稍后重试”，下拉刷新或重试按钮重新调用公共接口。不得调用登录，也不得显示旧引导页。

### Empty List

显示现有日历空状态，文案为“暂无近期车局”。不展示测试、已结束或已发车数据补位。

### Auth Expiry

清理失效 token 和成员数据，切换到 guest mode，加载公共近期列表。只显示一次“登录已过期，可继续游客浏览”提示。

### Privacy Transition

详情加载期间若车局刚发车，服务端权限结果优先。前端清空缓存并显示成员提示，不把 404 转换成登录弹窗。

### Maintenance

保留现有维护页和轮询。恢复后调用统一首页路由，根据当前 token 加载公共或成员日历。

## API Base URL

开发者工具和构建产物继续使用统一 API 工具。生产及提审构建必须指向：

```text
https://api.pinche.jubenmi.com
```

D40 自动检查验证生产配置和构建产物不含 localhost API 地址。线上路由部署后再执行真实匿名请求验收。

## Testing Strategy

### Static Check

新增 `scripts/d40-guest-calendar-home-check.js`，检查：

- 首页不再包含 `first-session` 和“发起第一辆车”。
- 首页未登录分支加载公共近期接口。
- 两个主按钮文案精确匹配。
- guest mode 显示“近期车局”。
- 首页加载路径不调用 `ensureLoggedIn`。
- 游客车卡 URL 包含 `entry=guest`。
- D39 `entry=city` 防护仍存在。
- 生产 API 地址检查仍锁定线上域名。

### Backend Smoke

新增 `scripts/d40-guest-calendar-home-smoke.js`，使用隔离数据库覆盖：

- 无 Authorization header 可获取公共近期列表。
- public/recruiting/future/open 候选可见。
- share_only、cancelled、已满、已发车、时间已过候选不可见。
- 排序和 20 条上限。
- 公开卡片响应不含敏感字段。
- 发车前普通详情为 public preview。
- 发车后游客和非成员普通详情返回 404。
- 发车后车头、成员和管理员可访问成员详情。
- 分析 `shareCode` 不授权访问。
- 有效邀请 token 只返回 invite preview。
- 有效 D23 相册 token 仍只返回授权照片。

### Miniprogram Flow

- 未登录冷启动直接看到日历，控制台无登录请求。
- 近期车卡可打开只读详情。
- 日期、折叠和刷新无需登录。
- 主按钮、车包、归档和详情受限动作点击后才登录。
- 取消登录后仍能浏览。
- 主按钮登录成功后停留首页并变为“我的车局（点击创建）”。
- 登录状态显示“我的 / 同城”。
- 发车后的普通详情被清空并显示隐私提示。

### Final Verification

```bash
node scripts/d40-guest-calendar-home-check.js
node scripts/d40-guest-calendar-home-smoke.js
npm run check
npm run build:mp-weixin
```

最后在微信开发者工具以清空登录缓存的状态走完整审核路径，并确认线上 `api.pinche.jubenmi.com` 已部署匿名列表与详情权限变更。
