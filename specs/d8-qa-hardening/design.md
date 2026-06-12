# D8 Design: QA与内测修复设计

更新日期：2026-06-12

## Test Matrix

- API自动烟测：D2-D8。
- 小程序构建：`npm run build:mp-weixin`。
- Docker：`docker compose build api`、`docker compose up -d api`。
- 微信开发者工具：编译、预览、分享路径、页面主链路。
- 真机：iOS微信、Android微信。

## Automated QA

- `npm run d8:qa` 覆盖公开备注移除、公开脚本中性化、公开字段风险词拦截和最小发布车链路。
- 公共脚本输出对历史种子数据做中性化，不改变管理员后台原始资料。
- 公开字段风险词用于指定DM/NPC、座位名和角色说明；报名联系方式只在车头审核页可见。

## Issue Severity

- P0：主链路无法完成、数据损坏、权限泄露。
- P1：主链路严重阻塞但有临时绕法。
- P2：体验问题、文案问题、轻微兼容问题。
