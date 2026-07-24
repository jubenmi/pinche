# D54 Requirements：可用操作按钮绿色一致性

更新日期：2026-07-24

版本：v1.0

状态：产品规则与技术方向已确认，待实施

## 1. 目标与范围

D54 清理项目中“按钮仍可点击，但视觉像灰色禁用态”的遗留。小程序、共享聊天组件和后台网页中的可用文字操作按钮统一使用项目现有的沉稳绿色体系；灰色只表达真实禁用，红色只表达删除、停止分享等危险操作。

本期不追求所有按钮使用完全相同的亮度，也不引入高饱和亮绿。主要操作继续使用现有深绿实底或深绿渐变，低强调操作使用现有浅绿底、绿色边框和深绿文字，通过深浅、尺寸、位置和阴影保持主次层级。

## 2. 术语与业务边界

- **文字操作按钮**：包含可识别操作文案并触发点击、轻触、提交、分享或系统授权的 `button`、`t-button` 或等价控件。
- **可用态**：当前状态下允许触发操作，且没有 `disabled`、业务 busy guard 或等价不可交互条件。
- **禁用态**：当前状态下不能触发操作，并同时具有真实 `disabled` 属性或等价事件守卫。
- **危险操作**：删除、解散、停止分享、拒绝等会造成数据丢失、权限收紧或难以撤销结果的操作。
- **低强调操作**：取消、返回、刷新、加载更多、清空等仍可点击但视觉优先级低于当前主要操作的操作。

纯图标按钮、标签、徽标、筛选项、分段选择器、单选/复选控件、卡片点击区和第三方源码不按文字按钮规则强制改色。

## 3. 验收需求

### Requirement 1：可用文字按钮必须属于现有绿色体系

**User Story：** 作为用户，我希望所有可点击的文字按钮一眼可辨，避免把仍可用的操作误认为禁用。

1. WHEN 小程序文字操作按钮可用 THEN 按钮 SHALL 使用现有深绿 `#1f6f5b`、等价现有深绿渐变，或现有浅绿色低强调样式。
2. WHEN 后台网页文字操作按钮可用 THEN 按钮 SHALL 使用 `--admin-accent`、`--admin-accent-strong` 或由它们派生的浅绿色低强调样式。
3. 可用文字按钮 SHALL NOT 使用中性灰实底、白底加中性灰边框或 TDesign 默认灰色作为最终视觉。
4. 低强调操作 MAY 使用浅绿色底和深绿色文字，但 SHALL 仍可被识别为绿色操作。
5. 本期 SHALL NOT 引入荧光绿、高饱和亮绿或新的独立品牌色。

### Requirement 2：禁用态必须同时满足视觉与行为禁用

1. WHEN 按钮因 `saving`、`loading`、`busy` 或表单条件不可执行 THEN 按钮 SHALL 呈现现有中性灰禁用态。
2. 禁用按钮 SHALL 同时设置真实 `disabled` 属性，或在平台无法设置时具备等价、可测试的事件守卫。
3. 仅添加 `.disabled` 灰色 class、但仍可触发事件 SHALL 被视为缺陷。
4. WHEN 禁用条件解除 THEN 按钮 SHALL 恢复绿色可用态。
5. 禁用态 SHALL 保持可读文案，并取消可用态阴影或悬停反馈。

### Requirement 3：危险操作必须继续使用红色

1. 删除、解散、停止分享、拒绝和等价危险操作 SHALL 保持现有红色体系。
2. 危险操作 SHALL NOT 因全局绿色主题被覆盖为绿色。
3. 危险按钮禁用时 SHALL 保持不可交互，并可使用降低饱和度或中性灰表达禁用。
4. 退出登录不属于数据破坏操作，SHALL 使用绿色低强调样式，不占用危险红色语义。

### Requirement 4：小程序必须统一 TDesign 与局部按钮主题

1. `apps/miniprogram/src/App.vue` SHALL 为 TDesign 默认、主要、浅色、禁用和轮廓按钮提供现有绿色/灰色变量。
2. 全局 `.button` SHALL 保持深绿可用态；`.button.secondary` SHALL 从中性白灰改为浅绿色低强调态；`.button.disabled` SHALL 保持中性灰。
3. 相册隐私页“保存设置”在 `saving === false` 时 SHALL 呈现深绿，在 `saving === true` 时 SHALL 真实禁用并呈灰色。
4. `create.vue`、`script.vue` 和 `role.vue` 的“下一步” SHALL 在未选择必填项时真实禁用，而不是只显示灰色 class。
5. 页面或组件局部 `.muted`、`.secondary`、工具按钮和文本按钮 SHALL 按语义改为深绿或浅绿，不得重新覆盖成中性灰。
6. `wxcomponents` 与 `uni_modules` 第三方源码 SHALL NOT 被直接修改。

### Requirement 5：共享聊天组件与宿主版本必须一致

1. `apps/miniprogram/src/extensions/session-pseudo-chat` 与 `packages/talk/miniprogram` 中对应文字按钮 SHALL 使用一致的绿色/禁用/危险语义。
2. 发送、保存置顶和编辑重发等可用操作 SHALL 为绿色。
3. 不可发送、保存中或无权限状态 SHALL 为真实禁用灰色。
4. 聊天关闭、取消和草稿操作 MAY 使用浅绿色低强调样式，SHALL NOT 使用中性灰假装禁用。
5. 现有 talk 包一致性测试 SHALL 继续通过。

### Requirement 6：后台网页必须统一操作按钮族

1. `.primary` SHALL 保持深绿色主操作。
2. `.secondary-action`、普通 `.action-button`、工具栏文字按钮和抽屉关闭文字按钮 SHALL 使用绿色或浅绿色操作样式。
3. `.bulk-action-button--archive` 等非危险批量操作 SHALL 使用浅绿色，不得使用中性灰。
4. `.danger` 与 `.bulk-action-button--danger` SHALL 保持红色。
5. `button:disabled` 以及各操作按钮的 disabled 组合 SHALL 使用明确中性灰，不能仅依赖透明度让绿色仍像可用。
6. 侧栏折叠、纯图标、标签页、列表行和状态胶囊 SHALL 保持原有非操作按钮视觉，不被无差别全局覆盖。

### Requirement 7：全项目审计必须可重复并阻止回归

1. D54 SHALL 新增脚本，扫描业务 Vue/CSS 源码中的按钮相关规则和关键状态绑定。
2. 扫描 SHALL 覆盖 `apps/miniprogram/src`、`packages/talk/miniprogram` 和 `apps/admin-web/src`。
3. 扫描 SHALL 排除第三方、构建产物、设计导出和生成证据目录。
4. WHEN 可用按钮选择器声明中性灰或白色最终背景 THEN 检查 SHALL 失败并报告文件、选择器和颜色。
5. WHEN `.disabled` 动态 class 缺少对应 `disabled` 绑定且不在具体例外表中 THEN 检查 SHALL 失败。
6. 危险、纯图标、标签、导航和状态控件例外 SHALL 以具体选择器登记并说明原因；SHALL NOT 使用整目录豁免。
7. 新检查 SHALL 接入根 `precheck` 和 `check`，并提供独立 `d54:unit`、`d54:check` 命令。

### Requirement 8：验证必须覆盖行为、构建和代表页面

1. D54 SHALL 先建立失败测试或失败契约，再写最小实现。
2. helper 单元测试 SHALL 覆盖可用中性按钮命中、绿色按钮放行、禁用/危险/纯图标例外和缺失 disabled 绑定。
3. 静态契约 SHALL 锁定相册隐私页复现点、全局按钮变量、共享聊天同步和后台操作按钮族。
4. 最终实现 SHALL 通过 D54 定向测试、talk 测试、后台测试、小程序构建、后台构建和根 `npm run check`。
5. 微信开发者工具 SHALL 至少验收相册隐私、建车下一步、车头管理、聊天发送和管理员目录代表页面。
6. 浏览器 SHALL 至少验收后台目录、抽屉和批量操作的可用、禁用、危险三种状态。

## 4. 非目标

- 不重做页面布局、字体、卡片、导航、图标或交互流程。
- 不要求所有绿色按钮使用唯一色号、唯一尺寸或相同阴影。
- 不把纯图标按钮、标签、筛选项、分段选择器、状态胶囊和列表行全部改绿。
- 不替换 TDesign、UniApp、Vue 或后台现有技术栈。
- 不新增通用跨端 Button 运行时组件。
- 不修改按钮背后的接口、权限和数据模型，除非修复“视觉禁用但仍可交互”的直接状态缺陷。
- 不直接修改 `apps/miniprogram/src/wxcomponents`、`uni_modules` 或其他第三方源码。
