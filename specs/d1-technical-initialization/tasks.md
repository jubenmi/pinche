# D1 Tasks: 技术初始化执行清单

更新日期：2026-06-11

## D1执行任务

- [x] D1.1 建立D1 spec目录：`specs/d1-technical-initialization/`。
- [x] D1.2 初始化根工程配置：`package.json`、`.env.example`、`.editorconfig`、`.gitignore`。
- [x] D1.3 初始化微信小程序空壳：`apps/miniprogram` 和MVP页面。
- [x] D1.4 初始化Node API空壳：`apps/api`、健康检查、JSON错误响应。
- [x] D1.5 初始化MySQL连接和迁移入口。
- [x] D1.6 添加D1空迁移。
- [x] D1.7 初始化开发登录接口和 `BOOTSTRAP_ADMIN_OPENIDS` 管理员识别。
- [x] D1.8 初始化Dockerfile和 `docker-compose.yml`。
- [x] D1.9 配置基础检查：API语法检查、小程序页面完整性检查。
- [x] D1.10 安装依赖并生成锁文件。
- [x] D1.11 执行D1验收命令并记录结果。

## D1验收

- [x] D1 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D1 design 已落地到 [design.md](./design.md)。
- [x] D1 tasks 已落地到本文件。
- [x] 小程序空壳页面文件完整。
- [x] `GET /health` 可访问。
- [x] `GET /health/db` 可访问。
- [x] 空迁移可执行。
- [x] 开发登录接口可返回 `system_admin`。
- [x] Docker Compose配置可解析。
- [x] API Docker镜像可构建。

## 验证记录

- `npm install`：通过，安装API依赖并生成 `package-lock.json`。
- `npm run check`：通过，API语法检查通过，小程序7个页面文件完整。
- `docker compose config`：通过，`api`、`mysql`、`redis` 服务配置可解析。
- `docker compose up -d mysql redis`：通过，MySQL healthy，Redis running。
- `MYSQL_PORT=3307 npm run migrate`：通过，执行 `0001_empty_bootstrap.sql`。
- `PORT=3018 MYSQL_PORT=3307 BOOTSTRAP_ADMIN_OPENIDS=dev-admin-openid npm run start:api`：通过，本地API可启动。
- `curl -sS http://localhost:3018/health`：通过，返回 `ok: true`。
- `curl -sS http://localhost:3018/health/db`：通过，返回 `ok: true`。
- `curl -sS -X POST http://localhost:3018/api/auth/wechat/login ...`：通过，`roles` 包含 `system_admin`。
- `curl -sS http://localhost:3018/not-found`：通过，返回JSON 404。
- 非法JSON登录请求：通过，返回JSON 400。
- `docker compose build api`：通过，API镜像构建成功。
- `docker compose up -d api`：通过，API容器启动成功。
- Docker Compose API `/health`、`/health/db`、开发登录接口：通过。
