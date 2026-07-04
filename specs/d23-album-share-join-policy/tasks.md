# D23 Tasks: 相册分享与上车策略执行清单

更新日期：2026-07-04

## D23 执行任务

- [x] D23.1 建立 D23 spec 三件套。
  - [x] `requirements.md` 描述好友/群上车、朋友圈相册展示、上车策略和隐私要求。
  - [x] `design.md` 描述后端字段、加入服务、相册分享 token、公开相册接口和小程序页面分支。
  - [x] `tasks.md` 描述实现和验收清单。

- [ ] D23.2 新增车局上车策略数据模型。
  - [ ] 新增安全迁移，给 `sessions` 增加 `join_policy` 字段，默认 `review_required`。
  - [ ] 后端新增 `normalizeJoinPolicy`。
  - [ ] `createSession` 写入 `joinPolicy`。
  - [ ] `updateSession` 可选更新 `joinPolicy`。
  - [ ] `getSession` 返回 `join_policy`。
  - [ ] 添加或更新静态检查，确认 `join_policy` 默认值和合法值校验存在。

- [ ] D23.3 实现 direct/review 上车分支。
  - [ ] 先写后端烟测或检查，覆盖 `direct` 车普通玩家可直接上车。
  - [ ] 先写后端烟测或检查，覆盖 `review_required` 车普通玩家 direct claim 被拒绝。
  - [ ] 抽出或复用统一加入座位服务，集中处理车局状态、座位状态、手机号和并发锁。
  - [ ] `direct` 分支复用座位确认逻辑，写入 `approved` 报名和 `confirmed_user_id`。
  - [ ] `review_required` 分支复用 `createSignup`，保留 pending 和车头审核。
  - [ ] 确认待审核申请不授予完整相册权限。

- [ ] D23.4 实现相册分享 token。
  - [ ] 先写失败测试或烟测，确认无确认座位的用户不能签发 token。
  - [ ] 新增 `POST /api/sessions/:id/album/share-token`。
  - [ ] token 绑定 `sessionId`、发起分享人、确认座位和过期时间。
  - [ ] token 使用 `config.sessionSecret` 签名。
  - [ ] 返回 `share_subject`，包括角色名和座位名。

- [ ] D23.5 实现朋友圈公开相册接口。
  - [ ] 先写烟测，创建多张照片，确认只返回 token 绑定座位的照片。
  - [ ] 新增 `GET /api/sessions/:id/album/public-share`。
  - [ ] 校验 token 签名、过期时间和 `sessionId`。
  - [ ] 过滤未标注照片、未标自己角色照片、只标 NPC/其他的照片。
  - [ ] 保守复用现有相册隐私规则。
  - [ ] 返回只读展示所需的车局、角色和照片字段。

- [ ] D23.6 实现朋友圈公开图片接口。
  - [ ] 新增 `GET /api/session-album/public-share/photos/:photoId/image`。
  - [ ] 图片 token 绑定 photoId、相册分享 token 摘要和过期时间。
  - [ ] 出图前重新确认照片仍属于公开分享集合。
  - [ ] 确认普通完整相册图片 token 不能访问公开接口。
  - [ ] 确认公开图片 token 不能越权访问其他照片。

- [ ] D23.7 增加创建车局上车权限设置。
  - [ ] `pages/session/setup.vue` 增加 `需要车头审核` 和 `可直接上车` 二选一控件。
  - [ ] 默认选择 `需要车头审核`。
  - [ ] 创建车局请求带上 `joinPolicy`。
  - [ ] 创建成功后本地 flow 保存 `joinPolicy`。
  - [ ] 确认现有发车流程在不操作该控件时行为不变。

- [ ] D23.8 改造相册页分享能力。
  - [ ] `pages/session/album.vue` 支持 member mode 和 timeline mode。
  - [ ] member mode 保留现有登录、上传、删除、标注、多选和隐私设置。
  - [ ] timeline mode 不强制登录。
  - [ ] timeline mode 请求公开相册接口。
  - [ ] timeline mode 隐藏上传、删除、标注、多选、隐私设置和上车按钮。
  - [ ] `onShareAppMessage` 返回 `pages/session/share?id=...&entry=album...`。
  - [ ] `onShareTimeline` 只返回 query，不返回 path。
  - [ ] 朋友圈 query 包含 `source=wechat_timeline` 和 `albumShareToken`。

- [ ] D23.9 改造分享页复用上车流程。
  - [ ] `pages/session/share.vue` 识别 `entry=album`。
  - [ ] `entry=album` 打开时加载车局并判断当前用户是否已上车。
  - [ ] 已上车用户自动进入完整相册。
  - [ ] 未登录用户看到登录后查看相册或上车提示。
  - [ ] 未上车用户继续使用现有角色选择 UI。
  - [ ] 确认角色后调用后端统一加入结果。
  - [ ] `joined` 结果进入相册。
  - [ ] `pending_review` 结果显示等待车头审核。

- [ ] D23.10 更新静态检查和烟测。
  - [ ] 更新 `scripts/check-miniprogram.js` 检查相册好友/群分享 path。
  - [ ] 检查相册朋友圈分享只使用 query。
  - [ ] 检查朋友圈只读模式不强制登录。
  - [ ] 检查分享页支持 `entry=album`。
  - [ ] 检查分享页支持 direct 和 review 结果分支。
  - [ ] 新增 `scripts/d23-album-share-join-policy-check.js` 或合并到现有检查。
  - [ ] 新增后端烟测脚本覆盖 direct、review 和公开相册 token。
  - [ ] 将 D23 检查加入 `npm run check`。

- [ ] D23.11 执行自动验证。
  - [ ] 运行 `npm run check`。
  - [ ] 运行 `npm run build:mp-weixin`。
  - [ ] 运行 D23 后端烟测。
  - [ ] 修复 D23 范围内导致的检查、烟测或构建失败。

- [ ] D23.12 微信开发者工具验证。
  - [ ] `review_required` 车从相册分享到群，未上车用户提交申请后等待车头审核。
  - [ ] `review_required` 车审核通过前，申请人不能查看完整相册。
  - [ ] `direct` 车从相册分享到群，未上车用户选角色后直接进入相册。
  - [ ] 从相册分享到朋友圈，未登录访问者看到只读相册展示。
  - [ ] 朋友圈只读页不展示上传、删除、标注、多选、隐私设置和上车按钮。
  - [ ] 朋友圈只读页只展示发起分享人角色相关照片。

## D23 验收

- [x] D23 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D23 design 已落地到 [design.md](./design.md)。
- [x] D23 tasks 已落地到本文件。
- [ ] 车局支持 `direct` 和 `review_required` 上车策略。
- [ ] `review_required` 车继续走申请和车头审核。
- [ ] `direct` 车允许普通玩家直接上车。
- [ ] 相册发给好友或群聊会进入上车流程。
- [ ] 相册分享到朋友圈会进入只读相册展示。
- [ ] 朋友圈公开相册只展示发起分享人角色相关照片。
- [ ] 朋友圈公开相册不展示完整车内相册或上车入口。
- [ ] 完整相册权限和隐私规则不被公开分享绕过。
- [ ] `npm run check` 通过。
- [ ] `npm run build:mp-weixin` 通过。

## 验证记录

- `npm run check`：未执行，待实现后运行。
- `npm run build:mp-weixin`：未执行，待实现后运行。
- D23 后端烟测：未执行，待实现后运行。
- 微信开发者工具验证：未执行，待实现后走查。
