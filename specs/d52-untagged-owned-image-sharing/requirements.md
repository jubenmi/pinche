# D52 本人未标注图片便捷分享需求

## 1. 目标

D52 允许同车成员把本人上传、审核通过但尚未标注的图片加入本人发起的公开相册或单图分享。未标注图片不自动写成“其他”，不改变普通成员相册可见性，也不获得跨分享长期授权。

整册分享必须先展示与接收者一致的公开快照预览；用户可以直接分享，也可以按需排除媒体。单图全屏预览已经展示准确目标，继续直接准备微信原生分享。

## 2. 术语

- **未标注图片**：`media_type = image` 且当前有效标签集合为空。
- **隐式未标注快照项**：本次公开快照中，以“分享者本人上传的未标注图片”资格进入的媒体及其标签版本。
- **标签版本**：图片每次保存标签时递增的 `tag_version`。
- **分享预览**：创建快照后、真正通过微信外发前，分享者看到的只读公开相册状态。

## 3. Requirement 1：未标注与“其他”保持分离

**User Story：** 作为上传者，我希望没有分类需求时可以直接分享图片，同时不污染相册标签和成员可见性。

1. WHEN 本人图片尚未标注 THEN 普通成员相册 SHALL 继续显示“待标注”。
2. WHEN 本人未标注图片进入分享快照 THEN 系统 SHALL NOT 创建 `other:session` 或其他标签。
3. WHEN 本人未标注图片进入分享快照 THEN 普通成员相册 SHALL 继续只有上传者可见。
4. WHEN 用户主动标注“其他” THEN 系统 SHALL 继续沿用既有“其他”标签和成员可见规则。
5. WHEN 公开接收页展示媒体 THEN 页面 SHALL NOT 暴露“待标注”“隐式其他”或内部授权状态。

## 4. Requirement 2：本人未标注图片资格

**User Story：** 作为分享者，我希望自己上传的合规未标注图片能进入自己的分享，但不能带出别人的未标注内容。

1. WHEN 媒体以未标注资格进入快照 THEN 媒体 SHALL 为图片，不得为视频。
2. WHEN 媒体以未标注资格进入快照 THEN `uploader_user_id` SHALL 等于分享者用户 ID。
3. WHEN 媒体以未标注资格进入快照 THEN 媒体 SHALL 属于当前车局、状态为 `active` 且审核已通过。
4. WHEN 媒体以未标注资格进入快照 THEN 当前标签 SHALL 为空。
5. WHEN 上传者的 `allow_uploaded_visible = false` THEN 媒体 SHALL 被排除，包括上传者本人发起分享。
6. WHEN 他人上传的媒体未标注 THEN 当前分享者 SHALL NOT 通过默认范围、自定义范围或单图入口分享它。
7. WHEN 新客户端未显式声明纳入本人未标注图片 THEN 服务端 SHALL 保持旧版“未标注不可公开”行为。

## 5. Requirement 3：快照级资格与标签版本

**User Story：** 作为照片中的潜在人物，我希望图片标签发生变化后不会借用旧的未标注资格重新公开。

1. WHEN 创建含未标注图片的快照 THEN 分享记录 SHALL 保存每项 `media_id + tag_version`。
2. WHEN 保存任意图片标签 THEN `tag_version` SHALL 在同一事务中递增，即使最终标签集合未变化。
3. WHEN 公开读取未标注快照项 THEN 当前 `media_id + tag_version` SHALL 与快照记录完全匹配。
4. WHEN 未标注快照项后来保存过标签 THEN 该项 SHALL 从旧分享中排除且不得自动恢复。
5. WHEN 图片后来存在标签 THEN 系统 SHALL 使用既有已标注媒体隐私规则，不得借用旧未标注资格。
6. WHEN 创建快照摘要 THEN 摘要 SHALL 覆盖隐式未标注条目，语义不同的快照不得复用。
7. WHEN 快照过期或撤销 THEN 其中的未标注资格 SHALL 同时失效，不影响图片或其他快照。

## 6. Requirement 4：整册预览并分享

**User Story：** 作为分享者，我希望在真正外发前看到接收者将看到的准确内容。

1. WHEN 新客户端展示成员相册 THEN 页面 SHALL 提供明确的“预览并分享”入口。
2. WHEN 用户点击“预览并分享” THEN 服务端 SHALL 生成默认公开快照，并允许纳入本人合规未标注图片。
3. WHEN 分享预览打开 THEN 预览媒体内容和顺序 SHALL 与接收者公开页一致。
4. WHEN 分享预览包含未标注图片 THEN 页面 SHALL 展示总数、未标注图片数量和不适合公开人物提示。
5. WHEN token 或封面尚未准备好 THEN 页面 SHALL NOT 展示可执行的微信原生分享入口。
6. WHEN 分享预览已准备好 THEN 用户 SHALL 可使用原生按钮分享给好友或群，并可使用右上角分享到朋友圈。
7. WHEN 新客户端仍处于成员相册 THEN 页面 SHALL 隐藏可绕过预览的整册微信分享菜单。
8. WHEN 旧客户端未声明新能力 THEN 旧客户端 MAY 继续分享已标注合规媒体，但 SHALL NOT 自动包含未标注图片。

## 7. Requirement 5：可选调整分享内容

**User Story：** 作为分享者，我希望默认直接分享，也能排除具体项目而不必给它们增加标签。

1. WHEN 分享预览已生成 THEN 页面 SHALL 提供可选的“调整分享内容”。
2. WHEN 用户进入调整模式 THEN 当前快照媒体 SHALL 默认被选中。
3. WHEN 用户取消选择媒体 THEN 系统 SHALL NOT 修改该媒体标签、普通相册可见性或下载/标注选择状态。
4. WHEN 用户保存自定义范围 THEN 服务端 SHALL 重新验证每个媒体 ID。
5. WHEN 自定义范围包含无权、失效、未批准或隐私否决媒体 THEN 服务端 SHALL 返回通用范围变化错误，不得静默增加其他媒体。
6. WHEN 自定义范围超过 30 项或视频超过 3 项 THEN 客户端 SHALL 阻止且服务端 SHALL 拒绝。
7. WHEN 自定义快照展示 THEN 媒体 SHALL 使用现有公开相册稳定时间顺序，不使用勾选顺序。

## 8. Requirement 6：单图分享

**User Story：** 作为上传者，我希望在已经打开目标图片时直接分享，不增加多余确认页。

1. WHEN 本人未标注图片在全屏预览中打开 THEN 客户端 MAY 请求包含 `focusMediaId` 的快照并显式允许本人未标注图片。
2. WHEN 单图 token 准备完成 THEN 页面 SHALL 展示微信原生分享按钮。
3. WHEN 单图图片未标注 THEN 分享按钮附近 SHALL 提示“未标注，仅在你主动分享后公开”。
4. WHEN 未标注图片不是本人上传 THEN 单图分享 SHALL 保持不可用。
5. WHEN 单图目标失效 THEN 系统 SHALL 返回 `ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE`，不得回退其他媒体。

## 9. Requirement 7：数量、排序与封面

1. WHEN 默认快照超过容量 THEN 系统 SHALL 最多选择 30 项，其中视频最多 3 项。
2. WHEN 默认排序 THEN 系统 SHALL 依次优先：分享者上传且标注本人席位、他人上传且标注分享者席位、分享者上传的其他已标注内容、分享者上传的未标注图片。
3. WHEN 同一优先级排序 THEN 系统 SHALL 使用稳定创建时间和 ID。
4. WHEN 单图指定目标合规 THEN 目标 SHALL 先进入快照，再按既有规则补齐完整相册范围。
5. WHEN 生成微信封面 THEN 隐式未标注图片 SHALL NOT 成为封面候选。
6. WHEN 没有安全封面 THEN 客户端 SHALL 使用现有品牌兜底封面。

## 10. Requirement 8：动态复核与安全返回

1. WHEN 公开列表、封面或媒体文件被读取 THEN 服务端 SHALL 重新校验状态、审核、隐私、标签和标签版本。
2. WHEN 媒体失去资格 THEN 该项 SHALL 从旧分享中消失，其他合规项继续展示。
3. WHEN 公开 DTO 返回 THEN SHALL NOT 包含 `implicit_untagged_media`、`tag_version`、原始标签或上传者身份。
4. WHEN 全部快照项失效 THEN 接收页 SHALL 展示统一不可查看状态，不透露具体隐私用户。
5. WHEN 分享准备失败 THEN 客户端 SHALL 保留当前页面、允许重试并保持原生分享入口关闭。

## 11. 验收

1. API 自动测试覆盖未标注资格、他人排除、视频排除、标签版本、摘要兼容、动态复核、自定义范围和封面排除。
2. 小程序自动测试覆盖分享预览路由、计数文案、默认/自定义选择、单图 include 标志、菜单门禁和失败关闭。
3. 聚焦 D48/D50 回归测试全部通过。
4. 微信开发者工具验证整册预览、调整范围、好友/群分享、朋友圈分享、单图分享和标签变化后旧链接失效。
