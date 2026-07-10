# D38 Tasks: “我的 / 同城”车局发现执行清单

更新日期：2026-07-10

## D38 执行任务

- [x] D38.1 建立 D38 spec 三件套。
  - [x] `requirements.md` 描述“我的 / 同城”职责、候选资格、定位降级、可见性和隐私边界。
  - [x] `design.md` 描述发现接口、逆地址解析、位置缓存、日历状态、创建开关、错误处理和测试策略。
  - [x] `tasks.md` 描述 TDD 实现顺序、验收项和验证记录。

- [ ] D38.2 新增先失败的 D38 检查。
  - [ ] 新增 `scripts/d38-city-session-discovery-check.js`。
  - [ ] 检查 SessionCalendar 只有“我的 / 同城”两个筛选。
  - [ ] 检查同城数据来自独立 discovery 接口。
  - [ ] 检查 discovery 使用 POST 请求体且 URL 不包含精确坐标。
  - [ ] 检查同城 eligibility SQL 条件。
  - [ ] 检查同城卡片没有管理或删除动作。
  - [ ] 检查已登录且我的列表为空时首页仍渲染日历。
  - [ ] 检查创建流程“同城展示”开关和 visibility payload。
  - [ ] 检查 manifest 声明 `getLocation` 和同城位置用途。
  - [ ] 检查位置缓存有效期为 24 小时。
  - [ ] 将 D38 检查接入 `npm run check`。
  - [ ] 运行 D38 检查并确认因功能未实现而失败。

- [ ] D38.3 实现逆地址解析和发现后端。
  - [ ] 扩展 `apps/api/src/modules/location/geocoding.js`，新增腾讯逆地址解析。
  - [ ] 腾讯逆地址解析失败时调用高德逆地址解析。
  - [ ] 归一化并校验城市、纬度和经度。
  - [ ] 新增 `listDiscoverableSessions(user, filters)`。
  - [ ] 查询只保留公开、未来、招募中且有开放座位的车局。
  - [ ] 查询排除当前用户发起和存在有效报名的车局。
  - [ ] city mode 按日期和同日距离排序。
  - [ ] time fallback mode 最多返回 5 辆并按开本时间排序。
  - [ ] 新增 `POST /api/sessions/discovery` 并要求业务登录。
  - [ ] 响应只包含发现卡片所需字段。

- [ ] D38.4 实现车局同城可见设置。
  - [ ] create flow 新增 `cityVisible`，默认 true。
  - [ ] setup 页面增加“同城展示”开关和说明。
  - [ ] 创建请求按开关发送 `public` 或 `share_only`。
  - [ ] 后端创建和更新车局只接受 `public`、`share_only`。
  - [ ] 保持旧 `share_only` 车局不迁移、不进入 discovery。

- [ ] D38.5 实现小程序定位和缓存工具。
  - [ ] 新增 `apps/miniprogram/src/utils/cityDiscovery.js`。
  - [ ] 实现 GCJ-02 坐标校验。
  - [ ] 实现 24 小时本地缓存读取、写入、过期和损坏清理。
  - [ ] Promise 化 `uni.getLocation({ type: "gcj02" })`。
  - [ ] 区分拒绝、不可用和普通定位失败。
  - [ ] manifest 增加 `getLocation` 声明并更新位置用途文案。

- [ ] D38.6 改造 SessionCalendar 为“我的 / 同城”。
  - [ ] active filter 改为 `mine | city`，默认 mine。
  - [ ] 删除旧 `all | organized | pending` 筛选及计数。
  - [ ] 两个筛选始终显示并展示各自数量。
  - [ ] 点击同城后懒加载定位和 discovery。
  - [ ] 定位拒绝或不可用时加载 5 辆时间降级结果。
  - [ ] 同城授权提示和降级卡片同时展示。
  - [ ] 授权按钮通过 `uni.openSetting` 后重新定位。
  - [ ] 同城卡片展示剩余空位和可用距离。
  - [ ] 同城卡片隐藏管理、删除和退出动作。
  - [ ] 同城卡片点击进入现有详情页。
  - [ ] 切换数据源时重置分页、日期定位和折叠状态。
  - [ ] 日期 gap 和日期选择兼容我的降序与同城升序。
  - [ ] 下拉刷新按当前筛选刷新正确数据源。
  - [ ] 首页我的列表为空时仍进入日历，让用户可以切换同城。

- [ ] D38.7 补充单元检查和后端烟测。
  - [ ] 新增位置缓存、坐标和 discovery 请求体单元检查。
  - [ ] 新增腾讯逆地址成功、高德兜底单元检查。
  - [ ] 新增 `scripts/d38-city-session-discovery-smoke.js`。
  - [ ] 烟测覆盖完整 eligibility 排除矩阵。
  - [ ] 烟测覆盖 city 排序、distance 和 time fallback limit 5。
  - [ ] 烟测覆盖未登录 401 和非法坐标 400。

- [ ] D38.8 执行自动验证。
  - [ ] 运行 `node scripts/d38-city-session-discovery-check.js`。
  - [ ] 运行 D38 location utility unit check。
  - [ ] 运行 D38 reverse geocode unit check。
  - [ ] 运行 `node --check apps/api/src/modules/core/service.js`。
  - [ ] 运行 `node --check apps/api/src/server.js`。
  - [ ] 运行 `node scripts/check-miniprogram.js`。
  - [ ] 运行 `npm run check`。
  - [ ] 运行 `npm run build:mp-weixin`。
  - [ ] 修复 D38 范围内导致的检查、烟测或构建失败。

- [ ] D38.9 完成微信开发者工具验证。
  - [ ] 确认首页标签为“我的 / 同城”。
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
- [ ] 日历只显示“我的 / 同城”两个筛选。
- [ ] 我的保持发起和报名合并、去重及管理行为。
- [ ] 已登录用户即使我的列表为空也能进入同城。
- [ ] 同城只返回公开、未来、招募中、有空位且用户未参与的车局。
- [ ] 有位置时识别同城，并按日期和同日距离排序。
- [ ] 无有效位置时显示授权提示和最近 5 辆时间推荐。
- [ ] 用户坐标不写入服务端数据库。
- [ ] 新车局默认开启同城展示，关闭后保持 share_only。
- [ ] 旧 share_only 车局不被自动公开。
- [ ] 同城卡片无管理/删除动作且可进入详情。
- [ ] `npm run check` 包含 D38 检查并通过。
- [ ] `npm run build:mp-weixin` 通过。
- [ ] 微信开发者工具场景验证完成。

## 验证记录

- 2026-07-10：D38 spec 三件套已创建。设计按第一性原理区分“我的”管理域与“同城”发现域；同城只包含可行动的新机会，定位失败时保留授权提示并降级为最近 5 辆时间推荐。实现和验证待用户审阅 spec 后执行。
