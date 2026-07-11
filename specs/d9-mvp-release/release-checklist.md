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
| 数据库迁移 | `docker compose -f docker-compose.prod.yml run --rm migrate` 输出成功；若服务器仍是旧 compose，可临时用 `docker compose -f docker-compose.prod.yml run --rm api npm run migrate` |
| API启动 | `docker compose -f docker-compose.prod.yml up -d api` 后容器运行 |
| 本机健康检查 | `http://127.0.0.1:3018/health` 返回 `ok: true` |
| 线上健康检查 | `<生产HTTPS API域名>/health` 返回 `ok: true` |
| 线上数据库检查 | `<生产HTTPS API域名>/health/db` 返回 `ok: true` |
| 线上业务表检查 | `<生产HTTPS API域名>/api/stores` 和 `/api/scripts` 返回 `ok: true` |
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

## 小程序先发布上传门禁

- 微信后台 request 合法域名已配置为生产 HTTPS API 域名。
- 生产构建已注入真实 HTTPS API 域名。
- 小程序维护态已通过 `npm run check` 静态检查。
- `d9:release-check` 输出 `uploadReady: true`。
- 用户已登录微信开发者工具目标小程序账号。
- 上传前必须使用桌面版微信开发者工具打开上传弹窗，读取并记录 `线上版本号`。
- 小程序上传版本号使用 `0.YYYYMMDD.N`：`YYYYMMDD` 为北京时间当天日期，`N` 为当天第几次成功上传，从 `1` 开始。同一天再次上传时只递增 `N`，例如 `0.20260629.1` 后上传 `0.20260629.2`。
- 若线上版本号仍是旧格式，先记录旧线上版本号，再按当天日期从 `0.YYYYMMDD.1` 开始。不得使用 `0.1.0`、包默认版本或未核对线上版本号的临时版本号。
- 用户确认可以上传体验版。

## 后端上线后门禁

- 后端线上 `/health` 返回 `ok: true`。
- 后端线上 `/health/db` 返回 `ok: true`。
- 后端线上 `/api/stores` 和 `/api/scripts` 返回 `ok: true`。
- 生产登录配置 `/health` 中 `wechatMockLogin` 为 `false`。
- iOS 微信主链路通过。
- Android 微信主链路通过。
- 主链路覆盖登录、建车、分享、报名、审核、锁座。

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

## 相册图片直传 COS 门禁

- [ ] 生产 CORS 与 `deploy/cos/cors.production.xml` 一致，无 wildcard origin。
- [ ] 微信 request 合法域名包含 API 和 COS；uploadFile/downloadFile 包含精确 COS origin，无路径和通配符。
- [ ] API、migrate、album-image-cleanup 固定为同一镜像 digest。
- [ ] 数据库迁移完成；backfill dry-run 的 scanned/updated/missing/invalid 已审核，再执行 `--apply`。
- [ ] `npm run d43:unit`、`npm run d43:check` 和隔离 `d43:smoke` 通过。
- [ ] `D43_COS_CONTRACT=1 npm run d43:cos-contract` 在批准的测试 Bucket 通过并确认最终清理。
- [ ] 小程序与管理后台生产构建均包含 v2 uploadId、真实错误展示和五分钟 URL 刷新。
- [ ] 先启用 `COS_DIRECT_MEDIA_URLS` 并观察，再独立启用 `COS_DIRECT_UPLOAD_REQUIRED`。
- [ ] 成员、管理员、公开分享隐私回归通过；原始 object key/ETag 不出现在响应。
- [ ] 图片上传/下载字节不经过 API；头像、评价照片和视频链路保持不变。
- [ ] 观察至少一个完整小程序发布周期后，才允许另开变更移除旧代理路由。
- [ ] 已演练两个开关独立回滚，且 cleanup job/媒体数据库锚点不会丢失。
