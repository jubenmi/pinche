# Album Swiper Feedback Loop Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the album viewer from oscillating between adjacent photos after a fast swipe while preserving initial positioning, out-of-range correction, media hydration, and mixed image/video behavior.

**Architecture:** Treat `currentIndex` as observed native swiper state and `swiperIndex` as a programmatic positioning command. Add behavioral and static regression guards first, verify that they fail against the current feedback loop, then remove only the native-change write to `swiperIndex` and run focused, build, and runtime verification.

**Tech Stack:** Vue 3 Options API, UniApp, WeChat Mini Program native `swiper`, Node.js VM-based source checks, npm workspace build.

**Design reference:** `docs/superpowers/specs/2026-07-11-album-swiper-feedback-loop-fix-design.md`

---

## File Map

- `scripts/d31-album-viewer-sequence-check.js`: executable behavioral contract for viewer index, hydration, and emitted change order.
- `scripts/check-miniprogram.js`: static source contract preventing the feedback-loop assignment from returning.
- `apps/miniprogram/src/components/AlbumImageViewer.vue`: production viewer; only `handleSwiperChange()` changes.
- `apps/miniprogram/dist/**`: generated and gitignored; refresh for DevTools verification but do not commit.

### Task 1: Add the failing one-way index contract

**Files:**
- Modify: `scripts/d31-album-viewer-sequence-check.js:66-222`
- Modify: `scripts/check-miniprogram.js:2992-3009`

- [ ] **Step 1: Add a behavioral regression for rapid native change events**

Insert this function after `trackWrites()` in `scripts/d31-album-viewer-sequence-check.js`:

```js
function runNativeSwipeControlFeedbackCheck(component) {
  const { instance, emitted } = createInstance(component, makePhotos(6));

  instance.visible = true;
  component.watch.visible.call(instance, true, false);
  const swiperIndexWrites = trackWrites(instance, "swiperIndex");

  for (const current of [1, 2, 1, 2, 3]) {
    instance.handleSwiperChange({
      detail: {
        current,
        source: "touch"
      }
    });
  }

  assert(instance.currentIndex === 3, "Viewer currentIndex must follow the final native swipe event");
  assert(
    swiperIndexWrites.writes === 0,
    "Native swiper change events must not rewrite the programmatic swiperIndex command"
  );
  assert(
    instance.swiperIndex === 0,
    "Viewer swiperIndex must retain the opening command while native swipes report current pages"
  );

  const changeIndexes = emitted
    .filter((event) => event.event === "change")
    .map((event) => event.payload.index);
  assert(
    changeIndexes.join(",") === "1,2,1,2,3",
    "Viewer must preserve the native swipe event order while keeping control state one-way"
  );
}
```

Also insert this preservation check after `runNativeSwipeControlFeedbackCheck()`:

```js
function runProgrammaticPositioningCheck(component) {
  const { instance } = createInstance(component, makePhotos(6));

  instance.initialIndex = 3;
  instance.visible = true;
  component.watch.visible.call(instance, true, false);
  assert(instance.currentIndex === 3, "Viewer must observe the requested opening photo");
  assert(instance.swiperIndex === 3, "Viewer must command the requested opening photo");

  const previousPhotos = instance.photos;
  instance.photos = makePhotos(2);
  component.watch.photos.call(instance, instance.photos, previousPhotos);
  assert(instance.currentIndex === 1, "Viewer must clamp observed state after the photo list shrinks");
  assert(instance.swiperIndex === 1, "Viewer must command the clamped page after the photo list shrinks");
}
```

Replace the existing expectation at the end of `runFastSwipeHydrationCheck()` with:

```js
assert(instance.swiperIndex === 0, "Viewer swiperIndex must retain the opening command after a fast swipe");
```

Replace the first `swiperIndex` assertion inside the 1–20 loop with:

```js
assert(
  instance.swiperIndex === 0,
  `Viewer swiperIndex must not turn native swipe ${index + 1}/20 into a programmatic command`
);
```

Replace the post-hydration `swiperIndex` assertion inside the same loop with:

```js
assert(
  instance.swiperIndex === 0,
  `Viewer swiperIndex must remain unchanged after photo ${index + 1} media hydration`
);
```

Then call both new checks after the hydration check:

```js
runFastSwipeHydrationCheck(component);
runNativeSwipeControlFeedbackCheck(component);
runProgrammaticPositioningCheck(component);
```

- [ ] **Step 2: Change the static contract from mirroring to one-way ownership**

Replace the `albumViewerSwiperChangeSource` checks in `scripts/check-miniprogram.js` with:

```js
const albumViewerSwiperChangeSource = methodBody(albumImageViewerSource, "handleSwiperChange");
for (const requiredSwiperChangeText of [
  "event?.detail?.current",
  "this.currentIndex = nextIndex",
  'this.$emit("change"'
]) {
  if (!albumViewerSwiperChangeSource.includes(requiredSwiperChangeText)) {
    fail(`AlbumImageViewer must keep observed swipe state in sync: ${requiredSwiperChangeText}`);
  }
}
if (albumViewerSwiperChangeSource.includes("this.swiperIndex = nextIndex")) {
  fail("AlbumImageViewer native change handler must not rewrite the programmatic swiper index");
}
for (const commandMethodName of ["syncInitialIndex", "syncCurrentIndexAfterPhotosChange"]) {
  const commandMethodSource = methodBody(albumImageViewerSource, commandMethodName);
  if (!commandMethodSource.includes("this.swiperIndex = nextIndex")) {
    fail(`AlbumImageViewer ${commandMethodName} must retain programmatic swiper positioning`);
  }
}
```

Leave the existing `photos` watcher checks immediately below this block unchanged.

- [ ] **Step 3: Run both checks and verify the RED state**

Run:

```bash
node scripts/d31-album-viewer-sequence-check.js
```

Expected: exit code 1, including `Native swiper change events must not rewrite the programmatic swiperIndex command` or an earlier `Viewer swiperIndex must retain the opening command` assertion.

Run:

```bash
node scripts/check-miniprogram.js
```

Expected: exit code 1 with `AlbumImageViewer native change handler must not rewrite the programmatic swiper index`.

Do not change production code until both failures have been observed and are caused by `handleSwiperChange()` assigning `swiperIndex`.

### Task 2: Implement the minimal one-way state update

**Files:**
- Modify: `apps/miniprogram/src/components/AlbumImageViewer.vue:418-430`
- Test: `scripts/d31-album-viewer-sequence-check.js`
- Test: `scripts/check-miniprogram.js`

- [ ] **Step 1: Remove only the feedback assignment**

Make `handleSwiperChange()` exactly:

```js
handleSwiperChange(event) {
  const previousIndex = this.currentIndex;
  const nextIndex = this.clampIndex(event?.detail?.current || 0);
  if (previousIndex !== nextIndex) {
    this.pauseVideoAt(previousIndex);
  }
  this.currentIndex = nextIndex;
  this.$emit("change", {
    index: nextIndex,
    photo: this.photos[nextIndex] || null
  });
  this.$nextTick(() => this.requestCurrentVideoIfNeeded());
},
```

Do not modify `syncInitialIndex()` or `syncCurrentIndexAfterPhotosChange()`; those are the two intentional programmatic positioning paths.

- [ ] **Step 2: Run the focused behavioral check and verify GREEN**

Run:

```bash
node scripts/d31-album-viewer-sequence-check.js
```

Expected: exit code 0 and `AlbumImageViewer 1-20 sequence check passed`.

- [ ] **Step 3: Run the static source contract and verify GREEN**

Run:

```bash
node scripts/check-miniprogram.js
```

Expected: exit code 0 and `UniApp miniprogram check passed: 13 pages`.

- [ ] **Step 4: Verify mixed image/video integration did not regress**

Run:

```bash
node scripts/d42-miniprogram-album-video-check.js
```

Expected: exit code 0 and `D42 mini-program integration checks passed: upload, viewer, timeline, and auth boundaries`.

- [ ] **Step 5: Build the WeChat Mini Program**

Run:

```bash
npm run build:mp-weixin
```

Expected: exit code 0 and output containing `Build complete.`. Sass legacy API or `@import` deprecation warnings are acceptable; compilation errors are not.

- [ ] **Step 6: Review the exact change set**

Run:

```bash
git diff --check
git diff -- apps/miniprogram/src/components/AlbumImageViewer.vue scripts/d31-album-viewer-sequence-check.js scripts/check-miniprogram.js
```

Expected: `git diff --check` prints nothing. The production diff contains only removal of the `swiperIndex` assignment; the remaining diff is regression-test/static-contract coverage.

- [ ] **Step 7: Commit the tested fix**

```bash
git add apps/miniprogram/src/components/AlbumImageViewer.vue scripts/d31-album-viewer-sequence-check.js scripts/check-miniprogram.js
git commit -m "fix: stop album swiper feedback loop"
```

Expected: one commit containing exactly the three files above.

### Task 3: Verify the real 263-photo interaction

**Files:**
- Generated only: `apps/miniprogram/dist/dev/mp-weixin/**` (gitignored)
- No source changes expected

- [ ] **Step 1: Refresh the DevTools development build**

Run:

```bash
npm run dev:mp-weixin
```

Expected: output containing `Build complete. Watching for changes...`. Stop the watcher after the development output has been refreshed.

- [ ] **Step 2: Open the configured project in WeChat DevTools**

Run:

```bash
/Applications/wechatwebdevtools.app/Contents/MacOS/cli open --project /Users/dirui/Documents/pinche/apps/miniprogram
```

Expected: the project opens using `apps/miniprogram/project.config.json` and its `miniprogramRoot` points at `dist/dev/mp-weixin/`.

- [ ] **Step 3: Execute the approved manual interaction matrix**

Use the authenticated DevTools session or the same iPhone; do not run `/private/tmp/d31_swipe_capture.swift` or other system-level synthetic mouse scripts.

1. Enter the real `[冯厚敦·流芳] 相册` and confirm the viewer reports a total of 263 items.
2. Open an image, perform at least 20 rapid horizontal swipes, then release all touch input.
3. Observe the viewer for at least 10 seconds. The counter and image must remain on one final page and must not alternate between adjacent pages.
4. Repeat once in the opposite direction.
5. Verify image → image. If a video is present in the reachable sequence, also verify image → video and video → image.
6. Verify the close button, downward close gesture, explicit download button, and continued swiping after a single image load failure.

Expected: no autonomous page changes after release, no black-screen lock, and no regression in the listed controls.

If no authenticated DevTools/device session is available, record runtime acceptance as unverified and do not claim the bug fully resolved. If the same autonomous oscillation persists, stop without adding timers or locks and return to root-cause instrumentation for `change.detail.current/source` and media-update timing.

### Task 4: Final verification and handoff

**Files:**
- No source changes expected

- [ ] **Step 1: Re-run the deterministic verification set from a clean shell**

Run:

```bash
node scripts/d31-album-viewer-sequence-check.js
node scripts/check-miniprogram.js
node scripts/d42-miniprogram-album-video-check.js
npm run build:mp-weixin
```

Expected: all four commands exit 0 with the success messages specified in Task 2.

- [ ] **Step 2: Confirm repository state**

Run:

```bash
git status --short --branch
git show --stat --oneline --summary HEAD
```

Expected: no unstaged or staged source changes. `HEAD` is `fix: stop album swiper feedback loop` and lists only `AlbumImageViewer.vue`, `d31-album-viewer-sequence-check.js`, and `check-miniprogram.js`.

- [ ] **Step 3: Report evidence without overclaiming**

Report the removed feedback assignment, the observed RED failures, the passing automated commands, and the runtime result separately. If Task 3 could not run, explicitly state that device/DevTools verification remains for the user instead of calling the issue fully fixed.
