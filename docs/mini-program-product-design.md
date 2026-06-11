# 情感本拼车小程序产品设计

更新日期：2026-06-11

本文基于北京情感本/恋陪本拼车背景设计小程序。目标不是做一个泛剧本杀平台，而是先把“车头建车、补贴配平、分享拉人、玩家加车、押金锁座”这个核心闭环跑起来，再吸引店家、DM/NPC和发行商进入。

相关术语见：[剧本杀情感本发车业务调研](./jubensha-emotional-carpool.md)。

微信小程序平台约束见：[微信小程序实现约束与设计修正](./wechat-miniprogram-design-notes.md)。
微信合规禁区见：[微信小程序合规护栏](./wechat-compliance-guardrails.md)。
身份与认领规则见：[身份与认领模型](./identity-and-claim-model.md)。

## 1. 产品定位

一句话：给情感本车头一个能快速发车、算清座位实付、分享招人的小程序。

第一版优先服务车头和非恋陪玩家：

- 车头能快速建车，选择管理员已录入的本、店家、时间、DM/NPC，配置每个位置价格和座位实付。
- 非恋陪玩家能看到自己实际要付多少钱，低价上车。
- 店家能看到更稳定的成车需求，愿意入驻。
- DM/NPC能获得曝光、被收藏、被点名，形成个人影响力。
- 发行商能看到哪些本更容易被组车，促进更多店家采购。

## 2. 六方角色与真实动机

| 角色 | 用户画像 | 核心目标 | 产品要给什么 |
| --- | --- | --- | --- |
| 车头/恋陪姐 | 多为女性情感本玩家，愿意为恋陪体验买单 | 快速组车，指定喜欢的本、店、DM/NPC和对位恋陪 | 建车工具、补贴配平、分享海报、押金锁座、车头信用 |
| 系统管理员 | 平台内部运营人员 | 维护早期基础数据，保证店家和剧本资料干净可用 | 店家录入、剧本录入、新增资料申请审核、资料下架 |
| 店家 | 线下剧本杀门店 | 多开车、提升房间/DM/NPC利用率、降低鸽子 | 入驻页、排期管理、成车需求、押金保障、营业数据 |
| DM/NPC | 微信用户，承担主持和演绎，可绑定店家 | 维护车头，积累粉丝，获得更多被指定机会 | 微信用户身份、演绎档案、粉丝收藏、可预约档期、评价与代表作 |
| 剧本/发行商 | 剧本资料及其认领/维护方 | 让更多店家买本、开本、宣传本 | 可认领剧本资料、授权店展示、组车热度、门店线索 |
| 非恋陪玩家 | F4、边位、普通玩家 | 用更少的钱玩本，减少坐牢风险 | 低价位筛选、补贴透明、押金保障、角色风险提示 |

## 3. 微信公开口径

行业研究里可以保留“恋陪”“爱D”“出补”等黑话，但小程序公开页面、分享标题、海报、名称和简介默认使用更中性的表达：

| 内部口径 | 公开口径 |
| --- | --- |
| 恋陪位 | 情感沉浸位 / 演绎互动位 |
| 爱D | 指定DM/NPC |
| 出补/吃补 | 座位价格调整 / 实付价 |
| 补贴后倒返 | 禁用 |
| 红包 | 禁用 |
| 包牵手/包小黑屋 | 禁用 |

公开页面只表达剧本内演绎互动和组局信息，不承诺现实恋爱、身体接触、私人陪伴、现金红包、返现或拉新奖励。

## 4. 身份与认领原则

系统里先区分两类东西：

```text
人：玩家、车头、DM、NPC，都是微信用户。
资料：剧本、店家，是由系统管理员先录入、后续可补全和认领的数据。
```

实现原则：

- 玩家、车头、DM/NPC、系统管理员都从 `User` 出发，用 `openid` 和平台 `user_id` 识别。
- 小程序不能自动获取用户原始微信号字符串，联系方式只能由用户主动授权手机号或主动填写。
- DM/NPC入驻后是绑定 `user_id` 的 `PerformerProfile`，不是纯文本资料。
- 车头建车时可以手动填写DM/NPC名称，但只作为本车快照；本人登录后可通过邀请绑定为演绎档案。
- MVP阶段，店家和剧本由系统管理员先录入；车头找不到资料时提交新增资料申请。
- 店家和剧本后续可由店家负责人、发行商或授权维护者认领。
- 未认领店家、剧本不能展示“官方认证”“已授权”等字样；未绑定本人微信用户的DM/NPC快照不能展示头像、主页或认证状态。

## 5. 核心闭环

```text
车头建车
  -> 选择本/店家/DM/NPC/时间
  -> 配置座位与补贴，校验补贴合计为0
  -> 生成分享卡片
  -> 玩家从微信群、私聊或海报小程序码进入
  -> 选择座位，线下支付押金并记录状态，或先申请上车
  -> 车头审核并锁座
  -> 满车后通知店家、DM/NPC
  -> 到店开本，结算尾款和补贴
  -> 完成后沉淀评价、关注、复开
```

这个闭环的关键不是“发现剧本”，而是“让一辆车被组起来”。所以第一版要减少信息和交易摩擦。

## 6. 补贴与价格规则

### 核心规则

每个位置有三个价格概念：

```text
座位原价 base_price
补贴调整 adjustment
玩家实付 payable_price = base_price + adjustment
```

约定：

- `adjustment > 0`：该位置多付，属于出补方。
- `adjustment < 0`：该位置少付，属于吃补方。
- `adjustment = 0`：正常价格。
- 同一辆车内部补贴需要配平：`sum(adjustment) = 0`。
- 店家默认拿到全车原价总和：`store_receivable = sum(base_price)`。
- 玩家实付不能小于0，不做倒返钱、返现、提现或平台红包。

### 示例

一辆5人恋陪车，原价均为200元：

| 位置 | 原价 | 补贴调整 | 实付 |
| --- | ---: | ---: | ---: |
| 恋陪位 | 200 | +400 | 600 |
| F4-1 | 200 | -100 | 100 |
| F4-2 | 200 | -100 | 100 |
| F4-3 | 200 | -100 | 100 |
| F4-4 | 200 | -100 | 100 |

补贴调整合计：`+400 - 100 - 100 - 100 - 100 = 0`。

这样店家仍收1000元，车头/恋陪位用额外400元降低F4上车成本。

### 店补与平台补

第一版建议只做“车内配平补贴”。后续如扩展外部补贴，必须重新做微信规则和交易合规评估：

- 店补：店家为了开车愿意少收一部分。
- 平台补：平台促活补贴。
- 发行补：发行商为推广新本补贴。

扩展后公式变为：

```text
sum(seat.adjustment) + store_discount + platform_discount + publisher_discount = 0 或可解释
```

第一版先不做复杂分账，避免账务过早变重。

### 押金规则

押金不是车费，也不是补贴。押金用于锁座和防鸽子。

建议字段：

- 是否需要押金。
- 押金金额。
- 押金支付截止时间。
- 退款规则：开车前多久可退、跳车是否扣除、满车取消是否原路退。
- 押金归属：MVP只记录线下收款方，平台不代收、不担保、不分账。

MVP只做“押金记录 + 线下支付确认”。如果后续平台代收押金，必须接入合规支付链路，并补充交易争议、退款和客服规则。

## 7. 产品信息架构

### 玩家端

| 页面 | 目标 | 关键内容 |
| --- | --- | --- |
| 首页/车列表 | 找车 | 日期、城市、店家、剧本、缺口、实付价、补贴标签 |
| 分享落地页 | 从微信群、私聊、朋友圈海报进入后快速决策 | 本名、店家、时间、DM/NPC、座位卡、补贴、押金、进度 |
| 座位详情 | 判断自己要不要上 | 角色类型、CP关系、高光/红光/输出要求、实付价 |
| 报名上车 | 提交申请 | 昵称、经验、输出自评、边界、是否接受反串、押金 |
| 我的 | 管理报名 | 待审核、已锁座、待支付、已完成、退款 |

### 车头端

| 页面 | 目标 | 关键内容 |
| --- | --- | --- |
| 创建车 | 快速建车 | 选本、选店、选DM/NPC、时间、座位模板 |
| 补贴配置 | 算清每个座位实付 | 原价、调整、实付、合计校验 |
| 车管理 | 审核玩家和锁座 | 申请列表、押金状态、联系方式、备注 |
| 分享卡片 | 拉人 | 生成朋友圈海报、群分享标题、私发链接 |
| 车头主页 | 沉淀信用 | 成车率、开车次数、熟人评价 |

### 管理员端

| 页面 | 目标 | 关键内容 |
| --- | --- | --- |
| 店家录入 | 维护可选店家 | 店名、城市、区域、地址、状态 |
| 剧本录入 | 维护可选剧本 | 本名、类型、人数、无剧透简介、座位模板 |
| 新增资料申请 | 处理车头缺资料请求 | 申请人、资料类型、名称、城市、审核结果 |

### 店家端

| 页面 | 目标 | 关键内容 |
| --- | --- | --- |
| 店铺主页 | 吸引车头选择 | 地址、房间、可开本、DM/NPC、营业时间 |
| 排期管理 | 接收和确认车 | 空闲房间、可用DM/NPC、待确认车 |
| 成车看板 | 提高开车数 | 招募中、快满车、已锁车、取消原因 |
| 入驻申请 | 快速加入 | 门店资料、授权本、员工、结算方式 |

### DM/NPC端

| 页面 | 目标 | 关键内容 |
| --- | --- | --- |
| 个人主页 | 成为被点名的人 | 艺名、所属店、擅长本、代表角色、粉丝数 |
| 档期 | 让车头知道能否指定 | 可预约时间、不可用时间、店家确认状态 |
| 评价 | 积累口碑 | 演绎、控场、恋陪体验、复开率 |
| 收藏/爱D | 维护车头关系 | 车头可收藏常约DM/NPC |

“爱D”建议作为用户关系标签，而不是官方头衔：

```text
FavoritePerformer
- userId
- performerId
- favoriteType: love_d | favorite_dm | favorite_npc
- note
```

### 发行商端

| 页面 | 目标 | 关键内容 |
| --- | --- | --- |
| 剧本页 | 展示本的可组车价值 | 类型、人数、座位模板、适合人群、授权店 |
| 数据看板 | 证明热度 | 被建车次数、成车率、缺口位置、热门城市 |
| 门店线索 | 卖本 | 哪些店被车头反复选择但未授权该本 |

第一版可以不做完整发行商后台，只预留数据结构。

## 8. 建车流程设计

### Step 1：选择剧本

展示：

- 本名、类型标签：恋陪、情感、演绎、沉浸。
- 人数模板：1恋陪 + 4 F4，或其他模板。
- 推荐座位结构。
- 历史成车率和平均补贴。

如果找不到剧本，车头提交新增剧本申请；系统管理员审核后录入正式剧本资料。

### Step 2：选择店家

展示：

- 哪些店能开这个本。
- 门店价格。
- 可选时间。
- 可选房间。
- 可指定的DM/NPC。

如果找不到店家，车头提交新增店家申请；系统管理员审核后录入正式店家资料。

### Step 3：选择DM/NPC

车头可以：

- 不指定，交给店家安排。
- 指定DM。
- 指定NPC。
- 指定“爱D”。

若DM/NPC未入驻，允许车头手动填写艺名，先满足发车需求。该名称只作为本车快照；本人通过微信登录后，才能绑定为自己的DM/NPC演绎档案。

### Step 4：设置座位和补贴

每个座位卡包含：

- 座位名：恋陪位、F4-1、F4-2等。
- 角色类型：恋陪、F4、CP位、边位、辅助位。
- 原价。
- 补贴调整。
- 实付价。
- 押金。
- 输出要求。
- 边界提示。

页面必须显示：

```text
补贴合计：0元
```

如果不为0，不能发布，除非选择“店补/平台补/发行补”等外部补贴来源。

### Step 5：发布和分享

分享信息不要剧透，只展示决策信息：

- 本名。
- 店家。
- 时间。
- DM/NPC，若允许公开。
- 剩余座位。
- 每个座位实付价。
- 是否需要押金。
- “缺F4”“实付低”“情感沉浸位已定”“指定DM/NPC”等短标签。

分享入口：

- 分享到微信群：使用小程序 `open-type="share"` 分享卡片。
- 私发给某个玩家：使用带 `seatId` 的专属座位路径。
- 朋友圈：优先使用海报和小程序码承接。
- 复制招募文案。

分享约束：

- 不做“强制分享后解锁报名”。
- 不做分享奖励、订阅奖励、邀请红包、拉新返现。
- 分享图不包含手机号、微信号、真实姓名、押金转账信息。
- 分享路径至少携带 `sessionId` 和 `shareCode`，专属座位邀请额外携带 `seatId`。

## 9. 数据模型

### 用户与角色

```text
User
- id
- wechatOpenId
- wechatUnionId
- nickname
- avatarUrl
- gender
- city
- phoneEncrypted
- status
- createdAt
```

一个用户可以有多个身份：

```text
UserRole
- id
- userId
- role: player | organizer | store_admin | performer | publisher_admin | system_admin
- status: active | disabled
- createdAt
```

### 车头档案

```text
OrganizerProfile
- userId
- organizerName
- city
- successSessionCount
- cancelRate
- noShowDisputeCount
- preferredScripts
- preferredPerformers
- visibility
```

### 店家

```text
Store
- id
- name
- city
- district
- address
- createdByAdminUserId
- claimedByUserId
- claimStatus: unclaimed | pending | claimed | rejected
- businessHours
- status
```

```text
StoreScript
- storeId
- scriptId
- basePrice
- canRun
- notes
```

### DM/NPC

```text
PerformerProfile
- id
- userId
- stageName
- storeId
- performerTypes: dm | npc
- city
- bio
- tags
- fanCount
- claimStatus: claimed
- status
```

```text
PerformerAvailability
- performerId
- startAt
- endAt
- status: available | busy | store_locked | unavailable
```

### 剧本与发行商

```text
Publisher
- id
- name
- contactUserId
- verifiedStatus
```

```text
Script
- id
- publisherId
- createdByAdminUserId
- claimedByUserId
- name
- typeTags
- playerCount
- defaultDurationMinutes
- summaryNoSpoiler
- claimStatus: unclaimed | pending | claimed | rejected
- status
```

### 资料认领

```text
CatalogRequest
- id
- requestType: store | script
- requestedByUserId
- name
- city
- district
- description
- status: pending | approved | rejected
- reviewedByAdminUserId
- reviewNote
- createdEntityId
- createdAt
- reviewedAt
```

```text
EntityClaim
- id
- entityType: store | script
- entityId
- claimantUserId
- claimReason
- evidenceText
- status: pending | approved | rejected
- reviewNote
- createdAt
- reviewedAt
```

```text
ScriptSeatTemplate
- id
- scriptId
- seatName
- roleType: romance_vip | f4_cp | cp | support | normal
- roleGender
- highlightLevel
- romanceHighlightLevel
- outputExpectation
- defaultBasePrice
- defaultAdjustment
```

### 车

```text
Session
- id
- organizerUserId
- scriptId
- scriptNameSnapshot
- storeId
- storeNameSnapshot
- startAt
- durationMinutes
- dmUserId
- dmNameSnapshot
- npcUserIds
- npcNameSnapshot
- status: draft | recruiting | locked | completed | cancelled
- visibility: public | link_only | private
- depositRequired
- depositAmount
- depositRule
- shareTitle
- createdAt
```

### 座位

```text
SessionSeat
- id
- sessionId
- seatName
- roleType
- roleGender
- playerGenderRequirement
- cpPairId
- basePrice
- adjustment
- payablePrice
- depositAmount
- highlightLevel
- romanceHighlightLevel
- outputExpectation
- boundaryNotes
- status: open | applied | confirmed | locked | cancelled
```

发布前校验：

```text
sum(SessionSeat.adjustment where sessionId = ?) = 0
payablePrice = basePrice + adjustment
payablePrice >= 0
```

### 报名

```text
Signup
- id
- sessionId
- seatId
- userId
- status: pending | approved | rejected | withdrawn | no_show
- playerExperience
- outputSelfRating
- boundaryNotes
- organizerNote
- depositStatus: none | pending | paid | refunded | forfeited
- createdAt
```

### 押金和账本

```text
DepositOrder
- id
- signupId
- amount
- payChannel: offline | wechat_pay
- status: pending | paid | refunded | forfeited
- paidAt
- refundedAt
```

```text
SettlementLedger
- id
- sessionId
- userId
- seatId
- entryType: base_price | adjustment | deposit | refund | penalty
- amount
- direction: payable | receivable
- status
```

### 分享和转化

```text
ShareInvite
- id
- sessionId
- inviterUserId
- channel: group | moment | direct | copy_text
- targetUserId
- shareCode
- viewCount
- signupCount
- createdAt
```

这些数据能反推谁带来了玩家、哪些渠道成车效率最高。

## 10. 激励机制

### 激励车头建更多车

- 建车极快：从常用模板一键复开。
- 补贴自动配平：不用在群里算账。
- 分享好看：自动生成“缺F4/实付低/指定DM或NPC已定”的卡片。
- 成车有信用：展示成车率、复开次数、车头等级。
- 熟人池：常来的F4、CP位玩家可以一键邀请。

### 激励非恋陪玩家加入

- 先看实付价，而不是看复杂补贴。
- 可筛选“低价/免单/半价/F4有补”。
- 押金规则透明，避免上了又被临时踢。
- 座位风险透明：高光、红光、输出要求、边位提示。
- 低价位推荐：系统把缺口位置推给愿意吃补的玩家。

### 激励店家入驻

- 平台不是要抢店家生意，而是带来更高成车率。
- 店家看到“已有车头想在你店开车”的需求后更容易入驻。
- 店家可以减少无效沟通：时间、房间、DM/NPC一次确认。
- 数据看板能看到取消原因、缺口位置、热门本。
- 押金降低鸽子率。

### 激励DM/NPC入驻

- 被车头点名，形成可见需求。
- 个人主页可沉淀粉丝和代表作。
- 常约DM/NPC收藏让复约更顺。
- 代表作和复开记录展示，不做饭圈化打榜。
- 档期可控，避免私下重复沟通。

### 激励发行商入驻

- 剧本热度和成车数据可以反哺发行。
- 未授权店被频繁选择时，给发行商形成销售线索。
- 好组车的座位模板能成为剧本卖点。
- 不展示剧透内容，只展示无剧透卖点和座位结构。

## 11. 成长飞轮

```text
车头建车更方便
  -> 分享更多车
  -> F4看到低价更愿意上车
  -> 成车率提升
  -> 店家看到稳定订单愿意入驻
  -> DM/NPC获得曝光愿意维护主页和档期
  -> 车头更愿意指定店家和DM/NPC
  -> 更多车头复开和新车头加入
```

第一阶段不要把“店家入驻”作为前置条件。店家和剧本由系统管理员先录入，车头基于已有资料建车；缺资料时提交新增资料申请。DM/NPC可先作为本车快照，后续由本人微信登录后绑定演绎档案。

## 12. MVP范围

### 必做

- 微信登录。
- 系统管理员录入店家和剧本基础资料。
- 车头创建车。
- 车头选择已有剧本和店家；找不到时提交新增资料申请。
- DM/NPC可手动填写本车快照。
- 座位模板和座位补贴配置。
- 补贴合计为0的发布校验。
- 微信分享卡片、复制文案、分享海报。
- 玩家选择座位并申请上车。
- 车头审核、锁座、取消。
- 押金金额和押金状态记录。
- 我的报名、我的发车。

### 可后置

- 微信支付押金。
- 店家完整后台。
- DM/NPC完整档期。
- 发行商后台。
- 自动推荐补贴金额。
- 评价体系。
- 黑名单和信用分。
- 平台补贴，需重新做红包、交易和诱导分享合规评估。

### 第一版不做

- 剧本正文和剧透内容。
- 平台担保复杂分账。
- 按颜值筛人。
- 私人陪伴服务。
- 跨店复杂排班。

## 13. 关键体验细节

### 车详情页要让玩家3秒看懂

必须露出：

- 什么时候。
- 在哪里。
- 什么本。
- 谁带/谁演。
- 还缺什么位。
- 这个位我实际付多少钱。
- 是否要押金。

座位卡示例：

```text
F4-2 玩家CP位
原价 ¥200  补贴 -¥100  实付 ¥100
标签：玩家CP / 输出中 / 红光低 / 野车慎选
押金：¥50
```

### 车头建车页要防算错

补贴配置页固定显示：

```text
补贴合计：¥0
店家应收：¥1000
玩家实付合计：¥1000
```

当合计不为0时：

```text
还差 ¥100 未配平
请增加出补位置，或减少吃补位置
```

### 分享文案要像真实招募

示例：

```text
今晚 19:30｜情感本《XXX》
店家：朝阳区 XXX
指定NPC已定，缺 F4-2 / F4-3
F4实付 ¥100，押金 ¥50
点进来选位上车
```

## 14. 风险与边界

- “恋陪”“爱D”只用于内部研究和后台标签，公开文案优先使用“情感沉浸位”“指定DM/NPC”。
- 不承诺现实恋爱、身体接触或私人陪伴。
- 强互动座位要展示边界提醒。
- 未确认玩家不展示完整联系方式。
- DM/NPC是店家员工时，档期和预约需要店家确认，避免绕开店家。
- 评价体系要防止人身攻击、骚扰、造谣。
- 颜值筛选、看照、私密要求不作为平台鼓励功能。
- 押金和退款规则必须在报名之前展示。
- 所有用户输入内容上线前必须经过内容安全检测或人工审核。

## 15. 待确认问题

1. 第一版线下押金由谁收：车头还是店家？平台MVP不代收。
2. 车头建车后是否必须店家确认才能公开分享？
3. DM/NPC被指定时，MVP先用本车快照；后续本人微信登录绑定时，是否还需要店家确认？
4. 车头能否拒绝玩家，拒绝理由是否需要记录？
5. 非恋陪玩家享受低实付后跳车，座位价格调整和押金如何处理？
6. 店家未入驻但被车头手动录入时，是否允许公开展示店名？
7. 是否要支持“私密车”，只允许链接进入，不进入公开车列表？
8. F4位置允许实付为0，但不允许倒贴返现。
