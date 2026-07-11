# Album Viewer Five-Slide Windowing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Limit the WeChat Mini Program album viewer to five mounted slides while preserving the full logical album, one-way swiper control, mixed image/video behavior, and stable rapid-swipe settling.

**Architecture:** AlbumImageViewer keeps a full logical index plus a five-photo physical window. Native change events map physical slots to logical indices, while animationfinish is the only path allowed to re-center and remount a generation-keyed swiper. The album page keeps the full logical array but updates only one photo/progress entry at a time and passes only current ±2 progress entries to the viewer.

**Tech Stack:** UniApp, Vue 3 Options API, WeChat Mini Program swiper, Node.js VM source harness, Vue reactive/computed, npm workspace build.

**Design reference:** docs/superpowers/specs/2026-07-12-album-viewer-windowing-design.md

---

## Active Contract

This is a design-first workflow. The approved design above is the source of truth.

- Mount at most five swiper-item nodes for any album length.
- Keep currentIndex logical and activeWindowIndex physical.
- Keep swiperIndex as a programmatic command; native change must not mirror into it.
- Rebuild only after a matching animationfinish at a window edge.
- Reject stale change and animationfinish events using data-generation.
- Preserve first/last boundaries without circular duplicates or timers.
- Keep page count, download, close, downward close, retry, video, and public payloads logical.
- Treat same-ID/order photo updates as media hydration, not a structural reset.
- Update only the matching preview photo and progress key.
- Limit preview media/progress to the current logical photo ±2.
- Prove complete 1 → 263 → 1 traversal and verify the real 263-item album in both directions.
- Do not change backend, auth, privacy, filtering, sorting, upload, sharing, zoom, rotation, or gesture architecture.

Conservative execution decision: a defensive photo-list reorder/removal corrects the viewer internally without emitting a synthetic user change. The current product does not edit the list while the viewer is open; normal parent synchronization continues to come from native swipe change events. Opening, media hydration, and window rebase also do not emit change.

The current parent changes initialIndex only inside openPhotoPreview, which immediately calls ensurePreviewMediaAround(currentIndex). The component-level dynamic initialIndex watcher therefore verifies programmatic positioning and mounted ±2 slides without adding a new preload event or changing the public interface.

## File Map

- Modify apps/miniprogram/src/components/AlbumImageViewer.vue
  - Owns logical/physical window state, generation validation, rebase timing, video lifecycle, counter, close, and download emission.
- Modify apps/miniprogram/src/pages/session/album.vue
  - Owns the full preview list, current ±2 media requests, targeted media hydration, and filtered viewer progress.
- Rewrite scripts/d31-album-viewer-sequence-check.js
  - Executable Options API state-machine checks, full traversal, media hydration, structure changes, video logic, and Vue reactivity checks.
- Modify scripts/check-miniprogram.js
  - Static guards for five-slide rendering, generation-safe event ownership, and targeted parent hot paths.
- Modify scripts/d42-miniprogram-album-video-check.js
  - Protects logical-index video rendering after the template switches to physical window slots.
- Update this plan file during execution
  - It is the task/progress board required by follow-spec-plan.

## Requirement-to-Task Map

| Requirement | Task |
| --- | --- |
| Maximum five mounted slides | Task 1 |
| Physical-to-logical mapping and one-way current command | Task 1 |
| Edge-only animationfinish rebase and generation rejection | Task 1 |
| 263-item forward/back traversal and true boundaries | Task 2 |
| Dynamic initial index, hydration, reorder/remove/empty | Task 2 |
| Logical mixed-video lifecycle | Task 2 |
| Targeted preview photo/progress updates and current ±2 | Task 3 |
| Static, mixed-media, and production build regression | Task 4 |
| Real 263-item forward/back 1/10/30-second stability | Task 5 |

### Task 1: Build the Core Five-Slide Swiper State Machine

**Status:** Completed

- **RED evidence:** D31 exited 1 with `AlbumImageViewer must expose computed.windowPhotos`; the mini-program static check exited 1 first with `AlbumImageViewer swiper template must render windowPhotos instead of the full photos list`; D42 exited 1 on the logical active-video binding regex. Follow-up review RED exited 1 with `reopening must use a generation distinct from the destroyed native swiper` (`actual: 0`, `expected: not 0`).
- **GREEN evidence:** `AlbumImageViewer core five-slide window sequence check passed`; `UniApp miniprogram check passed: 13 pages`; `D42 mini-program integration checks passed: upload, viewer, timeline, and auth boundaries`; `git diff --check` clean.
- **Spec-review follow-up:** Added full logical/physical state and exact-ID assertions for 0/1/2/5 photos plus a `windowPhotos` method-body slice guard. The three Task 1 checks remained GREEN with the outputs above, and `git diff --check` remained clean.
- **Quality-review finding and RED:** The verified old build emitted `<swiper key="{{c}}" class="album-image-viewer__swiper data-v-551b673a" current="{{d}}" data-generation="{{e}}" duration="{{220}}" bindchange="{{f}}" bindanimationfinish="{{g}}">`, so the source `:key` was only a plain WXML attribute. D31 then exited 1 with `AlbumImageViewer must expose computed.swiperGenerations`; the compiled guard exited 1 for missing `wx:for=` and `wx:key=`.
- **Compiled structural GREEN:** After the single-token keyed loop, `npm run build:mp-weixin` emitted `<swiper wx:for="{{b}}" wx:for-item="generation" wx:key="b" class="album-image-viewer__swiper data-v-41f20766" current="{{c}}" data-generation="{{generation.c}}" duration="{{220}}" bindchange="{{generation.d}}" bindanimationfinish="{{generation.e}}">`. The full D31 behavior check, static check, D42 check, and `git diff --check` all passed.

**Files:**
- Modify: scripts/d31-album-viewer-sequence-check.js
- Modify: scripts/check-miniprogram.js
- Modify: scripts/d42-miniprogram-album-video-check.js
- Modify: apps/miniprogram/src/components/AlbumImageViewer.vue
- Update: docs/superpowers/plans/2026-07-12-album-viewer-windowing.md

- [x] **Step 1: Replace the old global-index D31 harness with core window tests**

Replace scripts/d31-album-viewer-sequence-check.js with this core-stage script. It installs actual computed getters, gives every native event a string dataset generation, and tests window math plus deferred rebase.

~~~js
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const viewerPath = path.join(
  root,
  "apps/miniprogram/src/components/AlbumImageViewer.vue"
);
const viewerSource = fs.readFileSync(viewerPath, "utf8");
const viewerScript =
  viewerSource.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "";
const runtime = { pausedVideoIds: [] };

function loadViewer() {
  const context = {
    component: null,
    console,
    uni: {
      createVideoContext(id) {
        return {
          pause() {
            runtime.pausedVideoIds.push(id);
          }
        };
      }
    }
  };
  vm.runInNewContext(
    viewerScript.replace(/export\s+default/, "component ="),
    context,
    { filename: viewerPath }
  );
  return context.component;
}

const viewer = loadViewer();

function makePhotos(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    media_type: "image",
    thumbnail_display_url:
      "wxfile://album-thumb-" + String(index + 1) + ".jpg",
    preview_display_url: ""
  }));
}

function instantiateViewer(photos, initialIndex = 0) {
  const emitted = [];
  const instance = {
    ...viewer.data.call({}),
    visible: false,
    photos,
    initialIndex,
    allowDownload: true,
    mediaProgress: {},
    $nextTick(callback) {
      if (typeof callback === "function") {
        callback();
      }
      return Promise.resolve();
    },
    $emit(event, payload) {
      emitted.push({ event, payload });
    }
  };

  for (const [name, getter] of Object.entries(viewer.computed || {})) {
    Object.defineProperty(instance, name, {
      configurable: true,
      enumerable: true,
      get() {
        return getter.call(instance);
      }
    });
  }
  for (const [name, method] of Object.entries(viewer.methods || {})) {
    instance[name] = method.bind(instance);
  }
  return { instance, emitted };
}

function openViewer(photos, initialIndex = 0) {
  const created = instantiateViewer(photos, initialIndex);
  created.instance.visible = true;
  viewer.watch.visible.call(created.instance, true, false);
  return created;
}

function swiperEvent(
  instance,
  current,
  {
    generation = instance.swiperGeneration,
    source = "touch"
  } = {}
) {
  return {
    detail: { current, source },
    currentTarget: {
      dataset: { generation: String(generation) }
    }
  };
}

function dispatchChange(instance, current, options) {
  instance.handleSwiperChange(swiperEvent(instance, current, options));
}

function dispatchAnimationFinish(
  instance,
  current = instance.activeWindowIndex,
  options
) {
  instance.handleSwiperAnimationFinish(
    swiperEvent(instance, current, options)
  );
}

function plain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function changeEvents(emitted) {
  return emitted.filter(({ event }) => event === "change");
}

function windowSnapshot(instance) {
  return {
    currentIndex: instance.currentIndex,
    windowStart: instance.windowStart,
    activeWindowIndex: instance.activeWindowIndex,
    swiperIndex: instance.swiperIndex,
    swiperGeneration: instance.swiperGeneration,
    pendingWindowRebase: plain(instance.pendingWindowRebase),
    windowIds: Array.from(instance.windowPhotos, (photo) => photo.id)
  };
}

function assertWindow(
  instance,
  { current, start, active, swiper = active, ids }
) {
  assert.equal(instance.currentIndex, current);
  assert.equal(instance.windowStart, start);
  assert.equal(instance.activeWindowIndex, active);
  assert.equal(instance.swiperIndex, swiper);
  assert.deepEqual(
    Array.from(instance.windowPhotos, (photo) => photo.id),
    ids
  );
  assert.ok(
    instance.windowPhotos.length <= 5,
    "Viewer must render at most 5 swiper items"
  );
  if (instance.windowPhotos.length) {
    assert.equal(
      instance.windowStart + instance.activeWindowIndex,
      instance.currentIndex,
      "Viewer physical-to-logical invariant must hold"
    );
    assert.strictEqual(
      instance.windowPhotos[instance.activeWindowIndex],
      instance.photos[instance.currentIndex],
      "Viewer active window photo must match the active logical photo"
    );
  }
}

function runWindowMathCheck() {
  assert.equal(
    typeof viewer.computed?.windowPhotos,
    "function",
    "AlbumImageViewer must expose computed.windowPhotos"
  );
  const cases = [
    { count: 0, initial: 0, current: 0, start: 0, active: 0, ids: [] },
    { count: 1, initial: 0, current: 0, start: 0, active: 0, ids: [1] },
    { count: 2, initial: 1, current: 1, start: 0, active: 1, ids: [1, 2] },
    {
      count: 5,
      initial: 2,
      current: 2,
      start: 0,
      active: 2,
      ids: [1, 2, 3, 4, 5]
    },
    {
      count: 263,
      initial: 0,
      current: 0,
      start: 0,
      active: 0,
      ids: [1, 2, 3, 4, 5]
    },
    {
      count: 263,
      initial: 131,
      current: 131,
      start: 129,
      active: 2,
      ids: [130, 131, 132, 133, 134]
    },
    {
      count: 263,
      initial: 262,
      current: 262,
      start: 258,
      active: 4,
      ids: [259, 260, 261, 262, 263]
    }
  ];

  for (const testCase of cases) {
    const { instance, emitted } = openViewer(
      makePhotos(testCase.count),
      testCase.initial
    );
    assertWindow(instance, testCase);
    assert.equal(
      changeEvents(emitted).length,
      0,
      "Programmatic opening must not emit a user change"
    );
  }
}

function runRebaseAndGenerationCheck() {
  const { instance, emitted } = openViewer(makePhotos(10), 0);
  assert.equal(
    typeof instance.handleSwiperAnimationFinish,
    "function",
    "AlbumImageViewer must implement handleSwiperAnimationFinish"
  );
  const firstGeneration = instance.swiperGeneration;

  dispatchChange(instance, 3);
  assert.equal(instance.currentIndex, 3);
  assert.equal(instance.pendingWindowRebase, null);
  dispatchAnimationFinish(instance, 3);
  assert.equal(instance.swiperGeneration, firstGeneration);

  dispatchChange(instance, 4);
  assert.equal(instance.currentIndex, 4);
  assert.equal(
    instance.swiperGeneration,
    firstGeneration,
    "Edge change must not rebuild before animationfinish"
  );
  assert.deepEqual(
    plain(instance.pendingWindowRebase),
    { generation: firstGeneration, logicalIndex: 4 },
    "Viewer edge change must schedule a same-generation rebase"
  );

  dispatchAnimationFinish(instance, 3, {
    generation: firstGeneration
  });
  assert.equal(
    instance.swiperGeneration,
    firstGeneration,
    "A same-generation animationfinish for a different page must not rebase"
  );
  assert.equal(instance.windowStart, 0);

  const businessCount = changeEvents(emitted).length;
  dispatchAnimationFinish(instance, 4);
  assertWindow(instance, {
    current: 4,
    start: 2,
    active: 2,
    ids: [3, 4, 5, 6, 7]
  });
  assert.equal(instance.swiperGeneration, firstGeneration + 1);
  assert.equal(
    changeEvents(emitted).length,
    businessCount,
    "Window rebase must not emit a second business change"
  );

  dispatchChange(instance, 2, { source: "" });
  assert.equal(
    changeEvents(emitted).length,
    businessCount,
    "Same-page remount change must be idempotent"
  );

  const settled = windowSnapshot(instance);
  dispatchChange(instance, 0, { generation: firstGeneration });
  dispatchAnimationFinish(instance, 0, {
    generation: firstGeneration
  });
  assert.deepEqual(
    windowSnapshot(instance),
    settled,
    "Old-generation events must not mutate the current window"
  );

  const beforeEmptySourceMove = changeEvents(emitted).length;
  dispatchChange(instance, 3, { source: "" });
  assert.equal(instance.currentIndex, 5);
  assert.equal(
    changeEvents(emitted).length,
    beforeEmptySourceMove + 1,
    "An empty-source event with a different logical index must remain valid"
  );
}

runWindowMathCheck();
runRebaseAndGenerationCheck();
console.log("AlbumImageViewer core windowing checks passed");
~~~

- [x] **Step 2: Replace conflicting static contracts and add core RED guards**

In scripts/check-miniprogram.js:

1. Replace the two entries isActiveVideo(index) and v-if="isActiveVideo(index) && videoUrl(photo)" in requiredAlbumImageViewerVideoText with their logicalIndexForWindowIndex(windowIndex) forms shown below.
2. Replace the complete block beginning const albumViewerSwiperChangeSource and ending immediately before const albumViewerThumbnailUrlSource. This removes both old direct requirements for this.swiperIndex = nextIndex, including syncCurrentIndexAfterPhotosChange. Use this exact window contract:

~~~js
if (
  !albumImageViewerSource.includes(
    'v-for="(photo, windowIndex) in windowPhotos"'
  )
) {
  fail(
    "AlbumImageViewer swiper template must render windowPhotos instead of the full photos array"
  );
}
if (
  albumImageViewerSource.includes(
    'v-for="(photo, index) in photos"'
  )
) {
  fail(
    "AlbumImageViewer swiper template must not render the full photos array"
  );
}

for (const requiredWindowText of [
  ':key="swiperGeneration"',
  ':data-generation="swiperGeneration"',
  '@animationfinish="handleSwiperAnimationFinish"',
  "const ALBUM_VIEWER_WINDOW_SIZE = 5",
  "logicalIndexForWindowIndex(windowIndex)",
  "isActiveVideo(logicalIndexForWindowIndex(windowIndex))",
  "videoDomId(photo, logicalIndexForWindowIndex(windowIndex))"
]) {
  if (!albumImageViewerSource.includes(requiredWindowText)) {
    fail(
      "AlbumImageViewer must implement generation-safe five-slide windowing: " +
        requiredWindowText
    );
  }
}

const albumViewerWindowPhotosSource = methodBody(
  albumImageViewerSource,
  "windowPhotos"
);
for (const requiredText of [
  "this.photos.slice(",
  "this.windowStart + ALBUM_VIEWER_WINDOW_SIZE"
]) {
  if (!albumViewerWindowPhotosSource.includes(requiredText)) {
    fail(
      "AlbumImageViewer windowPhotos must slice at most five photos: " +
        requiredText
    );
  }
}

const albumViewerSwiperChangeSource = methodBody(
  albumImageViewerSource,
  "handleSwiperChange"
);
for (const requiredText of [
  "event?.detail?.current",
  "this.windowStart + windowIndex",
  "this.activeWindowIndex = windowIndex",
  "this.updatePendingWindowRebase",
  'this.$emit("change"'
]) {
  if (!albumViewerSwiperChangeSource.includes(requiredText)) {
    fail(
      "AlbumImageViewer native change must map physical to logical state: " +
        requiredText
    );
  }
}
for (const forbiddenText of [
  "this.swiperIndex =",
  "rebuildWindowAt",
  "this.swiperGeneration +="
]) {
  if (albumViewerSwiperChangeSource.includes(forbiddenText)) {
    fail(
      "AlbumImageViewer native change must defer command/rebuild work: " +
        forbiddenText
    );
  }
}

const albumViewerAnimationFinishSource = methodBody(
  albumImageViewerSource,
  "handleSwiperAnimationFinish"
);
for (const requiredText of [
  "this.isCurrentSwiperEvent(event)",
  "this.pendingWindowRebase",
  "this.windowStart + finishedWindowIndex",
  "finishedLogicalIndex !== pending.logicalIndex",
  "this.rebuildWindowAt(this.currentIndex)"
]) {
  if (!albumViewerAnimationFinishSource.includes(requiredText)) {
    fail(
      "AlbumImageViewer animationfinish must own generation-safe rebase: " +
        requiredText
    );
  }
}

const albumViewerSyncInitialIndexSource = methodBody(
  albumImageViewerSource,
  "syncInitialIndex"
);
if (
  !albumViewerSyncInitialIndexSource.includes(
    "this.rebuildWindowAt(nextIndex)"
  )
) {
  fail(
    "AlbumImageViewer initial positioning must create a physical window command"
  );
}
~~~

In scripts/d42-miniprogram-album-video-check.js, keep all existing assertions and append:

~~~js
assert.match(
  viewer,
  /v-if="isActiveVideo\(logicalIndexForWindowIndex\(windowIndex\)\) && videoUrl\(photo\)"/,
  "AlbumImageViewer active video must use the logical index"
);
assert.match(
  viewer,
  /:id="videoDomId\(photo,\s*logicalIndexForWindowIndex\(windowIndex\)\)"/,
  "AlbumImageViewer video DOM id fallback must use the logical index"
);
~~~

- [x] **Step 3: Run the behavioral, static, and mixed-video checks and record RED**

Run:

~~~bash
node scripts/d31-album-viewer-sequence-check.js
node scripts/check-miniprogram.js
node scripts/d42-miniprogram-album-video-check.js
~~~

Expected:

- D31 exits non-zero with AlbumImageViewer must expose computed.windowPhotos.
- check-miniprogram exits non-zero with the windowPhotos template message.
- D42 exits non-zero with AlbumImageViewer active video must use the logical index.

Do not edit production code until all three failures are observed and attributable to the full-list swiper.

- [x] **Step 4: Add the five-slide template and core state**

At the top of the component script, before export default, add:

~~~js
const ALBUM_VIEWER_WINDOW_SIZE = 5;
~~~

Change the swiper and item opening tags to:

~~~vue
<swiper
  :key="swiperGeneration"
  class="album-image-viewer__swiper"
  :data-generation="swiperGeneration"
  :current="swiperIndex"
  :duration="220"
  @change="handleSwiperChange"
  @animationfinish="handleSwiperAnimationFinish"
>
  <swiper-item
    v-for="(photo, windowIndex) in windowPhotos"
    :key="photoKey(photo, logicalIndexForWindowIndex(windowIndex))"
    class="album-image-viewer__item"
  >
~~~

Change only the active video and ID expressions inside that loop:

~~~vue
<video
  v-if="isActiveVideo(logicalIndexForWindowIndex(windowIndex)) && videoUrl(photo)"
  :id="videoDomId(photo, logicalIndexForWindowIndex(windowIndex))"
~~~

Add the window fields beside currentIndex/swiperIndex:

~~~js
currentIndex: 0,
windowStart: 0,
activeWindowIndex: 0,
swiperIndex: 0,
swiperGeneration: 0,
pendingWindowRebase: null,
~~~

Add windowPhotos before currentPhoto:

~~~js
windowPhotos() {
  return this.photos.slice(
    this.windowStart,
    this.windowStart + ALBUM_VIEWER_WINDOW_SIZE
  );
},
~~~

- [x] **Step 5: Implement core positioning, generation validation, and rebase**

Replace clampIndex and syncInitialIndex, then add the remaining methods immediately after them:

~~~js
clampIndex(index) {
  const maxIndex = Math.max(0, this.photos.length - 1);
  const parsed = Number(index);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(Math.max(0, Math.trunc(parsed)), maxIndex);
},
windowStartForIndex(index) {
  const nextIndex = this.clampIndex(index);
  const maxStart = Math.max(
    0,
    this.photos.length - ALBUM_VIEWER_WINDOW_SIZE
  );
  return Math.min(Math.max(nextIndex - 2, 0), maxStart);
},
clampWindowIndex(index) {
  const maxIndex = Math.max(0, this.windowPhotos.length - 1);
  const parsed = Number(index);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(Math.max(0, Math.trunc(parsed)), maxIndex);
},
logicalIndexForWindowIndex(windowIndex) {
  if (!this.windowPhotos.length) {
    return 0;
  }
  return this.windowStart + this.clampWindowIndex(windowIndex);
},
rebuildWindowAt(logicalIndex, { force = false } = {}) {
  const nextIndex = this.photos.length
    ? this.clampIndex(logicalIndex)
    : 0;
  const nextWindowStart = this.photos.length
    ? this.windowStartForIndex(nextIndex)
    : 0;
  const nextWindowIndex = this.photos.length
    ? nextIndex - nextWindowStart
    : 0;
  const changed =
    nextIndex !== this.currentIndex ||
    nextWindowStart !== this.windowStart ||
    nextWindowIndex !== this.activeWindowIndex ||
    nextWindowIndex !== this.swiperIndex;

  this.pendingWindowRebase = null;
  this.currentIndex = nextIndex;
  this.windowStart = nextWindowStart;
  this.activeWindowIndex = nextWindowIndex;
  this.swiperIndex = nextWindowIndex;
  if (force || changed) {
    this.swiperGeneration += 1;
  }
},
syncInitialIndex(shouldPausePrevious = false) {
  const previousIndex = this.currentIndex;
  const nextIndex = this.clampIndex(this.initialIndex);
  if (shouldPausePrevious && previousIndex !== nextIndex) {
    this.pauseVideoAt(previousIndex);
  }
  this.rebuildWindowAt(nextIndex);
},
isCurrentSwiperEvent(event) {
  const generation = Number(
    event?.currentTarget?.dataset?.generation
  );
  return (
    Number.isFinite(generation) &&
    generation === this.swiperGeneration
  );
},
updatePendingWindowRebase(windowIndex, logicalIndex) {
  const hasBefore =
    windowIndex === 0 && this.windowStart > 0;
  const hasAfter =
    windowIndex === this.windowPhotos.length - 1 &&
    this.windowStart + this.windowPhotos.length < this.photos.length;
  this.pendingWindowRebase =
    hasBefore || hasAfter
      ? {
          generation: this.swiperGeneration,
          logicalIndex
        }
      : null;
},
~~~

In the visible watcher, call syncInitialIndex(false), clear pending on close, and in the initialIndex watcher call syncInitialIndex(true). Keep the existing nextTick video request:

~~~js
visible(nextValue, previousValue) {
  if (nextValue && !previousValue) {
    this.resetImageStates();
    this.syncInitialIndex(false);
    this.$nextTick(() => this.requestCurrentVideoIfNeeded());
  }
  if (!nextValue) {
    this.pendingWindowRebase = null;
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.pauseAllVideos();
  }
},
initialIndex() {
  if (this.visible) {
    this.syncInitialIndex(true);
    this.$nextTick(() => this.requestCurrentVideoIfNeeded());
  }
},
~~~

Replace handleSwiperChange and add handleSwiperAnimationFinish after it:

~~~js
handleSwiperChange(event) {
  if (!this.isCurrentSwiperEvent(event) || !this.windowPhotos.length) {
    return;
  }
  const windowIndex = this.clampWindowIndex(
    event?.detail?.current
  );
  const nextIndex = this.windowStart + windowIndex;
  const previousIndex = this.currentIndex;

  this.activeWindowIndex = windowIndex;
  this.updatePendingWindowRebase(windowIndex, nextIndex);
  if (nextIndex === previousIndex) {
    return;
  }

  this.pauseVideoAt(previousIndex);
  this.currentIndex = nextIndex;
  this.$emit("change", {
    index: nextIndex,
    photo: this.photos[nextIndex] || null
  });
  this.$nextTick(() => this.requestCurrentVideoIfNeeded());
},
handleSwiperAnimationFinish(event) {
  if (!this.isCurrentSwiperEvent(event)) {
    return;
  }
  const pending = this.pendingWindowRebase;
  const finishedWindowIndex = this.clampWindowIndex(
    event?.detail?.current
  );
  const finishedLogicalIndex =
    this.windowStart + finishedWindowIndex;
  if (
    !pending ||
    pending.generation !== this.swiperGeneration ||
    pending.logicalIndex !== this.currentIndex ||
    finishedLogicalIndex !== pending.logicalIndex
  ) {
    return;
  }
  const nextWindowStart = this.windowStartForIndex(
    this.currentIndex
  );
  if (nextWindowStart === this.windowStart) {
    this.pendingWindowRebase = null;
    return;
  }
  this.rebuildWindowAt(this.currentIndex);
},
~~~

The native change method must not assign swiperIndex, windowStart, or swiperGeneration and must not call rebuildWindowAt.

- [x] **Step 6: Run core checks and verify GREEN**

Run:

~~~bash
node scripts/d31-album-viewer-sequence-check.js
node scripts/check-miniprogram.js
node scripts/d42-miniprogram-album-video-check.js
~~~

Expected:

- AlbumImageViewer core windowing checks passed.
- UniApp miniprogram check passed: 13 pages.
- D42 mini-program integration checks passed: upload, viewer, timeline, and auth boundaries.

- [x] **Step 7: Review and commit the green core state machine**

Run:

~~~bash
git diff --check
git diff -- apps/miniprogram/src/components/AlbumImageViewer.vue scripts/d31-album-viewer-sequence-check.js scripts/check-miniprogram.js scripts/d42-miniprogram-album-video-check.js
~~~

Expected: no whitespace errors; production template renders windowPhotos; only animationfinish calls rebuildWindowAt after native interaction.

Commit:

~~~bash
git add apps/miniprogram/src/components/AlbumImageViewer.vue scripts/d31-album-viewer-sequence-check.js scripts/check-miniprogram.js scripts/d42-miniprogram-album-video-check.js docs/superpowers/plans/2026-07-12-album-viewer-windowing.md
git commit -m "fix: window album viewer slides"
~~~

### Task 2: Cover Full Traversal, Structure Changes, Hydration, and Video

**Status:** Completed

- **RED evidence:** `node scripts/d31-album-viewer-sequence-check.js` exited 1 at `photos reorder must preserve the active photo by stable ID` (`actual: 131`, `expected: 132`). `node scripts/check-miniprogram.js` exited 1 with `AlbumImageViewer photos watcher must distinguish hydration from structure changes` plus missing `this.samePhotoStructure`, `previousPhotos[previousIndex]`, `this.pauseVideoPhoto`, and `this.rebuildWindowAt(nextIndex, { force: true })`.
- **GREEN evidence:** `node scripts/d31-album-viewer-sequence-check.js` exited 0 with `AlbumImageViewer windowing checks passed`; `node scripts/check-miniprogram.js` exited 0 with `UniApp miniprogram check passed: 13 pages`; `node scripts/d42-miniprogram-album-video-check.js` exited 0 with `D42 mini-program integration checks passed: upload, viewer, timeline, and auth boundaries`; `npm run build:mp-weixin` exited 0 with `DONE Build complete`; the compiled WXML retained the generation-keyed structural `wx:for`/`wx:key` swiper remount; `git diff --check` exited 0.

**Files:**
- Modify: scripts/d31-album-viewer-sequence-check.js
- Modify: scripts/check-miniprogram.js
- Modify: apps/miniprogram/src/components/AlbumImageViewer.vue
- Update: docs/superpowers/plans/2026-07-12-album-viewer-windowing.md

- [x] **Step 1: Add traversal and lifecycle helpers to D31**

Insert after dispatchAnimationFinish:

~~~js
function applyPhotos(instance, nextPhotos) {
  const previousPhotos = instance.photos;
  instance.photos = nextPhotos;
  viewer.watch.photos.call(
    instance,
    nextPhotos,
    previousPhotos
  );
}

function swipeOneLogicalStep(instance, emitted, direction) {
  const expectedIndex = instance.currentIndex + direction;
  const nextWindowIndex =
    instance.activeWindowIndex + direction;
  assert.ok(
    nextWindowIndex >= 0 &&
      nextWindowIndex < instance.windowPhotos.length,
    "Viewer must expose the next logical neighbor"
  );

  const generation = instance.swiperGeneration;
  dispatchChange(instance, nextWindowIndex);
  assert.equal(instance.currentIndex, expectedIndex);

  if (instance.pendingWindowRebase) {
    const eventCount = changeEvents(emitted).length;
    dispatchAnimationFinish(instance, nextWindowIndex, {
      generation
    });
    assert.equal(instance.swiperGeneration, generation + 1);
    assert.equal(instance.currentIndex, expectedIndex);
    dispatchChange(instance, instance.activeWindowIndex, {
      source: ""
    });
    assert.equal(
      changeEvents(emitted).length,
      eventCount,
      "Remount must not duplicate a logical change"
    );
  }
  assert.ok(instance.windowPhotos.length <= 5);
  assert.equal(
    instance.windowStart + instance.activeWindowIndex,
    instance.currentIndex
  );
}
~~~

Insert these complete checks before the call block:

~~~js
function runDynamicInitialIndexCheck() {
  const { instance, emitted } = openViewer(makePhotos(263), 0);
  const generation = instance.swiperGeneration;
  instance.initialIndex = 262;
  viewer.watch.initialIndex.call(instance, 262, 0);
  assertWindow(instance, {
    current: 262,
    start: 258,
    active: 4,
    ids: [259, 260, 261, 262, 263]
  });
  assert.equal(instance.swiperGeneration, generation + 1);
  assert.equal(changeEvents(emitted).length, 0);
}

function runFullTraversalCheck() {
  const { instance, emitted } = openViewer(makePhotos(263), 0);
  for (let index = 1; index < 263; index += 1) {
    swipeOneLogicalStep(instance, emitted, 1);
  }
  assert.equal(instance.currentIndex, 262);
  const lastGeneration = instance.swiperGeneration;
  dispatchAnimationFinish(instance);
  assert.equal(instance.swiperGeneration, lastGeneration);

  for (let index = 261; index >= 0; index -= 1) {
    swipeOneLogicalStep(instance, emitted, -1);
  }
  assert.equal(instance.currentIndex, 0);
  const firstGeneration = instance.swiperGeneration;
  dispatchAnimationFinish(instance);
  assert.equal(instance.swiperGeneration, firstGeneration);

  const actual = changeEvents(emitted).map(
    ({ payload }) => payload.index
  );
  const expected = [
    ...Array.from({ length: 262 }, (_, index) => index + 1),
    ...Array.from({ length: 262 }, (_, index) => 261 - index)
  ];
  assert.deepEqual(
    actual,
    expected,
    "Viewer must visit 1 through 263 and back without gaps"
  );
}

function runPhotosChangeCheck() {
  const photos = makePhotos(263);
  const hydratedCase = openViewer(photos, 131);
  const beforeHydration = windowSnapshot(
    hydratedCase.instance
  );
  const hydrated = photos.map((photo) =>
    photo.id === 132
      ? {
          ...photo,
          preview_display_url:
            "wxfile://hydrated-132.jpg"
        }
      : photo
  );
  applyPhotos(hydratedCase.instance, hydrated);
  assert.deepEqual(
    windowSnapshot(hydratedCase.instance),
    beforeHydration,
    "Media hydration must not reset the window"
  );
  assert.equal(
    hydratedCase.instance.currentPhoto.preview_display_url,
    "wxfile://hydrated-132.jpg"
  );

  const reorderCase = openViewer(photos, 131);
  const reorderGeneration =
    reorderCase.instance.swiperGeneration;
  const activePhoto = photos[131];
  const remaining = photos.filter(
    (photo) => photo.id !== activePhoto.id
  );
  const reordered = [
    ...remaining.slice(0, 10),
    activePhoto,
    ...remaining.slice(10)
  ];
  applyPhotos(reorderCase.instance, reordered);
  assertWindow(reorderCase.instance, {
    current: 10,
    start: 8,
    active: 2,
    ids: [9, 10, 132, 11, 12]
  });
  assert.equal(
    reorderCase.instance.swiperGeneration,
    reorderGeneration + 1
  );
  assert.equal(
    changeEvents(reorderCase.emitted).length,
    0,
    "Defensive structure recovery must not forge a user change"
  );

  const removeCase = openViewer(photos, 131);
  const removeGeneration =
    removeCase.instance.swiperGeneration;
  applyPhotos(
    removeCase.instance,
    photos.filter((photo) => photo.id !== 132)
  );
  assert.equal(removeCase.instance.currentIndex, 131);
  assert.equal(removeCase.instance.currentPhoto.id, 133);
  assert.equal(
    removeCase.instance.swiperGeneration,
    removeGeneration + 1
  );

  const videoPhotos = makePhotos(3);
  videoPhotos[1] = {
    ...videoPhotos[1],
    media_type: "video",
    video_display_url: "wxfile://video-2.mp4"
  };
  const emptyCase = openViewer(videoPhotos, 1);
  const emptyGeneration =
    emptyCase.instance.swiperGeneration;
  runtime.pausedVideoIds.length = 0;
  applyPhotos(emptyCase.instance, []);
  assertWindow(emptyCase.instance, {
    current: 0,
    start: 0,
    active: 0,
    ids: []
  });
  assert.equal(
    emptyCase.instance.swiperGeneration,
    emptyGeneration + 1
  );
  assert.equal(emptyCase.instance.pendingWindowRebase, null);
  assert.ok(
    runtime.pausedVideoIds.includes(
      "album-image-viewer-video-2"
    ),
    "Emptying the list must pause the previous active video"
  );
  assert.equal(changeEvents(emptyCase.emitted).length, 0);
}

function runMixedVideoWindowCheck() {
  const photos = makePhotos(8);
  photos[4] = {
    ...photos[4],
    media_type: "video",
    video_display_url: ""
  };
  const { instance, emitted } = openViewer(photos, 0);
  dispatchChange(instance, 4);
  assert.equal(instance.currentIndex, 4);
  assert.equal(instance.isActiveVideo(4), true);
  assert.equal(instance.isActiveVideo(2), false);

  const needVideo = emitted.filter(
    ({ event }) => event === "need-video"
  );
  assert.equal(needVideo.length, 1);
  assert.equal(needVideo[0].payload.index, 4);
  assert.equal(needVideo[0].payload.photo.id, 5);

  dispatchAnimationFinish(instance, 4);
  dispatchChange(instance, instance.activeWindowIndex, {
    source: ""
  });
  assert.equal(
    emitted.filter(({ event }) => event === "need-video").length,
    1,
    "Remount must not duplicate need-video"
  );

  instance.handleVideoError(instance.currentPhoto);
  const videoError = emitted.find(
    ({ event }) => event === "video-error"
  );
  assert.equal(videoError.payload.index, 4);
  instance.retryVideo(instance.currentPhoto);
  const retry = emitted
    .filter(({ event }) => event === "need-video")
    .at(-1);
  assert.equal(retry.payload.index, 4);
  assert.equal(retry.payload.retry, true);

  const generation = instance.swiperGeneration;
  applyPhotos(
    instance,
    instance.photos.map((photo) =>
      photo.id === 5
        ? {
            ...photo,
            video_display_url:
              "wxfile://video-5.mp4"
          }
        : photo
    )
  );
  assert.equal(instance.swiperGeneration, generation);

  runtime.pausedVideoIds.length = 0;
  dispatchChange(instance, 3);
  assert.equal(instance.currentIndex, 5);
  assert.ok(
    runtime.pausedVideoIds.includes(
      "album-image-viewer-video-5"
    )
  );
}

function runCurrentMediaStateCheck() {
  const { instance, emitted } = openViewer(makePhotos(10), 4);
  const photo = instance.currentPhoto;
  instance.mediaProgress = {
    [String(photo.id) + ":thumbnail"]: {
      loading: true,
      failed: false,
      progress: 36
    }
  };
  assert.equal(instance.showLoading(photo), true);
  assert.equal(instance.loadingProgressValue(photo), 36);
  instance.handleThumbnailLoad(photo);
  assert.equal(instance.thumbnailLoaded(photo), true);

  const generation = instance.swiperGeneration;
  applyPhotos(
    instance,
    instance.photos.map((item) =>
      item.id === photo.id
        ? {
            ...item,
            preview_display_url:
              "wxfile://album-preview-5.jpg"
          }
        : item
    )
  );
  assert.equal(instance.swiperGeneration, generation);
  const hydrated = instance.currentPhoto;
  assert.equal(instance.previewCanLoad(hydrated), true);
  instance.handlePreviewLoad(hydrated);
  assert.equal(instance.previewLoaded(hydrated), true);
  instance.requestDownload("button");
  const download = emitted.find(
    ({ event }) => event === "download"
  );
  assert.equal(download.payload.index, 4);
  assert.equal(download.payload.photo.id, 5);
}
~~~

Replace the final call block with:

~~~js
runWindowMathCheck();
runRebaseAndGenerationCheck();
runDynamicInitialIndexCheck();
runFullTraversalCheck();
runPhotosChangeCheck();
runMixedVideoWindowCheck();
runCurrentMediaStateCheck();
console.log("AlbumImageViewer windowing checks passed");
~~~

- [x] **Step 2: Run D31 and verify the structure RED**

Run:

~~~bash
node scripts/d31-album-viewer-sequence-check.js
~~~

Expected: exit non-zero at Viewer photos reorder must preserve the active photo by stable ID, the empty-list pause assertion, or an earlier structure assertion. Core window checks before that point remain green.

- [x] **Step 3: Implement ID-aware structure synchronization and old-video pause**

Change the photos watcher to pass both arrays:

~~~js
photos(nextPhotos, previousPhotos) {
  if (this.visible) {
    this.syncCurrentIndexAfterPhotosChange(
      nextPhotos,
      previousPhotos
    );
    this.$nextTick(() => this.requestCurrentVideoIfNeeded());
  }
}
~~~

Replace syncCurrentIndexAfterPhotosChange and add the identity helpers before resetImageStates:

~~~js
photoIdentityKey(photo, index) {
  if (!photo) {
    return "";
  }
  if (photo.id !== undefined && photo.id !== null) {
    return "id:" + String(photo.id);
  }
  return "index:" + String(index);
},
samePhotoStructure(nextPhotos = [], previousPhotos = []) {
  if (nextPhotos === previousPhotos) {
    return true;
  }
  if (nextPhotos.length !== previousPhotos.length) {
    return false;
  }
  return nextPhotos.every(
    (photo, index) =>
      this.photoIdentityKey(photo, index) ===
      this.photoIdentityKey(previousPhotos[index], index)
  );
},
syncCurrentIndexAfterPhotosChange(
  nextPhotos = [],
  previousPhotos = []
) {
  if (this.samePhotoStructure(nextPhotos, previousPhotos)) {
    return;
  }

  const previousIndex = this.currentIndex;
  const previousPhoto = previousPhotos[previousIndex] || null;
  const previousIdentity = this.photoIdentityKey(
    previousPhoto,
    previousIndex
  );
  let nextIndex = -1;
  if (previousIdentity) {
    nextIndex = nextPhotos.findIndex(
      (photo, index) =>
        this.photoIdentityKey(photo, index) ===
        previousIdentity
    );
  }
  if (nextIndex < 0) {
    nextIndex = this.clampIndex(previousIndex);
  }

  const nextPhoto = nextPhotos[nextIndex] || null;
  const nextIdentity = this.photoIdentityKey(
    nextPhoto,
    nextIndex
  );
  if (previousPhoto && previousIdentity !== nextIdentity) {
    this.pauseVideoPhoto(previousPhoto, previousIndex);
  }
  this.rebuildWindowAt(nextIndex, { force: true });
},
~~~

Replace pauseVideoAt with a photo-aware helper plus the wrapper:

~~~js
pauseVideoPhoto(photo, logicalIndex) {
  if (!this.isVideo(photo) || !this.videoUrl(photo)) {
    return;
  }
  const videoContext = this.createVideoContext(
    photo,
    logicalIndex
  );
  if (
    !videoContext ||
    typeof videoContext.pause !== "function"
  ) {
    return;
  }
  try {
    videoContext.pause();
  } catch (error) {
    // The generation change may already have removed the node.
  }
},
pauseVideoAt(index) {
  this.pauseVideoPhoto(this.photos[index], index);
},
~~~

Add logicalIndexForPhoto after logicalIndexForWindowIndex and use it in video error/retry payloads:

~~~js
logicalIndexForPhoto(photo) {
  if (!photo || photo.id === undefined || photo.id === null) {
    return this.currentIndex;
  }
  const key = String(photo.id);
  const index = this.photos.findIndex(
    (item) => String(item?.id) === key
  );
  return index >= 0 ? index : this.currentIndex;
},
~~~

~~~js
handleVideoError(photo) {
  this.$emit("video-error", {
    index: this.logicalIndexForPhoto(photo),
    photo
  });
},
retryVideo(photo) {
  this.setPhotoState("videoFailedById", photo, false);
  this.$emit("need-video", {
    index: this.logicalIndexForPhoto(photo),
    photo,
    retry: true
  });
},
~~~

- [x] **Step 4: Strengthen static structure guards**

In scripts/check-miniprogram.js, replace the old photos watcher assertions with:

~~~js
const albumViewerPhotosWatcherSource = methodBody(
  albumImageViewerSource,
  "photos"
);
if (
  !albumViewerPhotosWatcherSource.includes(
    "syncCurrentIndexAfterPhotosChange("
  ) ||
  !albumViewerPhotosWatcherSource.includes("nextPhotos") ||
  !albumViewerPhotosWatcherSource.includes("previousPhotos")
) {
  fail(
    "AlbumImageViewer photos watcher must distinguish hydration from structure changes"
  );
}

const albumViewerPhotosSyncSource = methodBody(
  albumImageViewerSource,
  "syncCurrentIndexAfterPhotosChange"
);
for (const requiredText of [
  "this.samePhotoStructure",
  "previousPhotos[previousIndex]",
  "this.pauseVideoPhoto",
  "this.rebuildWindowAt(nextIndex, { force: true })"
]) {
  if (!albumViewerPhotosSyncSource.includes(requiredText)) {
    fail(
      "AlbumImageViewer structure sync is missing " +
        requiredText
    );
  }
}
~~~

- [x] **Step 5: Run component regression checks and verify GREEN**

Run:

~~~bash
node scripts/d31-album-viewer-sequence-check.js
node scripts/check-miniprogram.js
node scripts/d42-miniprogram-album-video-check.js
~~~

Expected:

- AlbumImageViewer windowing checks passed.
- UniApp miniprogram check passed: 13 pages.
- D42 mini-program integration checks passed: upload, viewer, timeline, and auth boundaries.

- [x] **Step 6: Review and commit lifecycle coverage**

Run:

~~~bash
git diff --check
git diff -- apps/miniprogram/src/components/AlbumImageViewer.vue scripts/d31-album-viewer-sequence-check.js scripts/check-miniprogram.js
~~~

Commit:

~~~bash
git add apps/miniprogram/src/components/AlbumImageViewer.vue scripts/d31-album-viewer-sequence-check.js scripts/check-miniprogram.js docs/superpowers/plans/2026-07-12-album-viewer-windowing.md
git commit -m "test: cover album viewer window lifecycle"
~~~

### Task 3: Narrow Parent Media and Progress Hot Paths

**Files:**
- Modify: scripts/d31-album-viewer-sequence-check.js
- Modify: scripts/check-miniprogram.js
- Modify: apps/miniprogram/src/pages/session/album.vue
- Update: docs/superpowers/plans/2026-07-12-album-viewer-windowing.md

- [ ] **Step 1: Add real Vue reactivity and parent method extraction to D31**

Add this import:

~~~js
import { computed as vueComputed, reactive } from "vue";
~~~

Add the album source and exact method extractor after viewerSource:

~~~js
const albumPath = path.join(
  root,
  "apps/miniprogram/src/pages/session/album.vue"
);
const albumSource = fs.readFileSync(albumPath, "utf8");

function methodDefinition(source, name) {
  const patterns = [
    new RegExp(
      "async\\s+" + name + "\\s*\\(([^)]*)\\)\\s*\\{"
    ),
    new RegExp(name + "\\s*\\(([^)]*)\\)\\s*\\{")
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match || match.index === undefined) {
      continue;
    }
    const start = match.index + match[0].length;
    let depth = 1;
    for (let index = start; index < source.length; index += 1) {
      if (source[index] === "{") {
        depth += 1;
      } else if (source[index] === "}") {
        depth -= 1;
      }
      if (depth === 0) {
        return {
          parameters: match[1],
          body: source.slice(start, index)
        };
      }
    }
  }
  return null;
}

function methodFromSource(source, name) {
  const definition = methodDefinition(source, name);
  assert.ok(definition, "Missing source method: " + name);
  return new Function(
    "return function(" +
      definition.parameters +
      ") {" +
      definition.body +
      "}"
  )();
}
~~~

Insert this complete parent check before the call block:

~~~js
function runAlbumPageMediaWindowCheck() {
  const getPreviewMediaProgress = methodFromSource(
    albumSource,
    "previewMediaProgress"
  );
  const setAlbumMediaProgress = methodFromSource(
    albumSource,
    "setAlbumMediaProgress"
  );
  const updatePreviewPhotoDisplayMedia = methodFromSource(
    albumSource,
    "updatePreviewPhotoDisplayMedia"
  );
  const ensurePreviewMediaAround = methodFromSource(
    albumSource,
    "ensurePreviewMediaAround"
  );

  const photos = makePhotos(7);
  photos[3] = {
    ...photos[3],
    media_type: "video",
    cover_url: "wxfile://album-video-cover-4.jpg"
  };
  const mediaProgressById = {};
  for (const photo of photos) {
    for (const variant of ["thumbnail", "preview"]) {
      mediaProgressById[
        String(photo.id) + ":" + variant
      ] = {
        loading: true,
        progress: photo.id
      };
    }
  }

  const requests = [];
  const state = reactive({
    previewPhotos: photos,
    previewCurrentIndex: 3,
    mediaProgressById,
    visiblePhotoMedia: {},
    albumMediaProgressKey(photoId, variant = "preview") {
      return String(photoId) + ":" + variant;
    },
    loadVisiblePhotoMedia(photo, variant) {
      requests.push(String(photo.id) + ":" + variant);
      return Promise.resolve("");
    }
  });

  let getterRuns = 0;
  const filteredProgress = vueComputed(() => {
    getterRuns += 1;
    return getPreviewMediaProgress.call(state);
  });
  const expectedMiddleKeys = [2, 3, 4, 5, 6]
    .flatMap((id) => [
      String(id) + ":thumbnail",
      String(id) + ":preview"
    ])
    .sort();
  const initialProgress = filteredProgress.value;
  assert.deepEqual(
    Object.keys(initialProgress).sort(),
    expectedMiddleKeys
  );
  assert.equal(getterRuns, 1);

  const progressRoot = state.mediaProgressById;
  setAlbumMediaProgress.call(
    state,
    1,
    "thumbnail",
    { progress: 71 }
  );
  assert.strictEqual(state.mediaProgressById, progressRoot);
  assert.strictEqual(filteredProgress.value, initialProgress);
  assert.equal(getterRuns, 1);

  setAlbumMediaProgress.call(
    state,
    3,
    "preview",
    { progress: 83 }
  );
  assert.notStrictEqual(
    filteredProgress.value,
    initialProgress
  );
  assert.equal(
    filteredProgress.value["3:preview"].progress,
    83
  );
  assert.equal(getterRuns, 2);

  const photosRoot = state.previewPhotos;
  const previousItems = [...state.previewPhotos];
  updatePreviewPhotoDisplayMedia.call(state, 4, {
    video_display_url: "wxfile://album-video-4.mp4"
  });
  assert.strictEqual(state.previewPhotos, photosRoot);
  assert.notStrictEqual(
    state.previewPhotos[3],
    previousItems[3]
  );
  assert.ok(
    state.previewPhotos.every(
      (photo, index) =>
        index === 3 || photo === previousItems[index]
    )
  );

  function requestsFor(center) {
    requests.length = 0;
    state.visiblePhotoMedia = {};
    ensurePreviewMediaAround.call(state, center);
    return {
      entries: [...requests],
      ids: [
        ...new Set(
          requests.map((entry) =>
            Number(entry.split(":")[0])
          )
        )
      ].sort((left, right) => left - right)
    };
  }

  const startRequests = requestsFor(0);
  assert.deepEqual(startRequests.ids, [1, 2, 3]);
  const middleRequests = requestsFor(3);
  assert.deepEqual(middleRequests.ids, [2, 3, 4, 5, 6]);
  assert.ok(middleRequests.entries.includes("4:thumbnail"));
  assert.ok(!middleRequests.entries.includes("4:preview"));
  const endRequests = requestsFor(6);
  assert.deepEqual(endRequests.ids, [5, 6, 7]);

  state.previewCurrentIndex = 0;
  assert.deepEqual(
    Object.keys(filteredProgress.value).sort(),
    [1, 2, 3]
      .flatMap((id) => [
        String(id) + ":thumbnail",
        String(id) + ":preview"
      ])
      .sort()
  );
  state.previewCurrentIndex = 6;
  assert.deepEqual(
    Object.keys(filteredProgress.value).sort(),
    [5, 6, 7]
      .flatMap((id) => [
        String(id) + ":thumbnail",
        String(id) + ":preview"
      ])
      .sort()
  );
}
~~~

Add runAlbumPageMediaWindowCheck() before the success log.

- [ ] **Step 2: Add parent hot-path static guards**

In scripts/check-miniprogram.js, first replace the requiredAlbumMediaProgressText entry :media-progress="mediaProgressById" with :media-progress="previewMediaProgress". Then add:

~~~js
if (
  !albumSource.includes(
    ':media-progress="previewMediaProgress"'
  )
) {
  fail(
    "Album preview must pass previewMediaProgress to AlbumImageViewer"
  );
}
if (
  albumSource.includes(
    ':media-progress="mediaProgressById"'
  )
) {
  fail(
    "Album preview must not pass the full media progress map"
  );
}

const previewMediaProgressSource = methodBody(
  albumSource,
  "previewMediaProgress"
);
for (const requiredText of [
  "this.previewCurrentIndex",
  "this.previewPhotos",
  '["thumbnail", "preview"]',
  "this.mediaProgressById[key]"
]) {
  if (!previewMediaProgressSource.includes(requiredText)) {
    fail(
      "Album preview progress window is missing " +
        requiredText
    );
  }
}

const setAlbumMediaProgressSource = methodBody(
  albumSource,
  "setAlbumMediaProgress"
);
if (
  !setAlbumMediaProgressSource.includes(
    "this.mediaProgressById[key] ="
  ) ||
  setAlbumMediaProgressSource.includes(
    "this.mediaProgressById ="
  )
) {
  fail(
    "Album progress must update one key without replacing the root map"
  );
}

const updatePreviewMediaSource = methodBody(
  albumSource,
  "updatePreviewPhotoDisplayMedia"
);
if (
  !updatePreviewMediaSource.includes(
    "this.previewPhotos.findIndex"
  ) ||
  !updatePreviewMediaSource.includes(
    "this.previewPhotos.splice"
  ) ||
  updatePreviewMediaSource.includes(".map(")
) {
  fail(
    "Album preview hydration must replace only one matching photo"
  );
}

const ensurePreviewMediaAroundSource = methodBody(
  albumSource,
  "ensurePreviewMediaAround"
);
for (const requiredText of [
  "center - 2",
  "center + 3"
]) {
  if (!ensurePreviewMediaAroundSource.includes(requiredText)) {
    fail(
      "Album preview media range is missing " +
        requiredText
    );
  }
}
~~~

- [ ] **Step 3: Run parent checks and verify RED**

Run:

~~~bash
node scripts/d31-album-viewer-sequence-check.js
node scripts/check-miniprogram.js
~~~

Expected:

- D31 exits non-zero with Missing source method: previewMediaProgress.
- check-miniprogram exits non-zero because the viewer still receives mediaProgressById.

- [ ] **Step 4: Implement filtered progress, targeted writes, and exact ±2 preload**

Change the AlbumImageViewer prop binding:

~~~vue
:media-progress="previewMediaProgress"
~~~

Add after previewCurrentPhoto in computed:

~~~js
previewMediaProgress() {
  const result = {};
  if (!this.previewPhotos.length) {
    return result;
  }
  const parsedIndex = Number(this.previewCurrentIndex);
  const currentIndex = Number.isFinite(parsedIndex)
    ? Math.min(
        Math.max(0, Math.trunc(parsedIndex)),
        this.previewPhotos.length - 1
      )
    : 0;
  const start = Math.max(0, currentIndex - 2);
  const end = Math.min(
    this.previewPhotos.length,
    currentIndex + 3
  );

  for (let index = start; index < end; index += 1) {
    const photo = this.previewPhotos[index];
    if (
      !photo ||
      photo.id === undefined ||
      photo.id === null
    ) {
      continue;
    }
    for (const variant of ["thumbnail", "preview"]) {
      const key = this.albumMediaProgressKey(
        photo.id,
        variant
      );
      const entry = this.mediaProgressById[key];
      if (entry) {
        result[key] = entry;
      }
    }
  }
  return result;
},
~~~

Replace setAlbumMediaProgress:

~~~js
setAlbumMediaProgress(photoId, variant, values) {
  const key = this.albumMediaProgressKey(photoId, variant);
  this.mediaProgressById[key] = {
    ...(this.mediaProgressById[key] || {}),
    ...values
  };
},
~~~

Replace updatePreviewPhotoDisplayMedia:

~~~js
updatePreviewPhotoDisplayMedia(photoId, values) {
  const key =
    photoId === undefined || photoId === null
      ? ""
      : String(photoId);
  if (!key || !this.previewPhotos.length) {
    return;
  }
  const photoIndex = this.previewPhotos.findIndex(
    (photo) => String(photo.id) === key
  );
  if (photoIndex === -1) {
    return;
  }
  this.previewPhotos.splice(photoIndex, 1, {
    ...this.previewPhotos[photoIndex],
    ...values
  });
},
~~~

Replace ensurePreviewMediaAround, preserving the existing image/video request policy:

~~~js
ensurePreviewMediaAround(centerIndex) {
  const parsedCenter = Number(centerIndex);
  if (
    !Number.isFinite(parsedCenter) ||
    !this.previewPhotos.length
  ) {
    return;
  }
  const center = Math.min(
    Math.max(0, Math.trunc(parsedCenter)),
    this.previewPhotos.length - 1
  );
  const start = Math.max(0, center - 2);
  const end = Math.min(
    this.previewPhotos.length,
    center + 3
  );
  this.previewPhotos.slice(start, end).forEach((photo) => {
    if (
      !photo ||
      photo.id === undefined ||
      photo.id === null
    ) {
      return;
    }
    const visibleMedia =
      this.visiblePhotoMedia[String(photo.id)] || {};
    if (photo.media_type === "video") {
      if (!visibleMedia.thumbnail && photo.cover_url) {
        this.loadVisiblePhotoMedia(photo, "thumbnail");
      }
      return;
    }
    if (!visibleMedia.thumbnail) {
      this.loadVisiblePhotoMedia(photo, "thumbnail");
    }
    if (!visibleMedia.preview) {
      this.loadVisiblePhotoMedia(photo, "preview");
    }
  });
},
~~~

Do not modify applyFreshAlbumMediaUrls; it is a low-frequency auth refresh outside this hot-path scope.

- [ ] **Step 5: Run parent, static, mixed-media, and build checks**

Run:

~~~bash
node scripts/d31-album-viewer-sequence-check.js
node scripts/check-miniprogram.js
node scripts/d42-miniprogram-album-video-check.js
npm run build:mp-weixin
~~~

Expected:

- AlbumImageViewer windowing checks passed.
- UniApp miniprogram check passed: 13 pages.
- D42 mini-program integration checks passed: upload, viewer, timeline, and auth boundaries.
- Build completes with Build complete. Sass deprecation warnings are acceptable; compile errors are not.

- [ ] **Step 6: Review and commit the parent hot-path change**

Run:

~~~bash
git diff --check
git diff -- apps/miniprogram/src/pages/session/album.vue scripts/d31-album-viewer-sequence-check.js scripts/check-miniprogram.js
~~~

Expected: no full previewPhotos map replacement remains in updatePreviewPhotoDisplayMedia; no mediaProgressById root replacement remains in setAlbumMediaProgress; full album refresh code is unchanged.

Commit:

~~~bash
git add apps/miniprogram/src/pages/session/album.vue scripts/d31-album-viewer-sequence-check.js scripts/check-miniprogram.js docs/superpowers/plans/2026-07-12-album-viewer-windowing.md
git commit -m "perf: narrow album preview media updates"
~~~

### Task 4: Deterministic Verification and Independent Review

**Files:**
- Read: all files changed since f9937f4
- Update: docs/superpowers/plans/2026-07-12-album-viewer-windowing.md
- Generated only: apps/miniprogram/dist/build/mp-weixin/**

- [ ] **Step 1: Run the approved deterministic verification set from a clean shell**

Run:

~~~bash
node scripts/d31-album-viewer-sequence-check.js
node scripts/check-miniprogram.js
node scripts/d42-miniprogram-album-video-check.js
npm run build:mp-weixin
git diff --check f9937f4..HEAD
~~~

Expected: all four executable commands exit zero, build prints Build complete, and diff check prints nothing.

- [ ] **Step 2: Verify scope and generated-file hygiene**

Run:

~~~bash
git diff --stat f9937f4..HEAD
git diff --name-status f9937f4..HEAD
git status --short
~~~

Expected: source changes are limited to the component, album page, three verification scripts, and this plan. Generated dist files remain ignored and uncommitted.

- [ ] **Step 3: Request independent spec and code-quality reviews**

Give reviewers the approved design, this plan, and the exact f9937f4..HEAD diff. Require separate answers for:

- Spec compliance: every goal, non-goal, state invariant, event boundary, parent hot path, and acceptance test.
- Code quality: correctness, Vue/UniApp event behavior, stale-generation safety, video lifecycle, and test quality.

Expected: no Critical or Important findings. A finding must be reproduced or demonstrated before changing code. Any necessary fix must map to this approved plan and receive its own RED/GREEN verification.

- [ ] **Step 4: Record review evidence and re-run affected checks**

Add the review outcome below the relevant task in this plan. If no source fix is required, run:

~~~bash
git status --short --branch
~~~

Expected: clean source state except the intentional plan progress update.

### Task 5: Real 263-Item Runtime Acceptance

**Files:**
- Generated only: apps/miniprogram/dist/dev/mp-weixin/**
- Update: docs/superpowers/plans/2026-07-12-album-viewer-windowing.md
- Evidence only: /private/tmp/pinche-swiper-window-*.png

- [ ] **Step 1: Build the development output from this worktree**

From /Users/dirui/Documents/pinche/.worktrees/codex/album-swiper-feedback-loop-fix, run:

~~~bash
npm run dev:mp-weixin
~~~

Expected: Build complete. Watching for changes. Keep this watcher running during runtime acceptance so the worktree output remains current.

- [ ] **Step 2: Open the worktree project in WeChat DevTools**

Run:

~~~bash
/Applications/wechatwebdevtools.app/Contents/MacOS/cli open --project /Users/dirui/Documents/pinche/.worktrees/codex/album-swiper-feedback-loop-fix/apps/miniprogram
~~~

Expected: DevTools opens this exact worktree path and uses its dist/dev/mp-weixin root. Do not open /Users/dirui/Documents/pinche/apps/miniprogram, which is the separate main worktree.

- [ ] **Step 3: Verify the real album and forward rapid-swipe settling**

Using the authenticated DevTools session:

1. Open [冯厚敦·流芳] 相册 and confirm the viewer total is 263.
2. Perform 20 rapid forward horizontal swipes with no system-level synthetic mouse script.
3. After the final release, capture:
   - /private/tmp/pinche-swiper-window-forward-1s.png
   - /private/tmp/pinche-swiper-window-forward-10s.png
   - /private/tmp/pinche-swiper-window-forward-30s.png
4. Record the visible counter from all three captures.

Expected: the counter and subject photo are identical at 1, 10, and 30 seconds; there is no adjacent oscillation, delayed page advance, black screen, or gesture lock.

- [ ] **Step 4: Verify backward rapid-swipe settling**

Perform 20 rapid backward horizontal swipes and capture:

- /private/tmp/pinche-swiper-window-backward-1s.png
- /private/tmp/pinche-swiper-window-backward-10s.png
- /private/tmp/pinche-swiper-window-backward-30s.png

Expected: the three backward counters and photos are identical and stable under the same criteria.

- [ ] **Step 5: Verify preserved controls and mixed media**

Check:

- Image → image across a window rebase.
- Image → video and video → image if a reachable video exists.
- Close button.
- Downward close gesture.
- Download button and its existing confirmation flow.
- Continued swiping after one photo shows a load failure.

Expected: logical counter/payload behavior remains correct and no control regresses.

- [ ] **Step 6: Record runtime performance evidence**

Record DevTools long-task/message-handler warnings next to the six screenshots in this plan. Behavior stability is mandatory. Compare warning severity with the first-stage baseline of 58–115 ms timer warnings and 282–309 ms message-handler warnings; improvement is supporting performance evidence, not a substitute for stable 1/10/30-second results.

- [ ] **Step 7: Stop the watcher, run final verification, and commit the record**

Stop the development watcher, then run:

~~~bash
node scripts/d31-album-viewer-sequence-check.js
node scripts/check-miniprogram.js
node scripts/d42-miniprogram-album-video-check.js
npm run build:mp-weixin
git diff --check
git status --short --branch
~~~

Expected: all checks pass. Update every completed checkbox and add exact runtime counters/warning observations to this plan. If any runtime criterion fails, leave that checkbox unchecked, record the evidence, and return to the matching planned task without adding timers, source locks, circular duplicates, or unrelated refactors.

When all acceptance criteria pass, commit only the progress/evidence record:

~~~bash
git add docs/superpowers/plans/2026-07-12-album-viewer-windowing.md
git commit -m "docs: record album viewer windowing verification"
~~~

## Completion Gate

The second phase is complete only when:

- [ ] D31 proves no more than five slides and exact 1 → 263 → 1 logical traversal.
- [ ] Native change never writes the programmatic swiper command.
- [ ] Matching animationfinish is the only native-interaction rebase path.
- [ ] Stale generation and same-page remount events are idempotent.
- [ ] Hydration keeps state/generation stable; reorder/remove/empty are covered.
- [ ] Video, download, close, downward close, retry, and failure recovery pass.
- [ ] Parent preview photo/progress hot paths preserve root references.
- [ ] Viewer progress/preload is limited to current ±2.
- [ ] check-miniprogram, D42, and production build pass.
- [ ] Real 263-item forward and backward 1/10/30-second screenshots are stable.
- [ ] Independent spec and quality review have no Critical or Important finding.
- [ ] Worktree is clean and the second-phase commits can be reverted without removing ab822876.
