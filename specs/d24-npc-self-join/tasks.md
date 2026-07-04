# D24 Tasks: NPC 工作人员自选角色上车执行清单

更新日期：2026-07-04

## D24 执行任务

- [x] D24.1 建立 D24 spec 三件套。
  - [x] `requirements.md` 描述 NPC 自选开关、direct/review 分支、审核、相册权限和管理端要求。
  - [x] `design.md` 描述数据模型、后端接口、审核流、小程序分享页、管理端和测试方案。
  - [x] `tasks.md` 描述实现和验收清单。

- [x] D24.2 新增 NPC 自选和 NPC 申请数据模型。
  - [x] 新增安全迁移，给 `sessions` 增加 `npc_join_enabled` 字段，默认开启。
  - [x] 扩展 `signups`，允许 `seat_id` 为空并新增 `session_npc_role_id`、`signup_type`、NPC 角色唯一键和索引。
  - [x] 后端新增 `normalizeNpcJoinEnabled`。
  - [x] `createSession` 写入 `npcJoinEnabled`。
  - [x] `updateSession` 可选更新 `npcJoinEnabled`。
  - [x] `getSession` 返回 `npc_join_enabled`。
  - [x] 添加 D24 静态检查，先验证它能捕获当前缺失行为。
    - 验证：`node scripts/d24-npc-self-join-check.js` 按预期失败，提示 `D24 migration file must exist`。

- [x] D24.3 实现 NPC 角色选择接口。
  - [x] 新增 `claimSessionNpcRole` 服务，要求登录和手机号。
  - [x] 校验 NPC 角色存在、active、所属车局未取消、NPC 自选开启。
  - [x] 校验 NPC 角色未绑定他人，且没有其他用户 pending 申请。
  - [x] `direct` 分支写入 `session_npc_roles.bound_user_id`。
  - [x] `direct` 分支写入或更新 approved NPC signup。
  - [x] `review_required` 分支写入或更新 pending NPC signup。
  - [x] 重复选择自己的已绑定 NPC 角色返回 `npc_joined`。
  - [x] 重复选择自己的 pending NPC 角色返回 `pending_review`。
  - [x] 在 `server.js` 暴露 `POST /api/session-npc-roles/:id/claim`。

- [x] D24.4 扩展报名列表和审核逻辑。
  - [x] `listSessionSignups` 返回 NPC 申请的 `signup_type`、`session_npc_role_id`、`npc_role_name`。
  - [x] `approveSignup` 保持玩家座位审核现有行为。
  - [x] `approveSignup` 对 NPC 申请绑定 `session_npc_roles.bound_user_id`。
  - [x] `approveSignup` 通过 NPC 申请后拒绝同一 NPC 角色其他 pending 申请。
  - [x] `rejectSignup` 对 NPC 申请只更新 signup 状态，不改 NPC 角色绑定。
  - [x] 确认 pending NPC 申请不授予完整相册权限。

- [x] D24.5 扩展相册和我的车局行为验证。
  - [x] 确认已绑定 NPC 用户被 `isSessionAlbumMember` 识别为相册成员。
  - [x] 确认 pending NPC 申请人不能查看完整相册。
  - [x] 确认已绑定 NPC 用户出现在 `listMyAlbumSessions`。
  - [x] 确认 `album/people` 返回 `session-npc:<id>` 和绑定用户 `user_id`。
  - [x] 确认标注 `session-npc:<id>` 的照片继续使用绑定用户隐私。

- [x] D24.6 改造小程序创建设置页。
  - [x] `pages/session/setup.vue` 增加 `允许NPC工作人员自选角色` 开关，默认开启。
  - [x] 关闭说明使用 `关闭后由车头手动安排NPC角色`。
  - [x] 创建车局请求带上 `npcJoinEnabled`。
  - [x] 创建 flow 保存并恢复 `npcJoinEnabled`。
  - [x] 保持玩家上车策略控件现有行为。

- [x] D24.7 改造小程序分享页 NPC 选择。
  - [x] `pages/session/share.vue` 从 `session.session_npc_roles` 生成 NPC 角色卡。
  - [x] NPC 角色卡展示 `可选`、`我选`、`待审`、`已选` 状态。
  - [x] NPC 角色不计入玩家座位人数和玩家角色统计。
  - [x] 选择可选 NPC 角色前要求登录和手机号。
  - [x] 调用 `POST /api/session-npc-roles/:id/claim`。
  - [x] `npc_joined` 结果刷新车局；相册入口进入相册。
  - [x] `pending_review` 结果刷新车局并显示等待车头审核提示。
  - [x] NPC 自选关闭时不提供选择操作。

- [x] D24.8 改造管理端审核展示。
  - [x] 小程序车头管理页展示 NPC 申请的 NPC 角色名。
  - [x] 小程序车头管理页通过/拒绝 NPC 申请后刷新列表。
  - [x] 小程序车头管理页 NPC 角色卡支持 `关闭角色`、`开放角色` 和已绑定工作人员的 `移除成员`。
  - [x] admin web 审核列表展示 NPC 申请的 NPC 角色名。
  - [x] admin web 通过/拒绝 NPC 申请后刷新列表和 NPC 角色绑定状态。
  - [x] 网页小程序创建车局加入 `npcJoinEnabled` 开关并提交 payload。

- [x] D24.9 更新静态检查和 smoke。
  - [x] 新增 `scripts/d24-npc-self-join-check.js`。
  - [x] 将 D24 静态检查加入 `npm run check`。
  - [x] 扩展 `scripts/d18-session-album-privacy-smoke.js` 或新增 smoke，覆盖 direct NPC 绑定。
  - [x] 覆盖 direct NPC 重复绑定幂等成功。
  - [x] 覆盖第二个工作人员抢占已绑定 NPC 角色失败。
  - [x] 覆盖 NPC 自选关闭时普通工作人员申请失败。
  - [x] 覆盖 review NPC 申请 pending、审核前无相册权限、审核后绑定并获得相册权限。
  - [x] 覆盖 `session-npc:<id>` 标签保存和隐私行为。

- [x] D24.10 执行自动验证。
  - [x] 运行 `node scripts/d24-npc-self-join-check.js`。
  - [x] 运行 `node --check scripts/d18-session-album-privacy-smoke.js`。
  - [x] 运行 `npm --workspace apps/api run check`。
  - [x] 运行 `node scripts/check-miniprogram.js`。
  - [x] 运行 `node scripts/d12-admin-web-check.js`。
  - [x] 运行 `npm run check`。
  - [x] 运行 `npm run build:mp-weixin`。

- [x] D24.11 微信开发者工具验证。
  - [x] 创建默认开启 NPC 自选的 `direct` 车，工作人员从分享页选择 NPC 角色后进入相册。
  - [x] 创建 `review_required` 车，工作人员从分享页选择 NPC 角色后看到等待审核提示。
  - [x] 车头通过 NPC 申请后，工作人员重新进入分享页可进入相册。
  - [x] 关闭 NPC 自选的车局，分享页不提供 NPC 自选操作。
  - [x] 玩家座位统计不包含 NPC 角色。
  - [x] 相册人物标签里可看到已绑定 NPC 角色。

## D24 验收

- [x] D24 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D24 design 已落地到 [design.md](./design.md)。
- [x] D24 tasks 已落地到本文件。
- [x] 车局支持默认开启、可关闭的 NPC 自选开关。
- [x] NPC 角色选择复用 `direct` 和 `review_required` 上车策略。
- [x] `direct` NPC 选择直接绑定工作人员账号。
- [x] `review_required` NPC 选择先进入车头审核。
- [x] pending NPC 申请不授予完整相册权限。
- [x] 审核通过 NPC 申请后授予完整相册权限。
- [x] 分享页支持 NPC 工作人员选择本场 NPC 角色。
- [x] 管理端审核列表能区分玩家座位申请和 NPC 角色申请。
- [x] NPC 角色相册标签和隐私逻辑与玩家相同。
- [x] `npm run check` 通过。
- [x] `npm run build:mp-weixin` 通过。

## 验证记录

- `node scripts/d24-npc-self-join-check.js` 通过：D24 NPC self join checks passed。
- `node --check scripts/d18-session-album-privacy-smoke.js` 通过。
- `npm --workspace apps/api run check` 通过：API syntax check passed: 14 files。
- `node scripts/check-miniprogram.js` 通过：UniApp miniprogram check passed: 13 pages。
- `node scripts/d12-admin-web-check.js` 通过：d12 admin web static checks passed。
- `npm run build:mp-weixin` 通过：DONE Build complete。
- `npm run check` 通过：D24 NPC self join checks passed。曾与小程序构建并行执行时出现一次构建产物字体未生成的假阴性，按顺序重跑后通过。
- 微信开发者工具 Nightly v2.01.2512242 人工验证通过，本地 API `http://127.0.0.1:3018`，`WECHAT_MOCK_LOGIN=true`。
- D24.11 手测 fixture：`direct` session 43 / NPC 30，`review_required` session 44 / NPC 32，关闭 NPC 自选 session 45 / NPC 34。
- `direct` 分享页显示玩家统计 `2 个可选，0 个我选，0 个换选，0 个已选`，NPC 区块独立显示 `固定NPC-direct 可选`；点击后进入 `pages/session/album`，数据库确认 NPC 30 绑定 user 119 且 signup 60 approved。
- `review_required` 分享页显示玩家统计仍为 `2 个可选...`，NPC 区块独立显示；staff 申请 NPC 32 返回 `pending_review`，signup 61 pending；车头调用审核接口后 signup 61 approved，NPC 32 绑定 user 119。
- 关闭 NPC 自选的分享页显示 `本场NPC由车头安排`，NPC 34/35 均为 `不可选`；已验证手机号 staff 调用 NPC 34 claim 返回 403 `NPC self join is disabled`，session 45 无 signup、无 NPC 绑定。
- `GET /api/sessions/43/album/people` 返回 `session-npc:30`，`GET /api/sessions/44/album/people` 返回 `session-npc:32`，均带绑定用户 `user_id:119`。
