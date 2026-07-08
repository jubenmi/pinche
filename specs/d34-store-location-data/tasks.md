# D34 Tasks: 店家地图定位数据统一执行清单

更新日期：2026-07-09

## D34 执行任务

- [x] D34.1 建立 D34 spec 三件套。
  - [x] `requirements.md` 描述店家位置字段、坐标校验、admin web 手填、小程序地图选点、详情打开地图、坐标系和跨端边界。
  - [x] `design.md` 描述数据模型、GCJ-02 约定、后端接口影响、admin web 表单、小程序交互、错误处理和测试范围。
  - [x] `tasks.md` 描述后续实现和验收清单。

- [x] D34.2 新增店家位置数据模型迁移。
  - [x] 新增 `apps/api/migrations/0022_store_location_data.sql`。
  - [x] 给 `stores` 增加 `latitude DECIMAL(10, 7) NULL`。
  - [x] 给 `stores` 增加 `longitude DECIMAL(10, 7) NULL`。
  - [x] 使用幂等迁移写法，重复执行不报错。
  - [x] 确认旧店家迁移后坐标为空且仍可搜索、选择和建车。

- [x] D34.3 新增后端坐标归一化和校验 helper。
  - [x] 在 `apps/api/src/modules/core/service.js` 新增 `optionalCoordinate`。
  - [x] 新增 `optionalLatitude`，允许空值并校验 `-90..90`。
  - [x] 新增 `optionalLongitude`，允许空值并校验 `-180..180`。
  - [x] 非数字、无限值或越界值返回 400。
  - [x] 保持文本风险词检查只作用于文本字段。

- [x] D34.4 改造店家创建和编辑接口。
  - [x] `createPrivateStore` 保存 `latitude` 和 `longitude`。
  - [x] `createStore` 保存 `latitude` 和 `longitude`。
  - [x] `updateStore` allowlist 支持 `latitude` 和 `longitude`。
  - [x] 管理员待审核店家编辑路径支持 `latitude` 和 `longitude`。
  - [x] 空字符串、`null` 和 `undefined` 坐标保存为 `NULL`。
  - [x] 合法坐标按 GCJ-02 约定原样保存。

- [x] D34.5 改造店家列表和车局详情响应。
  - [x] 确认 `GET /api/stores` 返回 `address`、`latitude`、`longitude`。
  - [x] 确认 `GET /api/admin/stores` 返回 `address`、`latitude`、`longitude`。
  - [x] 管理员待审核资料列表或编辑响应包含店家坐标字段。
  - [x] 车局详情查询附带当前店家 `address`、`latitude`、`longitude`。
  - [x] 车局详情响应新增 `store_address`、`store_latitude`、`store_longitude`。
  - [x] 保持 `store_name_snapshot` 作为车局店名展示来源。

- [x] D34.6 改造 admin web 店家表单。
  - [x] `StoreDrawer.vue` 在地址后增加 `纬度（GCJ-02）` 输入。
  - [x] `StoreDrawer.vue` 在地址后增加 `经度（GCJ-02）` 输入。
  - [x] 初始化 model 时回显 `store.latitude` 和 `store.longitude`。
  - [x] 保存时提交 `latitude` 和 `longitude`。
  - [x] 增加帮助文案说明 admin web 和微信小程序共用 GCJ-02 坐标。
  - [x] 运行时腾讯位置服务 key 存在时按需加载腾讯位置服务 Web SDK。
  - [x] 管理员点击地图时回填 `latitude` 和 `longitude`。
  - [x] 增加 `地点搜索` 输入，调用腾讯位置服务 POI 搜索。
  - [x] 管理员选择 POI 搜索结果时回填地址、纬度和经度。
  - [x] 当前 key 未开启 WebServiceAPI 时展示明确提示。
  - [x] 地图不可用时保留手填坐标。
  - 2026-07-08 进度：用户确认 admin web 和微信小程序共用腾讯位置服务 key；D34 admin 范围从“只手填”调整为“腾讯地图选点 + 手填兜底”。

- [x] D34.7 改造小程序私有店家创建表单。
  - [x] `pages/session/create.vue` 的 `storeForm` 增加 `latitude` 和 `longitude`。
  - [x] 私有店家表单增加 `地图选点` 入口。
  - [x] 点击后调用 `uni.chooseLocation`。
  - [x] 选点成功后回填 `address`、`latitude`、`longitude`。
  - [x] 用户取消选点时不报错并保留原表单。
  - [x] `chooseLocation` 不可用或失败时提示手动填写地址。
  - [x] 提交 `POST /api/stores` 时携带坐标字段。
  - [x] 创建成功后写入 create flow 的店家对象保留坐标字段。
  - [x] 不调用 `uni.getLocation` 或 `wx.getLocation`。
  - 2026-07-08 进度：小程序私有店家地图选点实现完成，`node scripts/d34-store-location-check.js` 和 `node scripts/check-miniprogram.js` 已覆盖。

- [x] D34.8 改造小程序车局详情地图入口。
  - [x] `pages/session/detail.vue` 在基础信息中展示 `store_address`。
  - [x] 同时存在合法 `store_latitude` 和 `store_longitude` 时展示 `查看地图`。
  - [x] 缺少任一坐标时隐藏 `查看地图`。
  - [x] 点击 `查看地图` 调用 `uni.openLocation`。
  - [x] `openLocation` 传入店名、地址、GCJ-02 纬度、GCJ-02 经度和 `scale: 18`。
  - [x] 打开地图失败时展示轻量 toast。

- [x] D34.9 更新小程序位置接口配置声明。
  - [x] 检查 `apps/miniprogram/src/pages.json` 或当前 uni-app 配置位置。
  - [x] 按微信要求为 `chooseLocation` 增加位置接口使用声明。
  - [x] 说明该能力只用于用户主动选择剧本店位置。
  - [x] 确认没有新增用户当前位置读取能力。

- [x] D34.10 更新静态检查、烟测和构建验证。
  - [x] 新增 `scripts/d34-store-location-check.js` 静态检查后端迁移、坐标校验、admin 表单和腾讯地图按需加载。
  - [x] 扩展 D34 静态检查，覆盖 admin POI 搜索入口、搜索函数和选择结果回填逻辑。
  - [x] 新增或扩展后端烟测，覆盖合法坐标保存。
  - [x] 后端烟测覆盖非法纬度返回 400。
  - [x] 后端烟测覆盖非法经度返回 400。
  - [x] 后端烟测覆盖车局详情返回店家位置字段。
  - [x] 更新 `scripts/check-miniprogram.js` 检查 `uni.chooseLocation` 和 `uni.openLocation`。
  - [x] 更新 `scripts/d12-admin-web-check.js` 检查 GCJ-02 坐标输入和 payload。
  - [x] 确认静态检查要求 admin web 按需加载腾讯位置服务 Web SDK，并保留手填坐标兜底。
  - [x] 将 D34 检查加入 `npm run check`。

- [x] D34.11 执行自动验证。
  - [x] 运行 `npm run check`。
  - [x] 运行 `npm run build:mp-weixin`。
  - [x] 运行 `node scripts/d34-store-location-check.js`。
  - [x] 运行 `node --check apps/api/src/modules/core/service.js`。
  - [x] 运行 `node --check scripts/d34-store-location-check.js`。
  - [x] 运行 `npm --workspace apps/admin-web run build`。
  - [x] 运行 D34 后端烟测。
    - 2026-07-09：使用本地临时 API `http://127.0.0.1:3029`、本地 MySQL `127.0.0.1:3307` 和 `WECHAT_MOCK_LOGIN=true` 实跑 `BASE_URL=http://127.0.0.1:3029 node scripts/d34-store-location-smoke.js`，通过。
  - [x] 修复 D34 范围内导致的检查、烟测或构建失败。

- [x] D34.12 完成微信开发者工具手工验证。
  - [x] 在微信开发者工具中确认选店页可以打开地图选点。
  - [x] 选点后确认地址、纬度、经度回填。
  - [x] 创建私有店家后确认坐标被保存。
  - [x] 打开车局详情并确认 `查看地图` 能打开微信内置地图。
  - [x] 使用无坐标旧店家确认详情不展示地图入口且页面正常。
  - 2026-07-08 进度：已运行 `npm --workspace apps/miniprogram run dev:mp-weixin` 生成最新 dev 输出，并用微信开发者工具 CLI 通过绝对路径打开项目；当前桌面截图返回黑屏，无法可靠完成 UI 手工验证，因此保持未勾选。
  - 2026-07-09 验证：使用微信开发者工具 Nightly `2.01.2512242` 打开构建产物并点击 `编译`，在选店页打开 `添加一个店家` 表单；通过 automator mock `chooseLocation` 返回地址和 GCJ-02 坐标后，点击 `地图选点`，页面显示 `已选坐标 39.9042000，116.4074000`。随后将小程序运行态临时切到本地 API `http://127.0.0.1:3029`，提交本地私有店家并通过本地 API 查回 `address: 北京市朝阳区D34自动化地址`、`latitude: 39.9042000`、`longitude: 116.4074000`。创建本地车局后，详情页展示 `查看地图`；点击后 mock `openLocation` 记录到 `latitude: 39.9042`、`longitude: 116.4074`、`name: D3store`、`address: 北京市朝阳区D34自动化地址`、`scale: 18`。另建无坐标本地店家和车局，详情页正常展示地址和时间，未展示 `查看地图`。

## D34 验收

- [x] D34 requirements 已落地到 [requirements.md](./requirements.md)。
- [x] D34 design 已落地到 [design.md](./design.md)。
- [x] D34 tasks 已落地到本文件。
- [x] `stores` 支持保存 GCJ-02 纬度和经度。
- [x] 私有店家创建能保存坐标。
- [x] 管理员创建和编辑店家能保存坐标。
- [x] 非法纬度和经度会被后端拒绝。
- [x] 店家列表和管理员店家列表返回坐标字段。
- [x] 车局详情返回店家地址和坐标字段。
- [x] admin web 店家表单支持腾讯地图选点、POI 搜索和手填 GCJ-02 坐标。
- [x] 小程序补录店家支持地图选点。
- [x] 小程序车局详情支持有坐标时打开地图。
- [x] 小程序不主动读取或保存用户当前位置。
- [x] admin web 通过运行时腾讯位置服务 key 按需加载腾讯位置服务 Web SDK。
- [x] 旧店家无坐标时仍可搜索、选择和建车。
- [x] `npm run check` 通过。
- [x] `npm run build:mp-weixin` 通过。

## 验证记录

- 2026-07-08：D34 spec 三件套已创建。实现、自动验证和微信开发者工具手工验证待后续任务执行时补充。
- 2026-07-08：完成 backend/admin 子集：新增 `stores.latitude` / `stores.longitude` 迁移，后端管理员创建、编辑和车局详情支持坐标，admin web 店家表单支持手填和腾讯地图选点。已运行 `node scripts/d34-store-location-check.js`、`node --check apps/api/src/modules/core/service.js`、`node --check scripts/d34-store-location-check.js`、`npm --workspace apps/admin-web run build`。
- 2026-07-08：admin web 增加 POI 搜索 UI 和候选结果回填逻辑。接口连通性测试显示当前腾讯位置服务 key 返回 `199 此key未开启WebserviceAPI功能`，需要在腾讯控制台开启 WebServiceAPI 后才能返回真实搜索结果。
- 2026-07-08：完成小程序 D34 子集：私有店家表单支持 `uni.chooseLocation` 回填地址和 GCJ-02 坐标，提交私有店家时携带坐标，车局详情有完整坐标时显示 `查看地图` 并调用 `uni.openLocation`，`manifest.json` 声明 `chooseLocation` 且不声明/调用 `getLocation`。已运行 `node scripts/d34-store-location-check.js`、`node scripts/check-miniprogram.js`、`node scripts/d12-admin-web-check.js`、`node --check scripts/d34-store-location-smoke.js`、`npm run build:mp-weixin`、`npm run check`。
- 2026-07-08：新增 `scripts/d34-store-location-smoke.js` 覆盖私有店家坐标保存、admin 创建/编辑坐标、非法坐标 400、车局详情位置字段、无坐标店家仍可搜索和建车。首次实跑 `node scripts/d34-store-location-smoke.js` 因 sandbox 本地网络 `EPERM` 且提权审批未通过而未完成，后续见 2026-07-09 验证记录。
- 2026-07-08：补充详情页边界：有完整坐标但地址为空时仍展示 `查看地图`，并加入 `scripts/d34-store-location-check.js` 与 `scripts/check-miniprogram.js` 回归检查。复跑 `node scripts/d34-store-location-check.js`、`node scripts/check-miniprogram.js`、`npm run build:mp-weixin`、`npm run check`、`node --check apps/api/src/modules/core/service.js`、`node --check scripts/d34-store-location-check.js`、`npm --workspace apps/admin-web run build` 均通过；构建产物 `app.json` 已确认包含 `chooseLocation` 且不包含 `getLocation`。
- 2026-07-09：用户批准后，先确认当前默认 `.env` 指向腾讯云数据库，因此未对线上库执行写入烟测；改用本地临时 API `http://127.0.0.1:3029`、本地 MySQL `127.0.0.1:3307`、`WECHAT_MOCK_LOGIN=true` 执行 `BASE_URL=http://127.0.0.1:3029 node scripts/d34-store-location-smoke.js`，结果通过。覆盖私有店家坐标保存、非法纬度/经度 400、admin 创建/编辑坐标、车局详情位置字段，以及旧店家无坐标仍可搜索、选择和建车。
- 2026-07-09：线上 admin `https://admin.pinche.jubenmi.com/?view=catalog&tab=stores` 已验证登录态下店家表单显示 `位置设置`、`地图选点` 和 `地点搜索`；点击 `地图选点` 后腾讯地图画布加载成功，点击地图可回填纬度 `39.9042015` 和经度 `116.4074107`。POI 搜索请求带线上 Referer 调用腾讯接口返回 `121 此key每日调用量已达到上限`，已补充 admin web 对 `110` 来源域名未授权和 `121` 每日调用量上限的明确提示；该问题需要腾讯位置服务配额恢复或调整后 POI 搜索才能返回真实候选。
- 2026-07-09：publish CI `28982042197` 成功后，在 Portainer `pinche` stack 执行 re-pull/redeploy；线上 admin asset 更新到 `/assets/index-WXabztsM.js`，已确认包含 POI 配额和来源域名错误提示。复测线上 admin 店家表单：腾讯地图画布加载，点击地图可回填纬度 `39.9041933` 和经度 `116.4074107`；POI 搜索在当前腾讯位置服务配额耗尽时展示明确配额提示。
- 2026-07-09：完成微信开发者工具手工验证闭环。微信开发者工具 Nightly `2.01.2512242` 中，选店页 `地图选点` 使用 mock `chooseLocation` 成功回填地址和坐标；小程序提交到本地 API 的私有店家经 API 查回保留 `address`、`latitude`、`longitude`；车局详情页在有坐标时展示 `查看地图` 并调用 `openLocation`，传参包含店名、地址、GCJ-02 坐标和 `scale: 18`；无坐标店家详情页正常展示且不出现地图入口。
