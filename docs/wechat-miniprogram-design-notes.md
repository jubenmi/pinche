# 微信小程序实现约束与设计修正

更新日期：2026-06-11

本文把微信小程序官方能力和审核约束落到情感本拼车MVP设计里。后续开发以本文为平台层准则，避免把H5、App或纯社群工具的逻辑直接套到小程序。

更完整的规则避雷清单见：[微信小程序合规护栏](./wechat-compliance-guardrails.md)。

## 1. 本次查阅的官方文档

- [小程序平台运营规范](https://developers.weixin.qq.com/miniprogram/product/)：包含滥用分享、红包类账号、隐私、内容安全、订阅消息、交易争议等运营规则。
- [常见拒绝情形](https://developers.weixin.qq.com/miniprogram/product/reject.html)：包含账号信息、服务类目、诱导行为、隐私数据、可用性等审核拒绝原因。
- [小程序登录](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/login/wx.login.html)：`wx.login` 获取临时登录凭证，服务端换取 `openid`、`unionid`、`session_key`。
- [小程序转发](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/share.html)：通过 `button open-type="share"` 触发 `onShareAppMessage`，可结合 `shareTicket` 识别群转发场景。
- [用户隐私保护](https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/)：涉及个人信息处理时，需要补充并提交小程序用户隐私保护指引。
- [手机号快速验证](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html)：通过 `button open-type="getPhoneNumber"` 在用户同意后获取动态 `code`，服务端换取手机号。
- [订阅消息](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message.html)：通过 `wx.requestSubscribeMessage` 在具体业务场景向用户请求订阅。
- [发布流程](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/release.html)：开发版、体验版、审核版、线上版；发布路径为预览、上传代码、提交审核、发布。
- [全局配置](https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/app.html)：`app.json` 配置页面、窗口、网络超时等基础能力。

## 2. 对产品设计的关键修正

### 登录

MVP只做微信静默登录和服务端会话：

```text
小程序调用 wx.login
  -> 后端用 code 换 openid
  -> 后端创建或更新 User
  -> 后端签发业务 session token
  -> 小程序只保存业务 token
```

约束：

- `wx.login` 返回的 `code` 有有效期，必须尽快发给后端。
- `session_key` 不下发到小程序端，也不用于业务身份标识。
- 用户主键使用服务端生成的 `user.id`，微信身份用 `open_id` 绑定。
- 昵称、头像、联系方式都不作为登录前置条件。

### 手机号与联系方式

MVP不在浏览车详情时强制收手机号，只在用户申请上车或车头需要联系时触发。

推荐流程：

```text
用户点“提交申请”
  -> 展示联系方式用途
  -> 用户选择微信手机号授权或手动填写微信号/手机号
  -> 后端加密存储联系方式
```

约束：

- `getPhoneNumber` 必须由用户点击按钮触发。
- 手机号授权返回的是动态 `code`，需要后端调用接口换取手机号。
- 手机号授权 `code` 与 `wx.login` 的登录 `code` 不是同一个东西，不能混用。
- 手动联系方式要作为兜底方案，避免因手机号能力、主体资质或费用问题卡住MVP。

### 分享

MVP分享以“车详情页”为核心，不做诱导分享。

推荐能力：

```text
button open-type="share"
Page.onShareAppMessage
自定义 title
自定义 path
自定义 imageUrl
复制招募文案
分享海报
```

分享路径建议：

```text
/pages/session/detail?id={sessionId}&shareCode={shareCode}
/pages/session/detail?id={sessionId}&shareCode={shareCode}&seatId={seatId}
```

约束：

- 分享必须是用户主动点击触发，不把“分享后解锁”“强制分享得奖励”作为MVP能力。
- 分享次数不兑换现金、红包、补贴、优先锁座、信用分、抽奖机会或其他权益。
- 自定义分享图要避免出现手机号、微信号、真实姓名、押金转账信息等个人信息。
- 群分享可以尝试记录 `shareTicket`，但MVP不能把业务闭环依赖在 `shareTicket` 上。
- 朋友圈优先用海报和小程序码承接；小程序卡片分享优先服务微信群和私聊。

### 订阅消息

订阅消息只在用户已经发生明确动作后请求：

```text
申请上车后：订阅“申请审核结果”
锁座成功后：订阅“开车前提醒”
车头发布后：订阅“新申请提醒”
```

约束：

- 不在首页或冷启动时向用户批量索要订阅。
- 不用现金、补贴、权益诱导用户订阅或点击订阅消息。
- 用户拒绝订阅时，主流程仍然可继续。
- 订阅结果要记录，用于判断是否需要站内提示或复制联系车头。

### 隐私与审核

MVP涉及的个人信息包括：

```text
openid
昵称
头像
手机号或微信联系方式
报名备注
边界备注
押金状态
分享来源
```

开发要求：

- 隐私协议中明确收集目的：登录识别、报名联系、车头审核、押金状态记录、分享转化统计。
- 只在必要页面展示联系方式，默认对非车头隐藏。
- 审核前确保隐私保护指引与实际调用的隐私接口一致。
- 不上传剧本正文、剧透角色内容或现实陪伴承诺。
- 发布前按官方运营规范重新检查一次，因为运营规范是动态文档。

## 3. MVP页面与 `app.json`

MVP页面建议压到6个：

```text
pages/index/index
pages/session/create
pages/session/detail
pages/session/apply
pages/session/manage
pages/mine/index
```

可选法律页面：

```text
pages/legal/privacy
pages/legal/agreement
```

全局配置建议：

```json
{
  "pages": [
    "pages/index/index",
    "pages/session/create",
    "pages/session/detail",
    "pages/session/apply",
    "pages/session/manage",
    "pages/mine/index"
  ],
  "window": {
    "navigationBarTitleText": "拼车发车",
    "navigationBarBackgroundColor": "#ffffff",
    "navigationBarTextStyle": "black"
  },
  "networkTimeout": {
    "request": 10000
  }
}
```

MVP可以先只做“首页 + 我的”两个底部入口，也可以不做 `tabBar`，让用户主要从分享路径进入车详情页。若做 `tabBar`，只放：

```text
首页
我的
```

## 4. 数据模型修正

在原MVP表基础上增加或调整这些字段。

### users

```text
id
open_id
union_id
nickname
avatar_url
phone_encrypted
phone_verified_at
created_at
updated_at
```

### share_events

```text
id
session_id
inviter_user_id
share_code
share_scene: group | direct | poster | copy_text | unknown
share_ticket_hash
path
seat_id
viewed_user_id
converted_signup_id
created_at
```

### subscription_requests

MVP可选，但建议预留：

```text
id
user_id
template_key
business_type: signup_result | start_reminder | new_signup
business_id
status: accepted | rejected | failed
created_at
```

## 5. 发布前技术清单

- 小程序账号和 AppID 可用。
- 开发者、体验成员配置完成。
- 服务器域名、接口域名、HTTPS证书配置完成。
- `wx.login` 登录链路在开发版、体验版都能跑通。
- 分享卡片路径能从微信群和私聊打开到指定车。
- 自定义分享图不泄露个人信息。
- 手机号授权不是浏览、建车、看详情的强制前置条件。
- 隐私保护指引与实际接口调用一致。
- 体验版二维码给真实车头和玩家跑完整链路。
- 提审前至少完成 iOS 微信和 Android 微信主流程测试。
