# 相册视频链路加固任务

更新日期：2026-07-10

## 事实来源

- 需求：`requirements.md`
- 设计：`design.md`
- 历史产品边界：`specs/d32-admin-album-video/`
- 当前 viewer 方向：`.kiro/specs/album-video-viewer-integration/`

## 当前进度

- 更新于：2026-07-10
- 顶层任务：4/11 完成（Task 1–3、5）；细分任务：23/55 完成。
- 已完成：spec 审阅、逐文件实施计划、D42 行为/架构契约、隔离 smoke 写入前门禁、后端媒体 primitives、视频 `source_url` 唯一索引迁移与无损 preflight、创建 service 的权威对象检查/真实 metadata/并发幂等，以及 server 本地/COS inspector、不可覆盖上传、严格 multipart 和本地 HEAD/Range/封面行为。
- 待实现：Task 4.1 和 Task 6–10 的其余生产代码；COS intent 已要求 `x-cos-forbid-overwrite: true`，小程序直传 helper 仍需在 Task 4.1 透传该 header 并在 intent 前校验真实本地大小；删除清理目前只有 lifecycle primitive，Task 10 尚未接入 service/server。
- 待验证：Task 11 的完整 D42、相册回归、两端生产构建和微信开发者工具手工场景。
- 后端 media 实现提交：`a44d2a3`（`feat: add album video media primitives`）；migration/lifecycle 变更纳入当前提交。

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

- [x] 3. 加固视频对象验证和数据库幂等
  - [x] 3.1 新增迁移 `0022_session_album_video_hardening.sql` 和 `source_url` 唯一索引。
  - [x] 3.2 迁移前检测重复 source，禁止静默删除历史数据。
  - [x] 3.3 COS storage 增加 HEAD 和最小 Range 读取能力。
  - [x] 3.4 本地 storage 增加 stat 和最小文件头读取能力。
  - [x] 3.5 创建视频记录前验证对象存在、真实大小、类型和 MP4 文件头。
  - [x] 3.6 写库使用服务端真实 byte size/content type。
  - [x] 3.7 重复和并发创建返回已有媒体。

- [ ] 4. 收紧上传限制和 multipart 校验
  - [ ] 4.1 小程序 COS 上传 helper 在直传前校验真实本地大小。
  - [x] 4.2 COS authorization 在 header 可用时校验大小和类型。
  - [x] 4.3 multipart fallback 强制验证 MP4 文件头，并拒绝伪 MIME/扩展名。
  - [x] 4.4 无效或超限对象不得创建相册媒体记录。

- [x] 5. 修复本地视频 HEAD、Range 和封面
  - [x] 5.1 HEAD 使用真实文件 stat，不存在返回 404。
  - [x] 5.2 无 Range GET 使用流式响应。
  - [x] 5.3 合法单段 Range 返回 206，非法/不可满足返回 416。
  - [x] 5.4 本地模式不返回伪 snapshot 图片 URL，改用现有视频占位状态。

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
- 2026-07-10：Task 3.1–3.3 已实现并通过 fake/injectable 契约验证：`0022_session_album_video_hardening.sql` 只添加 `uniq_session_album_video_source_url (source_url)`，无 delete/update/backfill；迁移前以单条有序 join 查询全部非 NULL（包括空字符串）重复 source/count/ids，不依赖 `GROUP_CONCAT` 或 N+1，超长人类错误截断但 `error.details` 保留 1000 个测试 ID 的完整有序数组。迁移 CLI 在保留原有 `code/message` JSON 形状的同时透传 `error.details`，另以 400 个 ID 的 JSON 往返证明结构化明细不会丢失。执行器先检查 `information_schema.statistics`：索引缺失时 preflight 后 ALTER，精确 `UNIQUE(source_url)` 已存在时跳过 DDL 并补记版本，错误唯一性/列/顺序/prefix 形状时停止；fake 还覆盖 ALTER 已隐式提交而版本写入失败后的下一次对账恢复。幂等创建只为命名 source 索引的 `ER_DUP_ENTRY` 启用恢复，并强制使用区别于初始查询的 `findAfterDuplicateOnFreshConnection`；未来 service 必须先 rollback 插入事务，再用新连接/current read 查赢家。删除清理将冻结、去重 URL snapshot 传给 finalize，只有显式 `{deleted:true}` 成功，snapshot changed/false 返回 409；未来 service 需 `SELECT ... FOR UPDATE` 比对后原子删除标签和媒体行。`a44d2a3` 已提供并测试 COS HEAD 与精确最小 Range helper。`npm run d42:api-lifecycle` 为 17/17 PASS，`npm run d42:api-media` 为 47/47 PASS；默认 D42 精确为 64/74 PASS、10/74 RED，剩余仅小程序 8 项和后台 2 项 future module。API 18-file check、聚焦 `node --check` 和 scoped diff-check 通过，未连接数据库或网络；真实 MySQL REPEATABLE READ 并发、DDL 故障与隔离 smoke 尚未执行，不把 fake 结果声明为 DB 证明，Task 11 保持未勾选。3.4–3.7、Task 10 的 service/server 接入也仍未勾选。
- 2026-07-10：Task 3.5–3.7 的创建 service 编排已完成。`createSessionAlbumVideo` 保留 admin、session/user 绑定 source、60 秒时长和可选正 dimensions 校验；客户端 `videoByteSize`/`videoContentType` 仅作兼容输入且不参与拒绝或写库。service 先用短读连接完成 session-open/member 鉴权并释放连接，再在事务外调用强制 `inspectObject`；检查失败不查询/插入媒体。media inspector 的对象存在、100MB、MP4 MIME/header 权威校验由 `d42:api-media` 47/47 覆盖；service 只使用其 `{byteSize, contentType}` 写库。active video 查询精确约束 `session_id/source_url/media_type='video'/status='active'`；插入事务内二次鉴权，命名 source 唯一冲突只有在事务 rollback 完成后才用新连接/current read 返回赢家，其他 duplicate/error 原样传播。新增根门禁 `npm run d42:api-creation` 为 8/8 PASS；旧实现先得到 6/6 RED，后补充输入边界和 inspector-required 契约。`d42:api-lifecycle` 17/17、`d42:api-media` 47/47、API 18-file check、D32 和聚焦 `node --check` 均通过；默认 D42 当前精确为 72/82 PASS、10/82 RED，剩余仅小程序 8 项和后台 2 项。测试只用 fake connection/storage，不连接 DB/网络；真实 MySQL 并发仍留待 Task 11。3.4/server inspector adapter 尚未接线，因此不声明视频创建 HTTP 路由端到端完成。
- 2026-07-10：创建 service 复审加固后 `d42:api-creation` 为 9/9 PASS。inspection 前鉴权保持非锁定短连接；inspection 后 existing fast path 与 insert 各自在独立事务中重新执行 `FOR UPDATE` current-read 鉴权，锁定 session 及实际建立成员资格的 seat/NPC 行，重新计算 album-open 谓词；existing source 本身也锁定读取且事务 commit 后才返回。测试模拟 inspection 期间撤销成员资格并证明不会泄露 existing row，同时覆盖 lookup/insert 锁定顺序。视频 dimensions 另设 MySQL `INT UNSIGNED` 上限 `4294967295`，超限在 storage/DB 前返回 400；响应的 `is_mine/can_delete/can_tag` 按实际 uploader 与请求用户比较。默认 D42 更新为 73/83 PASS、10/83 RED。对象 inspection 结果的不可变身份绑定以及 HTTP route 必须提供 inspector 仍属于紧接的 server integration，当前不声明生产路由已完成。
- 2026-07-10：duplicate winner recovery 的最后一个撤权窗口已封闭，`d42:api-creation` 更新为 10/10 PASS，默认 D42 为 74/84 PASS、10/84 RED。命名 source duplicate 的 insert 事务 wrapper 完成 rollback 并 reject 后，`findAfterDuplicateOnFreshConnection` 才开启全新的事务，先以 `FOR UPDATE` current read 重新鉴权，再锁定查询 active winner，commit 后返回。新增测试证明成功路径严格按 rollback → fresh locked auth → locked winner read → commit 排序；若 rollback 后、winner recovery 前成员资格被撤销，fresh auth 返回 403、winner 查询为 0 次且不返回媒体。测试仍使用 fake transaction，不把它声明为真实 MySQL 并发证明。
- 2026-07-10：Task 3.4、4.2–4.4、5.1–5.4 的 server/storage 接入完成。创建路由在 service call 前注入真实 storage adapter；service 仍先完成 source/session/user 校验再触发存储 I/O。COS adapter 仅接受精确 source prefix，以 HEAD 的 `content-length`/`content-type` 为权威并强制取得 ETag，再用签名的 `Range: bytes=0-11` + `If-Match` 读取同一版本；缺 ETag fail-safe；可信 COS 错误边界将 missing 映射为 404、网络/上游 5xx 映射为可重试 502、timeout/abort 映射为 504，并显式保留 If-Match 412。本地 inspection 单次 `open` 后在同一 FileHandle 上 `fstat`、精确读取 12 bytes 并 finally close。COS intent/authorization/server fallback PUT 均要求并签名 `x-cos-forbid-overwrite: true`；可见大小/MIME 严格校验，缺失事实延迟到创建前 inspector。multipart 改为有界流式单 `video` part：只保留 64KB header、boundary tail 和 12-byte header，拒绝额外 part/伪 MIME/伪扩展/坏 ftyp/超限或截断输入；本地 hard-link 原子 no-overwrite，COS Readable PUT 使用精确签名 content-length，所有路径清理 temp。COS authorization 另按 kind 白名单签名 header、强制配置 host 并拒绝 ACL/metadata/storage-class 等意外 header。播放改为 FileHandle open+fstat 同一 fd，HEAD 真实 200/404，GET 流式 200，单 Range 206，非法/不可满足 416；COS 302 按方法及客户端 Range 签名；本地两个 snapshot helper 恒返回空。新增无 DB/网络 `d42:api-server` 12/12 与 stream 5/5 PASS，覆盖 route caller、同 fd/12 bytes、ETag/If-Match 签名、visible header、no-overwrite、multipart spoof、本地 HEAD/GET/206/416/404 和无本地 snapshot；同时 `d42:api-media` 47/47、`d42:api-lifecycle` 17/17、`d42:api-creation` 10/10、API 19-file syntax、D17、D32、D18、D23、D40 和 scoped diff-check 均通过。默认 D42 精确保持 74/84 PASS、10 项仅因 Task 6/8/9 future frontend module 未创建而 RED；静态 D42 的三个后端断言已转绿，其余 6 项仍对应这些前端任务。Task 4.1 仍明确未完成：小程序直传必须透传 intent 的 no-overwrite header 并在 intent 前校验真实本地大小，因此父 Task 4 保持未勾选。 本轮仍只使用 fake storage/transaction 与本地临时文件；真实 MySQL REPEATABLE READ 并发、真实 COS 和隔离 D42 DB smoke 均未执行，仍属于 Task 11，不能声明完整数据库集成。
