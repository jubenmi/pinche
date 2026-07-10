# D35 Tasks: 小程序资料管理后台能力对齐执行清单

更新日期：2026-07-09

## D35 执行任务

- [x] D35.1 建立 D35 spec 三件套。
  - [x] `requirements.md` 描述小程序资料管理后台、扫码登录 web admin、1+3 混合信息架构、店家/剧本/待审核能力、地图无 POI 额度消耗、批量操作和验证要求。
  - [x] `design.md` 描述页面架构、API 复用、店家编辑、地图边界、剧本结构化编辑、待审核流程、错误处理和测试策略。
  - [x] `tasks.md` 描述后续实现和验收清单。

- [x] D35.2 新增 D35 静态检查。
  - [x] 新增 `scripts/d35-miniprogram-admin-catalog-check.js`。
  - [x] 检查小程序 admin catalog 保留 `pinche-admin-login://ticket/`。
  - [x] 检查小程序 admin catalog 调用 `/api/admin/web-login/tickets/:ticketId/approve`。
  - [x] 检查页面存在全局扫码登录入口。
  - [x] 检查页面存在店家、剧本、待审核三个资料域。
  - [x] 检查店家编辑包含 `latitude`、`longitude` 和 `uni.chooseLocation`。
  - [x] 检查小程序 admin catalog 不包含 `qqmap-wx-jssdk`、`/ws/place/v1/search`、`/ws/geocoder/v1`、`uni.getLocation`、`wx.getLocation`。
  - [x] 检查剧本编辑包含结构化玩家角色和 NPC 角色操作。
  - [x] 检查待审核动作包含 approve、needs-changes、reject、merge。
  - [x] 将 D35 检查接入 `scripts/check-miniprogram.js` 和 `npm run check`。

- [x] D35.3 重构小程序资料管理页基础结构。
  - [x] 保留 `apps/miniprogram/src/pages/admin/catalog.vue` 作为页面入口。
  - [x] 抽出或整理管理员权限、tab、加载状态和全局工具区。
  - [x] 建立“1 个工作台 + 3 个资料域”的页面结构。
  - [x] 工作台展示店家数、剧本数、待审核数和最近操作状态。
  - [x] 店家、剧本、待审核资料域支持搜索、筛选和刷新。
  - [x] 编辑面板支持 dirty 状态和关闭确认。

- [x] D35.4 保留并强化扫码登录 web admin。
  - [x] 将“扫码登录 Web 后台”放到全局管理员工具区。
  - [x] 保留 `pinche-admin-login://ticket/` 解析逻辑。
  - [x] 保留扫码后确认弹窗。
  - [x] 保留 approve ticket 接口调用。
  - [x] 无效码、取消确认、ticket 过期和接口失败均展示清晰反馈。
  - [x] 确认普通用户不可见且不可调用扫码 approve。

- [x] D35.5 完善店家管理能力。
  - [x] 店家列表支持关键词、状态、审核状态和城市筛选。
  - [x] 店家新增和编辑支持名称、城市、区域、地址、联系方式备注、状态。
  - [x] 店家表单支持 `latitude` 和 `longitude`。
  - [x] 店家表单标明坐标系为 GCJ-02。
  - [x] 店家保存提交地址和坐标字段。
  - [x] 店家编辑加载关联剧本。
  - [x] 店家关联剧本支持添加、移除和每人价格编辑。
  - [x] 店家保存后同步保存关联剧本。
  - [x] 店家下架和删除流程带二次确认。
  - [x] 删除失败时展示被引用或后端错误原因。

- [x] D35.6 实现小程序原生地图定位能力。
  - [x] 店家表单提供“地图选点”入口。
  - [x] 点击后调用 `uni.chooseLocation`。
  - [x] 选点成功后回填 `address`、`latitude`、`longitude`。
  - [x] 用户取消选点时保留表单且不报错。
  - [x] `chooseLocation` 不可用时提示手填坐标。
  - [x] 有完整坐标时提供 `uni.openLocation` 查看地图入口。
  - [x] 确认小程序 admin catalog 不调用腾讯 POI/WebService。
  - [x] 确认小程序 admin catalog 不调用 `uni.getLocation` 或 `wx.getLocation`。

- [x] D35.7 完善剧本管理能力。
  - [x] 剧本列表支持关键词、状态、审核状态和标签筛选。
  - [x] 剧本新增和编辑支持名称、玩家人数、标签、无剧透简介、状态。
  - [x] 将玩家角色模板从 JSON 文本升级为结构化列表。
  - [x] 玩家角色支持新增、删除、排序、角色名、性别和描述。
  - [x] 角色数量与玩家人数不一致时展示提示。
  - [x] 支持一键按玩家人数补齐默认角色。
  - [x] NPC 角色支持结构化新增、删除和编辑。
  - [x] 模板 JSON 解析失败时保留原始内容并提示修复。
  - [x] 保存剧本时按后端现有字段提交角色和 NPC 数据。
  - [x] 剧本下架和删除流程带二次确认。

- [x] D35.8 完善待审核资料管理能力。
  - [x] 待审核列表支持类型、状态和关键词筛选。
  - [x] 列表展示类型、名称、提交人、创建时间、使用车局数和审核状态。
  - [x] 待审核店家编辑复用店家字段和地图定位能力。
  - [x] 待审核剧本编辑复用剧本结构化角色/NPC 编辑能力。
  - [x] 批准店家时调用 approve 接口并刷新列表。
  - [x] 批准剧本时支持选择关联店家和每人价格。
  - [x] 要求补充时保存审核备注。
  - [x] 拒绝时二次确认并保存审核备注。
  - [x] 合并时选择同类型公共目标资料。
  - [x] 审核动作完成后刷新工作台统计和对应资料列表。

- [x] D35.9 实现店家和剧本批量操作。
  - [x] 店家域支持选择模式。
  - [x] 剧本域支持选择模式。
  - [x] 批量操作栏支持上架。
  - [x] 批量操作栏支持下架。
  - [x] 批量操作栏支持删除已下架资料。
  - [x] 批量删除跳过未下架资料并展示原因。
  - [x] 批量操作执行中禁用重复提交。
  - [x] 批量操作完成后展示成功数、失败数和失败原因。

- [x] D35.10 完善移动端 UI 状态和文案。
  - [x] 首次加载、局部刷新和提交中状态清晰。
  - [x] 空列表有新增或处理入口。
  - [x] 长名称、长地址、长标签不溢出容器。
  - [x] 表单 section 标题简洁，避免说明文堆叠。
  - [x] 删除、拒绝、合并、扫码登录等高风险动作二次确认。
  - [x] 保存失败保留编辑内容。
  - [x] 切换资料域或关闭编辑面板时处理未保存修改。

- [x] D35.11 更新自动验证。
  - [x] 运行 `node --check scripts/d35-miniprogram-admin-catalog-check.js`。
  - [x] 运行 `node scripts/d35-miniprogram-admin-catalog-check.js`。
  - [x] 运行 `node scripts/check-miniprogram.js`。
  - [x] 运行 `npm run build:mp-weixin`。
  - [x] 运行 `npm run check`。
  - [x] 运行 `node --check scripts/d35-admin-catalog-flow-check.js`。
  - [x] 运行 `node scripts/d35-admin-catalog-flow-check.js`（本地 API `http://127.0.0.1:3029`）。
  - [x] 修复 D35 范围内导致的检查或构建失败。

- [ ] D35.12 完成微信开发者工具手工验证。
  - 2026-07-09 进度：自动检查和小程序构建已通过；微信开发者工具手工走查尚未执行，因此本项保持未勾选。
  - 2026-07-09 尝试：已启动本地 API `http://127.0.0.1:3029` 和本地 API 版本小程序 dev/build 产物，避免写入线上数据；微信开发者工具 Nightly `2.01.2512242` 打开 `dist/dev/mp-weixin` 后被 appid 凭证拦截，模拟器报 `INVALID_TOKEN, invalid credential, access_token is invalid or not latest`，无法进入页面完成手工走查。本地临时进程已停止，并已重新运行默认 `npm run build:mp-weixin` 恢复默认构建产物。
  - 2026-07-09 尝试：改用 `/private/tmp/d35-mp-weixin-tourist-2` 临时产物、空 appid 游客模式和本地 API `http://127.0.0.1:3029`。DevTools CLI `auto --trust-project` 成功信任项目；普通编译能打开小程序运行态，页面路径可到 `pages/admin/catalog` / `pages/index/index`，调试器一度为 0 error / 0 warning。继续刷新后 DevTools Nightly 游客模式触发工具层 `webapi_getwxaasyncsecinfo:fail Failed to fetch`，模拟器内容为空白，无法完成端到端点击走查。本项继续保持未勾选。
  - 2026-07-09 修复：继续验证时发现临时项目指向本地 API，但本地 API 一度已停止，导致登录结果被页面文案误判为取消；重启本地 API 后又发现 DevTools Nightly 游客模式下 `wx.login` 可触发 worker 层异常，未稳定进入后端登录。已在 `apps/miniprogram/src/utils/api.js` 增加仅本地 API 场景使用的 `devCode` fallback，并在 `scripts/check-miniprogram.js` 增加静态检查覆盖该行为。
  - 2026-07-09 尝试：重新生成 `/private/tmp/d35-mp-weixin-tourist-3` 临时产物，继续使用空 appid 游客模式和本地 API。将临时项目 `libVersion` 锁到正式配置 `3.12.1`、关闭临时 `minifyWXML` 后，Console 仍出现 DevTools 工具层 `webapi_getwxaasyncsecinfo:fail invalid credential, access_token is invalid or not latest`，WXML 面板 Page DOM 为空且模拟器只显示小程序导航栏，无法进入页面完成手工验收。本项继续保持未勾选。
  - 2026-07-09 诊断：`/Applications/wechatwebdevtools.app/Contents/MacOS/cli islogin --lang zh` 返回 `{"login":true}`，但最近 DevTools 日志仍显示腾讯工具层接口 `https://servicewechat.com/wxa-dev-logic/...` 连续返回 `INVALID_TOKEN, invalid credential, access_token is invalid or not latest`，stderr 同时记录 TLS handshake failure。当前无法在不重新登录/修复 DevTools 与腾讯服务连接状态的情况下完成 D35.12 手工验收。
  - 2026-07-09 进展：用户重新登录微信开发者工具后，`servicewechat.com` / `INVALID_TOKEN` 不再阻塞；本地 API dev 产物可以进入小程序运行态。
  - 2026-07-09 修复：DevTools 小程序运行时缺少 `URL` Web API 时，本地 API 判断失败会导致 `dev-admin-openid` fallback 未生效；已改为手写 hostname 解析并重建 `dist/dev`，UI 登录后身份为 `organizer / player / system_admin`。
  - 2026-07-09 修复：资料管理页使用 `t-tabs` / `t-sticky` 时缺失 TDesign `touch` / `page-scroll` mixin；已补齐 vendor mixin，重新 dev 编译后 Console 无缺失组件 error。
  - 2026-07-09 手工验证：`system_admin` 从首页工具箱进入 `pages/admin/catalog`，页面可见“管理工作台”、“扫码登录 Web 后台”、店家/剧本/待审核统计、新增店家表单和 GCJ-02/不使用 POI 定位文案。
  - 2026-07-09 继续验收：本轮优先验证普通用户权限门禁、扫码登录取消/无效路径，以及一条低风险保存流程；未走通前保持对应 checkbox 未勾选。
  - 2026-07-09 手工验证：DevTools 扫码模拟取消文件选择后，页面留在 `pages/admin/catalog` 且提示“请扫描 Web 后台登录二维码”；选择无效二维码 `/Users/dirui/Downloads/d35-invalid-admin-login-qr.png` 后同样停留在工作台并展示无效码提示。前端 `parseAdminWebLoginQr` 在无 `pinche-admin-login://ticket/` 前缀或缺 secret 时会在调用 approve 接口前返回。
  - 2026-07-09 手工验证：通过本地 API `http://127.0.0.1:3029` 创建 web admin 登录 ticket 并生成有效二维码 `/Users/dirui/Downloads/d35-valid-admin-login-qr.png`；DevTools 扫码后弹出“Web 后台登录”确认框，点击“确认登录”后页面提示“Web 后台已登录”，随后本地 poll 接口先返回 `approved`，二次 poll 返回 `consumed`。
  - 2026-07-09 补充验证：本地 API 使用 `dev-player-openid` 登录仅返回 `player` 角色，携带该 token 请求 `/api/admin/stores` 返回 403 `system_admin role required`；页面模板中非 `system_admin` 只渲染“当前微信账号没有系统管理员权限。”，且 `syncAdminState` 仅在 `isAdmin` 时调用 `refreshAll()`。尝试临时切换 DevTools storage 到 player 后，运行态仍保留 admin `globalData`，已恢复 storage 备份；因此 D35.12 的普通用户手工 UI checkbox 暂不勾选。
  - 2026-07-09 手工验证：重启 DevTools 后使用本地 `dev-player-openid` storage 进入 `pages/admin/catalog`，顶部身份显示 `男 / player`，页面只展示“当前微信账号没有系统管理员权限。”和“去登录”，未展示“管理工作台”、“扫码登录 Web 后台”、店家/剧本/待审核统计或编辑表单；本地 API 对普通用户 admin 接口仍返回 403。
  - 2026-07-09 补充自动 flow 验证：新增并运行 `scripts/d35-admin-catalog-flow-check.js`，仅允许连接本地 API；已覆盖手填 GCJ-02 坐标保存、店家关联剧本价格保存、结构化剧本角色/NPC 保存后回显、待审核店家编辑批准、待审核剧本编辑角色和关联店家后批准、要求补充、拒绝、合并，以及批量上下架/删除的本地 API 数据语义。该证据不替代尚未完成的 DevTools 点选验收，因此下方手工 checkbox 暂保持未勾选。
  - 2026-07-09 手工验证限制：尝试通过系统键盘向 DevTools 模拟器店家表单输入测试数据时，焦点未稳定落在小程序输入框，键盘/剪贴板输入不可靠；本轮停止盲输入，避免误操作。后续 DevTools 点选保存项需使用更可靠的自动化通道或人工在模拟器内完成。
  - 2026-07-09 工具验证：`miniprogram-automator@0.12.1` 可连接 DevTools Nightly `2.01.2512242` 的 `autoPort 9420`，并可 `reLaunch("/pages/admin/catalog")` / 读取 `pageStack` / `currentPage`；但 `Page.getData(...)`、元素选择器查询和 `Page.callMethod("switchTab" / "updateStoreField" / "pickStoreLocation")` 均超时，不能作为深层 UI 点选验收通道。
  - 2026-07-09 手工/自动混合验证：在 DevTools 模拟器当前 `pages/admin/catalog` 中，使用短 ASCII 值填入新增店家表单，注入 `chooseLocation` mock 后点击“地图选点”，页面视觉回填 `D35 mock address`、`39.908823`、`116.39747`，且位置区文案仍显示“不使用 POI 搜索额度”。后续滚动到保存按钮不稳定，API 按 `D38UI8` 反查为空，因此“新增店家并通过地图选点回填坐标”仍不勾选。
  - 2026-07-09 核对：用户提供候选手工店家名 `D35 UI store 1783573708`；本地 API `http://127.0.0.1:3029` 分别按 `D35 UI store 1783573708`、`D35UIstore1783573708`、`D35 UI store`、`1783573708` 查询 `/api/admin/stores` 和 `/api/admin/catalog-review-items`，结果均为空，因此不能作为保存成功证据。
  - [x] system_admin 可以进入管理工作台。
  - [x] 普通用户看不到管理员资料管理能力。
  - [x] 扫码登录 web admin 成功。
  - [x] 扫码登录取消和无效码处理正确。
  - [ ] 新增店家并通过地图选点回填坐标。
  - [ ] 手填 GCJ-02 坐标保存成功。
  - [ ] 店家关联剧本和价格保存成功。
  - [ ] 剧本角色和 NPC 结构化编辑保存后可回显。
  - [ ] 待审核店家可编辑后批准。
  - [ ] 待审核剧本可编辑角色、关联店家后批准。
  - [ ] 要求补充、拒绝和合并动作正确。
  - [ ] 批量上下架和删除行为正确。
  - [x] 小程序 admin catalog 没有腾讯 POI 搜索调用。

## D35 验收

- [x] D35 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D35 design 已落地到 [design.md](./design.md)。
- [x] D35 tasks 已落地到本文件。
- [x] 小程序资料管理工作台使用“1+3 混合”结构。
- [x] 扫码登录 web admin 是全局管理员工具。
- [x] 店家管理支持新增、编辑、上下架、删除。
- [x] 店家管理支持关联剧本和每人价格。
- [x] 店家定位使用 `uni.chooseLocation` 和手填 GCJ-02 坐标。
- [x] 小程序 admin catalog 不调用腾讯 POI/WebService。
- [x] 小程序 admin catalog 不调用主动定位。
- [x] 剧本管理支持结构化玩家角色编辑。
- [x] 剧本管理支持结构化 NPC 角色编辑。
- [x] 待审核资料支持编辑、批准、要求补充、拒绝和合并。
- [x] 店家和剧本支持移动端批量上架、下架和删除。
- [x] 普通用户无法进入或调用资料管理后台能力。
- [x] `node scripts/d35-miniprogram-admin-catalog-check.js` 通过。
- [x] `node scripts/check-miniprogram.js` 通过。
- [x] `npm run build:mp-weixin` 通过。
- [x] `npm run check` 通过。

## 验证记录

- 2026-07-09：D35 spec 三件套已创建。实现、自动验证和微信开发者工具手工验证待后续任务执行时补充。
- 2026-07-09：完成小程序 admin catalog 实现：新增管理工作台和全局扫码登录入口；店家管理支持坐标、`uni.chooseLocation`、`uni.openLocation`、关联剧本和每人价格；剧本管理从 JSON 文本升级为结构化玩家角色/NPC 编辑；待审核资料支持编辑草稿、批准、需要补充、拒绝、合并和批准剧本时关联店家；店家和剧本支持批量上架、下架和删除。新增 `scripts/d35-miniprogram-admin-catalog-check.js`，并接入 `scripts/check-miniprogram.js` 和 `npm run check`。
- 2026-07-09：自动验证通过：`node --check scripts/d35-miniprogram-admin-catalog-check.js`、`node scripts/d35-miniprogram-admin-catalog-check.js`、`node scripts/check-miniprogram.js`、`npm run build:mp-weixin`、`npm run check`。`npm run build:mp-weixin` 仅输出既有 Sass legacy API / `@import` deprecation warning。
- 2026-07-09：微信开发者工具手工验证尝试未完成。为避免写线上数据，曾用 `VITE_API_BASE_URL=http://127.0.0.1:3029` 生成本地 API 版本产物；DevTools Nightly 打开后因当前 appid 凭证状态返回 `INVALID_TOKEN, invalid credential, access_token is invalid or not latest`，无法进入小程序运行态完成 D35.12。已停止本地 API 和 dev watch，并重跑默认 `npm run build:mp-weixin`。
- 2026-07-09：补充修复 admin catalog 权限同步：页面现在在 `onShow` 重新读取 `getCurrentUser().roles`，从登录页返回后能立即进入 system_admin 工作台；D35 静态检查同步覆盖 `onShow(syncAdminState)`。
- 2026-07-09：补充修复本地 DevTools 登录 fallback：当 API base URL 是本地地址且 `wx.login` 在游客模式失败时，允许使用调用方传入的 `devCode` 继续命中本地 mock 登录；非本地 API 不启用 fallback。
- 2026-07-09：补充 DevTools 手工验证记录：临时项目锁定基础库 `3.12.1` 后，微信开发者工具 Nightly 仍因游客/凭证层 `webapi_getwxaasyncsecinfo` 报错导致 Page DOM 为空，D35.12 未完成。
- 2026-07-09：最终自动验证通过：`node scripts/d35-miniprogram-admin-catalog-check.js`、`node scripts/check-miniprogram.js`、`npm run build:mp-weixin`、`npm run check`、`git diff --check`。`npm run build:mp-weixin` 仅输出既有 Sass legacy API / `@import` deprecation warning。
- 2026-07-09：补充阻塞诊断：DevTools CLI 登录态为 true，但工具层仍对 `wxa-dev-logic` 返回 `INVALID_TOKEN`，并伴随 TLS handshake failure；D35.12 需要重新登录微信开发者工具或修复 DevTools 到腾讯服务的网络/凭证状态后继续。
- 2026-07-09：用户重新登录微信开发者工具后，DevTools `servicewechat.com` 凭证阻塞解除；本地 API mock 登录通过真实小程序 UI 进入 `organizer / player / system_admin` 身份。
- 2026-07-09：补充修复小程序运行时兼容性：`apps/miniprogram/src/utils/api.js` 不再依赖 `URL` Web API 判断本地 API base URL，避免 DevTools 运行态忽略 `dev-admin-openid`。
- 2026-07-09：补齐 TDesign vendor mixin `touch` / `page-scroll`，修复 `t-tabs` / `t-sticky` 在资料管理页的缺失组件错误；重新编译后 DevTools Console 仅剩既有 warning。
- 2026-07-09：DevTools 手工验证已进入 `pages/admin/catalog`，可见“管理工作台”、“扫码登录 Web 后台”、`86 店家`、`88 剧本`、`3 待审核`、新增店家表单和 GCJ-02/不使用 POI 定位文案。D35.12 仍保留未完成，因为扫码登录、实际保存、审核动作和批量操作还未逐项点击验收。
- 2026-07-09：收尾验证再次通过：`node scripts/d35-miniprogram-admin-catalog-check.js`、`node scripts/check-miniprogram.js`、`npm run build:mp-weixin`、`npm run check`、`git diff --check`。`npm run build:mp-weixin` 仅输出既有 Sass legacy API / `@import` deprecation warning。
- 2026-07-09：新增本地 API flow 验证 `scripts/d35-admin-catalog-flow-check.js`，并通过：`node --check scripts/d35-admin-catalog-flow-check.js`、`node scripts/d35-admin-catalog-flow-check.js`。脚本带本地 API 地址保护，覆盖 D35 剩余保存、审核和批量操作的数据语义；DevTools 手工点选项仍需继续逐项完成。
- 2026-07-09：补充 DevTools 自动化探测：`miniprogram-automator` 只能稳定验证路由进入 `pages/admin/catalog`，深层 data/selector/method 均超时；通过视觉 UI + `chooseLocation` mock 验证地图选点回填到地址和 GCJ-02 坐标，但未完成保存点击和 API 反查，D35.12 剩余手工 checkbox 保持未完成。
- 2026-07-09：本轮收尾验证通过：`node scripts/d35-miniprogram-admin-catalog-check.js`、`node scripts/check-miniprogram.js`、`npm run check`、`git diff --check`、`node scripts/d35-admin-catalog-flow-check.js`（本地 API `http://127.0.0.1:3029`）。
- 2026-07-09：按用户提供的 `D35 UI store 1783573708` 继续核对本地 API；`/api/admin/stores` 和 `/api/admin/catalog-review-items` 均未找到匹配记录，D35.12 保存相关 checkbox 不变。
