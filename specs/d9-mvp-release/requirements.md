# D9 Requirements: 发布MVP

更新日期：2026-06-12

## Requirements

### Requirement 1: 生产环境

1. WHEN 发布前 THEN API Docker镜像 SHALL 可构建并可重启恢复。
2. WHEN 发布前 THEN 生产MySQL迁移 SHALL 已执行。
3. WHEN 发布前 THEN HTTPS API域名 SHALL 配置到小程序合法服务器域名。
4. WHEN 发布前 THEN `/health` 和 `/health/db` SHALL 在线上返回成功。

### Requirement 2: 小程序提审材料

1. WHEN 提审前 THEN SHALL 准备小程序名称、头像、简介、类目、隐私保护指引、用户协议和审核说明。
2. WHEN 提审前 THEN 审核账号 SHALL 可体验管理员录入、建车、报名、审核、分享主链路。
3. WHEN 提审前 THEN SHALL 准备iOS和Android主链路截图或录屏。

### Requirement 3: 上传与审核

1. WHEN 需要上传代码 THEN SHALL 暂停并请用户协助微信开发者工具登录/确认上传。
2. WHEN 上传成功 THEN SHALL 设置体验版并完整测试。
3. WHEN 体验版通过 THEN SHALL 提交审核。
4. WHEN 审核通过 THEN SHALL 发布线上版。

### Requirement 4: D9交付物

1. WHEN D9完成 THEN SHALL 有发布检查记录、版本号、体验版二维码、审核说明和线上健康检查记录。
