# D55 任务：客户端三图分享封面

- [ ] 1. 规格与基线
  - [x] 1.1 提交 D55 requirements、design、tasks 与实施计划。
  - [ ] 1.2 确认 `main`/`publish` 尚未提升，并保持发布暂停。
    - 本提交只在隔离的 `develop` 合并工作树中落地；未推送，也未操作 `main`/`publish`，发布保持暂停。

- [x] 2. 服务端三图 recipe（测试先行）
  - [x] 2.1 写新分享最多 3 项、旧 9/30 项兼容、失效项过滤与 DTO recipe 的失败测试。
  - [x] 2.2 让新快照只保存 3 个安全封面 ID，历史行仍接受 30 项；公开 DTO 只下发 1～3 个签名缩略图 recipe。
  - [x] 2.3 移除公开封面 JPEG 路由、token、图片分析、缓存和依赖注入；删除对应服务器测试与门禁。
  - [x] 2.4 修复分享 token DTO 缺少 recipe：按持久化封面 ID 安全投影元数据，并与公开 DTO 复用同一签名 recipe 序列化器。

- [x] 3. 客户端 Canvas（测试先行）
  - [x] 3.1 写 recipe、本地预览优先/缩略图兜底、1/2/3 图布局、裁切计划、缓存复用、过期关闭和分通道降级测试。
  - [x] 3.2 新增纯 Canvas 计划工具与微信运行时适配器，优先使用本地预览、缺失时使用缩略图，导出两个本地临时 JPEG。
  - [x] 3.3 接入 `album.vue` 当前成员分享与公开分享预热、菜单门禁和回退，不改变 D53 四操作选图与正文分页。

- [ ] 4. D55 门禁、验证和发布恢复
  - [x] 4.1 更新 D48/D50/D54/D52（删除或替换）静态检查，新增 D55 单元与静态门禁。
    - D55 静态门禁先因缺少 package 接线、旧 D23/D48/D54/通用小程序断言与 Docker 字体依赖失败，更新后 `npm run d55:check` 通过；无关的 D52 历史时间修正门禁保留。
  - [x] 4.2 运行聚焦测试、小程序构建、完整 `npm run check`、`git diff --check` 与 obsolete scan。
    - RED：D55 客户端聚焦测试以 4 项缺失的当前页本地映射、隐藏 Canvas、公开页 Canvas 与生命周期清理断言失败；API recipe 以 2 项错误的 4 图持久化和 DTO 缺少安全投影断言失败；旧跨页交接删除断言以 1 项失败。
    - GREEN：`npm run d53:unit` 12/12；`npm run d54:unit` 依次通过 D53 12/12 和 D54 45/45；`npm run d55:unit` 45/45；D53/D54/D55 静态门禁、fresh `npm run build:mp-weixin`、`node scripts/check-miniprogram.js`、完整 `npm run check`、obsolete scan 与 `git diff --check` 均通过。
    - 包体硬门禁：main package 1,570,813 bytes / 1,572,864 bytes，剩余 2,051 bytes；未放宽 1.5 MiB 上限。
  - [ ] 4.3 将更新后的提交合并入 `develop` 并等待 CI；成功后才恢复 `main`、`publish` 提升。
    - 本提交只完成隔离工作树中的本地 `develop` 合并与验证；不推送、不触发 CI、不提升 `main`/`publish`，因此本项保持未完成。
  - [x] 4.4 完成最终复核修复的 RED/GREEN、D55/D54、构建、全量检查、1.5 MiB 包体硬门禁与 obsolete scan。
