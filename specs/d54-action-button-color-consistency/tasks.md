# D54 可用操作按钮绿色一致性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让小程序、共享聊天组件和后台网页中的所有可用文字操作按钮使用现有协调绿色，灰色只表示真实禁用，红色只表示危险操作。

**Architecture:** 小程序通过 `App.vue` 的动作令牌和 TDesign CSS 变量建立基础主题，页面局部样式只表达布局和语义变体；后台在现有 `styles.css` 收敛操作按钮族。一个无运行时依赖的 Node 扫描器检查按钮选择器中的中性可用背景和 class-only disabled 绑定，并接入根检查。

**Tech Stack:** UniApp Vue、TDesign Mini Program、Vue 3、CSS custom properties、Node.js ESM、`node:test`。

---

## 文件结构

- Create: `scripts/lib/action-button-style-contract.mjs` — 纯源码扫描 helper，不读取文件系统。
- Create: `scripts/d54-action-button-color-check.test.mjs` — 扫描 helper 的 RED/GREEN 单元测试。
- Create: `scripts/d54-action-button-color-check.js` — 枚举业务源码、应用具体例外并输出 D54 契约结果。
- Modify: `apps/miniprogram/src/App.vue` — 小程序动作色令牌、TDesign 映射和全局按钮变体。
- Modify: `apps/miniprogram/src/pages/session/albumPrivacy.vue` — 截图复现点的 primary 与真实 disabled。
- Modify: `apps/miniprogram/src/pages/session/create.vue` — 未选店家时真实 disabled。
- Modify: `apps/miniprogram/src/pages/session/script.vue` — 未选剧本时真实 disabled。
- Modify: `apps/miniprogram/src/pages/session/role.vue` — 未选角色时真实 disabled。
- Modify: `apps/miniprogram/src/components/AuthIdentityBar.vue` — 消息工具、退出登录和跳过手机号的浅绿色操作态。
- Modify: `apps/miniprogram/src/pages/session/manage.vue` — muted 操作改为浅绿。
- Modify: `apps/miniprogram/src/pages/mine/index.vue` — muted 操作改为浅绿。
- Modify: `apps/miniprogram/src/pages/admin/catalog.vue` — secondary/muted 工具按钮改为绿色体系。
- Modify: `apps/miniprogram/src/extensions/session-pseudo-chat/ChatEntry.vue` — 草稿和关闭操作改为浅绿。
- Modify: `packages/talk/miniprogram/ChatEntry.vue` — 与宿主聊天扩展同步。
- Modify: `apps/miniprogram/src/extensions/session-pseudo-chat/ManagePinnedMessage.vue` — 显式定义保存/取消/禁用语义。
- Modify: `packages/talk/miniprogram/ManagePinnedMessage.vue` — 与宿主版本同步。
- Modify: `apps/admin-web/src/styles.css` — 后台操作按钮族、禁用和危险变体。
- Modify: `package.json` — D54 定向命令和根检查接线。
- Modify: `specs/d54-action-button-color-consistency/tasks.md` — 实时勾选和验证记录。

### Task 1：建立按钮源码审计的 RED/GREEN 循环

**Files:**
- Create: `scripts/d54-action-button-color-check.test.mjs`
- Create: `scripts/lib/action-button-style-contract.mjs`

- [x] **Step 1：写扫描 helper 的失败测试**

创建 `scripts/d54-action-button-color-check.test.mjs`：

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  extractStyleBlocks,
  findClassOnlyDisabledBindings,
  findNeutralEnabledButtonRules
} from "./lib/action-button-style-contract.mjs";

test("extracts every Vue style block", () => {
  assert.deepEqual(
    extractStyleBlocks("<style>.a { color: red; }</style><style scoped>.b { color: blue; }</style>"),
    [".a { color: red; }", ".b { color: blue; }"]
  );
});

test("reports neutral enabled text-button rules", () => {
  const source = `
    <style>
    .button.secondary { background: #ffffff; color: #193d35; }
    .mini-button.muted { background: #64748b; color: #ffffff; }
    </style>
  `;
  assert.deepEqual(
    findNeutralEnabledButtonRules(source, "sample.vue"),
    [
      { file: "sample.vue", selector: ".button.secondary", value: "#ffffff" },
      { file: "sample.vue", selector: ".mini-button.muted", value: "#64748b" }
    ]
  );
});

test("allows green, disabled, danger, and pure icon rules", () => {
  const source = `
    <style>
    .button { background: #1f6f5b; }
    .button.secondary { background: #eef7f4; }
    .button.disabled { background: #aeb8b1; }
    .button.danger { background: #9f3f33; }
    .album-image-viewer__icon-button { background: #ffffff; }
    </style>
  `;
  assert.deepEqual(findNeutralEnabledButtonRules(source, "sample.vue"), []);
});

test("accepts a concrete neutral selector exception", () => {
  const source = `<style>.avatar-button { background: #ffffff; }</style>`;
  assert.deepEqual(
    findNeutralEnabledButtonRules(source, "sample.vue", [
      { file: "sample.vue", selector: ".avatar-button", reason: "avatar picker" }
    ]),
    []
  );
});

test("reports dynamic disabled classes without a disabled binding", () => {
  const source = `
    <t-button class="button" :class="{ disabled: saving }" @tap="save">保存</t-button>
    <t-button class="button" :class="{ disabled: busy }" :disabled="busy">提交</t-button>
  `;
  assert.deepEqual(findClassOnlyDisabledBindings(source, "sample.vue"), [
    { file: "sample.vue", expression: "saving" }
  ]);
});

test("accepts a concrete class-only disabled exception", () => {
  const source = `<view class="button" :class="{ disabled: decorative }">提示</view>`;
  assert.deepEqual(
    findClassOnlyDisabledBindings(source, "sample.vue", [
      { file: "sample.vue", expression: "decorative", reason: "non-interactive view" }
    ]),
    []
  );
});
```

- [x] **Step 2：运行测试并确认按预期失败**

Run: `node --test scripts/d54-action-button-color-check.test.mjs`

Expected: FAIL，错误指出 `scripts/lib/action-button-style-contract.mjs` 不存在。

- [x] **Step 3：写最小扫描 helper**

创建 `scripts/lib/action-button-style-contract.mjs`：

```js
const BUTTON_SELECTOR =
  /(^|[,\s>+~])(?:button\b|\.(?:button|primary|secondary-action|action-button|mini-button|tool-button|bulk-action-button)\b|\.[\w-]*button[\w-]*)/i;
const EXEMPT_SELECTOR =
  /(?:disabled|\[disabled\]|danger|icon-button|button-icon|nav-item|sidebar-collapse|shell-toggle|tabs?\b|segmented|rating|status|toggle\b)/i;
const NEUTRAL_BACKGROUND =
  /background(?:-color)?\s*:\s*(#(?:fff|ffffff|fffefb|f8fafc|f8faf9|eef2f7|eef3f1|64748b)\b|var\(--admin-(?:surface|surface-muted|border)\))/i;

export function extractStyleBlocks(source) {
  return [...String(source).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1]);
}

function cssSources(source) {
  const blocks = extractStyleBlocks(source);
  return blocks.length > 0 ? blocks : [String(source)];
}

export function findNeutralEnabledButtonRules(source, file, exceptions = []) {
  const violations = [];
  for (const css of cssSources(source)) {
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1].trim();
      if (!BUTTON_SELECTOR.test(selector) || EXEMPT_SELECTOR.test(selector)) continue;
      const exempt = exceptions.some((entry) =>
        entry.file === file && entry.selector === selector && entry.reason
      );
      if (exempt) continue;
      const neutral = NEUTRAL_BACKGROUND.exec(match[2]);
      if (!neutral) continue;
      violations.push({ file, selector, value: neutral[1] });
    }
  }
  return violations;
}

function normalizeExpression(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

export function findClassOnlyDisabledBindings(source, file, exceptions = []) {
  const violations = [];
  const tags = String(source).match(/<(?:t-button|button)\b[\s\S]*?>/gi) || [];
  for (const tag of tags) {
    const classBinding = /:class\s*=\s*["'][^"']*disabled\s*:\s*([^,}]+)[^"']*["']/.exec(tag);
    if (!classBinding || /:disabled\s*=|\sdisabled(?:\s|>|=)/.test(tag)) continue;
    const expression = normalizeExpression(classBinding[1]);
    const exempt = exceptions.some((entry) =>
      entry.file === file && normalizeExpression(entry.expression) === expression && entry.reason
    );
    if (!exempt) violations.push({ file, expression });
  }
  return violations;
}
```

- [x] **Step 4：运行 helper 测试并确认转绿**

Run: `node --test scripts/d54-action-button-color-check.test.mjs`

Expected: PASS，8 个测试全部通过。

- [x] **Step 5：提交扫描 helper**

```bash
git add scripts/lib/action-button-style-contract.mjs scripts/d54-action-button-color-check.test.mjs
git commit -m "test(ui): define action button color contract"
```

### Task 2：建立全项目 D54 RED 契约

**Files:**
- Create: `scripts/d54-action-button-color-check.js`

- [x] **Step 1：创建业务源码扫描入口**

创建 `scripts/d54-action-button-color-check.js`：

```js
import fs from "node:fs";
import path from "node:path";

import {
  findClassOnlyDisabledBindings,
  findNeutralEnabledButtonRules
} from "./lib/action-button-style-contract.mjs";

const root = process.cwd();
const sourceRoots = [
  "apps/miniprogram/src",
  "packages/talk/miniprogram",
  "apps/admin-web/src"
];
const excludedSegments = new Set([
  "wxcomponents",
  "uni_modules",
  "dist",
  "node_modules",
  "design-exports",
  "output"
]);
const allowedExtensions = new Set([".vue", ".css"]);
const selectorExceptions = [
  {
    file: "apps/miniprogram/src/components/AuthIdentityBar.vue",
    selector: ".profile-avatar-button",
    reason: "avatar image picker, not a text action"
  }
];
const disabledExceptions = [];

function collectFiles(relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  return fs.readdirSync(absoluteDirectory, { withFileTypes: true })
    .flatMap((entry) => {
      if (excludedSegments.has(entry.name)) return [];
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) return collectFiles(relativePath);
      return allowedExtensions.has(path.extname(entry.name)) ? [relativePath] : [];
    });
}

const files = sourceRoots.flatMap(collectFiles).sort();
const violations = [];
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  violations.push(...findNeutralEnabledButtonRules(source, file, selectorExceptions));
  if (file.endsWith(".vue")) {
    violations.push(...findClassOnlyDisabledBindings(source, file, disabledExceptions));
  }
}

for (const violation of violations) {
  if ("selector" in violation) {
    console.error(
      `D54 neutral enabled button: ${violation.file} :: ${violation.selector} :: ${violation.value}`
    );
  } else {
    console.error(
      `D54 class-only disabled binding: ${violation.file} :: ${violation.expression}`
    );
  }
}

if (violations.length > 0) process.exit(1);
console.log(`D54 action button color check passed (${files.length} source files)`);
```

- [x] **Step 2：运行 D54 检查并确认准确红灯**

Run: `node scripts/d54-action-button-color-check.js`

Expected: FAIL，至少报告：

```text
apps/miniprogram/src/App.vue :: .button.secondary
apps/miniprogram/src/pages/session/albumPrivacy.vue :: saving
apps/miniprogram/src/pages/session/create.vue :: !selectedStore
apps/miniprogram/src/pages/session/script.vue :: !selectedScript
apps/miniprogram/src/pages/session/role.vue :: !selectedRole
apps/admin-web/src/styles.css :: .secondary-action
```

若首个失败来自语法解析或非按钮卡片，先修扫描器/增加具体 `{ file, selector, reason }` 例外，再重跑，直到红灯只指向真实遗留。

- [x] **Step 3：提交全项目失败契约**

```bash
git add scripts/d54-action-button-color-check.js
git commit -m "test(ui): audit neutral enabled buttons"
```

### Task 3：修复小程序全局主题和真实禁用状态

**Files:**
- Modify: `apps/miniprogram/src/App.vue`
- Modify: `apps/miniprogram/src/pages/session/albumPrivacy.vue`
- Modify: `apps/miniprogram/src/pages/session/create.vue`
- Modify: `apps/miniprogram/src/pages/session/script.vue`
- Modify: `apps/miniprogram/src/pages/session/role.vue`

- [x] **Step 1：在 App.vue 建立动作令牌和 TDesign 映射**

在 `page` 规则加入：

```css
  --action-green: #1f6f5b;
  --action-green-active: #1a5d4d;
  --action-green-light: #eef7f4;
  --action-green-light-active: #e1f1ea;
  --action-green-border: rgba(31, 111, 91, 0.38);
  --action-disabled: #aeb8b1;
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

将 `.button.secondary` 与 disabled 规则替换为：

```css
.button.secondary {
  background: var(--action-green-light);
  color: var(--action-green);
  border: 1rpx solid var(--action-green-border);
  box-shadow: none;
  --td-button-default-bg-color: var(--action-green-light);
  --td-button-default-color: var(--action-green);
  --td-button-default-border-color: var(--action-green-border);
}

.button.disabled,
.button[disabled] {
  background: var(--action-disabled);
  color: #ffffff;
  box-shadow: none;
  --td-button-default-bg-color: var(--action-disabled);
  --td-button-default-color: #ffffff;
  --td-button-default-border-color: var(--action-disabled);
}
```

- [x] **Step 2：修复截图复现点**

将相册隐私页按钮改为：

```vue
<t-button
  class="button"
  theme="primary"
  :class="{ disabled: saving }"
  :disabled="saving"
  @tap="savePrivacy"
>
  {{ saving ? "保存中..." : "保存设置" }}
</t-button>
```

- [x] **Step 3：补齐三个选择流程的真实 disabled**

分别使用与现有 class 相同的表达式：

```vue
<!-- create.vue -->
<t-button class="button" :class="{ disabled: !selectedStore }" :disabled="!selectedStore" @tap="goNext">
  下一步
</t-button>

<!-- script.vue -->
<t-button class="button" :class="{ disabled: !selectedScript }" :disabled="!selectedScript" @tap="goNext">
  下一步
</t-button>

<!-- role.vue -->
<t-button class="button" :class="{ disabled: !selectedRole }" :disabled="!selectedRole" @tap="goNext">
  下一步
</t-button>
```

- [x] **Step 4：运行 D54 检查确认状态缺陷消失**

Run: `node --test scripts/d54-action-button-color-check.test.mjs && node scripts/d54-action-button-color-check.js`

Expected: helper unit PASS；D54 check 仍因其他局部/后台中性按钮失败，但不再报告 `App.vue .button.secondary` 和四个 class-only disabled。

- [x] **Step 5：提交小程序基础主题**

```bash
git add apps/miniprogram/src/App.vue \
  apps/miniprogram/src/pages/session/albumPrivacy.vue \
  apps/miniprogram/src/pages/session/create.vue \
  apps/miniprogram/src/pages/session/script.vue \
  apps/miniprogram/src/pages/session/role.vue
git commit -m "fix(miniprogram): align enabled button states"
```

### Task 4：清理小程序局部中性按钮并同步 talk

**Files:**
- Modify: `apps/miniprogram/src/components/AuthIdentityBar.vue`
- Modify: `apps/miniprogram/src/pages/session/manage.vue`
- Modify: `apps/miniprogram/src/pages/mine/index.vue`
- Modify: `apps/miniprogram/src/pages/admin/catalog.vue`
- Modify: `apps/miniprogram/src/extensions/session-pseudo-chat/ChatEntry.vue`
- Modify: `packages/talk/miniprogram/ChatEntry.vue`
- Modify: `apps/miniprogram/src/extensions/session-pseudo-chat/ManagePinnedMessage.vue`
- Modify: `packages/talk/miniprogram/ManagePinnedMessage.vue`

- [x] **Step 1：把 AuthIdentityBar 的可用中性按钮改为浅绿**

保留各自尺寸，将颜色声明统一为：

```css
.message-panel-tool,
.profile-logout,
.phone-skip {
  border-color: rgba(31, 111, 91, 0.34);
  background: #eef7f4;
  color: #1f6f5b;
}

.message-panel-tool.disabled,
.message-panel-tool[disabled] {
  border-color: #aeb8b1;
  background: #aeb8b1;
  color: #ffffff;
}
```

不要合并原文件中尺寸、margin、font 和 line-height 规则，只替换上述颜色声明。

- [x] **Step 2：把页面 muted/secondary 按钮改为浅绿**

在 `manage.vue`：

```css
.mini-button.muted {
  border: 1rpx solid rgba(31, 111, 91, 0.34);
  background: #eef7f4;
  color: #1f6f5b;
}
```

在 `mine/index.vue`：

```css
.mini-button.muted {
  background: #2b765f;
  color: #ffffff;
}
```

在 `admin/catalog.vue`：

```css
.mini-button.secondary,
.tool-button.secondary,
.button.secondary {
  border: 1rpx solid rgba(31, 122, 104, 0.34);
  background: #eef7f4;
  color: #1f6f5b;
}

.mini-button.muted {
  background: #2b765f;
  color: #ffffff;
}
```

`.tab`、`.toggle` 和 `.danger` 保持各自选择/危险语义。

- [x] **Step 3：同步聊天低强调操作**

在宿主和包源的 `ChatEntry.vue` 保留布局，给 `.draft-button` 和 `.chat-modal-close` 使用：

```css
.draft-button,
.chat-modal-close {
  border: 1rpx solid rgba(31, 111, 91, 0.34);
  background: #eef7f4;
  color: #1f6f5b;
}
```

在两份 `ManagePinnedMessage.vue` 的 scoped style 中加入明确语义：

```css
.actions .button {
  border: 1rpx solid #1a5d4d;
  background: #1f6f5b;
  color: #ffffff;
}

.actions .button.secondary {
  border-color: rgba(31, 111, 91, 0.34);
  background: #eef7f4;
  color: #1f6f5b;
}

.actions .button[disabled] {
  border-color: #aeb8b1;
  background: #aeb8b1;
  color: #ffffff;
}
```

宿主继续使用 `t-button/@tap`，包源继续使用原生 `button/@click`。

- [x] **Step 4：运行 D54 与 talk 回归**

Run:

```bash
node scripts/d54-action-button-color-check.js
npm --workspace @jubenmi/talk run test
```

Expected: D54 不再报告小程序或 talk 中性可用按钮；talk 全部测试 PASS。后台遗留可继续使总检查保持红灯。

- [x] **Step 5：提交小程序局部样式**

```bash
git add apps/miniprogram/src/components/AuthIdentityBar.vue \
  apps/miniprogram/src/pages/session/manage.vue \
  apps/miniprogram/src/pages/mine/index.vue \
  apps/miniprogram/src/pages/admin/catalog.vue \
  apps/miniprogram/src/extensions/session-pseudo-chat/ChatEntry.vue \
  apps/miniprogram/src/extensions/session-pseudo-chat/ManagePinnedMessage.vue \
  packages/talk/miniprogram/ChatEntry.vue \
  packages/talk/miniprogram/ManagePinnedMessage.vue
git commit -m "fix(miniprogram): remove neutral enabled actions"
```

只 stage 实际发生修改的文件；若两份 ManagePinnedMessage 未修改，从命令中移除。

### Task 5：统一后台网页操作按钮族

**Files:**
- Modify: `apps/admin-web/src/styles.css`

- [x] **Step 1：增加后台动作派生令牌**

在 `:root` 增加：

```css
  --admin-action-soft: #eef8f3;
  --admin-action-soft-hover: #e1f3ed;
  --admin-action-disabled: #c9d6d2;
```

- [x] **Step 2：把通用文字操作改为浅绿**

保留现有尺寸/圆角规则，将颜色规则收敛为：

```css
.toolbar button,
.secondary-action,
.action-button,
.close-button {
  border-color: rgba(15, 123, 103, 0.28);
  background: var(--admin-action-soft);
  color: var(--admin-accent-strong);
}

.toolbar button:hover:not(:disabled),
.secondary-action:hover:not(:disabled),
.action-button:hover:not(:disabled),
.close-button:hover:not(:disabled) {
  border-color: rgba(15, 123, 103, 0.4);
  background: var(--admin-action-soft-hover);
}

.primary {
  border-color: var(--admin-accent);
  background: var(--admin-accent);
  color: #ffffff;
}
```

将 `.user-box button` 中明确显示“退出”的文字操作使用相同浅绿；不要覆盖 `.nav-item`、`.sidebar-collapse`、`.shell-toggle` 和 `.tabs button`。

- [x] **Step 3：统一批量操作与危险操作**

```css
.bulk-action-button,
.bulk-action-button--archive {
  border-color: rgba(15, 123, 103, 0.24);
  background: var(--admin-action-soft);
  color: var(--admin-accent-strong);
}

.bulk-action-button:hover:not(:disabled),
.bulk-action-button--archive:hover:not(:disabled) {
  border-color: rgba(15, 123, 103, 0.34);
  background: var(--admin-action-soft-hover);
}

.action-button.danger,
.bulk-action-button--danger {
  border-color: #f0c5bf;
  background: var(--admin-danger-soft);
  color: var(--admin-danger);
}
```

保留 publish 的绿色语义，并删除被新基础规则完全覆盖的旧 archive 中性色声明；不改布局属性。

- [x] **Step 4：统一操作族 disabled**

```css
.toolbar button:disabled,
.primary:disabled,
.secondary-action:disabled,
.action-button:disabled,
.close-button:disabled,
.bulk-action-button:disabled {
  border-color: var(--admin-action-disabled);
  background: var(--admin-action-disabled);
  color: #ffffff;
  opacity: 1;
  box-shadow: none;
  transform: none;
}
```

- [x] **Step 5：运行后台定向验证和 D54 检查**

Run:

```bash
node scripts/d54-action-button-color-check.js
npm --workspace apps/admin-web run check
npm run build:admin-web
```

Expected: D54 check PASS；后台 check PASS；Vite build exit 0。

- [x] **Step 6：提交后台样式**

```bash
git add apps/admin-web/src/styles.css
git commit -m "fix(admin): align enabled action button colors"
```

### Task 6：接线根检查并完成全量验证

**Files:**
- Modify: `package.json`
- Modify: `specs/d54-action-button-color-consistency/tasks.md`

- [x] **Step 1：在根 package.json 增加 D54 命令**

在 `scripts` 增加：

```json
"action-button:unit": "node --test scripts/d54-action-button-color-check.test.mjs",
"action-button:check": "node scripts/d54-action-button-color-check.js"
```

把 `npm run action-button:unit && npm run action-button:check &&` 接入 `postcheck`；保留其他功能已经占用的 `d54:*` 命令。

- [x] **Step 2：运行 D54 定向验证**

Run:

```bash
npm run action-button:unit
npm run action-button:check
node --check scripts/d54-action-button-color-check.js
node --check scripts/lib/action-button-style-contract.mjs
```

Expected: 全部 exit 0；unit 全部 PASS；check 输出扫描文件数且无违规。

- [x] **Step 3：运行跨端回归**

Run:

```bash
npm --workspace @jubenmi/talk run test
npm --workspace apps/admin-web run check
npm run build:admin-web
npm run build:mp-weixin
```

Expected: 所有测试 PASS；两个构建 exit 0。既有 Sass deprecation warning 可记录，但不得出现新的编译错误。

- [x] **Step 4：运行完整根检查**

Run: `npm run check`

Expected: exit 0，D54 契约和现有全项目检查全部通过。

- [ ] **Step 5：完成代表页面运行验收**

在微信开发者工具记录：

```text
相册隐私：保存设置=深绿；保存中=灰色 disabled；停止分享=红色
建车店家/剧本/角色：未选=灰色 disabled；已选=绿色
车头管理：普通操作=绿色系；删除/解散=红色
聊天：发送可用=深绿；不可发送=灰色；取消/编辑重发=浅绿
管理员目录：普通/次要=绿色系；危险=红色
```

在后台浏览器记录：

```text
目录工具栏、抽屉、批量操作：可用=深绿/浅绿
disabled=中性灰且不可点击
danger=红色
```

任何不能在当前环境真实执行的手工项保持未勾选，不能用构建成功代替。

- [x] **Step 6：更新 tasks 验证记录并检查最终差异**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: `git diff --check` exit 0；仅包含 D54 代码、测试、spec 和验证记录，不包含用户已有无关改动。

- [x] **Step 7：提交检查接线和验证记录**

```bash
git add package.json \
  scripts/d54-action-button-color-check.js \
  scripts/d54-action-button-color-check.test.mjs \
  scripts/lib/action-button-style-contract.mjs \
  specs/d54-action-button-color-consistency/tasks.md
git commit -m "test(ui): enforce action button color consistency"
```

## D54 验收清单

- [x] 相册隐私页“保存设置”可用时为现有深绿，保存中为真实灰色禁用。
- [x] 所有小程序可用文字按钮属于深绿或浅绿体系。
- [x] talk 宿主与包源按钮语义一致。
- [x] 后台主要、低强调和批量可用操作属于绿色体系。
- [x] 灰色只出现在真实 disabled，红色只出现在危险操作。
- [x] 纯图标、标签、筛选、分段和状态控件未被误改。
- [x] `npm run action-button:unit` 与 `npm run action-button:check` 通过。
- [x] talk、后台检查、后台构建和小程序构建通过。
- [x] `npm run check` 通过。
- [ ] 微信开发者工具和后台浏览器代表页面完成实际验收。

## 验证记录

- 2026-07-24：用户确认采用“语义统一 + 全项目审计”；可用文字按钮使用项目现有协调绿色，禁用保留灰色，危险操作保留红色；纯图标和非按钮型控件不强制改色。
- 2026-07-24：D54 requirements/design/tasks 三件套已建立，业务实现尚未开始。
- 2026-07-24：先建立 RED/GREEN 契约；helper 缺失时测试按预期失败，补齐实现后 `npm run action-button:unit` 8/8 通过，`npm run action-button:check` 覆盖 35 个业务源码文件并通过。
- 2026-07-24：`npm --workspace @jubenmi/talk run test` 8/8、`npm --workspace apps/admin-web run check` 7/7、`npm run build:admin-web`、`npm run build:mp-weixin` 和完整 `npm run check` 均 exit 0。小程序构建仅输出既有 Sass 弃用提示。
- 2026-07-24：后台浏览器实际验收通过。普通、次要和批量上/下架操作为浅绿 `#eef8f3`，危险下架/删除为红色 `#fff1ef`；加载中的控件呈真实 disabled。导航、标签页等非操作控件未纳入按钮改色。
- 2026-07-24：开发者工具成功编译 D54 构建产物且控制台无错误，但模拟器 `pages/index/index` 保持空白，未能完成相册隐私、建车和聊天的代表页视觉验收；对应人工验收项继续保持未勾选。
- 2026-07-24：按用户授权清理测试数据：删除 7 个 D23/D53 测试车局、7 个测试剧本和 7 个测试店家；店家删除先被引用约束拦截，随后先清理关联车局再完成删除。保留所有非 D23/D53 真实记录。
- 2026-07-24：发现开发者工具启动时 TDesign 组件以原始 ESM（`import`/`export`）进入微信 `require` 运行时，导致 `Unexpected token 'export'`，继发 148 条组件未定义错误。构建末尾现将组件脚本转换为 CommonJS，补齐 `dayjs`、`tinycolor2`、`tslib` 运行时依赖，并移除非运行时 `.d.ts` 文件；新增 3 项构建产物测试且接入根检查。实际开发者工具重新编译后首页正常渲染，稳定态控制台为 0 errors / 0 warnings。热重载期间仅出现开发者工具自身的 `routeDone ... webviewId` 记录，清空后未复现；未将其视为应用错误。
- 2026-07-24：复审发现后台存在两处 CSS 层叠遗漏：抽屉 `.close-button` 的后置规则将文字覆盖为中性灰，且 `.danger` 的 `!important` 会让 disabled 危险按钮保留红字。先新增 `apps/admin-web/test/buttonStyleContract.test.mjs`，两项断言均按预期失败；随后将抽屉关闭文字恢复为 `--admin-accent-strong`，并让共享 disabled 规则以 `#ffffff !important` 覆盖危险文字。`npm --workspace apps/admin-web run check`、`npm run action-button:unit`、`npm run action-button:check`、完整 `npm run check` 均通过。
- 2026-07-24：开发者工具在已登录真实账号下完成了部分只读视觉抽查：建车店家未选择时“下一步”为灰色，选中既有店家后可进入剧本页；车头管理页普通操作处于绿色体系，底部“取消本车”为红色。未提交建车、保存设置、发送消息、取消车或任何会改动真实数据的操作。相册隐私、角色、聊天、管理员目录以及后台浏览器的完整真实状态组合尚未逐一验收，因此 Task 6 Step 5 和最终人工验收继续保持未勾选。
- 2026-07-24：继续在已登录真实账号下进行只读验收，且未创建、保存、发送、删除或更改任何真实业务数据。建车流程的店家、剧本页均观察到“未选=灰色 disabled、选中既有资料=深绿”；角色页选择会进入“确认反串”业务弹窗，为避免改变真实用户状态未确认。车头管理页观察到保存置顶为深绿、申请提醒/车局详情及关闭座位为浅绿、已保存为灰色 disabled；相册隐私页观察到保存设置为深绿、停止我的相册分享为红色。聊天空输入的发送为灰色 disabled；开发者工具未能可靠注入临时文本，未执行发送。管理员目录页观察到主操作深绿、次要操作浅绿；首次列表验收发现“删除”错误继承绿色，根因是 4 个删除调用点误用 `muted` 类。先新增 9/9 通过的契约测试，再改为 `danger`，重新编译并实机复验列表“编辑=深绿、下架=绿色、删除=红色”。控制台均为 0 errors，警告仅为开发者工具环境提示。后台浏览器和会产生持久变更的禁用/保存中组合未重新实机覆盖，Task 6 Step 5 与最终人工验收继续保持未勾选。
