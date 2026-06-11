# D1 Design: 技术初始化设计

更新日期：2026-06-11

## Overview

D1建立可运行的技术底座，不实现业务流程。D1完成后，D2可以直接在既有小程序页面、Node API、迁移系统和Docker环境上实现身份权限与核心表。

## Project Structure

```text
apps/
  miniprogram/
    src/
      App.vue
      main.js
      manifest.json
      pages.json
    project.config.json
    vite.config.js
  api/
    Dockerfile
    package.json
    migrations/
    src/
      config/
      db/
      modules/
      server.js
packages/
  shared/
scripts/
docker-compose.yml
.env.example
```

## Miniprogram Shell

小程序源码在D2升级为UniApp结构。D1原生空壳的页面路径保留为UniApp `src/pages.json` 中的页面声明。

MVP页面路径：

```text
pages/index/index
pages/mine/index
pages/admin/catalog
pages/session/create
pages/session/detail
pages/session/apply
pages/session/manage
```

页面只提供D1占位和跳转，不实现业务提交。

UniApp关键文件：

- `src/App.vue` 保存全局样式和基础配置。
- `src/pages.json` 声明页面、窗口和导航。
- `src/manifest.json` 保存微信小程序构建配置。
- 微信开发者工具打开 `apps/miniprogram/dist/dev/mp-weixin`。

## API Runtime

API采用原生Node.js HTTP服务，减少D1依赖。MySQL连接使用 `mysql2`。

接口：

| Method | Path | D1行为 |
| --- | --- | --- |
| `GET` | `/health` | 返回服务状态、环境和版本 |
| `GET` | `/health/db` | 执行 `SELECT 1` 检查MySQL连接 |
| `POST` | `/api/auth/wechat/login` | 开发登录，返回openId、roles、token |

未知路径统一返回：

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Route not found"
  }
}
```

## Environment

`.env.example` 提供以下变量：

```text
NODE_ENV
PORT
APP_BASE_URL

MYSQL_HOST
MYSQL_PORT
MYSQL_DATABASE
MYSQL_USER
MYSQL_PASSWORD

REDIS_ENABLED
REDIS_URL

WECHAT_MOCK_LOGIN
WECHAT_APP_ID
WECHAT_APP_SECRET

SESSION_SECRET
CONTACT_ENCRYPTION_KEY
BOOTSTRAP_ADMIN_OPENIDS
```

本地开发时API会尝试读取根目录 `.env`；Docker Compose则直接设置容器环境变量。

## MySQL Migration Design

迁移入口：

```text
apps/api/src/db/migrate.js
```

规则：

- 先连接MySQL server。
- 创建 `MYSQL_DATABASE`。
- 进入数据库。
- 创建 `schema_migrations`。
- 按文件名顺序执行 `apps/api/migrations/*.sql`。
- 已执行迁移不会重复运行。

D1迁移：

```text
0001_empty_bootstrap.sql
```

该迁移只验证迁移链路，不创建业务表。业务表进入D2。

## Auth Bootstrap

D1只做开发登录闭环：

```text
小程序 wx.login
  -> POST /api/auth/wechat/login { code }
  -> 后端换取或生成 openid
  -> 根据 BOOTSTRAP_ADMIN_OPENIDS 计算角色
  -> 使用 SESSION_SECRET 签发业务 token
```

开发模式：

- `WECHAT_MOCK_LOGIN=true` 时，`code = dev-admin-openid` 可直接得到同名openId。
- 其他code会生成 `mock_openid_{hash}`。

正式模式预留：

- `WECHAT_MOCK_LOGIN=false` 时，服务端调用微信 `jscode2session`。
- 若微信密钥未配置，则返回配置错误。

## Docker Design

服务：

```text
api
mysql
redis
```

MySQL是事实来源，Redis只作为后续缓存和限流能力的依赖预留。

`api`容器：

- 基于官方Node镜像。
- 安装API生产依赖。
- 暴露 `PORT`。
- 默认执行 `node src/server.js`。

## Verification Commands

D1完成前需要执行：

```text
npm install
npm run check
npm run migrate
npm run start:api
curl -sS http://localhost:3018/health
curl -sS http://localhost:3018/health/db
curl -sS -X POST http://localhost:3018/api/auth/wechat/login ...
docker compose config
docker compose build api
```

如本机未启动MySQL，可先通过 `docker compose up -d mysql redis` 启动依赖。

## D2 Entry Gate

D2可以开始的条件：

- 小程序页面文件完整。
- API健康检查可访问。
- MySQL迁移可执行。
- 开发登录接口可返回业务token。
- `BOOTSTRAP_ADMIN_OPENIDS` 可识别 `system_admin`。
- Docker配置可解析，API镜像可构建。
