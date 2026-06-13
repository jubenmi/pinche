# D11 Tasks: 玩家性别与角色位性别

更新日期：2026-06-13

- [x] D11.1 增加 D11 静态检查脚本，并先验证它能捕获当前缺失行为。
  - 验证：`node scripts/d11-gender-check.js` 已按预期失败，捕获 D11 缺失项。
- [x] D11.2 增加数据库 migration，保存 `users.gender` 和 `session_seats.role_gender`。
- [x] D11.3 调整后端用户资料接口，登录返回玩家性别，并允许 `PATCH /api/users/me` 修改男/女。
- [x] D11.4 调整后端座位接口，创建和更新座位时保存角色位性别。
  - 验证：`npm --workspace apps/api run check` 通过。
- [x] D11.5 调整前端登录态工具，首次登录缺少性别时要求选择并长期保存。
- [x] D11.6 调整建车选角和 createFlow，角色位支持男、女、不限以及符号显示。
- [x] D11.7 调整分享最终选角页，允许跨性别选角并在当前选择上显示“反串”。
- [x] D11.8 调整“我的”页，提供性别展示和修改入口。
- [x] D11.9 将 D11 检查接入 `npm run check` 并完成验证。
  - 验证：`node scripts/d11-gender-check.js`、`node scripts/check-miniprogram.js`、`npm run check` 均通过。
- [x] D11.10 跨性别选角前提示“反串可能会影响游戏体验，是否确认”，取消时不改变选择。
  - 验证：`node scripts/d11-gender-check.js`、`node scripts/check-miniprogram.js`、`npm --workspace apps/api run check`、`npm run check` 均通过。
- [x] D11.11 兼容旧剧本模板和演示模板的角色性别显示，并在登录身份条展示当前玩家性别。
  - 验证：`node scripts/d11-gender-check.js`、`node scripts/check-miniprogram.js`、`npm --workspace apps/api run check`、`npm run check` 均通过。
- [x] D11.12 顶部个人信息条可点击打开资料模态窗；登录后缺少性别时复用该模态窗强制选择，并提供男女默认头像。
  - 验证：`npm run check`、`npm --workspace apps/miniprogram run build:mp-weixin` 均通过。
- [x] D11.13 设计并接入有质感的男女默认头像 PNG，替换顶部身份条、资料预览和性别选项里的文字圆点头像。
  - 验证：`node scripts/d10-pseudo-chat-check.js`、`node scripts/d11-gender-check.js`、`node scripts/check-miniprogram.js`、`npm --workspace apps/miniprogram run build:mp-weixin` 均通过。

## Verification Target

- `node scripts/d11-gender-check.js`：通过。
- `node scripts/check-miniprogram.js`：通过。
- `npm --workspace apps/api run check`：通过。
- `npm run check`：通过。
