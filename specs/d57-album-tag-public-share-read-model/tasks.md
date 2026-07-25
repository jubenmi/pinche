# D57 任务：相册标签与公开分享读取模型

- [x] 1. 建立 D57 规格与干净基线
  - [x] 1.1 创建并审阅 `requirements.md`、`design.md`、`tasks.md` 与实施计划。
  - [x] 1.2 清除未提交的旧补丁路线，确认工作树只包含 D57 规格。
  - [x] 1.3 运行 D57 相关现有回归，记录实施前基线：迁移门禁 35/35、D50 44/44、D54 53/53 及小程序构建于 2026-07-26 通过。

- [x] 2. 建立规范化数据库模型与可信回填
  - 验证：聚焦契约与真实 MySQL 8.4 通过；覆盖精确 kind、非法 JSON、确定性去重、DDL 中断重试及所有权级联，质量复审无 Critical/Important。
  - [x] 2.1 先写迁移结构、约束、文件名历史和回填失败测试。
  - [x] 2.2 新增 `0035_album_tag_public_share_read_model.sql`，创建 tags/items 表并回填可信数据。
  - [x] 2.3 更新迁移文件名历史、registry/checksum 测试并验证迁移幂等。

- [ ] 3. 实现 AlbumTagResolver 与规范化标签写入
  - [ ] 3.1 先写三种 tag key、同场次约束、角色改名和 DTO 安全失败测试。
  - [ ] 3.2 新增 `album-tags.js`，实现标签选项、写入解析、显示 resolver 和隐私 subject resolver。
  - [ ] 3.3 将成员相册、公开资格、封面资格和标签更新切换到新表。
  - [ ] 3.4 删除生产代码对旧标签表、持久化 label 和工作人员账号标签的读写。

- [ ] 4. 实现规范化 PublicShareManifest
  - [ ] 4.1 先写清单创建、历史顺序、mismatch、ordinal cursor 和动态失效填页测试。
  - [ ] 4.2 新增 `public-album-share-manifest.js`，实现 items 写入、加载、成员集和 ordinal 分页。
  - [ ] 4.3 新分享同事务写兼容 JSON 与 items；历史 token 通过回填 items 继续有效。
  - [ ] 4.4 将图片、视频封面、视频地址和视频字节授权切换到 manifest items。

- [ ] 5. 实现 PublicMediaState 接口
  - [ ] 5.1 先写 ID 规范化、批次上限、清单外拒绝、撤回和安全 DTO 失败测试。
  - [ ] 5.2 新增 `public-album-media-state.js`，复用当前公开资格和标签 resolver。
  - [ ] 5.3 增加 `POST .../media-state` 路由并附加短期图片/视频 URL。
  - [ ] 5.4 增加不含敏感字段的结构化事件与失败关闭测试。

- [ ] 6. 实现客户端四事件状态模型
  - [ ] 6.1 先写 reducer、并发排列、批次、失败原子性和 generation 失败测试。
  - [ ] 6.2 新增 `publicAlbumReadState.js` 和公开媒体状态 timer controller。
  - [ ] 6.3 将首屏、下一页、媒体 patch 和 unload 接入 `album.vue`。
  - [ ] 6.4 按 ID 更新/移除瀑布流卡片，保证除首屏外不做全量 rebuild。

- [ ] 7. 删除旧公开刷新补丁并对齐历史契约
  - [ ] 7.1 删除前缀重读、`publicShareLoadedPageCount`、序列比较和公开完整列表 reload。
  - [ ] 7.2 保留成员相册完整媒体刷新，与公开 media-state 控制器分离。
  - [ ] 7.3 更新 D48/D50/D52/D54 被 D57 替换的标签和刷新说明。
  - [ ] 7.4 更新旧 fixture、smoke 和静态门禁，不让生产代码重新引用旧标签表或补丁 helper。

- [ ] 8. 建立 D57 门禁并完成自动化回归
  - [ ] 8.1 新增 `d57:unit`、`d57:check` 并接入 `postcheck`。
  - [ ] 8.2 运行迁移、D48/D50/D54/D55/D56、D57 聚焦测试与小程序构建。
  - [ ] 8.3 运行完整 `npm run check`、`git diff --check` 并记录结果。

- [ ] 9. 整体代码审查与修复
  - [ ] 9.1 逐条对照 requirements、design 和 tasks 做完成审计。
  - [ ] 9.2 审查数据库安全、公开 DTO、并发状态、卸载和回归风险。
  - [ ] 9.3 修复全部 Critical/Important 问题并重新运行完整验证。

- [ ] 10. CI 发布
  - [ ] 10.1 将已验证提交落地 `develop` 并等待 CI 成功。
  - [ ] 10.2 提升到 `main` 并等待 CI 成功。
  - [ ] 10.3 提升到 `publish` 并等待 CI 成功。
  - [ ] 10.4 记录三个分支 commit SHA 和 CI run ID。

- [ ] 11. 小程序验证与送审
  - [ ] 11.1 刷新微信开发者工具构建产物并完成编译。
  - [ ] 11.2 验证角色/NPC/其他标签、触底连续分页、分页期间 `onShow`、媒体撤回和分享失效。
  - [ ] 11.3 使用真机确认滚动不回顶部且无账号标签泄漏。
  - [ ] 11.4 上传已验证版本并提交微信审核，记录版本号与审核单状态。
