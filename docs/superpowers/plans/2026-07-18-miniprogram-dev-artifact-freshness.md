# 微信开发者工具最新产物与改期回归防护 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 保证微信开发者工具只打开由当前源码生成的小程序开发包，并验证改期入口与北京时间展示均来自最新实现。

**Architecture:** 把源码内容指纹、必需产物完整性和状态判断提取为无副作用模块；Codex Stop 刷新只做关闭式校验，人工 `npm run devtools:refresh` 负责一次性构建、写入指纹并打开开发者工具。业务源码、生产 API 和数据保持不变。

**Tech Stack:** Node.js ESM、`node:test`、UniApp/Vite、微信开发者工具 CLI。

**Source of truth:** `docs/superpowers/specs/2026-07-18-miniprogram-dev-artifact-freshness-design.md`

---

## 范围与约束

- [x] 已确认根因：源码含改期和北京时间修复，但 `dist/dev/mp-weixin` 早于相关提交。
- [x] 已确认基线：共享时间测试 5/5、改期相关测试 47/47 通过。
- [ ] 不修改改期业务规则、生产数据、内容审核开关、微信 Token 或生产 Stack。
- [ ] 不提交 `dist`；主工作区既有 `package-lock.json` 和 `docs/evidence/` 不纳入本次提交。
- [ ] 任一构建失败、超时、产物缺失或指纹不一致时，不打开开发者工具。

## Task 1：以测试定义开发产物新鲜度

> 当前进度：Task 1 已完成，RED 为模块不存在，GREEN 为 5/5。

**Files:**

- Create: `scripts/miniprogram-dev-artifacts.test.mjs`
- Create: `scripts/miniprogram-dev-artifacts.js`

- [x] 1.1 写失败测试：缺少指纹时，即使旧产物存在也返回 `stale`。
- [x] 1.2 写失败测试：指纹与当前源码内容不一致时返回 `stale`。
- [x] 1.3 写失败测试：必需的入口、管理页、日历、共享时间或 TDesign 产物缺失时返回 `incomplete`。
- [x] 1.4 写失败测试：指纹匹配且必需产物完整、JSON 可解析时才返回 `ready`。
- [x] 1.5 运行 `node --test scripts/miniprogram-dev-artifacts.test.mjs`，确认因模块/行为尚未实现而 RED。
- [x] 1.6 最小实现递归源码快照、SHA-256 内容指纹、manifest 读写和产物状态判断。
- [x] 1.7 重跑测试，确认 GREEN。
- [x] 1.8 提交：`test: define miniprogram dev artifact freshness`。

## Task 2：让刷新脚本关闭式拒绝旧包

> 当前进度：Task 2 已完成；默认模式对旧包返回退出码 2，且未启动构建。

**Files:**

- Modify: `scripts/devtools-refresh-hook.js`
- Modify: `scripts/miniprogram-dev-artifacts.test.mjs`

- [x] 2.1 增加失败测试：默认刷新在指纹缺失/过期时返回非成功状态，并给出 `npm run devtools:refresh` 指引。
- [x] 2.2 增加失败测试：Stop 模式不得启动 UniApp 构建。
- [x] 2.3 运行定向测试并确认 RED。
- [x] 2.4 改造 hook 使用共享状态模块；仅 `ready` 时调用微信开发者工具 CLI。
- [x] 2.5 保留去重状态，但以内容指纹代替 mtime 作为刷新依据。
- [x] 2.6 重跑定向测试并确认 GREEN。
- [x] 2.7 提交：`fix: refuse stale miniprogram dev output`。

## Task 3：实现一次性构建并刷新

> 当前进度：Task 3 已完成；完成信号与必需产物双重门禁、超时清理均已通过测试。

**Files:**

- Modify: `scripts/devtools-refresh-hook.js`
- Modify: `scripts/miniprogram-dev-artifacts.test.mjs`
- Modify: `package.json`

- [x] 3.1 增加失败测试：`--rebuild` 必须等待首次构建完成、校验产物、写入当前指纹，再允许打开。
- [x] 3.2 增加失败测试：构建失败/超时必须终止子进程且不得写指纹或打开开发者工具。
- [x] 3.3 运行定向测试并确认 RED。
- [x] 3.4 实现一次性 `npm --workspace apps/miniprogram run dev:mp-weixin` 编排和可靠清理。
- [x] 3.5 将 `npm run devtools:refresh` 更新为显式 `--force --rebuild`。
- [x] 3.6 重跑定向测试并确认 GREEN。
- [ ] 3.7 提交：`feat: rebuild latest miniprogram before refresh`。

## Task 4：把防回归契约纳入项目检查

**Files:**

- Modify: `scripts/check-miniprogram.js`
- Modify: `package.json`

- [ ] 4.1 先修改静态检查预期并运行 `node scripts/check-miniprogram.js`，确认旧 hook 契约导致 RED。
- [ ] 4.2 检查共享时间源码目录已纳入指纹，必需产物含管理页、日历、共享时间和入口。
- [ ] 4.3 将新鲜度单测纳入根项目的稳定检查入口。
- [ ] 4.4 运行 `node scripts/check-miniprogram.js` 与定向测试，确认 GREEN。
- [ ] 4.5 提交：`test: guard fresh miniprogram dev artifacts`。

## Task 5：从当前源码生成并审计最新开发包

**Files:**

- Generate (gitignored): `apps/miniprogram/dist/dev/mp-weixin/**`
- Generate (gitignored): `apps/miniprogram/dist/dev/mp-weixin/.codex-source-fingerprint.json`

- [ ] 5.1 运行一次性开发构建，但暂不打开开发者工具；确认 watcher 已终止。
- [ ] 5.2 重新计算状态，必须为 `ready` 且指纹等于当前源码。
- [ ] 5.3 检查构建产物包含改期按钮/选择器、`/reschedule` 专用接口和北京时间格式化实现。
- [ ] 5.4 运行共享时间测试、`session-reschedule:verify`、新鲜度单测和 `check-miniprogram`。
- [ ] 5.5 运行与改动范围相称的根项目检查；记录任何与本次无关的既有失败。
- [ ] 5.6 提交计划勾选与必要文档更新：`docs: record miniprogram freshness verification`。

## Task 6：微信开发者工具实际验收

**Files:**

- No tracked file changes expected.

- [ ] 6.1 用新入口打开当前 worktree 的 `dist/dev/mp-weixin`，清理缓存并重新编译。
- [ ] 6.2 验证目标车局在日历与管理页均显示北京时间 `13:00`，不显示 `05:00`。
- [ ] 6.3 验证发车前显示“改期”，点击后能打开日期时间选择器和二次确认流程。
- [ ] 6.4 不提交真实改期；确认控制台无由本次改动引入的运行时错误。
- [ ] 6.5 若生产车局状态已不适合，用不修改生产数据的本地/模拟车局完成同等界面验证并记录限制。

## Task 7：合入 develop 并刷新主工作区

- [ ] 7.1 复核差异只覆盖本计划，且 `dist`、用户既有 `package-lock.json`、`docs/evidence/` 未进入提交。
- [ ] 7.2 在隔离分支运行最终验证并请求代码审查。
- [ ] 7.3 将已验证提交合入本地主工作区 `develop`，保留用户未提交内容。
- [ ] 7.4 在主工作区重新执行一次性构建，生成与 `develop` 当前源码匹配的开发包指纹。
- [ ] 7.5 从主工作区项目再次打开开发者工具并做最小复验。
- [ ] 7.6 最终报告已完成项、验证证据、未执行项或限制；未全部满足不得宣称完成。
