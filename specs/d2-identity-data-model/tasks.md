# D2 Tasks: 身份权限与数据模型执行清单

更新日期：2026-06-11

## D2执行任务

- [x] D2.1 建立D2 spec目录：`specs/d2-identity-data-model/`。
- [x] D2.2 补充根 README：项目介绍、启动方式、spec入口、验证命令。
- [x] D2.3 将小程序空壳升级为UniApp结构，并保留微信开发者工具验证路径。
- [x] D2.4 新增D2数据库迁移：核心用户、角色、资料、车、座位、报名、事件表。
- [x] D2.5 将微信登录升级为写库登录，并返回 `user`、`roles`、`token`。
- [x] D2.6 实现业务token校验和角色权限中间件。
- [x] D2.7 实现当前用户接口：`GET /api/users/me`。
- [x] D2.8 实现管理员店家/剧本CRUD和资料申请审核。
- [x] D2.9 实现公共资料列表、新增资料申请、认领申请、演绎档案接口。
- [x] D2.10 实现建车、座位、发布和补贴配平校验。
- [x] D2.11 实现报名、审核通过事务、拒绝、押金和锁座事务。
- [x] D2.12 实现分享事件和订阅请求结果记录。
- [x] D2.13 新增D2烟测脚本并执行验收。
- [x] D2.14 同步开发路线图D2入口。

## D2验收

- [x] D2 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D2 design 已落地到 [design.md](./design.md)。
- [x] D2 tasks 已落地到本文件。
- [x] 根 README 已补充。
- [x] UniApp源码结构检查通过。
- [x] `npm run check` 通过。
- [x] `npm run migrate` 通过并执行D2迁移。
- [x] `GET /health` 和 `GET /health/db` 通过。
- [x] `GET /api/users/me` 可返回当前用户。
- [x] 普通用户访问管理员接口返回 `403`。
- [x] 管理员可创建店家和剧本。
- [x] 发布车时校验补贴配平。
- [x] 审核报名通过和锁座事务可用。
- [x] `npm run d2:smoke` 通过。
- [x] UniApp 微信小程序构建通过。
- [x] API Docker镜像可构建。
- [x] 生产依赖审计 `npm audit --omit=dev` 通过。

## 验证记录

- `npm install`：通过，安装并锁定 UniApp/Vite 依赖。
- `npm run check`：通过，API 8个JS文件语法检查通过，UniApp 7个页面检查通过。
- `MYSQL_PORT=3307 npm run migrate`：通过，执行 `0002_identity_and_core_model.sql`。
- `MYSQL_PORT=3307 npm run migrate` 重复执行：通过，无新增迁移，证明迁移幂等。
- `PORT=3028 MYSQL_PORT=3307 BOOTSTRAP_ADMIN_OPENIDS=dev-admin-openid npm run start:api`：通过，本地D2 API可启动。
- `curl -sS http://localhost:3028/health`：通过，返回 `ok: true`。
- `curl -sS http://localhost:3028/health/db`：通过，返回 `ok: true`。
- `BASE_URL=http://localhost:3028 npm run d2:smoke`：通过，覆盖管理员权限、资料CRUD、建车、发布、报名、审核、押金、锁座、分享、订阅和认领。
- `npm run build:mp-weixin`：通过，生成 UniApp 微信小程序产物。
- `docker compose build api`：通过，API镜像构建成功。
- `docker compose up -d api`：通过，API容器启动成功。
- Docker Compose API `/health`、`/health/db`：通过。
- `BASE_URL=http://localhost:3018 npm run d2:smoke`：通过，容器版D2 API烟测通过。
- `npm audit --omit=dev`：通过，生产依赖0漏洞。普通 `npm audit` 包含UniApp开发构建链，仍会报告DCloud传递依赖告警。
