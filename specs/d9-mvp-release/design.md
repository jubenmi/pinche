# D9 Design: 发布MVP设计

更新日期：2026-06-13

## Scope

D9覆盖从发布候选版本冻结到小程序线上版发布完成的完整流程：

- 后端生产部署。
- 数据库迁移。
- HTTPS API 健康检查。
- 小程序生产构建。
- 微信开发者工具上传。
- 体验版测试。
- 提交审核。
- 审核通过后发布。
- 发布证据、备份和回滚交接。

不在D9范围内：

- 改造业务功能。
- 引入云数据库或多机部署。
- 自动化微信后台操作。
- 将真实密钥、密码、OpenID 写入仓库。

## Production Architecture

```text
用户微信
  -> 微信小程序
  -> HTTPS API域名
  -> 反向代理/证书
  -> Docker Compose api:3018
  -> Docker Compose mysql:3306
  -> Docker Compose redis:6379
```

生产环境使用单台可运行 Docker Compose 的服务器。`api`、`mysql`、`redis` 由 `docker-compose.prod.yml` 编排；MySQL 使用持久化 volume；API、MySQL、Redis 使用 `restart: unless-stopped` 或等价自动重启策略。

HTTPS 由服务器上的反向代理或同机反向代理容器提供。反向代理把生产 API 域名转发到 `127.0.0.1:3018` 或 Docker 网络内的 `api:3018`。微信小程序只访问 HTTPS 域名，不直接访问服务器 IP 或 HTTP 地址。

## Config And Secrets

生产配置来源：

```text
.env.production.example
  -> 服务器上的 .env.production
docker-compose.prod.example.yml
  -> 服务器上的 docker-compose.prod.yml
```

`.env.production` 和真实 `docker-compose.prod.yml` 可以放在服务器部署目录，但不能提交到仓库。需要用户提供的真实值记录在 `release-inputs.md`，敏感值只记录“执行时提供”，不把明文写进文档。

关键生产配置：

```text
NODE_ENV=production
APP_BASE_URL=<生产HTTPS API域名>
WECHAT_MOCK_LOGIN=false
WECHAT_APP_ID=<小程序AppID>
WECHAT_APP_SECRET=<执行时由用户提供>
SESSION_SECRET=<执行时由用户提供>
CONTACT_ENCRYPTION_KEY=<执行时由用户提供>
BOOTSTRAP_ADMIN_OPENIDS=<执行时由用户提供>
```

## Release Flow

```text
冻结发布候选版本
  -> 准备服务器、域名、HTTPS
  -> 创建 .env.production 和 docker-compose.prod.yml
  -> docker compose build api
  -> docker compose up -d mysql redis
  -> docker compose run --rm api npm run migrate
  -> docker compose up -d api
  -> 检查 /health 和 /health/db
  -> 微信后台配置 request 合法域名、隐私、类目、体验成员
  -> VITE_API_BASE_URL=<生产HTTPS API域名> npm run build:mp-weixin
  -> RELEASE_API_BASE_URL=<生产HTTPS API域名> npm run d9:release-check
  -> 微信开发者工具上传 dist/build/mp-weixin
  -> 设置体验版
  -> iOS/Android 真机主链路测试
  -> 提交审核
  -> 审核通过后发布
  -> 记录发布证据、备份和回滚信息
```

## Mini Program Build

小程序生产包必须注入 HTTPS API 域名：

```bash
VITE_API_BASE_URL=<生产HTTPS API域名> npm run build:mp-weixin
RELEASE_API_BASE_URL=<生产HTTPS API域名> npm run d9:release-check
```

上传目录固定为：

```text
apps/miniprogram/dist/build/mp-weixin
```

上传前检查点：

- `d9:release-check` 输出 `uploadReady: true`。
- 产物不包含 `127.0.0.1`、`localhost` 或示例域名。
- 微信后台已配置相同的 request 合法域名。

## WeChat Console Work

需要用户登录或确认的微信后台事项：

- 配置 request 合法域名。
- 配置小程序名称、头像、简介、服务类目。
- 配置隐私保护指引。
- 配置体验成员。
- 微信开发者工具上传代码。
- 设置体验版。
- 提交审核。
- 审核通过后发布。

审核说明使用 `review-materials.md`，必须明确产品是剧本杀发车与座位申请工具，不提供红包、返现、抽奖、平台支付、平台代收押金或分享奖励。

## Verification

本地发布候选版本验证：

```bash
npm run check
npm run build:mp-weixin
docker compose build api
```

线上后端验证：

```bash
curl -sS <生产HTTPS API域名>/health
curl -sS <生产HTTPS API域名>/health/db
```

小程序上传前验证：

```bash
RELEASE_API_BASE_URL=<生产HTTPS API域名> npm run d9:release-check
```

体验版真机验证：

- iOS 微信跑通登录、浏览、建车、分享、报名、审核、锁座。
- Android 微信跑通同一主链路。
- 真机请求全部指向生产 HTTPS API 域名。

## Human Handoff And Stop Conditions

需要用户协助的点：

- 提供生产 API 域名、服务器信息、微信 AppSecret、生产密码和管理员 OpenID。
- 登录服务器或授权远程执行部署命令。
- 登录微信开发者工具并确认上传。
- 登录小程序后台配置类目、隐私、服务器域名、体验成员。
- 确认提交审核。
- 审核通过后确认发布线上版。

任一条件未满足时暂停：

- 生产 HTTPS API 域名未确定。
- 服务器无法运行 Docker Compose。
- 微信后台未配置合法域名。
- 微信开发者工具无法登录目标小程序。
- 体验版主链路未通过。
- 微信审核反馈需要产品、类目、隐私或合规调整。

## Release Evidence

D9完成时记录：

- 发布版本号。
- Git 提交标识。
- 生产 API 域名。
- `/health` 和 `/health/db` 检查时间与结果。
- 体验版二维码或发布截图。
- 微信审核结果。
- 线上发布确认时间。

## Backup And Rollback

公开发布前至少确认一个数据库备份方式。回滚优先级：

1. 如果小程序体验版或审核前失败，重新构建并上传新版本。
2. 如果线上小程序版本异常，优先在微信后台回退或发布上一个稳定版本。
3. 如果 API 部署异常，回退到上一份服务器部署目录或上一版 API 镜像。
4. 如果数据库迁移已执行，先确认备份和迁移影响，不做破坏性回滚。
