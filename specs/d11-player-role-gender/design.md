# D11 Design: 玩家性别与角色位性别

更新日期：2026-06-13

## Current State

当前微信登录只返回用户、角色和 token，`users` 表没有玩家性别。角色位来自剧本 `default_seat_template_json`，前端通过 `roleOptionsFromScript` 转成选角卡片。真实车局创建后，座位保存到 `session_seats`，分享页通过 `/api/sessions/:id` 读取座位并调用 `/api/session-seats/:id/claim` 完成最终选角。

## Target Model

新增两个结构化字段：

- `users.gender`：玩家账号性别，取值为 `male` 或 `female`，为空表示历史用户尚未补齐。
- `session_seats.role_gender`：角色位性别，取值为 `male`、`female`、`unlimited`，默认 `unlimited`。

剧本模板中的角色性别使用前端字段 `roleGender`。兼容已有数据时，缺失 `roleGender` 的角色都视为 `unlimited`。

## Login And Profile Flow

`publicUser` 返回 `gender`。`ensureLoggedIn` 在拿到登录态后检查 `auth.user.gender`：

1. 如果已有 `gender`，直接返回登录态。
2. 如果没有 `gender`，通过当前页面的顶部个人信息条打开必填模态窗。
3. 模态窗展示男/女选项和对应默认头像，保存时调用 `PATCH /api/users/me`。
4. 保存成功后更新本地 auth 缓存并继续当前流程。
5. 如果当前页没有个人信息条监听请求，则保留原生选择作为兜底，避免登录流程卡死。

顶部个人信息条在所有主流程页面作为资料入口。玩家点击后打开同一个个人信息模态窗，编辑模式可取消；缺少性别时由登录流程打开的必填模式不可取消。修改成功后更新本地 auth 缓存。

## Role Gender And Cross-Cast

前端在 `createFlow` 中集中处理角色性别：

- `compactRole` 保留 `roleGender`，缺省为 `unlimited`。
- `roleGenderSymbol(roleGender)` 返回 `♂`、`♀` 或空字符串。
- `isCrossCast(playerGender, roleGender)` 只在玩家性别和角色性别分别为 `male/female` 且不相等时返回 true。

选角页和分享页使用同一套 helper。男位、女位显示在角色名旁边；不限位不显示符号。选角不做性别拦截。

## Backend Flow

新增 migration：

- 给 `users` 增加 `gender VARCHAR(16) NULL`。
- 给 `session_seats` 增加 `role_gender VARCHAR(16) NOT NULL DEFAULT 'unlimited'`。

后端新增性别校验 helper：

- 玩家性别只允许 `male`、`female`。
- 角色位性别允许 `male`、`female`、`unlimited`。

`createSeat` 和 `updateSeat` 保存 `roleGender` 到 `role_gender`。`getSession` 继续返回 seat row，前端从 `role_gender` 映射到 `roleGender`。

## UI Behavior

首次登录缺少性别时使用个人信息模态窗强制选择。这不是筛选条件，只用于后续标记反串。模态窗提供男/女默认头像，选择性别时头像预览同步切换。默认头像使用独立 PNG 资产，不使用文字圆点作为头像主体。男头像使用更明确的青绿色系，女头像使用更明确的粉色系，并与角色位男/女标记的柔和色彩保持一致。

点击顶部身份条打开个人信息模态窗。已有性别时，模态窗进入编辑模式，可以取消；保存成功后顶部身份条立即刷新性别和默认头像。

角色卡展示：

```text
林晚 ♀
阿澈 ♂
旁白位
```

最终选角页在当前玩家选择了跨性别角色位时显示：

```text
林晚 ♀（反串）
```

换选后重新计算。不限性别角色不显示符号，也不显示“反串”。

跨性别选择需要二次确认。建车流程角色页和分享最终选角页在提交跨性别选择前弹出确认框：

```text
反串可能会影响游戏体验，是否确认
```

玩家确认后继续选角；玩家取消后不修改当前角色，也不发起座位 claim 请求。相同性别和不限性别角色不弹确认。

## Check Strategy

静态检查脚本 `scripts/d11-gender-check.js` 覆盖：

- migration 增加 `users.gender` 和 `session_seats.role_gender`。
- 后端返回并更新用户 `gender`。
- 前端登录流程通过个人信息模态窗补齐 `gender`。
- `createFlow` 保留 `roleGender` 并提供反串判断。
- 角色页和分享页包含反串确认提示。
- 角色页、分享页和个人信息模态窗包含必要 UI 文案。

常规验证：

- `node scripts/d11-gender-check.js`
- `npm run check`

## Implementation Note

当前工作区已有会话创建、分享页和聊天相关未提交改动，且 D11 需要修改这些现有未提交文件。因此本次在 `codex/d11-player-role-gender` 分支的当前工作区内执行，不创建独立 worktree，避免丢失当前页面上下文。
