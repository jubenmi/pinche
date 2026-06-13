# D9 Release Inputs

更新日期：2026-06-13

本文件用于记录发布执行前需要用户提供或确认的信息。敏感值只在执行时提供，不把明文写入仓库。

## 可记录在仓库的非敏感信息

| 信息 | 状态 | 说明 |
| --- | --- | --- |
| 生产 HTTPS API 域名 | 等待用户提供 | 例如小程序最终访问的 API origin，必须是 HTTPS |
| API 域名 DNS 状态 | 等待用户确认 | 域名应解析到生产服务器 |
| 服务器公网 IP | 等待用户提供 | 用于 DNS 和连通性确认 |
| 服务器部署目录 | 等待用户提供 | 例如后端代码和 compose 文件所在目录 |
| Docker Compose 可用性 | 等待用户确认 | 服务器需可运行 `docker compose version` |
| HTTPS 反向代理方式 | 等待用户确认 | Nginx、Caddy、Traefik、云厂商负载均衡均可 |
| 微信小程序 AppID | 已在仓库配置 | 当前 manifest 使用 `wxe0421039631a9c2a` |
| 微信后台登录状态 | 等待用户确认 | 需要能配置合法域名、隐私、类目、体验成员 |
| 微信开发者工具登录状态 | 等待用户确认 | 需要能上传目标小程序 |
| 体验成员 | 等待用户确认 | 用于体验版真机测试 |
| 服务类目 | 等待用户确认 | 选择与真实服务最匹配的类目 |
| 审核说明 | 草稿已准备 | 见 `review-materials.md` |
| Docker 镜像仓库 | 已确认 | `hkccr.ccs.tencentyun.com/murder/pinche` |
| main 分支镜像 tag | 已确认 | `hkccr.ccs.tencentyun.com/murder/pinche:main` |
| develop 分支镜像 tag | 已确认 | `hkccr.ccs.tencentyun.com/murder/pinche:develop` |
| publish 分支镜像 tag | 已确认 | `hkccr.ccs.tencentyun.com/murder/pinche:publish` 和 `:latest` |

## 执行时提供的敏感信息

| 信息 | 何时需要 | 仓库记录方式 |
| --- | --- | --- |
| 服务器登录凭据 | 远程部署或检查服务器时 | 不记录明文 |
| 微信 AppSecret | 创建 `.env.production` 时 | 不记录明文 |
| MySQL root 密码 | 创建 `docker-compose.prod.yml` 时 | 不记录明文 |
| MySQL 应用用户密码 | 创建 `.env.production` 和 compose 时 | 不记录明文 |
| `SESSION_SECRET` | 创建 `.env.production` 时 | 不记录明文 |
| `CONTACT_ENCRYPTION_KEY` | 创建 `.env.production` 时 | 不记录明文 |
| 首批管理员 OpenID | 创建 `.env.production` 时 | 不记录明文，除非用户明确允许记录 |
| `TCR_USERNAME` | 配置 GitHub Actions secrets 时 | 不记录明文 |
| `TCR_PASSWORD` | 配置 GitHub Actions secrets 时 | 不记录明文 |

## 推荐执行顺序

1. 先提供生产 HTTPS API 域名和服务器信息。
2. 确认服务器已安装 Docker 和 Docker Compose。
3. 确认域名 DNS 能解析到服务器。
4. 准备 HTTPS 反向代理。
5. 执行到创建 `.env.production` 时再提供敏感值。
6. 后端健康检查通过后，再配置微信后台合法域名。
7. 微信后台配置完成后，再构建和上传小程序体验版。

## 当前需要用户先确认

- 生产 HTTPS API 域名。
- 服务器公网 IP。
- 服务器登录方式。
- 服务器部署目录。
- Docker Compose 是否已安装。
- HTTPS 反向代理准备使用哪种方式。
- 微信小程序后台是否可登录。
- 微信开发者工具是否可登录目标小程序。
