import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const viewerPath = path.join(root, "apps/miniprogram/src/components/AlbumImageViewer.vue");
const source = fs.readFileSync(viewerPath, "utf8");
const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function loadComponent() {
  const context = { component: null };
  const body = script.replace(/export\s+default/, "component =");
  vm.runInNewContext(body, context, { filename: viewerPath });
  return context.component;
}

function makePhotos(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    thumbnail_display_url: `wxfile://album-thumb-${index + 1}.jpg`,
    preview_display_url: ""
  }));
}

function createInstance(component, photos) {
  const data = component.data.call({});
  const emitted = [];
  const instance = {
    ...data,
    visible: false,
    photos,
    initialIndex: 0,
    allowDownload: true,
    mediaProgress: {},
    $emit(event, payload) {
      emitted.push({ event, payload });
    }
  };
  for (const [name, method] of Object.entries(component.methods || {})) {
    instance[name] = method.bind(instance);
  }
  return { instance, emitted };
}

function computed(component, instance, name) {
  return component.computed[name].call(instance);
}

function trackWrites(target, property) {
  let value = target[property];
  let writes = 0;
  Object.defineProperty(target, property, {
    configurable: true,
    enumerable: true,
    get() {
      return value;
    },
    set(nextValue) {
      writes += 1;
      value = nextValue;
    }
  });
  return {
    get writes() {
      return writes;
    }
  };
}

function runFastSwipeHydrationCheck(component) {
  const photos = makePhotos(20).map((photo) => ({
    ...photo,
    preview_display_url: `wxfile://album-preview-${photo.id}.jpg`
  }));
  const { instance } = createInstance(component, photos);

  instance.visible = true;
  component.watch.visible.call(instance, true, false);
  instance.handleSwiperChange({ detail: { current: 5 } });

  const currentIndexWrites = trackWrites(instance, "currentIndex");
  const swiperIndexWrites = trackWrites(instance, "swiperIndex");
  const previousPhotos = instance.photos;
  instance.photos = instance.photos.map((photo, index) =>
    index === 4
      ? {
          ...photo,
          preview_display_url: `${photo.preview_display_url}?hydrated=1`
        }
      : photo
  );
  component.watch.photos.call(instance, instance.photos, previousPhotos);

  assert(
    currentIndexWrites.writes === 0,
    "Viewer must not rewrite currentIndex when media hydration keeps the current photo in range"
  );
  assert(
    swiperIndexWrites.writes === 0,
    "Viewer must not rewrite swiperIndex during fast-swipe media hydration"
  );
  assert(instance.currentIndex === 5, "Viewer currentIndex must remain on the fast-swiped photo");
  assert(instance.swiperIndex === 5, "Viewer swiperIndex must remain on the fast-swiped photo");
}

function runSequenceCheck() {
  const component = loadComponent();
  const photos = makePhotos(20);
  const { instance, emitted } = createInstance(component, photos);

  instance.visible = true;
  component.watch.visible.call(instance, true, false);

  assert(instance.currentIndex === 0, "Viewer must open on the first photo for this sequence");
  assert(instance.swiperIndex === 0, "Viewer swiper must open on the first photo");
  assert(computed(component, instance, "counterText") === "1/20", "Viewer counter must start at 1/20");

  for (let index = 0; index < 20; index += 1) {
    instance.handleSwiperChange({ detail: { current: index } });
    assert(instance.currentIndex === index, `Viewer currentIndex must follow swipe to ${index + 1}/20`);
    assert(instance.swiperIndex === index, `Viewer swiperIndex must follow swipe to ${index + 1}/20`);
    assert(
      computed(component, instance, "counterText") === `${index + 1}/20`,
      `Viewer counter must stay at ${index + 1}/20 before media hydration`
    );

    const currentPhoto = instance.photos[index];
    instance.mediaProgress = {
      ...instance.mediaProgress,
      [`${currentPhoto.id}:thumbnail`]: {
        loading: true,
        failed: false,
        progress: 36
      }
    };
    assert(instance.showLoading(currentPhoto), `Photo ${index + 1} must show loading while first preview is loading`);
    assert(
      instance.loadingProgressValue(currentPhoto) === 36,
      `Photo ${index + 1} must show first-preview loading progress`
    );

    instance.handleThumbnailLoad(currentPhoto);
    assert(instance.thumbnailLoaded(currentPhoto), `Photo ${index + 1} thumbnail must be marked loaded`);
    assert(!instance.showFallback(currentPhoto), `Photo ${index + 1} must not show black fallback after thumbnail load`);

    instance.mediaProgress = {
      ...instance.mediaProgress,
      [`${currentPhoto.id}:thumbnail`]: {
        loading: false,
        failed: false,
        progress: 100
      },
      [`${currentPhoto.id}:preview`]: {
        loading: true,
        failed: false,
        progress: 58
      }
    };
    assert(
      !instance.showLoading(currentPhoto),
      `Photo ${index + 1} must not show progress while the second clearer image is loading`
    );
    const previousPhotos = instance.photos;
    instance.photos = instance.photos.map((photo, photoIndex) =>
      photoIndex === index
        ? {
            ...photo,
            preview_display_url: `wxfile://album-preview-${index + 1}.jpg`
          }
        : photo
    );
    component.watch.photos.call(instance, instance.photos, previousPhotos);

    const hydratedPhoto = instance.photos[index];
    assert(
      instance.currentIndex === index,
      `Viewer must not jump after photo ${index + 1} preview reaches 100%`
    );
    assert(
      instance.swiperIndex === index,
      `Viewer swiper must not jump after photo ${index + 1} preview reaches 100%`
    );
    assert(
      computed(component, instance, "counterText") === `${index + 1}/20`,
      `Viewer counter must stay at ${index + 1}/20 after media hydration`
    );
    assert(instance.previewCanLoad(hydratedPhoto), `Photo ${index + 1} preview must be allowed after thumbnail load`);
    instance.handlePreviewLoad(hydratedPhoto);
    assert(instance.previewLoaded(hydratedPhoto), `Photo ${index + 1} preview must be marked loaded`);
    assert(!instance.showFallback(hydratedPhoto), `Photo ${index + 1} must not show fallback after preview load`);
  }

  const changeEvents = emitted.filter((event) => event.event === "change");
  assert(changeEvents.length === 20, "Viewer must emit one change event for each 1-20 swipe step");
  assert(
    changeEvents.every((event, index) => event.payload.index === index),
    "Viewer change events must be ordered from photo 1 to photo 20"
  );
  runFastSwipeHydrationCheck(component);
}

runSequenceCheck();

if (!process.exitCode) {
  console.log("AlbumImageViewer 1-20 sequence check passed");
}
