# D38 Tasks: “我的 / 同城”车局发现执行清单

更新日期：2026-07-10

## D38 执行任务

- [x] D38.1 建立 D38 spec 三件套。
  - [x] `requirements.md` 描述“我的 / 同城”职责、候选资格、定位降级、可见性和隐私边界。
  - [x] `design.md` 描述发现接口、逆地址解析、位置缓存、日历状态、创建开关、错误处理和测试策略。
  - [x] `tasks.md` 描述 TDD 实现顺序、验收项和验证记录。

- [x] D38.2 新增先失败的 D38 检查。
  - [x] 新增 `scripts/d38-city-session-discovery-check.js`。
  - [x] 检查 SessionCalendar 只有“我的 / 同城”两个筛选。
  - [x] 检查同城数据来自独立 discovery 接口。
  - [x] 检查 discovery 使用 POST 请求体且 URL 不包含精确坐标。
  - [x] 检查同城 eligibility SQL 条件。
  - [x] 检查同城卡片没有管理或删除动作。
  - [x] 检查已登录且我的列表为空时首页仍渲染日历。
  - [x] 检查创建流程“同城展示”开关和 visibility payload。
  - [x] 检查 manifest 声明 `getLocation` 和同城位置用途。
  - [x] 检查位置缓存有效期为 24 小时。
  - [x] 将 D38 检查接入 `npm run check`。
  - [x] 运行 D38 检查并确认因功能未实现而失败。

- [x] D38.3 实现逆地址解析和发现后端。
  - [x] 扩展 `apps/api/src/modules/location/geocoding.js`，新增腾讯逆地址解析。
  - [x] 腾讯逆地址解析失败时调用高德逆地址解析。
  - [x] 归一化并校验城市、纬度和经度。
  - [x] 新增 `listDiscoverableSessions(user, filters)`。
  - [x] 查询只保留公开、未来、招募中且有开放座位的车局。
  - [x] 查询排除当前用户发起和存在有效报名的车局。
  - [x] city mode 按日期和同日距离排序。
  - [x] time fallback mode 最多返回 5 辆并按开本时间排序。
  - [x] 新增 `POST /api/sessions/discovery` 并要求业务登录。
  - [x] 响应只包含发现卡片所需字段。

- [x] D38.4 实现车局同城可见设置。
  - [x] create flow 新增 `cityVisible`，默认 true。
  - [x] setup 页面增加“同城展示”开关和说明。
  - [x] 创建请求按开关发送 `public` 或 `share_only`。
  - [x] 后端创建和更新车局只接受 `public`、`share_only`。
  - [x] 保持旧 `share_only` 车局不迁移、不进入 discovery。

- [x] D38.5 实现小程序定位和缓存工具。
  - [x] 新增 `apps/miniprogram/src/utils/cityDiscovery.js`。
  - [x] 实现 GCJ-02 坐标校验。
  - [x] 实现 24 小时本地缓存读取、写入、过期和损坏清理。
  - [x] Promise 化 `uni.getLocation({ type: "gcj02" })`。
  - [x] 区分拒绝、不可用和普通定位失败。
  - [x] manifest 增加 `getLocation` 声明并更新位置用途文案。

- [x] D38.6 改造 SessionCalendar 为“我的 / 同城”。
  - [x] active filter 改为 `mine | city`，默认 mine。
  - [x] 删除旧 `all | organized | pending` 筛选及计数。
  - [x] 两个筛选始终显示并展示各自数量。
  - [x] 点击同城后懒加载定位和 discovery。
  - [x] 定位拒绝或不可用时加载 5 辆时间降级结果。
  - [x] 同城授权提示和降级卡片同时展示。
  - [x] 授权按钮通过 `uni.openSetting` 后重新定位。
  - [x] 同城卡片展示剩余空位和可用距离。
  - [x] 同城卡片隐藏管理、删除和退出动作。
  - [x] 同城卡片点击进入现有详情页。
  - [x] 切换数据源时重置分页、日期定位和折叠状态。
  - [x] 日期 gap 和日期选择兼容我的降序与同城升序。
  - [x] 下拉刷新按当前筛选刷新正确数据源。
  - [x] 首页我的列表为空时仍进入日历，让用户可以切换同城。

- [x] D38.7 补充单元检查和后端烟测。
  - [x] 新增位置缓存、坐标和 discovery 请求体单元检查。
  - [x] 新增腾讯逆地址成功、高德兜底单元检查。
  - [x] 新增 `scripts/d38-city-session-discovery-smoke.js`。
  - [x] 烟测覆盖完整 eligibility 排除矩阵。
  - [x] 烟测覆盖 city 排序、distance 和 time fallback limit 5。
  - [x] 烟测覆盖未登录 401 和非法坐标 400。

- [x] D38.8 执行自动验证。
  - [x] 运行 `node scripts/d38-city-session-discovery-check.js`。
  - [x] 运行 D38 location utility unit check。
  - [x] 运行 D38 reverse geocode unit check。
  - [x] 运行 `node --check apps/api/src/modules/core/service.js`。
  - [x] 运行 `node --check apps/api/src/server.js`。
  - [x] 运行 `node scripts/check-miniprogram.js`。
  - [x] 运行 `npm run check`。
  - [x] 运行 `npm run build:mp-weixin`。
  - [x] 修复 D38 范围内导致的检查、烟测或构建失败。

- [ ] D38.9 完成微信开发者工具验证。
  - [x] 确认首页标签为“我的 / 同城”。
  - [ ] 确认我的车局仍可管理、隐藏和进入详情。
  - [ ] 确认首次点击同城时请求位置。
  - [ ] 确认定位成功时只展示同城可报名车局并显示距离。
  - [ ] 确认拒绝定位时显示授权提示和最近 5 辆时间推荐。
  - [ ] 确认授权设置返回后能刷新为同城结果。
  - [ ] 确认同城卡片无管理或删除动作，点击可进入详情。

## D38 验收

- [x] D38 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D38 design 已落地到 [design.md](./design.md)。
- [x] D38 tasks 已落地到本文件。
- [x] 日历只显示“我的 / 同城”两个筛选。
- [x] 我的保持发起和报名合并、去重及管理行为。
- [x] 已登录用户即使我的列表为空也能进入同城。
- [x] 同城只返回公开、未来、招募中、有空位且用户未参与的车局。
- [x] 有位置时识别同城，并按日期和同日距离排序。
- [x] 无有效位置时显示授权提示和最近 5 辆时间推荐。
- [x] 用户坐标不写入服务端数据库。
- [x] 新车局默认开启同城展示，关闭后保持 share_only。
- [x] 旧 share_only 车局不被自动公开。
- [x] 同城卡片无管理/删除动作且可进入详情。
- [x] `npm run check` 包含 D38 检查并通过。
- [x] `npm run build:mp-weixin` 通过。
- [ ] 微信开发者工具场景验证完成。

## 验证记录

- 2026-07-10：D38 spec 三件套已创建。设计按第一性原理区分“我的”管理域与“同城”发现域；同城只包含可行动的新机会，定位失败时保留授权提示并降级为最近 5 辆时间推荐。实现和验证待用户审阅 spec 后执行。
- 2026-07-10：D38 RED 检查已建立并实际运行。静态检查因缺少“我的”筛选失败；定位单测因 `cityDiscovery.js` 尚不存在失败；逆地址解析单测因 `reverseGeocodeCity` 尚未导出失败。失败原因均为目标功能未实现。
- 2026-07-10：D38 自动验证通过：`npm run check`、`npm run build:mp-weixin`、定位缓存单测、腾讯/高德逆解析单测及 `BASE_URL=http://localhost:3019` 数据库 smoke 均 exit 0。smoke 覆盖 eligibility 排除矩阵、同城日期/距离排序、无位置最多 5 辆、非法坐标 400 和未登录 401。
- 2026-07-10：代码评审修复完成：小程序定位工具改用可被 UniApp 编译的运行时 `uni` 代理；腾讯和高德逆地址解析单 provider 超时收紧为 2.5 秒，客户端 discovery 超时调整为 12 秒；距离先按原始精度排序，仅在响应格式化时保留一位小数。数据库 smoke 进一步覆盖 locked、cancelled、approved 报名、无店家坐标末位排序，以及显示值同为 `0.0km` 时仍按原始距离排序。
- 2026-07-10：评审修复后的最终验证通过：扩展数据库 smoke、`npm run check` 和 `npm run build:mp-weixin` 均 exit 0；生产构建产物 `dist/build/mp-weixin/utils/cityDiscovery.js` 已确认使用 `common_vendor.index`，不含 `globalThis.uni`。
- 2026-07-10：微信开发者工具已加载 `dist/dev/mp-weixin`，确认首页固定显示“我的 / 同城”，开本设置“同城展示”默认开启且开关交互正常。线上 `https://api.pinche.jubenmi.com/api/sessions/discovery` 尚未部署 D38，当前返回 404，因此定位成功、拒绝授权、授权恢复和线上同城卡片场景留待发布后验收。
