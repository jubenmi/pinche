# D40 Requirements: 游客日历首页与发车后隐私

更新日期：2026-07-10

## Overview

D40 解决微信审核指出的首页登录规范问题。小程序启动后不再先显示“发起第一辆车”引导页，也不得在用户浏览首页时要求授权登录。未登录和已登录用户使用同一个日历首页与同一个 `SessionCalendar` 组件，仅根据身份切换文案、数据源和操作权限。

游客可以浏览真实、公开、尚未发车且仍在招募的车局，并进入公开只读详情。读取公开信息不要求登录；创建、上车、联系、分享、聊天、相册、管理等写入或身份相关能力只在用户主动点击后请求登录。

车局发车后转为车内相册，不再属于公开发现内容。普通详情链接不得向游客或非成员返回发车后的车局及相册信息；完整相册继续只对车头、已上车成员、管理员或现有分享机制明确授权的范围开放。

## Scope

包含：

- 删除首页“发起第一辆车”独立状态，始终进入日历。
- 同一个日历组件支持游客和已登录两个状态。
- 新增无需登录的近期公开车局接口。
- 游客车卡进入现有详情页的公开只读模式。
- 按读取、写入和身份需求划分登录边界。
- 发车后从公开列表移除，并收紧普通详情接口权限。
- 保持 D23 相册分享和 D39 同城只读规则，补足服务端授权边界。
- 自动检查、后端烟测、小程序构建及微信开发者工具验收。

不包含：

- 新建游客专用首页或游客专用详情页。
- 更改现有日历视觉布局、时间轴、车卡、日期选择器或归档按钮位置。
- 向游客申请位置权限或提供同城定位。
- 展示已发车、已结束、已满、取消、私密或测试车局来补足数量。
- 扩大相册公开范围或绕过 D23 相册隐私设置。

## Requirements

### Requirement 1: 所有用户直接进入日历首页

1. WHEN 小程序首页加载且后端可用 THEN 页面 SHALL 直接渲染现有日历界面。
2. WHEN 用户未登录 THEN 首页 SHALL NOT 渲染“发起第一辆车”独立界面。
3. WHEN 已登录用户没有自己的车局或报名 THEN 首页 SHALL 继续渲染日历空状态。
4. WHEN 游客近期列表为空 THEN 首页 SHALL 显示“暂无近期车局”的日历空状态。
5. WHEN 首页加载、公共列表加载或公共详情加载 THEN 系统 SHALL NOT 主动发起微信登录授权。
6. WHEN 登录过期 THEN 首页 SHALL 切换为游客日历并加载近期车局，SHALL NOT 回到旧引导页。

### Requirement 2: 同一界面支持两个认证状态

1. WHEN 用户已登录 THEN 主按钮 SHALL 显示“我的车局（点击创建）”。
2. WHEN 用户未登录 THEN 主按钮 SHALL 显示“我的车局（点击登录）”。
3. WHEN 用户已登录 THEN 日历筛选 SHALL 显示“我的 / 同城”。
4. WHEN 用户未登录 THEN 原筛选区域 SHALL 显示单项“近期车局 N”。
5. WHEN 用户未登录 THEN `N` SHALL 等于本次公共接口实际返回并展示的车局数量，最大为 20。
6. WHEN 认证状态切换 THEN 页面 SHALL 复用现有身份栏、主按钮、车包按钮、筛选区、归档、日期、时间轴和车卡布局。
7. WHEN 用户在游客状态点击主按钮 THEN 系统 SHALL 请求登录。
8. WHEN 主按钮登录成功 THEN 用户 SHALL 留在首页，按钮 SHALL 变为“我的车局（点击创建）”，系统 SHALL NOT 自动打开创建页。
9. WHEN 游客点击车包或归档等依赖个人身份的数据域 THEN 系统 SHALL 在点击后请求登录。
10. WHEN 游客使用日期选择、展开日期、折叠日期或刷新近期车局 THEN 系统 SHALL NOT 请求登录。

### Requirement 3: 近期车局只包含可公开浏览的真实招募

1. WHEN 公共近期接口查询车局 THEN SHALL 只返回 `visibility = public` 的车局。
2. WHEN 公共近期接口查询车局 THEN SHALL 只返回 `status = recruiting` 的车局。
3. WHEN 公共近期接口查询车局 THEN SHALL 只返回 `start_at > CURRENT_TIMESTAMP` 的车局。
4. WHEN 公共近期接口查询车局 THEN 每辆车 SHALL 至少有一个 `status = open` 的座位或可公开申请的开放 NPC 角色。
5. WHEN 候选车局排序 THEN SHALL 按 `start_at ASC, id ASC` 排序。
6. WHEN 请求数量未提供或大于 20 THEN 接口 SHALL 最多返回 20 辆。
7. WHEN 候选不足 5 辆 THEN 接口 SHALL 返回实际数量，SHALL NOT 用已发车或已结束车局补齐。
8. WHEN 车局已满、取消、私密、仅分享可见、已经发车或开本时间已过 THEN SHALL NOT 出现在近期车局。
9. WHEN 自动化测试创建车局 THEN 测试 SHALL 使用隔离数据库；任何必须存在生产库的验收车局 SHALL 使用 `share_only`，不得进入公共近期列表。
10. WHEN 公共近期接口返回卡片 THEN SHALL NOT 返回手机号、微信标识、报名备注、内部备注、精确用户位置或成员隐私字段。

### Requirement 4: 游客可以读取公开卡片和只读详情

1. WHEN 游客点击近期车卡 THEN 页面 SHALL 打开现有 `/pages/session/detail` 并携带 `entry=guest`。
2. WHEN `entry=guest` 加载公开、招募中且未发车车局 THEN 页面 SHALL 展示公开只读详情且不要求登录。
3. WHEN 游客浏览详情 THEN SHALL 允许读取剧本、店家公开信息、开本时间、招募状态、座位或 NPC 开放状态及公开记录。
4. WHEN 游客浏览详情 THEN SHALL NOT 返回或展示手机号、微信标识、报名备注、车头内部备注或完整成员身份数据。
5. WHEN 游客点击需要写入或身份的详情动作 THEN 系统 SHALL 显示与动作匹配的登录提示。
6. WHEN 用户取消登录 THEN 页面 SHALL 保留当前详情和滚动位置，继续允许只读浏览。
7. WHEN 用户登录成功 THEN 页面 SHALL 刷新访问能力；任何写入动作 SHALL 仍由用户再次确认，SHALL NOT 因登录成功自动提交。
8. WHEN `entry=city` 加载 THEN D39 的“同城仅供浏览、不可分享和不可直接上车”规则 SHALL 保持不变。

### Requirement 5: 登录只用于写入或身份相关能力

1. WHEN 用户仅浏览首页、车卡、日期、公开详情或公开记录 THEN 系统 SHALL NOT 请求登录。
2. WHEN 用户请求创建、上车、退出、报名、联系店家、分享、聊天、相册、管理、删除、上传或编辑 THEN 系统 SHALL 要求登录或验证已有身份。
3. WHEN 登录提示显示 THEN 文案 SHALL 说明当前动作，例如“登录后可创建车局”或“登录后可上车”。
4. WHEN 登录失败或取消 THEN 系统 SHALL NOT 清空公共列表、跳离当前页面或执行目标写入。
5. WHEN 已登录用户执行动作 THEN 后端 SHALL 继续按现有角色、成员、报名、手机号和车局策略校验，前端登录状态 SHALL NOT 代替服务端授权。

### Requirement 6: 发车后转为私密相册

1. WHEN `start_at <= CURRENT_TIMESTAMP` 或车局状态不再是 `recruiting` THEN 车局 SHALL 立即失去普通公共预览资格。
2. WHEN 车局发车 THEN SHALL 从游客“近期车局”和已登录“同城”发现结果中移除。
3. WHEN 游客或非成员通过普通 `/api/sessions/:id` 链接访问已发车车局 THEN 后端 SHALL 返回不可枚举的未找到响应，SHALL NOT 返回车局、座位、成员或相册信息。
4. WHEN 已登录车头、已上车成员或管理员访问已发车车局 THEN 后端 SHALL 按现有成员权限返回车局和完整相册入口。
5. WHEN 页面已缓存公开详情且车局随后发车 THEN 下一次刷新、回到前台或执行动作 SHALL 重新校验服务端权限并清除不再授权的公开数据。
6. WHEN 车局已发车 THEN 普通详情响应 SHALL NOT 因客户端携带 `entry=guest`、`entry=city` 或可猜测的车局 ID 而扩大权限。

### Requirement 7: 分享授权不能扩大完整相册权限

1. WHEN D40 实现 THEN D23 好友或群聊分享、朋友圈只读相册和 D39 同城只读行为 SHALL 保持兼容。
2. WHEN 外部用户通过好友或群聊分享进入已发车车局 THEN 服务端 SHALL 校验不可伪造、绑定车局和用途且具有有效期的邀请凭证。
3. WHEN 请求仅携带现有分析用途的 `shareCode` 或可猜测车局 ID THEN 服务端 SHALL NOT 将其视为访问授权。
4. WHEN 邀请凭证有效 THEN SHALL 只允许加载上车所需的邀请预览；在用户确认上车前 SHALL NOT 授予完整相册权限。
5. WHEN 用户通过分享成功成为车内成员 THEN 完整相册权限 SHALL 继续由现有座位或 NPC 成员关系授予。
6. WHEN 朋友圈相册 token 有效 THEN SHALL 只返回 D23 token 明确授权且符合成员隐私设置的照片。
7. WHEN 邀请或相册 token 无效、过期、用途不匹配或车局不匹配 THEN 后端 SHALL 拒绝访问。

### Requirement 8: 错误处理与维护状态

1. WHEN 公共近期接口失败 THEN 首页 SHALL 保留日历结构并显示错误和重试入口，SHALL NOT 弹登录。
2. WHEN 公共详情因车局刚发车而失去权限 THEN 页面 SHALL 显示“车局已发车，仅同车成员可查看”的安全提示，SHALL NOT 展示缓存详情。
3. WHEN 后端处于维护状态 THEN 现有维护页 SHALL 保持可用。
4. WHEN 维护恢复 THEN 页面 SHALL 根据当前认证状态进入游客近期日历或已登录日历。
5. WHEN 线上小程序构建 THEN API 基地址 SHALL 固定为 `https://api.pinche.jubenmi.com`，SHALL NOT 回退到 localhost。

### Requirement 9: 自动验证与交付

1. WHEN D40 spec 完成 THEN SHALL 产出 `requirements.md`、`design.md` 和 `tasks.md`。
2. WHEN D40 实现开始 THEN SHALL 先增加会因功能缺失而失败的静态检查和后端烟测。
3. WHEN 后端烟测运行 THEN SHALL 覆盖游客无需 token、候选资格矩阵、20 条上限和发车后权限。
4. WHEN 小程序检查运行 THEN SHALL 验证旧 `first-session` 分支已删除、两个状态文案正确且首页加载不调用登录。
5. WHEN 权限检查运行 THEN SHALL 验证普通详情、成员详情、邀请预览和相册 token 的权限边界。
6. WHEN `npm run check` 运行 THEN SHALL 包含 D40 检查并通过。
7. WHEN `npm run build:mp-weixin` 运行 THEN SHALL 成功生成微信小程序产物。
8. WHEN 微信开发者工具验收 THEN SHALL 覆盖未登录启动、只读浏览、登录取消、登录成功、写入二次确认和发车后不可见。
