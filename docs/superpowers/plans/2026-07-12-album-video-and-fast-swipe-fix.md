# Album Video Playback and Fast Swipe Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make album videos support successive byte-range requests and make five-item swiper window rebases visually instantaneous under rapid input.

**Architecture:** Keep the authenticated API playback URL, but stop binding the redirected COS signature to the first `Range` header so the native player may request later ranges from the same signed object URL. Keep the five-slide viewer window, but mark a replacement swiper generation as an internal rebase generation and give only that generation zero animation duration.

**Tech Stack:** Node.js HTTP API, Tencent COS request signing, UniApp/Vue mini-program components, WeChat native `video` and `swiper`, Node assertion scripts.

---

## File Map

- Modify `apps/api/src/server.js`: sign redirected COS video URLs independently of an individual byte range.
- Modify `scripts/d42-album-video-server-check.js`: cover successive range requests against the redirect signature contract.
- Modify `apps/miniprogram/src/components/AlbumImageViewer.vue`: distinguish internal zero-duration rebases from user swipes.
- Modify `scripts/d31-album-viewer-sequence-check.js`: reproduce rapid events across a generation boundary.
- Modify `scripts/d42-miniprogram-album-video-check.js`: retain static coverage for the video error/refresh contract if diagnostics change.

### Task 1: Prove and Fix the COS Range-Signature Failure

**Files:**
- Modify: `scripts/d42-album-video-server-check.js`
- Modify: `apps/api/src/server.js`

- [ ] **Step 1: Write the failing redirect-signature test**

Add a server check that calls `serveUploadedSessionAlbumVideoFile` with `cosEnabled: true` and `range: "bytes=0-1023"`, captures the 302 `location`, and asserts its decoded `q-header-list` contains `host` but not `range`. Also generate a second request range and assert the signed object URL remains range-independent.

```js
check("COS video redirect does not bind playback authorization to the first byte range", async () => {
  const media = {
    source_url: SOURCE_URL,
    display_url: "",
    video_content_type: "video/mp4"
  };
  const redirects = [];
  for (const range of ["bytes=0-1023", "bytes=1024-2047"]) {
    const response = new MemoryResponse();
    await serveUploadedSessionAlbumVideoFile(media, response, {
      cosEnabled: true,
      method: "GET",
      range
    });
    redirects.push(new URL(response.headers.location));
  }
  for (const redirect of redirects) {
    assert.equal(redirect.searchParams.get("q-header-list"), "host");
  }
  assert.equal(redirects[0].pathname, redirects[1].pathname);
});
```

- [ ] **Step 2: Run the focused server check and verify RED**

Run:

```bash
node scripts/d42-album-video-server-check.js
```

Expected: FAIL because the current COS authorization includes `range` in `q-header-list`.

- [ ] **Step 3: Make COS object authorization range-independent**

In `apps/api/src/server.js`, remove `range` from the headers passed to `buildCosAuthorization`; sign only `host`. Keep the API route accepting the original `Range` request and keep the 302 redirect behavior.

```js
function signedCosAlbumVideoUrl(media, method = "GET") {
  const key = albumVideoObjectKey(media.display_url || media.source_url);
  const host = cosHost(config.cos);
  const authorization = buildCosAuthorization({
    method,
    key,
    headers: { host },
    config: config.cos
  });
  return `https://${host}/${encodeCosObjectKey(key)}?${authorization}`;
}
```

Update `serveUploadedSessionAlbumVideoFile` to call `signedCosAlbumVideoUrl(media, method)`.

- [ ] **Step 4: Run video server and media checks and verify GREEN**

Run:

```bash
node scripts/d42-album-video-server-check.js
npm run d42:api-media
```

Expected: both commands pass; range parsing and local 206/416 behavior remain unchanged.

- [ ] **Step 5: Commit the isolated video transport fix**

```bash
git add apps/api/src/server.js scripts/d42-album-video-server-check.js
git commit -m "fix: allow successive album video ranges"
```

### Task 2: Prove the Fast-Swipe Rebase Animation

**Files:**
- Modify: `scripts/d31-album-viewer-sequence-check.js`

- [ ] **Step 1: Add a failing rapid-generation sequence check**

Add `runRapidRebaseDurationCheck`. Open a large viewer, swipe to the physical edge, finish the old generation, and assert that the newly created internal generation exposes duration zero. Feed stale `change` and `animationfinish` events from the old generation and assert the logical index and change count remain stable. Finish the new generation, then assert duration returns to 220 for the next user swipe.

```js
function runRapidRebaseDurationCheck(component) {
  const { instance, emitted } = openViewer(component, 30, 2);
  const oldGeneration = instance.swiperGeneration;
  instance.handleSwiperChange(nativeSwiperEvent(instance, 4, { generation: oldGeneration }));
  const changesAfterSwipe = changeEvents(emitted).length;
  instance.handleSwiperAnimationFinish(
    nativeSwiperEvent(instance, 4, { generation: oldGeneration })
  );
  const rebaseGeneration = instance.swiperGeneration;
  assert.equal(instance.swiperDuration, 0);

  instance.handleSwiperChange(nativeSwiperEvent(instance, 0, { generation: oldGeneration }));
  instance.handleSwiperAnimationFinish(nativeSwiperEvent(instance, 0, { generation: oldGeneration }));
  assert.equal(changeEvents(emitted).length, changesAfterSwipe);
  assert.equal(instance.currentIndex, 4);

  instance.handleSwiperAnimationFinish(
    nativeSwiperEvent(instance, instance.activeWindowIndex, { generation: rebaseGeneration, source: "" })
  );
  assert.equal(instance.swiperDuration, 220);
}
```

Call the new check from `runSequenceCheck()`.

- [ ] **Step 2: Run the viewer sequence check and verify RED**

Run:

```bash
node scripts/d31-album-viewer-sequence-check.js
```

Expected: FAIL because `swiperDuration` does not exist and the current template always uses 220 ms.

- [ ] **Step 3: Commit the failing regression test only**

```bash
git add scripts/d31-album-viewer-sequence-check.js
git commit -m "test: reproduce album rapid swipe rebase"
```

### Task 3: Make Internal Swiper Rebase Instantaneous

**Files:**
- Modify: `apps/miniprogram/src/components/AlbumImageViewer.vue`
- Test: `scripts/d31-album-viewer-sequence-check.js`

- [ ] **Step 1: Bind native swiper duration to generation state**

Replace the literal duration binding:

```vue
:duration="swiperDuration"
```

Add `internalRebaseGeneration: null` to component data and add:

```js
swiperDuration() {
  return this.internalRebaseGeneration === this.swiperGeneration ? 0 : 220;
}
```

- [ ] **Step 2: Mark only edge-window remounts as internal rebases**

Extend `rebuildWindowAt` with `internalRebase = false`. Immediately before incrementing `swiperGeneration`, set `internalRebaseGeneration` to the next generation only for an internal rebase; otherwise clear it.

```js
rebuildWindowAt(logicalIndex, { force = false, internalRebase = false } = {}) {
  // existing index and window calculations stay unchanged
  if (force || stateChanged) {
    const nextGeneration = this.swiperGeneration + 1;
    this.internalRebaseGeneration = internalRebase ? nextGeneration : null;
    this.swiperGeneration = nextGeneration;
  }
}
```

Call it from the matched edge completion as:

```js
this.rebuildWindowAt(this.currentIndex, { internalRebase: true });
```

- [ ] **Step 3: End internal positioning only on its own generation**

At the start of `handleSwiperAnimationFinish`, after validating the current generation, recognize the zero-duration generation, clear `internalRebaseGeneration`, and return without emitting or changing the logical index.

```js
if (this.internalRebaseGeneration === this.swiperGeneration) {
  this.internalRebaseGeneration = null;
  return;
}
```

Clear `internalRebaseGeneration` when the viewer closes or is reset.

- [ ] **Step 4: Run the sequence test and verify GREEN**

Run:

```bash
node scripts/d31-album-viewer-sequence-check.js
```

Expected: PASS, including the rapid rebase duration check and all existing full traversal, stale generation, media hydration, and mixed-video cases.

- [ ] **Step 5: Commit the swiper fix**

```bash
git add apps/miniprogram/src/components/AlbumImageViewer.vue scripts/d31-album-viewer-sequence-check.js
git commit -m "fix: make album window rebases instantaneous"
```

### Task 4: Verify Video State Ownership and the Full Mini-Program Contract

**Files:**
- Modify only if the focused test exposes a missing assertion: `scripts/d42-miniprogram-album-video-check.js`

- [ ] **Step 1: Run the focused mini-program checks**

Run:

```bash
node scripts/d42-miniprogram-album-video-check.js
node scripts/check-miniprogram.js
npm --workspace apps/miniprogram run build:mp-weixin
```

Expected: all checks pass and the production mini-program build completes.

- [ ] **Step 2: Run the combined D42 check**

Run:

```bash
npm run d42:check
```

Expected: API playback, video lifecycle, viewer wiring, and deletion checks all pass.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and no unrelated files.

### Task 5: Simulator Regression Verification

**Files:** None.

- [ ] **Step 1: Rebuild and refresh the WeChat simulator**

Run the development build if it is not already active, then refresh the existing project at `apps/miniprogram/dist/dev/mp-weixin`.

```bash
npm run dev:mp-weixin
```

Expected: the simulator reports `webview page ready` for `pages/session/album`.

- [ ] **Step 2: Verify complete video playback**

Open the same album video, play through its full duration, and observe both the player and debugger network state.

Expected: playback reaches the end without `视频加载失败，点击重试`; later byte-range requests do not receive COS authorization errors.

- [ ] **Step 3: Verify rapid bidirectional image swipes**

Open the 263-photo album and rapidly swipe forward and backward through multiple five-slide boundaries.

Expected: each finger gesture advances at most one logical photo, releasing the finger causes no extra forward/backward animation, and the counter matches the displayed image.

- [ ] **Step 4: Record final evidence**

Capture the final simulator screen, debugger error count, and exact commands run. If either manual reproduction fails, return to root-cause investigation instead of adding another workaround.
