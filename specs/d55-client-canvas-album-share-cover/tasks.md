# D55 任务：客户端三图分享封面

- [ ] 1. 规格与基线
  - [x] 1.1 提交 D55 requirements、design、tasks 与实施计划。
  - [ ] 1.2 确认 `main`/`publish` 尚未提升，并保持发布暂停。
    - 本次仅在 `codex/share-all-photos-cover-nine` 工作树完成实现与门禁，未操作 `develop`、`main` 或 `publish`。

- [x] 2. 服务端三图 recipe（测试先行）
  - [x] 2.1 写新分享最多 3 项、旧 9/30 项兼容、失效项过滤与 DTO recipe 的失败测试。
  - [x] 2.2 让新快照只保存 3 个安全封面 ID，历史行仍接受 30 项；公开 DTO 只下发 1～3 个签名缩略图 recipe。
  - [x] 2.3 移除公开封面 JPEG 路由、token、图片分析、缓存和依赖注入；删除对应服务器测试与门禁。

- [x] 3. 客户端 Canvas（测试先行）
  - [x] 3.1 写 recipe、本地预览优先/缩略图兜底、1/2/3 图布局、裁切计划、缓存复用、过期关闭和分通道降级测试。
  - [x] 3.2 新增纯 Canvas 计划工具与微信运行时适配器，优先使用本地预览、缺失时使用缩略图，导出两个本地临时 JPEG。
  - [x] 3.3 接入 `album.vue` 分享预热、菜单门禁和回退，不改变正文分页。

- [ ] 4. D55 门禁、验证和发布恢复
  - [x] 4.1 更新 D48/D50/D54/D52（删除或替换）静态检查，新增 D55 单元与静态门禁。
    - D55 静态门禁先因缺少 package 接线、旧 D23/D48/D54/通用小程序断言与 Docker 字体依赖失败，更新后 `npm run d55:check` 通过；无关的 D52 历史时间修正门禁保留。
  - [ ] 4.2 运行聚焦测试、小程序构建、完整 `npm run check`、`git diff --check` 与开发者工具刷新。
    - 自动验证：`npm run d55:unit` 92/92、`npm run d54:unit` 49/49、`npm run check`、`npm --workspace apps/miniprogram run build:mp-weixin` 与 `git diff --check` 均通过。
    - 未完成：微信开发者工具刷新与真机分享验收。
  - [ ] 4.3 将更新后的提交合并入 `develop` 并等待 CI；成功后才恢复 `main`、`publish` 提升。
