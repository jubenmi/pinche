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
  - [x] 新增 `scripts/d50-album-single-media-sharing-check.js`，锁定 spec、focus 请求/响应、错误码、公开 video 路由、viewer share 和 CTA。
  - [ ] 将 D50 check、API/端侧单测语法检查纳入根 `check`。
  - [x] 扩展 D48 纯函数 smoke 或新增 D50 unit，覆盖 required image/video、30/3 上限、稳定次序和缺失目标。
  - [x] 新增 `apps/miniprogram/test/albumSingleMediaShare.test.mjs`，覆盖 ID、乱序 cache、dataset entry、路径和 focused DTO 查找。
  - [x] 运行新增检查，确认因实现缺失准确失败，而不是测试语法或 fixture 错误。
  - 2026-07-19：`npm run d50:check` 已再次运行；公开 video-url/video-file 服务端文字契约已满足，首个剩余失败为尚未实施的端侧 `source === "single_media_share"`，因此 D50.2 静态契约总检仍保持未完成。

- [x] D50.3 用 TDD 实现指定媒体公开快照。
  - [x] 扩展 `selectPublicShareMedia` 的 required media 输入，强制包含合规目标并维持 30/3 上限。
  - [x] `createOrReuseSessionAlbumPublicShare` 校验 focus ID，失败返回 409 `ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE`。
  - [x] share-token 路由解析可选 JSON body，并返回 `focus_media_id`。
  - [x] 普通空 body 整册分享、摘要复用、封面选择和 D48 顺序保持不变。
  - [x] 运行 D50 selector/API、D48、D23 定向回归并记录结果。

- [x] D50.4 用 TDD 实现快照绑定的公开视频播放。
  - [x] 新增 public ready video service getter，要求 v2 share、快照成员、published、ready 与当前隐私。
  - [x] 新增 public video-url capability 签发/验证，绑定 share/session/media/digest/purpose/expiry。
  - [x] 新增 `GET|HEAD` public video-file 路由，每次重新授权。
  - [x] 本地响应复用正确 HEAD/200/206/416 语义。
  - [x] COS 响应通过应用层代理 Range 字节，不输出对象 URL或 302。
  - [x] 运行 D50 video、D32、D42 API media/server/stream 回归并记录结果。
  - 2026-07-19：RED（退出码 1）：`node --test apps/api/test/album-single-media-share.test.mjs` 先准确报 `getPublicSessionAlbumVideoForPlayback` 未导出；追加 capability 测试后准确报 `signSessionAlbumPublicVideoFileToken` 未导出；追加 responder 测试后准确报 `createPublicAlbumVideoResponse` 未导出，均不是 fixture 或语法失败。
  - 2026-07-19：GREEN：同一 API 测试退出码 0，15/15 通过，覆盖 v2/revoked/snapshot/privacy/processing fail-closed、capability 签发/篡改/过期、路由合约、本地 HEAD/200/206/416 与 COS ETag-bound exact/full/suffix Range 和 1 MiB 分块；`node --check apps/api/src/modules/core/service.js`、`node --check apps/api/src/server.js` 与 `git diff --check` 均退出码 0。
  - 2026-07-19：`node scripts/d48-album-sharing-role-claim-separation-check.js` 退出码 0；`npm run d42:api-media` 47/47、`npm run d42:api-server` 14/14 与 `node scripts/d42-album-video-stream-check.js` 10/10 均退出码 0。`node scripts/d32-admin-album-video-smoke.js` 在 sandbox 因本地连接被拒绝、两次经授权重跑后在既有 localhost 环境失败：`GET /api/sessions/28`、`GET /api/sessions/29` 均得到 404；未修改 D32 或成员视频行为，D50.4 保持未完成，待可复现的 API/数据库 smoke 环境复跑。
  - 2026-07-19：审查补充 RED：新增大 206 Range、COS HEAD 非法元数据、取消与真实 HTTP route 测试后，focused API 测试准确失败为一次性大 Range 读取、400 元数据错误、取消未传播，以及 route 未使用 seam（403）；新增 D42 COS abort 断言也准确失败。GREEN：`node --test apps/api/test/album-single-media-share.test.mjs` 19/19 通过（需要 ephemeral localhost 权限），`node scripts/d42-album-video-server-check.js` 15/15 通过，覆盖大 206 的有序 1 MiB 分块、AbortSignal 销毁请求/响应且不启动下一块、route 的 video-url→GET/HEAD/206/416 与每次 file 请求重新授权、以及 malformed COS HEAD→502。
  - 2026-07-19：D32 改为 owner-authenticated 详情读取和真实 multipart MP4 上传，并增加 public video-url 返回 application video-file URL、无 COS URL 的断言。在当前 worktree API (`PORT=3028`) 上运行后，上传和创建请求成功，但当前本地媒体处理配置未使创建视频立即 ready，旧断言 `created ready video should include video-url path` 失败；D50.4 继续保持未完成。
  - 2026-07-19：复核即时 create response 的 `sessionAlbumVideoCreateResponse` 后确认它有 readiness metadata、没有 `video_url`；`video_url` 只在后续 authenticated album DTO 附加，既有 admin/member/public DTO 断言保留。D32 同步适配当前本地无 COS 快照 URL、异步删除 202 和 public cover 应用代理契约。以匹配 `SESSION_SECRET` 的 fresh current-worktree API (`PORT=3029`) 运行 `BASE_URL=http://localhost:3029 node scripts/d32-admin-album-video-smoke.js` 退出码 0，输出 `D32 admin album video smoke passed`，并实际断言 public video-url 返回无 COS 泄漏的 application video-file capability。最终 focused API 19/19、D48 check、D42 api-media 47/47、D42 api-server 15/15 和 stream 10/10 均退出码 0，D50.4 完成。
  - 2026-07-19：最终取消链补充：public responder 将 disconnect signal 也传入 COS HEAD；pending HEAD 中止会返回 `AbortError` 且不会开始 Range。focused API 更新为 20/20，D42 api-server 更新为 16/16；D32 未受 service/route/harness 改动影响，沿用本记录中已通过的 fresh API 结果。

- [x] D50.5 用 TDD 实现端侧纯分享状态。
  - [x] 新增 `albumSingleMediaShare.js` 的 ID、authority、cache、focused item 和 path helper。
  - [x] 乱序完成只能写自己的媒体 ID，当前 UI 只读取当前 ID。
  - [x] 目标不存在返回 null，不回退第一项。
  - [x] 运行端侧 unit 并确认红绿循环。
  - 2026-07-19：RED：`node --test apps/miniprogram/test/albumSingleMediaShare.test.mjs` 退出码 1，准确报 `albumSingleMediaShare.js` 缺失（`ERR_MODULE_NOT_FOUND`）；审查补充 pure-state 契约后同一命令再次按预期报缺少 `beginSingleMediaShareRequest` 与 `resetSingleMediaShareState` export，并在 reset 竞态回归中准确显示 serial 重复。GREEN：同一命令退出码 0，10/10 通过，覆盖正安全整数 ID、不可变 pure state、按媒体 ID 的乱序/同 ID stale resolve/reject、authority/pure reset 后 serial 单调、dataset 精确缓存查找、冻结的安全错误字段、无回退 focused DTO 查找和编码路径。`node --check apps/miniprogram/test/albumSingleMediaShare.test.mjs`、`node --check apps/miniprogram/src/utils/albumSingleMediaShare.js` 与 `git diff --check` 均退出码 0。

- [x] D50.6 实现成员预览器当前项分享。
  - [x] `AlbumImageViewer` 增加 share status、原生 share button、提示事件，不持有 API/token。
  - [x] album page 在 open/change 时按媒体 ID准备 focus snapshot 与安全卡片封面。
  - [x] `onShareAppMessage` 按 button dataset 精确读取 cache；页面菜单整册分享保持原状。
  - [x] blocked/failed/loading 状态不回退旧 token或其他媒体。
  - [x] 运行 viewer sequence、mini-program 静态和构建定向检查。

- [x] D50.7 实现公开单项模式与“查看完整相册”。
  - [x] onLoad 解析 `source=single_media_share` 与正整数 focus ID。
  - [x] 公共列表加载后只把目标单项传入 viewer，隐藏 counter/download/member actions。
  - [x] 目标不存在显示“该内容已不可查看”，不自动选择其他媒体。
  - [x] CTA 退出单项模式并展示已加载同一公开快照；整份 token 失效时不显示 CTA。
  - [x] ready 视频调用 public video-url，并复用一次刷新/重试状态机。
  - [x] 运行图片、视频、invalid focus、CTA 和竞态定向测试。
  - 2026-07-19：RED：扩展 `npm run d50:check` 后退出码 1，首个失败为 album page 尚未包含 `source === "single_media_share"`；审查补充 helper 契约后 `node --test apps/miniprogram/test/albumSingleMediaShare.test.mjs` 也按预期因缺少 focused public route/video guard export 退出码 1；button cache reset 的 fail-closed helper export 和 focused CTA 安全区/视频控件静态契约同样先按预期红灯。GREEN：`npm run d50:check` 与 helper 单测 15/15 均退出码 0，锁定 ID-bound request/response、button dataset cache reset 的 credential-free fail-closed payload、tokenless fail-closed public route、单项 snapshot projection、同媒体安全卡图 fallback、CTA 无请求/认证及安全区视频控件留白、native share、公开视频路由和晚到视频结果 guard。`node scripts/d31-album-viewer-sequence-check.js`、`node scripts/check-miniprogram.js`、`npm run d42:mini`、`node scripts/d32-admin-album-video-check.js` 与 `npm run build:mp-weixin` 均退出码 0；两个 Sass deprecation warning 为既有构建告警，未新增错误。本记录仅覆盖 helper/static integration 契约与构建回归；微信开发者工具真机/手工路径仍留在 D50.8。

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
