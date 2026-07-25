# D51 Design：工程架构加固与模块化重构

更新日期：2026-07-22

版本：v1.0

状态：现状审计与技术方向已确认，待实施

## 1. 设计摘要

D51 采用“先加护栏、再建接缝、最后搬迁”的渐进式模块化单体方案。

API 仍是一个 Node.js 进程、一个 MySQL 事实来源和现有 Redis/COS/微信集成。重构先建立统一 HTTP 内核、生产配置校验、迁移锁和真实集成 CI；之后用 route registry 把 `server.js` 的业务分支逐域迁出，再把 `core/service.js` 中的事务用例和 SQL 拆入各模块。每次只切换一个领域的单一路径，不双写、不同时改变外部行为。

前端采用同样策略：先为现有竞态和授权建立纯行为测试，再把大页面中的状态机、平台适配和领域 API 抽到 feature-local 模块。D51 不进行 UI 改版，也不强制改变当前 Vue Options API 风格。

选择该方案的原因：

- 相比推倒重写，能持续使用现有大量回归和线上语义。
- 相比只做安全补丁，同时解决新增功能继续堆入大文件的问题。
- 相比微服务拆分，不引入网络边界、分布式事务和额外运维成本。

## 2. 总体阶段与依赖

```text
安全与生产启动加固
  -> 迁移单入口与锁
  -> CI / MySQL integration 安全网
  -> HTTP 内核与 route registry
  -> 后端领域逐个搬迁
  -> 小程序与管理后台拆分
  -> talk 包边界与工程收口
  -> 全量验收和删除兼容层
```

前三阶段是所有结构重构的前置门。后端和前端拆分可以在安全网稳定后由不同分支执行，但同一大文件一次只允许一个结构迁移分支，避免机械冲突。

## 3. 目标工程结构

### 3.1 API

```text
apps/api/src/
  server.js                       # 进程入口；只加载 config、创建依赖并 listen
  app/
    create-app.js                 # 组合 HTTP 内核、模块 router 和 legacy fallback
    create-dependencies.js        # 组合 db、redis、cos、wechat、clock、logger
    lifecycle.js                  # shutdown、signal、server timeout
  http/
    router.js                     # method + pattern 注册与匹配
    request-context.js            # requestId、URL、route params、actor lazy loader
    body.js                       # JSON/raw 有界读取
    response.js                   # JSON、error、cache/privacy headers
    errors.js                     # AppError 与 normalizeError
    request-log.js                # 低敏结构化请求日志
  infra/
    db/
      mysql.js
      migrate.js
      migration-lock.js
      migration-registry.js
      sql-statements.js
    redis/
      client.js
      rate-limit-store.js
    storage/
      cos.js
    wechat/
      client.js
      subscribe-message.js
  modules/
    auth/
      index.js
      routes.js
      service.js
      repository.js
      validation.js
      rate-limit.js
    catalog/
      index.js
      routes.js
      service.js
      repository.js
      policy.js
      dto.js
    sessions/
      index.js
      routes.js
      service.js
      repository.js
      policy.js
      dto.js
    signups/
      index.js
      routes.js
      service.js
      repository.js
      policy.js
      dto.js
    album/
      index.js
      routes.js
      service.js
      repository.js
      media-routes.js
      media-storage.js
      capabilities.js
      policy.js
      dto.js
    reviews/
      index.js
      routes.js
      service.js
      repository.js
      dto.js
    notifications/
      index.js
      routes.js
      service.js
      repository.js
    content-moderation/            # 保留已有细分模块，调整宿主接口
    extensions/
      registry.js
      talk-adapter.js
```

目录是目标边界，不要求一次提交全部创建。模块只在搬迁实际责任时创建文件，避免空壳层级。

### 3.2 小程序

```text
apps/miniprogram/src/
  services/
    request.js                    # 原 api.js 中通用请求内核
    auth-client.js
    session-client.js
    album-client.js
    upload-client.js
    notification-client.js
    catalog-client.js
  features/album/
    album-controller.js           # 页面顶层状态组合与刷新 authority
    album-media-controller.js     # URL、可见性和读取状态
    album-upload-controller.js    # 图片/视频选择、压缩和上传编排
    album-viewer-controller.js    # preview/video transition
    album-selection-controller.js # 下载/标注选择状态
    album-share-controller.js     # 整册/单项分享状态
    album-formatters.js           # 纯展示函数
  pages/session/album.vue         # 模板与控制器接线
```

平台能力 `uni.request`、`uni.downloadFile`、`uni.getFileSystemManager`、相册权限和视频压缩通过薄 adapter 传给控制器。纯状态转换不直接访问全局 `uni`。

### 3.3 管理后台

```text
apps/admin-web/src/
  services/
    request.js
    auth-client.js
    catalog-client.js
    album-client.js
    moderation-client.js
  features/
    catalog/
    sessions/
    album/
    moderation/
  styles/
    tokens.css
    shell.css
    catalog.css
    album.css
    moderation.css
```

Workspace 保留为页面级容器，表格、筛选栏、drawer、表单和媒体操作拆为同 feature 子组件。CSS 先按原选择器原样搬迁，再单独清理重复规则，避免结构拆分与视觉调整混在一起。

## 4. HTTP 内核设计

### 4.1 Router

使用仓库内轻量 router，不引入新的 Web 框架。最小接口：

```js
const router = createRouter();

router.add({
  method: "GET",
  pattern: "/api/sessions/:sessionId",
  body: "none",
  auth: "optional",
  handler: getSessionHandler
});

await router.handle(context);
```

`router.add` 在启动时把静态段和 `:param` 编译为受控 matcher，并为每条路由保存规范化 route name。D51 不支持通配业务路由、运行时动态注册或中间件生态；callback、媒体字节流等特殊端点仍可注册专用 handler。

路由 handler 接收：

```js
{
  request,
  response,
  url,
  params,
  query,
  body,
  requestId,
  actor,
  dependencies
}
```

`actor` 根据 route auth 声明由 HTTP 内核统一解析，避免 handler 重复调用 `getAuthUser`。需要 signed capability 而非用户 token 的媒体路由声明 `auth: "capability"` 并在 handler 内使用模块 verifier。

### 4.2 渐进兼容

`create-app.js` 初期按以下顺序处理：

1. HTTP 内核级 health 和静态媒体入口。
2. 已迁移模块 router。
3. talk extension router。
4. `legacyRoute(context)`。
5. 统一 404。

每迁移一个领域，先让新 router 接管精确方法和路径，再删除 legacy 中对应分支。测试必须证明同一路径只有一个 handler 被调用。所有领域迁完后删除 `legacyRoute`。

### 4.3 Body 和错误

`readBody(request, policy)` 的 policy 为：

```js
{ kind: "none" | "json" | "raw" | "stream", maxBytes: number }
```

- JSON 默认 1 MiB。
- `Content-Length` 预检和实际流量累计使用同一上限。
- `PAYLOAD_TOO_LARGE` 是 413，`INVALID_JSON` 是 400。
- stream handler 自己拥有 backpressure、临时文件和 cleanup。
- route registry 必须声明 body policy；没有声明的写请求启动检查失败。

`response.js` 统一加入 request ID、`nosniff`、适合 API 的 referrer policy 和模块指定的 cache/privacy headers。Traefik 负责 HTTPS/HSTS，API 不根据不可信转发头自行判断 TLS。

### 4.4 生产配置

新增纯函数：

```js
validateRuntimeConfig(config, env) -> config | throws ConfigError
```

该函数在 `config` 导出前执行。生产分支验证 mock login、secret、HTTPS base URL 和 database target lock；开发分支保留现有默认值。负向测试以隔离子进程导入 config，证明在任何 DB/Redis/网络 import side effect 前失败。

### 4.5 限流与请求日志

统一接口：

```js
await rateLimiter.consume({ scope, key, limit, windowSeconds });
```

Redis 使用原子 Lua 或等价事务保证计数和过期一致；内存实现只供开发/测试。生产敏感入口无法访问 Redis 时抛 `RATE_LIMIT_UNAVAILABLE` 503。

request ID 只接受 `^[A-Za-z0-9._-]{8,80}$`；否则生成 `crypto.randomUUID()`。请求结束日志固定为 JSON，路径使用 route name 而不是带 ID/token 的原始 URL。

## 5. 后端领域边界

### 5.1 依赖方向

```text
http/app -> module public index -> service/use case -> repository -> infra/db
                                      -> policy/dto
                                      -> external port
```

规则：

- route 不导入其他模块 repository。
- repository 不创建事务，不调用 HTTP response，不读取全局 request。
- service 接收 connection 或 transaction runner，并拥有锁顺序和提交边界。
- policy/dto 尽量为纯函数。
- 外部服务通过 port 注入，例如 `wechatMessages.send`、`albumStorage.inspect`。
- 共享内容只在确实有两个稳定消费者时进入 `packages/shared`；不建立新的 `common/helpers.js` 垃圾抽屉。

### 5.2 搬迁顺序

1. **album**：当前 server/core 最大交叉面，且已有相册、视频、COS、内容审核测试可保护搬迁。
2. **sessions + signups**：锁、座位、报名和通知事务紧密，先定义 sessions 公共 access port，再迁 signups。
3. **catalog**：store/script/review/claim 形成独立业务边界。
4. **reviews + notifications + share-events**：体量较小，用于完成 core service 清空。
5. **auth**：在 HTTP 内核稳定后收敛登录、后台票据和用户资料；避免过早同时改 router 与 token 语义。

内容审核已有较细模块，不进行重新设计；只把 server 里的 moderation route/callback 接线移入其公开 `index.js`。

### 5.3 事务与 DTO

每个写用例明确：

- authority preflight；
- 锁顺序；
- repository 调用；
- extension/outbox-like 持久化动作；
- commit 后外部通知；
- 幂等键与重复请求结果。

DTO 继续使用现有 snake_case 输出。repository row 不得直接从 route 返回；迁移时先把现有 serializer 原样移动，再单独讨论 DTO 版本。

## 6. 迁移设计

### 6.1 Runner 与 registry

通用 runner 位于 `infra/db/migrate.js`，只负责：

1. 获取命名锁 `pinche:schema-migrations:<database>`。
2. 确保 migration metadata。
3. 读取并排序文件。
4. 校验历史记录与 SHA-256。
5. 调用可选 registry preflight/reconcile。
6. 顺序执行 SQL。
7. 写入 applied 记录并释放锁。

领域 registry 形态：

```js
registerMigrationHandler("0025_content_moderation_provider_attempts.sql", {
  before,
  reconcile,
  skipSql
});
```

album-video、content-moderation、user-image-assets 的特殊处理分别回到所属模块，通过 registry 显式组合。

### 6.2 SQL parser

`splitSqlStatements` 使用小型状态机，跟踪：

- 单引号、双引号和反引号；
- 反斜杠和成对引号转义；
- `--`、`#` 行注释；
- `/* ... */` 块注释。

只有普通状态中的分号才结束 statement。单元测试使用包含字符串分号、注释分号和 PREPARE SQL 的 fixture。

### 6.3 校验和升级

预留 `0033_schema_migration_checksums.sql` 为 `schema_migrations` 增加 `checksum_sha256`。升级时：

- 已应用旧文件先根据当前受信仓库内容回填 checksum。
- 回填迁移由固定版本和测试保护。
- 后续启动若文件 checksum 不同则失败，不自动覆盖。
- 历史重复前缀写入 allowlist；新文件必须大于当前最大前缀且唯一。

### 6.4 启动入口

生产 Compose 的 `migrate` 服务成功后 API 才启动。API entrypoint 不再隐式迁移。开发者使用 `npm run migrate`，或显式 `RUN_MIGRATIONS_ON_START=true npm run start:api`。Worker 永不隐式执行迁移。

## 7. CI 与测试设计

### 7.1 命令分层

```text
npm run check:fast        syntax + lint + format + env/contracts
npm run test:unit         所有无外部服务 Node tests
npm run test:contracts    明确标记的源码/边界契约
npm run test:integration  MySQL + migration + API HTTP smoke
npm run build:all         admin web + mp-weixin + Docker build check
npm run check             fast + unit + contracts
```

本地默认 `check` 保持快速；PR CI 额外执行 integration 和 build。发布 workflow 不再复制测试逻辑，只依赖可复用 CI workflow 或同一提交的 required check。

### 7.2 Integration fixture

新增 `docker-compose.d51-test.yml`：

- 独立 MySQL 8.4；
- 独立数据库名和凭据；
- Redis；
- migrate 一次性容器；
- API；
- acceptance runner。

acceptance runner 先证明目标 host/database 为 D51 fixture，再执行登录、目录读取、创建私有 fixture、车局代表读写和清理。任何目标不匹配都在业务写入前失败。

### 7.3 测试迁移原则

源码字符串测试不一次删除，而是分类：

- 安全禁令、构建产物和宿主接线可继续作为 contract。
- 路由状态码、事务、锁、授权、DTO 和迁移行为必须补运行时测试。
- 当运行时测试覆盖后，删除只锁定函数位置或源码拼写的脆弱断言。

## 8. 小程序拆分设计

### 8.1 API client

第一步把现有 `request()`、token storage、维护模式和错误归一化搬到 `services/request.js`，保留原 `utils/api.js` 作为重导出兼容层。随后按调用点迁移领域 client，最后删除兼容层。

每个 client 只组装 URL、method、body 并调用 request kernel；COS SDK、文件系统和状态 authority 不放入 client。

### 8.2 相册控制器

按状态所有权拆分，而不是按模板区域拆分：

- `album-media-controller`：短期 URL、可见性、thumbnail 状态、刷新串行号。
- `album-upload-controller`：选择、文件事实、压缩、直传/本地 fallback、进度。
- `album-viewer-controller`：当前项、视频 URL、一次自动刷新、显式重试。
- `album-selection-controller`：多选下载和批量标注。
- `album-share-controller`：整册 token、单项媒体 ID cache、微信 share payload。
- `album-controller`：加载公开/成员相册、组合子控制器、账号切换与页面销毁。

控制器公开 `state + actions + dispose()`，异步 action 均使用 generation/request token 拒绝迟到结果。`album.vue` 只把模板事件映射到 action。

### 8.3 拆分顺序

先抽纯 formatter 和 share/selection，再抽 viewer/media，最后抽 upload 和顶层 loader。上传涉及平台 API 和最多副作用，放在已有控制器模式稳定后处理。

## 9. 管理后台拆分设计

先拆 API client，再拆 Workspace：

1. 将 fetch、token 和错误处理收敛到 request kernel。
2. 将筛选/分页和表单 normalization 抽为纯 helper。
3. 将 drawer 和表格分为子组件，父 Workspace 保留数据拥有权。
4. 状态稳定后再把 feature state 移入 controller/composable。
5. CSS 按 feature 原样移动并通过构建与截图对比确认无视觉漂移。

不在 D51 引入新的 UI 组件库或全局状态管理。

## 10. talk 包设计

`packages/talk` 保持独立子模块，但改为宿主适配器模式。

API 导出：

```js
createSessionPseudoChatExtension({
  database,
  errors,
  sessionAccess,
  authorSocialRead
});
```

talk service 只调用 adapter contract，不知道 `apps/api` 路径。主仓库 `talk-adapter.js` 把现有 MySQL、AppError、session access 和 D46 author read 映射进去。

小程序只从 `@jubenmi/talk/miniprogram` 导入组件。当前宿主中的 TDesign 适配变化先回推到子模块规范组件并通过小程序构建，再删除本地分叉副本。

## 11. 可观测性与安全响应

- 所有 JSON 响应带 `x-request-id` 和 `x-content-type-options: nosniff`。
- author-private、媒体 capability 和后台响应保留现有 `private, no-store`。
- 5xx 日志记录内部 error class/code，但不把 stack、SQL 或 secret 返回客户端。
- 429/503/413 使用稳定低敏错误码。
- migration、worker 和 HTTP 日志都使用 JSON 单行，便于现有容器日志采集。

## 12. 回滚策略

### 12.1 安全与 CI

安全配置变更通过环境开关只允许开发兼容；生产不提供绕过。CI workflow 可独立回滚，不影响运行时。

### 12.2 路由搬迁

每个领域使用单个 registry 切换提交。回滚该提交即可恢复 legacy route；数据库与 DTO 不变。禁止新旧 handler 同时执行。

### 12.3 前端拆分

先使用兼容重导出和相同 props/events。每次只替换一个 controller；若出现回归，恢复页面内旧实现，不需要数据回滚。

### 12.4 迁移 runner

先在空库和生产结构副本验证 metadata 升级。checksum 一旦上线不回退记录；runner 回滚版本仍必须能读取新 metadata。任何无法恢复的部分应用状态必须在执行生产迁移前被 preflight 阻断。

## 13. 完成标准

D51 完成时应满足：

- 生产错误配置无法启动，普通 JSON body 有界，敏感入口共享限流。
- 生产只有独立 migrate 入口，并发迁移受锁保护。
- PR CI 真实执行空库迁移和 HTTP smoke。
- `server.js` 只保留进程入口，`core/service.js` 不再承载业务实现。
- 业务 SQL 位于明确 repository，route 不直接执行 SQL。
- 相册页面、领域 API 和后台 Workspace 已按本设计形成可测试边界。
- talk 包无宿主反向 import，宿主不再编译分叉组件。
- Node、检查命令、架构文档和实际 CI/Docker 一致。
- 现有完整回归、构建、微信开发者工具代表路径和容器验收均通过。
