# D50 Tasks：相册单项媒体分享执行清单

更新日期：2026-07-19

版本：v1.0

> **实施要求：** 严格按本清单执行并实时勾选。每个业务能力先建立失败测试或失败契约，再写最小实现；未经确认不新增页面、数据库表、互动、公开下载、分享奖励或第二套权限模型。

## D50 执行任务

- [x] D50.1 建立并复核正式 spec 与实施计划。
  - [x] requirements.md 覆盖图片/视频当前项分享、CTA、隐私、失败与验收。
  - [x] design.md 明确一份快照两种展示、公开视频 capability、组件边界和竞态控制。
  - [x] tasks.md 建立 Kiro 风格 TDD 清单和非目标约束。
  - [x] implementation plan 映射到精确文件、RED/GREEN 命令与提交边界。
  - [x] 逐条对照现有代码，确认本期无需迁移、新页面或新表。

- [ ] D50.2 先建立失败契约与纯函数红灯。
  - 2026-07-19：`node --check scripts/d50-album-single-media-sharing-check.js` 已通过。已运行 `npm run d50:check`，静态契约按预期红灯，首个失败为 service 缺少 `ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE`，并非规格或脚本语法错误。D50.2 仍待端侧单测和根 check wiring，保持未完成。
  - 2026-07-19：RED：`node --test apps/api/test/album-single-media-share.test.mjs` 退出码 1；selector 测试准确显示 `requiredMediaId` 尚未影响选择（要求图片 ID 1 实际首项为 35，required ready 视频 ID 100 未进入快照），并非语法或 fixture 加载失败。GREEN：同一命令退出码 0，8/8 通过，且执行了 focus-first 快照持久化/复用和 eligibility 后 409；在临时 worktree API 上运行 `SESSION_SECRET=local-development-session-secret-change-before-production BASE_URL=http://localhost:3028 node scripts/d48-album-sharing-role-claim-separation-smoke.js` 退出码 0，覆盖空 body 的 `focus_media_id: null`、numeric focus 回显与快照包含、以及 unavailable focus HTTP 409/error code；`node scripts/d23-album-share-join-policy-check.js`、修改 JS 的 `node --check` 和 `git diff --check` 均退出码 0。
  - [ ] 新增 `scripts/d50-album-single-media-sharing-check.js`，锁定 spec、focus 请求/响应、错误码、公开 video 路由、viewer share 和 CTA。
  - [ ] 将 D50 check、API/端侧单测语法检查纳入根 `check`。
  - [x] 扩展 D48 纯函数 smoke 或新增 D50 unit，覆盖 required image/video、30/3 上限、稳定次序和缺失目标。
  - [ ] 新增 `apps/miniprogram/test/albumSingleMediaShare.test.mjs`，覆盖 ID、乱序 cache、dataset entry、路径和 focused DTO 查找。
  - [x] 运行新增检查，确认因实现缺失准确失败，而不是测试语法或 fixture 错误。

- [x] D50.3 用 TDD 实现指定媒体公开快照。
  - [x] 扩展 `selectPublicShareMedia` 的 required media 输入，强制包含合规目标并维持 30/3 上限。
  - [x] `createOrReuseSessionAlbumPublicShare` 校验 focus ID，失败返回 409 `ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE`。
  - [x] share-token 路由解析可选 JSON body，并返回 `focus_media_id`。
  - [x] 普通空 body 整册分享、摘要复用、封面选择和 D48 顺序保持不变。
  - [x] 运行 D50 selector/API、D48、D23 定向回归并记录结果。

- [ ] D50.4 用 TDD 实现快照绑定的公开视频播放。
  - [ ] 新增 public ready video service getter，要求 v2 share、快照成员、published、ready 与当前隐私。
  - [ ] 新增 public video-url capability 签发/验证，绑定 share/session/media/digest/purpose/expiry。
  - [ ] 新增 `GET|HEAD` public video-file 路由，每次重新授权。
  - [ ] 本地响应复用正确 HEAD/200/206/416 语义。
  - [ ] COS 响应通过应用层代理 Range 字节，不输出对象 URL或 302。
  - [ ] 运行 D50 video、D32、D42 API media/server/stream 回归并记录结果。

- [ ] D50.5 用 TDD 实现端侧纯分享状态。
  - [ ] 新增 `albumSingleMediaShare.js` 的 ID、authority、cache、focused item 和 path helper。
  - [ ] 乱序完成只能写自己的媒体 ID，当前 UI 只读取当前 ID。
  - [ ] 目标不存在返回 null，不回退第一项。
  - [ ] 运行端侧 unit 并确认红绿循环。

- [ ] D50.6 实现成员预览器当前项分享。
  - [ ] `AlbumImageViewer` 增加 share status、原生 share button、提示事件，不持有 API/token。
  - [ ] album page 在 open/change 时按媒体 ID准备 focus snapshot 与安全卡片封面。
  - [ ] `onShareAppMessage` 按 button dataset 精确读取 cache；页面菜单整册分享保持原状。
  - [ ] blocked/failed/loading 状态不回退旧 token或其他媒体。
  - [ ] 运行 viewer sequence、mini-program 静态和构建定向检查。

- [ ] D50.7 实现公开单项模式与“查看完整相册”。
  - [ ] onLoad 解析 `source=single_media_share` 与正整数 focus ID。
  - [ ] 公共列表加载后只把目标单项传入 viewer，隐藏 counter/download/member actions。
  - [ ] 目标不存在显示“该内容已不可查看”，不自动选择其他媒体。
  - [ ] CTA 退出单项模式并展示已加载同一公开快照；整份 token 失效时不显示 CTA。
  - [ ] ready 视频调用 public video-url，并复用一次刷新/重试状态机。
  - [ ] 运行图片、视频、invalid focus、CTA 和竞态定向测试。

- [ ] D50.8 完成专项、全量和微信开发者工具验收。
  - [ ] 运行 D50 check 与新增 unit/API 测试。
  - [ ] 运行 D48、D23、D31、D32、D42 定向回归。
  - [ ] 运行完整 `npm run check`，退出码为 0。
  - [ ] 运行 `npm run build:mp-weixin`，退出码为 0。
  - [ ] 微信开发者工具验证图片分享完整路径。
  - [ ] 微信开发者工具验证 ready 视频播放、拖动、刷新/重试和 CTA。
  - [ ] 验证撤销、删除、审核撤回与隐私变化后旧链接关闭式失效。
  - [ ] 将命令、结果、限制和任何经批准偏差记录到本文件。

## D50 验收清单

- [ ] 成员可从全屏预览分享当前已公开图片或 ready 视频。
- [ ] 分享卡不会因快速滑动或乱序请求指向错误媒体。
- [ ] 接收者初始只看到目标媒体，不能左右浏览其他项。
- [ ] “查看完整相册”进入同一份公开只读快照，无需登录。
- [ ] 指定目标不突破 30 项、3 视频、审核和隐私一票否决。
- [ ] 公开视频通过 v2 快照 capability 与应用层 Range 代理播放，不泄漏 COS URL。
- [ ] 目标失效不回退其他媒体；整份 share 失效时隐藏 CTA。
- [ ] 现有整册/朋友圈分享、D48、viewer 和成员视频行为不回归。
- [ ] `npm run check` 与 `npm run build:mp-weixin` 通过。

## 验证记录

- 2026-07-19：用户确认单项媒体接收体验、`查看完整相册` CTA、一份公开快照两种展示模式、技术边界及失败/测试标准；正式 D50 spec 正在建立，业务实现尚未开始。
- 2026-07-19：D50 requirements/design/tasks 与详细 implementation plan 完成自检；已确认只扩展现有 D48 快照、相册页和 viewer，不新增迁移、新页面或新表。
