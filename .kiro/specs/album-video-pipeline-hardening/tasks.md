# 相册视频链路加固任务

更新日期：2026-07-10

## 事实来源

- 需求：`requirements.md`
- 设计：`design.md`
- 历史产品边界：`specs/d32-admin-album-video/`
- 当前 viewer 方向：`.kiro/specs/album-video-viewer-integration/`

## 当前进度

- 更新于：2026-07-10
- 顶层任务：2/11 完成（Task 1–2）；细分任务：9/55 完成。
- 已完成：spec 审阅、逐文件实施计划、49 个 D42 行为 RED 契约、9 个架构 RED 断言、隔离 smoke 写入前门禁，并完成规格与代码质量复核。
- 待实现：Task 3–10 的生产代码；当前这些项均未勾选，不把测试契约误记为功能完成。
- 待验证：Task 11 的完整 D42、相册回归、两端生产构建和微信开发者工具手工场景。
- 当前实现基线提交：`d0e9c84`（`test: define album video hardening coverage`）。

## 执行任务

- [x] 1. 建立并审查 spec 三件套
  - [x] 1.1 记录上传对象、媒体记录、播放、公开分享、后台标注和删除问题。
  - [x] 1.2 与用户确认修复范围、边界加固方案和三部分设计。
  - [x] 1.3 创建 `requirements.md`、`design.md`、`tasks.md`。
  - [x] 1.4 用户审阅书面 spec 并确认进入实现计划。

- [x] 2. 编写详细实施计划和 RED 测试
  - [x] 2.1 使用 writing-plans 生成逐文件实施计划。
  - [x] 2.2 新增 D42 静态/纯函数检查并确认在旧实现上失败。
  - [x] 2.3 新增隔离 smoke 门禁，确认未使用 `pinche_d42_test` 时写入前失败。
  - [x] 2.4 为对象校验、本地 Range、幂等和删除重试增加失败测试。
  - [x] 2.5 为大小单位、Bearer 边界、公开分享、viewer 重试和后台竞态增加失败测试。

- [ ] 3. 加固视频对象验证和数据库幂等
  - [ ] 3.1 新增迁移 `0022_session_album_video_hardening.sql` 和 `source_url` 唯一索引。
  - [ ] 3.2 迁移前检测重复 source，禁止静默删除历史数据。
  - [ ] 3.3 COS storage 增加 HEAD 和最小 Range 读取能力。
  - [ ] 3.4 本地 storage 增加 stat 和最小文件头读取能力。
  - [ ] 3.5 创建视频记录前验证对象存在、真实大小、类型和 MP4 文件头。
  - [ ] 3.6 写库使用服务端真实 byte size/content type。
  - [ ] 3.7 重复和并发创建返回已有媒体。

- [ ] 4. 收紧上传限制和 multipart 校验
  - [ ] 4.1 小程序 COS 上传 helper 在直传前校验真实本地大小。
  - [ ] 4.2 COS authorization 在 header 可用时校验大小和类型。
  - [ ] 4.3 multipart fallback 强制验证 MP4 文件头，并拒绝伪 MIME/扩展名。
  - [ ] 4.4 无效或超限对象不得创建相册媒体记录。

- [ ] 5. 修复本地视频 HEAD、Range 和封面
  - [ ] 5.1 HEAD 使用真实文件 stat，不存在返回 404。
  - [ ] 5.2 无 Range GET 使用流式响应。
  - [ ] 5.3 合法单段 Range 返回 206，非法/不可满足返回 416。
  - [ ] 5.4 本地模式不返回伪 snapshot 图片 URL，改用现有视频占位状态。

- [ ] 6. 修复小程序上传和 viewer 生命周期
  - [ ] 6.1 将 `wx.compressVideo.size` 从 kB 转换为 bytes。
  - [ ] 6.2 20MB 压缩阈值、100MB 上限、确认文案和 payload 统一使用 bytes。
  - [ ] 6.3 viewer 视频关闭 autoplay。
  - [ ] 6.4 保存 `expiresInSeconds` 对应过期时间，过期前刷新 URL。
  - [ ] 6.5 video error 清理旧 URL 并支持一次自动刷新和点击重试。
  - [ ] 6.6 瞬时请求失败不写入长期 photos/visible media 失败状态。
  - [ ] 6.7 保留切换/关闭暂停视频行为。

- [ ] 7. 恢复公开分享边界
  - [ ] 7.1 timeline 视频不显示可播放状态。
  - [ ] 7.2 timeline 视频点击只提示“打开小程序查看视频”。
  - [ ] 7.3 timeline 视频不进入 viewer、不请求成员 `video-url`。
  - [ ] 7.4 登录成员混合 viewer 顺序和计数不回归。

- [ ] 8. 阻止业务 Bearer 跨域发送
  - [ ] 8.1 小程序媒体请求只对 API 同源 URL 附加 Authorization。
  - [ ] 8.2 后台媒体 fetch 只对同源 URL 附加 Authorization。
  - [ ] 8.3 COS query 签名封面在无业务 Bearer 时仍可加载。
  - [ ] 8.4 现有同源图片授权加载不回归。

- [ ] 9. 修复后台相册竞态和错误恢复
  - [ ] 9.1 标注预览增加 request serial，旧请求不得覆盖新选择。
  - [ ] 9.2 视频封面 401/403 时刷新媒体 URL 并最多重试一次。
  - [ ] 9.3 单媒体预览/封面/标注失败使用局部状态，不写 `albumError`。
  - [ ] 9.4 单媒体失败后瀑布流、上传、隐私和多选保持可操作。

- [ ] 10. 修复视频删除顺序和重试
  - [ ] 10.1 删除前读取并鉴权媒体和对象 URL。
  - [ ] 10.2 对象 404 视为清理成功。
  - [ ] 10.3 对象网络/5xx 失败时保留数据库记录并返回可重试错误。
  - [ ] 10.4 全部对象清理成功后再删除标签和媒体行。
  - [ ] 10.5 重复删除和部分清理后的重试保持幂等。

- [ ] 11. 回归验证和任务收口
  - [ ] 11.1 运行 D42 checks 和隔离 smoke。
  - [ ] 11.2 运行 `npm run check`。
  - [ ] 11.3 运行 D31、D32、D18、D23 相册相关回归。
  - [ ] 11.4 运行后台生产构建。
  - [ ] 11.5 运行小程序生产构建。
  - [ ] 11.6 在微信开发者工具验证成员播放、手动点击、滑动暂停、公开分享和失败重试。
  - [ ] 11.7 更新本文件验证记录，未执行项保持未勾选。

## 验证记录

- 2026-07-10：完成代码只读审查；现有 `npm run check`、D31/D32/D18/D23 静态检查和两端构建均通过，但未覆盖本规格列出的行为缺口。
- 2026-07-10：旧 `d32:smoke` 默认写入 `pinche` 且不清理，因此本轮在建立隔离门禁前不执行持久化 smoke。
- 2026-07-10：用户确认书面三件套符合预期，批准进入实施计划和实现。
- 2026-07-10：实施计划已写入 `docs/superpowers/plans/2026-07-10-album-video-pipeline-hardening.md`；因当前工作区包含本链路的权威未提交实现，计划在当前工作区窄范围执行，不创建会遗漏这些改动的新 worktree。
- 2026-07-10：D42 RED 观察结果：`node scripts/d42-album-video-hardening-unit-check.js` 以退出码 1 结束（49/49 个独立行为契约因 future helper 模块尚未创建而 `ERR_MODULE_NOT_FOUND`，覆盖权威对象 metadata、可注入 COS HEAD/最小 Range 与本地 stat/12-byte read、本地 HEAD/GET/Range/404、multipart、COS 全量/部分/缺失可见 header、幂等创建、删除重试、viewer 失败状态机及既有 admin RequestSerial）；`node scripts/d42-album-video-hardening-check.js` 以退出码 1 结束（旧实现 9/9 架构断言失败）；`--allow-red` 仅在 API media、小程序 albumVideo 和后台 albumMedia 三个 future 模块全部缺失时返回 0，任一模块存在即恢复非零退出。
- 2026-07-10：D42 隔离门禁观察结果：未设置隔离变量时 `env -u NODE_ENV -u WECHAT_MOCK_LOGIN -u D42_SMOKE_ISOLATED -u MYSQL_HOST -u MYSQL_DATABASE node scripts/d42-album-video-hardening-smoke.js --run` 在任何 API/数据库导入或写入前退出码 1；`NODE_ENV=test WECHAT_MOCK_LOGIN=true D42_SMOKE_ISOLATED=1 MYSQL_HOST=127.0.0.1 MYSQL_DATABASE=pinche_d42_test node scripts/d42-album-video-hardening-smoke.js --run` 退出码 0；无参数运行退出码 0 并打印 skip。未连接或写入默认 `pinche` 数据库。
- 2026-07-10：后端 media primitives 与 COS HEAD/最小 Range helper 已实现；默认 `node scripts/d42-album-video-hardening-unit-check.js` 当前精确结果为 47/65 PASS、18/65 RED（8 个 lifecycle、8 个小程序、2 个后台契约仅因对应后续模块尚未创建而失败），新增绿色门禁 `npm run d42:api-media` 为 47/47 PASS 并已接入根 `check`。新增契约使用注入 fake HTTPS/timeout，不访问真实网络，覆盖 metadata 失败时不读 Range、缺失 MIME 的 `.mp4` 路径 fallback、签名 HEAD、精确 `Range: bytes=0-11`、206/`Content-Range` total 一致性、所有成功/错误响应体上限、提前 `Content-Length` 拒绝、404/5xx/network 错误传播、HEAD/Range 10 秒短 timeout、完整 PUT/GET 5 分钟 timeout、DELETE 30 秒 timeout、显式 timeout 覆盖、abort 504、参数化 MP4 MIME 与空文件；`node --check` 三个 scoped JS、`node scripts/d17-cos-storage-check.js`、聚焦 media/COS 边界矩阵和 scoped `git diff --check` 均通过。此节点尚未接入 `server.js`，因此 3.4–3.7、4.2–4.4、5.1–5.3 及 Task 11 保持未勾选。
