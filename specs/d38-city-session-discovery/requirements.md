# D38 Requirements: “我的 / 同城”车局发现

更新日期：2026-07-10

## Overview

D38 将首页车局日历的筛选从“全部 / 发起”重构为职责清晰的“我的 / 同城”。“我的”继续用于管理当前用户发起或报名的车局；“同城”用于发现其他账号发布、尚未开本且当前仍可报名的车局。

“同城”不是对当前账号数据做前端过滤。系统新增独立的发现接口，按车局店家城市、开本时间、招募状态、剩余空位和同城可见设置筛选候选车局。用户位置仅用于识别城市和同日距离排序，不保存到服务端。定位不可用且没有有效缓存时，页面显示授权提示，并退化为按开本时间展示最近 5 辆可报名车局。

## Scope

包含：

- 车局日历标签改为“我的 / 同城”，且只保留这两个标签。
- 新增需要登录的同城车局发现接口。
- 复用 `sessions.visibility` 表达“同城展示”与“仅分享可见”。
- 新建车局增加“同城展示”开关，默认开启。
- 小程序按需读取用户 GCJ-02 位置，并本地缓存最近一次成功城市和坐标。
- 服务端使用腾讯逆地址解析优先、高德逆地址解析兜底识别当前城市。
- 定位失败或拒绝时显示授权提示，并展示按开本时间最近的 5 辆候选车局。
- 同城卡片复用现有车局卡片视觉，但不显示管理或删除动作。
- 自动检查、后端烟测、小程序构建和微信开发者工具验证。

不包含：

- 个性化推荐分、兴趣画像或机器学习排序。
- 全国城市选择器或手动切换城市。
- 对用户位置做服务端持久化。
- 自动公开历史 `share_only` 车局。
- 修改车局详情、报名或审核的核心业务规则。
- 为已满车局新增候补名单。

## Requirements

### Requirement 1: “我的”是用户自己的任务日历

**User Story:** 作为已登录用户，我希望“我的”集中展示我发起或已报名的车局，以便继续管理、查看状态和回顾历史。

#### Acceptance Criteria

1. WHEN 车局日历渲染筛选标签 THEN 系统 SHALL 展示“我的”和“同城”。
2. WHEN “我的”处于激活状态 THEN 系统 SHALL 合并当前用户发起的车局和当前有效报名。
3. WHEN 用户发起和报名同一车局 THEN “我的” SHALL 按车局 ID 去重。
4. WHEN “我的”渲染自己发起的车局 THEN SHALL 保留“发起”身份标签和管理动作。
5. WHEN “我的”渲染报名车局 THEN SHALL 保留现有退出或隐藏动作。
6. WHEN 实现 D38 THEN 日历 SHALL NOT 再展示“全部”“发起”或“待处理”筛选标签。
7. WHEN 有待审核报名、草稿或其他待处理状态 THEN SHALL 继续在卡片状态中表达，而不是新增第三个筛选标签。
8. WHEN 页面首次进入已登录日历 THEN 默认筛选 SHALL 为“我的”。
9. WHEN 已登录用户没有任何自己发起或报名的车局 THEN 首页 SHALL 仍展示“我的 / 同城”日历，而不是退回只能创建车局的空白入口。

### Requirement 2: “同城”只展示可行动的新机会

**User Story:** 作为玩家，我希望同城页只出现我现在仍能参加的车局，以免看到已经开本、满员或我已经加入的重复卡片。

#### Acceptance Criteria

1. WHEN 车局状态不是 `recruiting` THEN 同城接口 SHALL NOT 返回该车局。
2. WHEN `start_at <= CURRENT_TIMESTAMP` THEN 同城接口 SHALL NOT 返回该车局。
3. WHEN 车局没有 `status = open` 的可用座位 THEN 同城接口 SHALL NOT 返回该车局。
4. WHEN 车局 `visibility != public` THEN 同城接口 SHALL NOT 返回该车局。
5. WHEN 当前用户是车头 THEN 同城接口 SHALL NOT 返回该车局。
6. WHEN 当前用户对车局存在 `pending` 或 `approved` 报名 THEN 同城接口 SHALL NOT 返回该车局。
7. WHEN 车局满足全部条件 THEN 同城接口 SHALL 返回店家、剧本、开本时间、座位总数、剩余空位数和可选的距离。
8. WHEN 用户点击同城卡片 THEN 小程序 SHALL 打开现有车局详情页。
9. WHEN 同城卡片渲染 THEN SHALL NOT 展示“管理”“删除”或退出动作。

### Requirement 3: 有位置时按同城和距离提供结果

**User Story:** 作为玩家，我希望系统自动识别当前城市，并优先呈现时间合适、距离较近的可报名车局。

#### Acceptance Criteria

1. WHEN 用户首次点击“同城”且没有有效位置缓存 THEN 小程序 SHALL 调用 `uni.getLocation({ type: "gcj02" })`。
2. WHEN 当前定位成功 THEN 小程序 SHALL 把合法纬度和经度发送给同城发现接口。
3. WHEN 服务端收到坐标且没有可信缓存城市 THEN SHALL 先用腾讯逆地址解析识别城市。
4. WHEN 腾讯逆地址解析不可用或失败 THEN 服务端 SHALL 尝试高德逆地址解析。
5. WHEN 城市识别成功 THEN 同城接口 SHALL 只返回 `store.city` 匹配该城市的候选车局。
6. WHEN 同城模式返回多天车局 THEN SHALL 按开本日期从近到远排列。
7. WHEN 同一天有多辆车 THEN SHALL 按店家与用户坐标的距离从近到远排列。
8. WHEN 店家没有完整坐标 THEN 车局 MAY 出现在城市结果中，但 SHALL 排在同日有距离车局之后。
9. WHEN 城市识别成功 THEN 响应 SHALL 返回标准城市名和 `mode = city`。

### Requirement 4: 定位不可用时保持列表有用

**User Story:** 作为拒绝定位或暂时无法定位的玩家，我仍希望看到近期可参加的车局，同时知道开启定位会得到更准确的同城结果。

#### Acceptance Criteria

1. WHEN 用户拒绝位置授权 THEN 小程序 SHALL 展示明确的定位授权提示。
2. WHEN 定位接口不可用、超时或失败 THEN 小程序 SHALL 展示定位不可用提示。
3. WHEN 有 24 小时内的成功位置缓存 THEN 小程序 SHALL 优先使用缓存，不进入无位置降级。
4. WHEN 完全没有有效位置和城市缓存 THEN 小程序 SHALL 请求时间降级结果。
5. WHEN 返回时间降级结果 THEN API SHALL 最多返回 5 辆满足 Requirement 2 的车局。
6. WHEN 返回时间降级结果 THEN SHALL 按 `start_at ASC, session.id ASC` 排列。
7. WHEN 展示降级结果 THEN 页面 SHALL 标注“暂按开本时间推荐”。
8. WHEN 用户主动点击授权动作 THEN 小程序 SHALL 调用 `uni.openSetting` 或重新触发定位，并在授权成功后刷新同城结果。
9. WHEN 位置授权提示展示 THEN 已返回的 5 辆降级车局 SHALL 继续可浏览和点击。

### Requirement 5: 位置缓存和隐私边界

**User Story:** 作为用户，我希望定位不会在每次进入首页时重复弹出，也不希望平台长期保存我的精确位置。

#### Acceptance Criteria

1. WHEN 用户未点击“同城” THEN 小程序 SHALL NOT 主动请求当前位置。
2. WHEN 城市识别成功 THEN 小程序 MAY 在本地缓存城市、纬度、经度和写入时间。
3. WHEN 位置缓存超过 24 小时 THEN 小程序 SHALL 将其视为失效并重新请求位置。
4. WHEN 发送发现请求 THEN 坐标 SHALL 只用于本次城市识别和距离计算。
5. WHEN API 完成请求 THEN 服务端 SHALL NOT 把用户坐标写入用户表、车局表或新的位置历史表。
6. WHEN 日志记录发现请求 THEN SHALL NOT 记录完整精确坐标。
7. WHEN 小程序声明 `getLocation` THEN 权限说明 SHALL 明确用于同城车局发现。

### Requirement 6: 新建车局明确控制同城可见性

**User Story:** 作为车头，我希望决定车局是否出现在同城发现中，同时默认获得更高的招募曝光。

#### Acceptance Criteria

1. WHEN 用户进入开本设置 THEN 页面 SHALL 展示“同城展示”二元开关。
2. WHEN 创建流程没有旧值 THEN “同城展示” SHALL 默认开启。
3. WHEN “同城展示”开启 THEN 创建车局请求 SHALL 发送 `visibility = public`。
4. WHEN “同城展示”关闭 THEN 创建车局请求 SHALL 发送 `visibility = share_only`。
5. WHEN 用户返回创建流程 THEN 开关值 SHALL 通过现有 create flow 保留。
6. WHEN 后端创建或更新车局 THEN SHALL 只接受 `public` 或 `share_only`。
7. WHEN 旧车局保持 `share_only` THEN D38 SHALL NOT 自动迁移或公开它。
8. WHEN `share_only` 车局通过现有分享链接打开 THEN 详情和报名流程 SHALL 保持可用。

### Requirement 7: 日历卡片和状态表达

**User Story:** 作为玩家，我希望“我的”和“同城”沿用熟悉的日历卡片，同时能快速看出同城车局是否值得点击。

#### Acceptance Criteria

1. WHEN “同城”激活 THEN 标签计数 SHALL 使用同城接口返回的候选数量。
2. WHEN 同城卡片有距离 THEN SHALL 展示格式化距离。
3. WHEN 同城卡片没有距离 THEN SHALL NOT 展示虚假的 `0km` 或未知占位距离。
4. WHEN 同城卡片渲染 THEN 角色信息 SHALL 表达剩余空位数，而不是“车头”。
5. WHEN 同城接口加载中 THEN 页面 SHALL 显示“正在查找可参加的同城车局”。
6. WHEN 同城结果为空 THEN 页面 SHALL 显示同城暂无可报名车局。
7. WHEN 切换“我的 / 同城” THEN 分页数量、日期定位和空状态 SHALL 按当前数据源重置。
8. WHEN 下拉刷新且“同城”激活 THEN SHALL 重新校验位置缓存并刷新同城结果；有效缓存 SHALL 继续复用，过期缓存 SHALL 重新定位；“我的”激活时 SHALL 保持现有我的日历刷新行为。

### Requirement 8: API 安全和返回边界

**User Story:** 作为平台维护者，我希望同城发现不会泄露草稿、分享限定车局或无关用户数据。

#### Acceptance Criteria

1. WHEN 请求 `POST /api/sessions/discovery` THEN API SHALL require 有效业务登录。
2. WHEN 查询同城车局 THEN API SHALL 只返回卡片和详情跳转所需字段。
3. WHEN 返回车局 THEN API SHALL NOT 返回 organizer 手机号、报名联系方式、私密备注或用户精确位置。
4. WHEN 请求坐标非法或越界 THEN API SHALL 返回 400。
5. WHEN 请求缓存城市 THEN API SHALL 对城市文本做长度和公共文本边界校验。
6. WHEN 逆地址解析 provider 全部失败 THEN API SHALL 返回 `mode = time_fallback`，而不是让整个列表失败。
7. WHEN 查询数据库失败 THEN API SHALL 使用现有统一错误响应，不返回 SQL 或密钥信息。
8. WHEN 小程序发送精确坐标 THEN SHALL 通过 POST 请求体发送，SHALL NOT 把坐标放进 URL 查询串。

### Requirement 9: 自动验证和开发者工具验收

**User Story:** 作为开发者，我希望 D38 的筛选、位置降级和隐私条件都有可重复验证，防止以后退化成当前账号前端过滤。

#### Acceptance Criteria

1. WHEN 运行 D38 静态检查 THEN SHALL 检查标签只有“我的 / 同城”。
2. WHEN 运行 D38 后端检查 THEN SHALL 检查招募中、未来、有空位、公开、排除自己和排除已报名条件。
3. WHEN 运行 D38 定位检查 THEN SHALL 覆盖腾讯逆地址解析优先、高德兜底和 24 小时缓存。
4. WHEN 运行 D38 降级检查 THEN SHALL 覆盖无位置时最多 5 辆并按开本时间排序。
5. WHEN 运行 `npm run check` THEN SHALL 包含 D38 检查。
6. WHEN 运行 `npm run build:mp-weixin` THEN SHALL 成功生成微信小程序产物。
7. WHEN 在微信开发者工具验证 THEN SHALL 覆盖定位成功、拒绝定位、缓存定位和同城卡片跳详情。
8. WHEN 运行 D38 静态检查 THEN SHALL 检查发现请求使用 POST 请求体，避免精确坐标进入 URL。
