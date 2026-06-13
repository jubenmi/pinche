# Admin Web Catalog Design

更新日期：2026-06-13

## 背景

当前系统已有小程序端资料管理页和 Node.js API。管理员可以在小程序内维护店家、剧本和新增资料申请；剧本角色位保存在 `scripts.default_seat_template_json` 中，车局创建时再复制成 `session_seats`。

新目标是增加一个可 Docker 部署的 Vue3 Web 管理前端。管理员在浏览器打开后台，通过微信小程序扫码登录，然后在 Web 端增删改查剧本店、剧本，以及剧本里的角色模板。

## 目标

1. 新增 Vue3 管理前端，放在 `apps/admin-web`。
2. 管理前端通过 Docker/Nginx 部署到 Web 端。
3. Web 登录使用微信小程序扫码确认，成功后拿到现有业务 JWT。
4. 管理端支持店家列表、搜索、创建、编辑和数据库硬删除。
5. 管理端支持剧本列表、搜索、创建、编辑和数据库硬删除。
6. 管理端支持剧本角色模板的查看、创建、编辑和删除。
7. 删除店家或剧本使用物理删除；如果已有历史车局引用，删除被阻止并返回清晰错误。
8. 复用现有 `system_admin` 权限模型，普通用户不能登录或调用管理接口。

## 非目标

- 不重做小程序现有建车、分享、报名、聊天流程。
- 不把历史车局、报名、座位记录一起级联删除。
- 不新增独立角色表；第一版继续使用 `scripts.default_seat_template_json` 作为剧本角色模板来源。
- 不接入微信开放平台 PC 扫码 OAuth；本项目使用“小程序扫描 Web 二维码并确认”的登录方式。
- 不做复杂组织、多租户、细粒度 RBAC 或审计后台。

## 已确认决策

- 删除是数据库硬删除，不是 `status=inactive` 软删除。
- 硬删除不级联历史车局。若 `sessions.store_id` 或 `sessions.script_id` 已引用该记录，API 返回 `409 CONFLICT`，提示无法删除已被车局使用的资料。
- 剧本角色不新增独立表。角色 CRUD 操作更新 `default_seat_template_json` 数组；删除角色表示该角色对象从 JSON 数组中移除。
- Web 登录二维码由后台登录票据驱动，小程序扫码确认后，浏览器轮询获得管理员 token。

## 方案比较

### 方案 A：只做 Web 前端，复用现有 API

优点是改动少，店家和剧本创建编辑可以很快接通。缺点是没有 Web 扫码登录、没有硬删除 API，角色仍需要编辑 JSON，不满足当前目标。

### 方案 B：Web 前端加少量后端接口

新增扫码登录票据接口、店家/剧本 DELETE 接口，并在 Web 前端实现可视化角色编辑器。角色继续落在 `default_seat_template_json`，兼容现有小程序建车流程。

这是推荐方案。它满足目标，又避免引入角色表带来的迁移、兼容和同步成本。

### 方案 C：重构资料模型，新增 `script_roles` 表

角色会成为一等实体，后续扩展更强。代价是需要迁移历史 JSON 数据、重写小程序角色解析和建车模板逻辑，范围明显超过当前目标。

## 推荐方案

采用方案 B。

系统新增一个独立的 `apps/admin-web` Vue3 应用。它通过相对路径 `/api` 调用后端，生产镜像使用 Nginx 托管静态文件并反代 API。后端新增 Web 登录票据表和管理 DELETE 路由；小程序新增扫码确认入口。

## 后端设计

### 数据库

新增 migration：`apps/api/migrations/0007_admin_web_login.sql`。

创建 `admin_web_login_tickets`：

```sql
CREATE TABLE IF NOT EXISTS admin_web_login_tickets (
  id CHAR(36) NOT NULL PRIMARY KEY,
  secret_hash CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  approved_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  approved_at DATETIME NULL,
  consumed_at DATETIME NULL,
  user_agent VARCHAR(255) NULL,
  INDEX idx_admin_web_login_status_expires (status, expires_at),
  CONSTRAINT fk_admin_web_login_approved_by
    FOREIGN KEY (approved_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

票据 secret 只存 SHA-256 hash。二维码中包含 `id` 和一次性 `secret`。票据默认 5 分钟过期。

### 登录接口

新增路由：

| Method | Path | 权限 | 行为 |
| --- | --- | --- | --- |
| `POST` | `/api/admin/web-login/tickets` | public | 创建待确认登录票据 |
| `GET` | `/api/admin/web-login/tickets/:id?secret=` | public | Web 轮询票据状态 |
| `POST` | `/api/admin/web-login/tickets/:id/approve` | `system_admin` | 小程序扫码后确认登录 |

创建票据返回：

```json
{
  "ticketId": "...",
  "ticketSecret": "...",
  "qrText": "pinche-admin-login://ticket/<id>?secret=<secret>",
  "expiresAt": "2026-06-13T12:00:00.000Z"
}
```

Web 轮询规则：

- `pending`：返回 `status: "pending"`。
- `approved`：验证 secret 后返回 `status: "approved"`、`token`、`user`、`roles`，并把票据标记为 `consumed`。
- `consumed`：返回 `status: "consumed"`，Web 端提示重新扫码。
- 过期：返回 `status: "expired"`。

小程序确认规则：

1. 小程序端用户先走现有微信登录，拿到业务 token。
2. 扫描二维码，解析 `ticketId` 和 `ticketSecret`。
3. 调用 approve 接口。
4. 后端校验当前用户包含 `system_admin`。
5. 票据存在、未过期且仍为 `pending` 时，写入 `approved_by_user_id` 和 `approved_at`。

### 硬删除接口

新增路由：

| Method | Path | 权限 | 行为 |
| --- | --- | --- | --- |
| `DELETE` | `/api/admin/stores/:id` | `system_admin` | 数据库硬删除店家 |
| `DELETE` | `/api/admin/scripts/:id` | `system_admin` | 数据库硬删除剧本 |

删除前检查引用：

- 店家：`SELECT COUNT(*) FROM sessions WHERE store_id = ?`
- 剧本：`SELECT COUNT(*) FROM sessions WHERE script_id = ?`

如果引用数大于 0，返回：

```json
{
  "ok": false,
  "error": {
    "code": "RESOURCE_IN_USE",
    "message": "Store is used by existing sessions",
    "details": { "sessionCount": 3 }
  }
}
```

如果没有引用，执行真正的 `DELETE FROM stores WHERE id = ?` 或 `DELETE FROM scripts WHERE id = ?`。不存在的记录返回 `404`。

### 角色模板接口策略

第一版不新增角色 API。Web 管理端在编辑剧本时读取 `default_seat_template_json`，在本地用表格/抽屉维护角色数组，保存剧本时通过现有 `PATCH /api/admin/scripts/:id` 提交完整 `defaultSeatTemplate`。

角色字段：

```json
{
  "id": "client-generated-id",
  "name": "F4-1",
  "seatType": "f4",
  "roleName": "玩家CP",
  "roleGender": "male",
  "basePrice": 58000,
  "adjustment": -5000
}
```

`id` 仅用于 Web 编辑器稳定排序和定位。小程序端忽略该字段不影响建车。

## 小程序设计

在现有管理员入口附近增加“扫码登录 Web 后台”能力。

最小改动：

- 在 `apps/miniprogram/src/pages/admin/catalog.vue` 顶部增加按钮。
- 按钮调用 `uni.scanCode()`。
- 只接受 `pinche-admin-login://ticket/` 开头的二维码内容。
- 扫码后展示确认弹窗：`确认登录 Web 管理后台？`
- 用户确认后调用 `/api/admin/web-login/tickets/:id/approve`。
- 普通用户或非管理员进入该页时仍展示无权限。

后续也可以在“我的”页新增独立入口，但第一版不强制。

## Web 前端设计

### 技术栈

- Vue3
- Vite
- 原生 CSS 或轻量组件化 CSS
- `qrcode` 生成登录二维码
- 浏览器 `localStorage` 保存 token

不引入大型后台模板，保持依赖简单。

### 信息架构

登录前：

- 登录页居中显示二维码。
- 展示过期倒计时、刷新二维码按钮、扫码状态。
- 状态包括：等待扫码、已确认正在登录、已过期、无权限/失败。

登录后：

- 左侧导航：`店家`、`剧本`。
- 顶部栏：当前管理员、刷新、退出登录。
- 主工作区：列表、筛选、表单抽屉。

### 店家管理

字段：

- 名称
- 城市
- 区域
- 地址
- 联系备注
- 状态

能力：

- 搜索：关键词、状态。
- 创建：抽屉表单。
- 编辑：抽屉表单。
- 删除：危险操作二次确认，调用 DELETE。
- 删除失败：展示已被车局引用的提示。

### 剧本管理

字段：

- 名称
- 类型标签
- 人数
- 无剧透简介
- 状态
- 默认角色模板

能力：

- 搜索：关键词、状态。
- 创建：抽屉表单。
- 编辑：抽屉表单。
- 删除：危险操作二次确认，调用 DELETE。
- 删除失败：展示已被车局引用的提示。

### 角色模板编辑

在剧本编辑抽屉内使用角色表格：

- 角色名
- 座位类型
- 角色定位
- 性别：男位、女位、不限
- 基础价
- 价格调整

能力：

- 新增角色。
- 编辑单个角色。
- 删除单个角色。
- 拖拽排序可后置；第一版用上移/下移按钮。
- 保存剧本时将角色数组写回 `defaultSeatTemplate`。

校验规则：

- 剧本名称必填。
- 角色名称必填。
- `roleGender` 只允许 `male`、`female`、`unlimited`。
- 价格字段按分保存，Web 可用元展示并转换为分。
- 角色数量建议与 `playerCount` 一致；不一致时给提示但不阻止保存。

### 视觉方向

后台是高频运营工具，不做营销型首页。视觉走安静、密集、可扫描的工作台：

- 浅色背景，低饱和墨色文字。
- 单一行动强调色，使用青绿色或蓝绿色，避免大面积紫蓝渐变。
- 列表表格清晰，危险操作使用红色。
- 抽屉承载新增/编辑，避免页面跳转。
- 登录页可以有轻量品牌氛围，但第一屏仍以二维码和状态为主。

## Docker 设计

新增：

```text
apps/admin-web/Dockerfile
apps/admin-web/nginx.conf
```

镜像构建：

1. Node stage 安装 workspace 依赖并执行 `npm --workspace apps/admin-web run build`。
2. Nginx stage 复制 `dist`。
3. Nginx 服务 SPA，并把 `/api/` 反代到 `http://api:3018/api/`。

生产编排更新 `docker-compose.prod.example.yml`：

- 新增 `admin-web` service。
- 连接 `proxy` 和 `internal` 网络。
- 通过 Traefik 暴露 `admin.pinche.jubenmi.com`。
- 依赖 `api`。

本地开发：

- `npm run dev:admin-web`
- 默认代理到 `http://localhost:3018`。

## 错误处理

- 未登录或 token 过期：Web 清空 token 并回到扫码登录页。
- 非管理员扫码确认：approve 返回 403，Web 继续等待或提示无权限。
- 票据过期：Web 停止轮询，提示刷新二维码。
- 删除被引用资料：Web 展示“已有历史车局使用，不能硬删除”。
- 网络错误：列表保留现有数据并展示顶部错误提示。
- 角色 JSON 解析失败：当作空模板显示，并在保存前要求修复。

## 测试策略

新增脚本：

```text
scripts/d12-admin-web-check.js
```

静态检查覆盖：

- `apps/admin-web` 存在 Vue3/Vite 配置。
- Web 登录页包含二维码、轮询和 ticket API 调用。
- 店家和剧本页面调用 GET/POST/PATCH/DELETE 管理接口。
- 剧本编辑器包含角色新增、编辑、删除、性别字段。
- API server 暴露 web-login 和 DELETE 路由。
- Dockerfile、nginx.conf、production compose service 存在。
- 小程序管理员页包含扫码确认入口。

API 烟测扩展：

- 管理员创建店家后 DELETE 成功，随后列表不可见。
- 管理员创建剧本后 DELETE 成功，随后列表不可见。
- 已被 session 引用的店家/剧本 DELETE 返回 409。
- 非管理员不能 approve Web 登录票据。
- 管理员 approve 后 Web 轮询拿到 token。

常规验证：

```text
npm run check
npm --workspace apps/admin-web run build
docker compose -f docker-compose.prod.example.yml config
```

## 实施边界

第一版改动集中在：

- `apps/admin-web/**`
- `apps/api/src/server.js`
- `apps/api/src/modules/auth/wechat.js`
- `apps/api/src/modules/auth/users.js` 或新增 admin web login module
- `apps/api/src/modules/core/service.js`
- `apps/api/migrations/0007_admin_web_login.sql`
- `apps/miniprogram/src/pages/admin/catalog.vue`
- `docker-compose.prod.example.yml`
- 根 `package.json`
- `scripts/d12-admin-web-check.js`

现有小程序业务页面已有大量未提交改动。实施时只改扫码登录入口所需的小程序文件，避免触碰会话、分享、角色页等无关改动。
