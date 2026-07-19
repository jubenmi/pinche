# D48 Tasks：相册分享与角色认领分流执行清单

更新日期：2026-07-19

版本：v1.0

> **实施要求：** 按顺序执行并实时维护本清单。每个业务任务先建立失败测试或失败契约，再写最小实现；除本文件明确列出的兼容调整外，不扩大相册、邀请、内容审核或报名范围。

## D48 执行任务

- [x] D48.1 建立并复核 D48 spec 三件套。
  - [x] `requirements.md` 明确相册分享/角色邀请分流、公开范围、隐私一票否决、快照和封面规则。
  - [x] `design.md` 明确复用 D18/D23/D40 的最小实现路径、数据模型、token、页面和兼容方案。
  - [x] `tasks.md` 建立 Kiro 风格 TDD 执行与验收清单。
  - [x] 确认本期不新增相册页面、认领状态机、AI 选图、人物识别或服务端封面文字排版。

- [ ] D48.2 先建立失败契约和快照迁移。
  - [ ] 新增 `scripts/d48-album-sharing-role-claim-separation-check.js`，断言 D48 spec、迁移、服务函数、v2 claims、好友公开相册路径、安全封面和邀请菜单契约存在。
  - [ ] 更新 `package.json`，把 D48 静态检查和 smoke 语法检查加入根 `check`，不得删除 D18/D23/D40/D45/D46 回归。
  - [ ] 运行 `node scripts/d48-album-sharing-role-claim-separation-check.js`，确认先因缺少迁移与实现失败，而不是脚本语法错误。
  - [ ] 新增 `apps/api/migrations/0032_session_album_public_shares.sql`，只创建 `session_album_public_shares` 及设计中列出的索引/外键。
  - [ ] 扩展迁移测试或静态检查，验证 `media_ids`、`snapshot_digest`、`cover_media_ids`、`revoked_at` 与 30 天过期字段存在。
  - [ ] 运行 API 迁移测试和 D48 检查，确认迁移子项转绿，后续业务契约仍按预期失败。

- [ ] D48.3 用 TDD 实现公开资格与隐私一票否决。
  - [ ] 在 `scripts/d48-album-sharing-role-claim-separation-smoke.js` 先建立失败用例：分享者角色照可见、分享者上传场景照可见、无关他人照片不可见、未标注不可见。
  - [ ] 增加失败用例：上传者关闭 `allow_uploaded_visible` 时始终排除，包括上传者本人分享。
  - [ ] 增加失败用例：任一标签用户关闭 `allow_tagged_visible` 时整项排除，包括分享者本人关闭和多人合照一人关闭。
  - [ ] 增加失败用例：已确认席位标签缺失 `user_id` 时关闭式排除，NPC/场景/`other` 无真实用户时不产生个人否决。
  - [ ] 修改 `apps/api/src/modules/core/service.js` 的 `isAlbumPhotoVisibleInPublicShare`，实现“分享者席位或分享者上传”及无本人例外的统一门禁。
  - [ ] 确保图片、ready 视频、公开列表、单媒体读取和封面选择调用同一门禁；不得只在列表层过滤。
  - [ ] 运行 `node scripts/d48-album-sharing-role-claim-separation-smoke.js` 的隐私子集，确认全部转绿。
  - [ ] 运行 D18、D23、D45、D46 相册/审核定向回归，确认完整相册和未批准媒体门禁不变。

- [ ] D48.4 用 TDD 实现有界公开快照。
  - [ ] 先增加失败用例，证明创建分享时最多选择 30 项、视频最多 3 项，且三个优先级和时间/ID 次序稳定。
  - [ ] 先增加失败用例，证明分享后新增、批准或补标注的媒体不进入旧快照。
  - [ ] 先增加失败用例，证明快照内媒体隐私关闭、删除或审核撤回后从旧分享消失。
  - [ ] 在 `apps/api/src/modules/core/service.js` 新增 `selectPublicShareMedia`、`createOrReuseSessionAlbumPublicShare` 与 `loadSessionAlbumPublicShare` 的有界实现。
  - [ ] 严格校验数据库 `media_ids` 为 1–30 个去重正整数；非法或越界快照关闭式失败。
  - [ ] 以规范化媒体 ID、封面 ID 集合、分享者和席位计算 `snapshot_digest`，复用相同且未过期的最近快照。
  - [ ] 快照选择阶段按优先级挑选，公开 DTO 阶段按 `created_at ASC, id ASC` 输出。
  - [ ] 运行 D48 smoke 快照子集，确认上限、稳定顺序、复用和动态收紧全部转绿。

- [ ] D48.5 用 TDD 升级相册 token 与公开媒体边界。
  - [ ] 先扩展 `scripts/d23-album-share-join-policy-check.js` 和 D48 检查，允许历史 D23 断言被 D48 新路径明确替代，但不得删除 token 签名和公开媒体二次校验。
  - [ ] 先增加失败用例：v2 token 必须包含 `version=2` 与 `shareId`；邀请 token 不能读相册，相册 token 不产生邀请授权。
  - [ ] 先增加失败用例：快照外 photoId 即使当前满足隐私，也不能通过公开媒体接口读取。
  - [ ] 修改 `apps/api/src/server.js` 的相册 claims 归一化、签发与验证，使新 token 绑定 share/session/sharer/seat/expiry。
  - [ ] 修改 `POST /api/sessions/:id/album/share-token`，调用快照服务并返回 share、subject、safe owner、counts 与 cover URL。
  - [ ] 修改 `GET /api/sessions/:id/album/public-share` 和公开图片/视频 getter，先验证快照成员关系再签发或读取媒体。
  - [ ] 保留部署前 D23 相册 token 的只读兼容分支；兼容分支也应用 D48 审核和隐私一票否决。
  - [ ] 对空候选返回 `409 ALBUM_PUBLIC_SHARE_EMPTY`，不得签发空 token。
  - [ ] 新增 `DELETE /api/sessions/:id/album/public-shares`，只允许当前分享者幂等撤销自己在该车局的全部新版有效快照。
  - [ ] 所有 v2 列表、封面和单媒体读取检查 `revoked_at IS NULL`；撤销后重新分享生成新 shareId，旧 shareId 不恢复。
  - [ ] 运行 D23、D40、D48 token 与匿名访问 smoke，确认旧链接兼容、新链接固定快照、邀请相册隔离。

- [ ] D48.6 用 TDD 实现相册照片封面。
  - [ ] 先增加失败用例：分享者本人上传且仅标自己角色的图片优先进入封面候选。
  - [ ] 先增加失败用例：没有人物图时可使用分享者上传的纯 NPC/场景/道具图；合照、他人上传图和快照外图不能进入候选。
  - [ ] 先增加失败用例：同级候选按像素面积、创建时间和 ID 稳定选择，最多返回 9 张；无候选返回空 `cover_url`。
  - [ ] 先为纯布局 helper 增加 1–9 张失败用例，锁定 `1`、`2`、`3`、`2+2`、`3+2`、`3+3`、`3+3+1`、`3+3+2`、`3+3+3`，不足一行时左对齐且不补图。
  - [ ] 在 `apps/api/src/modules/core/service.js` 新增 `selectPublicShareCoverMedia`，并确保每个 `cover_media_ids` 都包含在快照 `media_ids` 中。
  - [ ] 在 `apps/api/src/server.js` 新增 `GET /api/session-album/public-shares/:shareId/cover`，短期 token 绑定 shareId 与完整封面 ID 集合摘要。
  - [ ] 复用 Sharp/COS 图片读取链路，把每张图片自动旋转并中心裁切成正方形，再按 1–9 张固定宫格合成、限尺寸、压缩和 strip 元数据，不创建原图直链。
  - [ ] 合成前逐张二次执行普通公开资格与严格封面资格；任意一张失效时整个封面关闭式失败，不临时换图或缩减宫格。
  - [ ] 修改分享 token 响应或相邻有界 helper，返回可供小程序 `apiUrl()` 规范化的短期合成封面 URL。
  - [ ] 运行 D48 封面 smoke 和 COS/local 图片定向测试，确认 1–9 布局、相同隐私规则、短期 token 和品牌图降级。

- [ ] D48.7 收窄公开 DTO 并补公开相册头部。
  - [ ] 先增加失败契约，证明公开响应不含上传者 ID/昵称、其他用户标签、对象 Key/ETag、作者私有字段和精确 `start_at`。
  - [ ] 修改 `apps/api/src/modules/core/service.js` 的公开媒体 DTO，把 `tags` 固定为空数组并只保留渲染需要的媒体字段。
  - [ ] 在公开相册响应中返回安全 `share_owner`、`share_subject`、北京时间 `played_on`、photo/video/total counts。
  - [ ] 确认头像只使用已批准的用户头像公开路径，不返回 openid、手机号或内部图片资产字段。
  - [ ] 修改 `apps/miniprogram/src/pages/session/album.vue`，在只读模式展示分享者、角色、剧本、店名、日期和数量的紧凑头部。
  - [ ] 将“朋友圈只读展示”文案改为渠道无关的“公开只读展示”，继续隐藏成员操作和隐藏数量。
  - [ ] 修改 `apps/miniprogram/src/pages/session/albumPrivacy.vue`，增加二次确认的“停止我的相册分享”，调用撤销接口但不修改两项隐私开关。
  - [ ] 运行 D46 公共泄漏检查、D48 DTO 检查及小程序构建，确认没有作者私有或成员字段泄漏。

- [ ] D48.8 把好友/群聊相册分享改为公开相册。
  - [ ] 先更新 `scripts/check-miniprogram.js` 与 D48 检查，使旧 `/pages/session/share?entry=album` 新生成路径按预期失败。
  - [ ] 修改 `apps/miniprogram/src/pages/session/album.vue`，保存 `shareCoverUrl`、快照计数和分享者资料，并用 token 预取结果控制分享菜单。
  - [ ] 修改 `onShareAppMessage`，路径指向 `/pages/session/album`，携带 `source=wechat_share` 和 `albumShareToken`。
  - [ ] 保留 `onShareTimeline` query 方式，携带 `source=wechat_timeline` 和相同 token。
  - [ ] 好友标题使用“我在《剧本名》中饰演「角色名」｜游玩相册”；朋友圈标题使用“这一晚，我是「角色名」｜《剧本名》”。
  - [ ] 两类分享均使用 `shareCoverUrl || /static/art/ticket-landscape.jpg`，不得回退到实时页面截图。
  - [ ] token 未准备好或空快照时不生成邀请链接，显示明确的标注/隐私提示。
  - [ ] 保留历史 `entry=album` 接收兼容，但确认新代码不再生成该参数。
  - [ ] 运行 `node scripts/check-miniprogram.js`、D23/D48 静态检查和 `npm run build:mp-weixin`。

- [ ] D48.9 将角色邀请限制为好友和群聊。
  - [ ] 先增加失败契约，证明 `pages/session/share.vue` 仍生成 `join-invite-token`，但不再注册 `shareTimeline` 菜单。
  - [ ] 修改 `apps/miniprogram/src/pages/session/share.vue` 的页面标题和说明，明确该页面用于邀请好友认领角色。
  - [ ] 修改 `showShareMenus()`，只开放 `shareAppMessage`；移除或禁用邀请页的 `onShareTimeline` 输出。
  - [ ] 为邀请 `onShareAppMessage` 增加固定安全票根 `imageUrl`，不得使用相册公开封面。
  - [ ] 保留 `join-invite-token`、实时角色板、手机号门禁、`direct` 与 `pending_review` 结果处理。
  - [ ] 运行 D23、D25、D29、D40 加入/邀请回归，确认邀请不预占角色且审核前无完整相册权限。

- [ ] D48.10 完成专项、全量和微信开发者工具验收。
  - [ ] 运行 `node scripts/d48-album-sharing-role-claim-separation-check.js`。
  - [ ] 运行 `node scripts/d18-session-album-privacy-check.js`、`node scripts/d23-album-share-join-policy-check.js` 与 `node scripts/d40-guest-calendar-home-check.js`。
  - [ ] 运行 `node scripts/d48-album-sharing-role-claim-separation-smoke.js`，记录通过数量和隔离数据库目标。
  - [ ] 运行相册图片、视频、COS、D45、D46 公共泄漏与作者私有相关定向测试。
  - [ ] 验证停止分享后新版公开列表、封面和已签发媒体 URL 立即失效，再次分享只生成新链接。
  - [ ] 运行完整 `npm run check`，退出码必须为 0。
  - [ ] 运行 `npm run build:mp-weixin`，退出码必须为 0。
  - [ ] 在微信开发者工具验证成员相册分享给好友、群聊和朋友圈都打开相同公开快照，且无认领入口。
  - [ ] 验证相册照片封面、场景照片封面和品牌封面三种路径，确认合照不会成为外部封面。
  - [ ] 验证角色邀请只显示好友/群聊分享，direct/review 两条认领结果保持现状。
  - [ ] 将命令、构建、开发者工具和发现的限制记录到本文件“验证记录”。

## D48 验收清单

- [ ] 好友、群聊和朋友圈相册分享均打开同一只读公开相册。
- [ ] 相册分享与角色邀请使用不同入口、页面和 token purpose。
- [ ] 公开范围为“分享者角色标注或分享者上传”，且未标注媒体不公开。
- [ ] 上传者和每个角色拥有者的隐私均为无例外一票否决。
- [ ] 公开快照最多 30 项、视频最多 3 项，后续新媒体不进入旧快照。
- [ ] 快照内媒体在隐私、删除或审核变化后立即停止公开。
- [ ] 分享者可在现有隐私页停止本场全部新版相册分享，旧链接立即失效且不会复活。
- [ ] 相册封面使用最多 9 张由分享者本人上传的安全照片，按朋友圈 1–9 图布局合成；合照与他人照片不作封面。
- [ ] 无安全封面时稳定降级现有票根图。
- [ ] 公开 DTO 和页面不泄漏其他玩家、原标签、精确时间、对象字段或作者私有内容。
- [ ] 角色邀请只支持好友和群聊，继续复用 direct/review 认领流程。
- [ ] 部署前 D23 相册 token 在原过期时间内可只读兼容。
- [ ] D18、D23、D31、D32、D40、D45、D46 回归通过。
- [ ] `npm run check` 与 `npm run build:mp-weixin` 通过。

## 验证记录

- 2026-07-19：完成 D48 spec 三件套；当前只修改 `specs/d48-album-sharing-role-claim-separation/`，未修改业务代码、数据库迁移、构建产物或生产环境。
