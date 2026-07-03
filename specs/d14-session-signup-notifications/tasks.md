# D14 Tasks: 上车审核与订阅通知执行清单

更新日期：2026-07-03

- [x] D14.1 建立 D14 spec 三件套。
- [x] D14.2 新增小程序订阅请求工具，记录车头新申请提醒和玩家审核结果提醒的订阅结果。
- [x] D14.3 修改 `pages/session/share`，已发布车局确认角色时提交 `POST /api/signups`，不再调用 direct claim。
- [x] D14.4 修改发车后补位流程，确保开放座位也只能提交待审核申请。
- [x] D14.5 修改 `pages/session/manage`，增加车头“申请提醒”订阅入口。
- [x] D14.6 新增后端微信订阅消息配置和发送模块，未启用或未配置模板时返回 skipped。
- [x] D14.7 在 `createSignup` 成功后触发车头新申请通知。
- [x] D14.8 在 `approveSignup` 和 `rejectSignup` 成功后触发玩家审核结果通知。
- [x] D14.9 限制普通玩家 direct claim，防止绕过车头审核直接成为已确认成员。
- [x] D14.10 更新 smoke/static 检查，覆盖发车后补位审核、普通玩家 direct claim 被拒绝、通知未配置时跳过。
  - 进展：按 TDD 先编写 D14 检查脚本，再实现功能使其通过。
- [x] D14.11 运行验证并更新本文件 Verification。

## Verification

- 2026-07-03：已创建 `requirements.md`、`design.md`、`tasks.md`，并将 superpowers 设计稿改为中文。
- 2026-07-03：已实现 D14.2-D14.10。
- 2026-07-03：通过 `node --check apps/api/src/modules/core/service.js`、`node --check apps/api/src/modules/wechat/subscribe-message.js`、`node --check apps/miniprogram/src/utils/subscribeMessages.js`、`node --check scripts/d2-smoke-test.js`、`node --check scripts/d6-smoke-test.js`、`node --check scripts/d10-pseudo-chat-smoke.js`。
- 2026-07-03：通过 `npm --workspace apps/api run check`、`node scripts/d14-session-signup-notifications-check.js`、`node scripts/check-api-env.js`、`node scripts/check-api-health.js`、`node scripts/d13-cross-app-identity-check.js`、`node scripts/d18-session-album-privacy-check.js`、`node scripts/check-maintenance-mode.js`、`node scripts/d11-gender-check.js`、`node scripts/d14-profile-check.js`、`node scripts/d15-session-review-records-check.js`、`node scripts/d16-session-membership-downlisting-check.js`、`node scripts/d17-cos-storage-check.js`、`node scripts/d19-npc-role-tags-check.js`、`node scripts/d20-album-first-lifecycle-check.js`。
- 2026-07-03：通过 `WECHAT_SUBSCRIBE_MESSAGE_ENABLED=false node --input-type=module -e "..."`，确认订阅消息关闭时 `notifySignupCreated` 返回 `skipped: true` 且不触发微信接口。
- 2026-07-03：`npm run check` 已执行，前置检查通过后停在 `node scripts/check-miniprogram.js`；原因是 `apps/miniprogram/.env.development` 当前为 `http://127.0.0.1:3018`，而现有检查要求 `https://api.pinche.jubenmi.com`。未覆盖该本地开发配置。
