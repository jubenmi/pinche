# D6 Tasks: 车头管理执行清单

更新日期：2026-06-12

- [x] D6.1 建立D6 spec目录。
- [x] D6.2 实现我的发车列表。
- [x] D6.3 实现车管理页申请列表。
- [x] D6.4 实现通过/拒绝操作。
- [x] D6.5 实现押金状态更新。
- [x] D6.6 实现锁座操作。
- [x] D6.7 新增D6烟测。
- [x] D6.8 微信开发者工具验证。

## Verification

- `npm run check`：通过。
- `npm run d6:smoke`：通过，覆盖车头列表、非车头禁止查看、申请审核、同座竞争自动拒绝、拒绝后座位释放、押金状态、锁座。
- `npm run build:mp-weixin`：通过。
- 微信开发者工具：已打开 `apps/miniprogram`，UniApp dev 产物热更新到 `dist/dev/mp-weixin`；工具日志在 2026-06-12 10:39 显示 `app.json` 重新生成后 `finish load user code`、`webview loaded`、`webview page ready`。热重载期间出现的 `app.json doesn't exist` 是 UniApp 先删除后重建产物时的瞬时日志，最终加载完成。
