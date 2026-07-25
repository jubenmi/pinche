# Public Album Label and Scroll Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让公开分享相册使用与成员相册一致的脱敏标签文案，并让触底分页及签名 URL 后台刷新保持已渲染卡片和原生页面滚动位置。

**Architecture:** 服务端只在已经通过公开资格复核的媒体 DTO 上投影有序、去重的 `public_tag_labels` 字符串数组；小程序用该数组生成“照片里/视频里”文案。分页 helper 同时返回完整合并结果和本次真正新增的媒体，页面只向 `uv-waterfall` 的模型尾部追加新增项。后台刷新通过同一 token 重新读取当前已加载前缀；ID 序列不变时替换媒体字段和两列行对象，只有授权结果确实改变 ID 序列时才调用完整瀑布流刷新。

**Tech Stack:** Node.js ESM、`node:test`、Vue 2 / uni-app、微信小程序原生页面滚动、`uv-waterfall`、现有 D48/D50/D54 契约门禁。

---

## Execution context

- 工作目录：`/Users/dirui/Documents/pinche/.worktrees/public-album-label-scroll-fix`
- 分支：`codex/public-album-label-scroll-fix`
- 基线：最新本地 `develop`，相关 D48/D50/D54 聚焦测试和静态门禁在改动前均通过。
- 不修改原工作区 `/Users/dirui/Documents/pinche` 中与本任务无关的未提交文件。
- 所有实现改动先写失败测试并看到预期 RED，再写最小实现转 GREEN。

## Task 1: Project safe public tag labels from the API

**Files:**

- Modify: `apps/api/test/album-single-media-share.test.mjs`
- Modify: `apps/api/src/modules/core/service.js`

- [ ] **Step 1: Replace the obsolete “labels are absent” assertion with strict projection tests**

在 `apps/api/test/album-single-media-share.test.mjs` 中保留现有 `public media category` 测试，删除 `public media response exposes only the safe category and keeps raw tags private`，加入：

```js
test("public tag labels trim, discard invalid values, and deduplicate in source order", () => {
  assert.equal(typeof coreService.publicAlbumTagLabels, "function");
  assert.deepEqual(
    coreService.publicAlbumTagLabels([
      { label: " 沈清商 " },
      { label: "阿离" },
      { label: "沈清商" },
      { label: "  " },
      { label: 7 },
      null
    ]),
    ["沈清商", "阿离"]
  );
});

test("public media response exposes label strings without raw tag metadata", () => {
  const rawTags = [
    {
      id: 9001,
      key: "seat:private-canary",
      tag_type: "seat",
      seat_id: 1000,
      session_npc_role_id: 9002,
      user_id: 100,
      seat_user_id: 100,
      label: "沈清商",
      account_name: "ACCOUNT_CANARY",
      note: "NOTE_CANARY"
    },
    {
      id: 9003,
      key: "session-npc:private-canary",
      tag_type: "session_npc_role",
      session_npc_role_id: 9004,
      user_id: null,
      label: "阿离"
    }
  ];
  const response = coreService.publicAlbumMediaResponse(
    eligibleMedia(41),
    rawTags,
    claims
  );

  assert.equal(response.public_category, "share_subject");
  assert.deepEqual(response.tags, []);
  assert.deepEqual(response.public_tag_labels, ["沈清商", "阿离"]);
  assert.deepEqual(
    coreService.publicAlbumMediaResponse(eligibleMedia(42), [], claims)
      .public_tag_labels,
    []
  );

  const serialized = JSON.stringify(response);
  for (const field of [
    "key",
    "label",
    "tag_type",
    "seat_id",
    "session_npc_role_id",
    "user_id",
    "seat_user_id",
    "account_name",
    "note"
  ]) {
    assert.equal(serialized.includes(`"${field}":`), false, field);
  }
  assert.equal(serialized.includes("ACCOUNT_CANARY"), false);
  assert.equal(serialized.includes("NOTE_CANARY"), false);
});
```

- [ ] **Step 2: Run the focused API tests and verify RED**

Run:

```bash
node --test --test-name-pattern='public tag labels|public media response exposes label strings' apps/api/test/album-single-media-share.test.mjs
```

Expected: FAIL。第一项报告 `publicAlbumTagLabels` 为 `undefined`；第二项报告 `public_tag_labels` 为 `undefined`。

- [ ] **Step 3: Add the display-only label normalizer**

在 `apps/api/src/modules/core/service.js` 的 `publicAlbumMediaCategory` 前加入：

```js
export function publicAlbumTagLabels(tags) {
  const labels = [];
  const seen = new Set();
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (typeof tag?.label !== "string") continue;
    const label = tag.label.trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}
```

- [ ] **Step 4: Add the safe field only to public media DTOs**

把 `albumMediaResponse()` 中的公开字段分支替换为：

```js
...(options.publicShare
  ? {
      public_category:
        options.publicCategory === "share_subject" ? "share_subject" : "other",
      public_tag_labels: publicAlbumTagLabels(tags)
    }
  : {})
```

不要修改 `tags: options.publicShare ? [] : tags`，也不要把任一原始 tag 对象 spread 到响应中。

- [ ] **Step 5: Run the focused and full DTO tests**

Run:

```bash
node --test --test-name-pattern='public tag labels|public media response exposes label strings' apps/api/test/album-single-media-share.test.mjs
node --test apps/api/test/album-single-media-share.test.mjs
```

Expected: PASS。第二个命令包含 loopback HTTP 测试；受限环境若报 `EPERM`，应使用已经批准的测试权限重跑，而不是修改测试或跳过。

- [ ] **Step 6: Commit the server projection**

```bash
git add apps/api/test/album-single-media-share.test.mjs apps/api/src/modules/core/service.js
git diff --cached --check
git commit -m "feat(api): project safe public album tag labels"
```

## Task 2: Render public captions from tag labels

**Files:**

- Modify: `apps/miniprogram/test/albumSingleMediaShare.test.mjs`
- Modify: `apps/miniprogram/src/utils/albumSingleMediaShare.js`
- Modify: `apps/miniprogram/src/pages/session/album.vue`

- [ ] **Step 1: Replace category-caption tests with label-caption tests**

在 `apps/miniprogram/test/albumSingleMediaShare.test.mjs` 中删除 `public album cards show each safe media category instead of repeating the sharer role`，加入：

```js
test("public album captions use normalized tag labels for images and videos", () => {
  assert.equal(
    albumSingleMediaShare.publicAlbumMediaCaption({
      media_type: "image",
      public_tag_labels: ["标签A", "标签B"]
    }),
    "照片里：标签A、标签B"
  );
  assert.equal(
    albumSingleMediaShare.publicAlbumMediaCaption({
      media_type: "video",
      public_tag_labels: ["标签A", "标签B"]
    }),
    "视频里：标签A、标签B"
  );
});

test("public album captions discard invalid labels and never use legacy categories", () => {
  assert.equal(
    typeof albumSingleMediaShare.normalizePublicAlbumTagLabels,
    "function"
  );
  const dirtyLabels = [
    " 标签A ",
    "",
    " ",
    null,
    7,
    {},
    "标签A",
    "标签B"
  ];
  assert.deepEqual(
    albumSingleMediaShare.normalizePublicAlbumTagLabels(dirtyLabels),
    ["标签A", "标签B"]
  );
  assert.equal(
    albumSingleMediaShare.publicAlbumMediaCaption({
      media_type: "image",
      public_tag_labels: dirtyLabels
    }),
    "照片里：标签A、标签B"
  );

  for (const photo of [
    { media_type: "image" },
    { media_type: "image", public_tag_labels: "标签A" },
    {
      media_type: "image",
      public_tag_labels: [],
      public_category: "share_subject"
    },
    {
      media_type: "image",
      public_tag_labels: [" ", 7],
      public_category: "other"
    }
  ]) {
    assert.equal(
      albumSingleMediaShare.publicAlbumMediaCaption(photo, "叶辰"),
      "待标注"
    );
  }
});
```

- [ ] **Step 2: Run the caption tests and verify RED**

Run:

```bash
node --test --test-name-pattern='public album captions' apps/miniprogram/test/albumSingleMediaShare.test.mjs
```

Expected: FAIL。旧实现分别返回 `其他`、`包含 叶辰` 或 `打开小程序查看视频`，且 normalizer 不存在。

- [ ] **Step 3: Normalize labels and produce member-style captions**

在 `apps/miniprogram/src/utils/albumSingleMediaShare.js` 中用以下实现替换旧的 `publicAlbumMediaCaption()`：

```js
export function normalizePublicAlbumTagLabels(value) {
  const labels = [];
  const seen = new Set();
  for (const item of Array.isArray(value) ? value : []) {
    if (typeof item !== "string") continue;
    const label = item.trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

export function publicAlbumMediaCaption(photo) {
  const labels = normalizePublicAlbumTagLabels(photo?.public_tag_labels);
  if (labels.length === 0) return "待标注";
  const mediaLabel = photo?.media_type === "video" ? "视频" : "照片";
  return `${mediaLabel}里：${labels.join("、")}`;
}
```

- [ ] **Step 4: Stop passing the legacy share-subject fallback**

在 `apps/miniprogram/src/pages/session/album.vue` 中把 wrapper 改为：

```js
publicMediaCaption(photo) {
  return publicAlbumMediaCaption(photo);
},
```

不要修改成员相册的 `tagSummary()`，也不要修改公开视频点击时的受限播放提示。

- [ ] **Step 5: Run caption regression tests**

Run:

```bash
node --test apps/miniprogram/test/albumSingleMediaShare.test.mjs
npm run d50:unit
npm run d50:check
```

Expected: PASS。

- [ ] **Step 6: Commit the client captions**

```bash
git add apps/miniprogram/test/albumSingleMediaShare.test.mjs apps/miniprogram/src/utils/albumSingleMediaShare.js apps/miniprogram/src/pages/session/album.vue
git diff --cached --check
git commit -m "fix(miniprogram): show public album tag captions"
```

## Task 3: Append only newly paginated media to the waterfall

**Files:**

- Modify: `apps/miniprogram/test/albumPublicSharePagination.test.mjs`
- Modify: `apps/miniprogram/src/utils/albumPublicSharePagination.js`
- Modify: `apps/miniprogram/src/pages/session/album.vue`
- Modify: `scripts/d54-public-album-full-share-pagination-check.js`

- [ ] **Step 1: Extend the page merge contract with `appendedPhotos`**

在现有 `public-share pagination appends unique media` 测试中追加：

```js
assert.deepEqual(merged.appendedPhotos.map(({ id }) => id), [3]);
```

并把无新增项的完整对象断言改为：

```js
assert.deepEqual(
  pagination.mergePublicAlbumSharePages(
    [{ id: 1 }],
    [{ id: 1 }, { id: 0 }, {}],
    { next_cursor: "next", has_more: false }
  ),
  {
    photos: [{ id: 1 }],
    appendedPhotos: [],
    nextCursor: null,
    hasMore: false
  }
);
```

- [ ] **Step 2: Add a source contract that forbids destructive pagination**

在测试文件顶部加入：

```js
function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, start);
  assert.notEqual(endIndex, -1, end);
  return source.slice(startIndex, endIndex);
}
```

加入测试：

```js
test("public-share continuation appends without rebuilding mounted cards", () => {
  const loadPublic = sourceBlock(
    albumSource,
    "async loadPublicAlbum() {",
    "resetPublicSharePagination() {"
  );
  const resetPagination = sourceBlock(
    albumSource,
    "resetPublicSharePagination() {",
    "async loadMorePublicAlbum() {"
  );
  const loadMore = sourceBlock(
    albumSource,
    "async loadMorePublicAlbum() {",
    "retryAlbumLoad() {"
  );
  assert.match(albumSource, /publicShareLoadedPageCount: 0/);
  assert.match(loadPublic, /this\.publicShareLoadedPageCount = 1/);
  assert.match(resetPagination, /this\.publicShareLoadedPageCount = 0/);
  assert.match(
    loadMore,
    /this\.appendPublicAlbumWaterfallPhotos\(merged\.appendedPhotos\)/
  );
  assert.doesNotMatch(loadMore, /this\.refreshWaterfall\(\)/);
  assert.doesNotMatch(loadMore, /\.clear\(\)/);
  assert.doesNotMatch(loadMore, /waterfallPhotos\s*=\s*\[\]/);
  assert.doesNotMatch(loadMore, /pageScrollTo/);
  assert.match(loadMore, /this\.publicShareLoadedPageCount \+= 1/);
  assert.match(loadMore, /this\.albumMediaRefresh\?\.schedule\(\)/);
});
```

- [ ] **Step 3: Tighten the D54 static gate before production code**

在 `scripts/d54-public-album-full-share-pagination-check.js` 的 helper 断言后加入：

```js
const loadMorePublicAlbum = between(
  albumPage,
  "async loadMorePublicAlbum() {",
  "retryAlbumLoad() {",
  "public pagination append path"
);
assert(
  helper.includes("appendedPhotos")
    && loadMorePublicAlbum.includes(
      "this.appendPublicAlbumWaterfallPhotos(merged.appendedPhotos)"
    ),
  "D54 continuation loading must append only newly merged media"
);
for (const forbidden of [
  "this.refreshWaterfall()",
  ".clear()",
  "waterfallPhotos = []",
  "pageScrollTo"
]) {
  assert(
    !loadMorePublicAlbum.includes(forbidden),
    `D54 continuation loading must not use destructive scroll recovery: ${forbidden}`
  );
}
```

- [ ] **Step 4: Run the focused test and gate and verify RED**

Run:

```bash
node --test --test-name-pattern='appends unique media|without rebuilding mounted cards' apps/miniprogram/test/albumPublicSharePagination.test.mjs
node scripts/d54-public-album-full-share-pagination-check.js
```

Expected: both commands FAIL because `appendedPhotos` and `appendPublicAlbumWaterfallPhotos()` do not yet exist, and `loadMorePublicAlbum()` still calls `refreshWaterfall()`.

- [ ] **Step 5: Return the complete list and the unique incoming tail**

用以下实现替换 `mergePublicAlbumSharePages()`：

```js
export function mergePublicAlbumSharePages(current = [], incoming = [], page = {}) {
  const photos = [];
  const appendedPhotos = [];
  const seen = new Set();
  const append = (photo, incomingPhoto) => {
    if (!validMedia(photo) || seen.has(Number(photo.id))) return;
    seen.add(Number(photo.id));
    photos.push(photo);
    if (incomingPhoto) appendedPhotos.push(photo);
  };
  for (const photo of Array.isArray(current) ? current : []) {
    append(photo, false);
  }
  for (const photo of Array.isArray(incoming) ? incoming : []) {
    append(photo, true);
  }
  const nextCursor = page?.has_more === true
    ? nonEmptyText(page?.next_cursor)
    : null;
  return {
    photos,
    appendedPhotos,
    nextCursor,
    hasMore: Boolean(nextCursor)
  };
}
```

- [ ] **Step 6: Track the loaded prefix and add an append-only page method**

在 `album.vue` 的公开分页状态中加入：

```js
publicShareLoadedPageCount: 0,
```

在 `resetPublicSharePagination()` 中加入：

```js
this.publicShareLoadedPageCount = 0;
```

在 `loadPublicAlbum()` 成功读取首屏后加入：

```js
this.publicShareLoadedPageCount = 1;
```

在 `album.vue` 的 `refreshWaterfall()` 前加入：

```js
appendPublicAlbumWaterfallPhotos(photos = []) {
  const appended = (Array.isArray(photos) ? photos : [])
    .map((photo) => ({ ...photo }));
  if (appended.length === 0) return;
  this.waterfallPhotos = [...this.waterfallPhotos, ...appended];
},
```

`uv-waterfall` 会只处理新模型相对旧模型增加的尾部；现有 `changeWaterfallList()` 会在每张新卡片完成分列后更新可见性观察。

- [ ] **Step 7: Replace the destructive pagination refresh**

在 `loadMorePublicAlbum()` 成功路径中保留 `this.photos`、游标和错误状态写入，把：

```js
this.refreshWaterfall();
```

替换为：

```js
this.publicShareLoadedPageCount += 1;
this.appendPublicAlbumWaterfallPhotos(merged.appendedPhotos);
this.albumMediaRefresh?.schedule();
```

即使这一页全是重复媒体、`appendedPhotos` 为空，只要响应成功，也必须推进页数和游标；重新 schedule 可让新页中更早过期的签名 URL 纳入刷新计时。

- [ ] **Step 8: Run focused and D54 regression tests**

Run:

```bash
node --test apps/miniprogram/test/albumPublicSharePagination.test.mjs
npm run d54:unit
npm run d54:check
```

Expected: PASS。若 `d54:unit` 的 API 子测试在受限环境因 loopback 报 `EPERM`，使用批准的测试权限重跑。

- [ ] **Step 9: Commit incremental pagination**

```bash
git add apps/miniprogram/test/albumPublicSharePagination.test.mjs apps/miniprogram/src/utils/albumPublicSharePagination.js apps/miniprogram/src/pages/session/album.vue scripts/d54-public-album-full-share-pagination-check.js
git diff --cached --check
git commit -m "fix(miniprogram): append public album pages in place"
```

## Task 4: Reload the currently loaded public prefix

**Files:**

- Modify: `apps/miniprogram/test/albumPublicSharePagination.test.mjs`
- Modify: `apps/miniprogram/src/utils/albumPublicSharePagination.js`

- [ ] **Step 1: Add a multi-page refresh test**

加入：

```js
test("public-share refresh reloads the currently loaded prefix and keeps the last cursor", async () => {
  const cursors = [];
  const pages = new Map([
    [null, {
      photos: [{ id: 1 }, { id: 2 }],
      next_cursor: "cursor-2",
      has_more: true,
      visible_count: 5
    }],
    ["cursor-2", {
      photos: [{ id: 3 }, { id: 4 }],
      next_cursor: "cursor-3",
      has_more: true
    }]
  ]);
  const refreshed = await pagination.reloadPublicAlbumSharePrefix({
    pageCount: 2,
    loadPage: async ({ cursor }) => {
      cursors.push(cursor);
      return pages.get(cursor);
    }
  });

  assert.deepEqual(cursors, [null, "cursor-2"]);
  assert.equal(refreshed.firstPage.visible_count, 5);
  assert.deepEqual(refreshed.photos.map(({ id }) => id), [1, 2, 3, 4]);
  assert.equal(refreshed.nextCursor, "cursor-3");
  assert.equal(refreshed.hasMore, true);
  assert.equal(refreshed.loadedPageCount, 2);
});

test("public-share refresh discards a stale partial prefix", async () => {
  const refreshed = await pagination.reloadPublicAlbumSharePrefix({
    pageCount: 2,
    loadPage: async ({ pageIndex }) => (
      pageIndex === 0
        ? {
            photos: [{ id: 1 }, { id: 2 }],
            next_cursor: "cursor-2",
            has_more: true
          }
        : null
    )
  });
  assert.equal(refreshed, null);
});
```

- [ ] **Step 2: Add ID-sequence and row-replacement tests**

加入：

```js
test("public-share refresh distinguishes field updates from media-set changes", () => {
  assert.equal(
    pagination.samePublicAlbumMediaSequence(
      [{ id: 1 }, { id: 2 }],
      [{ id: "1" }, { id: 2, preview_display_url: "new" }]
    ),
    true
  );
  assert.equal(
    pagination.samePublicAlbumMediaSequence(
      [{ id: 1 }, { id: 2 }],
      [{ id: 2 }, { id: 1 }]
    ),
    false
  );
  assert.equal(
    pagination.samePublicAlbumMediaSequence(
      [{ id: 1 }, { id: 2 }],
      [{ id: 1 }]
    ),
    false
  );

  const refreshedPhotos = [
    { id: 1, preview_display_url: "new-1" },
    { id: 2, preview_display_url: "new-2" }
  ];
  assert.deepEqual(
    pagination.replacePublicAlbumMediaRows(
      [{ id: 2, preview_display_url: "old-2" }],
      refreshedPhotos
    ),
    [refreshedPhotos[1]]
  );
});
```

- [ ] **Step 3: Run the helper tests and verify RED**

Run:

```bash
node --test --test-name-pattern='refresh reloads|stale partial prefix|distinguishes field updates' apps/miniprogram/test/albumPublicSharePagination.test.mjs
```

Expected: FAIL because all three exported helpers are missing.

- [ ] **Step 4: Add exact-sequence and row replacement helpers**

在 `albumPublicSharePagination.js` 加入：

```js
export function samePublicAlbumMediaSequence(current = [], refreshed = []) {
  if (!Array.isArray(current) || !Array.isArray(refreshed)) return false;
  if (current.length !== refreshed.length) return false;
  return current.every((photo, index) => (
    validMedia(photo)
    && validMedia(refreshed[index])
    && Number(photo.id) === Number(refreshed[index].id)
  ));
}

export function replacePublicAlbumMediaRows(rows = [], photos = []) {
  const refreshedById = new Map(
    (Array.isArray(photos) ? photos : [])
      .filter(validMedia)
      .map((photo) => [Number(photo.id), photo])
  );
  return (Array.isArray(rows) ? rows : []).map(
    (row) => refreshedById.get(Number(row?.id)) || row
  );
}
```

- [ ] **Step 5: Add a guarded prefix reload loop**

在同一 helper 文件加入：

```js
export async function reloadPublicAlbumSharePrefix({
  pageCount = 1,
  loadPage
} = {}) {
  if (typeof loadPage !== "function") {
    throw new TypeError("loadPage must be a function");
  }
  const requestedPageCount = Number(pageCount);
  const targetPageCount =
    Number.isSafeInteger(requestedPageCount) && requestedPageCount > 0
      ? requestedPageCount
      : 1;
  let firstPage = null;
  let photos = [];
  let nextCursor = null;
  let hasMore = true;
  let loadedPageCount = 0;

  while (
    loadedPageCount < targetPageCount
    && (loadedPageCount === 0 || hasMore)
  ) {
    const page = await loadPage({
      pageIndex: loadedPageCount,
      cursor: loadedPageCount === 0 ? null : nextCursor
    });
    if (page === null) return null;
    if (!page || typeof page !== "object") {
      throw new Error("Invalid public album refresh page");
    }
    if (firstPage === null) firstPage = page;
    const merged = mergePublicAlbumSharePages(photos, page.photos, page);
    photos = merged.photos;
    nextCursor = merged.nextCursor;
    hasMore = merged.hasMore;
    loadedPageCount += 1;
  }

  return {
    firstPage,
    photos,
    nextCursor,
    hasMore,
    loadedPageCount
  };
}
```

该循环始终至少读取第一页，并按已成功加载的页数重走服务端最新游标链。任何一页被请求 authority 判为过期并返回 `null` 时，整个前缀结果作废，不写入部分数据。

- [ ] **Step 6: Run the helper suite**

Run:

```bash
node --test apps/miniprogram/test/albumPublicSharePagination.test.mjs
```

Expected: PASS。

- [ ] **Step 7: Commit refresh helpers**

```bash
git add apps/miniprogram/test/albumPublicSharePagination.test.mjs apps/miniprogram/src/utils/albumPublicSharePagination.js
git diff --cached --check
git commit -m "feat(miniprogram): reload loaded public album prefix"
```

## Task 5: Patch background refreshes without rebuilding unchanged cards

**Files:**

- Modify: `apps/miniprogram/test/albumPublicSharePagination.test.mjs`
- Modify: `apps/miniprogram/src/pages/session/album.vue`

- [ ] **Step 1: Add the page integration contract**

加入：

```js
test("public background refresh keeps the waterfall mounted for the same media sequence", () => {
  const controller = sourceBlock(
    albumSource,
    "initializeAlbumMediaRefreshController() {",
    "async loadAlbum() {"
  );
  const writer = sourceBlock(
    controller,
    "writeAlbum: (next) => {",
    "reloadAlbum: async () => {"
  );
  assert.match(writer, /samePublicAlbumMediaSequence\(this\.photos, nextPhotos\)/);
  assert.match(
    writer,
    /if \(publicSequenceUnchanged\) \{\s*this\.updatePublicAlbumWaterfallRows\(nextPhotos\);\s*\} else \{\s*this\.refreshWaterfall\(\);\s*\}/
  );
  assert.match(controller, /this\.reloadLoadedPublicAlbumPrefix\(listRequest\)/);
  assert.match(
    controller,
    /this\.publicShareLoadedPageCount = publicRefresh\.loadedPageCount/
  );
  assert.match(controller, /this\.publicShareLoadingMore = false/);
  assert.match(albumSource, /reloadPublicAlbumSharePrefix\(\{/);
  assert.match(albumSource, /replacePublicAlbumMediaRows/);
});
```

- [ ] **Step 2: Run the integration contract and verify RED**

Run:

```bash
node --test --test-name-pattern='background refresh keeps the waterfall mounted' apps/miniprogram/test/albumPublicSharePagination.test.mjs
```

Expected: FAIL because the page still reloads only page one and unconditionally calls `refreshWaterfall()`.

- [ ] **Step 3: Import the refresh helpers**

把 `album.vue` 的分页 helper import 改为：

```js
import {
  mergePublicAlbumSharePages,
  publicAlbumSharePageUrl,
  reloadPublicAlbumSharePrefix,
  replacePublicAlbumMediaRows,
  samePublicAlbumMediaSequence
} from "../../utils/albumPublicSharePagination";
```

- [ ] **Step 4: Add a component method that reloads the loaded prefix under one authority**

在 `initializeAlbumMediaRefreshController()` 前加入：

```js
async reloadLoadedPublicAlbumPrefix(listRequest) {
  return reloadPublicAlbumSharePrefix({
    pageCount: Math.max(1, this.publicShareLoadedPageCount),
    loadPage: async ({ cursor }) => {
      const url = cursor
        ? publicAlbumSharePageUrl({
            sessionId: this.sessionId,
            token: this.albumShareToken,
            cursor
          })
        : `/api/sessions/${this.sessionId}/album/public-share${queryString({
            token: this.albumShareToken
          })}`;
      if (!url) {
        throw new Error("Invalid public album refresh URL");
      }
      const response = await request({ url, suppressMaintenance: true });
      if (!this.isCurrentAlbumListRequest(listRequest)) {
        return null;
      }
      const data = dataOf(response) || {};
      return {
        ...data,
        photos: (data.photos || []).map((photo) => this.normalizePhotoMedia(photo))
      };
    }
  });
},
```

- [ ] **Step 5: Make `reloadAlbum` use the full loaded public prefix**

在 refresh controller 的 `reloadAlbum` 中：

1. `const listRequest = this.beginAlbumListRequest();` 后，把原来公开/成员共用的一次请求改为：

```js
let response = null;
let publicRefresh = null;
if (this.timelineMode) {
  publicRefresh = await this.reloadLoadedPublicAlbumPrefix(listRequest);
  if (publicRefresh === null) {
    return null;
  }
} else {
  response = await request({
    url: `/api/sessions/${this.sessionId}/album`,
    suppressMaintenance: true
  });
}
```

2. 在分支结束后保留既有 `isCurrentAlbumListRequest(listRequest)` 检查；公开模式不得再额外请求一次无 cursor 的第一页。
3. 公开 summary 使用 `publicRefresh.firstPage`：

```js
const data = this.timelineMode
  ? publicRefresh.firstPage
  : dataOf(response) || {};
```

4. 公开分页状态使用最后一张已刷新页面的游标：

```js
this.publicShareNextCursor = publicRefresh.nextCursor;
this.publicShareHasMore = publicRefresh.hasMore;
this.publicShareLoadedPageCount = publicRefresh.loadedPageCount;
this.publicShareLoadingMore = false;
this.publicShareLoadMoreError = "";
```

5. controller 返回的公开照片必须是完整刷新前缀：

```js
return {
  photos: this.timelineMode
    ? publicRefresh.photos
    : (data.photos || []).map((photo) => this.normalizePhotoMedia(photo)),
  isCurrent: () => this.isCurrentAlbumListRequest(listRequest)
};
```

保留既有 summary、封面、分享菜单、错误状态、日志以及 `isCurrent` 检查。

- [ ] **Step 6: Add an in-place waterfall row updater**

在 `appendPublicAlbumWaterfallPhotos()` 后加入：

```js
updatePublicAlbumWaterfallRows(nextPhotos = []) {
  this.waterfallList1 = replacePublicAlbumMediaRows(
    this.waterfallList1,
    nextPhotos
  );
  this.waterfallList2 = replacePublicAlbumMediaRows(
    this.waterfallList2,
    nextPhotos
  );
  this.waterfallPhotos = nextPhotos.map((photo) => ({ ...photo }));
  this.$nextTick(() => this.observeVisiblePhotos());
},
```

该方法不调用 `clear()`，不把任一列表设为空，并保留现有卡片 key 和列归属。

- [ ] **Step 7: Branch the controller writer on the exact media ID sequence**

在 `writeAlbum` 中先规范化并计算：

```js
const nextPhotos = (next.photos || []).map((photo) => this.normalizePhotoMedia(photo));
const publicSequenceUnchanged = this.timelineMode
  && samePublicAlbumMediaSequence(this.photos, nextPhotos);
```

保留成员分享 fingerprint 逻辑、`mediaLoadSerial`、`this.photos = nextPhotos` 和 cache prune，然后把无条件：

```js
this.refreshWaterfall();
```

替换为：

```js
if (publicSequenceUnchanged) {
  this.updatePublicAlbumWaterfallRows(nextPhotos);
} else {
  this.refreshWaterfall();
}
```

当审核、删除或隐私收紧导致 ID 数量或顺序变化时，`publicSequenceUnchanged` 为 false，仍按最新授权结果完整替换；只更新签名 URL、标签文案或其他字段时原位更新。

- [ ] **Step 8: Run background-refresh and existing refresh-controller regressions**

Run:

```bash
node --test apps/miniprogram/test/albumPublicSharePagination.test.mjs
node --test apps/miniprogram/test/albumMediaUrls.test.mjs
node --test apps/miniprogram/test/albumShareEntry.test.mjs
npm run d54:unit
npm run d54:check
```

Expected: PASS。特别确认现有 `member background refresh replaces default sharing only for semantic media changes` 仍通过，证明成员相册刷新行为未被改变。

- [ ] **Step 9: Commit background refresh continuity**

```bash
git add apps/miniprogram/test/albumPublicSharePagination.test.mjs apps/miniprogram/src/pages/session/album.vue
git diff --cached --check
git commit -m "fix(miniprogram): preserve public album cards on media refresh"
```

## Task 6: Reconcile historical specifications and run final verification

**Files:**

- Modify: `specs/d48-album-sharing-role-claim-separation/requirements.md`
- Modify: `specs/d48-album-sharing-role-claim-separation/design.md`
- Modify: `specs/d54-public-album-full-share-pagination/requirements.md`
- Modify: `specs/d54-public-album-full-share-pagination/design.md`

- [ ] **Step 1: Align the D48 DTO contract**

将 D48 Requirement 7.3 改为：

```text
3. WHEN 公开媒体 DTO 返回 THEN DTO SHALL NOT 返回上传者 ID、上传者昵称、其他玩家账号昵称、其他玩家头像、原始标签对象及其关联字段、对象 Key、ETag、原图地址或作者私有字段；DTO MAY 返回已经通过公开资格复核的展示用标签文字数组。
```

将 D48 design 中 `albumMediaResponse(..., { publicShare: true })` 段落改为：

```text
`albumMediaResponse(..., { publicShare: true })` 在 D48 必须把 `tags` 固定为空数组，并继续移除上传者、对象 Key、ETag、作者私有字段、标签关联字段和内部 URL；后续规格允许它为已经通过公开资格复核的媒体单独投影展示用标签文字数组。精确 `start_at` 不再出现在公开 DTO；服务端返回北京时间 `played_on`。标签文字只用于展示，不参与客户端授权。
```

- [ ] **Step 2: Align the D54 privacy and append contracts**

将 D54 Requirement 5.3 改为：

```text
3. WHEN 公开 DTO 返回 THEN SHALL NOT 暴露原始标签对象、标签关联字段、上传者身份或内部快照资格；DTO MAY 返回已经通过公开资格复核的展示用标签文字数组。
```

将 D54 design 的小程序成功路径 bullet 改为：

```text
- 成功时使用 helper 按 ID 去重合并，只把 `appendedPhotos` 增量追加到瀑布流，不清空或重建首屏卡片；
```

并把“小程序新增 helper 只处理三件事”的段落改为：

```text
`apps/miniprogram/src/utils/albumPublicSharePagination.js` 负责构造带 token/cursor 的分页 URL、按媒体 ID 合并并返回本次新增项、规范化后续游标、比较媒体 ID 序列，以及通过注入的 `loadPage` 回调重读已经加载的公开页前缀。它不直接导入网络层或 Vue 状态，保持可独立单元测试。
```

- [ ] **Step 3: Run focused security, sharing, pagination, and build checks**

Run:

```bash
npm run d48:check
npm run d50:unit
npm run d50:check
npm run d54:unit
npm run d54:check
npm run build:mp-weixin
git diff --check
git status --short
```

Expected:

- 所有自动测试、静态门禁和小程序构建 PASS；
- `git diff --check` 无输出；
- `git status --short` 只列出本 Task 的四个规格文件。

- [ ] **Step 4: Commit the reconciled historical specs**

```bash
git add specs/d48-album-sharing-role-claim-separation/requirements.md specs/d48-album-sharing-role-claim-separation/design.md specs/d54-public-album-full-share-pagination/requirements.md specs/d54-public-album-full-share-pagination/design.md
git diff --cached --check
git commit -m "docs: align public album label and append contracts"
```

- [ ] **Step 5: Review the complete branch diff**

Run:

```bash
git status --short
git log --oneline --decorate develop..HEAD
git diff --stat develop...HEAD
git diff --check develop...HEAD
```

Expected: worktree clean；分支只包含设计/计划、API 脱敏标签、客户端标签文案、增量分页、后台前缀刷新、契约门禁和历史规格对齐。

- [ ] **Step 6: Perform the WeChat acceptance check**

在微信开发者工具中使用一个有效、包含超过 30 项媒体的公开相册：

1. 打开公开分享链接，记录首屏前两张卡片的标签和当前滚动位置。
2. 确认图片显示 `照片里：沈清商、阿离`，视频显示 `视频里：沈清商、阿离`，合规未标注图片显示 `待标注`，不再统一显示“其他”。
3. 滚到第一页底部触发下一页；确认 loading 结束后仍停留在原位置附近，新卡片出现在下方，首屏卡片没有闪退或重新挂载。
4. 在已加载两页后触发一次签名 URL 刷新；确认仍保留两页、滚动位置和列分配。
5. 使一个当前媒体在服务端失去公开资格并再次刷新；确认该媒体从列表消失，允许此时按新的授权序列完整重排。
6. 断开网络后触底；确认已有卡片和位置不变，只出现“继续加载失败，可重试”，恢复网络后重试成功。

- [ ] **Step 7: Final verification record**

记录自动命令的实际通过数量和微信开发者工具验收结果；若无法取得有效的超过 30 项分享 token，只把实机项明确标为待用户验收，不得把它表述成已通过。
