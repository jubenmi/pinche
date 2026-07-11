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

- [x] D40.5 收紧普通车局详情权限。
  - [x] 将详情 GET 改为可选身份访问。
  - [x] 增加 `public_preview | member | invite_preview` 服务端访问范围。
  - [x] 公开预览只允许 public、recruiting、future 车局。
  - [x] 公开预览使用最小字段序列化，移除 open_id、联系方式、内部备注和完整成员身份。
  - [x] 发车后普通链接对游客和非成员返回不可枚举 404。
  - [x] 发车后车头、确认/锁定座位成员、绑定 NPC 成员和管理员保持访问。
  - [x] 发车后的相册接口继续复用成员权限检查。
  - [x] 客户端 `entry` 不参与后端授权。

- [x] D40.6 为 D23 好友或群聊分享补充签名邀请凭证。
  - [x] 复用现有 token 签名基础设施增加 `session_join_invite` purpose。
  - [x] 仅允许车头或确认车内成员签发。
  - [x] token 绑定 session、inviter、purpose 和 expiresAt。
  - [x] 分享路径保留分析 `shareCode` 并增加 `inviteToken`。
  - [x] 分享页使用邀请 token 请求 `invite_preview`。
  - [x] 邀请 token 不直接授予完整相册权限。
  - [x] 上车成功后继续由成员关系授予完整相册权限。
  - [x] 无效或过期 token 显示分享失效，不回退到普通公开详情。
  - [x] 保持朋友圈相册 token 和 D39 同城不可分享规则不变。

- [x] D40.7 重构首页为始终显示日历。
  - [x] 删除 `first-session` 模板、状态、样式和 `startFirstSession()`。
  - [x] 首页状态收敛为维护、加载、日历和错误。
  - [x] 未登录时加载公共近期接口。
  - [x] 已登录时加载现有我的车局和报名接口。
  - [x] 登录过期或退出后切换游客日历，不进入旧引导页。
  - [x] 公共列表失败时保留日历并支持重试。
  - [x] 公共列表为空时显示“暂无近期车局”。

- [x] D40.8 为 SessionCalendar 增加 guest mode。
  - [x] 增加显式 `calendarMode` 或等价 prop，不在组件内读取 token。
  - [x] guest mode 主按钮显示“我的车局（点击登录）”。
  - [x] member mode 主按钮显示“我的车局（点击创建）”。
  - [x] guest mode 筛选区显示单项“近期车局 N”。
  - [x] 保持车包、归档、日期、时间轴和车卡布局位置不变。
  - [x] guest mode 隐藏管理、删除和退出动作。
  - [x] guest mode 日期、折叠和刷新无需登录。
  - [x] guest mode 车包、归档和主按钮点击后请求登录。
  - [x] 主按钮登录成功后留在首页，不自动创建。
  - [x] 登录状态切换时重置正确的数据源和日历窗口。

- [x] D40.9 实现游客只读详情与受限动作登录。
  - [x] 近期车卡跳转包含 `entry=guest`。
  - [x] guest detail 使用服务端 `public_preview` 渲染公开字段。
  - [x] 首页和详情纯读取不调用 `ensureLoggedIn`。
  - [x] 创建、上车、联系、分享、聊天、相册、管理等动作按场景提示登录。
  - [x] 登录取消后保留详情、筛选和滚动位置。
  - [x] 登录成功后刷新权限但不自动提交写入。
  - [x] `entry=city` 继续执行 D39 的完全只读和禁分享规则。
  - [x] 详情在 `onShow` 和受限动作前重新校验权限。
  - [x] 发车后失去权限时清空缓存并显示成员隐私提示。

- [x] D40.10 执行自动验证。
  - [x] 运行 D40 静态检查。
  - [x] 运行 D40 隔离数据库烟测。
  - [x] 运行相关 D23、D38、D39 和相册隐私检查。
  - [x] 运行 `node --check apps/api/src/modules/core/service.js`。
  - [x] 运行 `node --check apps/api/src/server.js`。
  - [x] 运行 `node scripts/check-miniprogram.js`。
  - [x] 运行 `npm run check`。
  - [x] 运行 `npm run build:mp-weixin`。
  - [x] 修复 D40 范围内的检查、烟测或构建失败。

- [ ] D40.11 完成微信开发者工具和线上 API 验收。
  - [x] 清理本地登录缓存后冷启动，确认直接进入日历且不弹登录。
  - [x] 确认主按钮为“我的车局（点击登录）”。
  - [x] 确认筛选区为“近期车局 N”。
  - [ ] 确认日期、折叠、刷新、车卡和只读详情无需登录。
  - [ ] 确认车包、归档、创建和详情受限动作点击后才登录。
  - [x] 确认取消登录后仍可浏览。
  - [x] 确认主按钮登录成功后留在首页并切换为“我的车局（点击创建）”。
  - [x] 确认已登录首页显示“我的 / 同城”。
  - [ ] 确认发车后普通详情对游客和非成员不可见。
  - [ ] 确认成员相册和有效分享授权仍按 D23 工作。
  - [x] 确认构建产物请求 `https://api.pinche.jubenmi.com`。
  - [ ] 确认线上匿名近期接口、详情权限和邀请 token 路由已部署。

## D40 验收

- [x] D40 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D40 design 已落地到 [design.md](./design.md)。
- [x] D40 tasks 已落地到本文件。
- [x] 所有用户打开小程序直接进入同一个日历首页。
- [x] 首页加载和公开读取不请求登录。
- [x] 游客显示“我的车局（点击登录）”和“近期车局 N”。
- [x] 已登录显示“我的车局（点击创建）”和“我的 / 同城”。
- [x] 公共近期列表只包含真实、公开、未发车、仍招募且有开放角色的车局。
- [x] 公共详情不泄露联系方式、内部备注或成员隐私。
- [x] 写入或身份相关动作点击后才请求登录。
- [x] 发车后普通列表和详情不再向游客或非成员公开。
- [x] 完整相册仅成员或 D23 明确授权范围可见。
- [x] `shareCode` 不被当作授权凭证，签名邀请 token 不直接授予相册权限。
- [x] `npm run check` 和 `npm run build:mp-weixin` 通过。
- [ ] 微信开发者工具及线上 API 路径验收完成。

## 验证记录

- 2026-07-10：D40 spec 三件套建立。设计确认首页删除“发起第一辆车”分支，游客和已登录用户共用现有日历布局；游客仅浏览真实、公开、未发车、仍招募的近期车局，纯读取不登录，写入或身份能力点击后登录；发车后普通详情转为成员私密，相册继续遵循 D23 授权范围。实现待用户审阅 spec 后开始。
- 2026-07-10：D40 RED 已建立并实际运行。静态检查 exit 1，首个失败为 `D40 home must remove the first-session entry screen`；隔离 API 烟测语法通过，匿名探针请求 `GET /api/sessions/public/upcoming?limit=20` 返回预期 404 `Route not found`。失败均由目标功能尚未实现造成。
- 2026-07-10：D40 公共近期接口 GREEN。隔离烟测以匿名请求通过 public/recruiting/future/open 资格、share_only/cancelled/locked/past 排除、排序、20 条上限和敏感字段检查；随后按预期在详情 `access_scope !== public_preview` 处 RED。
- 2026-07-10：D40 详情与邀请后端 GREEN。完整隔离烟测通过发车前 `public_preview`、发车后游客/非成员 404、评论 404、车头/成员 `member`、D23 相册 token、分析 `shareCode` 不授权和签名 `invite_preview`；D23 与 D39 静态检查通过。篡改 token 补充断言等待最终烟测重跑。
- 2026-07-10：D40 首页、共享日历 guest mode 与游客详情源码实现完成。D38、D39、D40 静态检查及 `node scripts/check-miniprogram.js` 通过；旧 D37 检查已迁移到 D40 合同，当前仅因尚未重建的旧 WXML 产物保持 RED，等待微信构建后复验。
- 2026-07-10：D40 最终隔离烟测通过。有效签名邀请返回 `invite_preview`，猜测 `shareCode` 不授权，篡改 token 返回 403，成员和 D23 相册 token 仍按原范围工作；服务端语法、D18、D23、D37、D38、D39、D40 及小程序总静态检查通过，`npm run build:mp-weixin` 通过。
- 2026-07-10：整仓 `npm run check` 通过；D34/D24/D25 的旧静态断言已迁移到 D40 的成员与公开详情序列化器，并确认地址、NPC 开关、手机号开关没有丢失。构建产物仅包含 `https://api.pinche.jubenmi.com`，不含本地 API。微信开发者工具 Nightly 可打开构建且控制台无运行时错误，但锁屏后模拟器为空白、自动化 `App.getCurrentPage` 无响应；线上 `GET /api/sessions/public/upcoming?limit=20` 当前仍返回 404，D40.11 保持未完成，不能视为线上验收通过。
- 2026-07-10：完成度审计补足“NPC 已有待审核报名”资格边界。公共近期查询的 NPC 数量与资格判断均排除 `signups.status = pending` 的角色；新增隔离 fixture 验证普通座位已满且唯一 NPC 待审核时车局不进入游客列表。更新后的 D40 静态检查与完整隔离烟测通过。
- 2026-07-10：修复烟测数据库隔离缺口。新增 `/api/testing/d40-smoke-target` 写入前闸门，仅允许 `D40_SMOKE_ISOLATED=1`、本地主机和 `pinche_d40_test`；本机 Docker 专用数据库完成 23 个迁移，完整 D40 烟测在该库通过。审计发现此前误写生产库的 D40 前缀测试会话为连续 ID `113-151`（39 条），关联 script ID `71-78` 与 store ID `70-77`。
- 2026-07-10：微信开发者工具 Nightly 真实交互已验证游客冷启动直接进入共享日历且不弹登录，身份栏为“游客浏览”，主按钮为“我的车局（点击登录）”，筛选为“近期车局 0”；点击主按钮才显示“登录后可创建车局”，取消后仍留首页并显示“登录取消后仍可继续浏览”；完成登录后保持 `pages/index/index`，主按钮切为“我的车局（点击创建）”，筛选切为“我的 7 / 同城 0”。线上匿名近期路由仍为 404，故实时车卡与只读详情的开发者工具验收保持未完成。
- 2026-07-10：用户明确批准后完成生产测试数据清理。后台 API 先删除 39 个 D40 测试车局；随后通过项目现有云库锁与服务层停用/硬删除 script ID `71-78`、store ID `70-77`。独立干预览复查 sessions、scripts、stores 三类精确前缀候选均为 0，线上普通详情 `GET /api/sessions/113` 至 `/api/sessions/151` 全部返回 404。后续 D40 烟测已由本地 `pinche_d40_test` 写前闸门阻止再次误写生产库。
- 2026-07-10：清理后最终验证通过：D40 静态检查、服务端语法、整仓 `npm run check`、`npm run build:mp-weixin` 均为 exit 0；生产构建只命中 `https://api.pinche.jubenmi.com`，不含本地 API；本地 `pinche_d40_test` 完整 D40 烟测再次通过并已停止 3040 测试服务。线上匿名近期接口仍返回 404，因此 D40.11 的实时车卡、只读详情和线上路由部署项继续保持未完成。
- 2026-07-10：建立独立发布候选 worktree `codex/d40-guest-calendar-release`，确认当前提交链原本会因未跟踪的 D38/D40 检查和 D37 强依赖本地构建产物而在 CI 失败。D37 已改为始终检查源码、仅在产物存在时追加产物断言。完整当前源码候选在无产物和从零构建后两次 `npm run check` 均通过，`npm run build:mp-weixin`、API Docker 镜像和后台 Docker 镜像构建均通过。候选真实范围仍跨 D35/D36、相册、D38、D39、D40、D41 共 64 个文件；尚未获得将该组合范围提交并推送 `develop/main/publish` 的明确授权，因此未执行线上发布。
- 2026-07-10：为降低发布风险，另从 `origin/develop` 建立 API-only 候选 `codex/d40-api-release`，仅包含 D38/D40 所需的后端配置、核心服务、路由、地理编码模块和后端兼容/烟测脚本，共 14 个文件。提交 `167e704` 在提交后通过完整 `npm run check`、API Docker 镜像构建和本地 `pinche_d40_test` D40 全量烟测；候选 worktree 干净，本地 3041 测试服务已停止。该提交尚未推送，线上接口仍未部署。
- 2026-07-10：用户授权发布 API-only 候选 `167e704`。`develop` 推送后 Docker Publish run `29074867488` 成功；干净临时 worktree 从 `origin/main` 合并并通过完整 `npm run check`，推送 main 提交 `881002a`，Docker Publish run `29075168069` 成功；再从 `origin/publish` 合并已验证的 main，通过完整 `npm run check`后推送 publish 提交 `721067a`，Docker Publish run `29076434552` 成功。两个临时晋级 worktree 已清理，主工作区其他未提交改动未被触碰。CI 仅推送镜像；生产 `GET /api/sessions/public/upcoming?limit=20` 复查仍为 404，证明 Portainer `pinche` stack 尚未 re-pull/redeploy `latest`，因此 D40.11 线上验收继续保持未完成。
