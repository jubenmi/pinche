# D39 Tasks: 同城车局只读预览执行清单

更新日期：2026-07-10

## D39 执行任务

- [x] D39.1 建立 spec 三件套。
  - [x] requirements 定义同城只读边界和分享卡上车边界。
  - [x] design 定义 `entry=city`、渲染控制、事件防护和测试策略。
  - [x] tasks 建立执行与验收清单。

- [x] D39.2 建立 RED 自动检查。
  - [x] 新增 `scripts/d39-city-preview-readonly-check.js`。
  - [x] 检查同城详情 URL 包含 `entry=city`。
  - [x] 检查只读提示、动作隐藏、事件早退和系统分享关闭。
  - [x] 检查分享页上车协议保持不变。
  - [x] 接入 `npm run check`。
  - [x] 实际运行并确认因同城 URL 尚未包含 `entry=city` 而失败。

- [x] D39.3 实现同城入口和详情只读状态。
  - [x] 同城车卡跳转增加 `entry=city`。
  - [x] 详情页读取入口并计算 `isCityPreview`。
  - [x] 同城详情显示只读提示。
  - [x] 同城详情关闭页面内和系统分享。

- [x] D39.4 关闭同城详情中的成员动作。
  - [x] 隐藏顶部动作区和记录编辑入口。
  - [x] 座位和 NPC 卡片不生成动作。
  - [x] 座位和 NPC 点击处理增加只读早退。
  - [x] 不渲染聊天扩展。
  - [x] 不调用成员关系恢复接口。
  - [x] 保留基础信息、地图、座位状态和车友记录浏览。

- [x] D39.5 自动验证。
  - [x] D39 检查通过。
  - [x] `node scripts/check-miniprogram.js` 通过。
  - [x] `npm run check` 通过。
  - [x] `npm run build:mp-weixin` 通过。
  - [x] `git diff --check` 通过。

- [ ] D39.6 微信开发者工具验证。
  - [ ] 从同城车卡进入时显示只读提示。
  - [ ] 页面无选择、分享、管理、记录或聊天动作。
  - [ ] 座位和 NPC 点击无跳转。
  - [ ] 右上角系统分享不可用。
  - [ ] 通过现有分享卡片进入时仍可选择角色上车。

## D39 验收

- [x] 同城详情只展示公开信息和状态。
- [x] 同城详情不能上车、分享、管理、写记录或进入聊天。
- [x] 同城详情不恢复成员关系。
- [x] 店家或车友分享卡片仍可上车。
- [x] 自动检查和小程序生产构建通过。

## 验证记录

- 2026-07-10：用户确认同城详情不保留分享按钮，采用 `entry=city` 的现有详情页只读方案；服务端签名邀请凭证不在本期范围内。
- 2026-07-10：D39 RED 检查实际失败于同城 URL 未携带 `entry=city`；实现后聚焦检查、`node scripts/check-miniprogram.js`、`npm run check`、`npm run build:mp-weixin` 和 `git diff --check` 均 exit 0。生产产物已包含 `entry=city`、只读提示、`hideShareMenu`、空动作数组和事件早退。线上 discovery 路由尚未部署并返回 404，因此开发者工具真实同城入口验收保持未勾选。
- 2026-07-10：针对附件中的 WeChatLib 3.16.2 日志新增 `scripts/wechatlib-runtime-compat-check.js`。TDesign 日期选择器已对空 `mode/fullModes` 兜底，search 和 textarea 已兼容基础库首帧瞬时 `null`。开发者工具重新加载 `dist/dev/mp-weixin` 后，选择店家页不再出现 search 类型警告，开本设置页日期选择器初始化为 0 errors；位置授权弹窗未擅自操作。
