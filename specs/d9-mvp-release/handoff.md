# D9 Upload Handoff

更新日期：2026-06-12

当前已经推进到“需要上传代码前”的交接点。

## 需要用户提供

- 生产 HTTPS API 域名。
- 微信小程序后台登录确认。
- 微信开发者工具上传确认。
- 体验版二维码生成后的真机测试反馈。

## 我可以继续协助

在你提供生产 API 域名后，可以继续执行：

```bash
VITE_API_BASE_URL=<生产API域名> npm run build:mp-weixin
RELEASE_API_BASE_URL=<生产API域名> npm run d9:release-check
```

然后在微信开发者工具里上传 `apps/miniprogram/dist/build/mp-weixin`。

## 上传后检查

- 体验版二维码可打开。
- 首页可进入“我的”“建车”。
- 管理员资料页可打开。
- 建车、发布、分享、申请、审核、锁座主链路可跑通。
- 体验版中没有 `127.0.0.1` 请求。
- iOS微信和Android微信至少各跑一次主链路。
