# 相册单张照片默认截图快速分享 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留单媒体安全分享凭证和原有落地页，同时删除单图封面准备等待，并让所有未就绪分享状态显示为灰色且不可点击。

**Architecture:** `album.vue` 继续拥有按媒体 ID 隔离的凭证请求和同步分享回调；照片 ready 记录只保存标题、路径和 token，视频仍保留现有明确封面。好友分享 helper 为照片省略 `imageUrl`、为视频保留 `imageUrl`，`AlbumImageViewer.vue` 只渲染 ready 原生分享按钮或无事件的灰色禁用图标。

**Tech Stack:** Vue 3、uni-app 微信小程序、Node.js `node:test`、仓库静态契约检查

---

## 文件职责

- `scripts/d50-album-single-media-sharing-check.js`：锁定单媒体分享关键路径、默认截图 payload 和禁用图标契约。
- `apps/miniprogram/test/albumSingleMediaShare.test.mjs`：覆盖照片默认截图 payload、视频明确封面、状态隔离、单媒体路径及失败关闭 payload。
- `apps/miniprogram/src/utils/albumSingleMediaShare.js`：保留状态机和安全失败 payload，集中构造照片或视频的 ready payload。
- `apps/miniprogram/src/pages/session/album.vue`：请求单媒体 token、只为视频准备封面，并投影分享状态。
- `apps/miniprogram/src/components/AlbumImageViewer.vue`：渲染可用的原生分享按钮或不可交互的灰色分享图标。

### Task 1: 用失败契约锁定快速分享和禁用状态

**Files:**
- Modify: `scripts/d50-album-single-media-sharing-check.js:80-275`
- Modify: `apps/miniprogram/test/albumSingleMediaShare.test.mjs:1-145`

- [ ] **Step 1: 添加照片省略封面、视频保留封面的失败单元测试**

使用文件现有的 `albumSingleMediaShare` namespace，在显式封面归一化测试后增加：

```js
test("omits imageUrl for photo screenshots while retaining an explicit video cover", () => {
  assert.equal(typeof albumSingleMediaShare.singleMediaShareReadyPayload, "function");
  const photoPayload = albumSingleMediaShare.singleMediaShareReadyPayload(
    {
      status: "ready",
      title: "单张照片",
      path: "/pages/session/album?focusMediaId=12"
    },
    "相册"
  );
  assert.deepEqual(photoPayload, {
    title: "单张照片",
    path: "/pages/session/album?focusMediaId=12"
  });
  assert.equal(Object.hasOwn(photoPayload, "imageUrl"), false);

  assert.deepEqual(
    albumSingleMediaShare.singleMediaShareReadyPayload({
      status: "ready",
      title: "单个视频",
      path: "/pages/session/album?focusMediaId=13",
      imageUrl: "wxfile://video-cover.jpg"
    }),
    {
      title: "单个视频",
      path: "/pages/session/album?focusMediaId=13",
      imageUrl: "wxfile://video-cover.jpg"
    }
  );
  assert.equal(
    albumSingleMediaShare.singleMediaShareReadyPayload({ status: "loading", path: "/unsafe" }),
    null
  );
});
```

- [ ] **Step 2: 运行单元测试并确认正确失败**

Run:

```bash
node --test apps/miniprogram/test/albumSingleMediaShare.test.mjs
```

Expected: FAIL at `typeof albumSingleMediaShare.singleMediaShareReadyPayload`，实际值为
`"undefined"`。

- [ ] **Step 3: 修改凭证准备关键路径契约**

把方法边界改为：

```js
const senderPreparation = methodBlock(albumPage, "prepareSingleMediaShare", "showFullPublicAlbum");
```

保留现有 token、`focusMediaId`、响应校验和 authority 顺序断言，并在
`senderPreparation` 断言后增加：

```js
assertOrdered(
  senderPreparation,
  [
    "const imageUrl = this.isImageMedia(photo)",
    '? ""',
    ": await this.prepareSingleMediaShareCardImage(photo);",
    "...(imageUrl ? { imageUrl } : {})"
  ],
  "D50 photos must skip explicit cover preparation while videos retain their cover"
);
assert(
  !senderPreparation.includes("force") &&
    !senderPreparation.includes("showModal("),
  "D50 disabled non-ready share states must not expose a click-driven retry path"
);
```

- [ ] **Step 4: 修改好友分享 payload 契约**

把 helper 导出列表增加 `"singleMediaShareReadyPayload"`。将 `shareCallback` 的完整
顺序断言改为：

```js
assertOrdered(
  shareCallback,
  [
    'options?.from === "button"',
    "options?.target?.dataset?.mediaId",
    "this.singleMediaShareAuthority.entryFor(mediaId)",
    "singleMediaShareReadyPayload(entry, this.albumShareTitle())",
    "if (payload)",
    "return payload"
  ],
  "D50 native button share must read the exact dataset entry and build a media-aware payload"
);
```

在 `buttonShareCallback` 定义后增加：

```js
assert(
  buttonShareCallback.includes("singleMediaShareReadyPayload") &&
    !buttonShareCallback.includes("entry.imageUrl"),
  "D50 button sharing must delegate photo omission and video cover preservation to the payload helper"
);
```

- [ ] **Step 5: 锁定页面状态投影和组件禁用契约**

保留视频 `shareCardPreparation` 方法块断言。把 viewer 图标断言改为：

```js
assert(
  (viewer.match(/src="\/static\/icons\/share-light\.svg"/g) || []).length === 2 &&
    viewer.includes("album-image-viewer__share-icon") &&
    viewer.includes('class="album-image-viewer__icon-button album-image-viewer__icon-button--disabled"') &&
    viewer.includes('aria-disabled="true"') &&
    !viewer.includes("share-status-tap") &&
    !viewer.includes('"准备中"') &&
    !viewer.includes('"不可分享"') &&
    !viewer.includes('"重试分享"'),
  "D50 non-ready viewer share states must use one gray glyph without any interaction"
);
```

把 viewer 顺序断言末尾的 `'share-status-tap'` 删除，并增加：

```js
assert(
  albumPage.includes('if (!this.isSingleMediaShareEligible(this.previewCurrentPhoto))') &&
    albumPage.includes('return "blocked";') &&
    albumPage.includes('?.status || "loading"'),
  "D50 member previews must project ineligible media as blocked and pending eligible media as loading"
);
assert(
  !albumPage.includes('@share-status-tap="handleSingleMediaShareStatusTap"') &&
    !albumPage.includes("handleSingleMediaShareStatusTap(event)"),
  "D50 album page must not retain a click handler for disabled share states"
);
```

- [ ] **Step 6: 运行静态契约并确认正确失败**

Run:

```bash
npm run d50:check
```

Expected: FAIL，错误指出照片尚未跳过 `prepareSingleMediaShareCardImage`，或
`share-status-tap` 仍存在，而不是脚本语法错误。

### Task 2: 删除照片封面等待并实现灰色不可点击状态

**Files:**
- Modify: `apps/miniprogram/src/pages/session/album.vue:559-575`
- Modify: `apps/miniprogram/src/pages/session/album.vue:712-728`
- Modify: `apps/miniprogram/src/pages/session/album.vue:856-868`
- Modify: `apps/miniprogram/src/pages/session/album.vue:1210-1230`
- Modify: `apps/miniprogram/src/pages/session/album.vue:1400-1504`
- Modify: `apps/miniprogram/src/components/AlbumImageViewer.vue:98-135`
- Modify: `apps/miniprogram/src/components/AlbumImageViewer.vue:945-955`
- Modify: `apps/miniprogram/src/utils/albumSingleMediaShare.js:150-180`
- Modify: `apps/miniprogram/test/albumSingleMediaShare.test.mjs:1-130`
- Test: `scripts/d50-album-single-media-sharing-check.js`
- Test: `apps/miniprogram/test/albumSingleMediaShare.test.mjs`

- [ ] **Step 1: 让页面明确投影 hidden、blocked、loading 和 authority 状态**

用以下实现替换 `previewShareStatus`：

```js
previewShareStatus() {
  this.singleMediaShareStateVersion;
  if (this.timelineMode || !this.previewOverlayVisible || !this.previewCurrentPhoto) {
    return "hidden";
  }
  if (!this.isSingleMediaShareEligible(this.previewCurrentPhoto)) {
    return "blocked";
  }
  return (
    this.singleMediaShareAuthority.currentEntry(this.previewCurrentPhoto.id)?.status ||
    "loading"
  );
},
```

这样成员预览中的不合格媒体保持灰色，公开浏览仍隐藏分享入口，符合资格但凭证请求尚未
开始提交到 Vue 渲染时也不会短暂隐藏图标。

- [ ] **Step 2: 只让照片跳过封面准备并缩短 ready 关键路径**

保留 `prepareSingleMediaShareCardImage` 给单视频使用，完整删除
`handleSingleMediaShareStatusTap`。把 `prepareSingleMediaShare` 改为：

```js
async prepareSingleMediaShare(photo) {
  const mediaId = normalizeFocusedMediaId(photo?.id);
  if (!this.isSingleMediaShareEligible(photo) || !mediaId) {
    return null;
  }
  const cachedEntry = this.singleMediaShareAuthority.entryFor(mediaId);
  if (cachedEntry) {
    return cachedEntry;
  }
  const shareRequest = this.singleMediaShareAuthority.begin(mediaId);
  this.singleMediaShareStateVersion += 1;
  if (!shareRequest) {
    return null;
  }
  try {
    const response = await request({
      url: `/api/sessions/${this.sessionId}/album/share-token`,
      method: "POST",
      data: { focusMediaId: mediaId }
    });
    const data = dataOf(response) || {};
    const token = typeof data.token === "string" ? data.token.trim() : "";
    if (normalizeFocusedMediaId(data.focus_media_id) !== mediaId || !token) {
      throw albumMediaError("ALBUM_PUBLIC_SHARE_RESPONSE_INVALID", "当前内容暂时无法分享");
    }
    const path = singleMediaSharePath({
      sessionId: this.sessionId,
      token,
      mediaId
    });
    if (!path) {
      throw albumMediaError("ALBUM_PUBLIC_SHARE_RESPONSE_INVALID", "当前内容暂时无法分享");
    }
    const imageUrl = this.isImageMedia(photo)
      ? ""
      : await this.prepareSingleMediaShareCardImage(photo);
    const entry = this.singleMediaShareAuthority.resolve(shareRequest, {
      title: this.albumShareSessionTitle() || this.albumShareTitle(),
      path,
      token,
      ...(imageUrl ? { imageUrl } : {})
    });
    this.singleMediaShareStateVersion += 1;
    return entry;
  } catch (error) {
    const entry = this.singleMediaShareAuthority.reject(shareRequest, error);
    this.singleMediaShareStateVersion += 1;
    return entry;
  }
},
```

- [ ] **Step 3: 集中构造照片和视频的安全 ready payload**

在 `albumSingleMediaShare.js` 的 `singleMediaShareCardImage` 后增加：

```js
export function singleMediaShareReadyPayload(entry, fallbackTitle = "") {
  if (entry?.status !== "ready" || typeof entry?.path !== "string" || !entry.path.trim()) {
    return null;
  }
  const title =
    typeof entry.title === "string" && entry.title.trim()
      ? entry.title
      : String(fallbackTitle || "").trim();
  const payload = {
    title,
    path: entry.path
  };
  const imageUrl = typeof entry.imageUrl === "string" ? entry.imageUrl.trim() : "";
  return Object.freeze(imageUrl ? { ...payload, imageUrl } : payload);
}
```

把 `singleMediaShareReadyPayload` 加入 `album.vue` import，并把
`onShareAppMessage` 的单媒体分支改为：

```js
const mediaId = normalizeFocusedMediaId(options?.target?.dataset?.mediaId);
const entry = this.singleMediaShareAuthority.entryFor(mediaId);
const payload = singleMediaShareReadyPayload(entry, this.albumShareTitle());
if (payload) {
  return payload;
}
return singleMediaShareFailClosedPayload();
```

照片 entry 没有 `imageUrl`，因此使用微信页面截图；视频 entry 有 `imageUrl`，因此继续
使用明确封面。失败关闭 payload 继续携带安全静态 `imageUrl`。

- [ ] **Step 4: 删除页面禁用图标事件绑定**

从 `<AlbumImageViewer>` 删除：

```vue
@share-status-tap="handleSingleMediaShareStatusTap"
```

保留 `@close`、`@change`、视频、下载和 `primary-action` 绑定。

- [ ] **Step 5: 让预览器的所有非 ready 可见状态不可交互**

把非 ready 分支替换为：

```vue
<view
  v-else-if="shareStatus !== 'hidden' && currentPhoto"
  class="album-image-viewer__icon-button album-image-viewer__icon-button--disabled"
  aria-role="button"
  aria-label="分享不可用"
  aria-disabled="true"
>
  <t-image
    class="album-image-viewer__share-icon"
    src="/static/icons/share-light.svg"
    mode="aspectFit"
    width="32rpx"
    height="32rpx"
  />
</view>
```

并强化禁用样式：

```scss
.album-image-viewer__icon-button--disabled {
  opacity: 0.38;
  pointer-events: none;
}
```

- [ ] **Step 6: 运行定向测试并确认通过**

Run:

```bash
npm run d50:unit
npm run d50:check
```

Expected:

```text
tests ... pass
D50 album single-media sharing checks passed
```

- [ ] **Step 7: 提交单媒体快速分享实现**

```bash
git add scripts/d50-album-single-media-sharing-check.js \
  apps/miniprogram/test/albumSingleMediaShare.test.mjs \
  apps/miniprogram/src/utils/albumSingleMediaShare.js \
  apps/miniprogram/src/pages/session/album.vue \
  apps/miniprogram/src/components/AlbumImageViewer.vue
git commit -m "perf(album): shorten single media share preparation"
```

### Task 3: 构建并验证微信小程序回归

**Files:**
- Verify: `apps/miniprogram/dist/build/mp-weixin/pages/session/album.js`
- Verify: `apps/miniprogram/dist/build/mp-weixin/components/AlbumImageViewer.wxml`
- Verify: `apps/miniprogram/dist/build/mp-weixin/components/AlbumImageViewer.wxss`

- [ ] **Step 1: 检查补丁格式**

Run:

```bash
git diff --check HEAD^
```

Expected: 无输出，退出码为 0。

- [ ] **Step 2: 构建微信小程序**

Run:

```bash
npm run build:mp-weixin
```

Expected: `Build complete`，无编译错误。

- [ ] **Step 3: 运行小程序静态检查**

Run:

```bash
node scripts/check-miniprogram.js
```

Expected: 小程序检查通过；生成产物中的非 ready 分享节点没有 `open-type="share"` 或
点击绑定，ready 节点仍有原生分享属性。

- [ ] **Step 4: 复跑单媒体回归**

Run:

```bash
npm run d50:unit
npm run d50:check
```

Expected: 单媒体单元测试和 D50 静态契约全部通过。

- [ ] **Step 5: 检查最终范围并提交构建产物（仅当仓库跟踪产物）**

Run:

```bash
git status --short
git diff --stat HEAD^
```

Expected: 只出现计划中的源代码、测试和仓库本来就跟踪的微信构建产物；不得暂存用户现有
的 `package-lock.json`、审计图片、设计导出或其他无关改动。如果构建产物受版本控制且
发生变化：

```bash
git add apps/miniprogram/dist/build/mp-weixin
git commit -m "build(miniprogram): refresh single media share artifacts"
```

如果构建产物未被版本控制或没有变化，不创建空提交。

## 微信开发者工具验收

1. 打开成员相册中的一张已发布照片，确认分享图标先灰后白。
2. 凭证准备期间点击灰色图标，确认没有 toast、弹窗或微信分享面板。
3. 图标变白后分享给好友，确认卡片使用当前照片预览页截图。
4. 接收方打开卡片，确认只进入目标媒体，并可点击“查看完整相册”。
5. 断网重新打开照片，确认图标保持灰色且不可点击；恢复网络后关闭并重新打开预览，
   确认可以重新准备。
