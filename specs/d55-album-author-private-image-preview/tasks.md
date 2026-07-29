# D55 相册作者私有图片预览恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让相册图片 finalize 后由上传者立即看到真实图片，并允许“写记录”安全关联本人的作者私有图片，同时保持所有公共读取只展示审核通过的图片。

**Architecture:** 共享包定义完整 `author_only` 媒体投影并在 URL 刷新时关闭式合并；小程序在私有编辑入口额外绑定当前认证用户；API 将“本人可关联”与“公共可读取”拆成两个纯契约，并在事务锁中复核。D46 现有 finalize、短时 capability 与公共泄漏门禁保持不变。

**Tech Stack:** Node.js ESM、`node:test`、UniApp Vue、共享 JavaScript 包、MySQL 8、D46 内容审核与短时媒体 capability。

---

## 文件结构

- Modify: `packages/shared/src/albumMedia.js` — 完整作者媒体投影与权威 URL 合并。
- Modify: `packages/shared/test/albumMedia.test.mjs` — 共享投影和刷新 RED/GREEN 测试。
- Modify: `apps/miniprogram/src/utils/albumMediaUrls.js` — 复用共享投影并绑定当前用户。
- Modify: `apps/miniprogram/test/albumMediaUrls.test.mjs` — 当前用户与刷新控制器测试。
- Modify: `apps/miniprogram/src/utils/sessionReviewPhotos.js` — 评价编辑器图片资格纯函数。
- Modify: `apps/miniprogram/test/sessionReviewPhotos.test.mjs` — 公开/作者私有/非作者资格测试。
- Modify: `apps/miniprogram/src/pages/session/review.vue` — 保存登录用户、显示并自动选择作者私有图片。
- Modify: `apps/miniprogram/test/contentModeration.test.mjs` — 上传与保存页面行为契约。
- Modify: `apps/api/src/modules/core/session-review.js` — 评价图片关联与本人/公共投影纯契约。
- Modify: `apps/api/src/modules/core/service.js` — 事务写入复核和本人评价读取。
- Modify: `apps/api/test/session-review-album-photos.test.mjs` — 服务端纯契约测试。
- Modify: `apps/api/test/content-moderation-user-image-boundaries.test.mjs` — 真实 service 写入边界测试。
- Create: `scripts/d55-album-author-private-image-preview-check.js` — D55 静态隐私契约。
- Modify: `package.json` — `d55:unit`、`d55:check` 和根检查接线。
- Modify: `specs/d55-album-author-private-image-preview/tasks.md` — 实施勾选与验证证据。
- Local deployment config: `.env.production` — 经用户确认后把图片作者私有 gate 设为 true；该忽略文件不得提交。

### Task 1：建立共享作者投影与 URL 合并的 RED/GREEN

**Files:**

- Modify: `packages/shared/test/albumMedia.test.mjs`
- Modify: `packages/shared/src/albumMedia.js`

- [x] **Step 1：先写完整作者投影失败测试**

在 `packages/shared/test/albumMedia.test.mjs` 的 import 中加入
`isAuthorPrivateAlbumMediaProjection`，并增加：

```js
test("author-private projection requires the complete owner-only capability contract", () => {
  const complete = {
    id: 17,
    media_type: "image",
    moderation_status: "pending",
    publication_state: "author_only",
    is_mine: true,
    can_preview: true,
    uploader_user_id: 7
  };
  assert.equal(isAuthorPrivateAlbumMediaProjection(complete), true);
  for (const patch of [
    { publication_state: "hidden" },
    { is_mine: false },
    { can_preview: false },
    { uploader_user_id: 0 },
    { moderation_status: "approved" },
    { media_type: "document" }
  ]) {
    assert.equal(isAuthorPrivateAlbumMediaProjection({ ...complete, ...patch }), false);
  }
});
```

- [x] **Step 2：运行测试并确认按预期失败**

Run:

```bash
node --test packages/shared/test/albumMedia.test.mjs
```

Expected: FAIL，指出 `isAuthorPrivateAlbumMediaProjection` 尚未导出。

- [x] **Step 3：写最小共享投影实现**

在 `isModerationPublished` 后加入：

```js
const AUTHOR_PRIVATE_MEDIA_STATUSES = new Set([
  "pending",
  "processing",
  "error",
  "review",
  "rejected"
]);

export function isAuthorPrivateAlbumMediaProjection(photo = {}) {
  const uploaderUserId = Number(photo?.uploader_user_id);
  return (
    photo?.publication_state === "author_only" &&
    photo?.is_mine === true &&
    photo?.can_preview === true &&
    Number.isSafeInteger(uploaderUserId) &&
    uploaderUserId > 0 &&
    ["image", "video"].includes(String(photo?.media_type || "")) &&
    !isModerationPublished(photo?.moderation_status) &&
    AUTHOR_PRIVATE_MEDIA_STATUSES.has(String(photo?.moderation_status || ""))
  );
}
```

- [x] **Step 4：增加 URL 合并失败测试**

增加以下两个测试：

```js
test("authoritative refresh preserves renewed author-private preview URLs without download", () => {
  const merged = mergeAlbumMediaUrls(
    {
      photos: [{
        id: 17,
        media_type: "image",
        moderation_status: "pending",
        publication_state: "author_only",
        is_mine: true,
        can_preview: true,
        uploader_user_id: 7,
        preview_display_url: "https://old.example/preview",
        thumbnail_display_url: "https://old.example/thumb",
        local_preview_path: "wxfile://visible"
      }]
    },
    {
      photos: [{
        id: 17,
        media_type: "image",
        moderation_status: "pending",
        publication_state: "author_only",
        is_mine: true,
        can_preview: true,
        uploader_user_id: 7,
        preview_display_url: "https://new.example/preview",
        thumbnail_display_url: "https://new.example/thumb",
        download_url: "https://must-not-survive.example/download",
        media_url_expires_at: "2026-07-29T12:00:00.000Z"
      }]
    }
  );
  assert.equal(merged.photos[0].preview_display_url, "https://new.example/preview");
  assert.equal(merged.photos[0].thumbnail_display_url, "https://new.example/thumb");
  assert.equal(merged.photos[0].local_preview_path, "wxfile://visible");
  assert.equal("download_url" in merged.photos[0], false);
});

test("authoritative refresh strips unpublished URLs from new and existing ordinary rows", () => {
  const merged = mergeAlbumMediaUrls(
    {
      photos: [{
        id: 1,
        moderation_status: "approved",
        preview_display_url: "https://old.example/approved"
      }]
    },
    {
      photos: [
        { id: 1, moderation_status: "pending", preview_display_url: "https://bad.example/old" },
        { id: 2, moderation_status: "pending", preview_display_url: "https://bad.example/new" }
      ]
    }
  );
  assert.deepEqual(merged.photos, [
    { id: 1, moderation_status: "pending" },
    { id: 2, moderation_status: "pending" }
  ]);
});
```

- [x] **Step 5：运行测试并确认第二个 RED**

Run:

```bash
node --test packages/shared/test/albumMedia.test.mjs
```

Expected: FAIL；合法 `author_only` URL 被删除，且新普通 pending 行仍保留 URL。

- [x] **Step 6：实现关闭式合并**

将 `mergeMediaCollection` 改为始终清洗每个 refreshed 行：

```js
function mergeMediaCollection(currentItems = [], refreshedItems = []) {
  const currentById = new Map(currentItems.map((item) => [Number(item.id), item]));
  return refreshedItems.map((refreshed) => {
    const current = currentById.get(Number(refreshed.id));
    const next = current ? { ...current, ...refreshed } : { ...refreshed };
    if (isAuthorPrivateAlbumMediaProjection(refreshed)) {
      delete next.download_url;
      return next;
    }
    if (!isModerationPublished(refreshed.moderation_status)) {
      for (const field of [...URL_FIELDS, ...LOCAL_MEDIA_FIELDS]) {
        delete next[field];
      }
    }
    return next;
  });
}
```

- [x] **Step 7：运行共享测试并确认 GREEN**

Run:

```bash
node --test packages/shared/test/albumMedia.test.mjs
```

Expected: PASS，原公开撤销测试与新增作者刷新测试全部通过。

### Task 2：绑定小程序当前用户并验证刷新控制器

**Files:**

- Modify: `apps/miniprogram/src/utils/albumMediaUrls.js`
- Modify: `apps/miniprogram/test/albumMediaUrls.test.mjs`

- [x] **Step 1：写共享投影复用与身份失败测试**

在 `albumMediaUrls.test.mjs` 增加：

```js
test("author-private album media additionally requires the current viewer id", () => {
  const photo = {
    id: 17,
    media_type: "image",
    moderation_status: "pending",
    publication_state: "author_only",
    is_mine: true,
    can_preview: true,
    uploader_user_id: 7
  };
  assert.equal(albumMediaUrlHelpers.isAuthorPrivateAlbumMedia(photo, 7), true);
  assert.equal(albumMediaUrlHelpers.isAuthorPrivateAlbumMedia(photo, 8), false);
  assert.equal(
    albumMediaUrlHelpers.isAuthorPrivateAlbumMedia({ ...photo, can_preview: false }, 7),
    false
  );
});

test("refresh controller keeps renewed author-private preview capabilities", async () => {
  let album = {
    photos: [{
      id: 17,
      media_type: "image",
      moderation_status: "pending",
      publication_state: "author_only",
      is_mine: true,
      can_preview: true,
      uploader_user_id: 7,
      preview_display_url: "old"
    }]
  };
  const controller = createAlbumMediaRefreshController({
    readAlbum: () => album,
    writeAlbum: (next) => { album = next; },
    reloadAlbum: async () => ({
      photos: [{
        ...album.photos[0],
        preview_display_url: "new",
        thumbnail_display_url: "new-thumb",
        media_url_expires_at: "2026-07-29T12:00:00.000Z"
      }]
    }),
    setTimer: () => 1,
    clearTimer: () => {}
  });
  await controller.refresh();
  assert.equal(album.photos[0].preview_display_url, "new");
  assert.equal(album.photos[0].thumbnail_display_url, "new-thumb");
});
```

- [x] **Step 2：运行测试并确认当前实现未复用共享契约**

Run:

```bash
node --test apps/miniprogram/test/albumMediaUrls.test.mjs
```

Expected: 至少刷新 capability 测试 FAIL。

- [x] **Step 3：复用共享投影**

把 import 改为：

```js
import {
  createSingleFlight,
  isAuthorPrivateAlbumMediaProjection,
  isModerationPublished,
  mergeAlbumMediaUrls,
  shouldRefreshAlbumMedia
} from "@pinche/shared";
```

将 `isAuthorPrivateAlbumMedia` 的重复状态判断替换为：

```js
export function isAuthorPrivateAlbumMedia(photo = {}, viewerUserId) {
  return (
    isAuthorPrivateAlbumMediaProjection(photo) &&
    samePositiveUserId(photo?.uploader_user_id, viewerUserId)
  );
}
```

- [x] **Step 4：运行小程序媒体测试并确认 GREEN**

Run:

```bash
node --test apps/miniprogram/test/albumMediaUrls.test.mjs
```

Expected: PASS。

### Task 3：让“写记录”显示和选择本人作者私有图片

**Files:**

- Modify: `apps/miniprogram/src/utils/sessionReviewPhotos.js`
- Modify: `apps/miniprogram/test/sessionReviewPhotos.test.mjs`
- Modify: `apps/miniprogram/src/pages/session/review.vue`
- Modify: `apps/miniprogram/test/contentModeration.test.mjs`

- [x] **Step 1：写评价图片资格 RED**

在 `sessionReviewPhotos.test.mjs` import
`isSelectableSessionReviewAlbumPhoto` 并加入：

```js
test("review picker accepts public images and the current uploader's author-private image", () => {
  const base = {
    id: 31,
    media_type: "image",
    status: "active",
    processing_status: "ready"
  };
  assert.equal(
    isSelectableSessionReviewAlbumPhoto({ ...base, moderation_status: "approved" }, 7),
    true
  );
  assert.equal(isSelectableSessionReviewAlbumPhoto({
    ...base,
    moderation_status: "pending",
    publication_state: "author_only",
    is_mine: true,
    can_preview: true,
    uploader_user_id: 7
  }, 7), true);
});

test("review picker rejects ordinary pending and another user's author-private image", () => {
  const pending = {
    id: 31,
    media_type: "image",
    status: "active",
    processing_status: "ready",
    moderation_status: "pending"
  };
  assert.equal(isSelectableSessionReviewAlbumPhoto(pending, 7), false);
  assert.equal(isSelectableSessionReviewAlbumPhoto({
    ...pending,
    publication_state: "author_only",
    is_mine: true,
    can_preview: true,
    uploader_user_id: 8
  }, 7), false);
  assert.equal(isSelectableSessionReviewAlbumPhoto({
    ...pending,
    media_type: "video",
    publication_state: "author_only",
    is_mine: true,
    can_preview: true,
    uploader_user_id: 7
  }, 7), false);
});
```

- [x] **Step 2：运行并确认导出缺失**

Run:

```bash
node --test apps/miniprogram/test/sessionReviewPhotos.test.mjs
```

Expected: FAIL，指出 helper 尚未导出。

- [x] **Step 3：实现纯资格 helper**

在 `sessionReviewPhotos.js` 增加 imports：

```js
import { isModerationPublished } from "@pinche/shared";
import { isAuthorPrivateAlbumMedia } from "./albumMediaUrls.js";
```

并增加：

```js
export function isSelectableSessionReviewAlbumPhoto(photo, viewerUserId) {
  return Boolean(
    photo &&
    Number(photo.id) > 0 &&
    photo.media_type !== "video" &&
    String(photo.status || "active") === "active" &&
    String(photo.processing_status || "ready") === "ready" &&
    (
      isModerationPublished(photo.moderation_status) ||
      isAuthorPrivateAlbumMedia(photo, viewerUserId)
    )
  );
}
```

- [x] **Step 4：运行 helper 测试并确认 GREEN**

Run:

```bash
node --test apps/miniprogram/test/sessionReviewPhotos.test.mjs
```

Expected: PASS。

- [x] **Step 5：先写页面接线 RED 契约**

在 `contentModeration.test.mjs` 将旧测试名调整为：

```text
review save still blocks unpreviewable ordinary pending album photos
```

并新增源码契约：

```js
test("review page binds author-private album eligibility to the authenticated user", async () => {
  const source = await readFile(new URL("../src/pages/session/review.vue", import.meta.url), "utf8");
  assert.match(source, /currentUserId:\s*""/);
  assert.match(source, /this\.currentUserId\s*=\s*auth\.user\.id/);
  assert.match(source, /isSelectableSessionReviewAlbumPhoto\(photo,\s*this\.currentUserId\)/);
});

test("phone upload selects a previewable author-private photo instead of counting it pending", async () => {
  const source = await readFile(new URL("../src/pages/session/review.vue", import.meta.url), "utf8");
  const uploadBody = extractMethodBody(source, "async uploadChosenPhotos(items)");
  assert.match(uploadBody, /if \(this\.isSelectableAlbumPhoto\(photo\)\)/);
  assert.match(uploadBody, /toggleSessionReviewAlbumPhoto/);
  assert.match(uploadBody, /this\.pendingPhotoCount \+= 1/);
});
```

- [x] **Step 6：运行页面契约并确认 RED**

Run:

```bash
node --test apps/miniprogram/test/contentModeration.test.mjs
```

Expected: FAIL，缺少 `currentUserId` 与新 helper 接线。

- [x] **Step 7：修改 `review.vue`**

将 shared import 删除，改为从 `sessionReviewPhotos` 引入：

```js
isSelectableSessionReviewAlbumPhoto
```

data 增加：

```js
currentUserId: ""
```

登录成功后增加：

```js
this.currentUserId = auth.user.id || "";
```

方法委托：

```js
isSelectableAlbumPhoto(photo) {
  return isSelectableSessionReviewAlbumPhoto(photo, this.currentUserId);
}
```

保留现有上传循环结构，使完整作者图片进入成功分支并自动选中；普通 pending 仍增加 `pendingPhotoCount`。

- [x] **Step 8：运行评价小程序测试并确认 GREEN**

Run:

```bash
node --test \
  apps/miniprogram/test/sessionReviewPhotos.test.mjs \
  apps/miniprogram/test/contentModeration.test.mjs
```

Expected: PASS。

### Task 4：拆分评价“可关联”与“可公开”服务端契约

**Files:**

- Modify: `apps/api/src/modules/core/session-review.js`
- Modify: `apps/api/test/session-review-album-photos.test.mjs`

- [x] **Step 1：写服务端纯契约 RED**

扩充 import：

```js
import {
  isAssociableSessionReviewAlbumPhoto,
  isAuthorPrivateSessionReviewAlbumPhoto,
  isPublishableSessionReviewAlbumPhoto,
  normalizeSessionReviewAlbumPhotoIds,
  projectSessionReviewPhotoRows
} from "../src/modules/core/session-review.js";
```

增加：

```js
const privatePhoto = {
  id: 31,
  session_id: 9,
  uploader_user_id: 7,
  author_visibility_version: 1,
  moderation_status: "pending",
  status: "active",
  media_type: "image",
  processing_status: "ready"
};

test("only the owner may associate a version-one author-private album photo", () => {
  assert.equal(isAuthorPrivateSessionReviewAlbumPhoto(privatePhoto, 7), true);
  assert.equal(isAssociableSessionReviewAlbumPhoto(privatePhoto, 7, false), true);
  assert.equal(isAssociableSessionReviewAlbumPhoto(privatePhoto, 8, true), false);
  assert.equal(
    isAssociableSessionReviewAlbumPhoto({ ...privatePhoto, author_visibility_version: 0 }, 7, true),
    false
  );
});

test("owner projection keeps private ids while public projection keeps no private url or id", () => {
  const rows = [{
    review_id: 61,
    album_photo_id: 31,
    album_photo_status: "active",
    album_photo_moderation_status: "pending",
    album_photo_media_type: "image",
    album_photo_processing_status: "ready",
    album_photo_uploader_user_id: 7,
    album_photo_author_visibility_version: 1
  }];
  assert.deepEqual(projectSessionReviewPhotoRows(rows), new Map([
    [61, { photos: [], albumPhotoIds: [] }]
  ]));
  assert.deepEqual(projectSessionReviewPhotoRows(rows, { ownerUserId: 7 }), new Map([
    [61, { photos: [], albumPhotoIds: [31] }]
  ]));
});

test("public review image byte gate still rejects author-private associations", () => {
  assert.equal(isPublishableSessionReviewAlbumPhoto({
    review_id: 61,
    review_status: "active",
    album_photo_id: 31,
    album_photo_status: "active",
    moderation_status: "pending",
    media_type: "image",
    processing_status: "ready"
  }, 61, 31), false);
});
```

- [x] **Step 2：运行并确认 RED**

Run:

```bash
node --test apps/api/test/session-review-album-photos.test.mjs
```

Expected: FAIL，三个新 helper 尚未导出。

- [x] **Step 3：实现最小服务端纯契约**

在 `session-review.js` import：

```js
import { resolveAuthorVisibility } from "../content-moderation/author-visibility.js";
```

新增统一 ready 判断、作者判断、关联判断和行投影：

```js
function isReadySessionReviewAlbumImage(row, prefix = "") {
  const field = (name) => row?.[`${prefix}${name}`];
  return Boolean(
    String(field("status") || "") === "active" &&
    String(field("media_type") || "image") === "image" &&
    String(field("processing_status") || "ready") === "ready"
  );
}

export function isAuthorPrivateSessionReviewAlbumPhoto(photo, viewerUserId) {
  if (!isReadySessionReviewAlbumImage(photo)) return false;
  return resolveAuthorVisibility({
    viewerUserId,
    authorUserId: photo?.uploader_user_id,
    moderationStatus: photo?.moderation_status,
    authorVisibilityVersion: photo?.author_visibility_version,
    recordStatus: photo?.status,
    contentKind: "image"
  }).scope === "author_only";
}

export function isAssociableSessionReviewAlbumPhoto(photo, viewerUserId, visibleToViewer) {
  if (!isReadySessionReviewAlbumImage(photo)) return false;
  if (isModerationPublished(photo?.moderation_status)) return visibleToViewer === true;
  return isAuthorPrivateSessionReviewAlbumPhoto(photo, viewerUserId);
}

export function projectSessionReviewPhotoRows(rows = [], options = {}) {
  const ownerUserId = Number(options.ownerUserId || 0);
  const photosByReview = new Map();
  for (const row of rows) {
    const reviewId = Number(row.review_id);
    const state = photosByReview.get(reviewId) || { photos: [], albumPhotoIds: [] };
    const albumPhotoId = Number(row.album_photo_id || 0);
    if (albumPhotoId > 0) {
      const photo = {
        id: albumPhotoId,
        status: row.album_photo_status,
        moderation_status: row.album_photo_moderation_status,
        media_type: row.album_photo_media_type,
        processing_status: row.album_photo_processing_status,
        uploader_user_id: row.album_photo_uploader_user_id,
        author_visibility_version: row.album_photo_author_visibility_version
      };
      if (isReadySessionReviewAlbumImage(photo) &&
          isModerationPublished(photo.moderation_status)) {
        state.photos.push(`/api/session-reviews/${reviewId}/photos/${albumPhotoId}/image`);
        state.albumPhotoIds.push(albumPhotoId);
      } else if (ownerUserId > 0 &&
          isAuthorPrivateSessionReviewAlbumPhoto(photo, ownerUserId)) {
        state.albumPhotoIds.push(albumPhotoId);
      }
    } else if (
      row.photo_url &&
      String(row.image_asset_status || "") === "active" &&
      isModerationPublished(row.image_asset_moderation_status)
    ) {
      state.photos.push(row.photo_url);
    }
    photosByReview.set(reviewId, state);
  }
  return photosByReview;
}
```

公开图片同时加入 URL 和 ID；作者私有图片只在 `ownerUserId` 匹配时加入 ID。旧 `photo_url + image_asset` 分支保持不变。

- [x] **Step 4：运行纯契约测试并确认 GREEN**

Run:

```bash
node --test apps/api/test/session-review-album-photos.test.mjs
```

Expected: PASS。

### Task 5：在事务写入和本人读取中使用双视图契约

**Files:**

- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/test/content-moderation-user-image-boundaries.test.mjs`

- [x] **Step 1：写 service 写入 RED**

在 `content-moderation-user-image-boundaries.test.mjs` 增加：

```js
function reviewAlbumConnection({
  uploaderUserId = 7,
  authorVisibilityVersion = 1,
  moderationStatus = "pending"
} = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (text.includes("review_eligible_at") && text.includes("FROM signups")) {
        return [[{
          id: 4,
          seat_id: 5,
          review_eligible_at: "2026-07-17T00:00:00.000Z",
          session_start_at: "2026-07-16T00:00:00.000Z",
          signup_status: "confirmed",
          seat_status: "occupied"
        }]];
      }
      if (text.includes("SELECT * FROM sessions WHERE id = ?")) {
        return [[{ id: 9, created_by_user_id: 7, status: "published" }]];
      }
      if (text.includes("FROM session_album_photos") && text.includes("WHERE id IN")) {
        return [[{
          id: 31,
          session_id: 9,
          uploader_user_id: uploaderUserId,
          author_visibility_version: authorVisibilityVersion,
          moderation_status: moderationStatus,
          status: "active",
          media_type: "image",
          processing_status: "ready"
        }]];
      }
      if (text.includes("INSERT INTO session_reviews")) return [{ insertId: 61 }];
      if (text.includes("SELECT *") && text.includes("FROM session_reviews")) {
        return [[{ id: 61, session_id: 9, user_id: 7 }]];
      }
      if (text.includes("SELECT image_asset_id") && text.includes("session_review_photos")) {
        return [[]];
      }
      if (/^\s*SELECT\b/i.test(text)) return [[]];
      return [{ affectedRows: 1, insertId: 1 }];
    }
  };
}
```

并增加测试：

```js
test("review may associate the current user's version-one author-private album photo", async () => {
  const connection = reviewAlbumConnection({ uploaderUserId: 7, authorVisibilityVersion: 1 });
  const result = await upsertMySessionReviewWithConnection(
    connection,
    { user: { id: 7 } },
    9,
    { rating: 5, content: "", albumPhotoIds: [31] }
  );
  const insert = connection.calls.find((call) =>
    call.sql.includes("INSERT INTO session_review_photos")
  );
  assert.deepEqual(insert.params, [61, 31, 0]);
  assert.deepEqual(result.photos, []);
  assert.deepEqual(result.album_photo_ids, [31]);
});

test("review rejects another user's or version-zero pending album photo before business write", async () => {
  for (const options of [
    { uploaderUserId: 8, authorVisibilityVersion: 1 },
    { uploaderUserId: 7, authorVisibilityVersion: 0 }
  ]) {
    const connection = reviewAlbumConnection(options);
    await assert.rejects(
      upsertMySessionReviewWithConnection(
        connection,
        { user: { id: 7 } },
        9,
        { rating: 5, content: "", albumPhotoIds: [31] }
      ),
      { code: "BAD_REQUEST" }
    );
    assert.equal(
      connection.calls.some((call) => call.sql.includes("INSERT INTO session_reviews")),
      false
    );
  }
});
```

- [x] **Step 2：运行并确认 approved-only 校验导致 RED**

Run:

```bash
node --test apps/api/test/content-moderation-user-image-boundaries.test.mjs
```

Expected: FAIL，当前错误为 `albumPhotoIds must reference visible approved photos`。

- [x] **Step 3：接线写入资格**

从 `session-review.js` import：

```js
isAssociableSessionReviewAlbumPhoto,
projectSessionReviewPhotoRows
```

在事务锁定图片后先计算现有 `isVisibleByAlbumPrivacy`，再把原 approved-only 条件替换为：

```js
!isAssociableSessionReviewAlbumPhoto(
  photo,
  user.user.id,
  isVisibleByAlbumPrivacy
)
```

错误文案改为不声称必须公开：

```text
albumPhotoIds must reference usable photos from this session album
```

构造写入响应时：

```js
photos: albumPhotos
  .filter((photo) => isModerationPublished(photo.moderation_status))
  .map((photo) => `/api/session-reviews/${Number(review.id)}/photos/${Number(photo.id)}/image`),
albumPhotoIds: albumPhotos.map((photo) => Number(photo.id))
```

- [x] **Step 4：接线本人/公共读取**

`reviewPhotos` SELECT 增加：

```sql
album.uploader_user_id AS album_photo_uploader_user_id,
album.author_visibility_version AS album_photo_author_visibility_version
```

并用：

```js
return projectSessionReviewPhotoRows(rows, options);
```

调用约束：

```text
listSessionReviews                  reviewPhotos(connection, ids)
getPublicSessionReview              reviewPhotos(connection, ids)
getMySessionReview                  reviewPhotos(connection, ids, { ownerUserId: user.user.id })
```

- [x] **Step 5：运行 API 定向测试并确认 GREEN**

Run:

```bash
node --test \
  apps/api/test/session-review-album-photos.test.mjs \
  apps/api/test/content-moderation-user-image-boundaries.test.mjs \
  apps/api/test/session-review-public.test.mjs
```

Expected: PASS；公共字节门仍拒绝 pending。

### Task 6：建立 D55 静态契约和项目命令

**Files:**

- Create: `scripts/d55-album-author-private-image-preview-check.js`
- Modify: `package.json`

- [x] **Step 1：创建静态检查**

创建：

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

const [
  requirements,
  design,
  tasks,
  sharedMedia,
  reviewPage,
  reviewPhotos,
  coreService
] = await Promise.all([
  text("specs/d55-album-author-private-image-preview/requirements.md"),
  text("specs/d55-album-author-private-image-preview/design.md"),
  text("specs/d55-album-author-private-image-preview/tasks.md"),
  text("packages/shared/src/albumMedia.js"),
  text("apps/miniprogram/src/pages/session/review.vue"),
  text("apps/api/src/modules/core/session-review.js"),
  text("apps/api/src/modules/core/service.js")
]);

for (const document of [requirements, design]) {
  assert.match(document, /版本：v1\.0/);
  assert.match(document, /状态：用户已确认，实施中/);
}
assert.match(tasks, /D55 相册作者私有图片预览恢复 Implementation Plan/);

const published = sharedMedia.match(
  /export function isModerationPublished\(status\) \{[\s\S]*?\n\}/
)?.[0];
assert.equal(
  published,
  'export function isModerationPublished(status) {\n' +
    '  return status === "approved" || status === "approved_legacy";\n' +
    '}'
);
assert.match(sharedMedia, /isAuthorPrivateAlbumMediaProjection\(refreshed\)/);
assert.match(sharedMedia, /delete next\.download_url/);
assert.match(reviewPage, /this\.currentUserId\s*=\s*auth\.user\.id/);
assert.match(
  reviewPage,
  /isSelectableSessionReviewAlbumPhoto\(photo,\s*this\.currentUserId\)/
);
assert.match(coreService, /isAssociableSessionReviewAlbumPhoto\(/);
assert.match(
  coreService,
  /reviewPhotos\(connection,\s*\[Number\(review\.id\)\],\s*\{\s*ownerUserId:\s*user\.user\.id\s*\}\)/
);
assert.match(reviewPhotos, /isPublishableSessionReviewAlbumPhoto[\s\S]*isModerationPublished/);

console.log("D55 album author-private image preview checks passed");
```

- [x] **Step 2：运行检查并确认 GREEN**

Run:

```bash
node scripts/d55-album-author-private-image-preview-check.js
```

Expected: PASS。

- [x] **Step 3：接入根命令**

在 `package.json` scripts 增加：

```json
"d55:unit": "node --test packages/shared/test/albumMedia.test.mjs apps/miniprogram/test/albumMediaUrls.test.mjs apps/miniprogram/test/sessionReviewPhotos.test.mjs apps/api/test/session-review-album-photos.test.mjs apps/api/test/content-moderation-user-image-boundaries.test.mjs",
"d55:check": "node scripts/d55-album-author-private-image-preview-check.js"
```

将 `npm run d55:unit && npm run d55:check` 接入 `precheck`，并让 `check` 保持经 `precheck` 运行该契约。

- [x] **Step 4：运行 D55 命令**

Run:

```bash
npm run d55:unit
npm run d55:check
```

Expected: 全部 PASS。

### Task 7：执行受控本地生产式 gate 启用

**Files:**

- Local ignored config: `.env.production`
- Verify only: `.env.example`
- Verify only: `.env.production.example`
- Verify only: `docker-compose.prod.example.yml`

- [x] **Step 1：确认目标文件被 gitignore 且只改目标键**

Run:

```bash
git check-ignore -v .env.production
rg -n "^CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED=" .env.production
```

Expected: `.env.production` 被 `.gitignore` 忽略，当前值为 false。

- [x] **Step 2：把实际工作区生产配置改为 true**

仅修改：

```dotenv
CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED=true
```

不修改其他凭证、provider、intake、文本或视频 gate。

- [x] **Step 3：验证默认模板仍关闭**

Run:

```bash
rg -n "^CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED=false$" \
  .env.example .env.production.example
```

Expected: 两个模板仍为 false；默认安全策略未改变。

- [x] **Step 4：验证配置解析**

Run:

```bash
node --input-type=module -e '
  import { buildContentModerationConfig } from "./apps/api/src/config/env.js";
  const config = buildContentModerationConfig({
    NODE_ENV: "production",
    CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED: "true",
    CONTENT_MODERATION_AUTHOR_PREVIEW_TTL_SECONDS: "60"
  });
  if (config.authorPrivateImageEnabled !== true || config.authorPreviewTtlSeconds !== 60) {
    process.exit(1);
  }
'
```

Expected: exit 0。

### Task 8：完整验证与任务记录

**Files:**

- Modify: `specs/d55-album-author-private-image-preview/tasks.md`

- [x] **Step 1：运行 D46/D49/D55 定向回归**

Run:

```bash
npm run d46:unit
npm run d46:check
npm run d49:unit
npm run d49:check
npm run d55:unit
npm run d55:check
```

Expected: 全部 PASS。

- [x] **Step 2：运行补充隐私与泄漏回归**

Run:

```bash
node --test \
  apps/api/test/album-image-response-urls.test.mjs \
  apps/api/test/content-moderation-author-media-preview.test.mjs \
  apps/api/test/content-moderation-author-leak-gates.test.mjs \
  apps/api/test/session-review-public.test.mjs \
  apps/miniprogram/test/authorPrivateContent.test.mjs \
  apps/miniprogram/test/contentModeration.test.mjs \
  packages/shared/test/albumMedia.test.mjs
```

Expected: 全部 PASS。

- [x] **Step 3：运行小程序构建**

Run:

```bash
npm --workspace apps/miniprogram run build:mp-weixin
```

Expected: exit 0，无语法或模块解析错误。

- [ ] **Step 4：运行根检查**

Run:

```bash
npm run check
```

Expected: exit 0。

- [x] **Step 5：检查 diff 与用户改动隔离**

Run:

```bash
git diff --check
git status --short
```

Expected: D55 文件无 whitespace 错误；原有 `package-lock.json`、D48 和未跟踪设计/证据文件保持不变。

- [x] **Step 6：记录验证证据**

在本文件末尾追加日期、命令、测试数量、构建结果、未执行的双账号/真实 provider 验收和实际环境 gate 状态。不得把尚未执行的线上验收标为完成。

## 验证证据（2026-07-29）

- `npm run d46:unit`：170/170 PASS；`npm run d46:check`：3/3 与两项静态检查 PASS。
- `npm run d49:unit`：17/17 PASS；`npm run d49:check`：PASS。
- `npm run d55:unit`：63/63 PASS；`npm run d55:check`：PASS。
- 补充隐私与泄漏回归：57/57 PASS，覆盖相册未审核 URL、作者 capability、公共泄漏门、评价公共字节门和小程序审核行为。
- `npm --workspace apps/miniprogram run build:mp-weixin`：exit 0；仅有既存 Sass legacy API / `@import` 弃用警告。
- `npm run check`：未完成为 GREEN。D55 precheck 与前序测试均通过，随后在既有小程序包体积门禁失败：
  `apps/miniprogram/src/static/art/photo-claim-share.jpg` 为 287.5 KB（阈值 200 KB），构建主包为
  1760.6 KB（阈值 1.5 MB）。该源图片来自早期提交 `2719b555`，D55 diff 未修改此文件；本次不越权压缩用户视觉资产。
- `git diff --check`：PASS。D55 实现在隔离 worktree 完成，原工作区既有 `package-lock.json`、D48 与未跟踪设计/证据文件未被 D55 实现覆盖。
- 实际工作区 `.env.production` 已确认受 `.gitignore` 忽略，且仅将
  `CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED` 从 `false` 改为 `true`；`.env.example` 与
  `.env.production.example` 仍为 `false`，配置解析验证 PASS。该本地状态不代表线上已经部署或重启。
- 尚未执行：真实审核 provider、API/Worker 同配置滚动重启、双账号及匿名端到端验收、审核通过/拒绝回调后的线上验证。
