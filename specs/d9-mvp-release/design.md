# D9 Design: 发布MVP设计

更新日期：2026-06-12

## Release Flow

```text
API production env
  -> migrate
  -> health check
  -> build mp-weixin
  -> 微信开发者工具上传
  -> 设置体验版
  -> 体验测试
  -> 提交审核
  -> 发布
```

## Human Handoff

需要用户协助的点：

- 微信开发者工具登录。
- 上传代码确认。
- 小程序后台类目、隐私、服务器域名、体验成员和提审确认。
- 审核通过后的发布确认。

## Stop Condition

开发可推进到“需要上传代码”前。到上传时暂停，请用户操作或授权共同操作。
