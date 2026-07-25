# D51 Requirements：工程架构加固与模块化重构

更新日期：2026-07-22

版本：v1.0

状态：现状审计与方向已确认，待实施

## 1. 目标与范围

D51 在不改变现有产品能力、公开接口语义和单体部署形态的前提下，先关闭生产安全与迁移风险，再把 API、小程序和管理后台中已经形成的超大文件拆成可独立理解、测试和演进的业务模块。

本期目标不是追求新的技术栈，而是把当前“功能可用、回归丰富、结构持续膨胀”的代码库，收敛为有明确边界、可渐进迁移、可真实集成验证的模块化单体。

D51 覆盖以下六条主线：

1. HTTP 与生产配置安全加固。
2. 数据库迁移单入口、串行化和可恢复性。
3. PR CI、真实 MySQL 集成测试和分层检查命令。
4. API 路由、用例和仓储按业务领域拆分。
5. 小程序相册、API 客户端和管理后台大组件拆分。
6. `packages/talk`、运行时、文档和工程工具边界收敛。

## 2. 当前基线与 D51 差距

| 维度 | 当前基线 | D51 要求 |
|---|---|---|
| API 路由 | `server.js` 6,586 行；核心 `route()` 约 2,260 行、131 个方法分支 | 启动、HTTP 内核和业务路由分离；业务路由按模块注册 |
| 核心业务 | `core/service.js` 8,406 行、122 个导出、约 191 次 SQL 调用 | 事务用例、策略、序列化和 SQL 仓储按领域分离 |
| JSON 请求 | 普通 JSON body 无总量上限 | 有明确、可测试的默认上限，超限返回 413 |
| 生产启动 | mock login 和 session secret 存在开发默认值 | 生产缺失或使用弱配置时关闭式拒绝启动 |
| 迁移 | 简单按分号拆 SQL；历史有五组重复数字前缀；生产存在双入口 | 单一生产入口、命名锁、校验和、幂等恢复和新版本唯一编号 |
| 根检查 | `npm run check` 串行 81 步、约 3,934 字符 | fast/unit/integration/build/smoke 分层，可单独定位失败 |
| CI | 仅目标分支 push 后检查并发布；无 MySQL 服务 | PR 前置验证，空库迁移和真实 HTTP smoke，发布依赖 CI 成功 |
| 测试形态 | 大量测试读取源码做字符串断言 | 静态契约保留但单独归类；关键行为必须有运行时测试 |
| 小程序相册 | 单文件 5,037 行、约 52 个状态和 200 个方法 | 页面只做编排；上传、预览、选择、分享和读取状态独立 |
| 小程序 API | `utils/api.js` 1,921 行 | 请求内核与 auth/session/album/upload 等领域客户端分离 |
| 管理后台 | 多个 1,000–2,300 行 Workspace；全局 CSS 3,089 行 | 按功能面板、状态控制器和 feature style 拆分 |
| talk 扩展 | 子模块反向导入宿主内部文件；宿主另有一套分叉组件 | 宿主适配器注入；包可独立测试；小程序组件单一来源 |
| 运行时 | README 声明 Node 20+，CI/Docker 使用 Node 24 | 本地、CI、Docker 和文档统一 Node 24 |

## 3. 验收需求

### Requirement 1：普通 HTTP 请求必须有资源边界

**User Story：** 作为服务维护者，我希望异常或恶意请求不能无限占用 API 进程内存，使正常用户仍能获得稳定服务。

1. 普通 JSON 请求 SHALL 使用统一的 body parser，并设置默认 1 MiB 上限。
2. WHEN `Content-Length` 明确超过上限 THEN API SHALL 在读取 body 前返回 HTTP 413 和稳定错误码 `PAYLOAD_TOO_LARGE`。
3. WHEN chunked 请求实际读取量超过上限 THEN API SHALL 立即停止累积并返回相同 413 错误。
4. WHEN JSON 语法无效 THEN API SHALL 返回 HTTP 400 和 `INVALID_JSON`；超限错误 SHALL NOT 被折叠为 `INVALID_JSON`。
5. 图片、视频和第三方 callback SHALL 继续使用各自更严格的专用上限，SHALL NOT 先经过通用 JSON parser。
6. HTTP server SHALL 配置有限的 headers、request 和 keep-alive timeout；测试进程 MAY 使用显式覆盖。
7. 错误响应 SHALL NOT 回显请求正文、Authorization、签名 query、对象 key 或数据库错误详情。

### Requirement 2：生产配置必须关闭式启动

1. WHEN `NODE_ENV=production` THEN `WECHAT_MOCK_LOGIN` SHALL 必须显式为 `false`。
2. WHEN `NODE_ENV=production` THEN `SESSION_SECRET` SHALL 必须存在、长度不少于 32 字符，且不得等于仓库中的任一开发或示例默认值。
3. WHEN `NODE_ENV=production` THEN `APP_BASE_URL` SHALL 使用 HTTPS。
4. WHEN `NODE_ENV=production` THEN `DATABASE_TARGET_LOCK` 和 `DATABASE_TARGET_LOCK_HOST` SHALL 存在，并与实际 MySQL host 一致。
5. 生产配置校验 SHALL 在监听端口、连接数据库、启动 Worker 或请求外部服务前完成。
6. 配置错误 SHALL 使用固定低敏错误码和变量名列表，SHALL NOT 输出 secret 值。
7. `/health` MAY 输出安全布尔能力，SHALL NOT 输出数据库 host、Redis URL、密钥、token 或完整内部配置。

### Requirement 3：敏感入口必须限流并可追踪

1. 微信登录、后台登录票据创建/轮询/批准 SHALL 通过统一限流接口。
2. 限流键 SHALL 至少绑定可信客户端地址与接口类别；已认证入口 SHALL 可附加用户 ID。
3. 生产环境 SHALL 使用 Redis 共享限流状态；WHEN Redis 限流存储不可用 THEN 敏感入口 SHALL 返回 503，SHALL NOT 无保护放行。
4. 开发和单元测试 MAY 使用内存适配器，但 SHALL 与 Redis 适配器共享相同语义。
5. 超限 SHALL 返回 HTTP 429、稳定错误码 `RATE_LIMITED` 和有界的 `Retry-After`。
6. 每个请求 SHALL 有 `x-request-id`；合法上游 request ID MAY 复用，不合法值 SHALL 重新生成。
7. 结构化日志 SHALL 只记录 request ID、方法、规范化路由、状态、耗时和低基数字段，SHALL NOT 记录正文或认证凭据。

### Requirement 4：生产迁移必须单入口、串行和可恢复

1. 生产 Compose SHALL 只由独立 `migrate` 服务执行迁移；API entrypoint SHALL NOT 在生产重复执行迁移。
2. 本地开发 MAY 通过显式 `RUN_MIGRATIONS_ON_START=true` 保留启动前迁移便利；默认 SHALL 为 false。
3. 迁移进程 SHALL 获取数据库命名锁或经验证的等价互斥锁；未获得锁时 SHALL 在有界时间内失败退出。
4. SQL 拆分器 SHALL 正确识别引号、转义和注释中的分号，SHALL NOT 使用无状态 `split(";")`。
5. 迁移记录 SHALL 保存文件名和内容校验和；已应用文件内容变化 SHALL 关闭式失败。
6. 迁移 SHALL 不依赖 MySQL DDL 回滚；每项新迁移 SHALL 可在空库、已应用库和模拟部分应用状态下安全重跑或给出明确修复指引。
7. 历史重复编号 SHALL 保持文件名不变；从下一个迁移开始，数字前缀 SHALL 全局唯一，并由 CI 检查。
8. 领域迁移预检/修复 SHALL 与通用 runner 解耦，通过显式 registry 注册，SHALL NOT 继续集中在 album-video 模块。

### Requirement 5：CI 必须在发布前验证真实运行路径

1. 仓库 SHALL 新增 PR workflow，至少在 pull request 和 `develop/main/publish` push 上运行。
2. PR workflow SHALL 执行依赖锁定安装、fast checks、unit tests、管理端构建、小程序构建和 API Docker build。
3. integration job SHALL 启动 MySQL 8.4，从空数据库执行全部迁移，再启动 API 并真实请求 `/health`、`/health/db` 和代表性公共接口。
4. integration job SHALL 至少执行一个需登录的业务写入/读取 smoke，并在隔离数据库中清理 fixture。
5. Docker publish SHALL 依赖同一提交的 CI 成功；CI 失败 SHALL NOT 登录镜像仓库或推送镜像。
6. 根命令 SHALL 拆分为 `check:fast`、`test:unit`、`test:integration`、`build:all` 和 `check` 聚合命令。
7. 静态源码契约 SHALL 迁入 `test:contracts`，关键授权、事务、迁移和 HTTP 错误语义 SHALL 有运行时测试。
8. 失败输出 SHALL 能直接定位到单个 workspace、测试组或构建阶段。

### Requirement 6：API 必须形成模块化单体边界

1. API SHALL 保持单进程 Node.js HTTP 服务，SHALL NOT 拆微服务。
2. `server.js` SHALL 只负责装配配置、依赖、HTTP app、生命周期和监听，不再包含业务 SQL、媒体签名实现或业务路由分支。
3. HTTP 内核 SHALL 提供 router、request context、body parser、response、error normalization 和 request logging。
4. 业务 SHALL 至少拆为 `auth`、`catalog`、`sessions`、`signups`、`album`、`reviews`、`notifications` 和既有 `content-moderation` 模块。
5. 每个模块 SHALL 通过公开入口暴露 route registration 和 use cases；其他模块 SHALL NOT 导入其内部 repository 文件。
6. SQL SHALL 位于模块 repository 或明确的共享基础设施中；route handler SHALL NOT 直接执行 SQL。
7. 事务边界 SHALL 位于 use case/service；repository SHALL 接受显式 connection，SHALL NOT 隐式创建跨步骤事务。
8. 既有 URL、HTTP method、状态码、错误码、DTO 字段、隐私和权限语义 SHALL 保持兼容，除非本 spec 明确规定安全错误变化。
9. 拆分 SHALL 允许 legacy route 与新模块短期并存，但每个阶段 SHALL 有明确删除 legacy 分支的完成条件。

### Requirement 7：小程序相册与 API 客户端必须可独立演进

1. `utils/api.js` SHALL 只保留通用请求内核、认证头、错误归一化和维护模式；领域 API SHALL 移入独立 client。
2. 相册 API、COS 上传、用户图片、认证、车局和通知 SHALL 使用各自模块入口，SHALL NOT 重新汇聚到新的单一大文件。
3. `pages/session/album.vue` SHALL 保留页面路由、顶层状态编排和模板组合；媒体读取、上传、预览、选择/标注、分享和生命周期 authority SHALL 移入独立控制器或纯 helper。
4. 抽取前 SHALL 为当前竞态、隐私、短期 URL、视频重试、快速滑动和单项分享建立行为测试。
5. 拆分后相册 SHALL 保持当前 UI、分享路径、下载授权、审核状态、瀑布流和 viewer 行为。
6. 新的页面控制器 SHALL 能在无微信 UI 的 Node test 中验证状态转换；平台 API SHALL 通过薄适配器注入。
7. 小程序 SHALL NOT 在 D51 期间迁移到另一框架或整体改写为 Composition API。

### Requirement 8：管理后台必须按功能面拆分

1. `MiniProgramWorkspace`、`SessionAlbumWorkspace` 和 `CatalogWorkspace` SHALL 分离数据加载、筛选、表单、drawer 和媒体操作责任。
2. 可复用逻辑 SHALL 进入 feature-local controller/helper，SHALL NOT 新建无边界的全局 utils 集合。
3. `styles.css` SHALL 拆为 design tokens、shell、catalog、album、moderation 等 feature style，并保持现有视觉结果。
4. 管理后台 API 客户端 SHALL 按 auth/catalog/album/moderation 分组，共享同一 request kernel。
5. 管理后台 SHALL 增加关键登录、目录编辑、相册媒体和审核工作流的组件或浏览器级行为测试。
6. D51 SHALL NOT 重设计后台信息架构、品牌样式或业务流程。

### Requirement 9：talk 扩展必须拥有真实包边界

1. `packages/talk` SHALL NOT 通过相对路径导入 `apps/api` 内部文件。
2. 宿主 SHALL 通过明确 adapter 注入数据库 connection/transaction、错误构造、session access 和作者私有读取能力。
3. talk API SHALL 可仅依赖自身包与注入 fake 运行全部单元测试。
4. 小程序 ChatEntry、ManagePinnedMessage 和 talk API SHALL 只有一个规范源码；宿主 SHALL 删除或停止编译分叉副本。
5. talk 子模块升级 SHALL 先在子模块提交，再由主仓库固定到明确 commit；两边 SHALL 各自通过测试。
6. talk 公共 adapter contract SHALL 有版本或兼容测试，宿主内部重构 SHALL NOT 无提示破坏子模块。

### Requirement 10：运行时、工具和文档必须一致

1. 根 `engines`、本地版本文件、CI 和 Docker SHALL 统一 Node.js 24。
2. 仓库 SHALL 增加 ESLint 和格式检查；首期 MAY 对历史文件分批启用，但所有新增/拆分文件 SHALL 受约束。
3. JS 类型检查 SHALL 采用 `checkJs` 或等价渐进方式，SHALL NOT 要求 D51 一次性迁移全部 TypeScript。
4. README SHALL 更新当前 D51 阶段、工程结构、分层检查命令、迁移入口和真实验收说明。
5. 后端架构文档 SHALL 描述模块化单体、模块依赖规则、事务边界和迁移策略。
6. 文档 SHALL 明确 `check`、静态契约、真实 MySQL integration 和生产验收各自能证明什么，SHALL NOT 把源码断言称为端到端测试。

### Requirement 11：重构必须可分阶段交付和回滚

1. 每个阶段 SHALL 先建立失败测试或失败契约，再做最小迁移并保持完整回归通过。
2. 每个阶段 SHALL 只迁移一个清晰边界，SHALL NOT 同时进行业务功能、UI 重设计和架构拆分。
3. 新旧实现短期并存时 SHALL 只有一个运行路径，SHALL NOT 对同一请求双写或双执行。
4. 每个阶段 SHALL 记录移动的入口、兼容适配、删除条件、验证命令和回滚方式。
5. WHEN 新模块验证失败 THEN 回滚 SHALL 能恢复到上一阶段的单一路径，且不需要回滚已成功应用的业务数据。
6. 最终 SHALL 删除不再使用的 legacy import、route branch、复制组件和兼容层。

### Requirement 12：最终验收必须覆盖行为、构建和部署边界

1. `npm run check:fast`、`npm run test:unit`、`npm run test:contracts`、`npm run test:integration` 和 `npm run build:all` SHALL 全部通过。
2. 从空 MySQL 8.4 数据库迁移到最新版本 SHALL 成功；重复迁移 SHALL 无变更成功退出。
3. 两个并发迁移进程 SHALL 只有一个获得锁，另一个 SHALL 有界失败且不产生部分记录。
4. 生产配置负向测试 SHALL 证明 mock login、弱 secret、HTTP base URL 和错误数据库锁均拒绝启动。
5. 小程序 SHALL 在微信开发者工具验证登录、首页、建车/报名、相册图片、ready 视频、单项分享和隐私收紧代表路径。
6. 管理后台 SHALL 验证扫码登录、目录编辑、车局相册和内容审核代表路径。
7. 发布前 SHALL 构建 API 与 admin Docker image，并验证容器使用独立 migrate 服务后健康启动。
8. 验收记录 SHALL 区分本地静态、单元、集成、开发者工具和生产只读验证证据。

## 4. 非目标

- 不拆分微服务，不引入消息队列或分布式事务。
- 不更换 Node HTTP 框架，不把 D51 变成 Fastify、NestJS 或其他框架迁移。
- 不一次性把整个仓库改写为 TypeScript、Composition API 或新的状态管理框架。
- 不修改现有产品流程、业务权限、相册隐私、审核策略、公开分享范围或数据库业务模型。
- 不重设计小程序或管理后台 UI。
- 不重命名已经上线的历史迁移文件。
- 不在架构迁移期间并行加入无关功能。
- 不以提高文件数量为目标；只有形成稳定责任边界的拆分才属于完成。
