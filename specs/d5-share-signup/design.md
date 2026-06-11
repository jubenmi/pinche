# D5 Design: 分享页与玩家报名设计

更新日期：2026-06-12

## Flow

```text
GET /api/sessions/:id
  -> 展示车详情与座位
  -> 选择座位
  -> 登录或复用登录态
  -> POST /api/signups
  -> 可选 POST /api/subscriptions/request-result
```

## Page Scope

- `pages/session/detail`：公开车详情和座位列表。
- `pages/session/apply`：选择座位、填写联系方式和申请备注。

## Privacy

- 公开页不展示报名人的联系方式、微信号、真实姓名。
- 联系方式只提交给报名接口，D6仅车头可查看。

## Compliance

- 不把分享作为报名前置条件。
- 不使用红包、返现、邀请奖励文案。
- 订阅消息只用于业务提醒，拒绝后不阻断报名。
