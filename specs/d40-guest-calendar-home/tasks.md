# D40 Tasks: 游客日历首页与发车后隐私执行清单

更新日期：2026-07-10

## D40 执行任务

- [x] D40.1 建立 D40 spec 三件套。
  - [x] `requirements.md` 描述直接进入日历、两个认证状态、近期取数、登录边界和发车后隐私。
  - [x] `design.md` 描述共享日历、公共接口、详情访问范围、邀请 token、错误处理和测试策略。
  - [x] `tasks.md` 描述 TDD 实现顺序、验收项和验证记录。

- [x] D40.2 新增先失败的 D40 检查。
  - [x] 新增 `scripts/d40-guest-calendar-home-check.js`。
  - [x] 检查首页删除 `first-session` 和“发起第一辆车”。
  - [x] 检查游客和已登录主按钮文案。
  - [x] 检查游客筛选为“近期车局”。
  - [x] 检查游客首页调用公共近期接口且不调用登录。
  - [x] 检查游客车卡使用 `entry=guest`。
  - [x] 检查详情公开读取和受限动作登录边界。
  - [x] 检查发车后详情服务端权限分支。
  - [x] 检查 D39 同城只读和 D23 相册分享规则未被移除。
  - [x] 将 D40 检查接入 `npm run check`。
  - [x] 运行检查并记录目标功能缺失造成的 RED 结果。

- [x] D40.3 新增先失败的后端烟测。
  - [x] 新增 `scripts/d40-guest-calendar-home-smoke.js`。
  - [x] 使用隔离数据库创建 public、share_only、cancelled、full、started、past 和 eligible fixtures。
  - [x] 验证匿名公共近期接口不返回 401。
  - [x] 验证资格排除、排序和 20 条上限。
  - [x] 验证公开响应不含敏感字段。
  - [x] 验证发车前 public preview 和发车后普通链接 404。
  - [x] 验证车头、成员、管理员和非成员权限。
  - [x] 验证 `shareCode` 不授权、有效邀请 token 只授权邀请预览。
  - [x] 验证 D23 相册 token 仍受原隐私规则限制。
  - [x] 运行烟测并记录目标功能缺失造成的 RED 结果。

- [x] D40.4 实现公共近期车局后端。
  - [x] 新增 `listPublicUpcomingSessions(filters)`。
  - [x] 查询只保留 public、recruiting、future 且有开放座位或 NPC 的车局。
  - [x] 按 `start_at ASC, id ASC` 排序。
  - [x] limit 默认 20 且上限 20，不补齐最小数量。
  - [x] 只序列化卡片所需公开字段。
  - [x] 新增 `GET /api/sessions/public/upcoming` 匿名路由。
  - [x] 确保静态 public route 在动态 session id route 之前匹配。

- [ ] D40.5 收紧普通车局详情权限。
  - [ ] 将详情 GET 改为可选身份访问。
  - [ ] 增加 `public_preview | member | invite_preview` 服务端访问范围。
  - [ ] 公开预览只允许 public、recruiting、future 车局。
  - [ ] 公开预览使用最小字段序列化，移除 open_id、联系方式、内部备注和完整成员身份。
  - [ ] 发车后普通链接对游客和非成员返回不可枚举 404。
  - [ ] 发车后车头、确认/锁定座位成员、绑定 NPC 成员和管理员保持访问。
  - [ ] 发车后的相册接口继续复用成员权限检查。
  - [ ] 客户端 `entry` 不参与后端授权。

- [ ] D40.6 为 D23 好友或群聊分享补充签名邀请凭证。
  - [ ] 复用现有 token 签名基础设施增加 `session_join_invite` purpose。
  - [ ] 仅允许车头或确认车内成员签发。
  - [ ] token 绑定 session、inviter、purpose 和 expiresAt。
  - [ ] 分享路径保留分析 `shareCode` 并增加 `inviteToken`。
  - [ ] 分享页使用邀请 token 请求 `invite_preview`。
  - [ ] 邀请 token 不直接授予完整相册权限。
  - [ ] 上车成功后继续由成员关系授予完整相册权限。
  - [ ] 无效或过期 token 显示分享失效，不回退到普通公开详情。
  - [ ] 保持朋友圈相册 token 和 D39 同城不可分享规则不变。

- [ ] D40.7 重构首页为始终显示日历。
  - [ ] 删除 `first-session` 模板、状态、样式和 `startFirstSession()`。
  - [ ] 首页状态收敛为维护、加载、日历和错误。
  - [ ] 未登录时加载公共近期接口。
  - [ ] 已登录时加载现有我的车局和报名接口。
  - [ ] 登录过期或退出后切换游客日历，不进入旧引导页。
  - [ ] 公共列表失败时保留日历并支持重试。
  - [ ] 公共列表为空时显示“暂无近期车局”。

- [ ] D40.8 为 SessionCalendar 增加 guest mode。
  - [ ] 增加显式 `calendarMode` 或等价 prop，不在组件内读取 token。
  - [ ] guest mode 主按钮显示“我的车局（点击登录）”。
  - [ ] member mode 主按钮显示“我的车局（点击创建）”。
  - [ ] guest mode 筛选区显示单项“近期车局 N”。
  - [ ] 保持车包、归档、日期、时间轴和车卡布局位置不变。
  - [ ] guest mode 隐藏管理、删除和退出动作。
  - [ ] guest mode 日期、折叠和刷新无需登录。
  - [ ] guest mode 车包、归档和主按钮点击后请求登录。
  - [ ] 主按钮登录成功后留在首页，不自动创建。
  - [ ] 登录状态切换时重置正确的数据源和日历窗口。

- [ ] D40.9 实现游客只读详情与受限动作登录。
  - [ ] 近期车卡跳转包含 `entry=guest`。
  - [ ] guest detail 使用服务端 `public_preview` 渲染公开字段。
  - [ ] 首页和详情纯读取不调用 `ensureLoggedIn`。
  - [ ] 创建、上车、联系、分享、聊天、相册、管理等动作按场景提示登录。
  - [ ] 登录取消后保留详情、筛选和滚动位置。
  - [ ] 登录成功后刷新权限但不自动提交写入。
  - [ ] `entry=city` 继续执行 D39 的完全只读和禁分享规则。
  - [ ] 详情在 `onShow` 和受限动作前重新校验权限。
  - [ ] 发车后失去权限时清空缓存并显示成员隐私提示。

- [ ] D40.10 执行自动验证。
  - [ ] 运行 D40 静态检查。
  - [ ] 运行 D40 隔离数据库烟测。
  - [ ] 运行相关 D23、D38、D39 和相册隐私检查。
  - [ ] 运行 `node --check apps/api/src/modules/core/service.js`。
  - [ ] 运行 `node --check apps/api/src/server.js`。
  - [ ] 运行 `node scripts/check-miniprogram.js`。
  - [ ] 运行 `npm run check`。
  - [ ] 运行 `npm run build:mp-weixin`。
  - [ ] 修复 D40 范围内的检查、烟测或构建失败。

- [ ] D40.11 完成微信开发者工具和线上 API 验收。
  - [ ] 清理本地登录缓存后冷启动，确认直接进入日历且不弹登录。
  - [ ] 确认主按钮为“我的车局（点击登录）”。
  - [ ] 确认筛选区为“近期车局 N”。
  - [ ] 确认日期、折叠、刷新、车卡和只读详情无需登录。
  - [ ] 确认车包、归档、创建和详情受限动作点击后才登录。
  - [ ] 确认取消登录后仍可浏览。
  - [ ] 确认主按钮登录成功后留在首页并切换为“我的车局（点击创建）”。
  - [ ] 确认已登录首页显示“我的 / 同城”。
  - [ ] 确认发车后普通详情对游客和非成员不可见。
  - [ ] 确认成员相册和有效分享授权仍按 D23 工作。
  - [ ] 确认构建产物请求 `https://api.pinche.jubenmi.com`。
  - [ ] 确认线上匿名近期接口、详情权限和邀请 token 路由已部署。

## D40 验收

- [x] D40 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D40 design 已落地到 [design.md](./design.md)。
- [x] D40 tasks 已落地到本文件。
- [ ] 所有用户打开小程序直接进入同一个日历首页。
- [ ] 首页加载和公开读取不请求登录。
- [ ] 游客显示“我的车局（点击登录）”和“近期车局 N”。
- [ ] 已登录显示“我的车局（点击创建）”和“我的 / 同城”。
- [ ] 公共近期列表只包含真实、公开、未发车、仍招募且有开放角色的车局。
- [ ] 公共详情不泄露联系方式、内部备注或成员隐私。
- [ ] 写入或身份相关动作点击后才请求登录。
- [ ] 发车后普通列表和详情不再向游客或非成员公开。
- [ ] 完整相册仅成员或 D23 明确授权范围可见。
- [ ] `shareCode` 不被当作授权凭证，签名邀请 token 不直接授予相册权限。
- [ ] `npm run check` 和 `npm run build:mp-weixin` 通过。
- [ ] 微信开发者工具及线上 API 路径验收完成。

## 验证记录

- 2026-07-10：D40 spec 三件套建立。设计确认首页删除“发起第一辆车”分支，游客和已登录用户共用现有日历布局；游客仅浏览真实、公开、未发车、仍招募的近期车局，纯读取不登录，写入或身份能力点击后登录；发车后普通详情转为成员私密，相册继续遵循 D23 授权范围。实现待用户审阅 spec 后开始。
- 2026-07-10：D40 RED 已建立并实际运行。静态检查 exit 1，首个失败为 `D40 home must remove the first-session entry screen`；隔离 API 烟测语法通过，匿名探针请求 `GET /api/sessions/public/upcoming?limit=20` 返回预期 404 `Route not found`。失败均由目标功能尚未实现造成。
- 2026-07-10：D40 公共近期接口 GREEN。隔离烟测以匿名请求通过 public/recruiting/future/open 资格、share_only/cancelled/locked/past 排除、排序、20 条上限和敏感字段检查；随后按预期在详情 `access_scope !== public_preview` 处 RED。
