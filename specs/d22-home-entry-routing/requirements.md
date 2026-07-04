# D22 Requirements: 首页车局分流

更新日期：2026-07-04

## Introduction

D22 将小程序首页从“品牌入口 + 创建/我的按钮”改为按用户车局状态分流的主入口。首页只保留两类主要界面：首车入口和车局日历。未登录用户和已登录但没有车局的用户共用首车入口；登录后如果发现已有发起或参与车局，则进入车局日历。

D22 不改变发车流程本身，不新增公开车局广场，不改变报名、审核、相册、车友记录或隐私规则。

## Requirements

### Requirement 1: 首页维护态优先

**User Story:** 作为用户，我希望后端维护时首页直接说明服务状态，以免误以为自己的车局丢失。

#### Acceptance Criteria

1. WHEN 后端处于维护态 THEN 首页 SHALL 展示现有维护态。
2. WHEN 首页展示维护态 THEN 系统 SHALL NOT 请求我的发车或我参与的车。
3. WHEN 用户点击维护态重试 THEN 系统 SHALL 重新检查后端健康状态。
4. WHEN 后端恢复可用 THEN 首页 SHALL 继续执行正常分流。

### Requirement 2: 首车入口合并未登录和无车用户

**User Story:** 作为未登录或还没有车局的用户，我希望打开首页就看到清晰的发车入口，而不是空日历或单独登录页。

#### Acceptance Criteria

1. WHEN 用户没有有效 token THEN 首页 SHALL 展示首车入口。
2. WHEN 已登录用户的我的发车和我参与的车均为空 THEN 首页 SHALL 展示首车入口。
3. WHEN 首页展示首车入口 THEN 页面 SHALL 展示标题 `发起第一辆车`。
4. WHEN 首页展示首车入口 THEN 页面 SHALL 展示主按钮 `开始发车`。
5. WHEN 首页展示首车入口 THEN 页面 SHALL NOT 展示空日历。
6. WHEN 首页展示首车入口 THEN 页面 SHALL 使用轻量品牌视觉和现有首页视觉资产。

### Requirement 3: 首车入口认证后重新判定

**User Story:** 作为未登录用户，我希望点击开始发车后先登录，并让系统确认我是否已有车局，以免误进发车流程。

#### Acceptance Criteria

1. WHEN 未登录用户点击 `开始发车` THEN 系统 SHALL 调用现有 `ensureLoggedIn()`。
2. WHEN 登录取消或失败 THEN 首页 SHALL 保持首车入口并展示轻量失败提示。
3. WHEN 登录成功 THEN 系统 SHALL 请求我的发车和我参与的车。
4. WHEN 登录成功后发现已有发起或参与车局 THEN 首页 SHALL 展示车局日历。
5. WHEN 登录成功后仍没有任何车局 THEN 系统 SHALL 清空创建流程并进入 `/pages/session/create`。
6. WHEN 加载我的车局失败 THEN 系统 SHALL NOT 进入发车流程。

### Requirement 4: 已有车局用户进入日历

**User Story:** 作为已经发起或参与过车局的用户，我希望打开首页就看到我的车局日历和待处理事项。

#### Acceptance Criteria

1. WHEN 用户有发起车局 THEN 首页 SHALL 展示车局日历。
2. WHEN 用户有参与车局 THEN 首页 SHALL 展示车局日历。
3. WHEN 首页展示车局日历 THEN 页面 SHALL 使用标题 `我的车局`。
4. WHEN 首页展示车局日历 THEN 页面 SHALL 展示车局总数和更新时间。
5. WHEN 首页展示车局日历 THEN 页面 SHALL 提供 `发车` 主按钮。
6. WHEN 用户点击 `发车` THEN 系统 SHALL 清空创建流程并进入 `/pages/session/create`。

### Requirement 5: 日历行为复用现有我的日程

**User Story:** 作为回访用户，我希望首页日历和“我的”里的车局日历行为一致，避免同一车局在不同入口有不同操作。

#### Acceptance Criteria

1. WHEN 首页展示日历 THEN 页面 SHALL 保留全部、发起、参与、待处理筛选。
2. WHEN 首页展示日历 THEN 页面 SHALL 保留按日期聚合、归位、日期选择、下拉刷新和加载更多。
3. WHEN 用户点击我发起的车局 THEN 系统 SHALL 进入车头管理。
4. WHEN 用户点击已发车且可查看的参与车局 THEN 系统 SHALL 进入车局相册。
5. WHEN 用户点击可写记录的车局 THEN 系统 SHALL 进入写记录页。
6. WHEN 用户点击其他车局 THEN 系统 SHALL 进入车详情页。
7. WHEN 用户删除、退出车头或隐藏参与关系 THEN 系统 SHALL 沿用现有规则和接口。

### Requirement 6: 数据加载和错误处理

**User Story:** 作为用户，我希望系统不要因为接口失败把我误判成无车用户。

#### Acceptance Criteria

1. WHEN 用户缓存存在但 token 不存在 THEN 系统 SHALL 清理认证并展示首车入口。
2. WHEN 登录用户进入首页 THEN 系统 SHALL 在判定有车或无车前展示加载态。
3. WHEN 我的发车或我参与接口返回 401 THEN 系统 SHALL 清理认证、展示首车入口并提示重新登录。
4. WHEN 我的发车或我参与接口发生非 401 错误 THEN 首页 SHALL 展示错误和重试入口。
5. WHEN 任一我的车局接口失败 THEN 系统 SHALL NOT 将用户判定为无车。
6. WHEN 两个我的车局接口均成功且合并后为空 THEN 系统 SHALL 判定为无车。

### Requirement 7: 分享落地保持首页路径

**User Story:** 作为用户，我希望分享首页后，对方仍进入统一首页入口，再由系统根据自己的账号状态展示对应界面。

#### Acceptance Criteria

1. WHEN 用户分享首页到好友或群 THEN 分享路径 SHALL 继续打开 `/pages/index/index`。
2. WHEN 用户分享到朋友圈 THEN 分享 SHALL 继续使用首页 query 方式。
3. WHEN 分享接收者未登录 THEN 首页 SHALL 展示首车入口。
4. WHEN 分享接收者登录且无车 THEN 首页 SHALL 展示首车入口。
5. WHEN 分享接收者登录且有车 THEN 首页 SHALL 展示自己的车局日历。

### Requirement 8: D22 交付物

**User Story:** 作为开发团队，我希望 D22 有明确 spec 三件套和验收清单，以便后续按 spec 实现。

#### Acceptance Criteria

1. WHEN D22 spec 完成 THEN SHALL 产出 `requirements.md`。
2. WHEN D22 spec 完成 THEN SHALL 产出 `design.md`。
3. WHEN D22 spec 完成 THEN SHALL 产出 `tasks.md`。
4. WHEN D22 实现完成 THEN SHALL 通过首页分流静态检查。
5. WHEN D22 实现完成 THEN SHALL 通过 `npm run check`。
6. WHEN D22 实现完成 THEN SHALL 通过 `npm run build:mp-weixin`。
