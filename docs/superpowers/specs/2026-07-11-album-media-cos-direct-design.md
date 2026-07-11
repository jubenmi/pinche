# 相册媒体 COS 直连设计

日期：2026-07-11

状态：已确认，实施计划已生成

实施计划：[2026-07-11-album-media-cos-direct.md](../plans/2026-07-11-album-media-cos-direct.md)

## 摘要

本设计把车局相册调整为“API 控制面、COS 数据面”：

- API 继续负责登录态、成员关系、逐照片隐私、上传授权、对象校验和业务登记。
- 微信小程序、公开分享和管理后台从相册列表直接获得 5 分钟有效的私有 COS 签名 URL。
- 缩略图、预览图和下载文件直接在客户端与 COS 之间传输，不再逐张经过 API。
- 生产环境的相册图片上传只允许直传 COS；失败时自动重试 COS并展示真实错误，不再回退到 API 上传文件。
- 本地未启用 COS 时继续保留现有 API 与本地磁盘路径。

Bucket 保持私有读写。设计不使用公有读、永久裸链接或宽泛的前缀凭证。

## 背景与当前问题

当前生产上传的正常路径已经是小程序或管理后台直接 PUT 到 COS。API 只生成 intent、签署请求并在上传后登记相册记录。不过当前仍有两个媒体字节经过 API 的路径：

1. COS 直传失败或无法读取本地文件大小时，客户端静默回退到 API multipart 上传，再由 API 转发到 COS。
2. 相册图片上传完成后，API 为校验展示 JPG，会从 COS 读取完整图片并交给 Sharp 解码。

当前相册图片读取也由 API 代理。成员相册与公开分享先通过 API 校验权限，然后 API 从 COS 读取完整对象并返回客户端。视频播放已经采用更合适的模式：API 完成权限校验后 302 到短期 COS URL，视频字节不经过 API。

这造成以下问题：

- API 承担相册图片出口带宽和完整对象内存缓冲。
- 每张缩略图和预览图都需要一次额外 API 请求与数据库复核。
- COS 上传错误会被静默吞掉，API fallback 的网络失败还会被错误标记为全局维护态并触发跳首页。
- 上传成功但业务登记失败时可能产生 COS 孤儿对象。
- 当前上传 intent 不是一次性可核销记录，无法可靠证明某个 Key 确实来自服务端刚刚签发的 intent。

## 目标

1. 新版客户端的相册图片字节在生产环境不经过 API。
2. 相册列表一次完成可见性过滤并返回短期 COS URL，取消逐张 API 媒体请求。
3. 微信小程序成员相册、公开分享和管理后台使用同一套签名与过期语义。
4. 所有图片读取 URL 有效期为 5 分钟，并在到期前批量刷新。
5. 生产上传只直传 COS，失败时可诊断、可重试且不触发全局维护态。
6. 上传完成后只通过 COS HEAD 与图片元信息响应校验，不读取完整图片正文。
7. 上传 intent 可核销、finalize 幂等，并能清理未登记对象。
8. 旧版小程序在过渡期继续可用，本地无 COS 开发不受影响。

## 非目标

- 不把 COS Bucket 改成公有读。
- 不提供长期或永久 COS URL。
- 本阶段不接入 CDN、签名 Cookie 或边缘鉴权。
- 本阶段不迁移头像和车局评价图片的上传协议。
- 不重构现有视频上传、视频播放和 Range 处理链路。
- 不新增原图保存权益；下载仍使用现有处理后的展示 JPG。
- 不改变相册成员、标签、公开分享或个人隐私的业务规则。

## 已确认决策

- 采用“相册列表直接返回短期 COS 签名 URL”方案。
- 覆盖微信小程序成员相册、公开分享和管理后台。
- 图片读取 URL 有效期统一为 5 分钟。
- 生产环境禁止把相册图片上传回退到 API。
- COS 可重试错误自动重试两次，并展示真实失败原因。
- 本地未启用 COS 时保留现有 API 与本地磁盘 fallback。
- 旧 API 图片路由在至少一个发布周期内保留，避免旧版小程序失效。

## 总体架构

~~~mermaid
flowchart LR
    C["小程序 / 公开分享 / 管理后台"]
    A["API：权限、签名、业务登记"]
    O["私有 COS"]
    D["数据库"]

    C -->|"获取相册列表"| A
    A -->|"成员与逐照片隐私过滤"| D
    A -->|"返回 5 分钟签名 URL"| C
    C -->|"缩略、预览、下载直连"| O

    C -->|"创建上传 intent"| A
    A -->|"返回 uploadId、精确 Key 和授权"| C
    C -->|"图片直传"| O
    C -->|"finalize(uploadId)"| A
    A -->|"HEAD + ImageInfo"| O
    A -->|"创建媒体记录并核销 intent"| D
~~~

API 仍然是授权中心，但不再是相册图片的数据代理。

## 上传设计

### 上传 intent 数据

新增相册媒体上传 intent 持久化记录。第一阶段仅服务以下两类：

- sessionAlbumPhoto
- adminSessionAlbumPhoto

每条记录至少包含：

| 字段 | 含义 |
| --- | --- |
| id | 不可猜测的 uploadId |
| user_id | 上传用户 |
| session_id | 目标车局 |
| kind | 普通成员或管理员相册上传 |
| object_key | 服务端生成的唯一 COS Key |
| source_content_type | PUT 源文件的 JPEG/PNG MIME |
| source_byte_size | PUT 源文件字节数；v2 必填，兼容协议在首次授权时绑定 |
| max_source_byte_size | 源文件限制，当前为 4MB |
| stored_content_type / stored_byte_size | Pic-Operations 处理后对象的 JPEG MIME 与 HEAD 长度 |
| stored_width / stored_height / object_etag | ImageInfo 与 HEAD 验证出的最终对象元数据 |
| status | pending、processing、finalized、expired、rejected、cleanup_pending、cleanup_failed、cleaned |
| upload_expires_at | 允许签发 PUT 授权的截止时间 |
| last_authorization_expires_at | 最后一次 PUT 签名的到期时间 |
| finalize_deadline_at | 允许对账和 finalize 的截止时间 |
| cleanup_not_before | 允许清理对象的最早时间 |
| cleanup_attempts / next_retry_at / last_error_code | 孤儿对象清理重试状态 |
| media_id | finalize 后创建的相册媒体 ID |
| created_at / finalized_at | 审计时间 |

object_key 必须唯一并包含服务端随机值。所有图片上传都启用禁止覆盖；唯一 Key 和一次性 intent 是主要防线，禁止覆盖头是附加防线。

表级约束至少包括：object_key 唯一、media_id 唯一且可空、user_id/session_id 外键、media_id 的 `ON DELETE SET NULL` 外键，以及 `(status, cleanup_not_before, next_retry_at)` 和 `(user_id, created_at)` 索引。intent 作为审计记录保留时不会阻塞媒体硬删除。一个 intent 可以为同一个精确 PUT 重签，但只能成功 finalize 一次，不能换 Key 或创建第二条媒体记录。

### 相册媒体对象定位

`session_album_photos` 新增可空且唯一的 `object_key` 与可空的 `object_etag`：

- 新 COS 图片在 finalize 时同时写入 `object_key` 和兼容用的 `photo_url = "/" + object_key`。
- 新本地图片保持 `object_key = null`，继续使用 photo_url。
- 迁移任务只在 COS 已启用且对候选对象 HEAD 成功后，才把现有 `/uploads/session-album/display/...` 图片回填为 object_key；失败项继续走旧 API 图片路由并记录指标，不凭路径字符串盲目回填。
- 读取与删除优先使用 object_key；object_key 为空时使用现有 photo_url 解析逻辑。这样迁移可以分批执行，也能兼容本地磁盘数据。

object_key 是签名、HEAD、删除和重试的规范定位字段；签名 URL 本身不入库。图片宽高、image_byte_size 与 image_content_type 表示处理后展示 JPG，不表示客户端上传的 PNG/JPEG 源文件。

### 创建 intent

客户端调用现有 POST /api/uploads/cos-intent，提交：

- kind
- sessionId
- 文件扩展名
- Content-Type
- 实际文件大小

API 依次执行：

1. 校验登录态。
2. 校验车局已开放相册。
3. 校验当前用户是车局成员，或符合管理员上传条件。
4. 校验 JPEG/PNG、4MB 上限和图片用途。
5. 生成精确 object_key 与 uploadId。
6. 创建 pending intent：上传窗口为 10 分钟；单次 PUT 授权最长 5 分钟且不得超过上传窗口；finalize 截止时间为上传窗口结束后 15 分钟。
7. 返回 COS Bucket、Region、Key、固定 Pic-Operations、限制头、uploadId、`uploadMode: "cos-direct-v2"` 与 `fallbackAllowed: false`。

相册展示图继续使用当前处理规则：

imageMogr2/auto-orient/thumbnail/2048x2048>/format/jpg/quality/85/strip

### 上传授权

POST /api/uploads/cos-authorization 增加 uploadId，并要求：

- uploadId 属于当前用户且仍为 pending。
- Bucket、Region、HTTP PUT 和 Key 与 intent 完全一致。
- Content-Type、Content-Length、Pic-Operations 与禁止覆盖头均符合 intent。
- session 权限在签名时再次成立。

授权请求的 Query 必须为空。归一化后的 Header 名称必须严格等于该图片 PUT 的允许集合：Host、Content-Type、Content-Length、Pic-Operations、x-cos-forbid-overwrite；缺失或出现 x-cos-acl、自定义元数据、存储类型及其他额外头时一律拒绝。Authorization 只由服务端返回，客户端不能把已有授权作为待签 Header 传入。

以上 uploadId、持久化 intent 与生产禁止 fallback 规则只应用于 sessionAlbumPhoto 和 adminSessionAlbumPhoto。avatar、sessionReviewPhoto 与 adminSessionAlbumVideo 继续使用现有授权协议，避免把本设计扩展到非目标媒体类型。

签名必须覆盖 Host、精确 Key、Content-Type、Content-Length、Pic-Operations 和禁止覆盖头。客户端不能替换输出文件、处理规则或对象路径。

PUT 的 Content-Type 与 Content-Length 对应源文件；Pic-Operations 把结果保存到同一个唯一 object_key，COS HEAD 与 ImageInfo 看到的是处理后的 JPEG。服务端绝不把处理后长度与 source_byte_size 相等作为断言。上线前必须用真实私有 Bucket 做一次契约测试，确认同 Key Pic-Operations 与禁止覆盖头组合可用，并确认第二次 PUT 被拒绝；该测试不通过时不得开启生产强制开关。

兼容期内，旧客户端不会发送 uploadId、Content-Type 或文件大小。服务端仍为它创建持久化 intent，并按“当前用户 + 精确 Key”唯一查回该 intent；不得继续仅凭 Key 正则推断授权。source_content_type 由服务端根据规范化后的 jpg/jpeg/png 扩展名确定，首次及后续授权的 Content-Type 必须一致；首次授权把旧协议缺失的 source_byte_size 原子绑定为签名请求中的 Content-Length，后续授权也必须完全一致。新客户端始终显式发送 uploadId。

### COS 直传与重试

生产环境：

- 只调用 COS SDK putObject。
- 不调用相册 multipart fallback。
- 网络中断、超时和 COS 5xx 自动重试两次，使用指数退避并加入抖动。
- 重试前先查询 uploadId 状态；若对象已经存在且元信息符合 intent，直接进入 finalize。
- 禁止覆盖导致的 409/412 或 ObjectAlreadyExists/PreconditionFailed 不按普通 4xx 失败处理；它表示前一次 PUT 可能已成功，客户端停止再次 PUT，短暂轮询 status 并在 ready 时 finalize。限定次数后对象仍不存在才展示 COS_UPLOAD_CONFLICT_UNRESOLVED。
- 签名过期时只刷新一次授权，且新签名不得延长 upload_expires_at。
- 4xx、权限、格式和大小错误不自动重试。

客户端必须显示“准备上传、上传中、校验中、完成”阶段，以及当前重试次数。错误提示保留 COS 或 API 归一化后的具体原因，不调用全局 maintenance 状态。

本地未启用 COS 时：

- intent 返回 `uploadMode: "api-local"`、`direct:false` 与 `fallbackAllowed:true`。
- 小程序和管理后台继续使用当前 API 上传。
- 文件写入本地存储并使用原有媒体 API。

生产环境启用 COS_DIRECT_UPLOAD_REQUIRED 后，如果 COS 配置缺失或不可用，intent 返回稳定的 COS_CONFIGURATION_ERROR，不得返回 direct:false。客户端也必须同时检查 uploadMode 与 fallbackAllowed，不能自行把未知响应解释成允许 API fallback。

### finalize

新接口 POST /api/uploads/:uploadId/finalize 不再接收客户端任意 photoUrl。

API 执行：

1. 读取 intent，确认它属于当前用户和当前车局，并重新校验相册开放、成员关系或管理员上传权限。
2. 对精确 object_key 发起 COS HEAD，验证对象存在、长度、类型和 ETag。
3. 用该 ETag 作为 If-Match 读取 COS 图片元信息 JSON，确认处理结果是 JPEG、最长边不超过 2048；随后再次 HEAD 并要求 ETag 与第一步相同。若 ImageInfo 不支持条件头，则必须执行 HEAD → ImageInfo → HEAD 并比较两次 ETag；412 或不一致都按 processing 重试，不能登记媒体。
4. 不请求完整图片正文。
5. 若上传时图片处理结果尚不可见，返回可重试的 processing 状态；客户端只轮询 status/finalize，不重新上传对象。
6. 在一个短事务中重新锁定 intent，重新校验相册开放与当前权限，复核状态、截止时间、object_key 与 ETag，持久化处理后宽高、MIME、字节数和 ETag，创建 session_album_photos 记录并把 intent 标为 finalized。
7. 返回完整媒体记录和新的相册签名 URL。

finalize 必须幂等。重复调用已完成的 uploadId 时不重复创建照片；只有调用者当前仍有相册访问权限时才返回同一个 media_id 和新签名 URL，否则返回 ALBUM_UPLOAD_FORBIDDEN，不能借重复 finalize 绕过撤权。

新增 GET /api/uploads/:uploadId/status，用于响应丢失后的对账。该接口只查询当前用户自己的 intent，重新检查当前相册权限，并复用与 finalize 相同的 HEAD + ImageInfo validator，返回 `validationState: missing | processing | ready | invalid`、objectPresent、ETag 和 canFinalize；只有 validator 为 ready 时 canFinalize 才为 true。客户端不凭本地回调判断对象是否已上传。

状态转换如下：

| 当前状态 | 事件 | 新状态 |
| --- | --- | --- |
| pending | HEAD 存在但 ImageInfo 暂未就绪 | processing |
| pending / processing | validator 成功且短事务核销成功 | finalized |
| pending / processing | 对象格式、尺寸或绑定信息不可接受 | rejected |
| pending / processing | 超过 finalize_deadline_at | expired |
| expired / rejected | 到达 cleanup_not_before，清理任务原子认领 | cleanup_pending |
| cleanup_pending | DELETE 成功或 HEAD 为 404 | cleaned |
| cleanup_pending | 可重试删除失败 | cleanup_failed |
| cleanup_failed | 到达 next_retry_at 后重新认领 | cleanup_pending |

客户端 PUT 总超时不得超过 5 分钟；cleanup_not_before 至少晚于 upload_expires_at、last_authorization_expires_at 和 finalize_deadline_at 中的最大值 10 分钟。清理任务先在事务中锁定 intent 并认领为 cleanup_pending；finalize 看到 cleanup_pending 后必须拒绝。这样已过期签名和在途 PUT 均已越过宽限期后才会删除，避免 HEAD 404 后出现迟到对象。

## 图片读取设计

### 签名 URL 生成

在现有相册业务查询完成权限与隐私过滤后，统一的图片 URL 生成器为每个可见对象生成：

- thumbnail_display_url
- preview_display_url
- download_url
- media_url_expires_at

签名有效期为 5 分钟，严格绑定：

- GET 方法
- COS Host
- 精确 object_key
- 参与请求的图片处理参数
- 下载响应参数
- 签名起止时间

新增专用 buildSignedCosImageUrl，不得直接复用当前 600 秒默认签名。它必须显式传 `expiresInSeconds: 300`，并从同一份结构化 query 表示同时生成实际 URL 与 COS canonical query：

- `imageMogr2/...` 和 imageInfo 表示为无等号的 query token；canonical signing 把该 token 作为空值参数处理。
- Content-Disposition 等响应覆盖参数表示为普通键值参数。
- 百分号编码、大小写归一化、排序和 q-url-param-list 只实现一次，禁止手工拼接“签名内容”和“最终 URL”两份字符串。
- 现有视频签名继续保留自己的 600 秒默认值，不因本设计全局改动。

上线前用真实私有对象验证 thumbnail、preview、download、ImageInfo 四类签名 URL；测试还要证明修改、删除或追加任何已签处理参数都会被 COS 拒绝。

缩略图继续使用当前规则：

imageMogr2/auto-orient/thumbnail/640x640>/format/jpg/quality/75/strip

preview_display_url 和 download_url 使用上传时已经处理好的展示 JPG。download_url 可额外签入 Content-Disposition 和安全文件名。

Bucket 保持私有。获得 URL 的客户端只能在 5 分钟内访问该单个对象，不能列举目录、读取其他对象或上传文件。

### 相册响应

以下响应都使用同一签名生成器，但在签名前保留各自现有的权限过滤：

- 成员相册 GET /api/sessions/:id/album
- 管理后台相册 GET /api/admin/sessions/:id/album
- 公开分享 GET /api/sessions/:id/album/public-share

公开分享仍要求有效分享 token、分享席位和现有上传者/被标注者隐私许可。API 只为过滤结果中的照片签名，不允许客户端传入任意 photoId 批量换取 URL。

本地无 COS 时，上述字段继续返回现有 API 媒体 URL，media_url_expires_at 可为空。

### 视频

视频播放保持现有 API 鉴权后 302 到 COS 的流程。播放器会产生 HEAD、GET 和 Range 请求，继续按实际方法与 Range 单独签名更稳妥。

视频封面继续使用当前 COS snapshot 签名 URL。本设计不把视频强行并入图片的列表签名状态机。

## 客户端 URL 生命周期

小程序和管理后台采用相同语义：

1. 相册加载时保存 media_url_expires_at。
2. 距离过期 30 秒时触发一次整相册刷新。
3. 同一相册任何时刻只允许一个刷新 Promise，所有图片复用结果。
4. 刷新只替换媒体 URL，保留筛选条件、滚动位置、选择状态、预览索引和已下载的本地缓存。
5. COS 返回签名过期或鉴权错误时，立即刷新相册并只重试当前媒体一次。
6. 第二次失败后展示真实错误，不进入循环刷新。
7. 直连 COS 请求不携带业务 Bearer Authorization。
8. 页面重新显示或浏览器标签恢复可见时，立即检查过期时间，避免后台计时器被系统暂停后继续使用旧 URL。

小程序继续将已下载预览图保存到 USER_DATA_PATH。页面内优先复用有效本地文件，避免 URL 刷新造成重复下载。

## 管理后台 CORS

生产 COS CORS 仅允许管理后台实际 Origin：

https://admin.pinche.jubenmi.com

允许当前直传和读取所需的 GET、HEAD 与 PUT，并支持这些方法对应的浏览器预检。允许头部限定为 COS SDK、签名、Content-Type、Content-Length、Pic-Operations 和禁止覆盖所需集合，并暴露 ETag、CRC64 与请求 ID 等诊断头。

本地管理后台开发 Origin 使用单独的非生产配置。CORS 不作为权限边界；对象访问仍依赖私有 Bucket 与短期签名。

## 错误语义

API 与两个客户端共享稳定错误码：

| 错误类别 | 客户端行为 |
| --- | --- |
| COS_NETWORK_ERROR / timeout | 自动重试，显示次数 |
| COS 5xx | 自动重试 |
| COS object already exists / 409 / 412 | 停止 PUT，进入 status/finalize 对账 |
| COS_UPLOAD_CONFLICT_UNRESOLVED | 对账仍找不到对象，展示真实冲突错误 |
| UPLOAD_SIGNATURE_EXPIRED | 刷新授权一次 |
| MEDIA_URL_EXPIRED | 刷新相册并重试一次 |
| FILE_TOO_LARGE | 不重试，提示压缩 |
| UNSUPPORTED_IMAGE_TYPE | 不重试，提示 JPEG/PNG |
| ALBUM_UPLOAD_FORBIDDEN | 不重试，提示权限或时间条件 |
| UPLOAD_INTENT_EXPIRED | 创建新 intent，不复用旧 Key |
| MEDIA_PROCESSING_PENDING | 在 finalize_deadline_at 前轮询 status/finalize，不重新上传 |
| DIRECT_UPLOAD_REQUIRED | 生产环境拒绝 multipart fallback，展示直传错误 |
| COS_CONFIGURATION_ERROR | 生产配置错误，不回退 API并上报运维 |
| COS_DOMAIN_NOT_ALLOWED | 明确提示检查微信域名或后台 CORS |

任何单次上传或媒体读取失败都不能调用全局维护态，也不能 reLaunch 首页。

## 孤儿对象与删除

- pending 或 processing 超过 finalize_deadline_at 后先转 expired；到达 cleanup_not_before 后再由定时任务原子认领为 cleanup_pending。
- 清理前使用 HEAD 确认对象状态，404 视为已清理。
- 清理成功标记 cleaned；可重试失败标记 cleanup_failed 并保留下次重试时间。
- finalize 后的对象只通过相册业务删除流程清理。
- 业务删除在同一事务中把媒体从 active 改为 deleting，并写入持久化的 session_album_object_cleanup_jobs；任务至少保存 media_id、object_key 或本地路径、attempts、next_retry_at 与 last_error_code。对象删除成功后才硬删除媒体记录和完成任务。
- 删除 COS 失败时保留媒体记录与 cleanup job 作为清理锚点，不先删除唯一可恢复记录；列表不返回 deleting 媒体。
- 监控 intent 过期量、对象清理成功率和重试次数。

## 兼容与发布

### 功能开关

使用两个独立开关：

- COS_DIRECT_MEDIA_URLS
- COS_DIRECT_UPLOAD_REQUIRED

读取与上传可以单独启用或回滚。生产最终状态为两个开关均开启；本地无 COS 时两个开关均不强制。

COS_DIRECT_UPLOAD_REQUIRED 是服务端约束，不只是客户端提示：生产开启后，相册 multipart 上传路由返回 DIRECT_UPLOAD_REQUIRED，不能接收图片字节。旧客户端仍可走 COS 直传；它无 uploadId 的授权和 `{ photoUrl }` 创建请求通过精确 Key 查找持久化 intent，旧创建路由内部调用同一个 validator/finalize 服务。这样兼容旧协议不会形成绕过核销的新通道。

### 发布顺序

1. 部署数据库迁移、对象 Key 回填任务、intent/finalize API、签名 URL 生成器和功能开关。
2. API 响应增量加入新字段，继续保留旧图片 API URL。
3. 配置微信 request/downloadFile 合法域名和管理后台精确 CORS。
4. 发布管理后台，使其优先使用 COS URL和新上传协议。
5. 发布小程序，使成员相册与公开分享优先使用 COS URL和新上传协议。
6. 先开启 COS_DIRECT_MEDIA_URLS，验证读取和刷新。
7. 再开启 COS_DIRECT_UPLOAD_REQUIRED，验证生产上传不走 fallback。
8. 观察至少一个小程序发布周期后，再决定是否删除旧生产图片代理入口。

旧版小程序继续使用现有 API 图片读取路由，并可通过兼容适配完成正常 COS 上传；生产强制开关开启后，它的 COS 失败 fallback 会收到 DIRECT_UPLOAD_REQUIRED，而不会让图片字节进入 API。新客户端不得在生产上传失败时退回旧 multipart 路径，即使读取直连功能临时回滚。

## 测试策略

### 单元测试

- COS URL 签名绑定正确的 Host、Key、方法、CI 参数和 5 分钟期限。
- thumbnail、preview 与 download 的参数互不越权。
- intent 只允许当前用户、当前 session 和精确 Key。
- 源文件 Content-Type/Content-Length 与处理后 JPEG 元数据分别校验，PNG 源文件不会与 JPEG 输出长度混淆。
- 签名授权拒绝错误 MIME、长度、处理规则和覆盖头。
- 签名授权拒绝任何 Query、额外 Header、ACL、对象元数据或存储类型参数。
- finalize 幂等且不能跨用户核销。
- finalize 与重复 finalize 都重新检查当前成员、管理员权限和相册开放状态。
- intent 状态转换、清理认领和 finalize 并发竞态符合状态表。
- URL 刷新时间和提前 30 秒判断正确。

### API 集成测试

- 成员相册只签发当前成员可见照片。
- 管理后台仍需管理员与车主权限。
- 公开分享继续执行分享席位和逐照片隐私规则。
- finalize 只使用 HEAD 与图片元信息，不读取完整对象正文。
- 图片处理短暂未就绪时返回 processing，客户端轮询 finalize 而不重复上传。
- 上传授权到期后仍可在 finalize 宽限期内核销；超过 finalize_deadline_at 后不能 finalize 并进入延迟清理流程。
- 重复 finalize 返回同一 media_id。
- 用户被移出车局或相册关闭后，首次及重复 finalize 都不返回媒体 URL。
- 旧协议授权按精确 Key 找回持久化 intent，旧 `{ photoUrl }` 创建路由不能登记无 intent 对象。
- 生产强制模式下 COS 配置异常和 multipart 上传均明确失败，不返回 direct:false。
- 旧 API 响应字段与路由在兼容期仍可使用。

### 客户端测试

- 小程序与管理后台都直接加载 COS 缩略图、预览图和下载 URL。
- 多张 URL 临近过期只触发一次相册刷新。
- 刷新后保持滚动、筛选、选择与预览索引。
- 签名过期只重试一次。
- 首次 PUT 成功但响应丢失后，第二次 PUT 的禁止覆盖冲突会进入对账并成功 finalize，不误报普通 4xx。
- 生产 COS 错误不会调用 API 文件 fallback。
- 本地 direct:false 仍能使用当前本地上传。

### 真机与浏览器验证

- iOS 与 Android 体验版完成选图、压缩、上传、预览和批量保存。
- 微信合法域名配置覆盖 API 与 COS 的 request/downloadFile。
- 管理后台从正确 Origin 完成 CORS 预检、PUT、GET 和 HEAD。
- 未授权 Origin 的浏览器脚本无法读取 COS 响应；CORS 不承诺阻止持有签名 URL 的非浏览器客户端。
- 无签名、签名被篡改、不可见照片的新签名请求和过期 URL 均失败。
- 移除成员或调整隐私后，新请求立即不再签发 URL；已签 URL 最多保留 5 分钟。

## 可观测性与验收

记录以下指标：

- 相册直传成功率。
- COS 自动重试率及最终失败原因。
- intent 创建、finalize、过期和孤儿清理数量。
- 签名 URL 刷新成功率。
- COS 403、404、5xx 与超时分布。
- API 相册媒体出口字节数。
- 旧图片代理路由调用量。

上线验收标准：

1. 新版小程序与管理后台的网络记录显示缩略图、预览和下载正文来自 COS。
2. 新版生产上传不出现相册 multipart 文件请求到 API。
3. API finalize 不读取完整图片正文。
4. 现有成员、标签、隐私和公开分享测试全部通过。
5. 5 分钟 URL 到期后能够无感批量刷新。
6. COS 上传失败不再跳转维护页，并展示可诊断错误。
7. API 图片出口带宽在新版客户端覆盖后接近零。

## 备选方案与取舍

### API 鉴权后 302

优点是改动小、逐次权限复核和撤权更及时，且图片字节不经过 API。缺点是每张图仍需一次 API 与数据库请求，不符合减少逐图请求的目标。

### 列表直接返回签名 URL

本设计采用此方案。它同时去掉 API 图片字节和逐张 API 请求。代价是已签 URL 在最长 5 分钟内仍可使用，客户端需要统一的到期刷新状态机。

### 临时前缀凭证或私有 CDN

请求数量更少，但当前隐私是逐用户、逐照片过滤。前缀权限容易授权过宽；CDN 还需要独立鉴权和缓存失效。当前阶段不采用。

## 官方参考

- 腾讯云 COS 小程序 SDK 快速入门：https://cloud.tencent.com/document/product/436/31953
- 腾讯云 COS 临时密钥指引：https://cloud.tencent.com/document/product/436/14048
- 腾讯云 COS 预签名授权下载：https://cloud.tencent.com/document/product/436/14116
- 腾讯云 COS 生成预签名 URL：https://cloud.tencent.com/document/product/436/35153
- 腾讯云 COS 上传安全限制：https://cloud.tencent.com/document/product/436/104266
- 腾讯云 COS CORS 设置：https://cloud.tencent.com/document/product/436/13318
