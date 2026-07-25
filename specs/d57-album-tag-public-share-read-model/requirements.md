# D57 需求：相册标签与公开分享读取模型

## 1. 目标

D57 将相册标签、公开分享清单、分页和媒体访问凭证刷新拆成边界清晰的领域能力：

- 照片标签只表示剧本角色、NPC 角色或“其他”；
- 角色名称只从角色表实时解析；
- 公开分享使用生成分享时冻结的有序媒体清单；
- 分页只追加新卡片，后台刷新只更新已有卡片；
- 加载下一页和后台刷新互不取消、互不覆盖，页面不会因全量瀑布流重建跳回顶部。

D57 取代 D48/D54 中依赖 `session_album_photo_tags.label` 的公开展示标签投影，以及 D54 后续补丁中的“重读已加载分页前缀”方案。D48、D50、D52、D54、D55、D56 的分享 token、封面、单图分享和安全复核语义继续兼容，除非本规格明确替换。

## 2. Requirement 1：规范化标签模型

**User Story：** 作为相册参与者，我希望标签描述照片中的剧本内容，而不是扮演者账号。

1. WHEN 写入照片标签 THEN 系统 SHALL 只接受 `role`、`npc_role`、`other` 三种类型。
2. WHEN 标签类型为 `role` THEN 标签 SHALL 只保存照片所在场次的有效角色位引用。
3. WHEN 标签类型为 `npc_role` THEN 标签 SHALL 只保存照片所在场次的有效 NPC 角色引用。
4. WHEN 标签类型为 `other` THEN 标签 SHALL 不保存角色引用，展示文字恒为“其他”。
5. WHEN 保存标签 THEN 系统 SHALL NOT 保存角色名称副本、玩家 ID、昵称、头像、`open_id` 或工作人员账号身份。
6. WHEN 同一媒体重复提交同一角色或重复提交 `other` THEN 数据库或服务 SHALL 拒绝重复记录。
7. WHEN DM、NPC 工作人员或组织者扮演角色 THEN 客户端 SHALL 选择其剧本角色或 NPC 角色，不得创建工作人员账号标签。

## 3. Requirement 2：唯一角色名称解析

**User Story：** 作为相册浏览者，我希望成员相册和公开分享始终显示相同且最新的角色名。

1. WHEN 读取 `role` 标签 THEN `AlbumTagResolver` SHALL 从场次角色位读取最新 `role_name`，仅在其为空时使用角色位 `name`。
2. WHEN 读取 `npc_role` 标签 THEN `AlbumTagResolver` SHALL 从场次 NPC 角色表读取最新 `name`。
3. WHEN 读取 `other` 标签 THEN resolver SHALL 返回固定文字“其他”。
4. WHEN 角色名称被修改 THEN 后续成员相册读取和公开分享读取 SHALL 同时返回最新名称，无需修改照片标签或分享清单。
5. WHEN 角色引用缺失、失效或跨场次 THEN resolver SHALL 丢弃该标签，不得使用历史自由文本、玩家昵称或账号字段回退。
6. WHEN 返回成员或公开标签 DTO THEN DTO SHALL 只包含 `{ kind, ref_id, label }`，不得包含角色绑定玩家信息。
7. WHEN 判断相册隐私资格 THEN 服务端 MAY 根据角色引用单独解析当前角色绑定账号并检查隐私设置，但该授权数据 SHALL NOT 参与标签名称生成或进入响应 DTO。

## 4. Requirement 3：冻结公开分享清单

**User Story：** 作为分享者，我希望旧分享保持创建时的内容范围，而不会自动加入后来上传的照片。

1. WHEN 创建公开分享 THEN 系统 SHALL 在同一事务中写入完整、有序、去重的分享媒体清单。
2. WHEN 写入分享清单 THEN 每一项 SHALL 保存 `share_id`、稳定 `ordinal` 和 `media_id`。
3. WHEN 分享创建后新增照片 THEN 旧分享清单 SHALL 保持不变。
4. WHEN 读取历史 JSON 快照分享 THEN 迁移后的清单 SHALL 保持原 `media_ids` 顺序、token 摘要和有效期。
5. WHEN 创建新分享 THEN 系统 MAY 继续写入兼容用 `media_ids` JSON，但分页、媒体授权和成员资格 SHALL 以规范化清单项为运行时真相来源。
6. WHEN 分享被撤销或过期 THEN 清单项 SHALL 不再授予任何媒体访问能力。

## 5. Requirement 4：稳定清单分页

**User Story：** 作为分享接收者，我希望触底加载只增加后续照片，不改变已看到的内容。

1. WHEN 首次读取公开分享 THEN 接口 SHALL 从 ordinal 0 开始返回最多 30 个仍合规的清单项目和签名 `next_cursor`。
2. WHEN 携带有效 cursor 读取下一页 THEN 服务 SHALL 从 cursor 指定的 ordinal 后继续扫描，不重复、不遗漏、不改变清单顺序。
3. WHEN 动态复核使某项失效 THEN 服务 SHALL 跳过该项并继续扫描，以尽量填满当前页。
4. WHEN cursor 被篡改、跨分享或越界 THEN 服务 SHALL 关闭式失败，不读取其他分享内容。
5. WHEN 下一页成功 THEN 小程序 SHALL 只追加新增媒体卡片并提交新 cursor。
6. WHEN 下一页失败 THEN 小程序 SHALL 保留已有卡片和原 cursor，只显示底部重试状态。
7. WHEN 加载下一页 THEN 小程序 SHALL NOT 清空瀑布流、调用全量 `clear`、重新挂载已有卡片或使用滚动位置补偿。

## 6. Requirement 5：已有媒体状态刷新

**User Story：** 作为正在浏览分享的人，我希望短期媒体地址能续期，同时不打断分页或滚动。

1. WHEN 小程序刷新媒体状态 THEN 客户端 SHALL 只提交当前已经加载的媒体 ID。
2. WHEN 服务收到媒体状态请求 THEN 服务 SHALL 验证每个 ID 属于该分享规范化清单并仍满足审核、隐私、标签版本和处理状态要求。
3. WHEN 媒体仍可见 THEN 服务 SHALL 返回该媒体的最新公开 DTO、访问凭证到期时间和最新角色标签。
4. WHEN 媒体已撤回或失去资格 THEN 服务 SHALL 在 `unavailable_ids` 中返回其 ID，不得返回失效原因或旧访问凭证。
5. WHEN 媒体状态响应到达 THEN 客户端 SHALL 只按 ID 更新或移除已有卡片，不增加新卡片、不改变剩余顺序、不修改 cursor。
6. WHEN 已加载媒体超过单次服务上限 THEN 客户端 SHALL 使用有界批次完成刷新并合并结果。
7. WHEN 媒体状态刷新失败 THEN 客户端 SHALL 保留卡片集合并使用有最小值、最大值的延迟重试。
8. WHEN 当前没有已加载媒体 THEN 客户端 SHALL 发送空 ID 集合只验证分享状态；服务 SHALL 在验证 token、session、分享状态和 manifest 一致性后返回空结果，不读取媒体可见性。

## 7. Requirement 6：四事件客户端状态模型

**User Story：** 作为维护者，我希望公开相册只有少量可证明的状态转移，不依赖请求时序补丁。

1. WHEN 公开相册运行 THEN 列表状态 SHALL 只通过 `INITIAL_PAGE`、`NEXT_PAGE`、`MEDIA_PATCH`、`UNLOAD` 四种事件改变。
2. WHEN `INITIAL_PAGE` 成功 THEN 它 SHALL 建立卡片、cursor 和首屏瀑布流。
3. WHEN `NEXT_PAGE` 成功 THEN 它 SHALL 只写新增卡片、cursor 和分页 loading/error。
4. WHEN `MEDIA_PATCH` 成功 THEN 它 SHALL 只写已有卡片字段、移除失效卡片和安排下一次媒体刷新。
5. WHEN `UNLOAD` 发生 THEN `page_generation` SHALL 递增并取消 timer；所有晚到结果 SHALL 成为无操作。
6. WHEN `NEXT_PAGE` 与 `MEDIA_PATCH` 以任意顺序完成 THEN 最终卡片集合、顺序和 cursor SHALL 一致。
7. WHEN 实现 D57 THEN 代码 SHALL 删除公开模式的已加载页前缀重读、共享列表 request authority 和分页/刷新协调器。

## 8. Requirement 7：迁移、安全与兼容

1. WHEN 执行 D57 数据迁移 THEN 系统 SHALL 只迁移旧 `seat`、`session_npc_role`、`other` 标签。
2. WHEN 旧标签为 `dm`、`npc`、`organizer` 或无法验证同场次引用 THEN 迁移 SHALL 丢弃该行，不得猜测账号与角色关系。
3. WHEN 迁移历史分享 THEN 系统 SHALL 将 JSON `media_ids` 按原顺序展开为清单项，并保证回填逻辑可重复执行。
4. WHEN 公开 DTO 返回 THEN DTO SHALL NOT 返回原始标签对象、持久化自由文本、角色绑定账号、上传者身份、对象 Key、ETag 或作者私有字段。
5. WHEN 图片、视频封面、视频地址或视频字节被读取 THEN 所有路径 SHALL 以分享清单成员资格和当前公开资格重新授权。
6. WHEN D57 发布 THEN D48/D50/D52/D54/D55/D56 的现有公开分享 token、单图分享、封面 recipe 和最多 3 个 ready 视频约束 SHALL 继续有效。
7. WHEN 新迁移文件加入 THEN 迁移文件名历史 SHALL 追加且通过仓库迁移门禁。

## 9. Requirement 8：可观察性与失败关闭

1. WHEN 清单分页、媒体状态刷新或清单成员校验失败 THEN 服务 SHALL 记录不含 token、昵称、`open_id` 和内部 URL 的结构化事件。
2. WHEN 分享 token 无效、过期或撤回 THEN 页面 SHALL 清空媒体访问凭证并进入分享失效状态。
3. WHEN 单个媒体失效 THEN 页面 SHALL 只移除该媒体卡片，不触发全量相册刷新。
4. WHEN 媒体状态请求包含重复 ID THEN 服务 SHALL 去重并保留首次出现顺序；WHEN 请求包含非 number 正整数、越界或去重后超过 100 个 ID THEN 服务 SHALL 返回客户端错误。
5. WHEN 迁移后的规范化清单与兼容 JSON 不一致 THEN 服务 SHALL 关闭式失败并记录审计事件。

## 10. 验收

1. 数据库与迁移测试覆盖合法/非法标签组合、同场次归属、重复标签、可信回填、账号标签丢弃、分享顺序和幂等性。
2. 服务端测试覆盖角色改名、成员/公开同名、隐私授权与标签名称分离、清单分页、失效项填补、cursor 安全、媒体状态成员校验和撤回。
3. 小程序纯状态测试覆盖四事件、两种并发完成顺序、失败保留 cursor、媒体批次合并和 generation 失效。
4. 页面测试覆盖下一页只追加 DOM、媒体状态只更新目标卡片、单项移除、无全量 `clear`、无前缀重读和无滚动补偿。
5. `npm run d57:unit`、`npm run d57:check`、迁移门禁、D48/D50/D52/D54/D55/D56 回归、`npm run check`、小程序构建均通过。
6. 微信开发者工具和真机验收确认：拖到底加载不回顶部；分页期间触发 `onShow` 或媒体续期仍能正常追加；角色标签只显示最新角色名、NPC 角色名或“其他”。
