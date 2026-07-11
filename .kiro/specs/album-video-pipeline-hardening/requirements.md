# 相册视频链路加固需求

更新日期：2026-07-10

## 背景

现有 D32 已建立管理员短视频上传、相册混排、视频播放和公开分享边界，但上传对象、媒体记录、签名 URL 与相册前端之间仍存在可复现的数据一致性、安全和恢复问题。本规格在不扩展产品功能的前提下，加固“选择/压缩 → COS 或本地上传 → 创建媒体记录 → 相册封面/播放 → 标注/删除”完整链路。

事实基线：

- `specs/d32-admin-album-video/` 定义第一阶段产品边界。
- `.kiro/specs/album-video-viewer-integration/` 定义图片与视频共用全屏 viewer 的当前实现方向。
- 本规格只修复已确认问题；如与旧规格冲突，以本规格的安全、恢复和公开分享要求为准。

## Requirements

### Requirement 1：上传对象与媒体记录必须真实绑定

**User Story：** 作为相册管理员，我希望只有真实上传成功的视频才能出现在相册中，避免 ghost-ready 卡片。

#### Acceptance Criteria

1. WHEN 客户端提交创建视频媒体记录请求 THEN 后端 SHALL 验证 `sourceUrl` 对应对象真实存在。
2. WHEN COS 开启 THEN 后端 SHALL 从 COS 读取真实 `content-length` 和 `content-type`，并读取最小必要文件头验证 MP4 `ftyp` 特征。
3. WHEN COS 关闭 THEN 后端 SHALL 使用本地文件 `stat` 和文件头完成相同验证。
4. WHEN 对象不存在、为空、超过 100MB、类型不是 `video/mp4` 或文件头不是 MP4 THEN 后端 SHALL 返回 400/404，且 SHALL NOT 创建 ready 媒体记录。
5. WHEN 校验成功 THEN `video_byte_size` 和 `video_content_type` SHALL 以服务端读取值为准，不信任客户端声明。
6. WHEN 客户端提交的路径属于其他 session 或 user THEN 后端 SHALL 继续拒绝。

### Requirement 2：视频大小单位和硬限制必须一致

**User Story：** 作为上传者，我希望压缩判断、确认文案、上传上限和数据库大小使用同一字节单位。

#### Acceptance Criteria

1. WHEN `wx.chooseMedia` 返回文件大小 THEN 前端 SHALL 按字节处理。
2. WHEN `wx.compressVideo` 返回 `size` THEN 前端 SHALL 将 kB 明确转换为字节后再比较和展示。
3. WHEN 原文件超过 20MB THEN 前端 SHALL 尝试压缩；WHEN 原文件不超过 20MB THEN MAY 直接上传原文件。
4. WHEN 最终上传文件超过 100MB THEN 前端 SHALL 在创建 intent 前拒绝。
5. WHEN COS authorization 请求携带可用的 `content-length` 或 `content-type` THEN 后端 SHALL 再次拒绝超限或非 MP4 请求。
6. WHEN 直传请求无法在 authorization 阶段提供可信大小 THEN 创建媒体记录阶段的对象检查 SHALL 作为最终硬门禁。
7. WHEN 上传确认弹窗显示大小 THEN 文案 SHALL 与实际上传文件字节数一致。

### Requirement 3：创建和删除必须幂等

**User Story：** 作为管理员，我希望网络重试不会生成重复视频，也不会让一个记录的删除破坏另一个记录。

#### Acceptance Criteria

1. WHEN 同一 `source_url` 被重复或并发提交 THEN 系统 SHALL 最多保留一条视频媒体记录。
2. WHEN 重复创建命中已有 active 视频 THEN API SHALL 返回已有媒体，而不是插入重复行。
3. WHEN 数据库唯一约束触发并发冲突 THEN 服务 SHALL 查询并返回现有媒体。
4. WHEN 视频对象清理失败 THEN 数据库记录 SHALL 保留，使用户或后续请求可以重试删除。
5. WHEN 对象不存在 THEN 清理 SHALL 视为幂等成功。
6. WHEN 所有 source/display/cover 对象清理完成 THEN 系统 SHALL 再删除标签和媒体记录。

### Requirement 4：本地视频响应必须符合媒体协议

**User Story：** 作为开发和测试人员，我希望关闭 COS 时的视频播放、HEAD 和拖动行为仍然真实可测。

#### Acceptance Criteria

1. WHEN 本地视频文件存在且收到 HEAD THEN API SHALL 使用文件 `stat` 返回真实 `content-length`、`content-type` 和 `accept-ranges: bytes`。
2. WHEN 本地文件不存在 THEN HEAD 和 GET SHALL 返回 404，不得返回伪 200。
3. WHEN GET 携带单段合法 Range THEN API SHALL 返回 206、正确 `content-range` 和指定字节范围。
4. WHEN Range 不可满足 THEN API SHALL 返回 416 和 `content-range: bytes */<size>`。
5. WHEN GET 不携带 Range THEN API SHALL 流式返回文件，不得将整个视频读入内存。
6. WHEN COS 关闭且没有真实 JPG 封面 THEN 相册 SHALL 使用明确占位状态，不得把 MP4 URL 当作图片封面。

### Requirement 5：业务 Bearer 不得发送给 COS

**User Story：** 作为登录用户，我希望业务访问令牌只发送给 API 域名，不被带到对象存储域名。

#### Acceptance Criteria

1. WHEN 小程序或后台请求相对 API URL 或与 API 同源 URL THEN MAY 附加业务 Bearer。
2. WHEN 请求绝对 COS 签名 URL 或其他跨域 URL THEN SHALL NOT 附加业务 Bearer。
3. WHEN URL 已通过 query 参数签名 THEN 客户端 SHALL 直接使用该签名，不再注入业务 Authorization。
4. WHEN 现有图片 API 仍要求登录头 THEN 同源图片加载 SHALL 保持可用。

### Requirement 6：视频 viewer 必须可恢复且不自动播放

**User Story：** 作为相册访问者，我希望视频由我主动播放，签名过期或网络失败后可以恢复。

#### Acceptance Criteria

1. WHEN 视频 slide 激活且 URL 到达 THEN `<video>` SHALL NOT 自动播放。
2. WHEN `/video-url` 返回 `expiresInSeconds` THEN 前端 SHALL 记录过期时间，并在过期前安全窗口内重新获取。
3. WHEN video 节点加载失败或播放 URL 返回 401/403 THEN 前端 SHALL 清除旧 URL，并允许重新请求。
4. WHEN `/video-url` 一次瞬时失败 THEN 失败状态 SHALL 只属于当前 viewer 会话，不得永久写入相册媒体数据。
5. WHEN 用户关闭并重新打开 viewer THEN 系统 SHALL 可以再次请求失败的视频。
6. WHEN 用户滑离视频或关闭 viewer THEN 视频 SHALL 暂停或卸载。

### Requirement 7：公开分享继续保持不可播放

**User Story：** 作为朋友圈公开相册访问者，我希望页面明确告诉我视频需打开小程序，不出现可点但失败的播放器。

#### Acceptance Criteria

1. WHEN `timelineMode` 展示 ready 视频 THEN 卡片 SHALL 显示封面、时长和“打开小程序查看视频”。
2. WHEN `timelineMode` 展示视频 THEN 卡片 SHALL NOT 显示可播放状态。
3. WHEN 用户点击公开分享视频 THEN 页面 SHALL 仅提示打开小程序，不得进入 `AlbumImageViewer`。
4. WHEN 公开访问者未登录或不是成员 THEN 页面 SHALL NOT 请求成员专用 `/api/session-album/media/:id/video-url`。
5. WHEN 正常登录成员从车局相册点击视频 THEN 混合 viewer 行为 SHALL 保持可用。

### Requirement 8：后台相册错误和标注必须局部化

**User Story：** 作为后台管理员，我希望封面或播放失败不影响整个相册，也不会把标签保存到错误媒体。

#### Acceptance Criteria

1. WHEN 快速依次打开媒体 A、B 的标注抽屉且请求乱序完成 THEN 只有最后一次选择 B MAY 更新抽屉状态。
2. WHEN 旧请求晚于新请求返回 THEN SHALL 丢弃旧结果，不得覆盖 `taggingPhoto` 和标签选择。
3. WHEN 视频封面 URL 过期并返回 401/403 THEN 后台 SHALL 刷新当前相册媒体 URL，并最多重试一次。
4. WHEN 视频预览、封面或标注预览失败 THEN 页面 SHALL 显示局部错误；瀑布流、上传、隐私和多选 SHALL 保持可操作。
5. `albumError` SHALL 仅表示相册主体加载失败，不得用于单个媒体操作失败。

### Requirement 9：验证不得污染默认数据库

**User Story：** 作为开发者，我希望回归测试可重复执行且不会向默认开发库残留测试数据。

#### Acceptance Criteria

1. WHEN 运行视频链路 smoke THEN 测试 SHALL 要求显式隔离数据库标记和专用数据库名。
2. WHEN 隔离条件不满足 THEN smoke SHALL 在写数据前失败。
3. 自动测试 SHALL 覆盖对象不存在、大小/MIME、重复创建、本地 HEAD/Range、大小单位、公开分享、自动播放、URL 过期重取、跨域 Bearer、标注竞态和局部错误状态。
4. 完成实现后 SHALL 通过 `npm run check`、后台构建和小程序构建。
5. 微信开发者工具手工验证 SHALL 记录为独立任务，未执行时不得标记完成。

## Non-Goals

- 不开放普通成员、付费用户或免费用户上传视频。
- 不开放朋友圈公开视频播放。
- 不做 HLS、云端转码、多码率、视频增强或视频下载。
- 不重设计相册列表或整体视觉语言。
- 不处理浏览器慢请求导致的条件性 popup 拦截。
- 不处理仅照片批量上传中途失败和重复提交问题。
- 不引入 ffmpeg 或完整 MP4 时长解析；60 秒时长继续由前端读取并由后端校验声明值，真实对象校验聚焦存在性、大小、内容类型和 MP4 文件头。
