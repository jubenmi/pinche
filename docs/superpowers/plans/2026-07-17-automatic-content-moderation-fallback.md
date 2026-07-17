# 自动内容审核能力与降级拦截 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 让图片、视频和文本在腾讯云审核能力可用时先审后发，能力不可用时按系统管理员的兜底设置直发或阻拦。

**Architecture:** API 中的统一内容审核策略服务输出 auto_moderate、publish_directly 或 block_unavailable。所有业务写入入口只消费该决策；设置只决定无能力时的行为，永不关闭已可用的自动审核。

**Tech Stack:** Node.js ESM、MySQL、腾讯云 CI/TMS、Vue 3、UniApp、Node node:test。

---

## 文件地图

- Create: apps/api/migrations/0025_content_moderation_fallback.sql — 平台设置、审核任务、审计和媒体状态。
- Create: apps/api/src/modules/content-moderation/constants.js — 内容类型、策略和状态常量。
- Create: apps/api/src/modules/content-moderation/capability.js — 腾讯云能力检测。
- Create: apps/api/src/modules/content-moderation/policy.js — 统一发布决策。
- Create: apps/api/src/modules/content-moderation/repository.js — 设置、任务和审计持久化。
- Create: apps/api/src/modules/content-moderation/tencent-client.js — 可注入腾讯云客户端。
- Modify: apps/api/src/config/env.js、apps/api/src/server.js、apps/api/src/modules/core/service.js — 配置、API 和业务接入。
- Modify: apps/api/src/modules/album-image/upload-service.js、apps/api/src/modules/album-video/lifecycle.js — 媒体写入状态。
- Create: apps/admin-web/src/components/ContentSecurityWorkspace.vue — 系统管理员设置页。
- Modify: apps/admin-web/src/App.vue、apps/admin-web/src/adminRoute.js、apps/admin-web/src/api.js — 导航、路由和 API。
- Create: apps/api/test/content-moderation-*.test.mjs、apps/admin-web/test/contentSecurityWorkspace.test.mjs、apps/miniprogram/test/contentModerationStatus.test.mjs — 定向测试。
- Create: scripts/d46-content-moderation-check.js — 所有入口和读取门禁的防绕过检查。

### Task 1: 建立能力检测和发布策略

**Files:**
- Create: apps/api/test/content-moderation-policy.test.mjs
- Create: apps/api/src/modules/content-moderation/constants.js
- Create: apps/api/src/modules/content-moderation/capability.js
- Create: apps/api/src/modules/content-moderation/policy.js
- Modify: apps/api/src/config/env.js

- [ ] **Step 1: 写入失败测试**

~~~js
test("available capability always uses automatic moderation", () => {
  assert.equal(resolvePublicationPolicy({ available: true }, defaults, "image"), "auto_moderate");
});
test("unavailable capability preserves legacy publication by default", () => {
  assert.equal(resolvePublicationPolicy({ available: false }, defaults, "image"), "publish_directly");
});
test("unavailable capability blocks when both switches are enabled", () => {
  assert.equal(resolvePublicationPolicy({ available: false }, blockedImage, "image"), "block_unavailable");
});
~~~

- [ ] **Step 2: 运行测试确认 RED**

Run: node --test apps/api/test/content-moderation-policy.test.mjs

Expected: FAIL，因为策略模块不存在。

- [ ] **Step 3: 实现最小策略**

~~~js
export function resolvePublicationPolicy(capability, settings, type) {
  if (capability.available) return "auto_moderate";
  const key = { image: "blockImageWhenUnavailable", video: "blockVideoWhenUnavailable", text: "blockTextWhenUnavailable" }[type];
  return settings.blockWhenUnavailable && settings[key] ? "block_unavailable" : "publish_directly";
}
~~~

能力检测必须校验类型启用标记、凭证、地域、策略 ID、回调地址和健康检查；任一项缺失返回 available: false。

- [ ] **Step 4: GREEN 与提交**

Run: node --test apps/api/test/content-moderation-policy.test.mjs

Expected: PASS。

~~~bash
git add apps/api/src/config/env.js apps/api/src/modules/content-moderation apps/api/test/content-moderation-policy.test.mjs
git commit -m "feat: add moderation publication policy"
~~~

### Task 2: 持久化设置、审核状态和审计

**Files:**
- Create: apps/api/migrations/0025_content_moderation_fallback.sql
- Create: apps/api/src/modules/content-moderation/repository.js
- Create: apps/api/test/content-moderation-settings.test.mjs

- [ ] **Step 1: 写入设置默认值和权限失败测试**

测试默认四个布尔值均为 false；非 system_admin 读取或保存设置返回 403；更新产生含操作者、旧值、新值的审计行。

- [ ] **Step 2: 创建迁移**

~~~sql
CREATE TABLE content_security_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  block_when_unavailable BOOLEAN NOT NULL DEFAULT FALSE,
  block_image_when_unavailable BOOLEAN NOT NULL DEFAULT FALSE,
  block_video_when_unavailable BOOLEAN NOT NULL DEFAULT FALSE,
  block_text_when_unavailable BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by_user_id BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
INSERT INTO content_security_settings (id) VALUES (1);
~~~

同一迁移必须创建审核任务和审计表，为 session_album_photos 增加 moderation_status，并将历史行回填为 approved_legacy。

- [ ] **Step 3: 实现事务仓储**

仓储只暴露 readSettings、updateSettings、appendAuditLog、createJob 与合法状态迁移；设置更新在事务内锁定唯一行。

- [ ] **Step 4: 验证并提交**

Run: node --test apps/api/test/content-moderation-settings.test.mjs && npm run migrate

Expected: PASS。

~~~bash
git add apps/api/migrations/0025_content_moderation_fallback.sql apps/api/src/modules/content-moderation/repository.js apps/api/test/content-moderation-settings.test.mjs
git commit -m "feat: persist content security settings"
~~~

### Task 3: 管理 API 和内容安全页面

**Files:**
- Modify: apps/api/src/server.js
- Modify: apps/admin-web/src/App.vue
- Modify: apps/admin-web/src/adminRoute.js
- Modify: apps/admin-web/src/api.js
- Create: apps/admin-web/src/components/ContentSecurityWorkspace.vue
- Create: apps/admin-web/test/contentSecurityWorkspace.test.mjs

- [ ] **Step 1: 写入 API 与页面失败测试**

测试 GET 与 PUT /api/admin/content-security-settings 的管理员授权、默认保存合同，和后台“内容安全”导航、四个开关、三个能力状态。

- [ ] **Step 2: 实现 API 合同**

~~~json
{
  "settings": { "blockWhenUnavailable": false, "blockImageWhenUnavailable": false, "blockVideoWhenUnavailable": false, "blockTextWhenUnavailable": false },
  "capabilities": { "image": { "available": false, "reason": "not_configured" }, "video": { "available": false, "reason": "not_configured" }, "text": { "available": false, "reason": "not_configured" } }
}
~~~

PUT 只接受四个布尔字段，先执行 requireRole(user, "system_admin")，再事务性保存与审计。

- [ ] **Step 3: 实现页面和路由**

页面展示“无自动审核能力时阻拦内容”总开关，图片、视频、文本子开关和只读能力状态；保存只提交设置值。

- [ ] **Step 4: 验证并提交**

Run: node --test apps/admin-web/test/contentSecurityWorkspace.test.mjs && npm --workspace apps/admin-web run build

Expected: PASS。

~~~bash
git add apps/api/src/server.js apps/admin-web/src apps/admin-web/test/contentSecurityWorkspace.test.mjs
git commit -m "feat: add content security settings workspace"
~~~

### Task 4: 接入所有图片和视频入口与读取门禁

**Files:**
- Modify: apps/api/src/modules/album-image/upload-service.js
- Modify: apps/api/src/modules/album-video/lifecycle.js
- Modify: apps/api/src/modules/core/service.js
- Modify: apps/api/src/server.js
- Create: apps/api/test/content-moderation-media-integration.test.mjs

- [ ] **Step 1: 写入媒体矩阵失败测试**

对头像、相册图片、评价配图与相册视频分别断言：默认无能力仍直发；开关阻拦时返回 CONTENT_MODERATION_UNAVAILABLE 且无公开 URL；能力可用时创建 pending，列表、分享、预览、下载、流和签名 URL 均不可读。

- [ ] **Step 2: 在每个写入边界调用策略**

~~~js
const policy = await moderation.resolvePublicationPolicy("image");
if (policy === "block_unavailable") {
  throw new AppError(503, "CONTENT_MODERATION_UNAVAILABLE", "Content safety service is not ready");
}
const moderationStatus = policy === "auto_moderate" ? "pending" : "approved";
~~~

- [ ] **Step 3: 提交媒体审核和处理回调**

审核任务包含不可变对象 key 与 ETag。Pass 改为 approved；Block、超时和 Error 均保持隐藏并安排对象清理或重试。

- [ ] **Step 4: 验证并提交**

Run: node --test apps/api/test/content-moderation-media-integration.test.mjs && npm --workspace apps/api run test:album-image

Expected: PASS。

~~~bash
git add apps/api/src/modules apps/api/src/server.js apps/api/test/content-moderation-media-integration.test.mjs
git commit -m "feat: gate media by moderation policy"
~~~

### Task 5: 接入文本、客户端提示和回归检查

**Files:**
- Modify: apps/api/src/modules/core/service.js
- Modify: 处理昵称、评价、留言、门店、剧本和车局公开文本的现有 server 路由
- Modify: apps/miniprogram/src/pages/session/album.vue
- Create: apps/api/test/content-moderation-text-integration.test.mjs
- Create: apps/miniprogram/test/contentModerationStatus.test.mjs
- Create: scripts/d46-content-moderation-check.js
- Modify: package.json

- [ ] **Step 1: 写入文本和提示失败测试**

测试能力可用时文本保存隐藏提案并通过后应用；默认无能力时立即应用；阻拦时不改实体。小程序测试断言三条中文状态提示，不包含腾讯云标签或分数。

- [ ] **Step 2: 实现文本策略调用**

auto_moderate 保存版本化提案并提交 TMS；publish_directly 复用原服务；block_unavailable 返回统一 503 错误。

- [ ] **Step 3: 加入防绕过静态检查**

检查必须逐项断言全部图片、视频、文本写入入口使用策略服务，所有媒体读取路径仅接受 approved 或 approved_legacy；加入 npm run check。

- [ ] **Step 4: 全量验证并提交**

Run: node --test apps/api/test/content-moderation-text-integration.test.mjs apps/miniprogram/test/contentModerationStatus.test.mjs && npm run check

Expected: PASS。

~~~bash
git add apps/api apps/miniprogram scripts/d46-content-moderation-check.js package.json
git commit -m "feat: complete moderation fallback coverage"
~~~

### Task 6: 非生产真实腾讯云联调和发布手册

**Files:**
- Create: docs/runbooks/content-moderation-fallback-release.md

- [ ] **Step 1: 写入联调清单**

清单必须覆盖三类能力配置、通过与拒绝样本、默认直发、无能力阻拦、超时隐藏、重复回调、最小 CAM 权限和仅记录任务 ID/结果/耗时。

- [ ] **Step 2: 执行非生产联调**

Run: npm run d46:check && npm run check

Expected: PASS，并完成真实腾讯云三类型的 Pass、Block、超时和重复回调验证。

- [ ] **Step 3: 提交运行手册**

~~~bash
git add docs/runbooks/content-moderation-fallback-release.md
git commit -m "docs: add moderation fallback release runbook"
~~~

## 计划自检

- D46 默认兼容、能力优先、无能力兜底、失败隐藏、权限和读取门禁均由至少一个任务与定向测试覆盖。
- 后续任务使用的策略名、设置字段和错误码均在前序任务中定义。
- 无 TODO、TBD 或依赖未说明的实现步骤。

