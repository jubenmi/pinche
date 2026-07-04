# D24 Tasks: NPC 工作人员自选角色上车执行清单

更新日期：2026-07-04

## D24 执行任务

- [x] D24.1 建立 D24 spec 三件套。
  - [x] `requirements.md` 描述 NPC 自选开关、direct/review 分支、审核、相册权限和管理端要求。
  - [x] `design.md` 描述数据模型、后端接口、审核流、小程序分享页、管理端和测试方案。
  - [x] `tasks.md` 描述实现和验收清单。

- [ ] D24.2 新增 NPC 自选和 NPC 申请数据模型。
  - [ ] 新增安全迁移，给 `sessions` 增加 `npc_join_enabled` 字段，默认开启。
  - [ ] 扩展 `signups`，允许 `seat_id` 为空并新增 `session_npc_role_id`、`signup_type`、NPC 角色唯一键和索引。
  - [ ] 后端新增 `normalizeNpcJoinEnabled`。
  - [ ] `createSession` 写入 `npcJoinEnabled`。
  - [ ] `updateSession` 可选更新 `npcJoinEnabled`。
  - [ ] `getSession` 返回 `npc_join_enabled`。
  - [ ] 添加 D24 静态检查，先验证它能捕获当前缺失行为。

- [ ] D24.3 实现 NPC 角色选择接口。
  - [ ] 新增 `claimSessionNpcRole` 服务，要求登录和手机号。
  - [ ] 校验 NPC 角色存在、active、所属车局未取消、NPC 自选开启。
  - [ ] 校验 NPC 角色未绑定他人，且没有其他用户 pending 申请。
  - [ ] `direct` 分支写入 `session_npc_roles.bound_user_id`。
  - [ ] `direct` 分支写入或更新 approved NPC signup。
  - [ ] `review_required` 分支写入或更新 pending NPC signup。
  - [ ] 重复选择自己的已绑定 NPC 角色返回 `npc_joined`。
  - [ ] 重复选择自己的 pending NPC 角色返回 `pending_review`。
  - [ ] 在 `server.js` 暴露 `POST /api/session-npc-roles/:id/claim`。

- [ ] D24.4 扩展报名列表和审核逻辑。
  - [ ] `listSessionSignups` 返回 NPC 申请的 `signup_type`、`session_npc_role_id`、`npc_role_name`。
  - [ ] `approveSignup` 保持玩家座位审核现有行为。
  - [ ] `approveSignup` 对 NPC 申请绑定 `session_npc_roles.bound_user_id`。
  - [ ] `approveSignup` 通过 NPC 申请后拒绝同一 NPC 角色其他 pending 申请。
  - [ ] `rejectSignup` 对 NPC 申请只更新 signup 状态，不改 NPC 角色绑定。
  - [ ] 确认 pending NPC 申请不授予完整相册权限。

- [ ] D24.5 扩展相册和我的车局行为验证。
  - [ ] 确认已绑定 NPC 用户被 `isSessionAlbumMember` 识别为相册成员。
  - [ ] 确认 pending NPC 申请人不能查看完整相册。
  - [ ] 确认已绑定 NPC 用户出现在 `listMyAlbumSessions`。
  - [ ] 确认 `album/people` 返回 `session-npc:<id>` 和绑定用户 `user_id`。
  - [ ] 确认标注 `session-npc:<id>` 的照片继续使用绑定用户隐私。

- [ ] D24.6 改造小程序创建设置页。
  - [ ] `pages/session/setup.vue` 增加 `允许NPC工作人员自选角色` 开关，默认开启。
  - [ ] 关闭说明使用 `关闭后由车头手动安排NPC角色`。
  - [ ] 创建车局请求带上 `npcJoinEnabled`。
  - [ ] 创建 flow 保存并恢复 `npcJoinEnabled`。
  - [ ] 保持玩家上车策略控件现有行为。

- [ ] D24.7 改造小程序分享页 NPC 选择。
  - [ ] `pages/session/share.vue` 从 `session.session_npc_roles` 生成 NPC 角色卡。
  - [ ] NPC 角色卡展示 `可选`、`我选`、`待审`、`已选` 状态。
  - [ ] NPC 角色不计入玩家座位人数和玩家角色统计。
  - [ ] 选择可选 NPC 角色前要求登录和手机号。
  - [ ] 调用 `POST /api/session-npc-roles/:id/claim`。
  - [ ] `npc_joined` 结果刷新车局；相册入口进入相册。
  - [ ] `pending_review` 结果刷新车局并显示等待车头审核提示。
  - [ ] NPC 自选关闭时不提供选择操作。

- [ ] D24.8 改造管理端审核展示。
  - [ ] 小程序车头管理页展示 NPC 申请的 NPC 角色名。
  - [ ] 小程序车头管理页通过/拒绝 NPC 申请后刷新列表。
  - [ ] admin web 审核列表展示 NPC 申请的 NPC 角色名。
  - [ ] admin web 通过/拒绝 NPC 申请后刷新列表和 NPC 角色绑定状态。
  - [ ] 网页小程序创建车局加入 `npcJoinEnabled` 开关并提交 payload。

- [ ] D24.9 更新静态检查和 smoke。
  - [ ] 新增 `scripts/d24-npc-self-join-check.js`。
  - [ ] 将 D24 静态检查加入 `npm run check`。
  - [ ] 扩展 `scripts/d18-session-album-privacy-smoke.js` 或新增 smoke，覆盖 direct NPC 绑定。
  - [ ] 覆盖 direct NPC 重复绑定幂等成功。
  - [ ] 覆盖第二个工作人员抢占已绑定 NPC 角色失败。
  - [ ] 覆盖 NPC 自选关闭时普通工作人员申请失败。
  - [ ] 覆盖 review NPC 申请 pending、审核前无相册权限、审核后绑定并获得相册权限。
  - [ ] 覆盖 `session-npc:<id>` 标签保存和隐私行为。

- [ ] D24.10 执行自动验证。
  - [ ] 运行 `node scripts/d24-npc-self-join-check.js`。
  - [ ] 运行 `node --check scripts/d18-session-album-privacy-smoke.js`。
  - [ ] 运行 `npm --workspace apps/api run check`。
  - [ ] 运行 `node scripts/check-miniprogram.js`。
  - [ ] 运行 `node scripts/d12-admin-web-check.js`。
  - [ ] 运行 `npm run check`。
  - [ ] 运行 `npm run build:mp-weixin`。

- [ ] D24.11 微信开发者工具验证。
  - [ ] 创建默认开启 NPC 自选的 `direct` 车，工作人员从分享页选择 NPC 角色后进入相册。
  - [ ] 创建 `review_required` 车，工作人员从分享页选择 NPC 角色后看到等待审核提示。
  - [ ] 车头通过 NPC 申请后，工作人员重新进入分享页可进入相册。
  - [ ] 关闭 NPC 自选的车局，分享页不提供 NPC 自选操作。
  - [ ] 玩家座位统计不包含 NPC 角色。
  - [ ] 相册人物标签里可看到已绑定 NPC 角色。

## D24 验收

- [x] D24 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D24 design 已落地到 [design.md](./design.md)。
- [x] D24 tasks 已落地到本文件。
- [ ] 车局支持默认开启、可关闭的 NPC 自选开关。
- [ ] NPC 角色选择复用 `direct` 和 `review_required` 上车策略。
- [ ] `direct` NPC 选择直接绑定工作人员账号。
- [ ] `review_required` NPC 选择先进入车头审核。
- [ ] pending NPC 申请不授予完整相册权限。
- [ ] 审核通过 NPC 申请后授予完整相册权限。
- [ ] 分享页支持 NPC 工作人员选择本场 NPC 角色。
- [ ] 管理端审核列表能区分玩家座位申请和 NPC 角色申请。
- [ ] NPC 角色相册标签和隐私逻辑与玩家相同。
- [ ] `npm run check` 通过。
- [ ] `npm run build:mp-weixin` 通过。

## 验证记录

- 待实现后记录。
