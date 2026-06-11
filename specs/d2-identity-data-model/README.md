# D2 Identity and Data Model Spec

更新日期：2026-06-11

本目录是D2阶段的开发规格源。D2目标是在D1技术底座上实现身份、权限、核心数据库表、基础CRUD接口和关键事务，为D3管理员资料录入与D4建车流程提供可用API。

## Spec文件

- [requirements.md](./requirements.md)：D2需求与验收条款。
- [design.md](./design.md)：数据模型、权限模型、接口和事务设计。
- [tasks.md](./tasks.md)：D2执行任务与完成状态。

## D2冻结目标

```text
微信登录写入 users / user_roles
业务 token 可校验并返回当前用户
system_admin 才能录入店家和剧本
普通用户只能查看公开资料、提交资料申请和报名
车头只能管理自己的车、座位和报名
核心数据表完成迁移
基础 CRUD 接口可调用
发布车时校验补贴配平
审核报名通过、锁座走事务
```

D2不实现完整小程序页面交互，不实现微信支付、现金红包、复杂后台、推荐算法或评价体系。
