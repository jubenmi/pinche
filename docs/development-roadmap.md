# MVP开发阶段划分

更新日期：2026-06-11

本文只描述开发阶段划分，目标是把情感本拼车微信小程序做到可发布的MVP。范围到“MVP发布”为止，不包含商业化、完整店家后台、DM/NPC后台、发行商后台等后续规划。

相关文档：

- [MVP与增长设计](./mvp-growth-design.md)
- [D0需求冻结](./d0-requirements-freeze.md)
- [D0 Spec](../specs/d0-requirements-freeze/README.md)
- [D1 Spec](../specs/d1-technical-initialization/README.md)
- [D2 Spec](../specs/d2-identity-data-model/README.md)
- [情感本拼车小程序产品设计](./mini-program-product-design.md)
- [剧本杀情感本发车业务调研](./jubensha-emotional-carpool.md)
- [微信小程序实现约束与设计修正](./wechat-miniprogram-design-notes.md)
- [后端架构与部署设计](./backend-architecture.md)
- [微信小程序合规护栏](./wechat-compliance-guardrails.md)
- [身份与认领模型](./identity-and-claim-model.md)

## 1. MVP范围冻结

MVP只验证一件事：管理员能录入店家和剧本，车头能基于这些基础资料创建一辆车并分享出去，玩家能从分享页申请上车，车头能审核并锁座。

### MVP包含

- 微信登录。
- 用户身份：玩家、车头、DM/NPC、系统管理员都按微信用户建模。
- 系统管理员角色：早期店家和剧本都由管理员录入。
- 店家和剧本资料：纯数据，可被后续认领。
- 车头建车：选择管理员已录入的剧本和店家。
- 缺资料申请：车头找不到店家或剧本时，提交新增资料申请，不直接创建正式资料。
- DM/NPC：可手动填写本车快照，也可绑定为微信用户演绎档案。
- 座位配置：座位名、座位类型、原价、补贴调整、实付价。
- 发布校验：所有座位补贴调整合计必须等于0。
- 分享落地页。
- 玩家申请上车。
- 车头审核申请。
- 车头锁座/取消座位。
- 押金状态记录：未付、待确认、已确认、已退。
- 复制招募文案。
- 基础分享埋点：访问、申请、来源。

### MVP不包含

- 微信支付。
- 现金红包。
- 店家完整后台。
- DM/NPC完整后台。
- 发行商完整后台。
- 自动分账。
- 评价体系。
- 黑名单系统。
- 推荐算法。
- 站内聊天。
- 复杂公开车列表。
- 车头直接创建公开店家/剧本资料。

## 2. 阶段总览

| 阶段 | 名称 | 建议周期 | 目标 |
| --- | --- | --- | --- |
| D0 | 需求冻结 | 0.5-1天 | 锁定MVP范围、角色、状态和合规边界 |
| D1 | 技术初始化 | 1天 | 建好小程序、Node后端、Docker、MySQL、Redis可选 |
| D2 | 身份权限与数据模型 | 1-2天 | 完成用户、角色、管理员权限、核心表和API |
| D3 | 管理员资料录入 | 1-2天 | 管理员能录入店家和剧本，车头能提交缺资料申请 |
| D4 | 车头建车流程 | 2-3天 | 车头能选择店/本、配置座位和补贴、发布车 |
| D5 | 分享页与玩家报名 | 2-3天 | 玩家能从分享页选择座位并申请上车 |
| D6 | 车头管理 | 2天 | 车头能审核、锁座、标记押金 |
| D7 | 分享与埋点 | 1-2天 | 支持微信分享、复制文案、基础转化统计 |
| D8 | QA与内测修复 | 2-3天 | 修完阻塞问题，准备提审 |
| D9 | 发布MVP | 0.5-1天 | 提审并发布可用MVP |

## 3. D0：需求冻结

D0已按spec方式执行，后续开发以 [D0 Requirements](../specs/d0-requirements-freeze/requirements.md)、[D0 Design](../specs/d0-requirements-freeze/design.md)、[D0 Tasks](../specs/d0-requirements-freeze/tasks.md) 为准。

### 阶段工作

- 确认MVP主链路：

```text
管理员录入店/本
  -> 车头建车
  -> 配座位和补贴
  -> 发布分享
  -> 玩家申请
  -> 车头审核
  -> 锁座
```

- 确认角色：
  - 系统管理员：录入店家、录入剧本、审核新增资料申请。
  - 车头：建车、发车、审核玩家、锁座。
  - 玩家：从分享页申请上车。
  - DM/NPC：微信用户，可绑定演绎档案；未绑定时只作为本车快照。
  - 店家：纯数据资料，可后续认领。
  - 剧本：纯数据资料，可后续认领。
- 确认核心页面：
  - 管理员资料录入页。
  - 建车页。
  - 车详情/分享页。
  - 申请上车页。
  - 我的车/车头管理页。
- 确认核心状态：
  - 店家/剧本：未认领、认领中、已认领、已驳回、已下架。
  - 新增资料申请：待处理、已通过、已驳回。
  - 车：草稿、招募中、已锁车、已取消。
  - 座位：开放、待审核、已确认、已锁座、已取消。
  - 押金：未付、待确认、已确认、已退。
- 确认微信合规禁区：
  - 不做分享奖励。
  - 不做订阅奖励。
  - 不做现金红包。
  - 不做补贴倒返。
  - 不做现实陪伴承诺。
  - 不公开手机号、微信号、真实姓名。
- 确认补贴公式：

```text
payablePrice = basePrice + adjustment
sum(all seat adjustment) = 0
payablePrice >= 0
```

### 交付物

- MVP需求清单。
- 页面列表。
- 状态机。
- API清单草案。
- 管理员录入字段清单。

### 验收标准

- 确认MVP不做支付、不做红包、不做完整后台。
- 确认店家和剧本第一版由系统管理员录入。
- 确认车头不能直接创建公开店家/剧本资料。
- 确认发布前必须支持完整建车到报名闭环。

## 4. D1：技术初始化

D1已按spec方式执行，后续开发以 [D1 Requirements](../specs/d1-technical-initialization/requirements.md)、[D1 Design](../specs/d1-technical-initialization/design.md)、[D1 Tasks](../specs/d1-technical-initialization/tasks.md) 为准。

### 阶段工作

- 初始化小程序项目。
- 初始化 Node.js 后端项目。
- 初始化 MySQL 数据库迁移。
- 初始化 Dockerfile。
- 初始化本地 `docker-compose.yml`：api、mysql、redis。
- 配置开发环境、测试环境、生产环境变量。
- 配置代码格式化和基础检查。
- 配置后端健康检查：

```text
GET /health
GET /health/db
```

- 配置小程序 AppID、开发者、体验成员。
- 配置 UniApp `src/pages.json` 页面、窗口和网络超时。
- 配置小程序合法服务器域名和HTTPS证书。
- 配置系统管理员初始化方式：

```text
BOOTSTRAP_ADMIN_OPENIDS
```

- 配置内容安全检测方案：
  - MVP先做敏感词和服务端审核入口。
  - 图片上传后置。

### 建议工程结构

```text
apps/
  miniprogram/
  api/
    src/
    migrations/
    Dockerfile
packages/
  shared/
docker-compose.yml
docs/
```

### 后端技术栈

```text
Runtime: Node.js
Database: MySQL
Cache: Redis，可选
Deploy: Docker
```

Redis只作为缓存、限流、短期登录态、微信 access_token 缓存或防重复提交使用。车、座位、报名、押金状态和分享转化仍以 MySQL 为唯一事实来源。

### 交付物

- 可启动的小程序空壳。
- 可启动的 Node API。
- Dockerfile。
- `docker-compose.yml`。
- 空数据库迁移。
- `.env.example`。

### 验收标准

- 小程序能启动。
- 后端健康检查能访问。
- 数据库能连接。
- 可以执行一次空迁移。
- Docker镜像可以构建。
- `docker-compose` 能启动 MySQL 和 Redis。
- 开发版能完成 `wx.login -> 后端换 openid -> 签发业务 token`。
- 指定 openid 能获得 `system_admin` 角色。

## 5. D2：身份权限与数据模型

D2已按spec方式执行，后续开发以 [D2 Requirements](../specs/d2-identity-data-model/requirements.md)、[D2 Design](../specs/d2-identity-data-model/design.md)、[D2 Tasks](../specs/d2-identity-data-model/tasks.md) 为准。

### 阶段工作

- 实现微信登录接口。
- 实现业务 token。
- 实现用户表和角色表。
- 实现角色权限判断：
  - `system_admin` 才能录入店家和剧本。
  - `organizer` 才能发布自己的车。
  - 普通玩家只能报名和查看自己的报名。
- 实现核心数据库迁移。
- 实现基础CRUD接口。
- 实现关键事务：
  - 审核报名通过。
  - 锁座。
  - 发布车时校验补贴配平。

### 核心表

```text
users
user_roles
performer_profiles
stores
scripts
catalog_requests
entity_claims
sessions
session_seats
signups
share_events
subscription_requests
```

### 关键字段

```text
users
- id
- open_id
- union_id
- nickname
- avatar_url
- phone_encrypted
- phone_verified_at
- created_at
- updated_at
```

```text
user_roles
- id
- user_id
- role: player | organizer | performer | store_admin | publisher_admin | system_admin
- status
- created_at
```

```text
stores
- id
- name
- city
- district
- address
- claim_status
- created_by_admin_user_id
- claimed_by_user_id
- status
- created_at
- updated_at
```

```text
scripts
- id
- name
- type_tags
- player_count
- summary_no_spoiler
- claim_status
- created_by_admin_user_id
- claimed_by_user_id
- status
- created_at
- updated_at
```

```text
catalog_requests
- id
- request_type: store | script
- requested_by_user_id
- name
- city
- district
- description
- status: pending | approved | rejected
- reviewed_by_admin_user_id
- review_note
- created_entity_id
- created_at
- reviewed_at
```

```text
sessions
- id
- organizer_user_id
- script_id
- script_name_snapshot
- store_id
- store_name_snapshot
- start_at
- dm_user_id
- dm_name_snapshot
- npc_user_id
- npc_name_snapshot
- deposit_amount
- status
- visibility
- note
- created_at
- updated_at
```

### 核心接口

```text
POST /auth/wechat-login
POST /auth/wechat-phone

POST /admin/stores
PATCH /admin/stores/:id
POST /admin/scripts
PATCH /admin/scripts/:id
GET /admin/catalog-requests
PATCH /admin/catalog-requests/:id

GET /stores
GET /scripts
POST /catalog-requests
POST /performer-profiles

POST /sessions
GET /sessions/:id
PATCH /sessions/:id
POST /sessions/:id/publish
POST /sessions/:id/seats
PATCH /seats/:id

POST /signups
GET /sessions/:id/signups
PATCH /signups/:id/approve
PATCH /signups/:id/reject
PATCH /signups/:id/deposit

POST /share-events/view
POST /share-events/convert
POST /subscriptions/request-result
POST /entity-claims
```

### 交付物

- 数据库迁移。
- 登录接口。
- 权限中间件。
- 核心API骨架。
- 管理员权限测试用例。

### 验收标准

- 能创建用户。
- 能创建用户角色。
- 能识别系统管理员。
- 非管理员不能调用管理员资料录入接口。
- 能创建绑定微信用户的DM/NPC演绎档案。
- 管理员能创建店家和剧本资料。
- 车头能提交新增店家/剧本申请。
- 发布时能校验补贴合计为0。
- 审核通过和锁座使用 MySQL 事务，避免同一座位被多人确认。
- Redis关闭时，建车、报名、审核主链路仍可运行。

## 6. D3：管理员资料录入

### 阶段工作

- 小程序内增加管理员入口：
  - 仅 `system_admin` 可见。
  - 可放在“我的”页里。
- 管理员录入店家：
  - 店名。
  - 城市。
  - 区域。
  - 地址，可选。
  - 状态：可用、下架。
- 管理员录入剧本：
  - 本名。
  - 类型标签。
  - 人数。
  - 无剧透简介，可选。
  - 默认座位模板，可选。
  - 状态：可用、下架。
- 管理员审核新增资料申请：
  - 查看车头提交的店家/剧本名称。
  - 通过后创建正式资料。
  - 驳回时填写原因。
- 管理员资料列表：
  - 搜索店家。
  - 搜索剧本。
  - 编辑基础信息。
  - 下架错误或违规资料。

### 交付物

- 管理员资料录入页面。
- 店家录入接口。
- 剧本录入接口。
- 新增资料申请审核接口。
- 基础种子数据。

### 验收标准

- 非管理员看不到管理员入口。
- 非管理员调用管理员接口会被拒绝。
- 管理员能录入至少10个店家。
- 管理员能录入至少20个剧本。
- 车头建车时能搜索到管理员录入的店家和剧本。
- 车头找不到资料时能提交新增申请。
- 管理员通过申请后，资料能出现在车头选择列表里。

## 7. D4：车头建车流程

### 阶段工作

- 建车基础信息：
  - 选择剧本。
  - 选择店家。
  - 设置时间。
  - 填写DM/NPC快照或选择已绑定演绎档案。
  - 设置押金金额。
  - 填写备注。
- 店家/剧本缺失处理：
  - 入口：找不到店家。
  - 入口：找不到剧本。
  - 提交新增资料申请。
  - 申请提交后提示“等待管理员处理”。
- 座位编辑：
  - 新增座位。
  - 删除座位。
  - 修改座位名。
  - 修改座位类型。
  - 修改原价。
  - 修改补贴调整。
  - 自动计算实付价。
- 座位模板：
  - 1情感沉浸位 + 4 F4。
  - 空白模板。
- 发布按钮：
  - 校验补贴合计。
  - 校验实付价不小于0。
  - 校验至少有一个开放座位。
  - 保存剧本和店家名称快照。

### 前端提示

```text
补贴合计：¥0
玩家实付合计：¥1000
```

如果不为0：

```text
补贴还未配平，当前差额 ¥100
```

### 交付物

- 建车页。
- 座位编辑组件。
- 补贴配平组件。
- 发布接口。
- 新增资料申请入口。

### 验收标准

- 车头能在3分钟内创建一辆5人车。
- 车头只能选择管理员已录入的店家和剧本。
- 找不到资料时能提交申请，但不能直接生成公开店家/剧本。
- 修改任一座位补贴后，合计实时变化。
- 补贴不为0时不能发布。
- 发布成功后进入车详情页。

## 8. D5：分享页与玩家报名

### 阶段工作

- 车详情/分享页展示：
  - 本名。
  - 店家。
  - 时间。
  - DM/NPC快照。
  - 押金。
  - 车况。
- 座位卡展示：
  - 座位类型。
  - 原价。
  - 补贴。
  - 实付。
  - 状态。
- 申请上车：
  - 登录。
  - 选择座位。
  - 填昵称。
  - 授权手机号或手动填写联系方式。
  - 输出自评。
  - 是否接受反串。
  - 边界备注。
- 订阅消息：
  - 申请成功后，在明确提示用途的情况下请求“申请审核结果”订阅。
  - 用户拒绝订阅时，主流程继续。

### 交付物

- 车详情页。
- 申请上车页。
- 报名接口。
- 手机号授权兜底逻辑。
- 订阅消息请求结果记录。

### 验收标准

- 未登录用户点“我要上车”时能先登录。
- 用户不授权手机号时，可以用手动联系方式继续申请。
- 玩家能申请开放座位。
- 已锁座座位不能申请。
- 申请成功后座位显示待审核。
- 车头能在管理页看到申请。

## 9. D6：车头管理

### 阶段工作

- 我的发车列表。
- 车详情管理视图。
- 申请列表。
- 审核操作：
  - 通过。
  - 拒绝。
  - 取消。
- 座位操作：
  - 锁座。
  - 取消锁座。
- 押金状态：
  - 未付。
  - 待确认。
  - 已确认。
  - 已退。
- 车状态：
  - 招募中。
  - 已锁车。
  - 已取消。
- 联系方式保护：
  - 只有车头能查看本车报名联系方式。
  - 非本车车头不能查看。

### 交付物

- 我的车/车头管理页。
- 申请审核接口。
- 锁座接口。
- 押金状态接口。

### 验收标准

- 车头能通过玩家申请。
- 通过后座位绑定玩家。
- 一个座位不能被多个玩家确认。
- 车头能标记押金状态。
- 车头能锁车。
- 非车头不能查看报名联系方式。

## 10. D7：分享与埋点

### 阶段工作

- 微信分享卡片：`button open-type="share"` + `Page.onShareAppMessage`。
- 复制招募文案。
- 简单海报。
- 分享码生成。
- 分享路径携带 `sessionId`、`shareCode`，专属邀请可携带 `seatId`。
- 自定义分享标题和分享图。
- 分享图不得包含手机号、微信号、真实姓名、押金转账信息。
- 分享文案不得包含红包、返现、提现、现实陪伴、身体接触承诺。
- 群分享可记录 `shareTicket`，但主流程不能依赖它。
- 分享页访问记录。
- 报名转化记录。

### 招募文案模板

```text
【北京情感本发车】
本：{scriptName}
时间：{startAt}
店：{storeName}
指定DM/NPC：{performerName}
车况：已上{confirmedCount}/{seatCount}，缺{openSeats}
最低实付：¥{minPayablePrice}
押金：¥{depositAmount}
点进来选位上车：{link}
```

### 埋点事件

```text
catalog_request_created
catalog_request_approved
admin_store_created
admin_script_created
session_created
session_published
session_shared
session_viewed
seat_apply_clicked
signup_submitted
signup_approved
session_locked
```

### 交付物

- 分享卡片逻辑。
- 分享文案生成。
- 简单海报。
- 分享事件记录。
- 车详情统计。

### 验收标准

- 车头能复制一段可用招募文案。
- 玩家从分享链接进入后能打开对应车。
- 玩家从专属座位邀请进入后能自动定位到对应座位。
- 分享来源能记录。
- 每辆车能看到浏览数和申请数。
- 不存在“强制分享后才能报名/解锁”的流程。
- 分享次数不兑换任何现金、补贴、优先锁座、信用分或抽奖机会。

## 11. D8：QA与内测修复

### 阶段工作

- 主流程测试。
- 管理员资料录入测试。
- 新增资料申请测试。
- 权限测试。
- 微信真机兼容测试。
- 合规文案检查。
- 接口错误和崩溃修复。

### 正向流程

```text
管理员录入店/本
  -> 车头登录
  -> 建车
  -> 配座位
  -> 发布
  -> 分享
  -> 玩家申请
  -> 车头通过
  -> 锁车
```

### 必测异常

- 非管理员访问管理员入口。
- 非管理员调用管理员接口。
- 车头找不到店家/剧本并提交新增申请。
- 管理员驳回新增资料申请。
- 补贴合计不为0。
- 实付价小于0。
- 未登录申请。
- 重复申请同一座位。
- 座位已锁后再次申请。
- 车取消后申请。
- 车头拒绝申请。
- 押金状态修改。

### 兼容测试

- iOS微信。
- Android微信。
- 小程序分享卡片。
- 小程序码/链接进入。
- 手机号授权拒绝后的兜底申请。
- 订阅消息拒绝后的主流程继续。
- 自定义分享图是否泄露个人信息。
- 招募文案命中高风险词时能被拦截或提示改写。
- 审核测试账号能完整体验管理员录入、建车、报名、审核、分享主链路。

### 交付物

- QA清单。
- 内测问题列表。
- 修复记录。
- 提审测试账号。
- 提审说明草稿。

### 验收标准

- P0级阻塞问题为0。
- P1级严重问题为0。
- 管理员录入资料流程连续跑通5次。
- 主流程连续跑通10次。
- 至少3个真实车头完成试建车。
- 至少10个玩家完成试申请。

## 12. D9：发布MVP

### 阶段工作

- 配置生产环境。
- 构建API Docker镜像。
- 执行生产MySQL迁移。
- 配置生产HTTPS域名。
- 配置小程序合法服务器域名。
- 准备管理员账号。
- 录入首批生产店家和剧本资料。
- 准备小程序提审材料。
- 上传代码。
- 设置体验版。
- 提交审核。
- 审核通过后发布线上版。

### 发布前检查

- 小程序名称、头像、简介。
- 服务类目。
- 隐私协议。
- 用户协议。
- 数据安全说明。
- 隐私保护指引与实际隐私接口调用一致。
- 微信合规护栏检查通过。
- 管理员测试账号可用。
- 店家和剧本首批基础数据已录入。
- 服务器域名、业务域名、HTTPS证书。
- 版本号。
- 体验版二维码。
- 审核截图。
- 审核说明。
- iOS微信和Android微信主链路录屏或截图。
- API Docker镜像构建成功。
- 生产环境 MySQL 迁移执行成功。
- 生产环境 Redis 可选连接检查完成。
- API HTTPS域名已配置到小程序合法服务器域名。
- `/health` 和 `/health/db` 在线上返回成功。

### 小程序发布流程

```text
开发版真机预览
  -> 上传代码
  -> 设置体验版
  -> 体验成员完整测试
  -> 提交审核
  -> 审核通过后发布线上版
```

### MVP发布内容

- 管理员录入店家和剧本。
- 车头建车。
- 座位补贴。
- 分享页。
- 申请上车。
- 车头审核。
- 押金状态记录。
- 分享埋点。

### 发布后第一周观察

只看开发和产品稳定性指标：

- 管理员录入成功率。
- 建车成功率。
- 发布失败原因。
- 分享页打开成功率。
- 报名提交成功率。
- 审核操作成功率。
- 崩溃和接口错误。

### MVP发布验收标准

```text
小程序审核通过
生产环境可登录
生产环境可识别系统管理员
生产环境管理员可录入店家和剧本
生产环境可建车
生产环境可发布车
生产环境可分享车
生产环境可申请上车
生产环境可审核申请
生产环境可锁座
补贴合计校验生效
基础埋点生效
API容器可重启恢复
MySQL数据持久化和备份策略确认
无诱导分享、红包、返现、抽奖、隐藏功能
```

## 13. 开发顺序建议

推荐顺序：

1. 用户和角色。
2. 系统管理员识别。
3. 店家/剧本管理员录入。
4. 车头建车接口。
5. 建车页。
6. 车详情页。
7. 报名接口。
8. 报名页。
9. 审核接口。
10. 车头管理页。
11. 分享文案和埋点。
12. QA。
13. 发布MVP。

## 14. 每日开发节奏

每天只回答三个问题：

```text
昨天完成了哪个可验收功能？
今天要打通哪条用户路径？
当前有没有阻塞MVP发布的问题？
```

判断优先级只看一个标准：是否影响“管理员录入店/本 -> 建车 -> 分享 -> 申请 -> 审核 -> 锁座”这条主链路。
