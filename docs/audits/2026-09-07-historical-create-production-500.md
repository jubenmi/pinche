# 历史补录创建 500：线上只读诊断

2026-09-07 北京时间约 14:15–14:25。用户反馈体验版点击“创建历史补录”，按钮变为“创建中...”，随后显示 `Internal server error`，没有新增车。

## 已确认的线上证据

- Portainer `local` 环境的 `pinche-api-1` 容器创建于 2026-08-01 15:22:49，镜像固定为 `hkccr.ccs.tencentyun.com/murder/pinche@sha256:12917079f4f8bbb00d720ed1ec90a3bbbf9cbd762e1194a392438976babfe79d`，并非今天 CI 发布的新镜像。
- API 日志多次记录 `POST /api/sessions status=500`。样例请求 ID：`8752fb2e-84b5-4698-b342-fa1f35101144`（273.09 ms）、`9d940340-ea81-4d19-b96e-ed0a710239f9`（259.05 ms）、`14d0658f-fabe-4715-9b89-0c30b2f067c8`（239.08 ms）。失败发生在初始建车接口，尚未到成功后的跳转。
- 通过容器内只读文件检查，运行中的 `createSession` 把 `requireValue(body, "startAt")` 直接作为 `sessions.start_at` 的 SQL 参数；INSERT 没有 `session_purpose`。运行镜像 migrations 目录的后段只有 0033–0035，没有历史补录的 0036、0037。
- 通过现有应用数据库连接执行只读 information_schema 查询：`sessions` 存在 `creation_idempotency_key`、`start_at`，不存在 `session_purpose`；不存在 `historical_session_creation_operations` 表。
- 数据库版本为 `8.0.30-cynos-3.1.17.002`。只读 `SELECT CAST(? AS DATETIME)` 使用体验版同类时间格式 `2020-07-30T11:30:00.000Z` 后，`SHOW WARNINGS` 返回 Warning 1292：`Truncated incorrect datetime value`。这是格式不兼容证据；该查询并非失败请求的 INSERT，不把警告冒充已捕获的 INSERT 异常堆栈。

## 结论与修复落点

当前体验版与运行中的旧 API、旧数据库结构不匹配。CI 推送镜像没有自动替换固定旧 digest 的生产容器。创建路径的原生登录按钮为“登录/取消”，手机号面板是自定义组件；此次服务端 500 与原生弹窗按钮字数无关。

应从已经通过 develop/main/publish CI 的同一版本执行配套数据库迁移，并更新实际 API 和需要同步的审核服务，再验收真实体验版的历史补录创建、角色初始化、发布和详情跳转。上线前核对所有待执行迁移，而非仅凭 `/health` 的旧版 schemaReady 判断新功能就绪。只更新体验版无法补齐服务端能力。

本次没有修改生产数据、执行迁移、重启或替换生产容器，也没有为错误做未经验证的源码修改。现有统一错误日志没有原始异常堆栈，因此未声称捕获到那次 INSERT 的确切底层异常。

## 本地回归

基于 develop `e4b74f5a99912a5903c3f790ca7529c14b3bc9fa`，重新运行：

```sh
node --test apps/miniprogram/test/sessionSetupNavigation.test.mjs apps/miniprogram/test/sessionSetupTime.test.mjs apps/api/test/historical-session-migration.test.mjs apps/api/test/historical-session-service.test.mjs
```

结果：203 通过，0 失败，0 跳过。日志：`/tmp/pinche-create-500-regression.log`。该结果验证当前仓库相关回归，不代表生产旧镜像已修复。
