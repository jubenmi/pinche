# Public Album Unavailable Home Redirect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send users directly to the mini-program home page when a public album share is missing credentials or has expired, while preserving retry UI for recoverable failures.

**Architecture:** Add two small pure classifiers to the existing mini-program safety utility, then use them only inside the public album load path. Keep navigation local to the album page through one `reLaunch` method so member-album authorization and global request handling remain unchanged.

**Tech Stack:** uni-app Vue 2 options API, JavaScript ES modules, Node.js built-in test runner, source-contract checks.

---

### Task 1: Classify unrecoverable public album access

**Files:**
- Modify: `apps/miniprogram/test/p1Safety.test.mjs`
- Modify: `apps/miniprogram/src/utils/p1Safety.js`

- [ ] **Step 1: Write the failing classifier tests**

Add these tests to `apps/miniprogram/test/p1Safety.test.mjs`:

```js
test("public album access requires both session and share token", async () => {
  const safety = await optionalImport("../src/utils/p1Safety.js");
  assert.equal(typeof safety.hasPublicAlbumAccessCredentials, "function");
  assert.equal(safety.hasPublicAlbumAccessCredentials("12", "share-token"), true);
  assert.equal(safety.hasPublicAlbumAccessCredentials("", "share-token"), false);
  assert.equal(safety.hasPublicAlbumAccessCredentials("12", ""), false);
  assert.equal(safety.hasPublicAlbumAccessCredentials(null, null), false);
});

test("only forbidden public album responses are unrecoverable", async () => {
  const safety = await optionalImport("../src/utils/p1Safety.js");
  assert.equal(typeof safety.isUnavailablePublicAlbumError, "function");
  assert.equal(safety.isUnavailablePublicAlbumError({ statusCode: 403 }), true);
  assert.equal(safety.isUnavailablePublicAlbumError({ statusCode: 500 }), false);
  assert.equal(safety.isUnavailablePublicAlbumError({ statusCode: 0 }), false);
  assert.equal(safety.isUnavailablePublicAlbumError(null), false);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --test apps/miniprogram/test/p1Safety.test.mjs
```

Expected: FAIL because `hasPublicAlbumAccessCredentials` and `isUnavailablePublicAlbumError` are not exported.

- [ ] **Step 3: Add the minimal classifiers**

Append to `apps/miniprogram/src/utils/p1Safety.js`:

```js
export function hasPublicAlbumAccessCredentials(sessionId, shareToken) {
  return Boolean(String(sessionId || "").trim() && String(shareToken || "").trim());
}

export function isUnavailablePublicAlbumError(error) {
  return Number(error?.statusCode || 0) === 403;
}
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run:

```bash
node --test apps/miniprogram/test/p1Safety.test.mjs
```

Expected: all tests PASS.

### Task 2: Redirect unrecoverable public shares and retain recoverable errors

**Files:**
- Modify: `scripts/p1-miniprogram-source-check.js`
- Modify: `scripts/d50-album-single-media-sharing-check.js`
- Modify: `apps/miniprogram/src/pages/session/album.vue`

- [ ] **Step 1: Write the failing page contract**

Add focused source-block assertions to `scripts/p1-miniprogram-source-check.js`:

```js
const publicAlbumRedirect = album.slice(
  album.indexOf("redirectUnavailablePublicAlbumHome()"),
  album.indexOf("async loadPublicAlbum()")
);
const publicAlbumLoadStart = album.indexOf("async loadPublicAlbum()");
const publicAlbumLoad = album.slice(
  publicAlbumLoadStart,
  album.indexOf("    resetPublicSharePagination() {", publicAlbumLoadStart)
);

assert.match(
  publicAlbumRedirect,
  /uni\.reLaunch\(\{\s*url:\s*"\/pages\/index\/index"\s*\}\)/
);
assert.match(
  publicAlbumLoad,
  /!hasPublicAlbumAccessCredentials\(this\.sessionId,\s*this\.albumShareToken\)[\s\S]*this\.redirectUnavailablePublicAlbumHome\(\);[\s\S]*return;/
);
assert.match(
  publicAlbumLoad,
  /isUnavailablePublicAlbumError\(error\)[\s\S]*this\.redirectUnavailablePublicAlbumHome\(\);[\s\S]*return;/
);
assert.match(
  publicAlbumLoad,
  /this\.statusText = "分享相册加载失败，请稍后重试。";[\s\S]*this\.albumLoadFailed = true;/
);
```

Replace the existing tokenless focused-route assertion in
`scripts/d50-album-single-media-sharing-check.js` with:

```js
assert(
  publicLoad.includes(
    "!hasPublicAlbumAccessCredentials(this.sessionId, this.albumShareToken)"
  ) &&
    publicLoad.includes("this.redirectUnavailablePublicAlbumHome();"),
  "D50 tokenless focused routes must return home without loading a public or member snapshot"
);
```

Remove `"this.singleMediaShareRequested"` from the start of the focused public-load
ordering assertion. The removed token used to be supplied by the old tokenless error
state branch; the later focused-media assertions continue to protect successful
single-media loads.

- [ ] **Step 2: Run the source contract and verify RED**

Run:

```bash
node scripts/p1-miniprogram-source-check.js
node scripts/d50-album-single-media-sharing-check.js
```

Expected: both checks FAIL because the page does not yet contain the redirect method or classifier usage.

- [ ] **Step 3: Implement the minimal page behavior**

Update the `p1Safety.js` import in `apps/miniprogram/src/pages/session/album.vue`:

```js
import {
  albumListPresentation,
  hasPublicAlbumAccessCredentials,
  isUnavailablePublicAlbumError
} from "../../utils/p1Safety.js";
```

Add this page method immediately before `loadPublicAlbum`:

```js
redirectUnavailablePublicAlbumHome() {
  uni.reLaunch({ url: "/pages/index/index" });
},
```

Replace the missing-credential error-state branch at the start of `loadPublicAlbum` with:

```js
if (!hasPublicAlbumAccessCredentials(this.sessionId, this.albumShareToken)) {
  this.redirectUnavailablePublicAlbumHome();
  return;
}
```

At the start of the current-request `catch` branch, before clearing album state, add:

```js
if (isUnavailablePublicAlbumError(error)) {
  this.redirectUnavailablePublicAlbumHome();
  return;
}
```

Then simplify the remaining recoverable error copy to:

```js
this.statusText = "分享相册加载失败，请稍后重试。";
this.albumLoadFailed = true;
```

- [ ] **Step 4: Run the focused checks and verify GREEN**

Run:

```bash
node --test apps/miniprogram/test/p1Safety.test.mjs
node scripts/p1-miniprogram-source-check.js
node --test apps/miniprogram/test/albumSingleMediaShare.test.mjs apps/miniprogram/test/albumSharePreview.test.mjs apps/miniprogram/test/albumMediaUrls.test.mjs
node scripts/d50-album-single-media-sharing-check.js
```

Expected: all tests and source checks PASS.

- [ ] **Step 5: Build the mini-program**

Run:

```bash
npm run build:mp-weixin
```

Expected: build exits successfully without compile errors.

- [ ] **Step 6: Commit the implementation**

```bash
git add apps/miniprogram/test/p1Safety.test.mjs apps/miniprogram/src/utils/p1Safety.js scripts/p1-miniprogram-source-check.js scripts/d50-album-single-media-sharing-check.js apps/miniprogram/src/pages/session/album.vue docs/superpowers/plans/2026-07-25-public-album-unavailable-home-redirect.md
git commit -m "fix(miniprogram): leave unavailable shared albums"
```
