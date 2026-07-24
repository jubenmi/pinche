# D56 相册操作栏与分享入口重映射实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 简化相册操作栏，让招募直接分享邀请上车链接，并让成员页右上角微信分享始终使用后台预热的全部相片快照。

**Architecture:** 使用纯函数分享意图路由隔离招募、active、单张和默认全部；成员相册加载后独立预热招募 token 与 scope=all 相册 token；一个串行 Canvas 协调器保留 default 与 active 两套临时封面，页面生命周期统一失效。

**Tech Stack:** UniApp、Vue Options API、微信小程序 `open-type="share"` / `onShareAppMessage` / `onShareTimeline`、Node.js `node:test`、D55 Canvas 工具。

---

## 0. 规格与基线

- [x] **Step 0.1：提交 D56 requirements、design 与 tasks**

  文件：

  - `specs/d56-album-share-entry-remap/requirements.md`
  - `specs/d56-album-share-entry-remap/design.md`
  - `specs/d56-album-share-entry-remap/tasks.md`

- [x] **Step 0.2：记录现有基线**

  Run:

  ```bash
  npm run d53:unit
  npm run d55:unit
  ```

  Expected:

  ```text
  D53: 12 pass, 0 fail
  D55: 45 pass, 0 fail
  ```

## 1. 分享意图与招募 payload（TDD）

**Files:**

- Create: `apps/miniprogram/src/utils/albumShareEntry.js`
- Create: `apps/miniprogram/test/albumShareEntry.test.mjs`

- [x] **Step 1.1：写分享来源优先级失败测试**

  测试必须使用实际导出函数，覆盖：

  ```js
  assert.deepEqual(
    albumShareAppMessageIntent({
      from: "button",
      target: { dataset: { albumShare: "recruit", mediaId: "41" } }
    }),
    { kind: "recruit" }
  );
  assert.deepEqual(
    albumShareAppMessageIntent({
      from: "button",
      target: { dataset: { albumShare: "active" } }
    }),
    { kind: "active" }
  );
  assert.deepEqual(
    albumShareAppMessageIntent({
      from: "button",
      target: { dataset: { mediaId: "41" } }
    }),
    { kind: "single", mediaId: 41 }
  );
  assert.deepEqual(albumShareAppMessageIntent({ from: "menu" }), {
    kind: "default_all"
  });
  assert.deepEqual(
    albumShareAppMessageIntent({ from: "button", target: { dataset: {} } }),
    { kind: "unknown" }
  );
  assert.deepEqual(
    albumShareAppMessageIntent({ from: "menu" }, { timelineMode: true }),
    { kind: "public" }
  );
  ```

- [x] **Step 1.2：运行 RED**

  Run:

  ```bash
  node --test apps/miniprogram/test/albumShareEntry.test.mjs
  ```

  Expected: FAIL，提示 `albumShareEntry.js` 或导出函数不存在。

- [x] **Step 1.3：实现最小分享意图解析**

  在 `albumShareEntry.js` 导出：

  ```js
  ALBUM_SHARE_INTENT
  albumShareAppMessageIntent(options)
  ```

  规则必须是 recruit → active → single → unknown button → public/default_all；非法 media ID 不得成为 single，未知 button 不得成为 default_all。

- [x] **Step 1.4：写并实现招募 payload 测试**

  覆盖：

  ```js
  recruitmentSharePayload({
    sessionId: 123,
    inviteToken: "invite token",
    title: "剧本｜店家｜时间",
    now: 1720000000000
  });
  ```

  Expected:

  ```js
  {
    title: "剧本｜店家｜时间",
    path: "/pages/session/share?id=123&shareCode=s123-1720000000000&inviteToken=invite%20token&source=wechat_share",
    imageUrl: "/static/art/ticket-landscape.jpg"
  }
  ```

  缺少合法 session、token 或标题时必须返回 `null`。

- [x] **Step 1.5：实现 generation authority 与串行队列测试**

  测试两个明确边界：

  ```js
  const authority = createAlbumShareEntryAuthority();
  const first = authority.begin({ sessionId: 1, userId: 2, mediaVersion: 3 });
  const reused = authority.begin({ sessionId: 1, userId: 2, mediaVersion: 3 });
  assert.equal(reused.key, first.key);
  authority.invalidate();
  assert.equal(authority.isCurrent(first), false);
  ```

  以及两个异步 renderer 永远不同时运行，执行顺序保持 `[startA, endA, startB, endB]`。

- [x] **Step 1.6：运行 GREEN 并提交**

  Run:

  ```bash
  node --test apps/miniprogram/test/albumShareEntry.test.mjs
  git add apps/miniprogram/src/utils/albumShareEntry.js apps/miniprogram/test/albumShareEntry.test.mjs
  git commit -m "feat(album): route album share entry intents"
  ```

  Expected: 新测试全部 PASS。

## 2. 操作栏 UI 与招募直接分享（TDD）

**Files:**

- Modify: `apps/miniprogram/src/pages/session/album.vue`
- Test: `apps/miniprogram/test/albumShareEntry.test.mjs`

- [x] **Step 2.1：写操作栏结构失败测试**

  从 `album.vue` 读取 template/style，并断言：

  ```js
  assert.ok(privacyButton.includes('aria-label="相册隐私"'));
  assert.doesNotMatch(privacyButton, />\\s*隐私\\s*</);
  assert.match(style, /grid-template-columns:\\s*minmax\\(0, 1fr\\)\\s+78rpx/);
  assert.match(style, /\\.album-privacy-action[\\s\\S]*width:\\s*78rpx/);
  assert.ok(shareIndex < downloadIndex);
  assert.ok(downloadIndex < recruitIndex);
  assert.ok(recruitIndex < tagIndex);
  assert.match(recruitButton, /data-album-share="recruit"/);
  assert.match(recruitButton, /open-type/);
  ```

- [x] **Step 2.2：运行 RED**

  Run:

  ```bash
  node --test apps/miniprogram/test/albumShareEntry.test.mjs
  ```

  Expected: FAIL 于隐私文字、180rpx 列宽、按钮顺序和招募 navigation。

- [x] **Step 2.3：修改模板和样式**

  - 隐私按钮只保留图标及无障碍名称；
  - 第一排右列与按钮均为 78rpx，并保留现有相近的 12rpx 圆角；
  - 顺序改为分享、下载、招募、标注；
  - 标注绿色 class 随 DOM 移到最右；
  - 招募按钮使用 `data-album-share="recruit"` 和动态 `open-type`；
  - 删除 `openRecruitment()` 的页面跳转。

- [x] **Step 2.4：接入招募 token 预热**

  在成员 `loadAlbum()` 当前响应应用完成后，非阻塞执行 `prepareRecruitInvite()`；请求固定为：

  ```js
  request({
    url: `/api/sessions/${this.sessionId}/join-invite-token`,
    method: "POST",
    data: {}
  });
  ```

  写状态前校验 session、user 和 generation。未就绪点击只去重重试并调用：

  ```js
  showToast({ title: "正在准备招募分享，请稍后再点", icon: "none" });
  ```

- [x] **Step 2.5：接入 `onShareAppMessage` 招募分支**

  先调用 `albumShareAppMessageIntent(options)`；recruit 只读取 `recruitInviteToken` 并调用 `recruitmentSharePayload`。返回 `null` 时使用现有 fail-closed payload，不读取 active/default/single token。

- [x] **Step 2.6：运行测试并提交**

  Run:

  ```bash
  node --test apps/miniprogram/test/albumShareEntry.test.mjs
  npm run d53:unit
  git add apps/miniprogram/src/pages/session/album.vue apps/miniprogram/test/albumShareEntry.test.mjs
  git commit -m "feat(album): streamline toolbar recruitment sharing"
  ```

  Expected: D56 页面测试 PASS，D53 12/12。

## 3. 右上角默认全部相片预热（TDD）

**Files:**

- Modify: `apps/miniprogram/src/pages/session/album.vue`
- Modify: `apps/miniprogram/src/utils/albumShareCover.js` only if the coordinator requires a reusable currentness seam
- Modify: `apps/miniprogram/test/albumShareEntry.test.mjs`
- Modify: `apps/miniprogram/test/albumSharePreview.test.mjs`

- [x] **Step 3.1：写 default 与 active 隔离失败测试**

  页面测试必须证明：

  ```js
  assert.match(source, /defaultAlbumShareToken/);
  assert.match(source, /data:\\s*\\{\\s*scope:\\s*"all"\\s*\\}/);
  assert.doesNotMatch(memberMenuBranch, /activeAlbumShareToken/);
  assert.match(activeButtonBranch, /activeAlbumSharePayload/);
  assert.match(memberTimelineBranch, /defaultAlbumShareToken/);
  ```

  行为测试还要模拟 active selected token 后确认菜单 payload 仍返回 default all token。

- [x] **Step 3.2：运行 RED**

  Run:

  ```bash
  node --test apps/miniprogram/test/albumShareEntry.test.mjs apps/miniprogram/test/albumSharePreview.test.mjs
  ```

  Expected: FAIL，因为成员菜单仍读取 `activeAlbumShareToken`。

- [x] **Step 3.3：增加独立 default 状态和静默预热**

  `prepareDefaultAlbumShare()` 固定请求：

  ```js
  request({
    url: `/api/sessions/${this.sessionId}/album/share-token`,
    method: "POST",
    data: { scope: "all" }
  });
  ```

  它不得设置 `albumSharePreparing`、`statusText` 或 `albumShareReadyVisible`。相同 session/user/media version 重复调用复用同一个 promise。

- [x] **Step 3.4：串行 default/active Canvas**

  用 Task 1 的协调器包裹 D55 Canvas preparation：

  - 同一时刻最多一个页面 Canvas context 绘制；
  - default 完成路径和 active 完成路径同时保留；
  - active 与 default 发生竞态时，迟到任务按自己的 generation 关闭；
  - active 完成后若 default 未就绪，重新排队 default；
  - 不新增第二对 hidden Canvas。

- [x] **Step 3.5：重写菜单和分享回调**

  - member menu app message → default friend；
  - member timeline → default timeline；
  - public timeline mode → 保持路由 token；
  - active button → active；
  - single button → single；
  - selection mode 期间菜单仍隐藏；
  - default 未就绪不借用 active token。

- [x] **Step 3.6：运行聚焦回归并提交**

  Run:

  ```bash
  node --test apps/miniprogram/test/albumShareEntry.test.mjs apps/miniprogram/test/albumSharePreview.test.mjs
  npm run d54:unit
  npm run d55:unit
  git add apps/miniprogram/src/pages/session/album.vue apps/miniprogram/src/utils/albumShareCover.js apps/miniprogram/test/albumShareEntry.test.mjs apps/miniprogram/test/albumSharePreview.test.mjs
  git commit -m "feat(album): prewarm default all-photo sharing"
  ```

  Expected: D54 45/45，D55 45/45，D56 新测试 PASS。

## 4. 生命周期、失效与失败关闭（TDD）

**Files:**

- Modify: `apps/miniprogram/src/pages/session/album.vue`
- Modify: `apps/miniprogram/test/albumShareEntry.test.mjs`

- [x] **Step 4.1：写竞态和生命周期失败测试**

  覆盖：

  - 后发 album load 使前一个 default token 响应失效；
  - auth change 使 default 与 recruit 同时失效；
  - hide/unload 释放 Canvas 临时路径并清空两类 token；
  - onShow 对当前数据但空状态执行一次重试；
  - filter、scroll、public pagination 不重建 member default；
  - 401/403 后菜单关闭；
  - default 后台失败不写 busy、ready 弹层或用户全局错误。

- [x] **Step 4.2：运行 RED**

  Run:

  ```bash
  node --test apps/miniprogram/test/albumShareEntry.test.mjs
  ```

  Expected: 至少 lifecycle/currentness 新断言失败。

- [x] **Step 4.3：实现最小失效与重试**

  新增并统一调用：

  ```js
  invalidateDefaultAlbumShare()
  invalidateRecruitInviteShare()
  primeAlbumShareEntries()
  ```

  所有异步写入前检查对应 authority；catch 只清本来源状态，不污染其他来源。

- [x] **Step 4.4：运行 GREEN 并提交**

  Run:

  ```bash
  node --test apps/miniprogram/test/albumShareEntry.test.mjs
  npm run d54:unit
  npm run d55:unit
  git add apps/miniprogram/src/pages/session/album.vue apps/miniprogram/test/albumShareEntry.test.mjs
  git commit -m "fix(album): close stale share entry preparation"
  ```

  Expected: 所有聚焦测试 PASS。

## 5. D56 门禁与完整验证

**Files:**

- Create: `scripts/d56-album-share-entry-remap-check.js`
- Modify: `package.json`

- [x] **Step 5.1：写 D56 静态门禁**

  门禁解析实际 Vue template/script/style，并要求：

  - 隐私纯图标方形；
  - 操作顺序；
  - 招募 `open-type=share`；
  - default scope all；
  - 分享来源隔离；
  - 生命周期清理。

  同时拒绝：

  ```text
  openRecruitment -> navigateTo(/pages/session/share)
  member menu -> activeAlbumShareToken
  default prewarm -> albumBusy/statusText/albumShareReadyVisible
  apps/api/src/modules/album-share-cover/*
  new server cover route / Sharp composite
  ```

- [x] **Step 5.2：接入 package scripts**

  增加：

  ```json
  {
    "d56:unit": "node --test apps/miniprogram/test/albumShareEntry.test.mjs",
    "d56:check": "node scripts/d56-album-share-entry-remap-check.js"
  }
  ```

  `postcheck` 在 D55 后运行 D56 unit/check，不删除 D53/D54/D55。

- [x] **Step 5.3：运行完整验证**

  Run:

  ```bash
  npm run d53:unit
  npm run d54:unit
  npm run d55:unit
  npm run d56:unit
  npm run d56:check
  npm run build:mp-weixin
  node scripts/check-miniprogram.js
  npm run check
  git diff --check
  ```

  Expected:

  - 所有命令 exit 0；
  - 小程序 14 pages；
  - 主包继续低于 1.5 MiB；
  - 无服务端合图标识；
  - 只有既有 UniApp/Sass 弃用提醒可接受。

  当前基线是 1,570,813 / 1,572,864 bytes。若超限，按以下顺序恢复余量，禁止提高阈值：

  1. 删除被替代的 `openRecruitment`、重复 member menu 分支和重复 payload 拼装；
  2. 确认 D56 没有复制 D55 Canvas/recipe 实现；
  3. 若仍超限，用项目现有 `sharp` 依赖把两张分享降级 JPEG 保持原尺寸重新编码。优先 quality 70；若诊断证明 quality 70 反而增大既有压缩图片，则记录字节和视觉检查，并选择能恢复 1.5 MiB 上限的最高有效质量（本次为 quality 20）：

     ```bash
     node --input-type=module -e 'import sharp from "sharp"; for (const file of ["apps/miniprogram/src/static/art/album-share-friend.jpg","apps/miniprogram/src/static/art/album-share-timeline.jpg"]) { const next = await sharp(file).jpeg({quality:70,mozjpeg:true}).toBuffer(); await sharp(next).toFile(`${file}.next`); }'
     ```

     使用安全文件替换后重新构建，并确认两张资源仍是不同文件、D55 fallback 测试通过。

- [x] **Step 5.4：提交门禁**

  ```bash
  git add package.json scripts/d56-album-share-entry-remap-check.js apps/miniprogram/test/albumShareEntry.test.mjs
  git commit -m "test(album): gate remapped share entries"
  ```

## 6. 代码审查、开发者工具与发布

- [x] **Step 6.1：请求代码审查**

  审查重点：分享来源串线、默认 token 隐私边界、招募 token 迟到响应、Canvas 临时路径生命周期和 D53/D54/D55 回归。

  - 2026-07-24：独立审查 `574dced4..5b34bfdd` 未发现 Critical 或 Important 问题；确认分享来源、token authority、Canvas 生命周期和 D53/D54/D55 回归边界均符合规格。保留一项不阻塞建议：后续补页面方法级的迟到 Promise 回归测试。

- [x] **Step 6.2：运行开发者工具刷新**

  Run:

  ```bash
  npm run devtools:refresh
  ```

  Expected: 最新 `dist/dev/mp-weixin` fingerprint 与源码一致。

  - 2026-07-24：`npm run devtools:refresh` 已重新构建并触发开发工具刷新，输出确认源码 fingerprint 与产物一致。

- [ ] **Step 6.3：手工验证**

  - 隐私按钮是纯锁图标方形；
  - 顺序为分享、下载、招募、标注；
  - 招募直接打开好友/群聊分享；
  - 接收方进入邀请上车页面；
  - 右上角好友和朋友圈均为全部相片；
  - 页面选中分享仍只分享选中内容；
  - 身份切换、上传、删除、标注后不会使用旧 token。

  - 进行中（2026-07-24）：正确 D56 产物已在开发工具打开，且最新 `npm run check`、`git diff --check` 均通过；在有相册数据的开发工具会话中实际确认隐私为纯锁图标方形，且第二排顺序为“分享、下载、招募、标注”。招募/两种右上角分享/身份与媒体变更后的 token 失效仍需在已登录测试会话中逐项点击验证。审核版本 `0.20260724.1` 已通过开发工具上传，但这不替代本步骤或 Git/CI 发布门禁。

- [ ] **Step 6.4：按门禁发布**

  仅在完整验证和审查通过后：

  1. 合并并推送 `develop`；
  2. 等待 `develop` CI 成功；
  3. 合并推送 `main` 并等待 CI；
  4. 合并推送 `publish` 并等待最终 CI。

  - 进行中（2026-07-24）：按用户当前授权仅推进 `develop`。`53ca21d1` 已快进推送至 `develop`，GitHub Actions Docker Publish（run `30057643691`）成功。`main` 与 `publish` 未推进；它们仍等待剩余分享交互手工验收及明确发布授权。
