# D45 Hybrid Moderation Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理已写入的腾讯云文本/图片审核代码，使当前代码只保留统一审核基础、API 发布门禁和腾讯云 CI 视频能力，并为后续微信文本/图片实现建立明确配置边界。

**Architecture:** 通用状态机、仓储、媒体字段和读取门禁继续保留；腾讯云适配器拆成只接受 video 的客户端，provider 固定为 `tencent_ci_video`。文本和图片开关改为微信命名但本任务不伪造未实现的微信调用，生产启用时由配置校验明确拒绝，后续 D45.4-D45.7 再接入。

**Tech Stack:** Node.js ESM、Node test runner、MySQL、腾讯云 COS/CI、Kiro 风格 spec 清单。

---

### Task 1: 建立旧方案清理检查并校准配置

**Files:**
- Create: `apps/api/test/content-moderation-hybrid-cleanup.test.mjs`
- Modify: `apps/api/src/config/env.js`
- Modify: `.env.production.example`
- Modify: `scripts/check-api-env.js`
- Modify: `apps/api/src/modules/content-moderation/constants.js`

- [x] **Step 1: 写失败测试**

测试读取配置和源码并断言：provider 为 `wechat_sec_check`/`tencent_ci_video`；不存在 `TENCENT_TMS_BIZ_TYPE`、`TENCENT_CI_IMAGE_BIZ_TYPE`、`imagePolicyId`、`textPolicyId`；保留微信文本/图片开关及腾讯云视频配置。

- [x] **Step 2: 运行测试确认 RED**

Run: `node --test apps/api/test/content-moderation-hybrid-cleanup.test.mjs`

Expected: FAIL，指出旧腾讯云文本或图片配置仍存在。

- [x] **Step 3: 最小化修改配置**

将配置拆为 `wechatTextEnabled`、`wechatImageEnabled`、`tencentVideoEnabled`，保留腾讯云视频 region/policy/callback/token 与 COS 凭证；删除腾讯云文本和图片策略。生产环境在微信客户端尚未实现时保持相应开关默认关闭。

- [x] **Step 4: 运行定向测试与环境检查确认 GREEN**

Run: `node --test apps/api/test/content-moderation-hybrid-cleanup.test.mjs && node scripts/check-api-env.js`

Expected: PASS。

### Task 2: 将腾讯云客户端和服务收窄为视频

**Files:**
- Rename: `apps/api/src/modules/content-moderation/tencent-client.js` → `apps/api/src/modules/content-moderation/tencent-video-client.js`
- Modify: `apps/api/src/modules/content-moderation/service.js`
- Modify: `apps/api/src/server.js`
- Modify: `apps/api/src/jobs/content-moderation-retry.js`
- Modify: `apps/api/test/content-moderation-config-client.test.mjs`
- Modify: `apps/api/test/content-moderation-service.test.mjs`

- [x] **Step 1: 写/改失败测试**

测试腾讯云客户端只暴露 `submitVideo`，拒绝 text/image kind；视频任务 provider 为 `tencent_ci_video`；服务不再暴露 `createImageJob`、`submitImageJob`、旧腾讯文本实现。

- [x] **Step 2: 运行测试确认 RED**

Run: `node --test apps/api/test/content-moderation-config-client.test.mjs apps/api/test/content-moderation-service.test.mjs`

Expected: FAIL，指出旧方法仍存在。

- [x] **Step 3: 删除旧方法并更新接线**

移除 TC3 TMS 签名和 CI image endpoint；客户端仅构造 `/video/auditing`。服务只创建/提交视频任务；server 与 retry worker 只实例化腾讯云视频客户端。图片 finalize 暂不提交旧腾讯云审核，继续保持 pending 和无 URL，等待 D45.6 微信实现。

- [x] **Step 4: 运行定向测试确认 GREEN**

Run: `node --test apps/api/test/content-moderation-config-client.test.mjs apps/api/test/content-moderation-service.test.mjs apps/api/test/album-image-finalize.test.mjs`

Expected: PASS，且图片不会调用腾讯云。

### Task 3: 清理遗留接入与更新任务状态

**Files:**
- Modify: `apps/api/src/server.js`
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/jobs/content-moderation-retry.js`
- Modify: `docker-compose.prod.example.yml`
- Delete or rewrite: `apps/api/test/content-moderation-text-integration.test.mjs`
- Modify: `specs/d45-hybrid-content-moderation/tasks.md`

- [x] **Step 1: 扩展清理检查**

断言运行时代码不再导入或调用 `moderateText`、`submitImage`、`submitImageJob`、`TENCENT_TMS_BIZ_TYPE`、`TENCENT_CI_IMAGE_BIZ_TYPE`；与地图、镜像仓库等无关腾讯功能不在清理范围。

- [x] **Step 2: 运行检查确认 RED**

Run: `node --test apps/api/test/content-moderation-hybrid-cleanup.test.mjs`

Expected: FAIL，列出剩余旧审核接入。

- [x] **Step 3: 删除旧文本/图片运行时接入**

移除 server 中旧腾讯文本门禁和图片提交接线；retry worker 只处理腾讯云视频，微信任务留给 D45.10 完成后加入。保留已实现的数据库迁移、通用仓储、管理员骨架、视频回调、读取门禁和清理队列。

- [x] **Step 4: 验证语法与回归**

Run: `node --check apps/api/src/server.js && node --check apps/api/src/jobs/content-moderation-retry.js && node --test apps/api/test/content-moderation-*.test.mjs`

Expected: PASS。

- [x] **Step 5: 更新 spec 清单并提交**

仅在上述验证通过后勾选 D45.2 子项和父项，在验证记录写入命令结果；提交消息：`refactor: align moderation foundation with hybrid spec`。
