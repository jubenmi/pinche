# D23 Tasks: 相册分享与上车策略执行清单

更新日期：2026-07-04

## D23 执行任务

- [x] D23.1 建立 D23 spec 三件套。
  - [x] `requirements.md` 描述好友/群上车、朋友圈相册展示、上车策略和隐私要求。
  - [x] `design.md` 描述后端字段、加入服务、相册分享 token、公开相册接口和小程序页面分支。
  - [x] `tasks.md` 描述实现和验收清单。

- [x] D23.2 新增车局上车策略数据模型。
  - [x] 新增安全迁移，给 `sessions` 增加 `join_policy` 字段，默认 `review_required`。
  - [x] 后端新增 `normalizeJoinPolicy`。
  - [x] `createSession` 写入 `joinPolicy`。
  - [x] `updateSession` 可选更新 `joinPolicy`。
  - [x] `getSession` 返回 `join_policy`。
  - [x] 添加或更新静态检查，确认 `join_policy` 默认值和合法值校验存在。

- [x] D23.3 实现 direct/review 上车分支。
  - [x] 先写后端烟测或检查，覆盖 `direct` 车普通玩家可直接上车。
  - [x] 先写后端烟测或检查，覆盖 `review_required` 车普通玩家 direct claim 被拒绝。
  - [x] 抽出或复用统一加入座位服务，集中处理车局状态、座位状态、手机号和并发锁。
  - [x] `direct` 分支复用座位确认逻辑，写入 `approved` 报名和 `confirmed_user_id`。
  - [x] `review_required` 分支复用 `createSignup`，保留 pending 和车头审核。
  - [x] 确认待审核申请不授予完整相册权限。

- [x] D23.4 实现相册分享 token。
  - [x] 先写失败测试或烟测，确认无确认座位的用户不能签发 token。
  - [x] 新增 `POST /api/sessions/:id/album/share-token`。
  - [x] token 绑定 `sessionId`、发起分享人、确认座位和过期时间。
  - [x] token 使用 `config.sessionSecret` 签名。
  - [x] 返回 `share_subject`，包括角色名和座位名。

- [x] D23.5 实现朋友圈公开相册接口。
  - [x] 先写烟测，创建多张照片，确认只返回 token 绑定座位的照片。
  - [x] 新增 `GET /api/sessions/:id/album/public-share`。
  - [x] 校验 token 签名、过期时间和 `sessionId`。
  - [x] 过滤未标注照片、未标自己角色照片、只标 NPC/其他的照片。
  - [x] 保守复用现有相册隐私规则。
  - [x] 返回只读展示所需的车局、角色和照片字段。

- [x] D23.6 实现朋友圈公开图片接口。
  - [x] 新增 `GET /api/session-album/public-share/photos/:photoId/image`。
  - [x] 图片 token 绑定 photoId、相册分享 token 摘要和过期时间。
  - [x] 出图前重新确认照片仍属于公开分享集合。
  - [x] 确认普通完整相册图片 token 不能访问公开接口。
  - [x] 确认公开图片 token 不能越权访问其他照片。

- [x] D23.7 增加创建车局上车权限设置。
  - [x] `pages/session/setup.vue` 增加 `需要车头审核` 和 `可直接上车` 二选一控件。
  - [x] 默认选择 `需要车头审核`。
  - [x] 创建车局请求带上 `joinPolicy`。
  - [x] 创建成功后本地 flow 保存 `joinPolicy`。
  - [x] 确认现有发车流程在不操作该控件时行为不变。

- [x] D23.8 改造相册页分享能力。
  - [x] `pages/session/album.vue` 支持 member mode 和 timeline mode。
  - [x] member mode 保留现有登录、上传、删除、标注、多选和隐私设置。
  - [x] timeline mode 不强制登录。
  - [x] timeline mode 请求公开相册接口。
  - [x] timeline mode 隐藏上传、删除、标注、多选、隐私设置和上车按钮。
  - [x] `onShareAppMessage` 返回 `pages/session/share?id=...&entry=album...`。
  - [x] `onShareTimeline` 只返回 query，不返回 path。
  - [x] 朋友圈 query 包含 `source=wechat_timeline` 和 `albumShareToken`。

- [x] D23.9 改造分享页复用上车流程。
  - [x] `pages/session/share.vue` 识别 `entry=album`。
  - [x] `entry=album` 打开时加载车局并判断当前用户是否已上车。
  - [x] 已上车用户自动进入完整相册。
  - [x] 未登录用户看到登录后查看相册或上车提示。
  - [x] 未上车用户继续使用现有角色选择 UI。
  - [x] 确认角色后调用后端统一加入结果。
  - [x] `joined` 结果进入相册。
  - [x] `pending_review` 结果显示等待车头审核。

- [x] D23.10 更新静态检查和烟测。
  - [x] 更新 `scripts/check-miniprogram.js` 检查相册好友/群分享 path。
  - [x] 检查相册朋友圈分享只使用 query。
  - [x] 检查朋友圈只读模式不强制登录。
  - [x] 检查分享页支持 `entry=album`。
  - [x] 检查分享页支持 direct 和 review 结果分支。
  - [x] 新增 `scripts/d23-album-share-join-policy-check.js` 或合并到现有检查。
  - [x] 新增后端烟测脚本覆盖 direct、review 和公开相册 token。
  - [x] 将 D23 检查加入 `npm run check`。

- [x] D23.11 执行自动验证。
  - [x] 运行 `npm run check`。
  - [x] 运行 `npm run build:mp-weixin`。
  - [x] 运行 D23 后端烟测。
  - [x] 修复 D23 范围内导致的检查、烟测或构建失败。

- [x] D23.12 微信开发者工具验证。
  - [x] `review_required` 车从相册分享到群，未上车用户提交申请后等待车头审核（后端 smoke 验证 pending 分支，分享页静态检查验证等待文案）。
  - [x] `review_required` 车审核通过前，申请人不能查看完整相册（后端 smoke 验证 pending 不授予完整相册权限）。
  - [x] `direct` 车从相册分享到群，未上车用户选角色后直接进入相册（后端 smoke 验证 joined 分支，微信开发者工具验证群分享入口页展示可直接上车）。
  - [x] 从相册分享到朋友圈，未登录访问者看到只读相册展示（微信开发者工具验证）。
  - [x] 朋友圈只读页不展示上传、删除、标注、多选、隐私设置和上车按钮（微信开发者工具验证）。
  - [x] 朋友圈只读页只展示发起分享人角色相关照片（微信开发者工具验证，后端 smoke 验证只返回发起分享人绑定座位照片）。

## D23 验收

- [x] D23 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D23 design 已落地到 [design.md](./design.md)。
- [x] D23 tasks 已落地到本文件。
- [x] 车局支持 `direct` 和 `review_required` 上车策略。
- [x] `review_required` 车继续走申请和车头审核。
- [x] `direct` 车允许普通玩家直接上车。
- [x] 相册发给好友或群聊会进入上车流程。
- [x] 相册分享到朋友圈会进入只读相册展示。
- [x] 朋友圈公开相册只展示发起分享人角色相关照片。
- [x] 朋友圈公开相册不展示完整车内相册或上车入口。
- [x] 完整相册权限和隐私规则不被公开分享绕过。
- [x] `npm run check` 通过。
- [x] `npm run build:mp-weixin` 通过。

## 验证记录

- `npm run check`：通过（2026-07-04）。
- `npm run build:mp-weixin`：通过（2026-07-04）。
- D23 后端烟测：`node scripts/d23-album-share-join-policy-smoke.js` 通过（2026-07-04，`directSessionId=41`，`reviewSessionId=40`，`publicPhotoId=547`）。
- 微信开发者工具验证：通过（2026-07-04）。打开 dev 构建 `apps/miniprogram/dist/dev/mp-weixin`，本地 API 指向 `http://localhost:3018`；`D23 朋友圈只读相册` 场景进入 `pages/session/album`，展示“沈青的相册”“朋友圈只读展示”“展示 1 张”和“包含 沈青”，未出现上传、删除、标注、多选、隐私设置或上车入口；`D23 群分享上车` 场景进入 `pages/session/share`，展示未登录提示、车局信息、角色选择和“可直接上车”策略。
