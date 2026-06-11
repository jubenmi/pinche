# D5 Requirements: 分享页与玩家报名

更新日期：2026-06-12

## Introduction

D5实现车详情/分享页和玩家申请上车。D5不做车头审核和锁座，那属于D6。

## Requirements

### Requirement 1: 车详情展示

1. WHEN 用户打开车详情页 THEN 系统 SHALL 展示本名、店家、时间、DM/NPC快照、押金、车状态。
2. WHEN 用户查看座位 THEN 系统 SHALL 展示座位名、类型、原价、调整、实付价、状态。
3. WHEN 座位状态不是 `open` 或 `applied` THEN 页面 SHALL 不允许对该座位发起新申请。

### Requirement 2: 玩家申请

1. WHEN 未登录用户点击申请 THEN 系统 SHALL 引导登录，登录拒绝时不提交申请。
2. WHEN 玩家选择开放座位并填写申请信息 THEN 系统 SHALL 创建 `pending` 报名。
3. WHEN 玩家拒绝手机号授权 THEN 页面 SHALL 支持手动联系方式继续申请。
4. WHEN 申请成功 THEN 座位 SHALL 显示待审核状态。
5. WHEN 重复申请同一座位 THEN 系统 SHALL 返回冲突提示。

### Requirement 3: 订阅消息请求

1. WHEN 申请成功 THEN 页面 MAY 请求“审核结果提醒”订阅。
2. WHEN 用户拒绝订阅 THEN 主流程 SHALL 继续。
3. WHEN 订阅请求完成 THEN 系统 SHALL 记录请求结果。

### Requirement 4: D5交付物

1. WHEN D5完成 THEN SHALL 产出D5 requirements、design、tasks。
2. WHEN D5完成 THEN SHALL 完成车详情页。
3. WHEN D5完成 THEN SHALL 完成申请上车页和报名接口联调。
4. WHEN D5完成 THEN SHALL 通过D5烟测和微信开发者工具验证。
