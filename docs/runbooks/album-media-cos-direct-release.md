# 相册图片直传 COS 发布与回滚手册

本手册只适用于相册图片。头像、评价照片和相册视频保留现有链路。Bucket 必须保持私有；相册读取 URL 固定五分钟有效，并且只能在既有成员、管理员和公开分享隐私过滤之后签发。

## 配置与版本一致性

API、数据库迁移和 `album-image-cleanup` worker 必须使用同一个 `PINCHE_API_IMAGE` 镜像 digest，禁止不同 schema 版本的 worker 混跑。

```text
COS_ENABLED=true
COS_SECRET_ID=...
COS_SECRET_KEY=...
COS_BUCKET=pinche-app-1251022382
COS_REGION=ap-nanjing
COS_DIRECT_MEDIA_URLS=false
COS_DIRECT_UPLOAD_REQUIRED=false
```

两个开关独立：先启用读取直连，观察稳定后再启用上传强制直传。代码、迁移和客户端发布期间保持两个开关为 `false`。

## COS CORS

生产配置必须与 [`deploy/cos/cors.production.xml`](../../deploy/cos/cors.production.xml) 完全一致，只允许：

- Origin：`https://admin.pinche.jubenmi.com`
- Method：`GET`、`HEAD`、`PUT`
- Header：`authorization`、`content-type`、`content-length`、`pic-operations`、`x-cos-forbid-overwrite`、`x-cos-security-token`
- Expose：`ETag`、`x-cos-hash-crc64ecma`、`x-cos-request-id`、`x-cos-trace-id`

不得使用 `*` origin，不得允许 ACL 或元数据头。从生产管理后台执行预览和上传，确认浏览器预检响应及 COS request ID 可见。

## 微信合法域名

微信公众平台必须配置无尾部路径、无通配符的完整 origin：

| 类别 | 域名 |
| --- | --- |
| request | `https://api.pinche.jubenmi.com` |
| request | `https://pinche-app-1251022382.cos.ap-nanjing.myqcloud.com` |
| uploadFile | `https://pinche-app-1251022382.cos.ap-nanjing.myqcloud.com` |
| downloadFile | `https://pinche-app-1251022382.cos.ap-nanjing.myqcloud.com` |

## 迁移、回填和 worker

先备份数据库，运行迁移，再用同一镜像启动 API 与 worker。旧图片先只读扫描：

```bash
npm --workspace apps/api run job:album-image-backfill
```

`scanned` 为候选数，`updated` 为 HEAD 成功且条件更新成功数，`missing` 为 COS 404，`invalid` 为非精确 display 路径。核对 missing/invalid 后才执行：

```bash
npm --workspace apps/api run job:album-image-backfill -- --apply
```

worker 健康检查至少包含容器重启次数、最近日志及以下查询：

```sql
SELECT status, COUNT(*) FROM session_album_upload_intents GROUP BY status;
SELECT status, COUNT(*) FROM session_album_object_cleanup_jobs GROUP BY status;
SELECT id, status, cleanup_attempts, next_retry_at, lease_expires_at
FROM session_album_upload_intents
WHERE status IN ('cleanup_pending', 'cleanup_failed') ORDER BY updated_at DESC LIMIT 50;
SELECT id, media_id, status, attempts, next_retry_at, lease_expires_at
FROM session_album_object_cleanup_jobs
WHERE status IN ('leased', 'retry') ORDER BY updated_at DESC LIMIT 50;
```

租约为 60 秒；过期租约可重新领取。失败时媒体/意图数据库锚点必须保留。

## 验证顺序

```bash
npm run d43:unit
npm run d43:check
D43_SMOKE_DATABASE=pinche_d43_test npm run d43:smoke
D43_COS_CONTRACT=1 npm run d43:cos-contract
```

真实桶 contract 必须确认：首次 PUT 成功、同 key 第二次 PUT 被拒绝、HEAD/ImageInfo 为处理后 JPEG、缩略/预览/下载/ImageInfo 四种签名 URL 成功、三种篡改 URL 被拒绝、测试对象最终删除。

## 观测与错误处置

按结构化日志 `type="album_image"` 聚合：

- `intent_created`、`authorization_issued`、`intent_finalized`
- `upload_retry`、`upload_failure` 与稳定 error code
- `intent_expired`、`intent_rejected`、`orphan_cleaned`
- `cleanup_retry`、`media_deleted`
- `media_urls_signed`、`media_refresh_success`、`media_refresh_failure`
- `legacy_proxy_read` 的调用量、`byteCount` 和失败率（即 API 图片出口字节）

同时按 COS HTTP 403、404、5xx、timeout 和 `x-cos-request-id` 排查。`COS_DOMAIN_NOT_ALLOWED` 优先检查微信合法域名/CORS；`MEDIA_URL_EXPIRED` 检查客户端时钟和整本刷新；`COS_PRECONDITION_FAILED` 进入状态对账，不能再次盲目覆盖 PUT。

## 分阶段启用

1. 部署迁移、API、worker 和两个新客户端，开关均为 `false`。
2. 完成回填及 live contract。
3. 设置 `COS_DIRECT_MEDIA_URLS=true`，重启 API，验证成员、管理员、公开分享的五分钟 URL 和隐私过滤。
4. 观察读取指标后设置 `COS_DIRECT_UPLOAD_REQUIRED=true`，验证小程序和管理后台直接 PUT，API 图片上传字节为零。
5. 至少观察一个完整小程序发布周期；期间保留旧代理读取和旧图片接口。

## 回滚

- 上传异常：先将 `COS_DIRECT_UPLOAD_REQUIRED=false`。生产 COS 启用时，新客户端不会把图片字节退回 API；只有服务端明确返回 `api-local + fallbackAllowed=true` 才回退。
- 读取异常：将 `COS_DIRECT_MEDIA_URLS=false`，新字段立即指向旧代理 URL；不回滚数据库迁移或 object key。
- worker 异常：停止 worker，保留 `deleting` 媒体、cleanup job 和 orphan intent，修复后由租约重试；禁止手工先删数据库锚点。
- CORS/域名异常：保持两个开关关闭，修正控制台配置并重跑 live contract。

回滚不能改变这些强制条件：私有 Bucket、五分钟读取 URL、既有隐私过滤、至少一个发布周期的旧路由兼容，以及完全不变的相册视频管线。
