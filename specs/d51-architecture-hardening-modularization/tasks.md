# D51 Tasks：工程架构加固与模块化重构执行清单

更新日期：2026-07-22

版本：v1.0

> **实施要求：** 严格按阶段门执行并实时勾选。所有结构迁移先建立失败测试或失败契约，再做单一路径最小搬迁；未经确认不改产品流程、接口语义、数据库业务模型、相册隐私、审核策略或 UI。禁止在同一提交中同时做业务功能、视觉改版和架构拆分。

## D51 执行任务

- [x] D51.1 建立正式 spec 三件套并锁定范围。
  - [x] `requirements.md` 记录审计基线、安全、迁移、CI、后端、前端、talk 和最终验收需求。
  - [x] `design.md` 明确模块化单体、渐进 route registry、领域边界、前端控制器和回滚策略。
  - [x] `tasks.md` 按安全加固 → 真实 CI → 后端搬迁 → 前端搬迁 → 工程收口建立串行清单。
  - [x] 明确非目标：不拆微服务、不换框架、不全量 TypeScript、不改 UI、不重命名历史迁移。
  - [x] 记录当前工作区已有改动属于其他任务，D51 不覆盖 `package-lock.json`、D48 tasks 或 `docs/evidence/`。

- [x] D51.2 建立 D51 基线检查和测试分组，证明当前风险存在。
  - [x] 新建 `scripts/d51-architecture-hardening-check.js`，检查 spec 三件套、目标模块入口、生产单迁移入口和新迁移编号唯一性。
  - [x] 新建 `apps/api/test/http-body-boundaries.test.mjs`，使用真实 `createApp` 发送超限 `Content-Length`、chunked 超限和非法 JSON；RED 应分别暴露无上限及错误码折叠。
  - [x] 新建 `apps/api/test/runtime-config.test.mjs`，隔离导入生产 config；RED 应证明 mock login、弱 secret、HTTP base URL 或缺失 database lock 仍可启动。
  - [x] 新建 `apps/api/test/migration-runner.test.mjs`，覆盖字符串/注释内分号、并发锁、checksum 变化和重复编号；RED 应证明现 runner 不满足契约。
  - [x] 统计现有 unit、contract、HTTP 和真实 MySQL 测试并写入 `docs/backend-architecture.md` 的测试口径章节。
  - [x] 在 `package.json` 增加 `d51:check`，仅接入当前可运行的 D51 spec/基线检查，不提前伪造后续 GREEN。
  - [x] 运行 `node --test apps/api/test/http-body-boundaries.test.mjs apps/api/test/runtime-config.test.mjs apps/api/test/migration-runner.test.mjs`，保存预期失败原因。
  - [x] 运行原 `npm run check`，确认新增 RED 未混入现有主检查且基线仍为退出码 0。

- [ ] D51.3 加固 HTTP body、生产配置、请求 ID 和敏感入口限流。
  - [ ] 新建 `apps/api/src/http/body.js`，实现 `none/json/raw/stream` policy、1 MiB JSON 默认上限、`Content-Length` 预检和 chunked 累计上限。
  - [ ] 修改 `apps/api/src/http/errors.js`，增加 413 `PAYLOAD_TOO_LARGE`、429 `RATE_LIMITED` 和 503 `RATE_LIMIT_UNAVAILABLE`，错误正文不含原始输入。
  - [ ] 修改 `apps/api/src/server.js`，让普通 JSON 路由使用有界 parser；保留 avatar、review photo、album image/video 和 callback 的专用读取路径。
  - [ ] 在 `apps/api/src/config/env.js` 新增纯 `validateRuntimeConfig`，生产校验 mock login、session secret、HTTPS base URL 和 database target lock。
  - [ ] 新建 `apps/api/src/http/request-context.js` 和 `request-log.js`，生成/验证 request ID，响应带 `x-request-id`，日志只使用规范化 route 和低敏字段。
  - [ ] 在 HTTP app lifecycle 配置有界 headers/request/keep-alive timeout，并用真实慢请求测试验证连接会被终止。
  - [ ] 新建 `apps/api/src/modules/auth/rate-limit.js`、`apps/api/src/infra/redis/rate-limit-store.js` 和内存测试适配器。
  - [ ] 将微信登录、后台登录票据创建/轮询/批准接入统一 limiter；Redis 故障在生产返回 503。
  - [ ] 扩展 `http-body-boundaries.test.mjs` 验证 413/400 分离、媒体专用上限不回归、body 不进入错误响应。
  - [ ] 扩展 `runtime-config.test.mjs` 验证负向配置在 DB/Redis/外部网络前失败且不输出 secret。
  - [ ] 扩展 health 测试，确认只输出安全能力布尔值，不输出数据库 host、Redis URL、secret 或 token。
  - [ ] 新建 `apps/api/test/rate-limit.test.mjs`，覆盖内存/Redis 语义、429、Retry-After、存储故障 503 和不同 scope 隔离。
  - [ ] 运行 `node --test apps/api/test/http-body-boundaries.test.mjs apps/api/test/runtime-config.test.mjs apps/api/test/rate-limit.test.mjs`，预期全部通过。
  - [ ] 运行 `npm run d46:unit && npm run d50:unit && npm run check`，确认审核、媒体 capability、分享和完整回归通过。

- [ ] D51.4 重构迁移 runner，并把生产迁移收敛为单入口。
  - [ ] 新建 `apps/api/src/infra/db/sql-statements.js`，用状态机处理引号、转义、行注释、块注释和 statement 分号。
  - [ ] 新建 `apps/api/src/infra/db/migration-lock.js`，以数据库名派生固定命名锁，设置有界等待并在 finally 释放。
  - [ ] 新建 `apps/api/src/infra/db/migration-registry.js`，提供按完整 migration filename 注册 preflight/reconcile/skipSql 的接口。
  - [ ] 将 album-video、content-moderation 和 user-image-assets 的特殊迁移逻辑移入所属模块 handler；通用 runner 不再导入 album-video migration 聚合文件。
  - [ ] 新增 `0033_schema_migration_checksums.sql`，为 `schema_migrations` 增加 SHA-256 checksum，并实现旧记录一次性可信回填。
  - [ ] 修改 `apps/api/src/db/migrate.js` 或替换为 `apps/api/src/infra/db/migrate.js`，依次执行锁、checksum、registry、SQL 和记录写入。
  - [ ] 新建迁移编号检查器，历史 `0021/0022/0024/0030/0032` 进入固定 allowlist；后续新编号必须唯一且递增。
  - [ ] 修改 `apps/api/docker-entrypoint.sh`，仅在显式 `RUN_MIGRATIONS_ON_START=true` 时执行迁移；生产示例不设置该变量。
  - [ ] 保留 `docker-compose.prod.example.yml` 的独立 migrate 服务，验证 API/Worker 只依赖其成功结果而不重复迁移。
  - [ ] 扩展 `migration-runner.test.mjs`，覆盖 parser、checksum、registry、锁超时、释放、DDL 部分应用重跑和错误结构。
  - [ ] 在空 MySQL 8.4 fixture 运行 `npm run migrate` 两次，第一次完整应用、第二次 executed 为空。
  - [ ] 并发启动两个 fixture migrator，验证一个持锁执行，另一个有界失败且 `schema_migrations` 无重复/部分记录。
  - [ ] 运行 D42/D43/D45/D46 迁移相关测试与 `npm run check`，预期全部通过。

- [ ] D51.5 建立 PR CI、真实 MySQL integration 和分层命令。
  - [ ] 将根 `package.json` 的 81 步命令拆为 `check:fast`、`test:unit`、`test:contracts`、`test:integration`、`build:all` 和聚合 `check`。
  - [ ] 把纯 `node --check`、源码读取和安全禁令检查归入 `test:contracts`，并保持现有 D 系列命令兼容。
  - [ ] 新建 `docker-compose.d51-test.yml`，使用隔离 MySQL 8.4、Redis、migrate、API 和 acceptance runner。
  - [ ] 新建 `scripts/d51-integration-smoke.js`，在任何写入前验证 fixture host/database，真实请求 health、公共目录、mock login 和一个可清理业务读写链路。
  - [ ] acceptance 结束时统计 fixture 表并清理创建的数据；残留或目标不匹配均返回非零。
  - [ ] 新建 `.github/workflows/ci.yml`，触发 pull request 与目标分支 push，执行 `npm ci`、fast、unit、contracts、integration、admin build、mp-weixin build 和 API Docker build。
  - [ ] 修改 `.github/workflows/docker-publish.yml`，发布 job 依赖同一提交 required CI 成功，测试失败前不登录腾讯云仓库。
  - [ ] 在 CI 中固定 Node 24、MySQL 8.4，并缓存 npm；不缓存构建产物或 fixture 数据库。
  - [ ] 运行 `npm run check:fast && npm run test:unit && npm run test:contracts`，每组失败能定位到单一命令。
  - [ ] 运行 `npm run test:integration`，确认空库迁移、真实 API 和 fixture cleanup 通过。
  - [ ] 运行 `npm run build:all`，确认管理端、小程序和 API image 构建通过。

- [ ] D51.6 抽取 HTTP 内核和 route registry，保持 legacy 单一路径。
  - [ ] 新建 `apps/api/src/http/router.js`，实现 method + pattern 注册、params 解析、route name 和重复路由启动校验。
  - [ ] 新建 `apps/api/src/http/response.js`，移动 JSON/error/cache/privacy header 逻辑。
  - [ ] 新建 `apps/api/src/app/create-dependencies.js`，集中组合 DB、Redis、COS、微信、clock、logger 和 rate limiter。
  - [ ] 新建 `apps/api/src/app/create-app.js`，按内核路由 → module router → extension → legacy fallback → 404 处理请求。
  - [ ] 将 `createApp` 测试入口从 `server.js` 稳定导出或改为从 `app/create-app.js` 导入，并保留旧重导出兼容现有测试。
  - [ ] 将 health、config 和无业务 SQL 的基础路由先迁入 app router，验证 request context、body policy 和错误响应。
  - [ ] 把现有大 `route()` 改名为 `legacyRoute(context)`，禁止新功能继续加入；D51 静态检查锁定该边界。
  - [ ] 新建 `apps/api/test/router.test.mjs`，覆盖静态/参数路由、method 区分、重复注册、body 声明、auth 声明和 404。
  - [ ] 新建单路径测试，为已迁移 URL 注入两个计数 handler，证明一次请求只执行新或 legacy 之一。
  - [ ] 将 `server.js` 缩减为 config/dependency/app/listen/signal 入口，保留现有启动 JSON 日志。
  - [ ] 运行 API 单元、真实 HTTP integration 和完整 `npm run check`。

- [ ] D51.7 搬迁 album 领域，删除 server/core 中对应实现。
  - [ ] 新建 `apps/api/src/modules/album/index.js`、`routes.js`、`media-routes.js`、`service.js`、`repository.js`、`policy.js`、`dto.js`、`capabilities.js` 和 `media-storage.js`。
  - [ ] 先把现有相册可见性、公开快照、隐私、DTO 和 capability 纯函数原样移动，使用重导出保持测试导入兼容。
  - [ ] 将相册 SQL 移到 repository；repository 接受 connection，不直接创建事务。
  - [ ] 将创建、删除、隐私、标签、公开分享和视频授权事务移到 album service，保持现有锁顺序和错误码。
  - [ ] 将图片/视频上传、读取、Range、COS、本地 storage 和 callback 路由迁入 album routers。
  - [ ] 将 content-moderation 集成通过显式 port 注入，album 不导入 moderation repository 私有实现。
  - [ ] 为每组迁移路由添加真实 `createApp` HTTP 测试，覆盖成员、管理员、匿名、share token 和 capability。
  - [ ] 每迁移一组精确 URL 后删除 legacy route 分支；确认 route registry 无重复。
  - [ ] 删除 `core/service.js` 中已迁移 album 导出，更新调用点只从 `modules/album` 公共入口导入。
  - [ ] 运行 `npm run d43:unit && npm run d45:unit && npm run d46:unit && npm run d48:check && npm run d50:unit`。
  - [ ] 运行 `npm run test:integration && npm run check`，确认上传、公开视频、隐私和单项分享不变。

- [ ] D51.8 搬迁 sessions 与 signups，保持事务和通知语义。
  - [ ] 新建 `modules/sessions` 与 `modules/signups` 的 index/routes/service/repository/policy/dto 文件。
  - [ ] 先抽 `sessions` 公共 access port，覆盖 owner、participant、admin、started/cancelled 和可加入策略。
  - [ ] 搬迁车局创建、修改、改期、NPC、seat、publish、cancel、transfer 和 discovery。
  - [ ] 搬迁 signup 创建、seat/NPC claim、approve/reject、deposit、kick、hide 和列表。
  - [ ] 明确 session → signup 的依赖只通过公共 access/use-case port；禁止互相导入 repository。
  - [ ] 保持锁顺序、幂等、手机号前置、订阅请求和 commit 后微信通知行为。
  - [ ] 为 approve/reject/claim/reschedule/cancel 建立真实 transaction 测试和至少一条 HTTP integration 链路。
  - [ ] 删除 legacy route 与 `core/service.js` 中对应实现，保留临时重导出只服务尚未迁移调用点。
  - [ ] 运行 D2–D7、D14、D16、D23–D30、D38–D40、session-reschedule 定向回归和完整检查。

- [ ] D51.9 搬迁 catalog、reviews、notifications、auth 和 moderation 接线，清空 legacy core。
  - [ ] 新建/补齐 catalog、reviews、notifications、auth 模块的公共入口、routes、service、repository、policy/dto。
  - [ ] 搬迁 store/script/store-script/private review/catalog request/entity claim 和 performer profile。
  - [ ] 搬迁 session review、review album photo、share event 和 subscription request。
  - [ ] 收敛 auth login、user profile、phone、admin web ticket，并保留 D51 limiter 和当前 token 语义。
  - [ ] 为 content-moderation 暴露 route registration，将 callback/admin/author routes 从 legacy server 移到现有模块入口。
  - [ ] 修改 talk host adapter，临时适配新的 session access 和 transaction port，为 D51.13 子模块改造准备稳定接口。
  - [ ] 删除 `legacyRoute`、`core/service.js` 和不再使用的兼容重导出；全仓 `rg` 不再发现业务代码从这些入口导入。
  - [ ] 增加模块依赖检查，禁止 route 直接 SQL、跨模块 repository import 和 infra 反向依赖 module。
  - [ ] 运行 admin、catalog、review、notification、auth、moderation、talk 和完整 integration 回归。

- [ ] D51.10 拆分小程序 request kernel 与领域 API client。
  - [ ] 新建 `apps/miniprogram/src/services/request.js`，移动 request、token、维护模式和错误归一化，保持事件名与 storage key 不变。
  - [ ] 新建 auth/session/album/upload/notification/catalog client，逐个移动 URL 组装函数。
  - [ ] 保留 `src/utils/api.js` 重导出兼容层；每迁移一个调用点立即改为领域 client，禁止新调用导入兼容层。
  - [ ] 把 COS SDK、文件系统、上传 operation authority 留在 upload/feature 层，不放入通用 request kernel。
  - [ ] 新建 `apps/miniprogram/test/requestClient.test.mjs`，覆盖 auth header、401 清理、维护模式、超时和错误 DTO。
  - [ ] 为每个领域 client 增加 URL/method/body 纯测试，避免继续用源码位置断言验证请求。
  - [ ] 当全仓无调用点后删除 `utils/api.js` 兼容层，并更新静态检查器。
  - [ ] 运行小程序所有 Node tests、`npm run build:mp-weixin` 和 `node scripts/check-miniprogram.js`。

- [ ] D51.11 拆分小程序相册状态机和页面责任。
  - [ ] 新建 `features/album/album-formatters.js` 和 selection/share controller，先迁纯函数并保持页面 props/events 不变。
  - [ ] 新建 media/viewer controller，迁短期 URL、thumbnail、视频 transition、一次自动刷新、显式重试和快速滑动 authority。
  - [ ] 新建 upload controller，注入 chooseMedia、compress、filesystem、COS 和 local fallback adapters。
  - [ ] 新建顶层 album controller，组合公开/成员加载、身份 generation、onShow/onHide/onUnload 和所有 dispose。
  - [ ] 为每个 controller 建立 Node test，覆盖迟到响应、身份切换、销毁、隐私收紧、作者私有预览、Range URL 刷新和单项分享 cache。
  - [ ] 修改 `pages/session/album.vue`，只保留模板、少量页面派生值和 controller event 接线。
  - [ ] 拆出相册 toolbar、filter、waterfall item、tag sheet 等只负责渲染的子组件；不改变当前 UI。
  - [ ] 删除页面内已迁移方法和重复 state；全仓检查没有旧 helper 双实现。
  - [ ] 运行 D18、D31、D32、D42、D43、D45、D46、D48、D50 定向测试与完整小程序构建。
  - [ ] 使用微信开发者工具验证成员相册、公开整册、单项图片、ready 视频、快速滑动、下载/标注和隐私收紧。

- [ ] D51.12 拆分管理后台 client、Workspace 与 feature styles。
  - [ ] 新建 admin request kernel 和 auth/catalog/album/moderation clients，保留 token key、错误字段和 COS authorization 语义。
  - [ ] 将 CatalogWorkspace 的筛选、分页、表单 normalization、drawer 和 table 拆入 catalog feature。
  - [ ] 将 SessionAlbumWorkspace 的 session list、上传、选择、删除、授权媒体和 drawer 拆入 album feature。
  - [ ] 将 MiniProgramWorkspace 的登录态、目录、车局管理和工具面板拆为子组件/controller。
  - [ ] 将 `styles.css` 先原样拆为 tokens/shell/catalog/album/moderation，保证选择器优先级和加载顺序一致。
  - [ ] 增加登录、目录保存、相册媒体、审核详情的组件或浏览器行为测试；关键行为不只依赖源码字符串。
  - [ ] 运行 `npm --workspace apps/admin-web run check` 和 `npm run build:admin-web`。
  - [ ] 对登录页、目录、车局相册和审核页做截图对比，确认 D51 无视觉改版。

- [ ] D51.13 修复 talk 子模块边界并删除宿主分叉源码。
  - [ ] 在 `packages/talk` 子模块建立 adapter contract 测试，RED 证明当前包依赖 `apps/api` 相对路径且不能独立运行。
  - [ ] 在 talk 导出 `createSessionPseudoChatExtension(adapters)`，service 只使用 database/errors/sessionAccess/authorSocialRead ports。
  - [ ] 使用 fake adapters 运行 talk 全部 tests，不需要主仓库模块解析。
  - [ ] 把宿主 TDesign 兼容的 ChatEntry、ManagePinnedMessage 和 author-private 行为合并回 talk 规范组件。
  - [ ] 在主仓库新建 `apps/api/src/modules/extensions/talk-adapter.js`，把宿主能力映射到 talk adapter contract。
  - [ ] 修改 API extension registry 使用 factory，不再直接导入隐式宿主依赖实例。
  - [ ] 修改小程序 detail/manage 只从 `@jubenmi/talk/miniprogram` 导入，删除 `src/extensions/session-pseudo-chat` 中分叉组件/API。
  - [ ] 先提交并验证 talk 子模块，再更新主仓库 submodule pointer；记录两边 commit 和测试结果。
  - [ ] 运行 talk tests、D10、D45/D46 social read、小程序构建和 API integration。

- [ ] D51.14 统一运行时、lint、渐进类型检查和文档。
  - [ ] 将根 `engines`、Docker、GitHub Actions 和本地版本文件统一为 Node 24；README 删除 Node 20+ 的漂移描述。
  - [ ] 增加 ESLint 与格式检查；所有 D51 新文件必须通过，历史文件按模块搬迁时纳入。
  - [ ] 配置 `checkJs` 或等价 JS 类型检查，先覆盖 http/app/infra 和新模块公共接口。
  - [ ] 更新 README 的当前阶段、目录、启动、检查、迁移和验收命令。
  - [ ] 重写 `docs/backend-architecture.md` 的模块化单体、依赖方向、事务、迁移、CI 和日志章节。
  - [ ] 记录源码 contract、unit、MySQL integration、微信开发者工具和生产只读检查的证据边界。
  - [ ] 处理 D51 构建触及的 Sass legacy API/`@import` 警告；若来自受控 vendor，记录升级路径和版本约束，不修改无关 vendor 源码。
  - [ ] 运行 lint、format check、checkJs、完整 tests 和 builds。

- [ ] D51.15 完成全链验收、删除兼容层并准备发布。
  - [ ] 全仓搜索并删除 legacy route、core service、旧 api compatibility、分叉 talk 组件和未使用 imports。
  - [ ] 运行 `npm run check:fast`，预期退出码 0。
  - [ ] 运行 `npm run test:unit`，预期退出码 0、无 skipped critical suite。
  - [ ] 运行 `npm run test:contracts`，预期退出码 0。
  - [ ] 运行 `npm run test:integration`，预期空库迁移、重复迁移、API smoke 和 fixture cleanup 全部通过。
  - [ ] 运行 `npm run build:all`，预期管理端、小程序和 API Docker image 构建成功。
  - [ ] 运行生产配置负向矩阵，确认 mock login、弱 secret、HTTP base URL 和错误 DB lock 均在 I/O 前失败。
  - [ ] 并发运行两个 migrator，确认锁和 checksum 行为。
  - [ ] 在微信开发者工具验证登录、首页、建车/报名、成员相册、ready 视频、单项分享和隐私变化。
  - [ ] 在管理后台验证扫码登录、目录编辑、车局相册和内容审核。
  - [ ] 用生产 Compose 配置启动隔离容器，确认独立 migrate 完成后 API/Worker 健康且不会重跑迁移。
  - [ ] 更新本文件的验证记录，明确每项证据的环境、命令、退出码和未覆盖范围。
  - [ ] 在所有专项、完整回归和独立代码复核通过前，不进入 develop/main/publish 发布流程。

## 最终验收清单

- [ ] 普通 JSON 请求有 1 MiB 上限，413 与非法 JSON 400 分离。
- [ ] 生产 mock login、弱 secret、HTTP base URL 和错误数据库锁均关闭式拒绝启动。
- [ ] 敏感认证入口共享 Redis 限流，请求有低敏 request ID 和结构化日志。
- [ ] 生产只存在独立 migrate 入口；迁移有锁、checksum、稳健 parser 和新编号唯一性。
- [ ] PR CI 真实执行空库 MySQL 迁移、API HTTP smoke、构建和 Docker build。
- [ ] `server.js` 只负责进程入口，业务 route 通过模块 registry 注册。
- [ ] `core/service.js` 不再承载业务实现，route 无直接 SQL，跨模块无 repository 私有 import。
- [ ] 小程序 request kernel、领域 clients 和相册 controllers 已拆分且现有行为不变。
- [ ] 管理后台大 Workspace、API client 和 feature CSS 已形成清晰边界且无视觉改版。
- [ ] talk 子模块可独立测试，无宿主反向 import，宿主不再编译分叉组件。
- [ ] Node 24、CI、Docker、README 和架构文档一致。
- [ ] fast、unit、contracts、integration、build、微信开发者工具和容器验收全部有记录。

## 验证记录

- 2026-07-22：完成 D51 前置审计。当前 `npm run check` 退出码 0，包含现有单元/契约和小程序构建；该结果不等同于真实 MySQL integration。`docker compose config --quiet`、`npm ls --all --omit=dev`、`git diff --check` 均退出码 0。在线 `npm audit` 因外发 workspace 依赖元数据的安全限制未执行成功，不把生产依赖漏洞状态标记为已验证。
- 2026-07-22：D51 spec 三件套写入 `specs/d51-architecture-hardening-modularization/`。本次只新增文档，未修改业务代码、数据库、CI、容器或生产环境；D51.2 及后续实施项保持未勾选。
- 2026-07-22：在隔离工作树 `.worktrees/d51-architecture-hardening-modularization`、分支 `codex/d51-architecture-hardening-modularization` 开始执行。talk 子模块通过主仓库本地 Git 对象初始化到固定提交 `58c7c704941796a9361446b6e8bd71e0aa9584f1`；依赖安装后，未加入任何 D51 RED 测试前的原始 `npm run check` 退出码为 0。D51.2 正在进行，尚未勾选。
- 2026-07-22：D51.2 完成。`npm run d51:check` 退出码 0，并显式报告 7 个待建模块入口与生产 API 隐式迁移的基线缺口；严格模式仍为 RED。隔离回环端口运行三组 D51 行为测试，结果 11 项中 1 通过、10 失败：两个超限 JSON 请求实际返回 404 而非 413；四组弱生产配置仍输出 `CONFIG_OK`；迁移 parser/checksum/lock 接口缺失；历史重复编号 validator 在 checker 实现前缺失。随后原 `npm run check` 再次退出码 0，证明 RED 未混入既有聚合门禁。
