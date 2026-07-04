# D25 Tasks: 恶意骚扰成员移除与举报执行清单

更新日期：2026-07-04

## D25 执行任务

- [x] D25.1 建立 D25 spec 三件套。
  - [x] `requirements.md` 描述移除、举报、禁止重进、聊天/相册权限和管理页入口。
  - [x] `design.md` 描述数据模型、后端事务、前端交互、安全边界和验证策略。
  - [x] `tasks.md` 描述实现和验收清单。

- [x] D25.2 先写 D25 静态检查并验证失败。
  - [x] 新增 `scripts/d25-member-removal-reporting-check.js`。
  - [x] 检查迁移文件、举报表、禁止重进检查、`kickSessionSeat` 举报分支、管理页原因选择和 `package.json` 接入。
  - [x] 运行 `node scripts/d25-member-removal-reporting-check.js`，确认在实现前按预期失败。
    - 验证：按预期失败，提示 `D25 migration file must exist`。

- [x] D25.3 新增成员移除举报数据模型。
  - [x] 新增 `apps/api/migrations/0018_session_member_removal_reports.sql`。
  - [x] 建立 `session_member_removal_reports` 表。
  - [x] 增加 `session_id + removed_user_id + block_rejoin` 查询索引。
  - [x] 增加举报状态和创建时间索引。

- [x] D25.4 扩展后端移除与禁止重进逻辑。
  - [x] 新增 `normalizeRemovalReasonType`。
  - [x] 新增 `removalReasonLabel`。
  - [x] 新增 `assertUserCanJoinSession`。
  - [x] `createSignup` 在创建或恢复申请前阻止被禁止重进用户。
  - [x] `claimSessionSeat` 在确认座位前阻止被禁止重进用户。
  - [x] `kickSessionSeat` 在 `report = true` 时要求已上车成员。
  - [x] `kickSessionSeat` 写入举报审计和禁止重进记录。
  - [x] `kickSessionSeat` 只把原因类型写入系统消息，不把补充说明写入聊天。

- [x] D25.5 改造小程序管理页。
  - [x] 已上车成员操作文案改为 `移除成员`。
  - [x] 空座或待审座位文案改为 `关闭座位`。
  - [x] 点击已上车成员时弹出普通释放和安全原因选项。
  - [x] 普通释放不带举报参数。
  - [x] 恶意原因带 `report = true` 和对应 `reasonType`。
  - [x] 举报成功后展示成员已移除且不能再次加入本车的文案。

- [x] D25.6 接入自动检查。
  - [x] 将 `scripts/d25-member-removal-reporting-check.js` 加入根 `npm run check`。
  - [x] 运行 `node scripts/d25-member-removal-reporting-check.js`。
  - [x] 运行 `npm --workspace apps/api run check`。
  - [x] 运行 `node scripts/check-miniprogram.js`。
  - [x] 视当前工作树情况运行 `npm run check`。

## D25 验收

- [x] D25 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D25 design 已落地到 [design.md](./design.md)。
- [x] D25 tasks 已落地到本文件。
- [x] 车头和系统管理员可以移除已上车玩家。
- [x] 普通释放不创建举报记录，不禁止重进。
- [x] 恶意骚扰、垃圾信息、疑似诈骗和其他安全原因会创建举报审计记录。
- [x] 被恶意移除用户不能再次申请或直接加入同一车局。
- [x] 被移除用户失去聊天和完整相册访问权限。
- [x] 管理页提供移除成员和原因选择入口。
- [x] `node scripts/d25-member-removal-reporting-check.js` 通过。
- [x] `npm --workspace apps/api run check` 通过。
- [x] `node scripts/check-miniprogram.js` 通过。

## 验证记录

- `node scripts/d25-member-removal-reporting-check.js` 通过：D25 member removal reporting checks passed。
- `npm --workspace apps/api run check` 通过：API syntax check passed: 14 files。
- `node scripts/check-miniprogram.js` 通过：UniApp miniprogram check passed: 13 pages。
- `npm run check` 通过，包含 D25 member removal reporting checks passed。
