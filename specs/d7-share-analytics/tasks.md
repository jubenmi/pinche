# D7 Tasks: 分享与埋点执行清单

更新日期：2026-06-12

- [x] D7.1 建立D7 spec目录。
- [x] D7.2 实现分享路径和标题。
- [x] D7.3 实现复制招募文案。
- [x] D7.4 实现分享访问埋点。
- [x] D7.5 实现报名转化埋点。
- [x] D7.6 实现车详情统计展示。
- [x] D7.7 新增D7烟测。
- [x] D7.8 微信开发者工具验证。

## Verification

- `npm run check`：通过。
- `npm run d7:smoke`：通过，覆盖分享访问、报名转化、聚合统计、座位级统计和前端分享/复制/风险词拦截 hook。
- `npm run build:mp-weixin`：通过。
- 微信开发者工具：`dist/dev/mp-weixin` 已在 2026-06-12 10:57 重新生成 D7 详情页产物；工具日志显示 `finish load user code`、`webview loaded`、`webview page ready`。热重载期间的 `app.json doesn't exist` 为 UniApp 重建产物的瞬时日志，最终加载完成。
- 本地调试硬化：小程序开发态 API 地址固定为 `http://127.0.0.1:3018`，请求失败统一返回可展示错误文案，避免裸 `timeout` 影响调试判断。
