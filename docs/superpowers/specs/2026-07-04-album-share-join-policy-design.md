# 相册分享与上车策略实现设计

日期：2026-07-04

## 结论

相册分享分成两条明确路径：

- 发给好友或群聊：用于邀请别人上车，落到现有 `pages/session/share` 选角色/选座位流程。
- 分享到朋友圈：用于公开展示发起分享人自己角色相关照片，落在相册页的只读展示模式，不提供上车入口。

上车行为由车局配置决定，而不是由分享渠道临时判断。新增车局级 `join_policy`：

- `direct`：玩家选中开放座位后直接上车。
- `review_required`：玩家选中开放座位后提交申请，等待车头审核。

历史车局默认 `review_required`，延续当前安全行为。

## 背景

当前系统已有三块能力：

- `pages/session/share`：分享票和角色选择页，已经能让玩家登录后选择座位并提交 `POST /api/signups`。
- `pages/session/album`：同车成员相册页，强制登录并依赖现有相册隐私模型。
- 后端 `signups` 和 `session_seats`：支持待审核申请、车头审核、确认座位、相册成员权限。

新的产品诉求是从相册页发起分享：

1. 分享到群或好友时，别人打开后进入上车路径。
2. 分享到朋友圈时，别人打开后只能看相册展示，且只展示“发起分享人的角色”相关照片。
3. 有些车允许玩家直接上车，有些车仍需要车头审核。
4. 上车逻辑要尽可能复用发车前拼车逻辑。

微信平台限制也影响设计：`onShareAppMessage` 可以自定义 `path`，适合跳转到上车页；`onShareTimeline` 不能自定义 `path`，只能给当前页附加 `query`，适合让相册页自身切到朋友圈展示模式。

## 目标

1. 从相册页分享到好友或群聊时，打开者按登录和上车状态进入正确路径。
2. 从相册页分享到朋友圈时，打开者看到公开只读相册展示，不看到上传、标注、隐私设置和上车按钮。
3. 朋友圈展示只包含发起分享人的角色相关照片，不包含发起分享人上传的其他人照片。
4. 车局可配置上车策略：直接上车或车头审核。
5. 上车接口、页面状态和车头管理尽量复用现有 `signups`、`claim`、`share.vue` 和 `manage.vue`。
6. 相册完整权限仍只授予同车成员，朋友圈公开展示不扩大车内完整相册权限。

## 非目标

- 不做公开相册广场。
- 不做跨车局相册流。
- 不在朋友圈展示完整车内相册。
- 不识别微信群主身份；这里的“群主/车头”统一指系统里的车局 `organizer_user_id`。
- 不把朋友圈展示页做成可报名页面。
- 不增加分享奖励、诱导分享或裂变权益。

## 核心术语

| 名称 | 含义 |
| --- | --- |
| 车头 | 系统里的车局组织者 `sessions.organizer_user_id` |
| 发起分享人 | 在相册页点分享的当前登录用户 |
| 访问者 | 打开分享链接的人，可登录也可未登录 |
| 好友/群聊分享 | 微信 `onShareAppMessage`，可以自定义 path |
| 朋友圈分享 | 微信 `onShareTimeline`，不能自定义 path，只能自定义 query |
| 完整相册 | 现有登录成员相册，按同车成员和隐私设置展示 |
| 公开相册展示 | 朋友圈只读展示，只展示分享 token 允许的角色照片 |

## 产品规则

### 好友或群聊分享：上车路径

从相册页发给好友或群聊时，分享卡打开路径为：

```text
/pages/session/share?id=<session_id>&entry=album&shareCode=<share_code>&source=wechat_share
```

打开后按以下规则处理：

1. 已登录且已是该车同车成员：直接进入 `/pages/session/album?id=<session_id>`。
2. 未登录：展示登录提示；用户点击登录后重新判断。
3. 已登录但未上车：展示现有角色/座位选择页面。
4. 车局 `join_policy = direct`：确认座位后直接上车，成功后进入相册。
5. 车局 `join_policy = review_required`：确认座位后提交待审核申请，提示等待车头确认。

好友和群聊都走同一条 `onShareAppMessage` 路径。若后续需要严格区分群聊，可在分享菜单开启 `withShareTicket` 并额外记录群来源，但上车权限不依赖微信群身份。

### 朋友圈分享：只读相册展示

从相册页分享到朋友圈时，分享回到当前相册页，并带上公开展示 query：

```text
id=<session_id>&source=wechat_timeline&albumShareToken=<token>
```

打开后按以下规则处理：

1. 页面进入 `timeline` 只读模式。
2. 不强制登录。
3. 不展示 `AuthIdentityBar` 的主动登录要求，或保持为弱身份展示。
4. 不展示上传、删除、标注、多选、隐私设置、上车按钮。
5. 只请求朋友圈公开相册接口。
6. 只展示分享 token 绑定的发起分享人角色相关照片。
7. 如果 token 无效、过期或没有可展示照片，展示温和空态，不回退到完整相册。

朋友圈只读展示的文案应强调“角色相册”而不是“车内完整相册”，例如：

```text
TA 的角色相册
这些照片里出现了这位角色。
```

## 上车策略设计

### 数据字段

在 `sessions` 增加字段：

```sql
join_policy VARCHAR(32) NOT NULL DEFAULT 'review_required'
```

合法值：

- `direct`
- `review_required`

后端需要有归一化函数：

```text
normalizeJoinPolicy(value)
  empty -> review_required
  direct -> direct
  review_required -> review_required
  otherwise -> 400
```

旧车局没有显式选择时按 `review_required` 处理。

### 创建和管理入口

`pages/session/setup.vue` 在创建车局时提供上车权限设置：

- `需要车头审核`：默认选中，对应 `review_required`。
- `可直接上车`：对应 `direct`。

提交 `POST /api/sessions` 时带上 `joinPolicy`。

车头管理页可以后续支持修改 `join_policy`。本次实现优先在创建时设置；如果同时支持管理页修改，只允许车头或管理员修改，且不改变已确认/已待审申请的既有状态。

### 后端加入服务

为了复用逻辑，后端抽出一个内部服务：

```text
joinSessionSeat(user, seatId, body)
  -> 校验手机号
  -> 锁定同车座位
  -> 读取 seat + session
  -> 校验车局是否接收上车
  -> 校验座位是否可选择
  -> 按 session.join_policy 分支
```

共同校验沿用现有发车前拼车规则：

- 车局 `recruiting` 时可申请开放座位。
- 车局 `locked` 且已到 `start_at` 时，可对开放座位补位。
- `confirmed`、`locked`、`cancelled` 座位不可被普通玩家选择。
- 用户如果已确认其他座位，直接上车时释放旧确认座位；审核模式通过审核时释放旧确认座位。

分支行为：

```text
review_required:
  复用 createSignup
  signups.status = pending
  seat.status 从 open 变为 applied
  返回 { join_result: "pending_review", signup }

direct:
  复用 claimSessionSeat 的确认座位逻辑
  signups.status = approved
  seat.status = confirmed
  seat.confirmed_user_id = user.id
  返回 { join_result: "joined", seat }
```

`POST /api/signups` 保持审核模式入口；`POST /api/session-seats/:id/claim` 在 `join_policy = direct` 时允许普通玩家直接上车，在 `review_required` 时继续拒绝普通玩家直接占座。车头和管理员仍可使用直接分配能力。

小程序 `share.vue` 不应复制上车规则，只根据后端返回的 `join_result` 展示文案和跳转。

## 相册分享 token 设计

朋友圈公开相册需要后端签发 token，不能信任 query 里的 `userId` 或 `seatId`。

### 签发

新增接口：

```text
POST /api/sessions/:id/album/share-token
```

要求：

- 必须登录。
- 必须是该车相册成员。
- 必须能找到发起分享人在该车中的角色身份：
  - 优先使用已确认/已锁定座位。
  - 车头如果同时有座位，用座位角色。
  - 车头无座位时，不签发角色相册 token，返回 400 或前端隐藏朋友圈分享入口。

返回：

```json
{
  "session_id": 123,
  "token": "opaque-token",
  "expires_at": "2026-08-03T12:00:00.000Z",
  "share_subject": {
    "type": "seat",
    "seat_id": 456,
    "role_name": "沈青"
  }
}
```

token 使用 HMAC 或随机 opaque token 均可。推荐 HMAC，避免新增表：

```text
payload = base64url(JSON.stringify({
  sessionId,
  sharerUserId,
  seatId,
  exp
}))
signature = hmac_sha256(payload, config.sessionSecret)
token = payload.signature
```

### 公开只读接口

新增接口：

```text
GET /api/sessions/:id/album/public-share?token=<token>
```

不要求登录。

校验：

- token 签名有效。
- token 未过期。
- token 的 `sessionId` 等于路径里的 `id`。
- token 的 `seatId` 仍属于该车。
- 车局未取消。
- 相册已开放。

照片过滤：

- 只返回 `active` 照片。
- 必须存在照片标签 `tag_type = seat` 且 `seat_id = token.seatId`。
- 不返回未标注照片。
- 不返回仅由发起分享人上传但没有标到自己角色的照片。
- 继续尊重现有隐私规则：若照片上传者或被标注用户不允许公开可见，则不出现在公开分享里。

为支持公开展示，需要在隐私规则里明确“朋友圈公开可见”的含义。推荐本阶段保守处理：

- 只有当照片标签包含发起分享人的座位时才有资格展示。
- 若照片还标注了其他真实玩家，必须同时满足这些被标注玩家的 `allow_tagged_visible = true`。
- 上传者的 `allow_uploaded_visible` 也必须为 true，除非上传者就是发起分享人且照片标注了发起分享人的座位。
- `other`、`npc`、`session_npc_role` 可作为附加标签，但不能单独让照片进入公开展示。

返回字段只包含展示所需内容：

```json
{
  "session_id": 123,
  "script_name_snapshot": "青蛇",
  "store_name_snapshot": "某店",
  "start_at": "2026-07-04 14:00:00",
  "share_subject": {
    "role_name": "沈青",
    "seat_name": "角色A"
  },
  "visible_count": 12,
  "photos": [
    {
      "id": 1,
      "image_width": 1200,
      "image_height": 1600,
      "created_at": "2026-07-04 18:00:00",
      "preview_url": "/api/session-album/public-share/photos/1/image?...",
      "thumbnail_url": "/api/session-album/public-share/photos/1/image?...&variant=thumbnail"
    }
  ]
}
```

### 公开图片访问

现有相册图片接口要求登录成员，不适合朋友圈。新增公开分享图片接口：

```text
GET /api/session-album/public-share/photos/:photoId/image?token=<media_token>&variant=thumbnail|preview
```

`media_token` 必须绑定：

- `photoId`
- `albumShareToken` 或其摘要
- 过期时间

服务端取图前再次校验该照片仍属于 token 允许的公开照片集合，避免只靠列表接口泄漏图片地址。

## 小程序页面设计

### `pages/session/album.vue`

新增两种模式：

```text
member mode:
  现有完整相册
  需要登录
  同车成员权限
  可上传/标注/删除/隐私设置

timeline mode:
  朋友圈只读展示
  不强制登录
  使用 albumShareToken
  只显示公开照片瀑布流和基础车局信息
```

模式判断：

```text
isTimelineShare = options.source === "wechat_timeline" || Boolean(options.albumShareToken)
```

`onShareAppMessage`：

```js
return {
  title: `${scriptName}｜${storeName}｜相册邀请`,
  path: `/pages/session/share?id=${sessionId}&entry=album&shareCode=${shareCode}&source=wechat_share`,
  imageUrl: shareImage // 固定安全封面，不使用当前相册页截图
}
```

`onShareTimeline`：

```js
return {
  title: `${roleName} 的相册｜${scriptName}`,
  query: `id=${sessionId}&source=wechat_timeline&albumShareToken=${token}`,
  imageUrl: shareImage
}
```

朋友圈分享前需要确保已有 token：

- `onLoad` 或 `onShow` 中尝试签发 token。
- 如果当前用户没有角色身份，则隐藏朋友圈分享入口或分享标题降级，但不能生成可看他人照片的 token。
- token 签发失败不影响完整相册使用，只影响朋友圈分享能力。

### `pages/session/share.vue`

新增 `entry` 参数：

- `entry=album`：来自相册群/好友分享。
- 缺省：现有发车前分享票逻辑。

打开 `entry=album` 时：

1. 加载车局。
2. 如果本地已有登录态，调用会员判断或从 `GET /api/sessions/:id` 补充判断；若已上车，跳转相册。
3. 未登录时不立即阻断页面浏览，展示登录后查看相册/上车的提示。
4. 用户选择角色并确认时，调用统一加入接口。
5. 后端返回 `joined`：跳转相册。
6. 后端返回 `pending_review`：留在分享页，展示等待车头审核。

角色卡状态需要区分：

- `open`：可选。
- `applied`：待审核。
- `confirmed`：已上车。
- `locked`：已锁定。
- 当前用户已确认座位：显示“我已上车”，并提供进入相册主按钮。

## 后端接口清单

新增：

- `POST /api/sessions/:id/album/share-token`
- `GET /api/sessions/:id/album/public-share`
- `GET /api/session-album/public-share/photos/:photoId/image`

调整：

- `POST /api/sessions` 接收 `joinPolicy`。
- `PATCH /api/sessions/:id` 可选接收 `joinPolicy`，仅车头/管理员可改。
- `GET /api/sessions/:id` 返回 `join_policy`。
- `POST /api/session-seats/:id/claim` 按 `join_policy` 决定普通玩家是否可直接上车。
- `POST /api/signups` 继续作为审核申请入口。

## 数据和迁移

新增迁移：

```sql
ALTER TABLE sessions
  ADD COLUMN join_policy VARCHAR(32) NOT NULL DEFAULT 'review_required'
  AFTER visibility;
```

如果字段已存在，迁移脚本应安全跳过。

不新增相册分享 token 表；使用 HMAC token 即可。

## 错误和边界

- 朋友圈 token 无效：展示“相册分享已失效”。
- 朋友圈 token 过期：展示“相册分享已过期，请让车友重新分享”。
- 分享人没有确认座位：不生成朋友圈角色相册 token。
- 相册未开放：朋友圈展示“相册会在发车后开放”。
- 没有符合条件的照片：展示“还没有这位角色的公开照片”。
- 访问者已登录且已上车，但从朋友圈打开：仍先展示朋友圈只读模式，不自动暴露完整相册；可提供“打开小程序查看完整相册”弱按钮，在普通模式下进入完整相册。
- `direct` 上车时座位并发被抢：后端返回 409，前端提示“这个角色刚被选走了”并刷新角色状态。
- `review_required` 申请重复：后端返回 409 或复用既有 pending，前端提示“已提交申请，等待车头审核”。

## 合规与隐私

- 朋友圈文案不含诱导分享、奖励、红包、返现。
- 朋友圈公开页不展示联系方式、真实手机号、车内完整成员列表。
- 朋友圈公开页不展示未标注照片。
- 朋友圈公开页不因为访问者登录就扩大到完整相册。
- 完整相册仍由登录态和同车成员权限控制。
- 上车权限以后端 `join_policy` 为准，前端只展示结果。

## 测试与验收

### 后端

1. 新建车局不传 `joinPolicy` 时，返回 `join_policy = review_required`。
2. 新建车局传 `direct` 时，普通玩家可通过 claim 直接确认座位。
3. `review_required` 车局中，普通玩家调用 claim 被拒绝，调用 `POST /api/signups` 创建 pending。
4. `direct` 车局中，玩家确认座位后 `session_seats.confirmed_user_id` 为该用户，`signups.status = approved`。
5. `review_required` 车局中，玩家申请后不获得相册成员权限，直到车头 approve。
6. 相册分享 token 只能由同车且有确认座位的用户签发。
7. 公开相册接口只返回标注了 token 座位的照片。
8. 发起分享人上传但未标自己角色的照片不会出现在朋友圈公开相册。
9. 公开图片接口不能用普通相册图片 token 访问，也不能越权访问不在公开集合里的照片。

### 小程序

1. 相册页发给好友或群聊时，分享路径是 `pages/session/share`，不是朋友圈只读相册。
2. 相册页分享到朋友圈时，query 含 `source=wechat_timeline` 和 `albumShareToken`，且不包含自定义 `path`。
3. 群/好友打开后，已上车用户进入完整相册。
4. 群/好友打开后，未登录用户看到登录提示，登录后重新判断。
5. 群/好友打开后，未上车用户看到角色选择。
6. `direct` 车局确认角色后进入相册。
7. `review_required` 车局确认角色后显示等待车头审核。
8. 朋友圈打开后不展示上传、删除、标注、多选、隐私设置、上车按钮。
9. 朋友圈打开后只展示发起分享人角色相关照片。

### 检查脚本

现有检查脚本需要从“禁止 share.vue 调用直接 claim”调整为：

- 要求 `share.vue` 保留 `POST /api/signups` 审核分支。
- 要求 `share.vue` 支持 `direct` 分支。
- 要求相册页 `onShareAppMessage` 指向 `pages/session/share`。
- 要求相册页 `onShareTimeline` 只返回 `query`，不返回 `path`。
- 要求朋友圈只读模式不触发强制登录。

## 实施顺序建议

1. 后端迁移和 `join_policy` 读写。
2. 后端统一加入服务和 direct/review 分支测试。
3. 相册分享 token 与公开只读相册接口。
4. 小程序创建车局上车策略设置。
5. 小程序 `share.vue` 复用上车流程并处理 `entry=album`。
6. 小程序 `album.vue` 增加好友/群分享和朋友圈只读模式。
7. 更新检查脚本和烟测。

## 自检

- 本设计明确区分好友/群聊分享和朋友圈分享。
- 好友/群聊分享承担上车功能，朋友圈分享只承担相册展示。
- 朋友圈展示绑定发起分享人的角色，不信任前端传入的用户或座位 ID。
- 上车策略是车局配置，前后端都以后端结果为准。
- 直接上车和车头审核复用现有座位、报名、审核和相册成员模型。
- 历史车局默认审核，不改变当前安全行为。
