# D8 Tasks: QA与内测修复执行清单

更新日期：2026-06-12

- [x] D8.1 建立D8 spec目录。
- [x] D8.2 建立QA清单。
- [x] D8.3 跑API自动烟测。
- [x] D8.4 跑微信开发者工具主链路。
- [x] D8.5 准备真机兼容测试清单，体验版上传后执行。
- [x] D8.6 跑合规文案检查。
- [x] D8.7 修复P0/P1问题。
- [x] D8.8 准备提审说明草稿。

## Verification

- `npm run check`：通过。
- `npm run build:mp-weixin`：通过。
- `docker compose build api`：通过。
- `docker compose up -d api`：通过。
- `npm run d2:smoke`：通过。
- `npm run d3:smoke`：通过。
- `npm run d4:smoke`：通过。
- `npm run d5:smoke`：通过。
- `npm run d6:smoke`：通过。
- `npm run d7:smoke`：通过。
- `npm run d8:qa`：通过。
- 微信开发者工具：`dist/dev/mp-weixin` 已在 2026-06-12 11:15 重新生成 D8 产物；工具日志显示 `finish load user code`、`webview loaded`、`webview page ready`。

## Notes

- 热重载期间的 `app.json doesn't exist` 为 UniApp 重建产物的瞬时日志，最终加载完成。
- 真机 iOS/Android 兼容需要 D9 上传体验版后由用户配合完成。
