# D9 Tasks: 发布MVP执行清单

更新日期：2026-06-13

- [x] D9.0 补强发布 spec 为 Docker Compose 单服务器生产发布规格。
  - 已补充：requirements、design、tasks、release-checklist、handoff、review-materials 和 release-inputs。

- [x] D9.1 建立 D9 spec 目录和基础发布材料。
  - 已有文件：`requirements.md`、`design.md`、`tasks.md`、`release-checklist.md`、`handoff.md`、`review-materials.md`。
  - 已有模板：`.env.production.example`、`docker-compose.prod.example.yml`。
  - 已有脚本：`npm run d9:release-check`。

- [ ] D9.2 收集发布输入信息。
  - 进行中：已登录 Portainer，正在确认 Docker 环境和部署入口；生产 API 域名修正为 `https://api.pinche.jubenmi.com`。
  - [x] 填写生产 HTTPS API 域名：`https://api.pinche.jubenmi.com`。
  - [ ] 确认服务器公网 IP、登录方式和部署目录。
  - [ ] 确认服务器可运行 Docker Compose。
  - [ ] 准备微信 AppSecret。
  - [ ] 准备生产 MySQL root 密码和应用用户密码。
  - [ ] 准备 `SESSION_SECRET`。
  - [ ] 准备 `CONTACT_ENCRYPTION_KEY`。
  - [ ] 准备首批管理员 OpenID。
  - [ ] 确认微信小程序后台可登录。
  - [ ] 确认微信开发者工具可登录目标小程序。

- [ ] D9.3 冻结发布候选版本并重新执行本地验证。
  - [ ] 运行 `git status --short`，确认发布候选范围。
  - [ ] 运行 `npm run check`。
  - [ ] 运行 `npm run build:mp-weixin`。
  - [ ] 运行 `docker compose build api`。
  - [ ] 记录本地验证结果。

- [x] D9.4 配置 CI 并发布 Docker 镜像。
  - [x] 配置 GitHub Secrets：`TENCENT_REGISTRY_USER`。
  - [x] 配置 GitHub Secrets：`TENCENT_REGISTRY_PASSWORD`。
  - [x] 确认 GitHub Actions 使用上述凭据可登录 `hkccr.ccs.tencentyun.com`。
  - [x] `main` 分支发布 `hkccr.ccs.tencentyun.com/murder/pinche:main`。
  - [x] `develop` 分支发布 `hkccr.ccs.tencentyun.com/murder/pinche:develop`。
  - [x] `publish` 分支发布 `hkccr.ccs.tencentyun.com/murder/pinche:publish`。
  - [x] `publish` 分支额外发布 `hkccr.ccs.tencentyun.com/murder/pinche:latest`。

- [ ] D9.5 准备服务器 Docker Compose 生产配置。
  - 进行中：已将 Portainer `pinche` stack 调整为 Traefik `proxy` 外部网络模式；Host 规则已修正为 `api.pinche.jubenmi.com`。
  - [x] 在 Portainer 或服务器 Docker 中配置 `hkccr.ccs.tencentyun.com` 私有镜像仓库登录凭据。
  - [x] DNS 解析生产 API 域名到服务器公网 IP。
    - 当前：Google DNS 与 Cloudflare DNS 均返回 `api.pinche.jubenmi.com -> 175.27.169.6`，与 Portainer/Traefik 当前入口一致。
  - [x] 准备 HTTPS 证书和反向代理。
    - 当前：Traefik labels 已应用，严格 HTTPS 校验已通过。
  - [x] 在服务器创建 `.env.production`，不提交仓库。
    - 通过 Portainer stack environment variables 保存，未写入仓库。
  - [x] 在服务器创建 `docker-compose.prod.yml`，不提交仓库。
    - 通过 Portainer stack web editor 保存，镜像为 `hkccr.ccs.tencentyun.com/murder/pinche:latest`。
  - [x] 运行 `docker compose -f docker-compose.prod.yml config`。
    - 等价校验：`docker-compose.prod.example.yml` 已更新为 Traefik 模式并通过 YAML 解析；Portainer stack file 已应用并重建容器。
  - [x] 确认 MySQL 使用持久化 volume。

- [ ] D9.6 部署后端并执行数据库迁移。
  - [x] 确认 `docker-compose.prod.yml` 使用 `hkccr.ccs.tencentyun.com/murder/pinche:latest`。
  - [x] 运行 `docker compose -f docker-compose.prod.yml up -d mysql redis`。
    - 通过 Portainer stack 部署，`pinche-mysql-1`、`pinche-redis-1` 已创建。
  - [x] 等待 MySQL healthcheck 通过。
  - [ ] 运行 `docker compose -f docker-compose.prod.yml run --rm migrate`。
    - 如果 Portainer 当前 stack 还没有 `migrate` 服务，先临时运行兼容命令：`docker compose -f docker-compose.prod.yml run --rm api npm run migrate`。
    - 阻塞登录根因：2026-06-13 体验版测试时，生产 `/health` 与 `/health/db` 均通过，但 `/api/stores`、`/api/scripts` 返回 `Table 'pinche.stores/scripts' doesn't exist`，说明生产库尚未执行迁移。
    - 已补强：`docker-compose.prod.example.yml` 新增 `migrate` 一次性服务；`RELEASE_API_BASE_URL=https://api.pinche.jubenmi.com npm run d9:release-check` 会在业务表缺失时失败。
  - [x] 运行 `docker compose -f docker-compose.prod.yml up -d api`。
    - 通过 Portainer stack 部署，`pinche-api-1` 已创建并运行。
  - [ ] 检查 `curl -sS http://127.0.0.1:3018/health`。
    - Traefik 模式下 API 不再发布 host port；改用 Traefik route 检查。
  - [x] 检查 `curl -sS <生产HTTPS API域名>/health`。
    - 通过：`curl --resolve api.pinche.jubenmi.com:443:175.27.169.6 https://api.pinche.jubenmi.com/health` 返回 OK。
  - [x] 检查 `curl -sS <生产HTTPS API域名>/health/db`。
    - 通过：`curl --resolve api.pinche.jubenmi.com:443:175.27.169.6 https://api.pinche.jubenmi.com/health/db` 返回 OK。
  - [ ] 检查 `curl -sS <生产HTTPS API域名>/api/stores` 和 `/api/scripts`。
    - 当前失败：两者均返回业务表不存在；迁移完成后必须返回 `ok: true`。

- [ ] D9.7 配置微信小程序后台。
  - [x] 配置 request 合法域名为生产 HTTPS API 域名。
    - 通过微信小程序后台截图确认：`https://api.pinche.jubenmi.com` 已是唯一 request 合法域名。
  - [ ] 配置小程序名称、头像、简介。
  - [ ] 配置真实服务类目。
  - [ ] 配置隐私保护指引。
  - [ ] 配置体验成员。
  - [ ] 确认审核说明和主链路体验路径。

- [ ] D9.8 构建小程序生产包。
  - [x] 运行 `VITE_API_BASE_URL=<生产HTTPS API域名> npm run build:mp-weixin`。
    - 通过：`VITE_API_BASE_URL=https://api.pinche.jubenmi.com npm run build:mp-weixin` 退出码 0，生成 mp-weixin 构建产物。
  - [x] 运行 `RELEASE_API_BASE_URL=<生产HTTPS API域名> npm run d9:release-check`。
    - 通过：`RELEASE_API_BASE_URL=https://api.pinche.jubenmi.com npm run d9:release-check` 退出码 0。
    - 注意：该通过记录来自新增线上业务表检查之前；当前新检查会在生产库未迁移时失败，需完成 D9.6 后重新执行。
  - [x] 确认输出包含 `uploadReady: true`。
    - 输出包含：`"uploadReady": true`，`"placeholderDomain": false`。
  - [x] 确认上传目录为 `apps/miniprogram/dist/build/mp-weixin`。

- [ ] D9.9 微信开发者工具上传体验版。
  - 进行中：代码已上传成功，等待保存体验版二维码或截图。
  - [x] 暂停，请用户登录或确认微信开发者工具。
    - 用户已确认上传；CLI 服务端口仍提示关闭，实际通过微信开发者工具 UI 上传。
  - [x] 打开 `apps/miniprogram/dist/build/mp-weixin`。
  - [x] 上传版本，版本号建议与仓库版本一致。
    - 通过：微信开发者工具显示“代码上传成功”。线上版本显示 `1.1.8`，工具预填并实际上传版本号为 `2.1.8`。
  - [x] 在小程序后台设置为体验版。
    - 通过：上传前工具提示上次提交已设为体验版，本次上传会覆盖体验版；确认后上传成功。
  - [ ] 保存体验版二维码或截图。

- [ ] D9.10 体验版真机测试。
  - [ ] iOS 微信打开体验版。
  - [ ] Android 微信打开体验版。
  - [ ] 测试微信登录。
    - 当前阻塞：生产数据库未迁移，登录写入/读取用户表前后的业务接口不可用；先执行 D9.6 迁移并重新检查 `/api/stores`、`/api/scripts`。
  - [ ] 测试管理员资料录入或查看。
  - [ ] 测试建车、发布、分享。
  - [ ] 测试玩家报名。
  - [ ] 测试车头审核和锁座。
  - [ ] 确认真机没有请求本地 API 地址。

- [ ] D9.11 提交微信审核。
  - [ ] 暂停，请用户确认审核材料。
  - [ ] 填写审核说明。
  - [ ] 上传主链路截图或录屏。
  - [ ] 提交审核。
  - [ ] 记录审核提交时间。

- [ ] D9.12 审核反馈处理和线上发布。
  - [ ] 如审核拒绝，记录拒绝原因、页面路径和截图。
  - [ ] 如需修改代码或材料，回到对应任务重新构建和上传。
  - [ ] 审核通过后暂停，请用户确认发布线上版。
  - [ ] 发布线上版。
  - [ ] 发布后真机打开线上版并跑主链路烟测。

- [ ] D9.13 发布后交接。
  - [ ] 记录发布版本号和 Git 提交标识。
  - [ ] 记录生产 API 域名。
  - [ ] 记录 `/health` 和 `/health/db` 结果。
  - [ ] 确认数据库备份方式。
  - [ ] 确认可查看 API 日志和容器状态。
  - [ ] 记录回滚方式。

## Verification

既有历史记录：

- `npm run check`：2026-06-12 记录为通过。
- `npm run build:mp-weixin`：2026-06-12 记录为通过。
- `docker compose build api`：2026-06-12 记录为通过。
- `docker compose up -d api`：2026-06-12 记录为通过。
- `RELEASE_API_BASE_URL=<占位HTTPS API域名> npm run d9:release-check`：2026-06-12 记录为基础检查通过；占位域名输出 `uploadReady: false`。

正式发布前必须按 D9.3 和 D9.7 使用真实生产 API 域名重新执行。

## Handoff

当前 spec 已补强为 Docker Compose 单服务器发布规格。继续执行 D9.2 时，需要用户提供 `release-inputs.md` 中的实际信息；涉及密钥和密码时，只在执行环境中使用，不写入仓库。
