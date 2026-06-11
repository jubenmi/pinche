# 身份与认领模型

更新日期：2026-06-11

本文定义小程序里的“人”和“资料”的边界。核心原则：DM、NPC、玩家、车头、系统管理员都是微信用户；剧本和店家是纯数据资料。MVP阶段，剧本和店家先由系统管理员录入，后续再开放认领。

## 1. 核心原则

### 人都是微信用户

```text
User
  -> Player
  -> Organizer
  -> Performer: DM / NPC
  -> SystemAdmin
```

小程序不能自动获取用户的原始微信号字符串。系统身份以微信登录后的 `openid` 和平台自己的 `user_id` 为准；手机号、微信联系方式只能在用户主动授权或主动填写时保存。

因此：

- 玩家报名必须对应一个 `user_id`。
- 车头建车必须对应一个 `user_id`。
- DM/NPC如果入驻，必须对应一个 `user_id`。
- 系统管理员也必须对应一个 `user_id`，通过 `system_admin` 角色获得资料录入权限。
- 一个微信用户可以同时是玩家、车头、DM、NPC；系统管理员角色只授予内部运营人员。

### 剧本和店家是资料

```text
Script
Store
```

剧本和店家不是微信用户本身，而是可被维护的资料实体。

因此：

- MVP阶段，剧本和店家由系统管理员录入。
- 车头不能直接创建公开可选的剧本和店家。
- 车头找不到店家或剧本时，提交新增资料申请。
- 系统管理员审核申请后录入或驳回。
- 后续店家负责人可以认领店家。
- 后续发行商或授权维护者可以认领剧本。
- 认领后才能修改更多字段、展示认证状态或管理资料。

## 2. MVP处理方式

### 玩家

玩家从分享页进入，点击“我要上车”后登录并生成或读取 `User`。

```text
wx.login
  -> openid
  -> User
  -> Signup
```

报名记录必须绑定 `user_id`，联系方式另存为加密字段，不公开展示。

### 车头

车头也是普通 `User`，首次建车时自动获得 `organizer` 身份。

```text
UserRole
- user_id
- role: organizer
```

车头建车时只能选择管理员已录入的 `Store` 和 `Script`。如果找不到目标店家或剧本，车头提交 `CatalogRequest`，不直接写入正式资料表。

### 系统管理员

系统管理员也是微信用户，但通过内部配置获得 `system_admin` 身份。

```text
UserRole
- user_id
- role: system_admin
```

MVP阶段，系统管理员负责：

- 录入店家基础资料。
- 录入剧本基础资料。
- 审核车头提交的新增店家/剧本申请。
- 处理店家、剧本认领申请。
- 修正错误资料、下架违规资料。

### DM/NPC

DM/NPC也是微信用户，不作为纯文本资料长期存在。

MVP允许车头在建车时手动填写DM/NPC名称，但这只是本车快照，不等于已入驻资料：

```text
dm_name_snapshot
npc_name_snapshot
dm_user_id: nullable
npc_user_id: nullable
```

如果DM/NPC本人打开邀请并登录，可以把该快照绑定到自己的 `PerformerProfile`，之后再展示为“已绑定/已确认”。

未绑定前：

- 不展示头像。
- 不展示真实姓名。
- 不展示“官方认证”。
- 不开放档期管理。
- 不自动生成个人主页。

### 店家

店家是 `Store` 数据。

MVP只允许系统管理员创建正式店家资料：

```text
Store
- id
- name
- city
- district
- claim_status: unclaimed
- created_by_admin_user_id
```

店家负责人后续用微信登录后提交认领：

```text
EntityClaim
- entity_type: store
- entity_id
- claimant_user_id
- status: pending | approved | rejected
```

认领通过后，店家负责人获得 `store_admin` 身份。

### 剧本

剧本是 `Script` 数据。

MVP只允许系统管理员创建最小剧本资料：

```text
Script
- id
- name
- type_tags
- player_count
- claim_status: unclaimed
- created_by_admin_user_id
```

发行商、作者授权方或平台运营可后续认领剧本资料。认领前只展示无剧透基础信息，不展示封面、正文、角色卡、剧透内容。

## 3. 推荐数据模型

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

### user_roles

```text
id
user_id
role: player | organizer | performer | store_admin | publisher_admin | system_admin
status: active | disabled
created_at
```

### performer_profiles

```text
id
user_id
stage_name
performer_types: dm | npc
city
store_id
claim_status: claimed
visibility
created_at
updated_at
```

### stores

```text
id
name
city
district
address
claim_status: unclaimed | pending | claimed | rejected
created_by_admin_user_id
claimed_by_user_id
created_at
updated_at
```

### scripts

```text
id
name
type_tags
player_count
summary_no_spoiler
claim_status: unclaimed | pending | claimed | rejected
created_by_admin_user_id
claimed_by_user_id
created_at
updated_at
```

### catalog_requests

```text
id
request_type: store | script
requested_by_user_id
name
city
district
description
status: pending | approved | rejected
reviewed_by_admin_user_id
review_note
created_entity_id
created_at
reviewed_at
```

### entity_claims

```text
id
entity_type: store | script
entity_id
claimant_user_id
claim_reason
evidence_text
status: pending | approved | rejected
review_note
created_at
reviewed_at
```

### sessions

```text
id
organizer_user_id
script_id
script_name_snapshot
store_id
store_name_snapshot
dm_user_id
dm_name_snapshot
npc_user_id
npc_name_snapshot
start_at
status
created_at
```

## 4. 产品规则

- 所有人物身份都从微信登录开始。
- 不把DM/NPC做成可随便编辑的纯数据主页。
- 车头手填DM/NPC只用于本车展示和邀请本人绑定。
- MVP阶段，店家和剧本由系统管理员录入，车头只能选择或提交新增资料申请。
- 店家和剧本后续可由真实负责人认领。
- 未认领资料不得展示“官方”“认证”“授权”等字样。
- 认领流程不进入MVP主链路，但数据结构要预留；管理员审核入口需要预留。
