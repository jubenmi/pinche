# D32 Requirements: 管理员相册短视频测试

更新日期：2026-07-08

## Introduction

D32 为车局相册增加短视频媒体项。视频和照片共用同一个相册入口、同一套标注、隐私、删除和可见性规则；产品形态参考朋友圈短视频分享，不做独立视频相册、长视频平台或公开视频广场。

第一阶段只开放 `system_admin` 管理员上传视频，用于验证微信端上传前压缩、COS 存储、数据万象处理成本、处理稳定性和相册混排体验。这不是最终权限模型；未来是否开放给付费用户或免费用户不在 D32 范围内。

## Requirements

### Requirement 1: 管理员测试阶段边界

**User Story:** 作为产品团队，我希望先让管理员测试视频链路，而不是立刻定义所有用户的视频权益。

#### Acceptance Criteria

1. WHEN D32 第一阶段上线 THEN 只有 `system_admin` SHALL 可以看到视频上传入口。
2. WHEN 普通成员、车头但非 `system_admin`、DM、NPC 或玩家访问相册 THEN 系统 SHALL NOT 展示视频上传入口。
3. WHEN 非 `system_admin` 调用视频上传 intent 或创建视频媒体记录 THEN 后端 SHALL 返回 403。
4. WHEN 管理员上传视频 THEN 后端 SHALL 仍校验相册已开放且上传者满足现有相册成员边界。
5. WHEN D32 实现 THEN 系统 SHALL NOT 检查或写入付费用户、免费用户、会员等级、视频额度或上传次数。
6. WHEN 后续要开放给付费或免费用户 THEN SHALL 另写权限、额度、审核和成本规格，不在 D32 内提前实现。

### Requirement 2: 视频与照片混用同一个相册

**User Story:** 作为相册访问者，我希望视频像照片一样出现在同一个车局相册里，而不是需要进入另一个模块。

#### Acceptance Criteria

1. WHEN D32 实现 THEN 系统 SHALL 优先扩展现有相册能力，而不是新增独立视频管理模块。
2. WHEN D32 实现 THEN 后端 SHALL 优先复用现有相册服务、权限、标签、隐私、删除和列表接口，只在媒体类型差异处增加视频分支。
3. WHEN D32 实现 THEN 小程序 SHALL 优先复用当前相册页、筛选、标注、隐私、分享和下载边界，只为视频增加上传、状态、封面和播放能力。
4. WHEN 相册列表加载 THEN 照片和视频 SHALL 按上传时间倒序混排。
5. WHEN 视频进入相册 THEN 视频 SHALL 复用现有相册标注对象和隐私规则。
6. WHEN 视频未标注任何人 THEN 默认只对上传者可见，保持现有未标注相册语义。
7. WHEN 视频标注具体车友 THEN 系统 SHALL 按被标注者和上传者隐私设置计算可见性。
8. WHEN 管理员查看相册 THEN 管理员 SHALL NOT 因为 `system_admin` 身份绕过成员隐私看到不可见视频。
9. WHEN 相册接口返回媒体项 THEN 第一阶段 SHALL 保持 `photos` 兼容字段，并可新增 `media` 字段供后续前端逐步迁移。

### Requirement 3: 朋友圈式短视频限制

**User Story:** 作为管理员，我希望上传短视频记录车局片段，但不希望系统处理长视频或自动拆片。

#### Acceptance Criteria

1. WHEN 管理员选择视频 THEN 单次 SHALL 只允许选择 1 个视频。
2. WHEN 视频时长不超过 60 秒 THEN 前端 MAY 继续压缩和上传流程。
3. WHEN 视频时长超过 60 秒 THEN 前端 SHALL 直接提示“视频最长支持 60 秒，请先剪辑后再上传”。
4. WHEN 视频时长超过 60 秒 THEN 前端 SHALL NOT 调用 `wx.compressVideo`。
5. WHEN 视频时长超过 60 秒 THEN 前端 SHALL NOT 创建 COS 上传 intent、上传源文件或创建视频媒体记录。
6. WHEN D32 第一阶段实现 THEN 系统 SHALL NOT 提供自动切片、自动裁剪、长视频合集或自动选取片段。
7. WHEN 后续需要长视频支持 THEN SHALL 单独设计“选择 60 秒以内片段”的能力，而不是把长视频自动拆成多个相册项。

### Requirement 4: 上传前压缩和直传 COS

**User Story:** 作为管理员，我希望视频上传尽量省流量、速度稳定，也不让 API 服务器承接大文件。

#### Acceptance Criteria

1. WHEN 管理员在小程序上传视频 THEN 前端 SHALL 使用 `wx.chooseMedia` 选择视频。
2. WHEN 视频通过时长和基础大小校验 THEN 前端 SHALL 使用 `wx.compressVideo` 尝试上传前压缩。
3. WHEN 压缩结果小于原文件 THEN 前端 SHALL 上传压缩后文件。
4. WHEN 压缩结果不小于原文件且原文件仍满足限制 THEN 前端 MAY 上传原文件。
5. WHEN 上传前确认展示 THEN 前端 SHALL 显示视频时长、预计上传大小和“按相册隐私展示”的说明。
6. WHEN 上传视频文件 THEN 客户端 SHALL 直传 COS，不经由 API 上传大文件。
7. WHEN 创建 COS intent THEN 后端 SHALL 只允许 `uploads/session-album/videos/source/` 前缀。
8. WHEN 第一阶段 Web 管理端存在视频能力 THEN Web 端 SHALL 至少支持查看、播放、标注和删除；Web 上传可后置。

### Requirement 5: 数据万象生成单一展示资产和按需封面

**User Story:** 作为技术团队，我希望视频处理成本可控，同时让相册播放体验足够稳定。

#### Acceptance Criteria

1. WHEN 源视频上传成功 THEN 数据万象 SHALL 异步生成 1 个展示版 MP4。
2. WHEN 相册需要展示视频封面 THEN 后端 SHALL 生成短期签名的 `ci-process=snapshot&time=1&format=jpg` URL 获取第 1 秒截图。
3. WHEN 生成展示版 MP4 THEN 规格 SHALL 使用 H.264/AAC、单一清晰度、最长边 1280 或 720p、24 或 30 fps。
4. WHEN 生成封面截图 URL THEN SHALL 使用第 1 秒截图，第一阶段不持久化 cover 对象作为 ready 前置条件。
5. WHEN D32 第一阶段处理视频 THEN 系统 SHALL NOT 生成 HLS、多码率、多清晰度、智能封面、视频增强、超分或水印。
6. WHEN 处理成功 THEN 相册 SHALL 长期使用展示版 MP4；封面 SHALL 通过短期签名 URL 按需截帧，后续可切换为持久化 cover。
7. WHEN 处理成功后源文件进入生命周期策略 THEN 源文件 SHOULD 在 7-30 天内自动清理。
8. WHEN 数据万象回调重复到达 THEN 后端 SHALL 幂等更新同一个媒体项，不创建重复视频。

### Requirement 6: 视频访问使用短期签名 URL

**User Story:** 作为技术团队，我希望视频播放不消耗 API 服务器带宽，同时不绕过相册权限。

#### Acceptance Criteria

1. WHEN 用户点击 ready 视频 THEN 前端 SHALL 先请求视频播放签名 URL。
2. WHEN 请求 `GET /api/session-album/media/:id/video-url` THEN 后端 SHALL 校验登录、相册成员、媒体状态和可见性。
3. WHEN 媒体不可见或不属于访问者可见相册 THEN 后端 SHALL 返回 403 或 404，不返回 COS URL。
4. WHEN 校验通过 THEN 后端 SHALL 返回 5-10 分钟有效的 COS 签名 URL。
5. WHEN 前端播放视频 THEN 小程序和 Web 播放器 SHALL 直接拉取 COS 签名 URL。
6. WHEN 视频文件被播放 THEN API 服务器 SHALL NOT 读取 COS 对象并代理返回视频字节流。
7. WHEN 视频签名 URL 过期 THEN 前端 SHALL 重新请求 `video-url`。

### Requirement 7: 前端状态、播放和下载边界

**User Story:** 作为相册访问者，我希望视频状态清楚、点击才播放，并且不会和照片下载能力混淆。

#### Acceptance Criteria

1. WHEN 视频处于 `processing` THEN 相册 SHALL 显示处理中占位和“处理中”文字，不可播放。
2. WHEN 视频处于 `ready` THEN 相册 SHALL 显示封面、播放图标和时长。
3. WHEN 视频处于 `failed` THEN 只对上传者和有视频上传权限的管理员显示“处理失败”状态。
4. WHEN 用户未点击视频 THEN 系统 SHALL NOT 自动播放视频。
5. WHEN 视频状态或公共分享限制需要表达 THEN 前端 SHALL 使用文字说明，不只依赖颜色或图标。
6. WHEN 用户使用“全部下载” THEN 系统 SHALL 只下载照片，不下载视频。
7. WHEN 用户使用“多选下载” THEN 视频卡片 SHALL 不可选为下载对象。
8. WHEN D32 第一阶段实现 THEN 系统 SHALL NOT 提供视频保存到相册、批量视频下载或原片下载。

### Requirement 8: 公开视频分享边界

**User Story:** 作为分享相册的人，我希望朋友圈只读展示不误导访问者点击不可播放的视频，也不暴露播放 URL。

#### Acceptance Criteria

1. WHEN 相册处于朋友圈公开只读模式 THEN 第一阶段 SHALL NOT 返回视频播放签名 URL。
2. WHEN 公开视频里包含可见视频 THEN 页面 MAY 显示视频封面和时长。
3. WHEN 公开视频里显示视频封面 THEN 页面 SHALL 展示“打开小程序查看视频”文案。
4. WHEN 公开视频里显示视频封面 THEN 页面 SHALL NOT 显示可播放但点不动的播放状态。
5. WHEN 后续要开放公开视频播放 THEN SHALL 单独设计 claim 级视频签名、有效期、频控和成本保护。

### Requirement 9: D32 交付物和验证

**User Story:** 作为开发团队，我希望 D32 有明确 spec 三件套和验收清单，方便后续按边界实现。

#### Acceptance Criteria

1. WHEN D32 spec 完成 THEN SHALL 产出 `requirements.md`。
2. WHEN D32 spec 完成 THEN SHALL 产出 `design.md`。
3. WHEN D32 spec 完成 THEN SHALL 产出 `tasks.md`。
4. WHEN D32 实现完成 THEN SHALL 更新相关静态检查和后端烟测。
5. WHEN D32 实现完成 THEN SHALL 通过 `npm run check`。
6. WHEN D32 实现完成 THEN SHALL 通过 `npm run build:mp-weixin`。
