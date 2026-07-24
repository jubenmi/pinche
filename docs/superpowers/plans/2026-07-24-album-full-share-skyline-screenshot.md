# Album Full-Share Skyline Screenshot Implementation Plan

> **Superseded:** This plan migrated the 5,300+ line album page to Skyline. It is retained as
> decision history and must not be executed further. The replacement plan uses the first usable
> album media as the Moments cover and does not introduce Skyline.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace full-album Moments Canvas covers with a privacy-safe Skyline DOM screenshot while keeping full-album friend/group shares on WeChat's native page screenshot.

**Architecture:** Upgrade the uni-app compiler to the first stable release that supports the WeChat Skyline `snapshot` component, and enable Skyline only for `pages/session/album`. A small snapshot state module owns stale-request rejection and temporary-file cleanup; an offscreen square Vue component renders the public-share first-screen projection and exports it through `Snapshot.takeSnapshot`. Member default, member active, and public re-share flows use the same capture pipeline, while single-media, recruitment, home, review, and fail-closed covers remain unchanged.

**Tech Stack:** Vue 3 Options API, uni-app, WeChat Skyline/GlassEasel, WeChat `snapshot` component, Node.js built-in test runner, existing D55/D56 static gates.

---

### Task 1: Upgrade uni-app and enable Skyline only for the album page

> 已完成（2026-07-24）：配置测试 2/2 通过，生产构建通过，生成页配置确认仅相册页为
> Skyline + GlassEasel。
> `5010520260709001` 的 `uni-cli-shared`/`uni-shared` CommonJS 契约不一致，构建稳定复现
> `H5_BUILT_IN_TAG_NAMES` 为 `undefined`；执行时采用同批次官方热修复
> `5010520260709002`，不改变 Skyline 技术路线。

**Files:**
- Modify: `apps/miniprogram/package.json`
- Modify: `package-lock.json`
- Modify: `apps/miniprogram/src/pages.json`
- Create: `apps/miniprogram/test/albumShareSkyline.test.mjs`

- [x] **Step 1: Write the failing compiler and page-config test**

Create `apps/miniprogram/test/albumShareSkyline.test.mjs`:

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

const SKYLINE_UNI_VERSION = "3.0.0-5010520260709002";

test("album page alone opts into Skyline and GlassEasel", () => {
  const album = pagesJson.pages.find((page) => page.path === "pages/session/album");
  assert.equal(album?.style?.renderer, "skyline");
  assert.equal(album?.style?.componentFramework, "glass-easel");

  for (const page of pagesJson.pages.filter((item) => item.path !== "pages/session/album")) {
    assert.notEqual(page?.style?.renderer, "skyline", page.path);
    assert.notEqual(page?.style?.componentFramework, "glass-easel", page.path);
  }
});

test("uni compiler packages use the stable snapshot-capable release", () => {
  for (const name of [
    "@dcloudio/uni-app",
    "@dcloudio/uni-mp-weixin",
    "@dcloudio/vite-plugin-uni"
  ]) {
    assert.equal(packageJson.devDependencies[name], SKYLINE_UNI_VERSION, name);
  }
});
```

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
node --test apps/miniprogram/test/albumShareSkyline.test.mjs
```

Expected: FAIL because the album page has no renderer settings and the three packages still use `3.0.0-5000720260410001`.

- [x] **Step 3: Upgrade the three aligned compiler packages**

Change `apps/miniprogram/package.json`:

```json
"@dcloudio/uni-app": "3.0.0-5010520260709002",
"@dcloudio/uni-mp-weixin": "3.0.0-5010520260709002",
"@dcloudio/vite-plugin-uni": "3.0.0-5010520260709002"
```

Then run:

```bash
npm install
```

Expected: `package-lock.json` resolves the three direct dependencies and their aligned `@dcloudio/*` transitive packages to the `5010520260709002` release.

- [x] **Step 4: Configure only the album page for Skyline**

Change the album entry in `apps/miniprogram/src/pages.json`:

```json
{
  "path": "pages/session/album",
  "style": {
    "navigationBarTitleText": "相册",
    "renderer": "skyline",
    "componentFramework": "glass-easel"
  }
}
```

Do not add `renderer` or `componentFramework` to `globalStyle`, `manifest.json`, or any other page.

- [x] **Step 5: Run the config test and production build**

Run:

```bash
node --test apps/miniprogram/test/albumShareSkyline.test.mjs
npm run build:mp-weixin
```

Expected: test PASS and build exit 0. Verify the generated album page config:

```bash
node -e 'const fs=require("node:fs");const p="apps/miniprogram/dist/build/mp-weixin/pages/session/album.json";const j=JSON.parse(fs.readFileSync(p,"utf8"));if(j.renderer!=="skyline"||j.componentFramework!=="glass-easel")process.exit(1)'
```

Expected: exit 0.

- [x] **Step 6: Commit the compatibility gate**

```bash
git add apps/miniprogram/package.json package-lock.json apps/miniprogram/src/pages.json apps/miniprogram/test/albumShareSkyline.test.mjs
git commit -m "build(album): enable skyline snapshot support"
```

---

### Task 2: Build the framework-independent snapshot state module

**Files:**
- Create: `apps/miniprogram/src/utils/albumShareSnapshot.js`
- Create: `apps/miniprogram/test/albumShareSnapshot.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for projection, currentness, acceptance, and cleanup**

Create `apps/miniprogram/test/albumShareSnapshot.test.mjs` with these public contracts:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  albumShareSnapshotKey,
  albumShareSnapshotProjection,
  createAlbumShareSnapshotSlot,
  releaseAlbumShareSnapshotTempPath
} from "../src/utils/albumShareSnapshot.js";

const publicAlbum = {
  session: {
    script_name_snapshot: "琼崖Ⅱ海角",
    store_name_snapshot: "不羡仙",
    start_at: "2026-07-20T11:00:00.000Z"
  },
  share_owner: { nickname: "游戏开发极客", avatar_url: "/owner.jpg" },
  share_subject: { role_name: "叶辰" },
  visible_count: 6,
  photo_count: 5,
  video_count: 1,
  photos: [
    { id: 11, media_type: "image", preview_load_url: "/11.jpg" },
    { id: 12, media_type: "video", cover_url: "/12-cover.jpg" },
    { id: 13, media_type: "image", thumbnail_url: "/13.jpg" },
    { id: 14, media_type: "image", preview_url: "/14.jpg" },
    { id: 15, media_type: "image", preview_url: "/15.jpg" }
  ]
};

test("snapshot projection contains only the public first-screen model", () => {
  const projection = albumShareSnapshotProjection(publicAlbum, {
    mediaUrl: (value) => `https://example.test${value}`,
    limit: 4
  });
  assert.equal(projection.ownerName, "游戏开发极客");
  assert.equal(projection.roleName, "叶辰");
  assert.equal(projection.scriptName, "琼崖Ⅱ海角");
  assert.equal(projection.storeName, "不羡仙");
  assert.equal(projection.total, 6);
  assert.deepEqual(
    projection.media.map(({ id, imageUrl }) => [id, imageUrl]),
    [
      [11, "https://example.test/11.jpg"],
      [12, "https://example.test/12-cover.jpg"],
      [13, "https://example.test/13.jpg"],
      [14, "https://example.test/14.jpg"]
    ]
  );
});

test("snapshot key follows token and public media semantics, not signed URLs", () => {
  const first = albumShareSnapshotKey({
    token: "share-token",
    projection: albumShareSnapshotProjection(publicAlbum)
  });
  const refreshed = structuredClone(publicAlbum);
  refreshed.photos[0].preview_load_url = "/11.jpg?signature=refreshed";
  assert.equal(
    albumShareSnapshotKey({
      token: "share-token",
      projection: albumShareSnapshotProjection(refreshed)
    }),
    first
  );
});

test("slot accepts only its current capture and releases stale or replaced paths", () => {
  const released = [];
  const slot = createAlbumShareSnapshotSlot({
    releaseTempPath: (path) => released.push(path)
  });
  const oldRequest = slot.begin("old");
  const currentRequest = slot.begin("current");

  assert.equal(slot.accept(oldRequest, "wxfile://stale.png"), "");
  assert.deepEqual(released, ["wxfile://stale.png"]);
  assert.equal(slot.accept(currentRequest, "wxfile://current.png"), "wxfile://current.png");

  const replacement = slot.begin("replacement");
  assert.equal(
    slot.accept(replacement, "wxfile://replacement.png"),
    "wxfile://replacement.png"
  );
  assert.deepEqual(released, ["wxfile://stale.png", "wxfile://current.png"]);

  slot.invalidate();
  assert.deepEqual(released, [
    "wxfile://stale.png",
    "wxfile://current.png",
    "wxfile://replacement.png"
  ]);
});

test("temporary snapshot cleanup unlinks only local temporary paths", async () => {
  const unlinked = [];
  const getFileSystemManager = () => ({
    unlink({ filePath, success }) {
      unlinked.push(filePath);
      success?.();
    }
  });

  await releaseAlbumShareSnapshotTempPath("wxfile://tmp/share.png", {
    getFileSystemManager
  });
  await releaseAlbumShareSnapshotTempPath("/private/tmp/share.png", {
    getFileSystemManager
  });
  await releaseAlbumShareSnapshotTempPath("/static/share.png", {
    getFileSystemManager
  });
  await releaseAlbumShareSnapshotTempPath("https://example.test/share.png", {
    getFileSystemManager
  });

  assert.deepEqual(unlinked, [
    "wxfile://tmp/share.png",
    "/private/tmp/share.png"
  ]);
});
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
node --test apps/miniprogram/test/albumShareSnapshot.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the minimal snapshot state module**

Create `apps/miniprogram/src/utils/albumShareSnapshot.js` with:

```js
function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function unsignedUrl(value) {
  return stringValue(value).split("?")[0];
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function mediaImage(photo, mediaUrl) {
  const source = photo?.media_type === "video"
    ? photo.cover_url || photo.thumbnail_url || ""
    : photo.preview_load_url ||
      photo.preview_url ||
      photo.thumbnail_url ||
      photo.image_url ||
      "";
  return source && typeof mediaUrl === "function" ? mediaUrl(source) : source;
}

export function albumShareSnapshotProjection(data = {}, {
  mediaUrl = (value) => value,
  limit = 4
} = {}) {
  const media = [];
  for (const photo of Array.isArray(data.photos || data.media) ? data.photos || data.media : []) {
    const id = positiveInteger(photo?.id);
    const imageUrl = stringValue(mediaImage(photo, mediaUrl));
    if (!id || !imageUrl) continue;
    media.push(Object.freeze({
      id,
      mediaType: photo?.media_type === "video" ? "video" : "image",
      imageUrl
    }));
    if (media.length >= Math.max(1, Number(limit) || 4)) break;
  }
  const session = data.session || data.album_session || {};
  return Object.freeze({
    ownerName: stringValue(data.share_owner?.nickname) || "车友",
    ownerAvatar: stringValue(data.share_owner?.avatar_url),
    roleName: stringValue(data.share_subject?.role_name) || "角色待定",
    scriptName: stringValue(session.script_name_snapshot || data.script_name) || "剧本待定",
    storeName: stringValue(session.store_name_snapshot || data.store_name) || "店家待定",
    playedAt: stringValue(session.start_at || data.played_at),
    total: Number(data.visible_count || media.length || 0),
    photos: Number(data.photo_count || 0),
    videos: Number(data.video_count || 0),
    media: Object.freeze(media)
  });
}

export function albumShareSnapshotKey({ token, projection } = {}) {
  return JSON.stringify([
    stringValue(token),
    projection?.ownerName || "",
    projection?.roleName || "",
    projection?.scriptName || "",
    projection?.storeName || "",
    Number(projection?.total || 0),
    (projection?.media || []).map((item) => [
      Number(item.id),
      item.mediaType,
      unsignedUrl(item.imageUrl)
    ])
  ]);
}

export function createAlbumShareSnapshotSlot({ releaseTempPath = () => {} } = {}) {
  let generation = 0;
  let path = "";
  function release(value) {
    if (!value) return;
    try {
      releaseTempPath(value);
    } catch (error) {
      // Temporary-file cleanup must not block the next share.
    }
  }
  return Object.freeze({
    begin(key) {
      generation += 1;
      return Object.freeze({ generation, key: stringValue(key) });
    },
    isCurrent(request) {
      return Boolean(request && request.generation === generation);
    },
    accept(request, nextPath) {
      const candidate = stringValue(nextPath);
      if (!candidate || request?.generation !== generation) {
        release(candidate);
        return "";
      }
      if (path && path !== candidate) release(path);
      path = candidate;
      return path;
    },
    invalidate() {
      generation += 1;
      release(path);
      path = "";
    },
    path() {
      return path;
    }
  });
}

function localSnapshotTempPath(value) {
  const path = stringValue(value);
  return /^(?:wxfile:\/\/|http:\/\/tmp\/|file:\/\/|\/tmp\/|\/private\/|\/var\/)/.test(path)
    ? path
    : "";
}

export async function releaseAlbumShareSnapshotTempPath(value, {
  getFileSystemManager = () => globalThis?.wx?.getFileSystemManager?.()
} = {}) {
  const filePath = localSnapshotTempPath(value);
  if (!filePath) return false;
  const fileSystem = getFileSystemManager?.();
  if (!fileSystem?.unlink) return false;
  return new Promise((resolve) => {
    fileSystem.unlink({
      filePath,
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });
}
```

- [ ] **Step 4: Run the snapshot tests and verify GREEN**

Run:

```bash
node --test apps/miniprogram/test/albumShareSnapshot.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Add the test to the focused D55 unit command and commit**

Change the root `package.json` `d55:unit` script to include
`apps/miniprogram/test/albumShareSnapshot.test.mjs`. Do not remove the old Canvas tests yet;
that happens only after the Skyline integration passes.

```bash
git add apps/miniprogram/src/utils/albumShareSnapshot.js apps/miniprogram/test/albumShareSnapshot.test.mjs package.json
git commit -m "feat(album): add skyline snapshot state"
```

---

### Task 3: Add the offscreen Skyline snapshot surface

**Files:**
- Create: `apps/miniprogram/src/components/AlbumShareSnapshotSurface.vue`
- Create: `apps/miniprogram/test/albumShareSnapshotSurface.test.mjs`
- Modify: `apps/miniprogram/test/albumShareSkyline.test.mjs`

- [ ] **Step 1: Write the failing component-contract test**

Create `apps/miniprogram/test/albumShareSnapshotSurface.test.mjs`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../src/components/AlbumShareSnapshotSurface.vue", import.meta.url),
  "utf8"
);

test("snapshot surface is an offscreen square DOM page without Canvas or native video", () => {
  assert.match(source, /<snapshot\b[^>]*id="album-share-snapshot"/);
  assert.match(source, /node\.takeSnapshot\(\{/);
  assert.match(source, /type:\s*"file"/);
  assert.match(source, /format:\s*"png"/);
  assert.match(source, /class="album-share-snapshot-surface"/);
  assert.match(source, /position:\s*fixed/);
  assert.match(source, /left:\s*-10000px/);
  assert.match(source, /width:\s*750rpx/);
  assert.match(source, /height:\s*750rpx/);
  assert.doesNotMatch(source, /display:\s*none|visibility:\s*hidden/);
  assert.doesNotMatch(source, /<canvas|<video/);
});

test("surface waits for every projected image before capture", () => {
  assert.match(source, /@load="handleImageLoad\(item\.id\)"/);
  assert.match(source, /@error="handleImageError\(item\.id\)"/);
  assert.match(source, /waitUntilReady\(\)/);
  assert.match(source, /capture\(\)/);
});
```

- [ ] **Step 2: Run the component test and verify RED**

Run:

```bash
node --test apps/miniprogram/test/albumShareSnapshotSurface.test.mjs
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the square public-album DOM surface**

Create `AlbumShareSnapshotSurface.vue` with:

- a root `<snapshot id="album-share-snapshot">`;
- a 750rpx square surface containing owner, role, script, store, count, and a two-column
  four-media grid;
- `<image>` for both photos and video posters;
- reactive loaded/failed media ID sets reset whenever `model.key` changes;
- `waitUntilReady()` that resolves only when every projected media image loaded and rejects
  after a bounded 5-second timeout or any image error;
- `capture()` that runs:

```js
const query = uni.createSelectorQuery();
const scoped = typeof query.in === "function" ? query.in(this) : query;
const node = await new Promise((resolve, reject) => {
  scoped
    .select("#album-share-snapshot")
    .node()
    .exec((result) => {
      const snapshot = result?.[0]?.node;
      if (snapshot?.takeSnapshot) resolve(snapshot);
      else reject(new Error("album share snapshot node unavailable"));
    });
});
return new Promise((resolve, reject) => {
  node.takeSnapshot({
    type: "file",
    format: "png",
    success: ({ tempFilePath }) => resolve(String(tempFilePath || "")),
    fail: reject
  });
});
```

The component must remain mounted only while a snapshot model exists, must sit outside the
album waterfall, and must not contain TDesign or native media components.

- [ ] **Step 4: Run component and build checks**

Run:

```bash
node --test apps/miniprogram/test/albumShareSnapshotSurface.test.mjs
npm run build:mp-weixin
```

Do not assert generated component WXML yet: uni-app does not emit an unreferenced component.
The generated `<snapshot>` assertion belongs in Task 4 after `album.vue` imports and mounts the
component.

Expected: tests PASS and build exit 0.

- [ ] **Step 5: Commit the snapshot surface**

```bash
git add apps/miniprogram/src/components/AlbumShareSnapshotSurface.vue apps/miniprogram/test/albumShareSnapshotSurface.test.mjs apps/miniprogram/test/albumShareSkyline.test.mjs
git commit -m "feat(album): render skyline share snapshot surface"
```

---

### Task 4: Integrate default, active, and public full-album Moments screenshots

**Files:**
- Modify: `apps/miniprogram/src/pages/session/album.vue`
- Modify: `apps/miniprogram/src/utils/albumShareCover.js`
- Modify: `apps/miniprogram/test/albumShareCover.test.mjs`
- Modify: `apps/miniprogram/test/albumShareEntry.test.mjs`
- Modify: `apps/miniprogram/test/albumSharePreview.test.mjs`
- Modify: `apps/miniprogram/test/albumShareSkyline.test.mjs`

- [ ] **Step 1: Write failing behavior tests for the three flows**

Update the focused tests to require:

```js
// Full-album friend/group cards remain native screenshots.
assert.equal("imageUrl" in albumShareFriendPayload({
  title: "相册",
  path: "/pages/session/album?token=1"
}), false);

// Moments never receives a static fallback.
assert.equal(albumShareTimelinePayload({
  title: "相册",
  query: "token=1",
  imageUrl: ""
}), null);

// Active selected/all snapshot wins while its ready layer is open.
assert.match(onShareTimelineSource, /albumShareReadyVisible/);
assert.match(onShareTimelineSource, /activeAlbumShareTimelinePayload\(\)/);
assert.match(onShareTimelineSource, /defaultAlbumShareTimelinePayload\(\)/);

// Every member token loads the public-safe first page before capture.
assert.match(defaultPreparationSource, /loadAlbumShareSnapshotPublicPage/);
assert.match(activePreparationSource, /loadAlbumShareSnapshotPublicPage/);

// Public re-share captures its already-authorized public data.
assert.match(publicLoadSource, /prepareAlbumShareSkylineSnapshot/);
```

Also assert that single-media, recruitment, home, review, and fail-closed payload tests still
contain their explicit `imageUrl`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test apps/miniprogram/test/albumShareCover.test.mjs apps/miniprogram/test/albumShareEntry.test.mjs apps/miniprogram/test/albumSharePreview.test.mjs apps/miniprogram/test/albumShareSkyline.test.mjs
```

Expected: FAIL because Moments still uses Canvas and active Moments still routes to the default
snapshot.

- [ ] **Step 3: Mount the snapshot component and add three isolated slots**

In `album.vue`:

```js
import AlbumShareSnapshotSurface from "../../components/AlbumShareSnapshotSurface.vue";
import {
  albumShareSnapshotKey,
  albumShareSnapshotProjection,
  createAlbumShareSnapshotSlot,
  releaseAlbumShareSnapshotTempPath
} from "../../utils/albumShareSnapshot";
```

Register the component and mount it outside the waterfall:

```vue
<AlbumShareSnapshotSurface
  v-if="albumShareSnapshotSurface"
  ref="albumShareSnapshotSurface"
  :model="albumShareSnapshotSurface"
/>
```

Add three non-overlapping slots and reactive result fields:

```js
defaultAlbumShareSnapshotSlot: createAlbumShareSnapshotSlot({
  releaseTempPath: releaseAlbumShareSnapshotTempPath
}),
activeAlbumShareSnapshotSlot: createAlbumShareSnapshotSlot({
  releaseTempPath: releaseAlbumShareSnapshotTempPath
}),
publicAlbumShareSnapshotSlot: createAlbumShareSnapshotSlot({
  releaseTempPath: releaseAlbumShareSnapshotTempPath
}),
defaultAlbumShareTimelineSnapshotUrl: "",
activeAlbumShareTimelineSnapshotUrl: "",
shareTimelineSnapshotUrl: "",
albumShareSnapshotSurface: null,
albumShareSnapshotCoordinator: createAlbumShareEntryCoordinator()
```

- [ ] **Step 4: Load the public-safe first page and capture it**

Add:

```js
async loadAlbumShareSnapshotPublicPage(token) {
  const response = await request({
    url: `/api/sessions/${this.sessionId}/album/public-share${queryString({ token })}`,
    suppressMaintenance: true
  });
  return dataOf(response) || null;
}
```

Add one shared preparer that:

1. projects public data with `albumShareSnapshotProjection`;
2. starts the correct slot request with `albumShareSnapshotKey`;
3. serializes DOM mutation and capture through `albumShareSnapshotCoordinator`;
4. sets the offscreen model;
5. awaits `$nextTick`, `waitUntilReady()`, and `capture()`;
6. accepts the path only if the slot request and outer token request are still current;
7. writes the correct reactive URL and calls `showShareMenus()`;
8. releases stale paths and never installs a fallback.

Use the public endpoint after member default and active token creation; do not build the
screenshot from `cover_recipe`, because it contains only three images and not the public album
first screen. Pass the already-loaded public response from the initial public load and public
refresh paths. The projection itself limits the square cover to the first four public-safe
media items.

- [ ] **Step 5: Route Moments to active, default, or public snapshot**

Change `onShareTimeline`:

```js
onShareTimeline() {
  if (this.timelineMode) return this.publicAlbumShareTimelinePayload();
  if (this.albumShareReadyVisible && this.activeAlbumShareToken) {
    return this.activeAlbumShareTimelinePayload();
  }
  return this.defaultAlbumShareTimelinePayload();
}
```

Each Moments payload must return `null` without its own current local snapshot path. Change
`albumShareTimelinePayload` to validate and return the supplied snapshot path without calling
`albumShareImage` or any static fallback.

Update `showShareMenus()` so:

- `shareAppMessage` is available with the relevant token;
- `shareTimeline` is available only when the relevant active/default/public snapshot URL exists;
- an active ready layer uses only active token/snapshot state;
- closing it restores default token/snapshot state.

- [ ] **Step 6: Invalidate all screenshot state on the existing lifecycle boundaries**

Invalidate the relevant slot and clear its URL when:

- default entry identity/media semantics change;
- a new active snapshot begins;
- active ready layer closes;
- public token changes;
- auth changes;
- page hides/unloads according to existing share lifecycle.

Invalidate `albumShareSnapshotCoordinator` before releasing slot paths so queued work cannot
reinstall a stale result.

- [ ] **Step 7: Run the focused tests and verify GREEN**

Run:

```bash
node --test apps/miniprogram/test/albumShareSnapshot.test.mjs apps/miniprogram/test/albumShareSnapshotSurface.test.mjs apps/miniprogram/test/albumShareCover.test.mjs apps/miniprogram/test/albumShareEntry.test.mjs apps/miniprogram/test/albumSharePreview.test.mjs apps/miniprogram/test/albumShareSkyline.test.mjs
```

Expected: all tests PASS.

After the component is mounted, extend `albumShareSkyline.test.mjs` to assert that the generated
album WXML/component WXML contains `album-share-snapshot` and `<snapshot`.

- [ ] **Step 8: Commit the integrated Skyline screenshots**

```bash
git add apps/miniprogram/src/pages/session/album.vue apps/miniprogram/src/utils/albumShareCover.js apps/miniprogram/test/albumShareCover.test.mjs apps/miniprogram/test/albumShareEntry.test.mjs apps/miniprogram/test/albumSharePreview.test.mjs apps/miniprogram/test/albumShareSkyline.test.mjs
git commit -m "feat(album): share moments from skyline snapshots"
```

---

### Task 5: Remove the obsolete full-album Canvas pipeline and align gates

**Files:**
- Delete: `apps/miniprogram/src/utils/albumShareCanvas.js`
- Delete: `apps/miniprogram/test/albumShareCanvas.test.mjs`
- Modify: `apps/miniprogram/src/pages/session/album.vue`
- Modify: `apps/miniprogram/src/utils/albumShareCover.js`
- Modify: `apps/miniprogram/test/albumShareCover.test.mjs`
- Modify: `apps/miniprogram/test/albumShareEntry.test.mjs`
- Modify: `apps/miniprogram/test/albumSharePreview.test.mjs`
- Modify: `scripts/d55-client-canvas-album-share-cover-check.js`
- Modify: `scripts/d56-album-share-entry-remap-check.js`
- Modify: `scripts/d48-album-sharing-role-claim-separation-check.js`
- Modify: `scripts/check-miniprogram.js`
- Modify: `package.json`

- [ ] **Step 1: Run the old static gates and capture the expected RED**

Run before changing the gates:

```bash
npm run d55:check
npm run d56:check
node scripts/d48-album-sharing-role-claim-separation-check.js
node scripts/check-miniprogram.js
```

Expected: at least D55/D56 fail because they still require Canvas nodes, Canvas coordinator,
cover recipe consumption, timeline fallbacks, or default-only member Moments.

- [ ] **Step 2: Delete Canvas-only production and test code**

Remove from `album.vue`:

- both hidden `<canvas>` nodes;
- `albumShareCanvas` imports;
- Canvas runtime/node/export/preparation methods;
- Canvas coordinator and cover-request state;
- `cover_recipe` preparation for default, active, and public flows;
- friend/timeline Canvas URL/prepared fields with no remaining consumer;
- static timeline fallback branches for full-album sharing.

Delete `albumShareCanvas.js` and `albumShareCanvas.test.mjs`.

Keep the backend `cover_recipe` response and its API test unchanged in this task; no backend
protocol changes are authorized.

- [ ] **Step 3: Replace the old D55/D56 contracts**

Update the historical D55 gate to require:

```text
album page renderer === skyline
album page componentFramework === glass-easel
snapshot component is present
Snapshot.takeSnapshot uses file/png
default, active, and public flows prepare snapshot data
full-album Moments payloads require local Skyline paths
full-album friend payloads omit imageUrl
albumShareCanvas.js and its test are absent
album.vue has no <canvas>, canvasToTempFilePath, cover_recipe, or static full-album fallback
single-media, recruitment, and fail-closed explicit imageUrl contracts remain
```

Update D56 to require active member Moments isolation rather than the former default-only rule.
Update D48 and `check-miniprogram.js` to describe Skyline snapshot privacy and stale-result
invalidation.

Change `d55:unit` to:

```json
"d55:unit": "node --test apps/api/test/album-public-share-cover-recipe.test.mjs apps/miniprogram/test/albumShareSnapshot.test.mjs apps/miniprogram/test/albumShareSnapshotSurface.test.mjs apps/miniprogram/test/albumShareCover.test.mjs apps/miniprogram/test/albumShareSkyline.test.mjs"
```

- [ ] **Step 4: Run updated unit and static gates**

Run:

```bash
npm run d55:unit
npm run d55:check
npm run d56:unit
npm run d56:check
node scripts/d48-album-sharing-role-claim-separation-check.js
node scripts/check-miniprogram.js
```

Expected: all PASS.

- [ ] **Step 5: Commit Canvas removal and gate alignment**

```bash
git add -A apps/miniprogram/src apps/miniprogram/test scripts package.json
git commit -m "refactor(album): remove canvas share covers"
```

---

### Task 6: Build, inspect, and verify the Skyline album

**Files:**
- Modify: `docs/superpowers/plans/2026-07-24-album-full-share-skyline-screenshot.md`

- [ ] **Step 1: Run the full focused automated suite**

```bash
npm run d55:unit
npm run d56:unit
node --test apps/miniprogram/test/albumSharePreview.test.mjs
npm run d55:check
npm run d56:check
node scripts/d48-album-sharing-role-claim-separation-check.js
node scripts/check-miniprogram.js
```

Expected: all tests and gates PASS with zero failures.

- [ ] **Step 2: Build the production WeChat package**

```bash
npm run build:mp-weixin
```

Expected: exit 0 and generated output under
`apps/miniprogram/dist/build/mp-weixin`.

- [ ] **Step 3: Inspect the generated renderer and snapshot artifacts**

Run:

```bash
node -e 'const fs=require("node:fs");const root="apps/miniprogram/dist/build/mp-weixin";const album=JSON.parse(fs.readFileSync(`${root}/pages/session/album.json`,"utf8"));const app=JSON.parse(fs.readFileSync(`${root}/app.json`,"utf8"));if(album.renderer!=="skyline"||album.componentFramework!=="glass-easel")process.exit(1);for(const page of app.pages.filter((p)=>p!=="pages/session/album")){const file=`${root}/${page}.json`;if(!fs.existsSync(file))continue;const j=JSON.parse(fs.readFileSync(file,"utf8"));if(j.renderer==="skyline")process.exit(1)}'
rg -n '<snapshot|album-share-snapshot' apps/miniprogram/dist/build/mp-weixin
rg -n '<canvas|canvasToTempFilePath|client-canvas-v1' apps/miniprogram/dist/build/mp-weixin/pages/session/album.*
```

Expected: the first two commands succeed; the final `rg` finds no album Canvas pipeline.

- [ ] **Step 4: Run the WeChat DevTools compatibility checkpoint**

Open the generated package in the existing WeChat DevTools project and verify:

1. simulator reports `renderer: skyline` only on `pages/session/album`;
2. member and public album routes render without a white screen;
3. upload, filters, picker, selection, tag popup, image viewer, and video entry remain usable;
4. snapshot export creates a local PNG before the Moments menu appears;
5. active selected share uses its own token and screenshot;
6. capture failure hides Moments but leaves friend/group sharing enabled.

If any blocking Skyline incompatibility appears, stop and report it before claiming completion.
Do not restore Canvas automatically; use the separately approved lightweight share-page design
only after user confirmation.

- [ ] **Step 5: Review final diff and record evidence**

```bash
git diff --check origin/develop...HEAD
git status --short
git diff --stat origin/develop...HEAD
```

Verify the diff contains only the approved design/plan, compiler lockfile update, album-only
Skyline configuration, snapshot component/state, album sharing integration, Canvas deletion,
and related tests/gates.

Update every completed checkbox in this plan and append exact test counts and DevTools results.

- [ ] **Step 6: Commit the verification record**

```bash
git add docs/superpowers/plans/2026-07-24-album-full-share-skyline-screenshot.md
git commit -m "docs(album): record skyline screenshot verification"
```
