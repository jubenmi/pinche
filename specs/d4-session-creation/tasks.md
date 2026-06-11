# D4 Tasks: 车头建车流程执行清单

更新日期：2026-06-12

## D4执行任务

- [x] D4.1 建立D4 spec目录：`specs/d4-session-creation/`。
- [x] D4.2 同步README和开发路线图D4入口。
- [x] D4.3 实现建车页基础信息表单：时间、DM/NPC、押金、备注。
- [x] D4.4 实现剧本默认座位模板解析和本地默认模板。
- [x] D4.5 实现座位新增、删除、编辑和实付价实时计算。
- [x] D4.6 实现发布前本地校验。
- [x] D4.7 实现建车发布编排：创建session、创建座位、发布session。
- [x] D4.8 发布成功后跳转车详情页。
- [x] D4.9 新增D4烟测脚本并纳入 `package.json`。
- [x] D4.10 执行自动验收和微信开发者工具验证。

## D4验收

- [x] D4 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D4 design 已落地到 [design.md](./design.md)。
- [x] D4 tasks 已落地到本文件。
- [x] 车头能选择 active 店家和剧本。
- [x] 车头能填写基础信息。
- [x] 车头能从剧本模板生成座位。
- [x] 车头能编辑座位和补贴。
- [x] 补贴合计不为0时不能发布。
- [x] 实付价小于0时不能发布。
- [x] 发布成功后进入车详情页。
- [x] `npm run check` 通过。
- [x] `npm run d4:smoke` 通过。
- [x] `npm run build:mp-weixin` 通过。
- [x] 微信开发者工具验证通过。

## 验证记录

- `npm run check`：通过。
- `npm run d4:smoke`：通过，发布5座招募中车，验证负实付和补贴不配平会被拒绝。
- `npm run build:mp-weixin`：通过。
- 微信开发者工具 Stable 2.01.2510290：通过。完成微信登录、进入建车页、选择D4测试店、使用D4测试本座位模板、补贴合计¥0、发布成功并跳转 `pages/session/detail`；详情页展示招募中状态、5个开放座位、情感沉浸位¥780、4个F4位各¥530。控制台未出现业务 error，剩余为开发者工具自身 warning。
