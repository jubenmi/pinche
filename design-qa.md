# D49 车局记录页 Design QA

## 对照目标

- source visual truth: `docs/superpowers/specs/assets/2026-07-19-session-review-experience-selected.png`
- implementation screenshots:
  - `docs/superpowers/qa/d49-review-editor-top-clean.png`
  - `docs/superpowers/qa/d49-review-editor-bottom.png`
  - `docs/superpowers/qa/d49-review-editor-cta-fixed.png`
- full-view comparison evidence: `docs/superpowers/qa/d49-review-editor-comparison.png`
- focused CTA comparison evidence: `docs/superpowers/qa/d49-review-editor-cta-comparison.png`
- viewport: 微信开发者工具 iPhone 12/13 (Pro)，375 × 812 逻辑视口，100% 缩放
- state: 评价编辑页、5 星、900 字输入框、本场相册通路选中、3/9 张照片、发布操作区；相册照片使用现有静态图作为只用于截图的渲染数据。

## Findings

当前没有仍需处理的 P0/P1/P2 问题。

- [P3] 选中照片的操作提示比视觉稿更明确
  - Location: 照片区。
  - Evidence: 视觉稿使用右箭头；实现显示“继续选择”，并在每张已选照片上提供“移除”。
  - Impact: 信息稍多，但玩家不必猜测怎样继续选择或撤销照片，仍符合 KISS 范围。
  - Follow-up: 若后续追求完全像素级一致，可把移除动作收回相册选择面板，并恢复单一箭头入口。

- [P3] 发布操作采用小程序既有固定底栏
  - Location: 页面底部。
  - Evidence: 视觉稿把按钮放在长页面末端；实现复用既有 `.bottom-action` 固定操作区。
  - Impact: 视觉位置略有不同，但长表单中始终可见的主操作更适合现有产品交互。
  - Follow-up: 保留当前实现，除非产品明确要求按钮必须随页面滚动。

## Required Fidelity Surfaces

- Fonts and typography: 延续现有 `PincheBrand`、宋体和系统中文字体栈；标题、区块标题、说明文字和计数器层级与视觉稿一致。微信原生字体抗锯齿与原图渲染存在预期差异，无阻断问题。
- Spacing and layout rhythm: 标题居中、卡片间距、圆角、边框、文本框比例和三列图片网格与目标一致；固定底栏是已记录的 P3 产品约束。
- Colors and visual tokens: 米白背景、墨绿主色、金色星级、浅灰边框和绿色选中态均沿用现有产品 token，和目标一致。
- Image quality and asset fidelity: 生产页面只引用真实本场相册图片；QA 截图中的三张淡墨图片只是本地渲染数据，不会作为评价内容占位图发布。星级改用 TDesign `star-filled` 图标组件，没有用 CSS 图形或手绘图标替代。
- Copy and content: “写记录”、900 字限制、最多 9 张、两个互斥照片通路、上传后自动加入本场相册、好友/群聊/朋友圈分享说明均与已确认需求一致。

## Comparison History

### Iteration 1

- Earlier finding: [P2] TDesign 默认按钮内部样式覆盖了页面 `.button` 外层样式，导致“发布并分享”在真实模拟器中显示为紧凑白色按钮，而不是视觉稿中的全宽墨绿主按钮。
- Fix made: 给发布按钮绑定明确的 TDesign `custom-style`，同时定义可发布时的墨绿渐变和不可发布时的灰色状态，保留 94rpx 高度与全宽布局。
- Post-fix visual evidence: `docs/superpowers/qa/d49-review-editor-cta-comparison.png`。左侧为视觉稿，右侧为修正后的微信开发者工具截图；按钮宽度、颜色、字号和层级已对齐。

### Iteration 2

- Full-view evidence: `docs/superpowers/qa/d49-review-editor-comparison.png` 把视觉稿、实现上半屏和实现照片/操作区放入同一张对照图。
- Result: 没有新增 P0/P1/P2；保留的差异均已归类为 P3 或动态内容差异。

## Primary Interaction and Runtime Checks

- 已通过控制台路由进入 `pages/session/review`，确认页面能在真实微信开发者工具中渲染。
- 已检查未登录提示的取消路径、页面滚动、星级控件、900 字文本框、相册来源选中态、3/9 张图片、继续选择/移除入口和发布操作区。
- 有效截图运行中没有应用运行时异常；控制台仅有开发者工具的合法域名等环境警告。多次热重载后曾出现开发者工具自身的模拟器超时提示，不属于页面代码错误，最终以全量构建和自动化回归作为交付门禁。

## Implementation Checklist

- [x] 主表单结构与已选视觉稿一致
- [x] 900 字计数、5 星和最多 9 张约束可见
- [x] 相册/手机上传双通路与互斥说明可见
- [x] 三张相册引用状态可见
- [x] 发布按钮视觉问题已修正并完成二次对照
- [x] 无剩余 P0/P1/P2 视觉问题

final result: passed
