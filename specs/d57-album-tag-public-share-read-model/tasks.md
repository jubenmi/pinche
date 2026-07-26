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

- [x] 3. 实现 AlbumTagResolver 与规范化标签写入
  - 验证：Task 3 扩展聚焦、D48/D50/D54、小程序构建和真实 MySQL 8.4 通过；单快照 read context 与 legacy FK 修复经二次质量复审无 Critical/Important。
  - [x] 3.1 先写三种 tag key、同场次约束、角色改名和 DTO 安全失败测试。
  - [x] 3.2 新增 `album-tags.js`，实现标签选项、写入解析、显示 resolver 和隐私 subject resolver。
  - [x] 3.3 将成员相册、公开资格、封面资格和标签更新切换到新表。
  - [x] 3.4 删除生产代码对旧标签表、持久化 label 和工作人员账号标签的读写。

- [x] 4. 实现规范化 PublicShareManifest
  - 验证：规格审查通过；固定 500 行批量写入后质量复审无 Critical/Important。Task 4 聚焦测试 52/52、D54 57/57、API syntax 105 files 及 diff check 通过。
  - [x] 4.1 先写清单创建、历史顺序、mismatch、ordinal cursor 和动态失效填页测试。
  - [x] 4.2 新增 `public-album-share-manifest.js`，实现 items 写入、加载、成员集和 ordinal 分页。
  - [x] 4.3 新分享同事务写兼容 JSON 与 items；历史 token 通过回填 items 继续有效。
  - [x] 4.4 将图片、视频封面、视频地址和视频字节授权切换到 manifest items。

- [x] 5. 实现 PublicMediaState 接口
  - 验证：规格审查通过；修复公开字段白名单、空 body 和 capability 真实有效期后，质量复审无 Critical/Important。Task 5/Manifest/分页/单媒体复验 58/58。
  - [x] 5.1 先写 ID 规范化、批次上限、清单外拒绝、撤回和安全 DTO 失败测试。
  - [x] 5.2 新增 `public-album-media-state.js`，复用当前公开资格和标签 resolver。
  - [x] 5.3 增加 `POST .../media-state` 路由并附加短期图片/视频 URL。
  - [x] 5.4 增加不含敏感字段的结构化事件与失败关闭测试。

- [x] 6. 实现客户端四事件状态模型
  - 验证：修复 timer 零延迟风暴、聚焦预览重建、首屏水合、零卡片探针与本地封面生命周期后，规格/质量复审无 Critical/Important；聚焦测试 69/69、相册测试 117/117、小程序构建通过。
  - [x] 6.1 先写 reducer、并发排列、批次、失败原子性和 generation 失败测试。
  - [x] 6.2 新增 `publicAlbumReadState.js` 和公开媒体状态 timer controller。
  - [x] 6.3 将首屏、下一页、媒体 patch 和 unload 接入 `album.vue`。
  - [x] 6.4 按 ID 更新/移除瀑布流卡片，保证除首屏外不做全量 rebuild。

- [x] 7. 删除旧公开刷新补丁并对齐历史契约
  - 验证：生产代码已删除旧公开刷新链并隔离成员/公开 controller；D23/D26 历史门禁已改为验证 normalized manifest 与 canonical tag DTO，D48/D50/D52/D54 说明和回归均已对齐。
  - [x] 7.1 删除前缀重读、`publicShareLoadedPageCount`、序列比较和公开完整列表 reload。
  - [x] 7.2 保留成员相册完整媒体刷新，与公开 media-state 控制器分离。
  - [x] 7.3 更新 D48/D50/D52/D54 被 D57 替换的标签和刷新说明。
  - [x] 7.4 更新旧 fixture、smoke 和静态门禁，不让生产代码重新引用旧标签表或补丁 helper。

- [x] 8. 建立 D57 门禁并完成自动化回归
  - 验证：D57 61/61、相关 D54/D55/D56/统一分享回归、迁移和小程序 production build 全绿；2026-07-26 完整 `npm run check` 与 `git diff --check` 退出码均为 0。生产主包 1,497,058 bytes，低于 1.5 MiB 门限 75,806 bytes；开发包保留 76,826-byte IDE metadata，生产包排除该文件。
  - [x] 8.1 新增 `d57:unit`、`d57:check` 并接入 `postcheck`。
  - [x] 8.2 运行迁移、D48/D50/D54/D55/D56、D57 聚焦测试与小程序构建。
  - [x] 8.3 运行完整 `npm run check`、`git diff --check` 并记录结果。

- [x] 9. 整体代码审查与修复
  - 验证：两名独立审查者分别完成规格与质量复审；完整修复 manifest 审计、总数语义、公开 reducer 写入、请求 authority 隔离及历史规格矛盾后，最终 Critical / Important / Minor 均为 0。非法历史 JSON 新增 RED→GREEN 回归；最终 `npm run check`、D57 61/61、公开分页 9/9 与 `git diff --check` 全绿。
  - [x] 9.1 逐条对照 requirements、design 和 tasks 做完成审计。
  - [x] 9.2 审查数据库安全、公开 DTO、并发状态、卸载和回归风险。
  - [x] 9.3 修复全部 Critical/Important 问题并重新运行完整验证。

- [x] 10. CI 发布
  - 验证：`develop` `55a1c2db9a0ac606dec8b134de5ea6c7ee441055` 的 CI / Docker Publish 为 `30178482018` / `30178482036`；`main` `17b71e4c96b8ec878af9779b6ae979cdbf8e9d23` 为 `30178602321` / `30178602403`；`publish` `c2434f9a81d298ff0442fec86bdf3ac95c274e28` 为 `30178734098` / `30178734141`，六个 workflow 均为 success。API 发布 manifest 为 `sha256:12917079f4f8bbb00d720ed1ec90a3bbbf9cbd762e1194a392438976babfe79d`。
  - [x] 10.1 将已验证提交落地 `develop` 并等待 CI 成功。
  - [x] 10.2 提升到 `main` 并等待 CI 成功。
  - [x] 10.3 提升到 `publish` 并等待 CI 成功。
  - [x] 10.4 记录三个分支 commit SHA 和 CI run ID。

- [ ] 11. 小程序验证与送审
  - 当前证据：生产 Stack 于 2026-07-26 成功部署，API `/health` 与 `/health/db` 均为 ok；六个后端服务使用同一发布 digest，迁移容器 exit 0。微信 Nightly 使用正式 API 与用户 1 登录态完成 263 项公开分享验收：首屏 30、追加后 60，追加前后 scrollTop 均为 2545，首屏 ID 前缀不变；分页 flight 内触发 `onShow` 后仍正常追加；角色标签包含赵晚舟、陈稷、方圆、杨小池、陈明遇、方亨、阎应元和“其他”，公开 DTO 不含用户/玩家身份字段；本地媒体撤回使 read state 与瀑布流同步 60→59；无效分享关闭失败并返回首页；运行时 exception 为 0。
  - 上传证据：production 包总大小 1,570,769 bytes；版本 `0.20260726.0827` 于 2026-07-26 08:28:03 CST 通过微信开发者工具官方 CLI 上传成功。真机预览二维码于 08:36:43 CST 生成，等待真机确认后提交审核。
  - [x] 11.1 刷新微信开发者工具构建产物并完成编译。
  - [x] 11.2 验证角色/NPC/其他标签、触底连续分页、分页期间 `onShow`、媒体撤回和分享失效。
  - [ ] 11.3 使用真机确认滚动不回顶部且无账号标签泄漏。
  - [ ] 11.4 上传已验证版本并提交微信审核，记录版本号与审核单状态。
