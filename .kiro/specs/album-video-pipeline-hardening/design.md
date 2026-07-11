# 相册视频链路加固设计

更新日期：2026-07-10

## Overview

本设计采用“边界加固”路线，不重做相册媒体系统。上传对象由存储层验证，媒体记录由数据库保证幂等，前端只负责交互和缓存生命周期；同一问题不再依赖客户端提示或静态字符串检查兜底。

目标数据流：

```text
wx.chooseMedia
  -> 统一字节单位并按阈值压缩
  -> 获取 COS intent
  -> 上传 source MP4
  -> POST 创建媒体记录
       -> 校验 session/user/path
       -> HEAD/stat 真实大小和类型
       -> 读取前 12 字节验证 ftyp
       -> source_url 幂等创建
  -> 相册返回视频卡片
  -> 点击时按需获取 10 分钟播放 URL
  -> 过期或失败时清除并重新请求
```

## Design Decisions

### 1. 服务端对象检查是最终门禁

intent 中的 `maxBytes` 继续用于客户端快速提示，但不再被视为安全边界。`POST /api/admin/sessions/:id/album/videos` 在写库前调用统一对象检查器：

```js
inspectSessionAlbumVideoObject(sourceUrl) -> {
  byteSize,
  contentType,
  headerBytes
}
```

COS 模式：

- 使用新的 `headCosObject` 获取真实长度和内容类型。
- 使用带 `Range: bytes=0-11` 的最小 GET 读取文件头。
- 不下载完整视频到 API。

本地模式：

- `fs.stat` 获取真实长度。
- `fs.open`/`read` 读取前 12 字节。
- 文件不存在直接 404。

对象检查器要求：

- `0 < byteSize <= 100 * 1024 * 1024`。
- `contentType` 为 `video/mp4`；缺失时可由 `.mp4` 路径补默认值，但仍必须通过文件头。
- 第 4-7 字节为 `ftyp`。

客户端提交的 `videoByteSize` 与 `videoContentType` 只作为兼容输入，写库使用检查器返回值。时长和尺寸不引入新的媒体解析库，继续使用客户端声明并保持现有正整数/60 秒校验。

### 2. 幂等由数据库和服务共同保证

新增迁移 `0022_session_album_video_hardening.sql`：

```sql
ALTER TABLE session_album_photos
  ADD UNIQUE KEY uniq_session_album_video_source_url (source_url);
```

MySQL 唯一索引允许多条 `NULL`，因此不影响图片。创建流程先查询相同 `source_url` 的 active 视频；存在时返回已有记录。并发插入仍由唯一索引兜底，服务捕获 duplicate key 后重新查询已有记录。

迁移不自动删除重复数据。迁移前检查若发现历史重复 `source_url`，应停止并输出重复 id，交由人工确认保留项，避免静默删媒体。

### 3. 删除使用“记录保留直到对象清理成功”

本轮不新增后台清理 worker。视频数据库行本身作为持久重试锚点：

1. 校验当前用户可以删除媒体，读取对象 URL。
2. 清理 source/display/cover；404 视为成功。
3. 任一网络或 5xx 失败时返回错误，保留 active 行，用户可再次删除。
4. 所有对象清理成功后，再在事务中删除标签和媒体行。

这样避免“数据库已删、对象永久孤儿”。部分对象已删而后续失败时，再次删除仍因 404 幂等继续。

### 4. 本地视频使用流和单段 Range

本地 `video-file` 路由接收原始 request，以真实文件状态生成响应：

```text
HEAD              -> 200 + real content-length
GET               -> 200 + createReadStream
GET Range valid   -> 206 + content-range + ranged stream
GET Range invalid -> 416 + content-range: bytes */size
missing file      -> 404
```

只支持单段 `bytes=start-end`、开放端 `start-` 和后缀端 `-length`。多段 Range 不在本轮范围。COS 模式继续按 HEAD/GET 方法签名并 302，不代理视频字节。

本地无 COS 时不生成伪 snapshot URL。相册接口对视频返回空 `cover_url`，现有卡片使用视频占位状态；公开视频同样只显示占位与“打开小程序查看视频”。

## Mini Program Design

### 视频大小

新增纯函数或可测试 helper：

```js
compressVideoSizeBytes(resultSizeKb) => Math.round(resultSizeKb * 1024)
```

`chooseMedia.tempFiles[].size` 和 `getFileInfo.size` 保持字节；只有 `wx.compressVideo.success.size` 执行 kB → bytes。20MB/100MB 判断、确认文案和创建 payload 全部使用最终字节数。

小程序的 COS 上传 helper 在拿到 intent 后再次检查本地文件大小；若无法读取大小则拒绝直传，而不是把未知大小改为 `1`。即使前端失效，服务端对象检查仍是最终门禁。

### Bearer 边界

新增 URL 判断 helper：

```js
shouldAttachApiAuthorization(url)
```

相对路径或与 `getApiBaseUrl()` 同源时返回 true；绝对跨域 URL 返回 false。`uni.downloadFile` 和 `uni.request` 共用这一判断，避免视频封面的 COS query 签名 URL 携带业务 Bearer。

### Viewer 生命周期

viewer 的视频字段扩展为：

```js
{
  video_display_url,
  video_url_expires_at,
  video_load_failed
}
```

- `<video autoplay="false">`。
- 命中缓存前检查 `expires_at > now + 30s`。
- 过期时清除 URL，重新调用成员 `video-url`。
- `video-url` 请求失败只更新当前 `previewPhotos`，不写入长期 `photos` 或 `visiblePhotoMedia` 失败标记。
- viewer 失败态提供“点击重试”；重试 emit `need-video`。
- video 节点 error emit `video-error`，页面清除 URL；同一激活周期最多自动刷新一次，之后等待用户点击重试。
- 切换和关闭继续暂停/卸载视频。

### 公开分享

`timelineMode` 在列表层截断：

- ready 视频不显示播放三角。
- 点击时 toast“打开小程序查看视频”。
- `canOpenPhotoPreview` 对公开视频返回 false。
- 不构建视频 viewer 项，也不请求成员 `video-url`。

正常成员相册仍构建图片/ready 视频混合集合，顺序与当前筛选一致。

## Admin Web Design

### 跨域媒体请求

`fetchAuthorizedMediaObjectUrl` 只对相对或同源 API URL 附加 Bearer。绝对 COS URL 直接 fetch。图片 API 的现有授权行为保持不变。

### 封面过期刷新

`AuthorizedLazyImage` 在失败时 emit 包含 status 的事件。`SessionAlbumWorkspace` 对视频封面 401/403：

1. 对该相册触发一次受控媒体 URL 刷新。
2. 合并同一 media id 的新 `cover_url`。
3. 组件因 src 变化自动重试。
4. 每个媒体只自动刷新一次，仍失败则显示局部失败态。

### 标注竞态

增加递增 `tagDrawerRequestSerial`。每次 `openTagDrawer` 先保存本次 serial；媒体加载完成后，只有 serial 仍等于最新值时才写 `taggingPhoto` 和 `selectedTagKeys`。后发点击自然取消先发结果，不需要阻塞整个相册。

### 错误分层

- `albumError`：仅相册主体加载失败，会控制瀑布流。
- `albumStatus` 或独立媒体错误：视频播放地址、封面、标注预览失败。
- 单个媒体操作失败不得清空 album 数据，不得禁用上传、隐私或多选。

## Backend Upload Validation

multipart fallback 的 MP4 判断改为：

- 大小在 100MB 内。
- 文件头必须通过 `isMp4FileBytes`。
- MIME 若存在必须为 `video/mp4`。
- 扩展名若存在必须为 `.mp4`。

不能再使用“MIME、扩展名、文件头任一匹配即可放行”。

fallback 解析只接受一个名为 `video` 的文件 part；额外 part、非 `video` part 和不支持的 part header 直接拒绝。请求体按流写入同目录临时文件，内存中只保留不超过 64KB 的 part header、边界识别尾部和前 12 字节文件头；本地用硬链接原子 no-overwrite 落盘，COS 用带精确 `content-length` 的 Readable PUT，所有成功和错误路径都清理临时文件。

COS authorization 在 header 可见时检查：

- `content-length <= 100MB`。
- `content-type === video/mp4`。

authorization 阶段缺少这些 header 时不伪造结论；最终由创建记录前的真实对象检查拒绝。

## Test Strategy

### RED checks

新增 `scripts/d42-album-video-hardening-check.js`，优先检查可提取纯函数和关键架构边界，不用字符串存在代替行为测试。至少覆盖：

- 压缩 size kB → bytes。
- 公开分享视频不可打开 viewer。
- viewer autoplay 为 false。
- 跨域 URL 不附加 Bearer。
- video URL 缓存包含过期时间和重试入口。
- 后台 `albumError` 不接收单媒体失败。
- 标注请求序号存在。

### API unit/integration

新增不依赖默认数据库的测试脚本，覆盖：

- 文件头校验。
- 本地对象 metadata。
- HEAD、200 GET、206 Range、416 Range 和 missing 404。
- multipart 伪扩展/MIME 拒绝。
- COS authorization 的大小和类型约束。
- 不存在对象不能创建 ready。
- 同 source 重复/并发创建只返回一条。
- 删除对象失败时 DB 行保留，重试成功后删除。

涉及数据库的 smoke 必须要求：

```text
NODE_ENV != production
WECHAT_MOCK_LOGIN = true
D42_SMOKE_ISOLATED = 1
MYSQL_HOST = localhost/127.0.0.1/::1
MYSQL_DATABASE = pinche_d42_test
```

任一条件不满足时在写入前返回失败。

### Regression

- `npm run check`
- `node scripts/d31-album-viewer-sequence-check.js`
- `node scripts/d32-admin-album-video-check.js`
- `node scripts/d18-session-album-privacy-check.js`
- `node scripts/d23-album-share-join-policy-check.js`
- `npm -C apps/admin-web run build`
- `npm -C apps/miniprogram run build:mp-weixin`
- 微信开发者工具：成员视频打开、点击播放、滑动暂停、公开分享不可播放、失败重试。

## Scope Boundaries

不新增普通用户视频上传、公开视频播放、转码/HLS、多码率、下载、界面重设计、浏览器 popup 修复或照片批量上传恢复。任何超出这些边界的改动必须先更新 requirements、design 和 tasks 并重新确认。
