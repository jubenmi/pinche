# 相册辅助标注设计

日期：2026-07-04

## 结论

车局相册增加一个“聪明但克制”的辅助标注能力：系统可以识别同一场相册里疑似相同的人，并给上传者展示候选人物标签；用户确认后，仍然通过现有标注接口保存标签。系统不自动实名、不自动发布标签、不把识别结果作为权限判断依据。

MVP 使用腾讯云人脸识别做托管识别，按需触发、按场隔离、只处理当前用户有权标注的照片。后端保留 provider 抽象，后续量级上来后可以把人脸特征提取和相似检索迁到自建模型或向量库。

推荐路线：

1. 用户在小程序相册页点击“智能整理”并确认授权后，后台分析该用户在本场可标注的未标注照片。
2. 系统只对高置信结果生成 `suggested_tag_keys`，在照片卡片和标注面板里展示“建议标注”。
3. 用户点击确认后，前端复用现有 `PUT /api/session-album/photos/:photoId/tags` 保存。
4. 用户手动标注或确认建议后，后端用少量高质量单人照片维护本场人物代表样本，后续同场照片才能更准地给建议。

这个版本的目标是少花钱、少改权限、少碰隐私红线，同时真正减少用户逐张找人的负担。

## 当前项目背景

现有相册能力已经具备辅助标注所需的大部分业务边界：

- 相册照片保存在 `session_album_photos`，展示图统一走 `uploads/session-album/display/...jpg`。
- 人物标签保存在 `session_album_photo_tags`。
- 可选人物来自 `GET /api/sessions/:id/album/people`，包括玩家座位、DM、NPC、NPC 角色和其他。
- 单张标注接口是 `PUT /api/session-album/photos/:photoId/tags`，语义是替换整组标签。
- 小程序 `pages/session/album.vue` 已有单张标注、批量标注、待标注筛选、角色筛选、隐私设置和下载。
- 后端 `can_tag` 当前只允许照片上传者标注自己的照片。
- 完整相册可见性依赖同车成员、照片标签和 `session_album_privacy`，公开朋友圈相册另有只读过滤逻辑。

辅助标注必须贴着这些边界走：只做建议层，不改变谁能看照片、谁能标照片、哪些照片能公开分享。

## 目标

1. 在小程序相册里帮助用户快速找到“这几张照片里可能是同一个角色/成员”。
2. 优先服务普通车友标注自己上传的照片，不做车头或后台全场代标的第一期能力。
3. 识别结果必须由用户确认后才写入正式标签。
4. 复用现有标签保存接口，避免新增一套并行的照片权限模型。
5. 按场隔离人脸库，避免跨车局串人。
6. 控制成本：默认不全量扫所有照片；只在用户点击“智能整理”或已授权的会话内处理。
7. 控制风险：低质量、低置信、多义结果只提示或不展示，不硬猜。

## 非目标

- 不做自动实名。
- 不做未经确认的自动标签落库。
- 不做跨车局人物识别。
- 不做人脸识别登录、身份认证或活体检测。
- 不把辅助识别结果用于相册访问控制。
- 不在朋友圈公开只读相册里展示人脸框、置信度或识别解释。
- MVP 不引入自建 GPU 模型、FAISS、Milvus 或 pgvector。
- MVP 不做后台管理员整场批量代标；后台可在后续复用同一套 API。

## 产品体验

### 入口

在相册页现有 `整理标注` 功能组下增加轻量入口：

```text
智能整理
```

显示条件：

- 非朋友圈只读模式。
- 当前用户已登录且是相册成员。
- 当前相册有 `can_tag = true` 的照片。
- 当前筛选或整场有未标注照片。

首次点击时弹出说明：

```text
系统会分析你在本场上传、且你有权标注的照片，用来推荐可能出现的角色。建议需要你确认后才会保存。
```

用户确认后，本场本用户记录一次授权。授权只用于该场相册，不跨车局默认复用。

### 建议展示

照片卡片上只展示简洁结果：

```text
建议：沈青 89%
```

交互：

- 点建议：打开现有标注面板，并预选建议标签。
- 点“确认”：直接调用现有标签保存接口。
- 点“不像”：把该建议记为 rejected，不再对同一照片重复提示。
- 多个建议：最多展示 3 个，按置信度排序。

低置信结果不强行展示，可以汇总成状态文案：

```text
已找到 8 张可能可标注照片，3 张需要手动确认。
```

### 标注面板

现有人物选择面板保持主流程不变，只增加建议区：

```text
智能建议
沈青 89%    阿洛 74%
```

用户可以接受建议，也可以继续手动选择其他人物。保存仍然是替换整组标签。

### 批量标注关系

辅助标注不替代当前批量标注：

- 批量标注适合用户已经知道一批照片都是同一组人。
- 智能整理适合系统先把疑似同人的照片找出来。

后续可以在“智能整理结果”里增加“选中这批并批量标注”，但 MVP 先只做单张确认，避免误批量污染标签。

## 业务规则

### 识别范围

MVP 只处理：

- 当前 session。
- 当前登录用户上传的照片。
- 后端返回 `can_tag = true` 的照片。
- `status = active` 的相册展示 JPG。
- 相册已开放，且用户是同车相册成员。

不处理：

- 其他用户上传且当前用户不能标注的照片。
- 已删除照片。
- 公开朋友圈只读访问。
- 跨车局历史照片。
- 用户未授权智能整理的相册。

### 可推荐的人物

候选人物来自现有 `sessionAlbumPeople` 结果。MVP 优先推荐有真实人脸代表样本的目标：

- `seat:<id>`：玩家座位。
- `session-npc:<id>`：绑定了工作人员的 NPC 角色。
- `dm:session` / `npc:session`：仅当存在明确 `user_id` 或高质量代表样本时推荐。

不做人脸推荐：

- `other:session`。
- 没有样本、没有真实用户、也没有用户确认过代表脸的泛化角色。

### 代表样本

系统不要求用户单独上传人脸照，而是从确认过的相册照片里采样：

1. 用户保存单张照片标签，且照片只有一个人脸、一个人物标签。
2. 该人脸质量分达到阈值。
3. 该标签目标在本场还没有足够代表样本。
4. 后端把这张脸加入本场该人物的云端 Person，最多保留 3-5 张代表样本。

多人照片不自动作为代表样本，因为无法可靠知道哪个脸对应哪个标签。这个限制会让冷启动慢一点，但能显著减少“一开始就认歪”的风险。

### 建议置信度

建议分三档：

| 档位 | 规则 | 行为 |
| --- | --- | --- |
| 高置信 | 相似度达到高阈值，且不与第二名接近 | 展示为主要建议 |
| 中置信 | 命中人物但分差小，或人脸质量一般 | 展示在标注面板，不在卡片强提示 |
| 低置信 | 质量差、遮挡、侧脸、多人混淆 | 不生成建议 |

阈值需要通过真实照片调参。初始建议：

- 高置信阈值：`score >= 85`。
- 中置信阈值：`75 <= score < 85`。
- Top1 与 Top2 分差小于 5 分时降级为中置信。
- 单张照片最多建议 3 个标签。

腾讯云返回分数不是业务真理，只能作为排序和提醒依据。

## 技术设计

### 架构

```text
小程序相册
  -> 用户点击智能整理
  -> API 创建/刷新辅助标注任务
  -> 后端任务读取当前用户可标注照片
  -> Tencent Face Provider 检测/搜索/维护代表样本
  -> 写入 tag suggestions
  -> 小程序加载相册时展示 suggestions
  -> 用户确认
  -> 现有 PUT /api/session-album/photos/:photoId/tags
```

### Provider 抽象

新增一个很薄的 provider 层：

```text
FaceAssistProvider
  detectFaces(photo)
  searchPersons(sessionGroup, photo)
  createOrUpdatePerson(sessionGroup, personKey, representativePhoto)
  deleteSessionGroup(sessionId)
```

MVP 实现 `TencentFaceAssistProvider`。本地开发默认使用 `NoopFaceAssistProvider`，返回空建议，保证没有腾讯云密钥时项目仍可运行。

环境变量：

```text
FACE_ASSIST_PROVIDER=tencent|noop
TENCENT_CLOUD_SECRET_ID=
TENCENT_CLOUD_SECRET_KEY=
TENCENT_CLOUD_REGION=ap-guangzhou
TENCENT_FACE_GROUP_PREFIX=pinche-session
FACE_ASSIST_ENABLED=false
```

### 数据表

新增迁移，建议拆成三张表。

#### `session_album_face_jobs`

记录每次智能整理任务。

```sql
CREATE TABLE session_album_face_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  provider VARCHAR(32) NOT NULL DEFAULT 'tencent',
  photo_count INT UNSIGNED NOT NULL DEFAULT 0,
  processed_count INT UNSIGNED NOT NULL DEFAULT 0,
  suggestion_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_message VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_face_jobs_session_user (session_id, user_id, status),
  CONSTRAINT fk_face_jobs_session FOREIGN KEY (session_id) REFERENCES sessions(id),
  CONSTRAINT fk_face_jobs_user FOREIGN KEY (user_id) REFERENCES users(id)
);
```

#### `session_album_face_profiles`

映射本场人物标签和云端 Person。

```sql
CREATE TABLE session_album_face_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  person_key VARCHAR(64) NOT NULL,
  tag_type VARCHAR(32) NOT NULL,
  seat_id BIGINT UNSIGNED NULL,
  session_npc_role_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'tencent',
  provider_group_id VARCHAR(128) NOT NULL,
  provider_person_id VARCHAR(128) NOT NULL,
  sample_count INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_face_profile_person (session_id, person_key, provider),
  INDEX idx_face_profiles_session (session_id, status),
  CONSTRAINT fk_face_profiles_session FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

#### `session_album_tag_suggestions`

保存建议，不保存最终标签。

```sql
CREATE TABLE session_album_tag_suggestions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  photo_id BIGINT UNSIGNED NOT NULL,
  session_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  suggested_tag_key VARCHAR(64) NOT NULL,
  confidence DECIMAL(6, 2) NOT NULL,
  rank_order INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  source VARCHAR(32) NOT NULL DEFAULT 'face_search',
  provider VARCHAR(32) NOT NULL DEFAULT 'tencent',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_photo_suggested_tag (photo_id, suggested_tag_key),
  INDEX idx_tag_suggestions_session_user (session_id, user_id, status),
  CONSTRAINT fk_tag_suggestions_photo FOREIGN KEY (photo_id) REFERENCES session_album_photos(id),
  CONSTRAINT fk_tag_suggestions_session FOREIGN KEY (session_id) REFERENCES sessions(id),
  CONSTRAINT fk_tag_suggestions_user FOREIGN KEY (user_id) REFERENCES users(id)
);
```

建议状态：

- `pending`：可展示。
- `accepted`：用户已确认，正式标签另存在 `session_album_photo_tags`。
- `rejected`：用户明确否定。
- `stale`：照片标签或人物绑定变化后过期。

### API

#### 创建智能整理任务

```text
POST /api/sessions/:id/album/assist
```

要求：

- 登录。
- 相册已开放。
- 是同车相册成员。
- 至少有一张 `can_tag = true` 的照片。
- 请求体带 `consent: true`。

返回：

```json
{
  "session_id": 123,
  "job_id": 456,
  "status": "pending",
  "photo_count": 18
}
```

若 provider 未启用，返回 409 或 `{ status: "disabled" }`，前端显示“智能整理暂未开启”。

#### 查询任务状态

```text
GET /api/sessions/:id/album/assist/jobs/:jobId
```

返回：

```json
{
  "job_id": 456,
  "status": "completed",
  "processed_count": 18,
  "suggestion_count": 7
}
```

#### 相册列表返回建议

扩展现有：

```text
GET /api/sessions/:id/album
```

每张当前用户可标注照片增加：

```json
{
  "id": 1,
  "tags": [],
  "can_tag": true,
  "suggestions": [
    {
      "key": "seat:12",
      "label": "沈青",
      "confidence": 89.4,
      "rank_order": 0
    }
  ]
}
```

只返回当前用户自己的 `pending` 建议；其他用户不能看到。

#### 拒绝建议

```text
POST /api/session-album/photos/:photoId/tag-suggestions/reject
body: { tagKey }
```

确认建议不需要新接口。前端仍调用：

```text
PUT /api/session-album/photos/:photoId/tags
body: { tagKeys: ["seat:12"] }
```

后端在保存正式标签后，把对应 suggestions 标为 `accepted`，其他 pending 建议标为 `stale`。

### 后台任务

MVP 不必引入独立队列服务，可以先用数据库 job 表加 Node 进程内 worker：

1. API 插入 `session_album_face_jobs`。
2. worker 每次取少量 `pending` job。
3. 读取该用户在该 session 下 `active` 且可标注照片。
4. 跳过已有标签且没有强制刷新要求的照片。
5. 检测人脸质量。
6. 如果本场已有 face profiles，则调用人脸搜索并生成建议。
7. 如果没有 profiles，任务完成但提示“先手动标几张单人照，后续会更准”。
8. 写入 suggestions。

部署多实例时，需要用数据库状态锁避免重复处理：

```text
pending -> processing -> completed|failed
```

更新时带条件：

```sql
UPDATE session_album_face_jobs
SET status = 'processing'
WHERE id = ? AND status = 'pending'
```

### 代表样本更新

在 `updateSessionAlbumPhotoTags` 成功后追加一个非阻塞步骤：

1. 当前照片如果只有一个正式人物标签。
2. 检测结果显示只有一张高质量人脸。
3. 该人物 profile 不存在或样本不足。
4. 调 provider 创建/更新 Person。
5. 失败只记录日志，不影响标签保存。

为了保持接口响应稳定，这一步可以写入后台 job，不要在用户保存标签时同步等待云 API。

## 腾讯云使用方式

使用腾讯云人脸识别：

- `DetectFace`：检测照片人脸、质量、位置。
- `SearchPersons`：在本场人员库中搜索相似人物。
- `CreateGroup`：每个车局创建独立 Group。
- `CreatePerson` / `CreateFace`：维护每个可推荐人物的少量代表脸。
- 删除车局或清理相册时，删除对应 Group 或标记过期后异步清理。

约束：

- Group 维度使用 `session_id`，不跨车局复用。
- Person 维度使用现有 `person_key`，如 `seat:12`、`session-npc:30`。
- 单个 Person 只保留 3-5 张高质量代表脸。
- 不把全部相册照片都灌进人员库。

官方参考：

- 腾讯云人脸识别计费概述：https://cloud.tencent.com/document/product/867/17640
- 腾讯云人员搜索接口：https://cloud.tencent.com/document/product/867/44992
- 腾讯云人脸检测接口：https://cloud.tencent.com/document/product/867/44989
- 腾讯云 COS 计费：https://cloud.tencent.com/document/product/436/16871

## 成本估算

按腾讯云官方计费页 2026-07-01 版本估算，低量后付费口径：

| 项目 | 后付费单价 |
| --- | ---: |
| 人脸检测与分析 | 0.0005 元/次 |
| 人脸搜索 | 0.0032 元/次 |
| 人员库管理 | 0.0032 元/次 |

每月每种服务通常有 10000 次免费额度。最终以腾讯云控制台和合同价为准。

### MVP 单张照片成本

一张需要智能整理的照片，通常最多包含：

```text
1 次 DetectFace + 1 次 SearchPersons = 0.0037 元
```

代表样本写入只发生在少量已确认单人照上，成本远低于照片搜索主成本。

### 月度估算

| 月分析照片数 | 纯智能整理 API 粗算 | 说明 |
| ---: | ---: | --- |
| 1,000 | 约 0 元 | 通常落在免费额度内 |
| 10,000 | 约 0 元 | 检测和搜索各 1 万次以内 |
| 50,000 | 约 148 元 | 超出免费额度约 4 万张 |
| 100,000 | 约 333 元 | 超出免费额度约 9 万张 |
| 1,000,000 | 约 3,663 元 | 超出免费额度约 99 万张 |

计算公式：

```text
max(检测次数 - 10000, 0) * 0.0005
+ max(搜索次数 - 10000, 0) * 0.0032
+ max(人员库写入次数 - 10000, 0) * 0.0032
```

这个设计靠三件事控成本：

1. 不默认全量扫，只在用户点击“智能整理”后处理。
2. 只处理当前用户有权标注的照片。
3. 只保留少量代表样本，不把每张脸都入库。

### 其他成本

- COS 存储和流量：相册已有展示 JPG，辅助标注不额外保存图片副本，增量很小。
- 后端服务器：MVP 使用 Node worker，不需要 GPU。
- 腾讯云人员库：主要是 API 调用费用，不建议长期无限保留过期车局 Group。
- 开发/调参：真实照片质量差异会带来 0.5-1 天阈值调优成本。

## 开发时间

以当前代码结构估算：

| 工作项 | 估算 |
| --- | ---: |
| 需求收口、迁移和配置项 | 0.5-1 天 |
| Face provider 抽象和腾讯云签名/API 封装 | 1-1.5 天 |
| job 表、worker、任务状态 API | 1-1.5 天 |
| 建议生成、代表样本维护、标签保存联动 | 1.5-2 天 |
| 小程序相册入口、建议展示、确认/拒绝交互 | 1-1.5 天 |
| 测试脚本、隐私/权限回归、错误态 | 1-1.5 天 |
| 真实照片阈值调优和上线配置 | 0.5-1 天 |

MVP 合计：约 6-10 个开发日。

如果同步补齐 admin-web 里的相册智能整理入口，额外增加 1-2 个开发日。

如果第一期就做自建模型、向量检索和大规模聚类，预计变成 2-4 周，并增加服务器和模型许可证评估成本；不建议作为第一期。

## 隐私和合规

人脸属于高敏感个人信息。MVP 必须保守：

- 首次智能整理前明确告知用途。
- 只处理用户本场上传、且有权标注的照片。
- 不跨车局建人物库。
- 不展示人脸框和底层识别细节给公开访问者。
- 不把建议结果用于相册权限。
- 用户删除照片时，相关 suggestions 同步删除或失效。
- 车局删除时，异步清理腾讯云 Group。
- 日志不记录图片 URL 之外的人脸特征、识别向量或完整云端响应。

建议在用户协议或隐私说明中补充：

```text
为了帮助你整理车局相册，我们会在你主动使用智能整理时分析照片中的人脸特征，并仅用于本场相册内的人物标签建议。建议需要你确认后才会保存。
```

## 错误和边界

- provider 未启用：隐藏入口或提示暂未开启。
- 腾讯云失败：任务标记 failed，前端提示稍后重试，不影响普通标注。
- 没有代表样本：提示先手动标注几张清晰单人照。
- 多人脸但只命中一个人：只建议命中的标签，不自动补其他人。
- 低质量脸：不生成建议。
- 用户拒绝建议：同一照片同一标签不再提示。
- 照片被删除：建议失效。
- 座位/NPC 绑定变化：相关 profile 和 suggestions 标记 stale。
- 相册权限变化：加载建议时再次按当前用户和 `can_tag` 过滤。

## 测试与验收

1. 未开启 `FACE_ASSIST_ENABLED` 时，小程序相册不显示智能整理入口，普通相册功能不受影响。
2. 非相册成员不能创建智能整理任务。
3. 用户不能为非本人可标注照片创建建议。
4. 首次点击智能整理必须带 `consent: true`。
5. 没有代表样本时，任务完成但不生成误导性标签。
6. 手动标注单人单脸照片后，可以创建或补充人物代表样本。
7. 有代表样本后，智能整理能为未标注照片生成 pending suggestions。
8. `GET /api/sessions/:id/album` 只返回当前用户自己照片的 pending suggestions。
9. 用户确认建议时，前端调用现有 `PUT /api/session-album/photos/:photoId/tags`。
10. 确认建议后，正式标签进入 `session_album_photo_tags`，建议状态变为 accepted/stale。
11. 用户拒绝建议后，同一照片同一标签不再提示。
12. 删除照片后，相关 suggestions 不再返回。
13. 公开朋友圈相册不返回 suggestions。
14. 现有单张标注、批量标注、下载、隐私设置、相册分享回归通过。

## 分阶段计划

### Phase 1：MVP

- 小程序入口和授权提示。
- 腾讯云 provider。
- 本场人员库和代表样本。
- 按需智能整理任务。
- 建议展示、确认、拒绝。
- 复用现有正式标签接口。

### Phase 2：体验增强

- “有建议”筛选。
- 智能整理结果页。
- 对一组高度相似照片批量确认。
- admin-web 入口。
- 车头可查看全场智能整理概览，但不越权改普通用户照片。

### Phase 3：成本优化

- 本地模型提 embedding。
- MySQL 外接 pgvector 或独立 FAISS 服务。
- 腾讯云只做冷启动、低置信兜底或付费高精度模式。
- 按用户/店铺/剧本维度做更细的费用统计。

## 自检

- 本设计只新增辅助建议，不改变正式标签保存语义。
- 权限仍由现有相册成员和 `can_tag` 控制。
- 公开分享不会暴露建议或识别结果。
- MVP 使用腾讯云托管能力，避免一开始引入 GPU、向量库和模型许可证复杂度。
- 成本控制点明确：按需触发、只处理可标注照片、代表样本限量。
- 开发时间以当前 Node/MySQL/uni-app 架构估算，没有假设重构相册主流程。
