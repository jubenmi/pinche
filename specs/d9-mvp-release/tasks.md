# D9 Tasks: 发布MVP执行清单

更新日期：2026-06-12

- [x] D9.1 建立D9 spec目录。
- [x] D9.2 准备生产环境变量模板。
- [x] D9.3 构建API Docker镜像。
- [x] D9.4 准备生产迁移命令，等待生产数据库。
- [x] D9.5 准备HTTPS域名和微信合法域名检查项，等待用户配置真实域名。
- [x] D9.6 构建小程序生产产物，并支持发布时注入生产API域名。
- [ ] D9.7 微信开发者工具上传代码，需要用户协助。
- [ ] D9.8 设置体验版并测试。
- [ ] D9.9 提交审核，需要用户确认。
- [ ] D9.10 审核通过后发布。

## Verification

- `npm run check`：通过。
- `npm run build:mp-weixin`：通过。
- `docker compose build api`：通过。
- `docker compose up -d api`：通过。
- `RELEASE_API_BASE_URL=https://api.example.com npm run d9:release-check`：通过基础检查；占位域名输出 `uploadReady: false`，真实域名后才可上传。
- 微信开发者工具：`dist/dev/mp-weixin` 已在 2026-06-12 11:15 重新生成并 `webview page ready`。

## Handoff

已到上传前交接点。继续 D9.7 需要用户提供真实生产 HTTPS API 域名，并在微信开发者工具/小程序后台确认上传、体验版、提审和发布。
