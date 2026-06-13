# D9 Release Checklist

更新日期：2026-06-13

## 发布前置

| 检查项 | 结果 |
| --- | --- |
| D8完整QA | 既有记录通过，正式发布前重新确认 |
| 生产环境变量样例 | 已准备 `.env.production.example` |
| Docker生产编排样例 | 已准备 `docker-compose.prod.example.yml` |
| 发布检查脚本 | 已准备 `npm run d9:release-check` |
| D9发布输入 | 等待填写 `release-inputs.md` |

## CI镜像发布门禁

| 检查项 | 通过条件 |
| --- | --- |
| GitHub Secrets | 已配置 `TENCENT_REGISTRY_USER` 和 `TENCENT_REGISTRY_PASSWORD` |
| main镜像 | `main` push 后发布 `hkccr.ccs.tencentyun.com/murder/pinche:main` |
| develop镜像 | `develop` push 后发布 `hkccr.ccs.tencentyun.com/murder/pinche:develop` |
| publish镜像 | `publish` push 后发布 `hkccr.ccs.tencentyun.com/murder/pinche:publish` |
| latest镜像 | 仅 `publish` push 后发布 `hkccr.ccs.tencentyun.com/murder/pinche:latest` |
| 检查步骤 | CI 中 `npm run check` 通过后才允许推镜像 |
| Submodule | CI checkout 使用 recursive submodules |

## 私有镜像仓库门禁

| 检查项 | 通过条件 |
| --- | --- |
| GitHub push 凭据 | GitHub Secrets 已保存 `TENCENT_REGISTRY_USER` 和 `TENCENT_REGISTRY_PASSWORD` |
| Portainer pull 凭据 | Portainer Registries 已保存 `hkccr.ccs.tencentyun.com` 登录凭据 |
| 镜像拉取 | Portainer 创建 stack 时可以拉取 `hkccr.ccs.tencentyun.com/murder/pinche:latest` |

## 用户必须提供或确认

- 生产 HTTPS API 域名。
- 服务器公网 IP、登录方式、部署目录。
- 服务器可以运行 Docker Compose。
- 微信 AppSecret。
- 生产 MySQL root 密码和应用用户密码。
- `SESSION_SECRET`。
- `CONTACT_ENCRYPTION_KEY`。
- 首批管理员 OpenID。
- 微信小程序后台登录可用。
- 微信开发者工具登录目标小程序账号可用。

敏感值只在执行时提供，不写入仓库。

## 后端上线门禁

| 检查项 | 通过条件 |
| --- | --- |
| DNS | 生产 API 域名解析到服务器 |
| HTTPS | API 域名可通过 HTTPS 访问 |
| Compose配置 | `docker compose -f docker-compose.prod.yml config` 通过 |
| API镜像 | compose 使用 `hkccr.ccs.tencentyun.com/murder/pinche:latest` |
| MySQL/Redis | `docker compose -f docker-compose.prod.yml up -d mysql redis` 后服务可用 |
| 数据库迁移 | `docker compose -f docker-compose.prod.yml run --rm api npm run migrate` 输出成功 |
| API启动 | `docker compose -f docker-compose.prod.yml up -d api` 后容器运行 |
| 本机健康检查 | `http://127.0.0.1:3018/health` 返回 `ok: true` |
| 线上健康检查 | `<生产HTTPS API域名>/health` 返回 `ok: true` |
| 线上数据库检查 | `<生产HTTPS API域名>/health/db` 返回 `ok: true` |
| 生产登录配置 | `/health` 中 `wechatMockLogin` 为 `false` |

## 微信后台门禁

| 检查项 | 通过条件 |
| --- | --- |
| request合法域名 | 已配置生产 HTTPS API 域名 |
| 小程序信息 | 名称、头像、简介已配置 |
| 服务类目 | 已选择真实匹配类目 |
| 隐私保护指引 | 覆盖登录标识、联系方式、报名备注、分享来源 |
| 体验成员 | 至少包含发布测试人员 |
| 审核说明 | 说明主链路和合规边界 |

## 发布构建命令

```bash
VITE_API_BASE_URL=<生产HTTPS API域名> npm run build:mp-weixin
RELEASE_API_BASE_URL=<生产HTTPS API域名> npm run d9:release-check
```

`d9:release-check` 必须输出：

```json
{
  "ok": true,
  "uploadReady": true,
  "placeholderDomain": false
}
```

## 上传目录

```text
apps/miniprogram/dist/build/mp-weixin
```

微信开发者工具上传前，项目应指向上面的生产构建目录。

## 上传前门禁

- 后端线上 `/health` 和 `/health/db` 通过。
- 微信后台 request 合法域名已配置。
- 生产构建已注入真实 HTTPS API 域名。
- `d9:release-check` 输出 `uploadReady: true`。
- 用户已登录微信开发者工具目标小程序账号。
- 用户确认可以上传体验版。

## 提审前门禁

- 体验版二维码可打开。
- iOS 微信主链路通过。
- Android 微信主链路通过。
- 主链路覆盖登录、建车、分享、报名、审核、锁座。
- 没有本地 API 请求。
- 审核说明、截图或录屏已准备。
- 隐私保护指引与实际收集信息一致。
- 用户确认提交审核。

## 发布前门禁

- 微信审核通过。
- 生产 API 健康检查仍通过。
- 数据库备份方式已确认。
- API 日志查看方式已确认。
- 回滚方式已记录。
- 用户确认发布线上版。
