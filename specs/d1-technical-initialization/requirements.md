# D1 Requirements: 技术初始化

更新日期：2026-06-11

## Introduction

D1目标是把微信小程序MVP的技术底座搭起来。完成后，仓库应具备最小可运行结构：小程序空壳、Node.js API、Dockerfile、`docker-compose.yml`、MySQL迁移入口、Redis配置、环境变量模板、健康检查和开发登录接口。

D1只做技术初始化，不做业务数据模型和业务流程实现。

## Requirements

### Requirement 1: 工程结构

**User Story:** 作为开发者，我希望仓库具备清晰的多应用结构，以便后续阶段可以分别开发小程序、后端和共享代码。

#### Acceptance Criteria

1. WHEN D1完成 THEN 仓库 SHALL 包含 `apps/miniprogram`、`apps/api`、`packages/shared`。
2. WHEN 开发者查看根目录 THEN SHALL 看到根 `package.json`、`.env.example`、`.editorconfig`、`.gitignore` 和 `docker-compose.yml`。
3. WHEN 后续阶段开发共享常量 THEN SHALL 可以从 `packages/shared` 扩展。

### Requirement 2: 微信小程序空壳

**User Story:** 作为开发者，我希望小程序空壳已经具备MVP页面路径，以便D2后可以直接填充业务页面。

#### Acceptance Criteria

1. WHEN D1完成 THEN `apps/miniprogram/src/pages.json` SHALL 声明MVP页面路径。
2. WHEN 页面路径被声明 THEN 每个页面 SHALL 至少包含对应 `.vue` 文件。
3. WHEN 开发者打开微信开发者工具 THEN SHALL 可以选择 UniApp 生成的 `apps/miniprogram/dist/dev/mp-weixin` 作为小程序项目目录。
4. WHEN 小程序发起API请求 THEN SHALL 通过统一配置读取 API base URL。
5. WHEN 页面展示占位内容 THEN SHALL 避免红包、返现、提现、现实陪伴承诺等违规表达。

### Requirement 3: Node.js API空壳

**User Story:** 作为开发者，我希望后端服务可以启动并返回健康检查，以便后续阶段在稳定API底座上开发。

#### Acceptance Criteria

1. WHEN 执行 `npm run dev:api` THEN API SHALL 监听配置的 `PORT`。
2. WHEN 访问 `GET /health` THEN API SHALL 返回 JSON 成功状态。
3. WHEN 访问未知路径 THEN API SHALL 返回 JSON 404。
4. WHEN 请求体不是合法JSON THEN API SHALL 返回 JSON 400。
5. WHEN API启动 THEN SHALL 从环境变量或 `.env` 加载配置。

### Requirement 4: MySQL连接和迁移入口

**User Story:** 作为开发者，我希望D1已有MySQL连接和迁移机制，以便D2可以安全创建业务表。

#### Acceptance Criteria

1. WHEN 执行 `npm run migrate` THEN API SHALL 连接MySQL。
2. WHEN 数据库不存在 THEN 迁移脚本 SHALL 创建配置的数据库。
3. WHEN 迁移脚本运行 THEN SHALL 确保 `schema_migrations` 表存在。
4. WHEN 迁移脚本发现未执行的SQL迁移 THEN SHALL 按文件名顺序执行。
5. WHEN 访问 `GET /health/db` THEN API SHALL 用MySQL执行 `SELECT 1` 并返回连接状态。
6. WHEN D1完成 THEN SHALL 至少包含一次空迁移。

### Requirement 5: Redis配置边界

**User Story:** 作为开发者，我希望Redis已经进入本地编排，但不影响核心服务启动。

#### Acceptance Criteria

1. WHEN 查看 `docker-compose.yml` THEN SHALL 存在 `redis` 服务。
2. WHEN Redis未启用 THEN API SHALL 仍可提供 `/health` 和核心HTTP能力。
3. WHEN 后续阶段需要缓存或限流 THEN SHALL 可通过 `REDIS_URL` 和 `REDIS_ENABLED` 配置启用。

### Requirement 6: Docker本地编排

**User Story:** 作为开发者，我希望本地可以用Docker Compose启动依赖和API，以便开发环境接近部署环境。

#### Acceptance Criteria

1. WHEN D1完成 THEN `apps/api/Dockerfile` SHALL 存在。
2. WHEN D1完成 THEN `docker-compose.yml` SHALL 包含 `api`、`mysql`、`redis` 服务。
3. WHEN 构建API镜像 THEN SHALL 使用Node.js运行时并启动 `apps/api/src/server.js`。
4. WHEN MySQL服务启动 THEN SHALL 创建MVP配置数据库。
5. WHEN API容器启动 THEN SHALL 通过环境变量连接 `mysql` 服务。

### Requirement 7: 开发环境与基础检查

**User Story:** 作为开发者，我希望D1提供基础检查命令，以便后续提交前能发现明显配置错误。

#### Acceptance Criteria

1. WHEN 执行 `npm run check` THEN SHALL 检查API JavaScript语法和小程序页面文件完整性。
2. WHEN 执行小程序检查脚本 THEN SHALL 验证 UniApp `src/pages.json` 中声明的页面文件都存在。
3. WHEN 查看 `.env.example` THEN SHALL 包含Node、MySQL、Redis、微信登录、管理员初始化相关变量。
4. WHEN 查看 `.editorconfig` THEN SHALL 定义基础缩进和换行规则。

### Requirement 8: 开发登录和管理员初始化

**User Story:** 作为开发者，我希望开发版能跑通 `wx.login` 到后端业务token的最小闭环，并能识别系统管理员。

#### Acceptance Criteria

1. WHEN 小程序调用登录接口并传入 `code` THEN API SHALL 返回 `openid`、`token` 和 `roles`。
2. WHEN `WECHAT_MOCK_LOGIN=true` THEN API SHALL 使用开发模式根据 `code` 生成或识别 `openid`。
3. WHEN `WECHAT_MOCK_LOGIN=false` THEN API SHALL 预留调用微信 `jscode2session` 的能力。
4. WHEN 返回的 `openid` 出现在 `BOOTSTRAP_ADMIN_OPENIDS` THEN `roles` SHALL 包含 `system_admin`。
5. WHEN 返回的 `openid` 不在 `BOOTSTRAP_ADMIN_OPENIDS` THEN `roles` SHALL 至少包含 `player`。
6. WHEN 签发业务token THEN SHALL 使用 `SESSION_SECRET` 进行签名。

### Requirement 9: D1交付物

**User Story:** 作为开发团队，我希望D1有可检查的交付物，以便明确是否可以进入D2。

#### Acceptance Criteria

1. WHEN D1完成 THEN SHALL 产出D1 requirements、design、tasks。
2. WHEN D1完成 THEN SHALL 产出小程序空壳。
3. WHEN D1完成 THEN SHALL 产出可启动Node API。
4. WHEN D1完成 THEN SHALL 产出Dockerfile和 `docker-compose.yml`。
5. WHEN D1完成 THEN SHALL 产出空数据库迁移。
6. WHEN D1完成 THEN SHALL 产出 `.env.example`。
7. WHEN D1完成 THEN SHALL 记录已执行的验证命令。
