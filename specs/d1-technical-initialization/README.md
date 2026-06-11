# D1 Technical Initialization Spec

更新日期：2026-06-11

本目录是D1阶段的开发规格源。D1目标是完成微信小程序、Node.js API、MySQL、Redis、Docker和基础开发配置的可运行初始化，为D2身份权限与数据模型开发提供稳定底座。

## Spec文件

- [requirements.md](./requirements.md)：D1需求与验收条款。
- [design.md](./design.md)：工程结构、运行方式、接口和环境设计。
- [tasks.md](./tasks.md)：D1执行任务与完成状态。

## D1冻结目标

```text
apps/miniprogram 可作为微信小程序空壳打开
apps/api 可启动并提供健康检查和开发登录接口
MySQL 可连接并执行一次空迁移
Redis 随 docker-compose 提供但不作为事实来源
Dockerfile 与 docker-compose.yml 可用于本地容器化启动
BOOTSTRAP_ADMIN_OPENIDS 可初始化系统管理员角色
```

D1不创建业务表，不实现建车、报名、审核、锁座等业务接口；这些进入D2-D6。
