import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const viewerPath = path.join(root, "apps/miniprogram/src/components/AlbumImageViewer.vue");
const source = fs.readFileSync(viewerPath, "utf8");
const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "";

function loadComponent() {
  const context = { component: null };
  const body = script.replace(/export\s+default/, "component =");
  vm.runInNewContext(body, context, { filename: viewerPath });
  return context.component;
}

function makePhotos(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    media_type: "image",
    thumbnail_display_url: `wxfile://album-thumb-${index + 1}.jpg`,
    preview_display_url: `wxfile://album-preview-${index + 1}.jpg`
  }));
}

function createInstance(component, photos, initialIndex = 0) {
  const data = component.data.call({});
  const emitted = [];
  const instance = {
    ...data,
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

  for (const [name, method] of Object.entries(component.methods || {})) {
    instance[name] = method.bind(instance);
  }
  for (const [name, getter] of Object.entries(component.computed || {})) {
    Object.defineProperty(instance, name, {
      configurable: true,
      enumerable: true,
      get: getter.bind(instance)
    });
  }

  return { instance, emitted };
}

function openViewer(component, photoCount, initialIndex) {
  const result = createInstance(component, makePhotos(photoCount), initialIndex);
  result.instance.visible = true;
  component.watch.visible.call(result.instance, true, false);
  return result;
}

function nativeSwiperEvent(instance, current, options = {}) {
  const generation = options.generation ?? instance.swiperGeneration;
  return {
    detail: {
      current,
      source: options.source ?? "touch"
    },
    currentTarget: {
      dataset: {
        generation: String(generation)
      }
    }
  };
}

function changeEvents(emitted) {
  return emitted.filter((entry) => entry.event === "change");
}

function windowIds(instance) {
  return instance.windowPhotos.map((photo) => photo.id);
}

function assertPending(instance, generation, logicalIndex, message) {
  assert.ok(instance.pendingWindowRebase, `${message}: pending rebase must exist`);
  assert.equal(
    instance.pendingWindowRebase.generation,
    generation,
    `${message}: pending generation must match`
  );
  assert.equal(
    instance.pendingWindowRebase.logicalIndex,
    logicalIndex,
    `${message}: pending logical index must match`
  );
}

function runWindowSizeCheck(component) {
  assert.equal(
    typeof component.computed?.windowPhotos,
    "function",
    "AlbumImageViewer must expose computed.windowPhotos"
  );

  const smallListCases = [
    { count: 0, initialIndex: 0, currentIndex: 0, activeWindowIndex: 0, ids: [] },
    { count: 1, initialIndex: 0, currentIndex: 0, activeWindowIndex: 0, ids: [1] },
    { count: 2, initialIndex: 1, currentIndex: 1, activeWindowIndex: 1, ids: [1, 2] },
    { count: 5, initialIndex: 4, currentIndex: 4, activeWindowIndex: 4, ids: [1, 2, 3, 4, 5] }
  ];

  for (const expected of smallListCases) {
    const { instance } = openViewer(component, expected.count, expected.initialIndex);
    assert.ok(
      instance.windowPhotos.length <= 5,
      `${expected.count} photos must mount at most five slides`
    );
    assert.equal(
      instance.currentIndex,
      expected.currentIndex,
      `${expected.count} photos must retain the expected logical index`
    );
    assert.equal(instance.windowStart, 0, `${expected.count} photos must start at window zero`);
    assert.equal(
      instance.activeWindowIndex,
      expected.activeWindowIndex,
      `${expected.count} photos must select the expected physical slide`
    );
    assert.equal(
      instance.swiperIndex,
      expected.activeWindowIndex,
      `${expected.count} photos must position the native swiper correctly`
    );
    assert.equal(
      JSON.stringify(windowIds(instance)),
      JSON.stringify(expected.ids),
      `${expected.count} photos must expose the exact logical window IDs`
    );
  }

  const { instance: largeInstance } = openViewer(component, 263, 262);
  assert.equal(largeInstance.windowPhotos.length, 5, "263 photos must mount exactly five slides");
}

function runOpeningPositionCheck(component) {
  const cases = [
    { logicalIndex: 0, windowStart: 0, activeWindowIndex: 0, ids: [1, 2, 3, 4, 5] },
    { logicalIndex: 131, windowStart: 129, activeWindowIndex: 2, ids: [130, 131, 132, 133, 134] },
    { logicalIndex: 262, windowStart: 258, activeWindowIndex: 4, ids: [259, 260, 261, 262, 263] }
  ];

  for (const expected of cases) {
    const { instance, emitted } = openViewer(component, 263, expected.logicalIndex);
    assert.equal(instance.currentIndex, expected.logicalIndex, "opening must retain the logical index");
    assert.equal(instance.windowStart, expected.windowStart, "opening must center and clamp windowStart");
    assert.equal(
      instance.activeWindowIndex,
      expected.activeWindowIndex,
      "opening must select the matching physical slide"
    );
    assert.equal(
      instance.swiperIndex,
      expected.activeWindowIndex,
      "opening must position the native swiper on the matching physical slide"
    );
    assert.equal(
      JSON.stringify(windowIds(instance)),
      JSON.stringify(expected.ids),
      "opening must expose the expected five logical photos"
    );
    assert.equal(changeEvents(emitted).length, 0, "opening must not emit a business change event");
  }
}

function runNonEdgeChangeCheck(component) {
  const { instance, emitted } = openViewer(component, 263, 131);
  const generation = instance.swiperGeneration;
  const controlledIndex = instance.swiperIndex;

  instance.handleSwiperChange(nativeSwiperEvent(instance, 3));

  assert.equal(instance.currentIndex, 132, "physical slide 3 must map to logical photo 132");
  assert.equal(instance.activeWindowIndex, 3, "the active physical slide must follow the native change");
  assert.equal(instance.pendingWindowRebase, null, "a non-edge slide must not schedule a rebase");
  assert.equal(instance.windowStart, 129, "a non-edge slide must not rebuild the window");
  assert.equal(instance.swiperGeneration, generation, "a non-edge slide must preserve generation");
  assert.equal(instance.swiperIndex, controlledIndex, "a native change must not rewrite swiperIndex");
  assert.equal(changeEvents(emitted).length, 1, "a new logical page must emit one change event");
  assert.equal(changeEvents(emitted)[0].payload.index, 132, "the change event must expose the logical index");
}

function runGenerationSafeEdgeRebaseCheck(component) {
  const { instance, emitted } = openViewer(component, 263, 0);
  const openingGeneration = instance.swiperGeneration;

  instance.handleSwiperChange(nativeSwiperEvent(instance, 4));

  assert.equal(instance.currentIndex, 4, "physical edge 4 must map to logical photo 4");
  assert.equal(instance.activeWindowIndex, 4, "physical edge 4 must become active immediately");
  assertPending(instance, openingGeneration, 4, "edge change");
  assert.equal(instance.windowStart, 0, "the edge change must wait for animationfinish before rebuilding");
  assert.equal(instance.swiperGeneration, openingGeneration, "the edge change must not advance generation");
  assert.equal(changeEvents(emitted).length, 1, "the edge change must emit one logical business change");

  instance.handleSwiperAnimationFinish(nativeSwiperEvent(instance, 3));

  assert.equal(instance.windowStart, 0, "a wrong-page animationfinish must not rebase");
  assert.equal(instance.swiperGeneration, openingGeneration, "a wrong-page finish must preserve generation");
  assertPending(instance, openingGeneration, 4, "wrong-page finish");

  instance.handleSwiperAnimationFinish(nativeSwiperEvent(instance, 4));

  assert.equal(instance.currentIndex, 4, "matching animationfinish must retain the logical photo");
  assert.equal(instance.windowStart, 2, "matching animationfinish must center the next window");
  assert.equal(instance.activeWindowIndex, 2, "matching animationfinish must rebase to physical slide 2");
  assert.equal(instance.swiperIndex, 2, "matching animationfinish must reposition the controlled swiper");
  assert.equal(
    instance.swiperGeneration,
    openingGeneration + 1,
    "matching animationfinish must advance generation exactly once"
  );
  assert.equal(instance.pendingWindowRebase, null, "matching animationfinish must clear pending state");
  assert.equal(changeEvents(emitted).length, 1, "window rebuilding must not duplicate the business change");

  const rebasedGeneration = instance.swiperGeneration;
  instance.handleSwiperChange(
    nativeSwiperEvent(instance, 2, { generation: rebasedGeneration, source: "" })
  );

  assert.equal(instance.currentIndex, 4, "same-page remount change must retain the logical photo");
  assert.equal(instance.windowStart, 2, "same-page remount change must not rebuild");
  assert.equal(instance.swiperGeneration, rebasedGeneration, "same-page remount must preserve generation");
  assert.equal(changeEvents(emitted).length, 1, "same-page remount must be business-event idempotent");

  instance.handleSwiperChange(
    nativeSwiperEvent(instance, 3, { generation: rebasedGeneration, source: "" })
  );

  assert.equal(instance.currentIndex, 5, "an empty-source change to another slot must remain valid");
  assert.equal(instance.activeWindowIndex, 3, "the valid empty-source change must update physical state");
  assert.equal(changeEvents(emitted).length, 2, "the valid empty-source change must emit once");
  assert.equal(changeEvents(emitted)[1].payload.index, 5, "the empty-source event must emit a logical index");

  instance.handleSwiperChange(nativeSwiperEvent(instance, 4, { generation: rebasedGeneration }));
  assertPending(instance, rebasedGeneration, 6, "new-generation edge change");
  assert.equal(instance.currentIndex, 6, "the new-generation edge must select logical photo 6");
  assert.equal(changeEvents(emitted).length, 3, "the new-generation edge must emit once");

  instance.handleSwiperChange(nativeSwiperEvent(instance, 0, { generation: openingGeneration }));
  instance.handleSwiperAnimationFinish(
    nativeSwiperEvent(instance, 4, { generation: openingGeneration })
  );

  assert.equal(instance.currentIndex, 6, "an old-generation change must be ignored");
  assert.equal(instance.windowStart, 2, "an old-generation finish must not rebuild the window");
  assert.equal(instance.swiperGeneration, rebasedGeneration, "old native events must preserve generation");
  assertPending(instance, rebasedGeneration, 6, "old-generation native events");
  assert.equal(changeEvents(emitted).length, 3, "old native events must not emit business changes");
}

function runReopenGenerationCheck(component) {
  const { instance, emitted } = openViewer(component, 263, 0);
  const oldGeneration = instance.swiperGeneration;

  instance.visible = false;
  component.watch.visible.call(instance, false, true);
  instance.visible = true;
  component.watch.visible.call(instance, true, false);

  assert.notEqual(
    instance.swiperGeneration,
    oldGeneration,
    "reopening must use a generation distinct from the destroyed native swiper"
  );
  assert.equal(changeEvents(emitted).length, 0, "closing and reopening must not emit a business change");

  const reopenedGeneration = instance.swiperGeneration;
  instance.handleSwiperChange(nativeSwiperEvent(instance, 4));
  assertPending(instance, reopenedGeneration, 4, "reopened edge change");
  assert.equal(changeEvents(emitted).length, 1, "the reopened swiper edge must emit once");

  instance.handleSwiperChange(nativeSwiperEvent(instance, 0, { generation: oldGeneration }));
  instance.handleSwiperAnimationFinish(
    nativeSwiperEvent(instance, 4, { generation: oldGeneration })
  );

  assert.equal(instance.currentIndex, 4, "an old-instance change must not alter the reopened logical page");
  assert.equal(instance.windowStart, 0, "an old-instance finish must not rebuild the reopened window");
  assert.equal(
    instance.swiperGeneration,
    reopenedGeneration,
    "old-instance native events must preserve the reopened generation"
  );
  assertPending(instance, reopenedGeneration, 4, "old-instance native events");
  assert.equal(changeEvents(emitted).length, 1, "old-instance events must not emit business changes");
}

function runSequenceCheck() {
  const component = loadComponent();
  runWindowSizeCheck(component);
  runOpeningPositionCheck(component);
  runNonEdgeChangeCheck(component);
  runGenerationSafeEdgeRebaseCheck(component);
  runReopenGenerationCheck(component);
}

runSequenceCheck();

console.log("AlbumImageViewer core five-slide window sequence check passed");
