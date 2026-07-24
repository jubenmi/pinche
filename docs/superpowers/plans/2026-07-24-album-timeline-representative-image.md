# Album Timeline Representative Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace full-album Moments Canvas collages with the first usable album media image, preferring an existing local preview and falling back to the current token's public thumbnail.

**Architecture:** Keep the album page on WebView and retain the existing share-token/public-share APIs. A small synchronous utility selects one representative image from `cover_recipe.images`; the album page installs that image into its existing default, active, or public share state, while friend/group payloads continue omitting `imageUrl`.

**Tech Stack:** Vue 3 Options API, uni-app WebView renderer, WeChat share lifecycle, Node.js built-in test runner, existing D48/D55/D56 static gates.

---

### Task 1: Restore the original WebView compiler configuration

**Files:**
- Modify: `apps/miniprogram/package.json`
- Modify: `package-lock.json`
- Modify: `apps/miniprogram/src/pages.json`
- Delete: `apps/miniprogram/test/albumShareSkyline.test.mjs`
- Create: `apps/miniprogram/test/albumShareWebView.test.mjs`

- [ ] **Step 1: Write the failing WebView configuration test**

Create `apps/miniprogram/test/albumShareWebView.test.mjs`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
);
const pagesJson = JSON.parse(
  fs.readFileSync(new URL("../src/pages.json", import.meta.url), "utf8")
);

const ORIGINAL_UNI_VERSION = "3.0.0-5000720260410001";

test("every page keeps the default WebView renderer", () => {
  for (const page of pagesJson.pages) {
    assert.notEqual(page?.style?.renderer, "skyline", page.path);
    assert.notEqual(page?.style?.componentFramework, "glass-easel", page.path);
  }
});

test("uni compiler packages return to the pre-Skyline version", () => {
  for (const name of [
    "@dcloudio/uni-app",
    "@dcloudio/uni-mp-weixin",
    "@dcloudio/vite-plugin-uni"
  ]) {
    assert.equal(packageJson.devDependencies[name], ORIGINAL_UNI_VERSION, name);
  }
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test apps/miniprogram/test/albumShareWebView.test.mjs
```

Expected: two failures because the album page is configured for Skyline and the three compiler
packages use `3.0.0-5010520260709002`.

- [ ] **Step 3: Restore package and page configuration**

Set the three direct compiler packages to:

```json
"@dcloudio/uni-app": "3.0.0-5000720260410001",
"@dcloudio/uni-mp-weixin": "3.0.0-5000720260410001",
"@dcloudio/vite-plugin-uni": "3.0.0-5000720260410001"
```

Remove `renderer` and `componentFramework` from the album page entry. Delete
`albumShareSkyline.test.mjs`, then run:

```bash
npm install
node --test apps/miniprogram/test/albumShareWebView.test.mjs
npm run build:mp-weixin -w @pinche/miniprogram
```

Expected: test 2/2 PASS and production build exit 0.

- [ ] **Step 4: Commit the renderer rollback**

```bash
git add apps/miniprogram/package.json package-lock.json apps/miniprogram/src/pages.json \
  apps/miniprogram/test/albumShareWebView.test.mjs apps/miniprogram/test/albumShareSkyline.test.mjs
git commit -m "build(album): keep sharing on webview"
```

---

### Task 2: Select the first usable representative image

**Files:**
- Modify: `apps/miniprogram/src/utils/albumShareCover.js`
- Replace: `apps/miniprogram/test/albumShareCover.test.mjs`

- [ ] **Step 1: Write failing representative-image tests**

Replace the Canvas-specific cover tests with focused contracts:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  albumShareCoverRecipe,
  albumShareFriendPayload,
  albumShareLocalImagePath,
  albumShareMenus,
  albumShareTimelinePayload,
  selectAlbumShareTimelineImage
} from "../src/utils/albumShareCover.js";

const response = {
  cover_recipe: {
    version: "client-canvas-v1",
    images: [
      { id: 41, thumbnail_url: "/api/thumb/41?token=t" },
      { id: 52, thumbnail_url: "/api/thumb/52?token=t" }
    ]
  }
};

test("representative image prefers the first candidate local preview", () => {
  assert.equal(selectAlbumShareTimelineImage({
    response,
    localPreviewByMediaId: new Map([[41, "wxfile://tmp/41.jpg"]]),
    thumbnailUrlResolver: (url) => `https://api.test${url}`
  }), "wxfile://tmp/41.jpg");
});

test("representative image falls back to the same candidate online thumbnail", () => {
  assert.equal(selectAlbumShareTimelineImage({
    response,
    localPreviewByMediaId: new Map([[41, "https://private.test/41.jpg"]]),
    thumbnailUrlResolver: (url) => `https://api.test${url}`
  }), "https://api.test/api/thumb/41?token=t");
});

test("representative image skips a fully unusable first candidate", () => {
  assert.equal(selectAlbumShareTimelineImage({
    response: {
      cover_recipe: {
        images: [
          { id: 41, thumbnail_url: "" },
          { id: 52, thumbnail_url: "/api/thumb/52?token=t" }
        ]
      }
    },
    localPreviewByMediaId: {},
    thumbnailUrlResolver: (url) => `https://api.test${url}`
  }), "https://api.test/api/thumb/52?token=t");
});

test("only WeChat temporary paths count as local previews", () => {
  assert.equal(albumShareLocalImagePath("wxfile://tmp/cover.jpg"), "wxfile://tmp/cover.jpg");
  assert.equal(albumShareLocalImagePath("http://tmp/cover.jpg"), "http://tmp/cover.jpg");
  assert.equal(albumShareLocalImagePath("/private/tmp/cover.jpg"), "/private/tmp/cover.jpg");
  assert.equal(albumShareLocalImagePath("https://cdn.test/cover.jpg"), "");
  assert.equal(albumShareLocalImagePath("/static/cover.jpg"), "");
});

test("representative image returns empty when no candidate is usable", () => {
  assert.equal(selectAlbumShareTimelineImage({
    response: { cover_recipe: { images: [{ id: 41, thumbnail_url: "" }] } }
  }), "");
});

test("friend payload omits imageUrl and timeline payload requires a real image", () => {
  const friend = albumShareFriendPayload({
    title: "相册",
    path: "/pages/session/album?id=1"
  });
  assert.equal(Object.hasOwn(friend, "imageUrl"), false);
  assert.equal(albumShareTimelinePayload({
    title: "相册",
    query: "id=1",
    imageUrl: ""
  }), null);
  assert.deepEqual(albumShareTimelinePayload({
    title: "相册",
    query: "id=1",
    imageUrl: "https://api.test/thumb.jpg"
  }), {
    title: "相册",
    query: "id=1",
    imageUrl: "https://api.test/thumb.jpg"
  });
});

test("share menu adds Moments only after a representative image is ready", () => {
  assert.deepEqual(albumShareMenus({ token: "t", timelineReady: false }), [
    "shareAppMessage"
  ]);
  assert.deepEqual(albumShareMenus({ token: "t", timelineReady: true }), [
    "shareAppMessage",
    "shareTimeline"
  ]);
  assert.deepEqual(albumShareMenus({ token: "", timelineReady: true }), []);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --test apps/miniprogram/test/albumShareCover.test.mjs
```

Expected: FAIL because `selectAlbumShareTimelineImage` is not exported and timeline payloads still
use static fallbacks.

- [ ] **Step 3: Implement the minimal selector**

Refactor `albumShareCover.js` so it no longer imports `albumShareCanvas.js`. Implement:

```js
function trimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function albumShareLocalImagePath(value) {
  const path = trimmedString(value);
  if (/^http:\/\/tmp(?:\/|$)/i.test(path)) return path;
  return /^(?:wxfile:\/\/|file:\/\/|\/tmp\/|\/private\/|\/var\/)/.test(path)
    ? path
    : "";
}

export function albumShareCoverRecipe(response = {}) {
  const recipe = response?.cover_recipe;
  return recipe && typeof recipe === "object" && !Array.isArray(recipe) ? recipe : null;
}

function localPreview(localPreviewByMediaId, image) {
  const key = String(image?.id || "");
  let value = "";
  if (typeof localPreviewByMediaId === "function") {
    value = localPreviewByMediaId(key, image);
  } else if (localPreviewByMediaId instanceof Map) {
    value = localPreviewByMediaId.get(key) || localPreviewByMediaId.get(Number(key));
  } else if (localPreviewByMediaId && typeof localPreviewByMediaId === "object") {
    value = localPreviewByMediaId[key];
  }
  return albumShareLocalImagePath(value);
}

export function selectAlbumShareTimelineImage({
  response,
  localPreviewByMediaId,
  thumbnailUrlResolver = (url) => url
} = {}) {
  const images = albumShareCoverRecipe(response)?.images;
  if (!Array.isArray(images)) return "";
  for (const image of images) {
    const local = localPreview(localPreviewByMediaId, image);
    if (local) return local;
    const thumbnail = trimmedString(image?.thumbnail_url);
    if (!thumbnail) continue;
    const online = trimmedString(thumbnailUrlResolver(thumbnail, image));
    if (/^https?:\/\//i.test(online)) return online;
  }
  return "";
}
```

Keep `albumShareMenus`, `createAlbumShareRequestAuthority`, and friend payload behavior. Change
`albumShareTimelinePayload` to return `null` when `imageUrl` is neither a valid local temporary path
nor an HTTP(S) URL. Remove fallback constants, Canvas context/digest functions, Canvas preparation
helpers, and static fallback selection.

- [ ] **Step 4: Run cover tests and commit**

```bash
node --test apps/miniprogram/test/albumShareCover.test.mjs
git add apps/miniprogram/src/utils/albumShareCover.js apps/miniprogram/test/albumShareCover.test.mjs
git commit -m "feat(album): select one timeline image"
```

Expected: focused cover tests PASS.

---

### Task 3: Replace the three full-album Canvas flows

**Files:**
- Modify: `apps/miniprogram/src/pages/session/album.vue`
- Modify: `apps/miniprogram/test/albumShareEntry.test.mjs`
- Modify: `apps/miniprogram/test/albumSharePreview.test.mjs`
- Delete: `apps/miniprogram/src/utils/albumShareCanvas.js`
- Delete: `apps/miniprogram/test/albumShareCanvas.test.mjs`

- [ ] **Step 1: Write failing integration contracts**

Update the source-contract tests to require:

```js
assert.doesNotMatch(albumPageSource, /<canvas|canvasToTempFilePath|albumShareCanvas/);
assert.match(albumPageSource, /selectAlbumShareTimelineImage/);

const publicPreparation = sourceBlock(
  "prepareAlbumShareTimelineImage(data) {",
  "resetAlbumShareCovers("
);
assert.match(publicPreparation, /this\.albumShareToken/);
assert.match(publicPreparation, /this\.applyAlbumShareTimelineImage/);

const defaultPreparation = sourceBlock(
  "prepareDefaultAlbumShare() {",
  "handleRecruitShareTap() {"
);
assert.match(defaultPreparation, /selectAlbumShareTimelineImage/);
assert.match(defaultPreparation, /applyDefaultAlbumShareTimelineImage/);

const activePreparation = sourceBlock(
  "async prepareAlbumShareSnapshot(payload) {",
  "openBulkTagSheet() {"
);
assert.match(activePreparation, /selectAlbumShareTimelineImage/);
assert.match(activePreparation, /applyActiveAlbumShareTimelineImage/);

const timeline = sourceBlock("onShareTimeline() {", "watch: {");
assert.match(timeline, /albumShareReadyVisible/);
assert.match(timeline, /activeAlbumShareTimelinePayload\(\)/);
assert.match(timeline, /defaultAlbumShareTimelinePayload\(\)/);
```

Also keep assertions that full-album friend payloads contain no `imageUrl`, and that single-media,
recruitment, and fail-closed payloads retain their explicit images.

- [ ] **Step 2: Run integration tests and verify RED**

```bash
node --test apps/miniprogram/test/albumShareEntry.test.mjs \
  apps/miniprogram/test/albumSharePreview.test.mjs
```

Expected: FAIL because Canvas nodes and preparation still exist.

- [ ] **Step 3: Replace Canvas preparation with synchronous image selection**

In `album.vue`:

1. Remove both hidden `<canvas>` nodes and their styles.
2. Remove all imports from `albumShareCanvas` and Canvas-only cover helpers.
3. Import `albumShareLocalImagePath` and `selectAlbumShareTimelineImage`.
4. Keep only timeline image state:

```js
defaultAlbumShareTimelineCoverUrl: "",
defaultAlbumShareTimelineCoverPrepared: false,
activeAlbumShareTimelineCoverUrl: "",
activeAlbumShareTimelineCoverPrepared: false,
shareTimelineCoverUrl: "",
shareTimelineCoverPrepared: false
```

5. Add a local resolver:

```js
albumShareLocalPreviewByMediaId(mediaId) {
  const visibleMedia = this.visiblePhotoMedia?.[String(mediaId)] || {};
  return (
    albumShareLocalImagePath(visibleMedia.preview) ||
    albumShareLocalImagePath(visibleMedia.thumbnail)
  );
},
selectAlbumShareTimelineImage(data) {
  return selectAlbumShareTimelineImage({
    response: data,
    localPreviewByMediaId: (mediaId) =>
      this.albumShareLocalPreviewByMediaId(mediaId),
    thumbnailUrlResolver: (url) => this.normalizeAlbumMediaUrl(url)
  });
}
```

6. After each default, active, or public token response is confirmed current, synchronously select
   and install its timeline image. Call `showShareMenus()` after installation.
7. Remove Canvas context keys, request authorities used only for cover rendering, coordinator,
   runtime, node, export, disposal, and cover-task awaiting.
8. Keep token/list request currentness checks already guarding the response.

- [ ] **Step 4: Isolate active, default, and public Moments payloads**

Implement `activeAlbumShareTimelinePayload()` and route:

```js
onShareTimeline() {
  if (this.timelineMode) return this.publicAlbumShareTimelinePayload();
  if (this.albumShareReadyVisible && this.activeAlbumShareToken) {
    return this.activeAlbumShareTimelinePayload();
  }
  return this.defaultAlbumShareTimelinePayload();
}
```

Every full-album timeline payload returns `null` without its own token and representative image.
Public focused single-media behavior continues using its corresponding public media image.

- [ ] **Step 5: Delete Canvas code and verify focused tests**

Delete `albumShareCanvas.js` and `albumShareCanvas.test.mjs`, then run:

```bash
node --test apps/miniprogram/test/albumShareCover.test.mjs \
  apps/miniprogram/test/albumShareEntry.test.mjs \
  apps/miniprogram/test/albumSharePreview.test.mjs
```

Expected: all focused tests PASS.

- [ ] **Step 6: Commit the integrated representative image**

```bash
git add -A apps/miniprogram/src/pages/session/album.vue \
  apps/miniprogram/src/utils/albumShareCanvas.js \
  apps/miniprogram/test/albumShareCanvas.test.mjs \
  apps/miniprogram/test/albumShareEntry.test.mjs \
  apps/miniprogram/test/albumSharePreview.test.mjs
git commit -m "refactor(album): remove canvas share covers"
```

---

### Task 4: Align static gates and verify the production package

**Files:**
- Modify: `scripts/d55-client-canvas-album-share-cover-check.js`
- Modify: `scripts/d56-album-share-entry-remap-check.js`
- Modify: `scripts/d48-album-sharing-role-claim-separation-check.js`
- Modify: `scripts/check-miniprogram.js`
- Modify: `package.json`
- Modify: `docs/superpowers/plans/2026-07-24-album-timeline-representative-image.md`

- [ ] **Step 1: Run old gates and verify RED**

```bash
npm run d55:check
npm run d56:check
node scripts/d48-album-sharing-role-claim-separation-check.js
node scripts/check-miniprogram.js
```

Expected: old Canvas-specific assertions fail.

- [ ] **Step 2: Replace historical Canvas assertions**

Update D55/D56/D48 and the general mini-program check to require:

- no Skyline or GlassEasel page configuration;
- no `albumShareCanvas.js`, Canvas test, `<canvas>`, `canvasToTempFilePath`, or Canvas coordinator;
- representative selection is local-first and online-fallback;
- default, active, and public full-album flows use their own representative image;
- friend payloads omit `imageUrl`;
- timeline payloads require a non-empty local or HTTP(S) image;
- no full-album static fallback;
- single-media, recruitment, and fail-closed explicit image contracts remain.

Change the root focused command to:

```json
"d55:unit": "node --test apps/api/test/album-public-share-cover-recipe.test.mjs apps/miniprogram/test/albumShareCover.test.mjs apps/miniprogram/test/albumShareWebView.test.mjs"
```

- [ ] **Step 3: Run the complete automated verification**

```bash
npm run d55:unit
npm run d55:check
npm run d56:unit
npm run d56:check
node --test apps/miniprogram/test/albumSharePreview.test.mjs
node scripts/d48-album-sharing-role-claim-separation-check.js
node scripts/check-miniprogram.js
npm run build:mp-weixin -w @pinche/miniprogram
```

Expected: every test/gate passes and production build exits 0.

- [ ] **Step 4: Inspect generated artifacts**

```bash
rg -n '<canvas|canvasToTempFilePath|albumShareCanvas|<snapshot|renderer.:.skyline' \
  apps/miniprogram/dist/build/mp-weixin/pages/session/album.*
```

Expected: no matches.

- [ ] **Step 5: Final diff review and documentation**

```bash
git diff --check
git status --short
git diff --stat 14aa5936...HEAD
```

Mark completed checkboxes in this plan and append exact automated test/build evidence. Then commit:

```bash
git add scripts package.json docs/superpowers/plans/2026-07-24-album-timeline-representative-image.md
git commit -m "test(album): gate representative share image"
```
