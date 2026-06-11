# D7 Requirements: 分享与埋点

更新日期：2026-06-12

## Requirements

### Requirement 1: 微信分享

1. WHEN 车头点击分享 THEN 页面 SHALL 使用 `open-type="share"` 和 `onShareAppMessage`。
2. WHEN 玩家从分享路径进入 THEN 系统 SHALL 打开对应车详情。
3. WHEN 专属座位路径带 `seatId` THEN 页面 SHALL 定位或预选该座位。

### Requirement 2: 招募文案

1. WHEN 车头点击复制文案 THEN 系统 SHALL 生成不含联系方式和现金奖励的招募文案。
2. WHEN 文案包含高风险词 THEN 系统 SHALL 提示改写或阻止复制。

### Requirement 3: 埋点

1. WHEN 分享页打开 THEN 系统 SHALL 记录 view 事件。
2. WHEN 报名成功 THEN 系统 SHALL 记录 convert 事件。
3. WHEN 统计展示 THEN 系统 SHALL 展示浏览数和申请数。
4. WHEN 分享次数增加 THEN 系统 SHALL NOT 兑换权益、补贴、现金、优先锁座或抽奖机会。

### Requirement 4: D7交付物

1. WHEN D7完成 THEN SHALL 完成分享卡片、复制文案、基础统计。
2. WHEN D7完成 THEN SHALL 通过D7烟测、合规检查和微信开发者工具验证。
