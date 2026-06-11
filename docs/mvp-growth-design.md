# MVP与增长设计

更新日期：2026-06-11

目标：用最小功能验证“车头愿意建车、玩家愿意从分享链接加车、补贴能促进F4/普通位上车、车能更快满”。

本文是 [情感本拼车小程序产品设计](./mini-program-product-design.md) 的MVP收敛版。

微信小程序平台约束见：[微信小程序实现约束与设计修正](./wechat-miniprogram-design-notes.md)。
合规禁区见：[微信小程序合规护栏](./wechat-compliance-guardrails.md)。

## 1. 增长黑客原则摘取

这类产品的增长不应该靠买量，而应该把分享做进核心使用流程。

从增长黑客和病毒循环的经典经验里，适合本产品的原则是：

- 增长要内建在产品动作里。用户完成核心任务时，自然产生分享，而不是做完产品后再外加营销。
- 病毒循环是“用户使用产品 -> 分享给网络 -> 新用户进入 -> 新用户继续分享”。本产品天然适合，因为每辆车都需要拉人。
- 增长反馈只能服务业务状态，比如告诉用户“本车还差几人”“你带来的访问是否有人报名”，不能把分享次数兑换现金、权益、优先级或抽奖机会。
- AARRR指标可作为MVP仪表盘：获取、激活、留存、收入、推荐。第一版最重要的是激活和推荐。

落到微信小程序时，增长不能设计成“强制分享后解锁”。分享应来自真实业务需要：车头缺人、玩家希望满车、DM/NPC希望帮忙扩散。MVP不做现金红包、邀请奖励、分享奖励、分享排行榜。

## 2. MVP一句话

让车头在3分钟内建一辆车，并生成可分享的“缺口座位卡”，让玩家从微信群或私聊点进来直接选位上车。

## 3. MVP不做什么

为了最小可用，第一版不做：

- 店家后台。
- DM/NPC后台。
- 发行商后台。
- 完整剧本库。
- 微信支付分账。
- 自动推荐算法。
- 复杂评价体系。
- 黑名单系统。
- 站内聊天。
- 真实身份认证。

第一版由系统管理员先录入店家和剧本基础资料，车头基于已有资料建车。车头找不到店家或剧本时提交新增资料申请，由管理员审核录入。DM/NPC是微信用户，手填名称只作为本车快照，后续由本人登录后绑定演绎档案。

## 4. MVP只做五类页面

### 页面0：管理员资料录入

面向系统管理员。

功能：

```text
录入店家
录入剧本
审核新增资料申请
下架错误资料
```

### 页面1：建车

面向车头。

字段：

```text
本名
店家
时间
DM
NPC/爱D
座位数量
押金金额
备注
```

座位配置：

```text
座位名
座位类型：情感沉浸位 / F4 / CP位 / 普通 / 边位
原价
补贴调整
实付价
输出要求：低 / 中 / 高
是否已有人
```

发布校验：

```text
所有座位补贴调整合计必须等于0
每个座位实付价必须大于等于0
```

### 页面2：车详情/分享落地页

面向从微信群、私聊、朋友圈海报点进来的玩家。

首屏只回答7个问题：

```text
什么本？
什么时候？
在哪个店？
谁带/谁演？
还缺什么位？
这个位实付多少钱？
押金多少？
```

座位卡示例：

```text
F4-2｜玩家CP位
原价 ¥200｜补贴 -¥100｜实付 ¥100
输出：中｜红光：低｜押金 ¥50
[我要上车]
```

### 页面3：申请上车

字段尽量少：

```text
昵称
手机号或微信联系方式
选择座位
是否接受反串
输出自评：安静 / 正常 / 主动
边界备注
押金状态：未付 / 已线下付 / 待确认
```

MVP可以先做“线下押金确认”，减少支付开发和合规复杂度。

### 页面4：我的车/车头管理

车头看到：

```text
已确认座位
待审核申请
押金状态
补贴合计
分享次数
浏览人数
上车人数
```

操作：

```text
通过
拒绝
锁座
取消座位
复制招募文案
生成分享海报
```

## 5. 最小数据模型

MVP只需要这些表。

```text
User
- id
- openId
- nickname
- avatarUrl
- phoneEncrypted
- createdAt
```

```text
UserRole
- id
- userId
- role: player | organizer | performer | store_admin | publisher_admin | system_admin
- status
- createdAt
```

```text
PerformerProfile
- id
- userId
- stageName
- performerTypes: dm | npc
- city
- storeId
- claimStatus: claimed
- visibility
- createdAt
```

```text
Store
- id
- name
- city
- district
- claimStatus: unclaimed | pending | claimed | rejected
- createdByAdminUserId
- claimedByUserId
- createdAt
```

```text
Script
- id
- name
- typeTags
- playerCount
- claimStatus: unclaimed | pending | claimed | rejected
- createdByAdminUserId
- claimedByUserId
- createdAt
```

```text
CatalogRequest
- id
- requestType: store | script
- requestedByUserId
- name
- city
- district
- status: pending | approved | rejected
- reviewedByAdminUserId
- createdEntityId
- createdAt
```

```text
Session
- id
- organizerUserId
- scriptId
- scriptNameSnapshot
- storeId
- storeNameSnapshot
- startAt
- dmUserId
- dmNameSnapshot
- npcUserId
- npcNameSnapshot
- depositAmount
- status: draft | recruiting | locked | completed | cancelled
- visibility: public | link_only
- note
- createdAt
```

```text
SessionSeat
- id
- sessionId
- seatName
- seatType: romance | f4 | cp | normal | side
- basePrice
- adjustment
- payablePrice
- outputLevel: low | medium | high
- romanceHighlightLevel: none | low | medium | high
- status: open | applied | confirmed | locked | cancelled
- confirmedUserId
```

```text
Signup
- id
- sessionId
- seatId
- userId
- nickname
- contactEncrypted
- outputSelfRating
- acceptCrossGenderRole
- boundaryNote
- depositStatus: none | offline_pending | offline_confirmed | refunded | forfeited
- status: pending | approved | rejected | withdrawn | no_show
- createdAt
```

```text
ShareEvent
- id
- sessionId
- inviterUserId
- shareType: group | moment | direct | poster | copy_text
- shareCode
- shareScene
- shareTicketHash
- path
- seatId
- viewedUserId
- convertedSignupId
- createdAt
```

```text
EntityClaim
- id
- entityType: store | script
- entityId
- claimantUserId
- status: pending | approved | rejected
- createdAt
```

## 6. 增长闭环设计

### 闭环A：车头分享缺口

触发点：

- 建车成功。
- 有人上车。
- 还差F4。
- 临近开车还没满。

分享内容自动变化：

```text
初始：今晚情感本开车，指定NPC已定，缺F4
进展：已上3/5，剩2个F4，实付¥100
临车：今晚19:30，差1个F4，实付¥100
满车：已满车，下次蹲车点这里
```

增长价值：每一次车况变化都给车头一个合理分享理由。

### 闭环B：低价位吸引非恋陪玩家

F4/普通玩家不关心复杂补贴，关心实付。

产品要突出：

```text
实付 ¥0
实付 ¥50
半价
有补贴
缺F4
```

落地页排序默认把低实付、急缺位置放前面。

增长价值：便宜位置自带传播力，适合被转发给“想便宜玩本”的朋友。

### 闭环C：指定玩家上车

车头可以给某个位置生成专属邀请：

```text
我想邀请你上 F4-2
实付 ¥100
今晚 19:30
点这里确认
```

该链接打开后直接定位到对应座位。

增长价值：私聊邀请的转化率通常高于群发。

### 闭环D：玩家帮忙拉人

已上车玩家也有动力分享，因为车不满就开不了。

功能：

- 已上车玩家可分享“还差谁”的卡片。
- 如果通过他的分享进来的人上车，记录贡献。

MVP不发钱、不发权益，只展示车况贡献：

```text
你帮本车拉来1位玩家
本车还差1人
```

该贡献只用于车况统计，不兑换现金、补贴、优先锁座、信用加分、抽奖机会或其他权益。

### 闭环E：DM/NPC被点名分享

当车指定某个DM/NPC时，可以生成：

```text
今晚有车点名我带《XXX》
还差2个F4
```

MVP不需要DM/NPC后台，可以先让车头复制文案给DM/NPC转发。

增长价值：DM/NPC的粉丝和熟客能成为新增玩家来源。

## 7. 分享物料

### 小程序分享能力

MVP使用微信小程序原生转发能力：

```text
button open-type="share"
Page.onShareAppMessage
自定义 title
自定义 path
自定义 imageUrl
```

分享路径：

```text
/pages/session/detail?id={sessionId}&shareCode={shareCode}
/pages/session/detail?id={sessionId}&shareCode={shareCode}&seatId={seatId}
```

自定义分享图必须使用不含个人隐私的统一模板，不直接截取含联系方式、报名备注、押金转账信息的页面。

### 群分享标题

模板：

```text
缺F4｜今晚19:30《本名》｜实付¥100
```

可测试标题：

```text
指定NPC已定，缺2个F4，实付¥100
今晚情感本差1，F4实付¥100
情感本缺F4，半价上车
```

### 朋友圈海报

海报必须包含：

- 本名。
- 时间。
- 店家区域。
- 剩余座位。
- 最低实付价。
- 指定DM/NPC是否已定。
- 小程序码或可识别的小程序入口。

不要包含：

- 剧透角色名。
- 真实手机号。
- 微信号。
- 报名备注。
- 押金转账信息。
- 过度暧昧或现实陪伴承诺。

### 复制招募文案

车头一键复制：

```text
【北京情感本发车】
本：XXX
时间：今晚19:30
店：朝阳 XXX
指定NPC：已定
车况：已上3/5，缺F4-2、F4-3
F4实付：¥100，押金¥50
小程序选位：{链接}
```

## 8. MVP指标

第一版只看这些指标。

### 获取 Acquisition

- 分享页访问人数。
- 每辆车平均分享次数。
- 每个分享渠道访问量：群、私聊、海报、复制文案。

### 激活 Activation

- 访问车详情后点击“我要上车”的比例。
- 申请上车完成率。
- 车头建车完成率。

### 推荐 Referral

- 每辆车带来的新用户数。
- 每个已上车玩家的二次分享数。
- 分享到申请的转化率。

### 留存 Retention

- 车头7天内复建车率。
- 玩家30天内再次申请上车率。

### 收入 Revenue

MVP可先不收平台佣金，但要记录：

- 成车数。
- 店家理论应收。
- 押金金额。
- 补贴流动金额。

## 9. MVP成功标准

建议用一组很朴素的标准验证：

```text
10个真实车头愿意建车
50辆车被创建
平均建车时间小于3分钟
每辆车平均被分享3次以上
分享页到申请上车转化率大于10%
30%以上的车能满车或接近满车
至少5个DM/NPC主动绑定演绎档案，或店家/剧本维护方主动要求认领资料
```

达到这些，再做店家后台和DM/NPC主页才有意义。

## 10. 第一周开发切片

### Day 1-2：建车和座位

- 微信登录：`wx.login -> 后端换 openId -> 业务 token`。
- 创建车。
- 增删座位。
- 原价、补贴、实付计算。
- 补贴合计为0校验。

### Day 3：分享落地页

- 车详情页。
- 座位卡。
- 我要上车。
- `open-type="share"` 分享标题、路径和复制文案。
- 专属座位分享路径。

### Day 4：报名和车头审核

- 报名表。
- 手机号授权或手动联系方式兜底。
- 申请成功后请求审核结果订阅消息。
- 申请列表。
- 通过/拒绝/锁座。
- 押金状态手动标记。

### Day 5：增长埋点

- 生成分享码。
- 记录访问。
- 记录来源。
- 记录分享路径和座位来源。
- 统计每辆车分享、访问、申请、成车。

### Day 6-7：打磨真实发车体验

- 分享海报。
- 车况变化文案。
- 我的车。
- 种子车头试用。

## 11. MVP已确定的边界

1. MVP押金只记录线下状态，不接微信支付，不由平台代收。
2. 车详情页默认链接访问，不进入复杂公开车列表。
3. 车头必须审核，玩家不能直接锁座。
4. 允许实付为0的座位。
5. 补贴后最低只做到0元，不允许倒返钱、返现、提现。
6. 不做分享奖励、订阅奖励、邀请红包、抽奖活动。

## 12. 参考资料

- Growth hacking 概念和“把增长做进产品”思路：https://en.wikipedia.org/wiki/Growth_hacking
- Viral loop/viral expansion loop 思路：https://www.wired.com/story/pass-it-on-the-power-of-viral-loops
- AARRR指标框架：https://pt.wikipedia.org/wiki/AARRR
