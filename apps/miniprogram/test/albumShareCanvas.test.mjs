import assert from "node:assert/strict";
import test from "node:test";

import {
  albumShareCanvasLayout,
  albumShareCanvasPlan,
  createAlbumShareCanvasPreparation,
  normalizeAlbumShareCoverRecipe,
  renderAlbumShareCanvasCover,
  resolveAlbumShareCanvasSource
} from "../src/utils/albumShareCanvas.js";

const coverRecipe = (images = []) => ({
  version: "client-canvas-v1",
  images
});

const coverImage = (id, overrides = {}) => ({
  id,
  thumbnail_url: `https://cdn.example.test/thumb-${id}.jpg`,
  width: 1600,
  height: 1200,
  focus_x: 0.5,
  focus_y: 0.5,
  ...overrides
});

test("只接受当前封面配方版本，并安全归一化至三个唯一图片", () => {
  assert.equal(normalizeAlbumShareCoverRecipe({ version: "legacy-v1", images: [] }), null);

  assert.deepEqual(normalizeAlbumShareCoverRecipe(coverRecipe([
    coverImage("1", { width: "1600", focus_x: 1.6, focus_y: -0.2 }),
    coverImage(1, { thumbnail_url: "https://cdn.example.test/duplicate.jpg" }),
    coverImage(99, { thumbnail_url: " " }),
    coverImage(2, { width: 0 }),
    coverImage(3, { height: "900", focus_x: "0.25", focus_y: "0.75" }),
    coverImage(4)
  ])), {
    version: "client-canvas-v1",
    images: [
      {
        id: 1,
        thumbnail_url: "https://cdn.example.test/thumb-1.jpg",
        width: 1600,
        height: 1200,
        focus_x: 1,
        focus_y: 0
      },
      {
        id: 2,
        thumbnail_url: "https://cdn.example.test/thumb-2.jpg",
        width: 1,
        height: 1200,
        focus_x: 0.5,
        focus_y: 0.5
      },
      {
        id: 3,
        thumbnail_url: "https://cdn.example.test/thumb-3.jpg",
        width: 1600,
        height: 900,
        focus_x: 0.25,
        focus_y: 0.75
      }
    ]
  });
});

test("好友封面一至三图使用固定的 1000×800 布局", () => {
  assert.deepEqual(albumShareCanvasLayout("friend", 1), {
    width: 1000,
    height: 800,
    slots: [{ x: 0, y: 0, width: 1000, height: 800 }]
  });
  assert.deepEqual(albumShareCanvasLayout("friend", 2), {
    width: 1000,
    height: 800,
    slots: [
      { x: 0, y: 0, width: 620, height: 800 },
      { x: 620, y: 0, width: 380, height: 800 }
    ]
  });
  assert.deepEqual(albumShareCanvasLayout("friend", 3), {
    width: 1000,
    height: 800,
    slots: [
      { x: 0, y: 0, width: 620, height: 800 },
      { x: 620, y: 0, width: 380, height: 400 },
      { x: 620, y: 400, width: 380, height: 400 }
    ]
  });
});

test("时间线封面一至三图使用固定的 1000×1000 布局", () => {
  assert.deepEqual(albumShareCanvasLayout("timeline", 1), {
    width: 1000,
    height: 1000,
    slots: [{ x: 0, y: 0, width: 1000, height: 1000 }]
  });
  assert.deepEqual(albumShareCanvasLayout("timeline", 2), {
    width: 1000,
    height: 1000,
    slots: [
      { x: 0, y: 0, width: 1000, height: 580 },
      { x: 0, y: 580, width: 1000, height: 420 }
    ]
  });
  assert.deepEqual(albumShareCanvasLayout("timeline", 3), {
    width: 1000,
    height: 1000,
    slots: [
      { x: 0, y: 0, width: 1000, height: 580 },
      { x: 0, y: 580, width: 500, height: 420 },
      { x: 500, y: 580, width: 500, height: 420 }
    ]
  });
});

test("绘制计划按焦点进行 crop-to-fill，且永远不超过三张", () => {
  const plan = albumShareCanvasPlan("friend", [
    coverImage(1, { width: 1600, height: 900, focus_x: 0.8 })
  ]);
  const cappedPlan = albumShareCanvasPlan("friend", [
    coverImage(1),
    coverImage(2),
    coverImage(3),
    coverImage(4)
  ]);

  assert.equal(plan.width, 1000);
  assert.equal(plan.height, 800);
  assert.equal(cappedPlan.draws.length, 3);
  assert.deepEqual(plan.draws[0], {
    image: coverImage(1, { width: 1600, height: 900, focus_x: 0.8 }),
    source: { x: 475, y: 0, width: 1125, height: 900 },
    destination: { x: 0, y: 0, width: 1000, height: 800 }
  });
});

test("本地相册预览优先于远程缩略图，缺失时才回退到缩略图 URL", () => {
  const image = coverImage(12);
  assert.equal(
    resolveAlbumShareCanvasSource(image, { 12: "wxfile://album-preview-12.jpg" }),
    "wxfile://album-preview-12.jpg"
  );
  assert.equal(
    resolveAlbumShareCanvasSource(image, () => ""),
    "https://cdn.example.test/thumb-12.jpg"
  );
});

test("Canvas 运行时加载、绘制并导出本地 JPEG 封面", async () => {
  const calls = [];
  const runtime = {
    createCanvas(options) {
      calls.push(["createCanvas", options]);
      return { type: "fake-canvas" };
    },
    loadImage(source) {
      calls.push(["loadImage", source]);
      return { source };
    },
    drawImage(canvas, image, draw) {
      calls.push(["drawImage", canvas, image, draw]);
    },
    exportCanvas(canvas, options) {
      calls.push(["exportCanvas", canvas, options]);
      return { tempFilePath: "wxfile://share-cover-timeline.jpg" };
    }
  };

  const result = await renderAlbumShareCanvasCover({
    kind: "timeline",
    recipe: coverRecipe([coverImage(1), coverImage(2)]),
    localPreviewByMediaId: { 1: "wxfile://cached-preview-1.jpg" },
    runtime
  });

  assert.equal(result.ok, true);
  assert.equal(result.path, "wxfile://share-cover-timeline.jpg");
  assert.deepEqual(calls.slice(0, 3), [
    ["createCanvas", { width: 1000, height: 1000 }],
    ["loadImage", "wxfile://cached-preview-1.jpg"],
    ["drawImage", { type: "fake-canvas" }, { source: "wxfile://cached-preview-1.jpg" }, result.plan.draws[0]]
  ]);
  assert.equal(calls[3][0], "loadImage");
  assert.equal(calls[3][1], "https://cdn.example.test/thumb-2.jpg");
  assert.deepEqual(calls.at(-1), [
    "exportCanvas",
    { type: "fake-canvas" },
    { width: 1000, height: 1000, fileType: "jpg", quality: 0.82 }
  ]);
});

test("未注入运行时时使用 uni 离屏 Canvas 生成本地 JPEG", async () => {
  const calls = [];
  const context = {
    drawImage(...args) {
      calls.push(["drawImage", ...args]);
    }
  };
  const offscreenCanvas = {
    createImage() {
      const image = {};
      Object.defineProperty(image, "src", {
        set(source) {
          calls.push(["image.src", source]);
          queueMicrotask(() => image.onload());
        }
      });
      return image;
    },
    getContext(kind) {
      calls.push(["getContext", kind]);
      return context;
    }
  };
  const uniApi = {
    createOffscreenCanvas(options) {
      calls.push(["createOffscreenCanvas", options]);
      return offscreenCanvas;
    },
    canvasToTempFilePath(options) {
      calls.push(["canvasToTempFilePath", options]);
      options.success({ tempFilePath: "wxfile://offscreen-cover.jpg" });
    }
  };

  const result = await renderAlbumShareCanvasCover({
    kind: "friend",
    recipe: coverRecipe([coverImage(1)]),
    uniApi
  });

  assert.equal(result.ok, true);
  assert.equal(result.path, "wxfile://offscreen-cover.jpg");
  assert.deepEqual(calls.slice(0, 3), [
    ["createOffscreenCanvas", { type: "2d", width: 1000, height: 800 }],
    ["getContext", "2d"],
    ["image.src", "https://cdn.example.test/thumb-1.jpg"]
  ]);
  assert.equal(calls[3][0], "drawImage");
  const exportCall = calls.at(-1);
  assert.equal(exportCall[0], "canvasToTempFilePath");
  const { success, fail, ...exportOptions } = exportCall[1];
  assert.deepEqual(exportOptions, {
    canvas: offscreenCanvas,
    x: 0,
    y: 0,
    width: 1000,
    height: 800,
    destWidth: 1000,
    destHeight: 800,
    fileType: "jpg",
    quality: 0.82
  });
  assert.equal(typeof success, "function");
  assert.equal(typeof fail, "function");
});

test("离屏 Canvas 不可用时使用提供的页面 Canvas 适配器", async () => {
  const calls = [];
  const result = await renderAlbumShareCanvasCover({
    kind: "timeline",
    recipe: coverRecipe([coverImage(1)]),
    uniApi: {},
    pageCanvasRuntime: {
      createCanvas: (options) => {
        calls.push(["createCanvas", options]);
        return { page: true };
      },
      loadImage: (source) => {
        calls.push(["loadImage", source]);
        return { source };
      },
      drawImage: (canvas, image) => calls.push(["drawImage", canvas, image]),
      exportCanvas: (_canvas, options) => {
        calls.push(["exportCanvas", options]);
        return "wxfile://page-fallback-cover.jpg";
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.path, "wxfile://page-fallback-cover.jpg");
  assert.deepEqual(calls[0], ["createCanvas", { width: 1000, height: 1000 }]);
  assert.deepEqual(calls.at(-1), [
    "exportCanvas",
    { width: 1000, height: 1000, fileType: "jpg", quality: 0.82 }
  ]);
});

test("标题绘制会尝试执行，但文本运行时失败不会阻塞封面导出", async () => {
  let titleDraws = 0;
  let exports = 0;
  const result = await renderAlbumShareCanvasCover({
    kind: "friend",
    title: "雾都夜行｜游玩相册",
    recipe: coverRecipe([coverImage(1)]),
    runtime: {
      createCanvas: () => ({}),
      loadImage: () => ({}),
      drawImage: () => {},
      drawText: () => {
        titleDraws += 1;
        throw new Error("text unavailable");
      },
      exportCanvas: () => {
        exports += 1;
        return "wxfile://cover-without-title.jpg";
      }
    }
  });

  assert.equal(titleDraws, 1);
  assert.equal(exports, 1);
  assert.equal(result.ok, true);
  assert.equal(result.kind, "friend");
  assert.equal(result.path, "wxfile://cover-without-title.jpg");
});

test("Canvas 加载、运行时与导出失败都以可降级结果返回", async () => {
  const recipe = coverRecipe([coverImage(1)]);
  const loadFailure = await renderAlbumShareCanvasCover({
    kind: "friend",
    recipe,
    runtime: {
      createCanvas: () => ({}),
      loadImage: () => { throw new Error("unavailable"); },
      drawImage: () => {},
      exportCanvas: () => "wxfile://unused.jpg"
    }
  });
  const runtimeFailure = await renderAlbumShareCanvasCover({ kind: "friend", recipe });
  const exportFailure = await renderAlbumShareCanvasCover({
    kind: "friend",
    recipe,
    runtime: {
      createCanvas: () => ({}),
      loadImage: () => ({}),
      drawImage: () => {},
      exportCanvas: () => "https://cdn.example.test/not-a-local-file.jpg"
    }
  });

  assert.deepEqual(loadFailure, {
    ok: false,
    kind: "friend",
    path: "",
    error: "source_load_failed"
  });
  assert.deepEqual(runtimeFailure, {
    ok: false,
    kind: "friend",
    path: "",
    error: "runtime_unavailable"
  });
  assert.deepEqual(exportFailure, {
    ok: false,
    kind: "friend",
    path: "",
    error: "export_failed"
  });
});

test("封面准备按 share、配方摘要和渠道去重，并复用本地临时路径", async () => {
  let rendererCalls = 0;
  let resolveRender;
  const preparation = createAlbumShareCanvasPreparation({
    renderer: () => {
      rendererCalls += 1;
      return new Promise((resolve) => {
        resolveRender = resolve;
      });
    }
  });
  const request = preparation.beginRequest();
  const options = {
    shareId: 42,
    kind: "friend",
    recipe: coverRecipe([coverImage(1)]),
    request
  };
  const first = preparation.prepare(options);
  const second = preparation.prepare(options);

  assert.equal(rendererCalls, 1);
  resolveRender({ ok: true, kind: "friend", path: "wxfile://cached-friend.jpg" });
  assert.deepEqual(await first, {
    ok: true,
    kind: "friend",
    path: "wxfile://cached-friend.jpg",
    cached: false
  });
  assert.deepEqual(await second, {
    ok: true,
    kind: "friend",
    path: "wxfile://cached-friend.jpg",
    cached: false
  });
  assert.deepEqual(await preparation.prepare(options), {
    ok: true,
    kind: "friend",
    path: "wxfile://cached-friend.jpg",
    cached: true
  });
  assert.equal(rendererCalls, 1);
});

test("过期的封面准备请求会丢弃迟到结果", async () => {
  let resolveRender;
  const preparation = createAlbumShareCanvasPreparation({
    renderer: () => new Promise((resolve) => {
      resolveRender = resolve;
    })
  });
  const staleRequest = preparation.beginRequest();
  const pending = preparation.prepare({
    shareId: 77,
    kind: "timeline",
    recipe: coverRecipe([coverImage(1)]),
    request: staleRequest
  });
  preparation.beginRequest();
  resolveRender({ ok: true, kind: "timeline", path: "wxfile://late-timeline.jpg" });

  assert.deepEqual(await pending, {
    ok: false,
    kind: "timeline",
    path: "",
    error: "stale_request"
  });
});

test("失效请求不能污染同键新请求的在途或缓存封面", async () => {
  const resolves = [];
  let rendererCalls = 0;
  const preparation = createAlbumShareCanvasPreparation({
    renderer: () => {
      rendererCalls += 1;
      return new Promise((resolve) => resolves.push(resolve));
    }
  });
  const options = {
    shareId: 88,
    kind: "friend",
    recipe: coverRecipe([coverImage(1)])
  };
  const requestA = preparation.beginRequest();
  const pendingA = preparation.prepare({ ...options, request: requestA });
  const requestB = preparation.beginRequest();
  const pendingB = preparation.prepare({ ...options, request: requestB });

  assert.equal(rendererCalls, 2);
  resolves[0]({ ok: true, kind: "friend", path: "wxfile://stale-a.jpg" });
  assert.deepEqual(await pendingA, {
    ok: false,
    kind: "friend",
    path: "",
    error: "stale_request"
  });

  resolves[1]({ ok: true, kind: "friend", path: "wxfile://fresh-b.jpg" });
  assert.deepEqual(await pendingB, {
    ok: true,
    kind: "friend",
    path: "wxfile://fresh-b.jpg",
    cached: false
  });

  const requestC = preparation.beginRequest();
  assert.deepEqual(await preparation.prepare({ ...options, request: requestC }), {
    ok: true,
    kind: "friend",
    path: "wxfile://fresh-b.jpg",
    cached: true
  });
});

test("缓存键区分分享、配方摘要和分享渠道", async () => {
  let rendererCalls = 0;
  const preparation = createAlbumShareCanvasPreparation({
    renderer: ({ kind }) => {
      rendererCalls += 1;
      return { ok: true, kind, path: `wxfile://cover-${rendererCalls}.jpg` };
    }
  });
  const render = async (options) => preparation.prepare({
    ...options,
    request: preparation.beginRequest()
  });
  const recipeA = coverRecipe([coverImage(1)]);
  const recipeB = coverRecipe([coverImage(2)]);

  assert.equal((await render({ shareId: 10, kind: "friend", recipe: recipeA })).path, "wxfile://cover-1.jpg");
  assert.equal((await render({ shareId: 11, kind: "friend", recipe: recipeA })).path, "wxfile://cover-2.jpg");
  assert.equal((await render({ shareId: 10, kind: "friend", recipe: recipeB })).path, "wxfile://cover-3.jpg");
  assert.equal((await render({ shareId: 10, kind: "timeline", recipe: recipeA })).path, "wxfile://cover-4.jpg");
  assert.equal(rendererCalls, 4);
});

test("九图配方只加载并绘制前面三个本地预览", async () => {
  const loaded = [];
  const drawn = [];
  const images = Array.from({ length: 9 }, (_, index) => coverImage(index + 1));
  const localPreviewByMediaId = Object.fromEntries(images.map((image) => [
    image.id,
    `wxfile://local-${image.id}.jpg`
  ]));

  const result = await renderAlbumShareCanvasCover({
    kind: "friend",
    recipe: coverRecipe(images),
    localPreviewByMediaId,
    runtime: {
      createCanvas: () => ({}),
      loadImage: (source) => {
        loaded.push(source);
        return { source };
      },
      drawImage: (_canvas, image) => drawn.push(image.source),
      exportCanvas: () => "wxfile://three-images-only.jpg"
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.draws.map((draw) => draw.image.id), [1, 2, 3]);
  assert.deepEqual(loaded, [
    "wxfile://local-1.jpg",
    "wxfile://local-2.jpg",
    "wxfile://local-3.jpg"
  ]);
  assert.deepEqual(drawn, loaded);
});
