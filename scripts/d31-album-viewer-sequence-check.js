import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { computed as vueComputed, reactive } from "vue";

const root = process.cwd();
const viewerPath = path.join(root, "apps/miniprogram/src/components/AlbumImageViewer.vue");
const source = fs.readFileSync(viewerPath, "utf8");
const albumPath = path.join(root, "apps/miniprogram/src/pages/session/album.vue");
const albumSource = fs.readFileSync(albumPath, "utf8");
const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "";
const runtime = { pausedVideoIds: [] };

function methodDefinition(source, name) {
  const patterns = [
    new RegExp("async\\s+" + name + "\\s*\\(([^)]*)\\)\\s*\\{"),
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

function loadComponent() {
  const context = {
    component: null,
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
  return openViewerWithPhotos(component, makePhotos(photoCount), initialIndex);
}

function openViewerWithPhotos(component, photos, initialIndex = 0) {
  const result = createInstance(component, photos, initialIndex);
  result.instance.visible = true;
  component.watch.visible.call(result.instance, true, false);
  return result;
}

function applyPhotos(component, instance, nextPhotos) {
  const previousPhotos = instance.photos;
  instance.photos = nextPhotos;
  component.watch.photos.call(instance, nextPhotos, previousPhotos);
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

function swipeOneLogicalStep(instance, emitted, direction) {
  const expectedIndex = instance.currentIndex + direction;
  const nextWindowIndex = instance.activeWindowIndex + direction;
  assert.ok(
    nextWindowIndex >= 0 && nextWindowIndex < instance.windowPhotos.length,
    "Viewer must expose the next logical neighbor"
  );

  const generation = instance.swiperGeneration;
  instance.handleSwiperChange(nativeSwiperEvent(instance, nextWindowIndex));
  assert.equal(instance.currentIndex, expectedIndex);

  if (instance.pendingWindowRebase) {
    const eventCount = changeEvents(emitted).length;
    instance.handleSwiperAnimationFinish(
      nativeSwiperEvent(instance, nextWindowIndex, { generation })
    );
    assert.equal(instance.swiperGeneration, generation + 1);
    assert.equal(instance.currentIndex, expectedIndex);
    instance.handleSwiperChange(
      nativeSwiperEvent(instance, instance.activeWindowIndex, { source: "" })
    );
    assert.equal(
      changeEvents(emitted).length,
      eventCount,
      "Remount must not duplicate a logical change"
    );
  }
  assert.ok(instance.windowPhotos.length <= 5);
  assert.equal(instance.windowStart + instance.activeWindowIndex, instance.currentIndex);
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

function runSwiperGenerationTokenCheck(component) {
  assert.equal(
    typeof component.computed?.swiperGenerations,
    "function",
    "AlbumImageViewer must expose computed.swiperGenerations"
  );

  const { instance } = openViewer(component, 5, 2);
  const firstTokens = Array.from(instance.swiperGenerations);
  assert.equal(firstTokens.length, 1, "swiperGenerations must expose exactly one native instance token");
  assert.equal(
    firstTokens[0],
    instance.swiperGeneration,
    "the native instance token must equal the current swiper generation"
  );

  const firstToken = firstTokens[0];
  instance.visible = false;
  component.watch.visible.call(instance, false, true);
  const nextTokens = Array.from(instance.swiperGenerations);
  assert.equal(nextTokens.length, 1, "a new generation must still expose exactly one native token");
  assert.equal(
    nextTokens[0],
    instance.swiperGeneration,
    "the native instance token must follow the incremented generation"
  );
  assert.notEqual(nextTokens[0], firstToken, "the native instance token must change with generation");
}

function runDynamicInitialIndexCheck(component) {
  const { instance, emitted } = openViewer(component, 263, 0);
  const generation = instance.swiperGeneration;
  instance.initialIndex = 262;
  component.watch.initialIndex.call(instance, 262, 0);
  assert.equal(instance.currentIndex, 262);
  assert.equal(instance.windowStart, 258);
  assert.equal(instance.activeWindowIndex, 4);
  assert.equal(JSON.stringify(windowIds(instance)), JSON.stringify([259, 260, 261, 262, 263]));
  assert.equal(instance.swiperGeneration, generation + 1);
  assert.equal(changeEvents(emitted).length, 0);
}

function runFullTraversalCheck(component) {
  const { instance, emitted } = openViewer(component, 263, 0);
  for (let index = 1; index < 263; index += 1) {
    swipeOneLogicalStep(instance, emitted, 1);
  }
  assert.equal(instance.currentIndex, 262);
  const lastGeneration = instance.swiperGeneration;
  instance.handleSwiperAnimationFinish(nativeSwiperEvent(instance, instance.activeWindowIndex));
  assert.equal(instance.swiperGeneration, lastGeneration, "last boundary must not rebuild");

  for (let index = 261; index >= 0; index -= 1) {
    swipeOneLogicalStep(instance, emitted, -1);
  }
  assert.equal(instance.currentIndex, 0);
  const firstGeneration = instance.swiperGeneration;
  instance.handleSwiperAnimationFinish(nativeSwiperEvent(instance, instance.activeWindowIndex));
  assert.equal(instance.swiperGeneration, firstGeneration, "first boundary must not rebuild");

  assert.deepEqual(
    changeEvents(emitted).map(({ payload }) => payload.index),
    [
      ...Array.from({ length: 262 }, (_, index) => index + 1),
      ...Array.from({ length: 262 }, (_, index) => 261 - index)
    ],
    "Viewer must visit 1 through 263 and back without gaps"
  );
}

function runPhotosChangeCheck(component) {
  const photos = makePhotos(263);
  const hydratedCase = openViewerWithPhotos(component, photos, 131);
  const beforeHydration = {
    currentIndex: hydratedCase.instance.currentIndex,
    windowStart: hydratedCase.instance.windowStart,
    activeWindowIndex: hydratedCase.instance.activeWindowIndex,
    swiperIndex: hydratedCase.instance.swiperIndex,
    swiperGeneration: hydratedCase.instance.swiperGeneration
  };
  const hydrated = photos.map((photo) =>
    photo.id === 132
      ? { ...photo, preview_display_url: "wxfile://hydrated-132.jpg" }
      : photo
  );
  applyPhotos(component, hydratedCase.instance, hydrated);
  assert.deepEqual(
    {
      currentIndex: hydratedCase.instance.currentIndex,
      windowStart: hydratedCase.instance.windowStart,
      activeWindowIndex: hydratedCase.instance.activeWindowIndex,
      swiperIndex: hydratedCase.instance.swiperIndex,
      swiperGeneration: hydratedCase.instance.swiperGeneration
    },
    beforeHydration,
    "Media hydration must not reset or rebuild the window"
  );
  assert.equal(hydratedCase.instance.currentPhoto.preview_display_url, "wxfile://hydrated-132.jpg");

  const reorderCase = openViewerWithPhotos(component, photos, 131);
  const reorderGeneration = reorderCase.instance.swiperGeneration;
  const activePhoto = photos[131];
  const remaining = photos.filter((photo) => photo.id !== activePhoto.id);
  applyPhotos(component, reorderCase.instance, [
    ...remaining.slice(0, 10),
    activePhoto,
    ...remaining.slice(10)
  ]);
  assert.equal(reorderCase.instance.currentPhoto.id, 132, "photos reorder must preserve the active photo by stable ID");
  assert.equal(reorderCase.instance.currentIndex, 10);
  assert.equal(reorderCase.instance.windowStart, 8);
  assert.equal(reorderCase.instance.activeWindowIndex, 2);
  assert.equal(reorderCase.instance.swiperGeneration, reorderGeneration + 1);
  assert.equal(changeEvents(reorderCase.emitted).length, 0);

  const removeCase = openViewerWithPhotos(component, photos, 131);
  const removeGeneration = removeCase.instance.swiperGeneration;
  applyPhotos(component, removeCase.instance, photos.filter((photo) => photo.id !== 132));
  assert.equal(removeCase.instance.currentIndex, 131);
  assert.equal(removeCase.instance.currentPhoto.id, 133);
  assert.equal(removeCase.instance.swiperGeneration, removeGeneration + 1);

  const videoPhotos = makePhotos(3);
  videoPhotos[1] = {
    ...videoPhotos[1],
    media_type: "video",
    video_display_url: "wxfile://video-2.mp4"
  };
  const emptyCase = openViewerWithPhotos(component, videoPhotos, 1);
  const emptyGeneration = emptyCase.instance.swiperGeneration;
  runtime.pausedVideoIds.length = 0;
  applyPhotos(component, emptyCase.instance, []);
  assert.equal(emptyCase.instance.currentIndex, 0);
  assert.equal(emptyCase.instance.windowStart, 0);
  assert.equal(emptyCase.instance.activeWindowIndex, 0);
  assert.equal(emptyCase.instance.swiperIndex, 0);
  assert.equal(emptyCase.instance.windowPhotos.length, 0);
  assert.equal(emptyCase.instance.swiperGeneration, emptyGeneration + 1);
  assert.equal(emptyCase.instance.pendingWindowRebase, null);
  assert.ok(
    runtime.pausedVideoIds.includes("album-image-viewer-video-2"),
    "Emptying the list must pause the previous active video"
  );
  assert.equal(changeEvents(emptyCase.emitted).length, 0);
}

function runMixedVideoWindowCheck(component) {
  const photos = makePhotos(8);
  photos[4] = { ...photos[4], media_type: "video", video_display_url: "" };
  const { instance, emitted } = openViewerWithPhotos(component, photos, 0);
  instance.handleSwiperChange(nativeSwiperEvent(instance, 4));
  assert.equal(instance.currentIndex, 4);
  assert.equal(instance.isActiveVideo(4), true);
  assert.equal(instance.isActiveVideo(2), false);
  const needVideo = emitted.filter(({ event }) => event === "need-video");
  assert.equal(needVideo.length, 1);
  assert.equal(needVideo[0].payload.index, 4);
  assert.equal(needVideo[0].payload.photo.id, 5);

  instance.handleSwiperAnimationFinish(nativeSwiperEvent(instance, 4));
  instance.handleSwiperChange(nativeSwiperEvent(instance, instance.activeWindowIndex, { source: "" }));
  assert.equal(emitted.filter(({ event }) => event === "need-video").length, 1);

  instance.handleVideoError(instance.currentPhoto);
  assert.equal(emitted.find(({ event }) => event === "video-error").payload.index, 4);
  instance.retryVideo(instance.currentPhoto);
  const retry = emitted.filter(({ event }) => event === "need-video").at(-1);
  assert.equal(retry.payload.index, 4);
  assert.equal(retry.payload.retry, true);

  const generation = instance.swiperGeneration;
  applyPhotos(
    component,
    instance,
    instance.photos.map((photo) =>
      photo.id === 5 ? { ...photo, video_display_url: "wxfile://video-5.mp4" } : photo
    )
  );
  assert.equal(instance.swiperGeneration, generation);
  runtime.pausedVideoIds.length = 0;
  instance.handleSwiperChange(nativeSwiperEvent(instance, 3));
  assert.equal(instance.currentIndex, 5);
  assert.ok(runtime.pausedVideoIds.includes("album-image-viewer-video-5"));
}

function runRemovedVideoEventCheck(component) {
  const photos = makePhotos(3);
  photos[1] = {
    ...photos[1],
    media_type: "video",
    video_display_url: "wxfile://video-2.mp4"
  };
  const { instance, emitted } = openViewerWithPhotos(component, photos, 1);
  const removedVideo = instance.currentPhoto;

  applyPhotos(
    component,
    instance,
    photos.filter((photo) => photo.id !== removedVideo.id)
  );
  const videoErrorCount = emitted.filter(({ event }) => event === "video-error").length;
  const needVideoCount = emitted.filter(({ event }) => event === "need-video").length;

  instance.handleVideoError(removedVideo);
  instance.retryVideo(removedVideo);

  assert.equal(
    emitted.filter(({ event }) => event === "video-error").length,
    videoErrorCount,
    "A removed native video node must not emit a stale video-error payload"
  );
  assert.equal(
    emitted.filter(({ event }) => event === "need-video").length,
    needVideoCount,
    "A removed native video node must not emit a stale retry payload"
  );
}

function runCurrentMediaStateCheck(component) {
  const { instance, emitted } = openViewer(component, 10, 4);
  const photo = instance.currentPhoto;
  instance.mediaProgress = {
    [`${photo.id}:thumbnail`]: { loading: true, failed: false, progress: 36 }
  };
  assert.equal(instance.showLoading(photo), true);
  assert.equal(instance.loadingProgressValue(photo), 36);
  instance.handleThumbnailLoad(photo);
  assert.equal(instance.thumbnailLoaded(photo), true);
  const generation = instance.swiperGeneration;
  applyPhotos(
    component,
    instance,
    instance.photos.map((item) =>
      item.id === photo.id ? { ...item, preview_display_url: "wxfile://hydrated-5.jpg" } : item
    )
  );
  assert.equal(instance.swiperGeneration, generation);
  const hydrated = instance.currentPhoto;
  assert.equal(instance.previewCanLoad(hydrated), true);
  instance.handlePreviewLoad(hydrated);
  assert.equal(instance.previewLoaded(hydrated), true);
  instance.requestDownload("button");
  const download = emitted.find(({ event }) => event === "download");
  assert.equal(download.payload.index, 4);
  assert.equal(download.payload.photo.id, 5);
}

function runAlbumPageMediaWindowCheck(component) {
  const getPreviewMediaProgress = methodFromSource(albumSource, "previewMediaProgress");
  const setAlbumMediaProgress = methodFromSource(albumSource, "setAlbumMediaProgress");
  const updatePreviewPhotoDisplayMedia = methodFromSource(
    albumSource,
    "updatePreviewPhotoDisplayMedia"
  );
  const ensurePreviewMediaAround = methodFromSource(albumSource, "ensurePreviewMediaAround");

  const photos = makePhotos(7);
  photos[3] = {
    ...photos[3],
    media_type: "video",
    cover_url: "wxfile://album-video-cover-4.jpg"
  };
  const mediaProgressById = {};
  for (const photo of photos) {
    for (const variant of ["thumbnail", "preview"]) {
      mediaProgressById[String(photo.id) + ":" + variant] = {
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
    .flatMap((id) => [String(id) + ":thumbnail", String(id) + ":preview"])
    .sort();
  const initialProgress = filteredProgress.value;
  assert.deepEqual(Object.keys(initialProgress).sort(), expectedMiddleKeys);
  assert.equal(getterRuns, 1);

  const progressRoot = state.mediaProgressById;
  setAlbumMediaProgress.call(state, 1, "thumbnail", { progress: 71 });
  assert.strictEqual(state.mediaProgressById, progressRoot);
  assert.strictEqual(filteredProgress.value, initialProgress);
  assert.equal(getterRuns, 1);

  setAlbumMediaProgress.call(state, 3, "preview", { progress: 83 });
  assert.notStrictEqual(filteredProgress.value, initialProgress);
  assert.equal(filteredProgress.value["3:preview"].progress, 83);
  assert.equal(getterRuns, 2);

  const photosRoot = state.previewPhotos;
  const previousItems = [...state.previewPhotos];
  const viewerState = reactive({
    photos: state.previewPhotos,
    windowStart: 1,
    swiperGeneration: 7
  });
  const viewerWindow = vueComputed(() =>
    component.computed.windowPhotos.call(viewerState)
  );
  const previousViewerWindow = viewerWindow.value;
  updatePreviewPhotoDisplayMedia.call(state, 4, {
    video_display_url: "wxfile://album-video-4.mp4"
  });
  assert.strictEqual(state.previewPhotos, photosRoot);
  assert.notStrictEqual(state.previewPhotos[3], previousItems[3]);
  assert.ok(
    state.previewPhotos.every(
      (photo, index) => index === 3 || photo === previousItems[index]
    )
  );
  assert.notStrictEqual(viewerWindow.value, previousViewerWindow);
  assert.equal(viewerWindow.value[2].video_display_url, "wxfile://album-video-4.mp4");
  assert.equal(viewerState.swiperGeneration, 7);

  function requestsFor(center) {
    requests.length = 0;
    state.visiblePhotoMedia = {};
    ensurePreviewMediaAround.call(state, center);
    return {
      entries: [...requests],
      ids: [
        ...new Set(requests.map((entry) => Number(entry.split(":")[0])))
      ].sort((left, right) => left - right)
    };
  }

  const startRequests = requestsFor(0);
  assert.deepEqual(startRequests.ids, [1, 2, 3]);
  assert.deepEqual(startRequests.entries, [
    "1:thumbnail",
    "1:preview",
    "2:thumbnail",
    "2:preview",
    "3:thumbnail",
    "3:preview"
  ]);
  const middleRequests = requestsFor(3);
  assert.deepEqual(middleRequests.ids, [2, 3, 4, 5, 6]);
  assert.deepEqual(middleRequests.entries, [
    "2:thumbnail",
    "2:preview",
    "3:thumbnail",
    "3:preview",
    "4:thumbnail",
    "5:thumbnail",
    "5:preview",
    "6:thumbnail",
    "6:preview"
  ]);
  const endRequests = requestsFor(6);
  assert.deepEqual(endRequests.ids, [5, 6, 7]);
  assert.deepEqual(endRequests.entries, [
    "5:thumbnail",
    "5:preview",
    "6:thumbnail",
    "6:preview",
    "7:thumbnail",
    "7:preview"
  ]);

  state.previewCurrentIndex = 0;
  assert.deepEqual(
    Object.keys(filteredProgress.value).sort(),
    [1, 2, 3]
      .flatMap((id) => [String(id) + ":thumbnail", String(id) + ":preview"])
      .sort()
  );
  state.previewCurrentIndex = 6;
  assert.deepEqual(
    Object.keys(filteredProgress.value).sort(),
    [5, 6, 7]
      .flatMap((id) => [String(id) + ":thumbnail", String(id) + ":preview"])
      .sort()
  );
}

function runSequenceCheck() {
  const component = loadComponent();
  runSwiperGenerationTokenCheck(component);
  runWindowSizeCheck(component);
  runOpeningPositionCheck(component);
  runNonEdgeChangeCheck(component);
  runGenerationSafeEdgeRebaseCheck(component);
  runReopenGenerationCheck(component);
  runDynamicInitialIndexCheck(component);
  runFullTraversalCheck(component);
  runPhotosChangeCheck(component);
  runMixedVideoWindowCheck(component);
  runRemovedVideoEventCheck(component);
  runCurrentMediaStateCheck(component);
  runAlbumPageMediaWindowCheck(component);
}

runSequenceCheck();

console.log("AlbumImageViewer windowing checks passed");
