# 后端架构与部署设计

更新日期：2026-06-11

本文定义MVP后端技术栈和部署方式。目标是让后端从第一天就能用 Docker 在本地、测试环境、生产环境保持一致运行。

## 1. 技术栈

```text
Runtime: Node.js
API: HTTP JSON API
Database: MySQL
Cache: Redis，可选
Deploy: Docker image + Docker Compose 或容器平台
```

MVP后端只承担这些职责：

- 微信登录和业务 token 签发。
- 建车、座位、报名、审核、押金状态接口。
- 补贴合计校验。
- 分享访问和转化埋点。
- 手机号授权换取与联系方式加密存储。
- 订阅消息请求结果记录。

## 2. 服务拆分

MVP先保持单体后端：

```text
api
  -> MySQL
  -> Redis，可选
```

不拆微服务，不引入消息队列。所有核心业务先在一个 Node.js API 服务里完成，后续如果出现高频分享访问、订阅消息推送、海报生成等独立压力，再拆后台 worker。

## 3. 推荐工程结构

```text
apps/
  miniprogram/
  api/
    src/
      modules/
        auth/
        sessions/
        seats/
        signups/
        shares/
        subscriptions/
      db/
      config/
      server.ts
    migrations/
    Dockerfile
    package.json
docker-compose.yml
docs/
```

如果前期团队很小，也可以把 `apps/api` 简化为 `server`，但 Docker、环境变量、迁移和健康检查仍然要保留。

## 4. MySQL设计原则

MySQL作为唯一事实来源：

- 所有车、座位、报名、押金状态、分享转化都落 MySQL。
- 补贴配平校验必须在后端完成，不能只依赖前端。
- 关键写入要使用事务，尤其是审核报名和锁座。
- 金额字段使用整数分或整数元，不使用浮点数。
- 时间字段统一保存为带时区语义的时间，接口返回时按小程序展示需要格式化。

关键事务：

```text
审核报名通过
  -> 检查 seat 仍可确认
  -> 更新 signup.status = approved
  -> 更新 seat.status = confirmed
  -> 写入押金状态
  -> 提交事务
```

## 5. Redis使用边界

Redis是可选增强，不作为MVP核心数据源。

推荐用途：

- 短期业务 token 或登录态缓存。
- 微信接口 access_token 缓存。
- 分享页访问计数的短期聚合。
- 接口限流，例如登录、手机号授权、提交报名。
- 防重复提交的短期锁。

不推荐用途：

- 不把车、座位、报名作为只存在 Redis 的数据。
- 不把押金状态只存在 Redis。
- 不依赖 Redis 完成补贴配平。

如果第一版资源紧张，可以先不启用 Redis，但代码结构要允许以后通过环境变量打开。

## 6. Docker部署

API镜像需要包含：

```text
Node.js runtime
生产依赖
编译后的服务代码
健康检查入口
数据库迁移命令
```

本地开发建议用 `docker-compose.yml` 启动依赖：

```text
api
mysql
redis
```

生产部署建议至少包含：

```text
api container
mysql managed service 或 mysql container
redis managed service 或 redis container，可选
反向代理/HTTPS
日志采集
数据库备份
```

小程序正式环境必须访问HTTPS域名，且域名需要配置到微信小程序后台的合法服务器域名。

## 7. 环境变量

```text
NODE_ENV
PORT
APP_BASE_URL

MYSQL_HOST
MYSQL_PORT
MYSQL_DATABASE
MYSQL_USER
MYSQL_PASSWORD

REDIS_URL
REDIS_ENABLED

WECHAT_APP_ID
WECHAT_APP_SECRET

SESSION_SECRET
CONTACT_ENCRYPTION_KEY
```

要求：

- `WECHAT_APP_SECRET`、`SESSION_SECRET`、`CONTACT_ENCRYPTION_KEY` 不进代码仓库。
- 测试环境和生产环境使用不同数据库、不同密钥。
- 生产环境启动前必须检查关键环境变量是否存在。

## 8. 健康检查与发布验收

API至少提供：

```text
GET /health
GET /health/db
```

验收标准：

- Docker镜像可构建。
- 容器启动后 `/health` 返回成功。
- `/health/db` 能验证 MySQL 连接。
- Redis关闭时，核心链路仍能运行。
- 数据库迁移可在容器环境执行。
- 小程序体验版能通过HTTPS访问API。

