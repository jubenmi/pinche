# D39 Requirements: 同城车局只读预览

更新日期：2026-07-10

## Overview

D39 将“同城”定义为发现和浏览入口，而不是上车入口。用户从首页“同城”标签点击车卡后，可以查看车局、店家、时间、座位、NPC 和车友记录，但不能在该页面选择角色、申请上车、分享、管理、进入聊天或执行其他成员动作。

上车入口保持为现有分享卡片。用户收到店家或车友分享的车局卡片并进入 `/pages/session/share` 后，继续按现有登录、手机号、审核和直接上车规则操作。

## Scope

包含：

- 同城车卡跳转时标记 `entry=city`。
- 详情页识别同城只读上下文。
- 同城详情展示只读提示和公开信息。
- 隐藏页面内分享和系统分享菜单。
- 隐藏或禁用所有上车、管理、相册、记录和聊天入口。
- 保持现有分享页及其上车规则不变。
- 自动检查和微信小程序构建验证。

不包含：

- 服务端签名邀请凭证。
- 修改报名、抢座或审核 API。
- 新建独立同城详情页。
- 向同城发现接口暴露店家私密联系方式。
- 修改同城候选资格或排序规则。

## Requirements

### Requirement 1: 同城入口携带明确来源

1. WHEN 用户点击同城车卡 THEN 小程序 SHALL 打开 `/pages/session/detail`。
2. WHEN 同城车卡生成详情 URL THEN SHALL 携带 `entry=city`。
3. WHEN “我的”车卡打开分享页、相册或管理页 THEN SHALL 保持现有跳转不变。

### Requirement 2: 同城详情只允许浏览

1. WHEN 详情页收到 `entry=city` THEN SHALL 进入只读预览状态。
2. WHEN 同城只读预览渲染 THEN SHALL 展示明确提示：“同城发现仅供浏览。请先联系店家；收到店家或车友分享卡片后可选择角色上车。”
3. WHEN 同城只读预览渲染 THEN SHALL 继续展示车局基础信息、店家地址、地图入口、时间、座位、NPC 和车友记录。
4. WHEN 同城只读预览渲染 THEN SHALL NOT 展示“选择角色”“分享”“分享此位”“车头管理”“相册”“写记录”等动作。
5. WHEN 同城只读预览渲染 THEN SHALL NOT 渲染车内聊天入口。
6. WHEN 用户点击同城详情中的座位或 NPC THEN SHALL NOT 跳转分享页或发起上车请求。
7. WHEN 同城详情加载 THEN SHALL NOT 调用成员关系恢复接口。

### Requirement 3: 同城详情不可分享

1. WHEN 同城详情加载 THEN 小程序 SHALL 调用 `uni.hideShareMenu`。
2. WHEN 隐藏系统分享菜单 THEN SHALL 同时覆盖好友分享和朋友圈分享入口。
3. WHEN 普通详情页加载 THEN SHALL 保持现有分享行为。

### Requirement 4: 分享卡片仍可上车

1. WHEN 用户通过现有分享卡片进入 `/pages/session/share` THEN SHALL 保持现有选角色流程。
2. WHEN 分享页提交上车 THEN SHALL 继续按 `join_policy` 调用直接认领或报名审核接口。
3. WHEN 实现 D39 THEN SHALL NOT 修改分享页上车请求协议。

### Requirement 5: 自动验证

1. WHEN 运行 D39 检查 THEN SHALL 验证同城跳转包含 `entry=city`。
2. WHEN 运行 D39 检查 THEN SHALL 验证只读提示、系统分享关闭、操作隐藏和事件防护。
3. WHEN 运行 D39 检查 THEN SHALL 验证分享页仍包含上车实现。
4. WHEN 运行 `npm run check` THEN SHALL 包含 D39 检查。
5. WHEN 运行 `npm run build:mp-weixin` THEN SHALL 成功生成微信小程序产物。
