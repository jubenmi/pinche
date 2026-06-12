# D9 Release Checklist

更新日期：2026-06-12

## 已完成

| 检查项 | 结果 |
| --- | --- |
| D8完整QA | 通过 |
| API Docker镜像构建 | 通过，`docker compose build api` |
| API容器启动 | 通过，`docker compose up -d api` |
| 本地健康检查 | 通过，`/health` |
| 小程序生产构建 | 通过，`npm run build:mp-weixin` |
| 微信开发者工具开发构建加载 | 通过，`webview page ready` |
| 生产环境变量样例 | 已准备 `.env.production.example` |
| Docker生产编排样例 | 已准备 `docker-compose.prod.example.yml` |
| 发布检查脚本 | 已准备 `npm run d9:release-check` |

## 上传前必须由用户确认

- HTTPS API域名，例如 `https://api.example.com`。
- 生产服务器已部署 API、MySQL、Redis。
- 生产数据库已执行迁移。
- 微信公众平台已配置 request 合法域名。
- 小程序后台已配置隐私保护指引、服务类目、体验成员。
- 微信开发者工具已登录目标小程序管理员或开发者账号。

## 发布构建命令

```bash
VITE_API_BASE_URL=https://api.example.com npm run build:mp-weixin
RELEASE_API_BASE_URL=https://api.example.com npm run d9:release-check
```

把 `https://api.example.com` 替换为真实生产 API 域名。

## 上传目录

```text
apps/miniprogram/dist/build/mp-weixin
```

微信开发者工具上传前，项目应指向上面的生产构建目录。
