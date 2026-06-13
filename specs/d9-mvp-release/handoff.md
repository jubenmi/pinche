# D9 Release Handoff

更新日期：2026-06-13

当前 D9 已补强为 Docker Compose 单服务器发布规格。下一步不是直接上传代码，而是先完成生产服务器部署和微信后台配置。

## 当前部署路线

```text
单台服务器 Docker Compose
  -> api
  -> mysql
  -> redis
  -> HTTPS反向代理
  -> 微信小程序生产包
  -> 体验版
  -> 审核
  -> 发布
```

## 下一步需要用户提供

先填写或确认 `release-inputs.md` 中的信息。第一批必须确认：

- 生产 HTTPS API 域名。
- 服务器公网 IP、登录方式、部署目录。
- 服务器 Docker Compose 可用。
- 微信小程序后台可登录。
- 微信开发者工具可登录目标小程序。

执行到部署时再提供：

- 微信 AppSecret。
- 生产 MySQL root 密码和应用用户密码。
- `SESSION_SECRET`。
- `CONTACT_ENCRYPTION_KEY`。
- 首批管理员 OpenID。

敏感值不写入仓库。

## 我可以继续协助

提供生产 API 域名和服务器信息后，可以继续协助：

1. 检查发布候选版本。
2. 生成服务器 `.env.production` 内容。
3. 生成或检查服务器 `docker-compose.prod.yml`。
4. 执行 Docker Compose 部署命令。
5. 执行数据库迁移。
6. 检查线上 `/health` 和 `/health/db`。
7. 构建小程序生产包。
8. 运行发布检查脚本。
9. 指导微信开发者工具上传和微信后台提审。

小程序生产构建命令：

```bash
VITE_API_BASE_URL=<生产API域名> npm run build:mp-weixin
RELEASE_API_BASE_URL=<生产API域名> npm run d9:release-check
```

上传目录：

```text
apps/miniprogram/dist/build/mp-weixin
```

## 必须暂停让用户确认的点

- 需要输入服务器登录凭据或授权远程命令时。
- 需要填写微信 AppSecret、数据库密码、业务密钥、管理员 OpenID 时。
- 需要登录微信开发者工具上传代码时。
- 需要在微信后台设置体验版时。
- 需要提交微信审核时。
- 审核通过后需要发布线上版时。

## 体验版检查

- 体验版二维码可打开。
- 首页可进入“我的”“建车”。
- 管理员资料页可打开。
- 建车、发布、分享、申请、审核、锁座主链路可跑通。
- 体验版中没有 `127.0.0.1` 请求。
- iOS微信和Android微信至少各跑一次主链路。

## 发布后交接

发布完成后记录：

- 发布版本号。
- Git 提交标识。
- 生产 API 域名。
- 线上 `/health` 和 `/health/db` 结果。
- 体验版二维码或线上发布截图。
- 微信审核结果。
- 数据库备份方式。
- API 日志查看方式。
- 回滚方式。
