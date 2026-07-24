# D54 Design：可用操作按钮绿色一致性

更新日期：2026-07-24

版本：v1.0

状态：产品规则与技术方向已确认，待实施

## 1. 设计摘要

D54 采用“语义主题契约 + 源码审计”的渐进方案，不新建跨端 Button 组件：

- 小程序在 `App.vue` 定义现有绿色的 TDesign 变量和 `.button` 语义变体。
- 页面局部样式只保留布局差异，并把可用的中性灰/白按钮改为深绿或浅绿。
- 仅有 `.disabled` class 的四个明确入口补齐真实 `disabled` 绑定。
- talk 宿主扩展和包源同步修改。
- 后台网页在现有 `styles.css` 内收敛主要、低强调、批量、禁用和危险按钮族。
- 新增无运行时依赖的 Node 源码检查，扫描按钮选择器和禁用绑定，阻止回归。

该方案修复相册隐私页的直接根因：未声明 theme 的 TDesign `t-button` 使用 `.t-button--default`，默认背景为 `#e7e7e7`，覆盖业务希望呈现的绿色。

## 2. 颜色与状态契约

### 2.1 小程序令牌

在 `page` 和业务按钮 class 上复用以下现有色值：

```css
--action-green: #1f6f5b;
--action-green-active: #1a5d4d;
--action-green-light: #eef7f4;
--action-green-light-active: #e1f1ea;
--action-green-border: rgba(31, 111, 91, 0.38);
--action-disabled: #aeb8b1;
--action-danger: #9f3f33;
```

TDesign 变量映射：

```css
--td-brand-color: var(--action-green);
--td-brand-color-active: var(--action-green-active);
--td-brand-color-light: var(--action-green-light);
--td-brand-color-light-active: var(--action-green-light-active);
--td-brand-color-disabled: var(--action-disabled);
--td-button-default-bg-color: var(--action-green);
--td-button-default-color: #ffffff;
--td-button-default-border-color: var(--action-green-active);
--td-button-default-active-bg-color: var(--action-green-active);
--td-button-default-active-border-color: var(--action-green-active);
--td-button-default-disabled-bg: var(--action-disabled);
--td-button-default-disabled-color: #ffffff;
--td-button-default-disabled-border-color: var(--action-disabled);
--td-button-default-outline-color: var(--action-green);
--td-button-default-outline-border-color: var(--action-green);
--td-button-default-outline-active-bg-color: var(--action-green-light);
--td-button-default-outline-active-border-color: var(--action-green-active);
```

显式 `theme="danger"` 继续走 TDesign danger 变量，不受默认绿色影响。

### 2.2 后台令牌

后台继续使用现有：

```css
--admin-accent: #0f7b67;
--admin-accent-strong: #086452;
--admin-danger: #b42318;
--admin-danger-soft: #fff1ef;
```

补充两个派生令牌：

```css
--admin-action-soft: #eef8f3;
--admin-action-soft-hover: #e1f3ed;
--admin-action-disabled: #c9d6d2;
```

主要操作使用 accent 实底，低强调操作使用 soft 底、accent 边框和 strong 文字。禁用态统一为 `--admin-action-disabled`。

## 3. 小程序设计

### 3.1 全局基础

修改 `apps/miniprogram/src/App.vue`：

- `page` 定义动作色和 TDesign 变量，使未显式声明主题的普通 `t-button` 不再回退灰色。
- `.button` 继续使用现有深绿渐变。
- `.button.secondary` 改为 `--action-green-light`、绿色边框和深绿文字。
- `.button.disabled` 与 `.button[disabled]` 使用灰色、取消阴影。
- CSS 变量同时覆盖 TDesign 内部背景、边框和文字色，避免宿主 background 与组件内部 `.t-button--default` 竞争。

### 3.2 真实禁用绑定

补齐四个已确认只有灰色 class、没有原生 disabled 的入口：

```text
apps/miniprogram/src/pages/session/albumPrivacy.vue  saving
apps/miniprogram/src/pages/session/create.vue        !selectedStore
apps/miniprogram/src/pages/session/script.vue        !selectedScript
apps/miniprogram/src/pages/session/role.vue          !selectedRole
```

它们保留现有方法内 guard，形成 UI disabled + 事件守卫两层保护。相册隐私页额外显式使用 `theme="primary"`，作为复现点回归锚。

### 3.3 局部样式收敛

第一轮已识别的中性可用按钮族：

| 文件 | 选择器 | 新语义 |
| --- | --- | --- |
| `App.vue` | `.button.secondary` | 浅绿低强调 |
| `AuthIdentityBar.vue` | `.message-panel-tool` | 浅绿低强调 |
| `AuthIdentityBar.vue` | `.profile-logout`、`.phone-skip` | 浅绿低强调 |
| `manage.vue` | `.mini-button.muted` | 浅绿低强调 |
| `mine/index.vue` | `.mini-button.muted` | 浅绿低强调 |
| `admin/catalog.vue` | `.mini-button.secondary`、`.tool-button.secondary`、`.button.secondary` | 浅绿低强调 |
| `admin/catalog.vue` | `.mini-button.muted` | 深绿或浅绿，不再中性灰 |
| `session-pseudo-chat/ChatEntry.vue` | `.draft-button`、`.chat-modal-close` | 浅绿低强调 |

静态扫描若发现其他同类选择器，必须在同一 D54 改动中按相同语义修复；纯图标和非按钮控件通过具体例外记录保留。

## 4. talk 共享组件设计

以下文件成对处理：

```text
apps/miniprogram/src/extensions/session-pseudo-chat/ChatEntry.vue
packages/talk/miniprogram/ChatEntry.vue

apps/miniprogram/src/extensions/session-pseudo-chat/ManagePinnedMessage.vue
packages/talk/miniprogram/ManagePinnedMessage.vue
```

两端模板标签差异（`t-button/@tap` 与 `button/@click`）保留，颜色、disabled 条件和可用/危险语义保持一致。D54 不借此重构 talk 的源码生成方式。

## 5. 后台网页设计

修改 `apps/admin-web/src/styles.css`，不改页面结构：

- `.primary`：深绿实底。
- `.secondary-action`、`.action-button`、`.toolbar button`、`.close-button`：浅绿低强调。
- `.bulk-action-button` 与 `--archive`：浅绿低强调。
- `.bulk-action-button--publish`：保留现有浅绿，并统一边框/hover。
- `.danger`、`.action-button.danger`、`.bulk-action-button--danger`：红色。
- 对上述操作族统一 `:disabled` 灰色实底、灰色边框、白字、无 hover 位移。

以下规则不纳入统一：

- `.nav-item`、`.sidebar-collapse`、`.shell-toggle`：应用壳导航/图标。
- `.tabs button`：标签页。
- `.session-row`、`.user-box` 触发区：复合列表/资料触发器；其中明确的“退出”文字按钮单独归入浅绿。
- `.rating-row-web button`、可编辑照片选择按钮：评分/选择控件。
- `.close-button` 若显示文字则使用浅绿；只有纯图标关闭按钮可登记例外。

## 6. 静态审计设计

### 6.1 文件

新增：

```text
scripts/lib/action-button-style-contract.mjs
scripts/d54-action-button-color-check.test.mjs
scripts/d54-action-button-color-check.js
```

修改根 `package.json`，新增：

```json
{
  "d54:unit": "node --test scripts/d54-action-button-color-check.test.mjs",
  "d54:check": "node scripts/d54-action-button-color-check.js"
}
```

并将两项接入 `precheck`；`check` 至少运行 `d54:check`，避免完整检查重复执行相同 unit。

### 6.2 扫描算法

helper 导出：

```text
extractStyleBlocks(source)
findNeutralEnabledButtonRules(source, filePath, exceptions)
findClassOnlyDisabledBindings(source, filePath, exceptions)
```

按钮选择器识别：

- `button` 元素选择器。
- `.button`、`.primary`、`.secondary-action`、`.action-button`。
- 名称以 `button` 结尾或包含 `button-` 的 class。
- 明确纳入的 `.mini-button`、`.tool-button` 和批量操作类。

中性背景识别包括项目当前遗留的：

```text
#ffffff, #fff, #fffefb, #f8fafc, #f8faf9,
#eef2f7, #eef3f1, #64748b,
var(--admin-surface), var(--admin-surface-muted), var(--admin-border)
```

浅绿 `#eef7f4`、`#eef8f3`、`#e1f3ed` 不属于中性违规。

具体例外由脚本常量保存 `{ file, selector, reason }` 并传给
`findNeutralEnabledButtonRules`；只允许：

- `disabled`
- `danger`
- `icon`
- `tab/segmented/rating`
- `nav/shell`
- 第三方系统控件

检查输出示例：

```text
D54 neutral enabled button: apps/miniprogram/src/App.vue :: .button.secondary :: #ffffff
D54 class-only disabled binding: apps/miniprogram/src/pages/session/albumPrivacy.vue :: saving
```

### 6.3 扫描边界

业务扫描根：

```text
apps/miniprogram/src
packages/talk/miniprogram
apps/admin-web/src
```

排除：

```text
apps/miniprogram/src/wxcomponents
apps/miniprogram/src/uni_modules
dist
node_modules
design-exports
output
docs/evidence
```

## 7. 实施顺序

```text
审计 helper 单元测试 RED
  -> 审计 helper GREEN
  -> 全项目 D54 check RED（证明当前遗留可复现）
  -> 小程序全局主题与真实 disabled
  -> 小程序局部按钮和 talk 镜像
  -> 后台按钮族
  -> D54 check GREEN
  -> 定向测试、双端构建、根回归
  -> 开发者工具/浏览器代表页面验收
```

每个阶段只改变一类样式或状态绑定。静态扫描首次全绿后，再运行构建和运行页面验证，避免把源码契约误当作视觉端到端测试。

## 8. 失败与回滚

- TDesign 变量导致危险按钮变绿：保留显式 `theme="danger"`，增加 danger 契约后回滚该选择器的全局覆盖。
- 某纯图标按钮被误改：使用具体文件 + 选择器例外，不放宽整个目录。
- disabled 绑定阻止了合法点击：以现有方法 guard 为权威，绑定同一布尔表达式并补单测。
- 局部样式优先级仍覆盖全局：只在该业务 class 增加 TDesign 变量，不修改第三方 WXSS。
- 后台主次不清：保留深绿/浅绿层级，通过尺寸和阴影区分，不退回中性灰。
- talk 两份源漂移：在提交前运行 talk 测试和现有宿主一致性契约。

## 9. 验证矩阵

### 自动验证

```text
npm run d54:unit
npm run d54:check
npm --workspace @jubenmi/talk run test
npm --workspace apps/admin-web run check
npm run build:admin-web
npm run build:mp-weixin
npm run check
git diff --check
```

### 运行页面

- 小程序相册隐私：“保存设置”可用深绿，保存中灰色禁用，停止分享红色。
- 建车店家/剧本/角色步骤：未选择时灰色禁用，选择后绿色。
- 车头管理：保存、普通操作绿色；解散/删除红色。
- 聊天：发送可用绿色、不可发送灰色；取消/编辑重发浅绿。
- 小程序管理员目录：普通/次要操作绿色系，危险操作红色。
- 后台目录和抽屉：主要/次要绿色系，disabled 灰色，danger 红色。

## 10. 非目标确认

- 不新增数据库、接口或数据迁移。
- 不新建页面或跨端 Button 组件。
- 不修改第三方组件源码。
- 不进行无关 CSS 重构。
- 不把静态扫描结果宣称为真机视觉验收。
