# D9 Spec: 发布MVP

更新日期：2026-06-13

D9目标是完成单台服务器 Docker Compose 生产部署、微信小程序生产构建、上传体验版、提交审核并发布MVP。

生产拓扑固定为一台可运行 Docker Compose 的服务器，API 镜像由 GitHub Actions 发布到 Tencent Cloud Container Registry：

```text
GitHub Actions
  -> hkccr.ccs.tencentyun.com/murder/pinche
HTTPS API域名
  -> 反向代理/证书
  -> api:3018
  -> mysql:3306
  -> redis:6379
```

上传代码、设置体验版、提交审核、发布线上版需要用户登录微信开发者工具或小程序后台确认。真实密钥、密码、OpenID 等敏感值不写入仓库；执行到对应步骤时再由用户提供。

## Spec文件

- [Requirements](./requirements.md)
- [Design](./design.md)
- [Tasks](./tasks.md)
- [Release Checklist](./release-checklist.md)
- [Release Inputs](./release-inputs.md)
- [Release Handoff](./handoff.md)
- [Review Materials](./review-materials.md)
