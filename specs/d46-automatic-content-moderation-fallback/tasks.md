# D46 任务清单：自动内容审核能力与降级拦截

- [x] D46.1 在 D45 审核任务与媒体状态基线之上新增平台设置和审计迁移。
- [x] D46.2 实现能力优先、默认直发、兜底拦截的统一入口策略。
- [x] D46.3 实现仅系统管理员可读写的设置 API 与后台“内容安全”页面。
- [x] D46.4 接入全部图片入口：头像、相册、评价配图及其读取门禁。
  - 2026-07-17：进行中——补齐头像与评价配图的不可变资产、D45 WeChat 异步审核任务/回调/重试复用、资料与评价关联所有权门禁、原始 `/uploads` 与序列化读取门禁；完成全部定向验证前保持未勾选。
  - 2026-07-17：规格复审整改中——补本人资产状态/领取与 finalize 幂等、0031 部分 DDL 恢复、持久化清理兜底、本地原子禁止覆盖、历史评价图逐引用显式绑定；五项完成并全套验证前保持未勾选。
  - 2026-07-17：二次复审整改完成——评价多图按上传操作与本地文件身份逐项提交/恢复并保持顺序、9 图上限与去重；既有 owner/path 资产在 intake 前幂等领取；0031 将所有非空历史头像显式绑定或 fail closed。定向、D45 与构建验证通过；全量 API 仅保留主工作区可复现的 3 项微信 token 基线失败，D46.4 仍留待总复核勾选。
  - 2026-07-17：三次复审整改完成——finalize 先无锁幂等探测，新资产恢复 settings→owner/path 锁序；未关联资产保持持久化清理计划，头像与评价替换/删除重排旧资产，成功删除后资产置 deleted；评价 pending operation 按登录用户与 session/draft 隔离。聚焦、D45、语法、构建与 diff 验证通过，D46.4 仍留待总复核勾选。
  - 2026-07-17：四次复审整改完成——清理仅处理安全终态，删除决定在资产锁和引用复查后先持久化，资料/评价关联锁定 active 已发布资产，`deleting` 崩溃与存储失败均可重试；null probe 在 settings 锁后优先重放精确并发资产；历史资产调度原子补建 cleanup anchor。聚焦、D45、静态、语法、构建与 diff 验证通过，D46.4 仍留待总复核勾选。
  - 2026-07-17：五次复审整改完成——cleanup preparation 使用 claim 得到的不可变定位先锁 asset（未完成 finalize 时锁 owner/path），再锁并校验 leased cleanup job，与 finalize/拒绝回调统一为 asset→cleanup job；SKIP LOCKED lease、终态清理、引用复查、删除决定、崩溃恢复和存储重试语义保持不变。聚焦、D45、静态、语法与 diff 验证通过，D46.4 仍留待总复核勾选。
  - 2026-07-17：第三轮规格复审整改中——必须修正 user-image finalize 的 `settings → business` 锁顺序；补齐未关联、替换和删除图片的持久化清理及资产 `deleted` 状态；按用户与 `sessionId`/草稿范围隔离评价配图恢复。完成 RED/GREEN、复审和独立验证前保持未勾选。
  - 2026-07-17：第四轮规格复审整改中——清理不能删除仍供审核重试/后台复核的待审资产；清理判定、对象删除和资料/评价关联须消除竞态；并发空探测须在设置锁后优先重放既有资产；历史 `approved_legacy` 资产必须拥有可调度的清理锚点。完成 RED/GREEN、复审和独立验证前保持未勾选。
  - 2026-07-17：第五轮规格复审整改中——清理准备必须与上传 finalize 和审核拒绝回调统一为 `asset → cleanup_job` 锁序，消除 `cleanup_job → asset` 的反向死锁。完成 RED/GREEN、复审和独立验证前保持未勾选。
  - 2026-07-17：代码质量复审整改完成——共享历史物理路径按跨 owner 的 asset_path/object_key 存活性阻止物理删除，raw read 确定选择 active 已发布资产；评价多图先解析去重、按 asset id 升序锁定并按客户端顺序写入；头像与评价图在 finalize 前持久化 owner/scope/object key，可重放事务后上游失败和断网；0031 对既有 asset/cleanup 表补齐或校验全部主键、二级/唯一索引、外键与 CHECK，同名错误结构关闭式失败。聚焦、D45、静态、语法与 diff 验证通过，D46.4 仍留待总复核勾选。
  - 2026-07-17：第七轮规格复审整改完成——共享物理对象逐资产 tombstone、由最后一个 live 成员回收；同一评价替换先序列化 review，再按序锁定新旧资产并集；客户端清除 deleted/nonactive/已批准无 path 及终态重放错误的恢复记录；0031 补齐并校验 users/review 资产引用索引。四项均完成 RED/GREEN；聚焦 62/62、D45 talk 5/5 与主套件 518/518、静态和语法检查通过；全量 API 628/631，仅保留主工作区已复现的 3 项微信订阅 token 基线失败。D46.4 仍留待总复核勾选。
  - 2026-07-17：并发共享对象清理复审整改完成——不同 worker 同时观察同组另一资产 active 并各自 tombstone 时，两个 cleanup job 均延后 retry，不再终态 retained；后续 claim 在确认同组无 active 资产后回收物理对象。业务引用 retained、非终态审核 defer、asset→cleanup job 锁序与不提前删除语义保持不变。并发与恢复均完成 RED/GREEN；聚焦 64/64、D45 talk 5/5 与主套件 520/520、静态和语法检查通过。D46.4 仍留待总复核勾选。
  - 2026-07-17：最终质量复审整改中——raw read 必须区分零资产 legacy 与已知 hidden-only 资产组；客户端批准恢复记录须等业务关联成功后显式确认，fallback 上传须可重放响应丢失；0031 须校验运行时列/表语义；共享物理对象须让永久 live sibling 的非最终 job 终态收敛，同时保留并发全 tombstone 后的 durable 最终回收选举。四项完成 RED/GREEN 与相关回归前保持未勾选。
  - 2026-07-17：最终质量复审整改完成——raw read 仅在零资产且 WeChat 图片审核关闭时兼容 legacy，任何已知 hidden-only 组保持 404；批准恢复记录在资料/评价关联成功后才按 scope/path 显式确认，直传与本地/backend fallback 均可重放响应丢失；0031 校验并修复主键、自增、默认值、on-update、引擎及运行时约束；共享资产 job 终态 retained，并由 owner-agnostic、`(storage_kind, object_key)` 唯一的对象 job 在 asset→job 锁序下完成最终回收与崩溃重试。四项均完成 RED/GREEN；聚焦 42/42、小程序 8/8、D45 talk 5/5 与主套件 526/526、release matrix 121/121、静态、API 语法、小程序构建与 diff 检查通过；全量 API 634/637，仅保留主工作区已复现的 3 项微信订阅 token 基线失败。D46.4 仍留待总复核勾选。
  - 2026-07-17：backend fallback 响应丢失恢复整改中——补认证且按 owner、图片 kind 与评价 session/draft scope 隔离的 operation-ID 查询，使普通页面恢复无需再次选择同一文件；deleted/404/终态配置结果须清除客户端 locator，避免 orphan cleanup 后旧 operation 阻塞新上传。完成三类 RED/GREEN 与回归前保持未勾选。
  - 2026-07-17：backend fallback 响应丢失恢复整改完成——0031 新增无路径的 `user_image_upload_operations`，在资产 finalize 同一事务内绑定 owner、kind、scope、operation ID 与 asset；认证查询按四项精确匹配并复用资产公开投影，hidden/pending 不返回 path。评价页面按 session/draft scope 自动恢复，资料页打开时恢复头像；missing、终态配置和 deleted 结果会清除客户端 locator，使 orphan cleanup 后同一文件可生成新 operation 重传。完成严格 RED/GREEN；user-image 65/65、小程序 11/11、D45 talk 5/5 与主套件 532/532、静态、API 语法、小程序构建与 diff 检查通过。D46.4 仍留待总复核勾选。
  - 2026-07-17：最终 D46.4 质量复审整改中——authoritative profile/review 关联须按完整 scope 清除并使竞态恢复失效；补齐 `asset_path`/`object_key` 单列前导索引；本地 EEXIST 重放须以磁盘真实字节核对并计算版本；评价对象 key 须纳入规范化 scope。四项完成严格 RED/GREEN 与全套回归前保持未勾选。
  - 2026-07-17：最终 D46.4 质量复审整改完成——资料/评价成功关联按完整规范化 scope 清除全部 operation，并用 scope epoch 使重叠恢复/上传无效，删除的恢复图与被替换头像不会重现；0031 建表与 reconciler 补齐精确非唯一单列 `asset_path`/`object_key` 查询索引并关闭式拒绝错误同名结构；本地 EEXIST 读取磁盘真实字节、SHA-256 不同则在 finalize 前稳定 409；评价确定性 key 纳入规范化 scope。严格 RED/GREEN；聚焦 80/80、D45 talk 5/5 与主套件 536/536、release matrix 121/121、静态、API 语法、小程序构建与 diff 检查通过。D46.4 仍留待总复核勾选。
  - 2026-07-17：最终客户端并发复审整改中——scope supersession 必须稳定报错且以关联请求开始时的 operation cutoff 为界，不能清除之后开始的新上传；评价存在待审照片时不得保存或确认清 scope。两项完成严格 RED/GREEN 与全套回归前保持未勾选。
  - 2026-07-17：最终客户端并发复审整改完成——头像/评价 scope operation 持久化递增序号，关联请求开始前捕获 cutoff，成功 ack 只清除并淘汰 cutoff 及之前的操作；旧上传稳定返回 409 `USER_IMAGE_UPLOAD_SUPERSEDED`，不再产生空 path 或空头像更新，请求后新启动的 stacked 上传保持可恢复。评价 `pendingPhotoCount > 0` 同时禁用保存按钮并在方法入口拦截，不发 PUT、不 ack，最终批准仍可恢复。严格 RED/GREEN；聚焦 82/82、D45 talk 5/5 与主套件 538/538、release matrix 121/121、静态、API/小程序语法、小程序构建与 diff 检查通过。D46.4 仍留待总复核勾选。
- [x] D46.5 接入全部视频入口及其读取门禁。
  - 2026-07-17：实现审计完成——相册视频的本地 multipart 上传、COS intent、COS 授权与最终创建均在写入前走独立 video capability；最终创建事务会锁定设置行并重判。能力可用创建 `pending` Tencent CI `album_video` 任务；不可用时默认落为 `approved_legacy`，双开关则在对象检查/媒体写入前以 503 拒绝。成员/公开列表、封面、播放 URL、带签名播放文件和下载等读取路径均只接受 `approved`/`approved_legacy`；D45 回调、不可变 ETag、重复回调和 retry route 已覆盖。定向 70/70、D42 video 78/78、album-image 85/85、D45 静态、语法与 diff 检查通过；等待独立规格与质量复审前保持未勾选。
  - 2026-07-17：复审整改完成——Tencent 当前回调现在要求已锁定媒体的 `moderation_object_version` 非空且与任务 `subject_version` 完全一致；NULL、空字符串或不同版本均作为 stale 保持隐藏，不能推进为 approved。新增最小 RED/GREEN 回归；等待复审与总验证前保持未勾选。
- [x] D46.6 接入受约束文本的创建和编辑入口。
  - 2026-07-17：进行中——第一阶段已将持久化设置接入统一异步入口门禁，旧 `*_INTAKE_MODE` 仅保留配置兼容、不参与 D46 发布决策；图片/视频按 `moderationRequired` 写入 `pending` 或 `approved_legacy`，文本不再由 `legacy` 提前绕过。头像与评价配图当前仅完成统一图片策略拦截，D45 尚无其不可变媒体、审核任务和隐藏读取管线，须后续独立补齐。本阶段不宣称完成 D46.4–D46.6。
  - 2026-07-17：审查修复——最终相册图片、视频和受约束文本直写均在业务写事务内锁定 `content_security_settings` 单例行并重判，和后台设置保存形成同一锁屏障；下层缺少 intake hook 时默认 `approved_legacy`，最终判定需审核却缺 job hook 时在 `INSERT` 前稳定失败。生产 preflight 已移除旧 mode 前置条件，预演依靠独立表、对象前缀与 HMAC 关联隔离，不宣称隔离正常流量。
  - 2026-07-17：质量复审——所有最终写事务统一为 `content_security_settings` → 业务行的锁序，覆盖相册图片 finalize、视频查重/插入/重复恢复、本地图片与文本直写，避免跨类型反序死锁。能力状态明确为启动时 provider 配置快照，生产预演不是动态 health；任务创建后的权限、额度和网络失败保持隐藏并重试，只有关闭对应 provider enabled 配置并重启/滚动发布后才进入 DB fallback 决策。
  - 2026-07-17：D46.6 审计完成，待独立规格/质量复审后勾选——资料昵称、私有店家/剧本、车局创建/编辑、NPC 创建/编辑、评价文本及伪聊天消息/置顶消息均进入同一文本边界；可用能力创建不可变提案并通过后应用，默认无能力在设置锁与业务写同一事务内直写，双开关在写前稳定拒绝。70 项文本/策略/重试/伪聊天定向测试通过；客户端文案发现属 D46.7 的后续项，不在本项改动。
- [x] D46.7 实现回调、状态迁移、失败隐藏、重试与小程序状态提示。
  - 2026-07-17：进行中——D45 回调、状态机、重试和隐藏读取链路已存在，需按 D46 逐项审计；将小程序状态文案收敛为三条规定的安全提示，并补入 D46 入口/读取防绕过检查。
  - 2026-07-17：实现与定向审计完成，待独立规格/质量复审后勾选——小程序只保留三条规定安全文案；所有 `CONTENT_MODERATION_*`/`WECHAT_CONTENT_SECURITY_*` 错误不回退服务端原始 message。D46 静态检查覆盖图片/视频/文本写入边界、相册/头像/评价图片读取门禁、认证回调、状态机及重试路由，并已接入根 `precheck`。定向 119/119、D45 主套件 540/540、D45/D46 静态、语法与 diff 检查通过。
  - 2026-07-17：最终规格与质量复审通过——全部客户端审核提示严格收敛为三条允许文案，审核错误绝不回退服务端原始 message；D46 检查器对图片/视频/文本写入、用户图片与相册读取、认证回调、不可变 attempt/version、retry dispatcher 和每个 COS 图片/视频分支使用可执行 token 流断言。负向覆盖文案 Unicode/Vue 实体/注释/正则，以及门禁删除、改名、注释和字符串伪调用；规格和质量复审均无 Critical/Important。
- [ ] D46.8 执行定向测试、全量检查和非生产真实腾讯云联调。
  - 2026-07-17：本地完整验证完成——在隔离的 MySQL/Redis/API 环境中运行 `WECHAT_SUBSCRIBE_MESSAGE_ENABLED=false npm run check`，退出码 0；包含 D46 静态检查、API、D45/D42 回归和小程序构建。0031 在空测试库完成实际迁移。真实 Tencent/WeChat/COS 非生产联调仍待具备隔离凭据、回调地址与执行授权的环境，不能由本地模拟替代。

## 完成标准

- [x] 默认未启用审核时，系统与最早的直接发布逻辑一致。
- [x] 能力可用时三类内容先审后发。
- [x] 能力不可用时只按管理员兜底开关决定直发或阻拦。
- [x] 待审、错误和拒绝内容无法从任何读取路径泄露。
- [x] npm run check 通过。
