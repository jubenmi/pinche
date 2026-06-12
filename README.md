# Pinche

情感本拼车微信小程序MVP。当前目标是先把“管理员录入店/本 -> 车头建车分享 -> 玩家申请 -> 车头审核锁座”的最小闭环做出来。

## 当前阶段

- D0：需求冻结，已完成。
- D1：技术初始化，已完成。
- D2：身份权限与数据模型，已完成。
- D3：管理员资料录入，已完成。
- D4：车头建车流程，已完成。
- D5：分享报名流程，已完成。
- D6：车头管理流程，已完成。

## 工程结构

```text
apps/
  miniprogram/        UniApp微信小程序源码
  api/                Node.js HTTP API
packages/
  shared/             共享常量
specs/                D0-Dn阶段规格
docs/                 产品、合规、架构文档
scripts/              本地检查和烟测脚本
docker-compose.yml    本地API/MySQL/Redis编排
```

## 环境要求

- Node.js 20+
- npm 11+
- Docker Desktop
- 微信开发者工具

## 快速启动

```bash
npm install
docker compose up -d mysql redis
MYSQL_PORT=3307 npm run migrate
npm run start:api
```

API默认端口：

```text
http://localhost:3018
```

本地服务端口：

- API：`3018`
- MySQL：`3307`
- Redis：`6380`

## 常用命令

```bash
npm run check
npm run dev:mp-weixin
npm run build:mp-weixin
npm run migrate
npm run start:api
npm run d2:smoke
npm run d3:smoke
npm run d4:smoke
npm run d5:smoke
npm run d6:smoke
npm audit --omit=dev
docker compose config
docker compose build api
docker compose up -d api
```

## 环境变量

复制 `.env.example` 为 `.env` 后按需修改。

关键变量：

```text
MYSQL_HOST
MYSQL_PORT
MYSQL_DATABASE
MYSQL_USER
MYSQL_PASSWORD
WECHAT_MOCK_LOGIN
WECHAT_APP_ID
WECHAT_APP_SECRET
SESSION_SECRET
BOOTSTRAP_ADMIN_OPENIDS
```

开发模式下 `WECHAT_MOCK_LOGIN=true`，`code=dev-admin-openid` 会得到 `system_admin` 角色。

## API健康检查

```bash
curl -sS http://localhost:3018/health
curl -sS http://localhost:3018/health/db
```

## Spec入口

- [D0 Requirements Freeze](./specs/d0-requirements-freeze/README.md)
- [D1 Technical Initialization](./specs/d1-technical-initialization/README.md)
- [D2 Identity and Data Model](./specs/d2-identity-data-model/README.md)
- [D3 Admin Catalog](./specs/d3-admin-catalog/README.md)
- [D4 Session Creation](./specs/d4-session-creation/README.md)
- [D5 Share Signup](./specs/d5-share-signup/README.md)
- [D6 Organizer Management](./specs/d6-organizer-management/README.md)
- [D7 Share Analytics](./specs/d7-share-analytics/README.md)
- [D8 QA Hardening](./specs/d8-qa-hardening/README.md)
- [D9 MVP Release](./specs/d9-mvp-release/README.md)

## 文档入口

- [MVP开发阶段划分](./docs/development-roadmap.md)
- [情感本拼车产品设计](./docs/mini-program-product-design.md)
- [后端架构与部署设计](./docs/backend-architecture.md)
- [微信小程序合规护栏](./docs/wechat-compliance-guardrails.md)

## 小程序开发

前端使用 UniApp。开发时运行：

```bash
npm run dev:mp-weixin
```

UniApp会生成微信小程序产物：

```text
apps/miniprogram/dist/dev/mp-weixin
```

用微信开发者工具打开上面的生成目录，进行预览、真机调试、上传体验版和提交审核。

发布构建：

```bash
npm run build:mp-weixin
```

生产产物目录：

```text
apps/miniprogram/dist/build/mp-weixin
```

是否需要结合微信官方开发者工具：需要。UniApp负责源码和跨端构建，微信开发者工具负责微信侧真实能力验证，包括 `wx.login`、授权、分享、预览、真机调试、上传和审核。

## 安全审计口径

API生产镜像只安装 `apps/api` 的生产依赖。当前生产依赖审计命令：

```bash
npm audit --omit=dev
```

普通 `npm audit` 会包含 UniApp 本地构建链的开发依赖，可能出现 DCloud/构建工具的传递依赖告警；这些不会进入 API Docker 生产镜像。
