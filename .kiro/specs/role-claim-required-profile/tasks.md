# 角色认领必备资料任务

## 事实来源

需求：`.kiro/specs/role-claim-required-profile/requirements.md`

设计：`.kiro/specs/role-claim-required-profile/design.md`

## 执行规则

- 严格按编号顺序实施，先写失败检查或测试，再做最小实现。
- 每完成一个子任务立即更新本文件；父任务只有在全部子任务完成后才能勾选。
- 不回滚或覆盖 `package-lock.json`、`specs/d48-album-sharing-role-claim-separation/tasks.md`、`docs/evidence/` 等现有工作区改动。
- 不执行非目标中的功能，不借机重构无关登录、相册或车局页面。

## 任务

- [ ] 1. Spec 和实施预检
  - [ ] 1.1 阅读本 spec 的 `requirements.md`、`design.md` 和 `tasks.md`。
  - [ ] 1.2 检查 dirty working tree，记录并避开其他任务和用户改动。
  - [ ] 1.3 对照现有玩家座位、NPC 角色、direct、review_required 四条认领路径，确认共同准入写入点。
  - [ ] 1.4 对照现有头像上传、异步审核、恢复和安全投影，确认 pending 不阻塞且非 approved 不展示。

- [ ] 2. 先建立后端失败检查和迁移契约
  - [ ] 2.1 新增角色认领资料专用静态检查，要求稳定错误码、统一准入 helper、四条路径覆盖和 `openid` 展示禁令。
  - [ ] 2.2 扩展迁移检查，要求 `users.role_claim_avatar_completed_at` 存在，并锁定“只在首次新增字段时回填”的边界。
  - [ ] 2.3 扩展 D25 上车设置检查，要求前端手机号开关移除、后端不再按 session 开关跳过手机号。
  - [ ] 2.4 运行新检查，确认当前实现因缺少新契约而失败。

- [ ] 3. 实现头像选择完成状态
  - [ ] 3.1 新增 `0033_role_claim_required_profile.sql`，添加 nullable 完成时间并回填全部历史用户。
  - [ ] 3.2 更新启动迁移 reconciler，首次加字段时回填历史用户，后续重启保留新用户 NULL。
  - [ ] 3.3 扩展 `publicUser()` 和当前用户 DTO，返回 `roleClaimAvatarCompletedAt`。
  - [ ] 3.4 在头像资产成功建立后幂等写入完成时间并关联当前候选；pending、review、approved、rejected、error 不回滚。
  - [ ] 3.5 增加测试覆盖历史用户豁免、新用户默认未完成、首次头像 finalize 完成、候选关联和重试幂等。
  - [ ] 3.6 运行迁移与头像状态测试，确认通过。

- [ ] 4. 实现统一后端角色认领资料准入
  - [ ] 4.1 在 HTTP errors 增加 `ROLE_CLAIM_NICKNAME_REQUIRED` 和 `ROLE_CLAIM_AVATAR_REQUIRED`。
  - [ ] 4.2 在 core service 增加 `requireRoleClaimProfile(user)`，依次检查昵称、已验证手机号和头像选择完成时间。
  - [ ] 4.3 在 `createSignup` 写入前调用统一准入，覆盖玩家审核申请。
  - [ ] 4.4 在 `claimSessionSeat` 写入前调用统一准入，覆盖玩家直接认领。
  - [ ] 4.5 在 `claimSessionNpcRole` 写入前调用统一准入，覆盖 NPC direct 与 review_required。
  - [ ] 4.6 确认车头/管理员手工安排角色路径未被错误加入自助认领门槛。
  - [ ] 4.7 增加 API 测试覆盖四条路径的缺昵称、缺手机号、缺头像和成功结果。
  - [ ] 4.8 运行后端角色认领准入测试，确认通过。

- [ ] 5. 固定手机号要求并移除车头开关
  - [ ] 5.1 修改 `createSession`，忽略旧客户端关闭值并固定持久化 `join_phone_required = 1`。
  - [ ] 5.2 修改 `updateSession`，忽略旧客户端关闭值并保持 `join_phone_required = 1`。
  - [ ] 5.3 修改成员和公开详情投影，使兼容字段 `join_phone_required` 固定返回 `true`。
  - [ ] 5.4 从 `setup.vue` 删除手机号开关、状态、事件和请求字段，并更新上车审核说明。
  - [ ] 5.5 从 `manage.vue` 删除手机号开关、dirty 比较、事件和请求字段，并更新上车审核说明。
  - [ ] 5.6 从 `share.vue` 删除按车局开关判断手机号的逻辑，角色认领固定进入必填手机号流程。
  - [ ] 5.7 更新 D25 检查和 smoke，覆盖旧客户端传 false 仍无法绕过手机号。
  - [ ] 5.8 运行上车设置检查和 smoke，确认通过。

- [ ] 6. 实现前端资料补全编排
  - [ ] 6.1 为 profile request payload 增加必填昵称、是否要求首次头像选择、标题和说明字段。
  - [ ] 6.2 修改 `AuthIdentityBar` 必填资料模式：昵称必填，新用户必须本次选择头像，历史/已完成用户不强制头像。
  - [ ] 6.3 修改头像保存：pending 视为已提交，继续保存昵称并刷新用户；昵称待审保持流程暂停；其他失败保持弹窗并允许重试。
  - [ ] 6.4 在 `api.js` 增加 `ensureRoleClaimProfile`，按资料后手机号顺序返回最新 auth。
  - [ ] 6.5 玩家 `chooseRole` 接入 helper，补齐后继续原目标角色。
  - [ ] 6.6 NPC `chooseNpcRole` 接入 helper，补齐后继续原目标角色。
  - [ ] 6.7 按稳定错误码增加服务端拒绝后的恢复入口，不解析错误文案。
  - [ ] 6.8 增加前端检查覆盖跳过已满足步骤、历史无头像豁免、新用户 pending 继续和拒绝手机号不提交。
  - [ ] 6.9 运行前端资料补全检查，确认通过。

- [ ] 7. 收紧头像和昵称展示
  - [ ] 7.1 枚举玩家座位、NPC 角色、待审核申请、车局详情、分享页和管理页使用的用户头像 SQL 投影。
  - [ ] 7.2 所有相关 SQL 只在 active 且 approved/approved_legacy 时返回头像 URL。
  - [ ] 7.3 删除角色与申请人 UI 中 `openid` 名称回退，统一使用“车友”。
  - [ ] 7.4 确认待审、复审、错误、驳回或已删除头像都由现有 RoleSeatBoard 显示默认头像。
  - [ ] 7.5 增加测试覆盖各审核状态的头像投影和异常缺昵称的“车友”回退。
  - [ ] 7.6 运行头像安全投影测试，确认通过。

- [ ] 8. 集成与回归验证
  - [ ] 8.1 运行角色认领资料专用静态检查和 API smoke。
  - [ ] 8.2 运行 `node scripts/d25-session-join-settings-check.js` 及对应 smoke。
  - [ ] 8.3 运行 `node scripts/check-miniprogram.js`。
  - [ ] 8.4 运行与用户图片审核相关的现有测试，确认 pending/rejected 展示边界未回退。
  - [ ] 8.5 运行 `npm --workspace apps/miniprogram run build:mp-weixin`。
  - [ ] 8.6 检查 git diff，确认只包含本 spec 范围且未覆盖工作区原有改动。

- [ ] 9. 微信开发者工具验收
  - [ ] 9.1 新用户登录，填写昵称并选择头像，头像处于待审时完成手机号授权。
  - [ ] 9.2 在 direct 车局认领玩家座位，确认无需等待头像审核即可上车。
  - [ ] 9.3 在 review_required 车局认领玩家座位，确认无需等待头像审核即可提交车头审核。
  - [ ] 9.4 分别抽查 NPC direct 与 review_required，确认与玩家资料门槛一致。
  - [ ] 9.5 确认车头审核列表显示昵称；待审或驳回头像显示默认头像，不显示 `openid`。
  - [ ] 9.6 模拟历史无头像用户，确认不被要求重新选择头像，但仍必须有昵称和已验证手机号。

- [ ] 10. 收尾
  - [ ] 10.1 更新本 `tasks.md`，只勾选有验证证据的项目。
  - [ ] 10.2 记录自动化命令、结果和未完成的人工验证。
  - [ ] 10.3 最终说明 direct/review_required、玩家/NPC、历史豁免和头像异步展示均已按 spec 处理。
