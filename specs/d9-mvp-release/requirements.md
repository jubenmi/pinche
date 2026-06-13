# D9 Requirements: 发布MVP

更新日期：2026-06-13

## Requirements

### Requirement 1: 发布候选版本冻结

1. WHEN 进入正式发布 THEN 仓库 SHALL 以当前发布候选版本为准，不混入无关改动。
2. WHEN 发布候选版本冻结 THEN `npm run check` SHALL 通过。
3. WHEN 发布候选版本冻结 THEN `npm run build:mp-weixin` SHALL 可生成 `apps/miniprogram/dist/build/mp-weixin`。
4. WHEN 发布候选版本冻结 THEN `docker compose build api` SHALL 可构建 API 镜像。
5. WHEN 使用真实生产 API 域名构建小程序 THEN `npm run d9:release-check` SHALL 输出 `uploadReady: true`。

### Requirement 2: Docker Compose 生产环境

1. WHEN 部署后端 THEN 生产环境 SHALL 使用单台服务器 Docker Compose 运行 `api`、`mysql`、`redis`。
2. WHEN 创建生产配置 THEN `.env.production` SHALL 只存在于服务器，不提交到代码仓库。
3. WHEN 创建生产配置 THEN `WECHAT_MOCK_LOGIN` SHALL 为 `false`。
4. WHEN 创建生产配置 THEN MySQL root 密码、MySQL 用户密码、微信 AppSecret、`SESSION_SECRET`、`CONTACT_ENCRYPTION_KEY` SHALL 使用生产值。
5. WHEN 启动生产服务 THEN MySQL SHALL 使用持久化 Docker volume。
6. WHEN 启动生产服务 THEN API、MySQL、Redis SHALL 设置自动重启策略。
7. WHEN 发布前 THEN 生产 MySQL 迁移 SHALL 已执行。
8. WHEN 迁移完成 THEN `/health` 和 `/health/db` SHALL 在线上 HTTPS 域名返回成功。

### Requirement 3: 域名与微信后台配置

1. WHEN 发布小程序 THEN API SHALL 使用 HTTPS 域名，不使用 IP、HTTP 或本地地址。
2. WHEN 发布小程序 THEN HTTPS API 域名 SHALL 配置到小程序后台 request 合法域名。
3. WHEN 提审前 THEN 小程序后台 SHALL 配置名称、头像、简介、服务类目、隐私保护指引和体验成员。
4. WHEN 提审前 THEN 隐私保护指引 SHALL 覆盖微信登录标识、联系方式、报名备注和分享来源参数。
5. WHEN 提审前 THEN 产品说明 SHALL 避免红包、返现、抽奖、陪伴服务、诱导分享和平台代收押金表述。

### Requirement 4: 小程序生产构建与上传

1. WHEN 构建生产小程序 THEN SHALL 使用真实 HTTPS API 域名注入 `VITE_API_BASE_URL`。
2. WHEN 上传前 THEN 构建产物 SHALL 不包含 `127.0.0.1`、`localhost` 或示例 API 域名。
3. WHEN 上传代码 THEN SHALL 使用微信开发者工具打开 `apps/miniprogram/dist/build/mp-weixin`。
4. WHEN 需要上传代码 THEN SHALL 暂停并请用户协助微信开发者工具登录或确认上传。
5. WHEN 上传成功 THEN SHALL 设置体验版并生成体验二维码。

### Requirement 5: 体验测试与提审

1. WHEN 体验版生成 THEN iOS 微信和 Android 微信 SHALL 至少各跑一次主链路。
2. WHEN 体验版测试 THEN 主链路 SHALL 覆盖登录、管理员录入或查看资料、建车、发布、分享、报名、审核、锁座。
3. WHEN 体验版通过 THEN SHALL 准备审核说明、截图或录屏、体验路径。
4. WHEN 提交审核 THEN SHALL 暂停并请用户在小程序后台确认提交。
5. WHEN 审核通过 THEN SHALL 暂停并请用户确认发布线上版。

### Requirement 6: 发布证据、备份与回滚

1. WHEN D9完成 THEN SHALL 有发布版本号、Git 提交标识、生产 API 域名、健康检查结果、体验版二维码或发布截图、审核结果记录。
2. WHEN 公开发布前 THEN SHALL 确认生产数据库有备份方式。
3. WHEN 公开发布前 THEN SHALL 确认可查看 API 容器日志和容器状态。
4. WHEN 公开发布前 THEN SHALL 定义回滚路径，包括小程序版本回退和 API 镜像或部署目录回退。

### Requirement 7: 用户填写与敏感信息

1. WHEN 需要真实域名、服务器、账号或密钥 THEN SHALL 在执行到对应步骤时向用户索取。
2. WHEN 用户提供敏感信息 THEN SHALL 只用于服务器或微信后台配置，不写入仓库文档。
3. WHEN spec 需要记录信息 THEN SHALL 只记录非敏感值或记录“由用户在执行时提供”。
