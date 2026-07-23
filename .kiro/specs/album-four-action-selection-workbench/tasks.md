# 相册四操作与批量选择工作台任务

## 事实来源

需求：`.kiro/specs/album-four-action-selection-workbench/requirements.md`

设计：`.kiro/specs/album-four-action-selection-workbench/design.md`

## 执行规则

- 严格按编号顺序实施，先建立失败测试或静态契约，再做最小实现。
- 每完成一个子任务立即更新本文件；父任务只有在全部子任务完成后才能勾选。
- 实施已于 2026-07-23 启动；只在获得代码或验证证据后勾选任务。
- 不回滚或覆盖 `package-lock.json`、`specs/d48-album-sharing-role-claim-separation/tasks.md`、`design-exports/`、`docs/design*`、`docs/evidence/`、`output/` 等现有工作区修改。
- 不恢复分享预览页，不增加“全部 / 多选”动作层，不改变现有公开资格和角色认领规则。

## 任务

- [x] 1. Spec 与现状预检
  - [x] 1.1 阅读本 spec 的 `requirements.md`、`design.md` 和 `tasks.md`。
  - [x] 1.2 检查 dirty working tree，记录并避开所有既有修改和未跟踪资产。
  - [x] 1.3 对照 `album.vue` 的普通操作区、三个 selection purpose、筛选 watcher、浮动工具栏和微信分享回调。
  - [x] 1.4 对照 `server.js` 与 core service 的 `focusMediaId`、30 项快照、9 项封面和 token 隔离。
  - [x] 1.5 对照 `share.vue`，确认新招募入口使用 `/pages/session/share?id=...` 且不传新的 `entry=album`。

- [x] 2. 建立专项失败契约
  - [x] 2.1 新建 `scripts/d53-album-four-action-selection-check.js`，断言普通操作区按顺序存在 `分享`、`下载`、`标注`、`招募`。
  - [x] 2.2 在检查中断言旧顶部文案 `预览并分享`、`全部下载`、`多选下载`、`批量标注` 不再作为普通状态按钮。
  - [x] 2.3 在检查中断言分享和下载分别直接进入 `selectionModePurpose = "share"` 与 `"download"`。
  - [x] 2.4 在检查中断言分享底栏包含 `分享全部`、`分享选中`，下载底栏包含 `下载全部`、`下载选中`，且未选时“选中”按钮禁用。
  - [x] 2.5 在检查中断言分享使用独立图标、招募使用人物加号图标、标注保持绿色主样式。
  - [x] 2.6 在检查中断言 share / download 模式切换筛选不清空选择，下载选中从完整 `downloadablePhotos` 解析。
  - [x] 2.7 在检查中断言招募进入角色邀请页且不传 `entry=album`。
  - [x] 2.8 新建 `apps/api/test/album-share-selection.test.mjs`，覆盖显式 all、精确 selected、互斥输入、31 项以上 ID、9 项封面和摘要稳定性。
  - [x] 2.9 在 `package.json` 增加 `d53:unit` 与 `d53:check`，先运行并确认因功能未实现而失败。

- [x] 3. 扩展分享范围纯契约
  - [x] 3.1 在 `apps/api/src/modules/core/service.js` 增加分享输入规范化 helper，输出且只输出 `legacy`、`all`、`selected` 或 `focus` 一种模式。
  - [x] 3.2 让 helper 拒绝 `scope`、`mediaIds` 和 `focusMediaId` 的任何冲突组合。
  - [x] 3.3 让 selected 模式拒绝空数组、重复 ID、非安全正整数和非数组输入。
  - [x] 3.4 移除 `media_ids` 的固定 30 项规范化上限；保留数组安全校验和 `cover_media_ids` 的 9 项上限。
  - [x] 3.5 更新 `publicShareSnapshotDigest()` 和快照行规范化，使 31 项以上完整集合摘要稳定且仍校验封面子集。
  - [x] 3.6 运行 `npm run d53:unit`，确认纯契约测试通过。

- [x] 4. 实现服务端全部与选中分享
  - [x] 4.1 修改 `apps/api/src/server.js`，把 `scope`、`mediaIds` 和 `focusMediaId` 传入分享服务。
  - [x] 4.2 修改 `createOrReuseSessionAlbumPublicShare()`，为新客户端显式分流 all、selected 和 focus，同时保留无字段 legacy 行为。
  - [x] 4.3 all 模式使用现有统一公开资格函数返回提交时全部符合条件的媒体，不应用 30 项或视频数量裁剪。
  - [x] 4.4 selected 模式验证每个 ID 属于当前车局完整公开资格集合，任一失效时返回稳定错误 `ALBUM_PUBLIC_SHARE_SELECTION_INVALID`。
  - [x] 4.5 selected 模式不自动补齐或替换内容，并按相册稳定时间顺序写入完整精确集合。
  - [x] 4.6 focus 模式和 legacy 模式保持既有兼容语义。
  - [x] 4.7 封面选择继续只从最终快照中选最多 9 项，并保持安全封面降级。
  - [x] 4.8 相同完整快照继续复用，不同媒体集合不得因截断或摘要错误而误复用。

- [ ] 5. 建立后端数据库 smoke
  - [x] 5.1 新建 `scripts/d53-album-four-action-selection-smoke.js`，建立至少 32 个符合公开资格媒体的车局夹具。
  - [ ] 5.2 验证 `{ scope: "all" }` 的 `visible_count` 与快照包含全部合规媒体。
  - [ ] 5.3 验证 31 项以上 selected 请求成功且快照只包含精确选择集合。
  - [ ] 5.4 验证空、重复、跨车局、作者私有、未审核、处理中视频和隐私阻止媒体关闭式失败。
  - [ ] 5.5 验证 selected 任一失效时整体失败，all 在提交时重新计算最新资格。
  - [ ] 5.6 验证公开读取只返回快照与当前资格交集，撤销和过期继续生效。
  - [ ] 5.7 验证 album token 不能认领角色、invite token 不能读取相册。
  - [ ] 5.8 增加 `d53:smoke` 命令，运行 `npm run d53:unit && npm run d53:smoke` 并确认通过。

- [x] 6. 改造普通四操作区
  - [x] 6.1 在 `apps/miniprogram/src/pages/session/album.vue` 用四列等宽布局替换现有下载和批量标注按钮组合。
  - [x] 6.2 按顺序渲染双字文案 `分享`、`下载`、`标注`、`招募`。
  - [x] 6.3 分享使用三节点连接图标，下载使用向下图标，标注使用标签图标，招募使用人物加号图标。
  - [x] 6.4 复用现有或正式 TDesign 图标资产；只有缺失时才在 `apps/miniprogram/src/static/icons/` 增加同体系资产。
  - [x] 6.5 保持标注墨绿实心，其余描边；统一高度、圆角、图标尺寸和图文间距。
  - [x] 6.6 保持标题上传、隐私、筛选和角色选择的结构与行为不变。
  - [x] 6.7 在小屏 CSS 契约中确认四按钮单行不换行、不截字、不溢出。

- [x] 7. 实现分享选择模式
  - [x] 7.1 增加 `openShareSelectionMode()`，检查候选后直接设置 `selectionModePurpose = "share"` 并清空旧选择。
  - [x] 7.2 扩展 `canSelectPhoto()`，share 模式允许本地已知可公开图片和 ready 视频。
  - [x] 7.3 修改筛选 watcher：share 模式切换筛选时保留目的和选择 ID，只刷新瀑布流。
  - [x] 7.4 调整 `album-floating-toolbar`，share 模式状态行显示已选数量和取消，业务行只显示 `分享全部（A）` 与 `分享选中（N）`。
  - [x] 7.5 未选择时禁用 `分享选中`；`分享全部` 与当前勾选无关。
  - [x] 7.6 `shareAllAlbumMedia()` 提交 `{ scope: "all" }`。
  - [x] 7.7 `shareSelectedAlbumMedia()` 提交完整 `selectedPhotoIds`，不做数量裁剪。
  - [x] 7.8 请求期间锁定选择和两个提交按钮；失败时保留选择并展示稳定提示。

- [x] 8. 实现无预览分享就绪状态
  - [x] 8.1 快照成功后退出选择模式并把 token、封面、最终数量保存为活动分享快照。
  - [x] 8.2 在 token 和安全封面都就绪前隐藏好友和朋友圈菜单。
  - [x] 8.3 增加轻量底部就绪层，只显示最终数量、`发送给好友或群聊` 原生分享按钮和朋友圈提示。
  - [x] 8.4 就绪层不得渲染媒体缩略图、顺序或调整入口。
  - [x] 8.5 让就绪层按钮、右上角好友菜单和朋友圈菜单读取同一个活动快照。
  - [x] 8.6 页面隐藏、账号变化、token 失败或活动快照失效时关闭就绪层并清理活动状态。
  - [x] 8.7 保持 `focusMediaId` 单媒体分享 authority 独立，不覆盖批量活动快照或选择 ID。

- [x] 9. 实现下载选择模式双动作
  - [x] 9.1 保留 `openDownloadSelectionMode()` 直接进入下载用途，并统一调用新的选择状态清理边界。
  - [x] 9.2 修改筛选 watcher：download 模式切换筛选时保留目的和选择 ID。
  - [x] 9.3 调整下载底栏，状态行显示已选数量和取消，业务行只显示 `下载全部（A）` 与 `下载选中（N）`。
  - [x] 9.4 未选择时禁用 `下载选中`；`下载全部` 始终使用完整 `downloadablePhotos`。
  - [x] 9.5 修改 `downloadSelectedPhotos()`，从完整 `downloadablePhotos` 解析选择 ID，不使用当前筛选集合。
  - [x] 9.6 保留下载确认、系统权限、逐张保存、进度、部分失败和完成退出行为。
  - [x] 9.7 确认视频和无权限媒体在下载模式下不可选。

- [x] 10. 接入标注与招募
  - [x] 10.1 把普通状态 `批量标注` 文案收敛为 `标注`，继续调用 `openTagSelectionMode()`。
  - [x] 10.2 确认标签候选、人物面板、批量保存和错误恢复没有改变。
  - [x] 10.3 增加 `openRecruitment()`，导航到 `/pages/session/share?id={sessionId}`。
  - [x] 10.4 确认新入口不传 `entry=album`，分享页继续生成独立 `join-invite-token`。
  - [x] 10.5 确认招募只注册好友 / 群聊分享，不注册朋友圈，且使用安全票根封面。

- [x] 11. 状态清理与边界回归
  - [x] 11.1 增加统一 `cancelSelectionMode()`，清理目的、选择、标签面板和顶部悬浮状态。
  - [x] 11.2 确认 share、download、tag 三种用途不能同时存在或复用彼此 ID。
  - [x] 11.3 页面隐藏、退出登录、切换账号和进入公开只读模式时清理未提交状态。
  - [x] 11.4 `albumBusy` 期间阻止进入新模式、切换用途和重复提交。
  - [x] 11.5 无分享、下载、标注候选时分别展示明确 toast；招募不可用由邀请页实时展示。

- [ ] 12. 自动化回归
  - [ ] 12.1 运行 `npm run d53:unit`。
  - [x] 12.2 运行 `npm run d53:check`。
  - [ ] 12.3 运行 `npm run d53:smoke`。
  - [ ] 12.4 运行 `npm run d48:check && npm run d48:smoke`，确认相册与招募分流未回退。
  - [ ] 12.5 运行 `npm run d50:unit && npm run d50:check`，确认单媒体分享未回退。
  - [x] 12.6 运行 `node scripts/check-miniprogram.js`。
  - [x] 12.7 运行 `npm --workspace apps/miniprogram run build:mp-weixin`。
  - [ ] 12.8 检查 git diff，确认只包含本 spec 范围且未覆盖既有工作区改动。

## 2026-07-23 前端命令证据

- `npm run d53:check`：通过（含四操作、用途分支双按钮、活动快照竞态与下载取消契约）。
- `node scripts/check-miniprogram.js`：通过（14 pages）。
- `npm --workspace apps/miniprogram run build:mp-weixin`：通过（仅有上游 Sass deprecation 提示）。

- [ ] 13. 微信开发者工具验收
  - [ ] 13.1 确认普通状态四按钮顺序、双字文案、图标区别和四列布局符合设计稿。
  - [ ] 13.2 点击分享，跨多个筛选选择任意数量媒体，确认选择保留。
  - [ ] 13.3 在未选择时确认分享选中禁用，点击分享全部确认不受当前筛选影响。
  - [ ] 13.4 生成 31 项以上公开快照，确认无预览页且就绪层显示服务端最终数量。
  - [ ] 13.5 分别发送好友 / 群聊并通过朋友圈分享，确认三者打开同一只读快照。
  - [ ] 13.6 点击下载，跨筛选选择图片并下载选中；再验证下载全部覆盖完整可下载集合。
  - [ ] 13.7 确认视频在下载模式不可选，下载权限拒绝和部分失败反馈正常。
  - [ ] 13.8 确认标注仍可批量保存，招募进入角色邀请且朋友圈不可用。
  - [ ] 13.9 确认公开页没有上传、下载、标注、隐私、招募或认领入口。

- [ ] 14. 收尾
  - [ ] 14.1 更新本 `tasks.md`，只勾选具有命令输出或人工证据的项目。
  - [ ] 14.2 记录全部自动化命令、结果和仍待完成的微信人工验收。
  - [ ] 14.3 最终说明四按钮、分享 / 下载双动作、无上限快照、无预览分享和招募分流均按 spec 完成。
