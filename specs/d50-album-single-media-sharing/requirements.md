# D50 Requirements：相册单项媒体分享

更新日期：2026-07-19

版本：v1.0

状态：产品、权限与技术方向已确认，实施中

## 1. 目标与范围

D50 允许同车成员在相册全屏打开某张图片或某段 ready 视频时，单独分享当前媒体。接收者先只看到这一项，不能左右滑动浏览其他内容；页面底部提供“查看完整相册”，进入同一份公开只读相册快照。该路径以具体内容吸引接收者继续使用小程序，同时复用 D48 已有的审核、隐私、快照、撤销和公开 DTO 边界。

本期不直接发送原图或视频文件，不创建第二套公开权限模型，也不把单项页扩展成互动或报名页面。

## 2. 当前实现与 D50 差距

| 能力 | 当前实现 | D50 要求 |
|---|---|---|
| 全屏预览操作 | 下载、关闭 | 增加当前媒体分享状态与原生分享按钮 |
| 公开快照 | 自动选择最多 30 项、最多 3 段 ready 视频 | 可指定一个符合资格的 `focusMediaId`，并保证它进入同样有界的快照 |
| 分享接收体验 | 打开完整公开相册 | 先打开只含目标媒体的沉浸态，再由“查看完整相册”进入同一快照 |
| 公开视频 | DTO 只提供视频封面，不提供匿名播放 | 增加绑定 v2 快照的短期匿名播放 capability，并保持正确 Range 响应 |
| 分享竞态 | 页面只有整册 token | 当前媒体 token/封面按媒体 ID 缓存；快速滑动不得分享错项 |
| 失败回退 | 公开相册整体错误态 | 目标不存在时不得自动展示第一项或其他媒体 |

## 3. 验收需求

### Requirement 1：当前媒体拥有独立分享入口

**User Story：** 作为同车成员，我希望在全屏查看某项媒体时直接分享它，让好友先看到我真正想展示的内容。

1. WHEN 成员在私有相册全屏打开已发布图片或 ready 视频 THEN 预览器 SHALL 展示当前媒体的分享操作。
2. WHEN 当前媒体分享准备完成且与当前媒体 ID 匹配 THEN 分享操作 SHALL 使用微信原生 `open-type="share"`。
3. WHEN 分享正在准备、当前媒体不符合公开资格或准备失败 THEN 页面 SHALL NOT 使用其他媒体或整册 token 冒充当前媒体分享。
4. WHEN 当前媒体因未完成标注、未通过审核、仍在处理或任一相关用户隐私否决而不可分享 THEN 页面 SHALL 给出明确的不可分享提示。
5. 图片与视频 SHALL 都使用小程序卡片分享，SHALL NOT 直接发送原始文件。

### Requirement 2：指定媒体必须进入有界公开快照

1. `POST /api/sessions/:id/album/share-token` SHALL 接受可选正整数 `focusMediaId`；未提供时 SHALL 保持 D48 整册分享行为不变。
2. WHEN 提供 `focusMediaId` THEN 服务端 SHALL 使用 D48 相同的公开资格函数独立验证目标媒体。
3. WHEN 目标符合资格 THEN 服务端 SHALL 将目标放入快照，再按既有稳定优先级填充剩余项。
4. 快照 SHALL 继续最多包含 30 项、最多 3 段 ready 视频；目标视频 SHALL 计入视频上限。
5. 快照摘要 SHALL 由最终规范化媒体 ID 和封面 ID 计算；相同未过期快照 MAY 复用。
6. 响应 SHALL 返回与请求一致的 `focus_media_id`，供客户端确认没有拿错目标。
7. WHEN 目标不存在、跨车局、已删除、未发布、未 ready、超出分享者公开范围或隐私不允许 THEN 接口 SHALL 返回 HTTP 409 和 `ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE`。
8. 指定目标 SHALL NOT 绕过 D48 上传者与所有真实标签用户的隐私一票否决。

### Requirement 3：接收者先只看到单项媒体

1. 分享路径 SHALL 使用现有 `pages/session/album`，携带 `id`、`albumShareToken`、`focusMediaId` 和 `source=single_media_share`。
2. WHEN 有效路径打开 THEN 页面 SHALL 先加载同一公开快照并确认 `focusMediaId` 属于返回 DTO。
3. WHEN 目标存在 THEN 预览器 SHALL 只接收包含该目标的一项数组，SHALL NOT 允许左右滑动到其他媒体。
4. 单项公开模式 SHALL 隐藏计数、下载、上传、删除、标注、隐私、报名和角色认领操作。
5. 单项公开模式 SHALL 展示固定主操作“查看完整相册”。
6. WHEN 用户点击“查看完整相册” THEN 页面 SHALL 退出单项模式并展示已加载的同一公开快照，SHALL NOT 请求成员完整相册或要求登录。
7. `focusMediaId` SHALL 只是展示输入；篡改它 SHALL NOT 授权快照外媒体。

### Requirement 4：ready 视频可以匿名受控播放

1. WHEN 单项目标为快照内 ready 视频 THEN 接收者 SHALL 能播放该视频，而不是只看到封面。
2. 视频 URL 签发接口 SHALL 验证 v2 相册 token、有效分享记录、快照成员关系、审核状态、ready 状态和当前公开隐私资格。
3. 返回 URL SHALL 是短期应用层 capability，SHALL NOT 暴露可复用 COS 对象 URL。
4. 视频文件 capability SHALL 绑定 share ID、session ID、media ID、share-token digest、purpose 和 expiry。
5. 每次 `GET|HEAD` 视频文件请求 SHALL 再次验证有效分享、快照成员关系、审核、ready 与隐私。
6. 完整请求 SHALL 返回一致 MP4；合法 Range SHALL 返回 206、正确 inclusive `Content-Range`、匹配的 `Content-Length` 和 `Accept-Ranges: bytes`。
7. 非法或不可满足 Range SHALL 返回 416 和 `Content-Range: bytes */<size>`。
8. 本地与 COS 存储 SHALL 都经过受控应用边界；COS SHALL 代理字节而不是把接收者重定向到对象 URL。
9. 播放器 SHALL 保留现有一次自动刷新和显式重试状态机，不新增无限重试。

### Requirement 5：分享状态与快速滑动竞态安全

1. 分享准备结果 SHALL 按媒体 ID 缓存，SHALL NOT 按易变化的数组索引缓存。
2. WHEN 用户快速左右滑动且请求乱序完成 THEN 只有当前媒体对应的 ready 结果 SHALL 启用当前分享按钮。
3. 旧请求 MAY 缓存在自己的媒体 ID 下，但 SHALL NOT 覆盖新当前项的可见状态。
4. `onShareAppMessage(options)` SHALL 读取按钮 dataset 中的媒体 ID并查找同 ID 缓存，SHALL NOT 只读取回调发生时的 live index。
5. 关闭预览 SHALL 清除可见分享状态；token SHALL NOT 写入通用持久存储。

### Requirement 6：失败关闭与隐私保持

1. WHEN 接收路径缺少或包含无效 `focusMediaId` THEN 页面 SHALL 展示“该内容已不可查看”，SHALL NOT 自动选择其他媒体。
2. WHEN 目标失效但快照仍有效且还有其他公开媒体 THEN 页面 MAY 保留“查看完整相册”。
3. WHEN token 过期、撤销、损坏或整份分享不可用 THEN 页面 SHALL 隐藏完整相册入口。
4. WHEN 图片加载或视频 capability/播放失败 THEN 页面 SHALL 展示当前媒体错误态，SHALL NOT 替换成其他媒体或成员接口。
5. 删除、审核撤回、隐私变化或停止分享 SHALL 继续动态收紧公开列表、媒体读取和视频 capability。
6. 错误响应 SHALL NOT 返回私有标签、上传者身份、对象 key、签名 query 或其他媒体内容。

### Requirement 7：回归、构建和真实验收

1. D50 SHALL 建立独立静态契约，锁定 `focusMediaId`、错误码、单项来源、分享按钮、CTA 和公开视频路由。
2. D50 SHALL 增加服务端纯函数/单元测试，覆盖目标强制包含、30/3 上限、非法目标和稳定顺序。
3. D50 SHALL 增加小程序纯 helper 测试，覆盖按媒体 ID 缓存、乱序结果、分享 dataset 和单项查找失败关闭。
4. D48 快照、隐私、撤销、DTO 与封面回归 SHALL 继续通过。
5. D31 预览器窗口与快速滑动、D32/D42 视频播放和 Range 回归 SHALL 继续通过。
6. 最终实现 SHALL 通过 D50 定向检查、相关回归、完整 `npm run check` 和 `npm run build:mp-weixin`。
7. 微信开发者工具 SHALL 验证一张图片和一段 ready 视频从成员预览器分享，到接收单项页，再点击“查看完整相册”的完整路径。

## 4. 非目标

- 不新增数据库表或新的小程序页面路由。
- 不直接分享原始图片/视频文件，不开放公开下载。
- 不新增评论、点赞、收藏、报名、角色认领或公开广场。
- 不新增分享奖励、诱导分享、传播排名或新的 analytics 管线。
- 不改变现有整册好友/群分享与朋友圈分享语义。
- 不新增视频转码、播放器或额外自动重试。
- 不重构无关相册布局、上传、标注、瀑布流或 viewer windowing。
