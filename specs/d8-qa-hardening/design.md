# D8 Design: QA与内测修复设计

更新日期：2026-06-12

## Test Matrix

- API自动烟测：D2-D7。
- 小程序构建：`npm run build:mp-weixin`。
- Docker：`docker compose build api`、`docker compose up -d api`。
- 微信开发者工具：编译、预览、分享路径、页面主链路。
- 真机：iOS微信、Android微信。

## Issue Severity

- P0：主链路无法完成、数据损坏、权限泄露。
- P1：主链路严重阻塞但有临时绕法。
- P2：体验问题、文案问题、轻微兼容问题。
