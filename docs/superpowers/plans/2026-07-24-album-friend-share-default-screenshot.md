# 相册好友分享使用微信默认截图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让整册、选中快照和公开相册的好友/群聊分享省略 `imageUrl`，直接使用微信默认页面截图，同时保留朋友圈、单媒体、招募和失败关闭封面。

**Architecture:** 保留现有相册 token、路径和 Canvas 基础设施，但把好友 payload 与封面 readiness 解耦。通用分享工具负责返回不含 `imageUrl` 的好友 payload，并允许调用方只准备 `timeline` Canvas；相册页的三个整册好友入口只依赖有效 token，朋友圈继续依赖方形封面。

**Tech Stack:** UniApp/Vue 2、微信小程序 `onShareAppMessage`/`onShareTimeline`、Node.js `node:test`、现有静态契约检查脚本。

**Source of truth:** `docs/superpowers/specs/2026-07-24-album-friend-share-default-screenshot-design.md`

---

## 文件职责

- `apps/miniprogram/src/utils/albumShareCover.js`：定义好友默认截图 payload、分享菜单 readiness 和按渠道启动 Canvas 的纯函数契约。
- `apps/miniprogram/src/utils/albumShareEntry.js`：把成员默认整册好友 readiness 从“封面已生成”改为“token 已存在”。
- `apps/miniprogram/src/pages/session/album.vue`：让默认整册、活动快照和公开相册好友 payload 省略封面，并只准备朋友圈 Canvas。
- `apps/miniprogram/test/albumShareCover.test.mjs`：用行为测试锁定 payload 无 `imageUrl`、好友菜单只依赖 token、只准备指定渠道。
- `apps/miniprogram/test/albumShareEntry.test.mjs`：锁定成员默认整册 readiness 和页面三个好友分支。
- `apps/miniprogram/test/albumSharePreview.test.mjs`：锁定活动快照立即可分享，朋友圈 Canvas 保持独立。
- `scripts/d55-client-canvas-album-share-cover-check.js`：把 D55 静态契约从双渠道 Canvas 调整为仅朋友圈 Canvas。
- `scripts/d56-album-share-entry-remap-check.js`：把 D56 菜单契约调整为好友依赖 token、朋友圈依赖封面。

### Task 1: 锁定分享工具的默认截图契约

当前执行项：先写失败测试，不改生产代码。

**Files:**
- Modify: `apps/miniprogram/test/albumShareCover.test.mjs`
- Modify: `apps/miniprogram/src/utils/albumShareCover.js`

- [x] **Step 1: 写好友 payload、菜单和指定渠道准备的失败测试**

把好友 payload 断言改为没有 `imageUrl` 自有属性，并增加 token 直接开放好友菜单、`kinds: ["timeline"]` 不调用 friend renderer 的测试：

```js
test("好友分享省略 imageUrl 以使用微信默认页面截图", () => {
  const payload = albumShareFriendPayload({
    title: " 好友标题 ",
    path: " /pages/session/album?id=1&albumShareToken=t ",
    imageUrl: " wxfile://tmp/friend-cover "
  });

  assert.deepEqual(payload, {
    title: "好友标题",
    path: "/pages/session/album?id=1&albumShareToken=t"
  });
  assert.equal(Object.hasOwn(payload, "imageUrl"), false);
});

test("有效 token 立即开放好友菜单，朋友圈仍等待独立封面", () => {
  assert.deepEqual(albumShareMenus({
    token: "share-token",
    friendReady: false,
    timelineReady: false
  }), ["shareAppMessage"]);
  assert.deepEqual(albumShareMenus({
    token: "share-token",
    friendReady: false,
    timelineReady: true
  }), ["shareAppMessage", "shareTimeline"]);
});

test("调用方可以只准备朋友圈 Canvas", async () => {
  const preparedKinds = [];
  const jobs = startAlbumShareCoverPreparation({
    response: {
      cover_recipe: {
        version: "client-canvas-v1",
        images: [{ id: 1, thumbnail_url: "/api/thumb" }]
      }
    },
    kinds: ["timeline"],
    prepare: async (kind) => {
      preparedKinds.push(kind);
      return { ok: true, path: "wxfile://tmp/timeline.jpg" };
    }
  });

  await Promise.all(jobs);
  assert.deepEqual(preparedKinds, ["timeline"]);
});
```

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
node --test apps/miniprogram/test/albumShareCover.test.mjs
```

Expected: FAIL；好友 payload 仍包含 `imageUrl`，好友菜单仍受 `friendReady` 控制，准备器仍调用两个渠道。

- [x] **Step 3: 最小实现默认截图和按渠道准备**

把工具函数改为：

```js
export function albumShareMenus({ token, timelineReady } = {}) {
  if (!trimmedString(token)) return [];
  const menus = ["shareAppMessage"];
  if (timelineReady === true) menus.push("shareTimeline");
  return menus;
}

export function startAlbumShareCoverPreparation({
  response,
  kinds = ["friend", "timeline"],
  prepare,
  isCurrent = () => true,
  onPrepared = () => {}
} = {}) {
  if (typeof prepare !== "function") {
    throw new TypeError("album share cover preparation requires prepare");
  }
  const recipe = albumShareCoverRecipe(response);
  return kinds.map((kind) => Promise.resolve()
    .then(() => prepare(kind, recipe))
    .catch(() => null)
    .then((result) => {
      if (isCurrent() !== true) return false;
      onPrepared(kind, albumShareImage(kind, result?.ok === true ? result.path : result));
      return true;
    })
  );
}

export function albumShareFriendPayload({ title, path } = {}) {
  return {
    title: trimmedString(title),
    path: trimmedString(path)
  };
}
```

- [x] **Step 4: 运行工具测试并确认 GREEN**

Run:

```bash
node --test apps/miniprogram/test/albumShareCover.test.mjs
```

Expected: PASS，0 failures。

- [x] **Step 5: 提交工具契约**

```bash
git add apps/miniprogram/src/utils/albumShareCover.js apps/miniprogram/test/albumShareCover.test.mjs
git commit -m "fix(album): use default screenshot friend payloads"
```

### Task 2: 让成员默认整册 readiness 只依赖 token

当前执行项：先写成员默认状态失败测试。

**Files:**
- Modify: `apps/miniprogram/test/albumShareEntry.test.mjs`
- Modify: `apps/miniprogram/src/utils/albumShareEntry.js`

- [x] **Step 1: 写成员默认状态失败测试**

把现有状态断言调整为：即使好友 Canvas 未准备，只要默认 token 存在，好友分享就绪；朋友圈仍遵循自己的封面状态。

```js
test("member default all-photo sharing opens friend sharing from its token", () => {
  assert.deepEqual(
    memberDefaultAlbumShareState({
      defaultAlbumShareToken: "default-all-token",
      defaultAlbumShareFriendCoverPrepared: false,
      defaultAlbumShareTimelineCoverPrepared: false,
      activeAlbumShareToken: "selected-active-token"
    }),
    {
      token: "default-all-token",
      friendReady: true,
      timelineReady: false
    }
  );
});
```

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
node --test apps/miniprogram/test/albumShareEntry.test.mjs
```

Expected: FAIL；`friendReady` 仍为 `false`。

- [x] **Step 3: 最小实现 token readiness**

```js
export function memberDefaultAlbumShareState({
  defaultAlbumShareToken,
  defaultAlbumShareTimelineCoverPrepared
} = {}) {
  const token = trimmedString(defaultAlbumShareToken);
  return {
    token,
    friendReady: Boolean(token),
    timelineReady: defaultAlbumShareTimelineCoverPrepared === true
  };
}
```

- [x] **Step 4: 运行成员入口测试并确认 GREEN**

Run:

```bash
node --test apps/miniprogram/test/albumShareEntry.test.mjs
```

Expected: PASS，0 failures。

- [x] **Step 5: 提交 readiness 变更**

```bash
git add apps/miniprogram/src/utils/albumShareEntry.js apps/miniprogram/test/albumShareEntry.test.mjs
git commit -m "fix(album): gate friend sharing on snapshot token"
```

### Task 3: 切换相册页三个好友入口并保留朋友圈 Canvas

当前执行项：先写页面三个好友入口和朋友圈独立 Canvas 的失败测试。

**Files:**
- Modify: `apps/miniprogram/test/albumShareEntry.test.mjs`
- Modify: `apps/miniprogram/test/albumSharePreview.test.mjs`
- Modify: `apps/miniprogram/src/pages/session/album.vue`

- [x] **Step 1: 写页面行为失败测试**

新增静态行为测试，分别提取 `onShareAppMessage`、`defaultAlbumSharePayload`、
`activeAlbumSharePayload`、`prepareAlbumShareCovers`、`prepareDefaultAlbumShare` 和
`prepareAlbumShareSnapshot`，锁定：

```js
assert.doesNotMatch(publicBranch, /imageUrl|albumFriendShareImage/);
assert.doesNotMatch(defaultPayload, /defaultAlbumShareFriendCoverPrepared|imageUrl/);
assert.doesNotMatch(activePayload, /activeAlbumShareFriendCoverPrepared|imageUrl/);
assert.match(preparePublicCovers, /kinds:\s*\[\s*"timeline"\s*\]/);
assert.match(prepareDefault, /this\.installDefaultAlbumShareSnapshot[\s\S]*this\.showShareMenus\(\)/);
assert.match(prepareDefault, /kinds:\s*\[\s*"timeline"\s*\]/);
assert.match(prepareActive, /kinds:\s*\[\s*"timeline"\s*\]/);
assert.doesNotMatch(prepareActive, /ALBUM_PUBLIC_SHARE_COVER_UNAVAILABLE/);
assert.match(installActiveSnapshot, /this\.albumShareReadyVisible\s*=\s*true/);
```

同时保留断言：

```js
assert.match(singleMediaBranch, /imageUrl:\s*entry\.imageUrl/);
assert.match(recruitmentPayloadSource, /imageUrl:\s*RECRUITMENT_SHARE_IMAGE/);
assert.match(timelinePayloadSource, /imageUrl:\s*albumShareImage\("timeline"/);
assert.match(failClosedPayloadSource, /imageUrl:\s*SINGLE_MEDIA_SHARE_SAFE_CARD_IMAGE/);
```

- [x] **Step 2: 运行页面测试并确认 RED**

Run:

```bash
node --test apps/miniprogram/test/albumShareEntry.test.mjs apps/miniprogram/test/albumSharePreview.test.mjs
```

Expected: FAIL；三个好友分支仍传封面且等待 friend Canvas，准备器仍生成双渠道。

- [x] **Step 3: 最小修改相册页**

实施以下窄改动：

```js
// 公开相册再次转发
return albumShareFriendPayload({
  title: this.albumShareTitle(),
  path: `/pages/session/album${queryString({
    id: this.sessionId,
    source: "wechat_share",
    albumShareToken: this.albumShareToken
  })}`
});

// 默认整册与活动快照 payload 的 guard 只检查 timelineMode + token；
// 两个 albumShareFriendPayload 调用均不再传 imageUrl。

// 活动快照 token 安装完成即可展示原生分享 CTA。
this.albumShareReadyVisible = true;

// 三处 Canvas 准备仅保留朋友圈。
startAlbumShareCoverPreparation({
  response: coverContext.data,
  kinds: ["timeline"],
  prepare: /* existing callback */,
  isCurrent: /* existing callback */,
  onPrepared: /* existing callback */
});
```

默认整册 token 安装后立即调用 `this.showShareMenus()`；活动快照删除
`ALBUM_PUBLIC_SHARE_COVER_UNAVAILABLE` 好友封面失败分支。朋友圈的
`imageUrl`、readiness、fallback 和 Canvas 回调保持不变。

- [x] **Step 4: 运行页面测试并确认 GREEN**

Run:

```bash
node --test apps/miniprogram/test/albumShareEntry.test.mjs apps/miniprogram/test/albumSharePreview.test.mjs
```

Expected: PASS，0 failures。

- [x] **Step 5: 提交页面行为**

```bash
git add apps/miniprogram/src/pages/session/album.vue apps/miniprogram/test/albumShareEntry.test.mjs apps/miniprogram/test/albumSharePreview.test.mjs
git commit -m "fix(album): share friend cards from page screenshots"
```

### Task 4: 对齐 D55/D56 静态契约

当前执行项：运行旧静态契约，确认它会拒绝新的默认截图行为。

**Files:**
- Modify: `scripts/d55-client-canvas-album-share-cover-check.js`
- Modify: `scripts/d56-album-share-entry-remap-check.js`

- [x] **Step 1: 运行现有静态检查并确认 RED**

Run:

```bash
npm run d55:check
npm run d56:check
```

Expected: 至少一个检查 FAIL，因为旧契约仍要求好友 Canvas 和好友封面 readiness。

- [x] **Step 2: 更新静态检查的精确契约**

D55 改为要求三个整册准备点都包含：

```js
/kinds:\s*\[\s*"timeline"\s*\]/
```

并要求 `albumShareFriendPayload` 的函数体不包含 `imageUrl`，朋友圈 payload 仍包含
`imageUrl`。D56 改为要求 `memberDefaultAlbumShareState` 的 `friendReady` 来自非空
token，并且 `showShareMenus` 不读取 active snapshot 或好友封面状态。

- [x] **Step 3: 运行静态检查并确认 GREEN**

Run:

```bash
npm run d55:check
npm run d56:check
```

Expected: 两条命令均 PASS。

- [x] **Step 4: 提交静态契约**

```bash
git add scripts/d55-client-canvas-album-share-cover-check.js scripts/d56-album-share-entry-remap-check.js
git commit -m "test(album): gate default screenshot sharing"
```

### Task 5: 全量验证和规格收尾

当前执行项：运行聚焦单元测试、静态检查和微信小程序构建。

**Files:**
- Modify: `docs/superpowers/plans/2026-07-24-album-friend-share-default-screenshot.md`

- [x] **Step 1: 运行聚焦单元测试**

Run:

```bash
npm run d55:unit
npm run d56:unit
node --test apps/miniprogram/test/albumSharePreview.test.mjs
```

Expected: 全部 PASS，0 failures。

- [x] **Step 2: 运行聚焦静态检查**

Run:

```bash
npm run d55:check
npm run d56:check
node scripts/check-miniprogram.js
```

Expected: 全部 PASS。

- [x] **Step 3: 构建微信小程序**

Run:

```bash
npm run build:mp-weixin
```

Expected: exit 0，生成 `apps/miniprogram/dist/build/mp-weixin`。

- [x] **Step 4: 检查最终差异和规格覆盖**

Run:

```bash
git diff --check origin/develop...HEAD
git status --short
git diff --stat origin/develop...HEAD
```

Expected: 无空白错误；差异只包含设计/计划、相册分享工具、相册页、相关测试和静态检查。

- [x] **Step 5: 更新本计划复选框并提交验证记录**

把所有已完成步骤改为 `- [x]`，在本任务下记录实际测试命令和结果，然后执行：

```bash
git add docs/superpowers/plans/2026-07-24-album-friend-share-default-screenshot.md
git commit -m "docs(album): record screenshot share verification"
```

实际验证记录（2026-07-24）：

- `npm run d55:unit`：47/47 PASS，0 failures。
- `npm run d56:unit`：22/22 PASS，0 failures。
- `node --test apps/miniprogram/test/albumSharePreview.test.mjs`：11/11 PASS，0 failures。
- `npm run d55:check`：PASS。
- `npm run d56:check`：PASS。
- `node scripts/check-miniprogram.js`：PASS，检查 14 个页面。
- `npm run build:mp-weixin`：exit 0；仅输出既有 Sass deprecation warnings。
- `git diff --check origin/develop...HEAD`：无空白错误。
- 最终规格复核：成员默认全量分享、成员主动快照分享、公开相册再分享均省略好友 `imageUrl`；朋友圈继续使用独立方形 Canvas；单媒体、招募和 fail-closed payload 保持显式封面。
