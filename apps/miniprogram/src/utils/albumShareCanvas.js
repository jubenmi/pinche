export const ALBUM_SHARE_CANVAS_RECIPE_VERSION = "client-canvas-v1";

const COVER_KINDS = new Set(["friend", "timeline"]);
const MAX_COVER_IMAGES = 3;
const CANVAS_LAYOUTS = {
  friend: { width: 1000, height: 800 },
  timeline: { width: 1000, height: 1000 }
};
const FAILURE_CODES = new Set([
  "invalid_kind",
  "invalid_recipe",
  "runtime_unavailable",
  "source_unavailable",
  "source_load_failed",
  "invalid_image_dimensions",
  "render_failed",
  "export_failed",
  "stale_request"
]);

function trimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveSafeInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  const text = trimmedString(value);
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function positiveDimension(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function imageDimensions(image = {}) {
  const width = positiveDimension(image?.width);
  const height = positiveDimension(image?.height);
  return width && height ? { width, height } : null;
}

function normalizedFocus(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.5;
  return Math.min(1, Math.max(0, parsed));
}

function normalizedImage(image = {}) {
  const id = positiveSafeInteger(image?.id);
  const thumbnailUrl = trimmedString(image?.thumbnail_url);
  if (!id || !thumbnailUrl) return null;
  return {
    id,
    thumbnail_url: thumbnailUrl,
    width: positiveDimension(image?.width),
    height: positiveDimension(image?.height),
    focus_x: normalizedFocus(image?.focus_x),
    focus_y: normalizedFocus(image?.focus_y)
  };
}

function normalizedImages(images = []) {
  if (!Array.isArray(images)) return [];
  const normalized = [];
  const seen = new Set();
  for (const image of images) {
    const candidate = normalizedImage(image);
    if (!candidate || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    normalized.push(candidate);
    if (normalized.length === MAX_COVER_IMAGES) break;
  }
  return normalized;
}

function clampedOffset(focus, sourceSize, cropSize) {
  const available = Math.max(0, sourceSize - cropSize);
  return Math.min(available, Math.max(0, focus * sourceSize - cropSize / 2));
}

function cropToFill(image, destination) {
  const dimensions = imageDimensions(image);
  if (!dimensions) return null;
  const { width: sourceWidth, height: sourceHeight } = dimensions;
  const destinationRatio = destination.width / destination.height;
  const sourceRatio = sourceWidth / sourceHeight;
  let width = sourceWidth;
  let height = sourceHeight;
  let x = 0;
  let y = 0;

  if (sourceRatio > destinationRatio) {
    width = sourceHeight * destinationRatio;
    x = clampedOffset(normalizedFocus(image?.focus_x), sourceWidth, width);
  } else if (sourceRatio < destinationRatio) {
    height = sourceWidth / destinationRatio;
    y = clampedOffset(normalizedFocus(image?.focus_y), sourceHeight, height);
  }

  return { x, y, width, height };
}

function localPreviewPath(value) {
  if (typeof value === "string") return trimmedString(value);
  if (!value || typeof value !== "object") return "";
  return trimmedString(
    value.tempFilePath || value.filePath || value.path || value.src || value.url
  );
}

function localPreviewFor(image, localPreviewByMediaId) {
  try {
    if (typeof localPreviewByMediaId === "function") {
      return localPreviewPath(localPreviewByMediaId(image.id, image));
    }
    if (localPreviewByMediaId instanceof Map) {
      return localPreviewPath(
        localPreviewByMediaId.get(image.id) || localPreviewByMediaId.get(String(image.id))
      );
    }
    if (localPreviewByMediaId && typeof localPreviewByMediaId === "object") {
      return localPreviewPath(localPreviewByMediaId[image.id]);
    }
  } catch {
    return "";
  }
  return "";
}

function failure(kind, error) {
  return { ok: false, kind, path: "", error };
}

function isSupportedKind(kind) {
  return COVER_KINDS.has(kind);
}

function localTemporaryPath(value) {
  const path = localPreviewPath(value);
  return /^https?:\/\//i.test(path) ? "" : path;
}

function normalizedRendererResult(result, kind) {
  const path = result?.ok === true ? localTemporaryPath(result.path) : "";
  if (path) return { ok: true, kind, path };
  const code = trimmedString(result?.error);
  return failure(kind, FAILURE_CODES.has(code) ? code : "render_failed");
}

function normalizedShareId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  const text = trimmedString(value);
  return text ? text : "";
}

function shortTitle(value) {
  return trimmedString(value).slice(0, 48);
}

function titleDrawOptions(plan) {
  return {
    x: 36,
    y: plan.height - 36,
    maxWidth: plan.width - 72,
    font: "600 32px sans-serif",
    fillStyle: "#ffffff",
    textBaseline: "alphabetic"
  };
}

function canvasRuntimeAvailable(runtime) {
  return Boolean(
    runtime &&
    typeof runtime.createCanvas === "function" &&
    typeof runtime.loadImage === "function" &&
    typeof runtime.drawImage === "function" &&
    typeof runtime.exportCanvas === "function"
  );
}

function currentUniApi(uniApi) {
  if (uniApi && typeof uniApi === "object") return uniApi;
  return typeof uni !== "undefined" && uni ? uni : null;
}

function callbackCanvasOperation(invoke) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    let returned;
    try {
      returned = invoke({ success: succeed, fail });
    } catch (error) {
      fail(error);
      return;
    }
    if (returned && typeof returned.then === "function") {
      returned.then(succeed, fail);
    } else if (typeof returned === "string" || returned?.tempFilePath || returned?.filePath) {
      succeed(returned);
    }
  });
}

function exportOffscreenCanvas(canvas, options) {
  const exportOptions = {
    x: 0,
    y: 0,
    width: options.width,
    height: options.height,
    destWidth: options.width,
    destHeight: options.height,
    fileType: options.fileType,
    quality: options.quality
  };
  if (typeof canvas?.toTempFilePath !== "function") {
    throw new Error("offscreen canvas export unavailable");
  }
  return callbackCanvasOperation(({ success, fail }) => canvas.toTempFilePath({
    ...exportOptions,
    success,
    fail
  }));
}

export function createAlbumShareCanvasRuntime({ uniApi, pageCanvasRuntime } = {}) {
  const resolvedUniApi = currentUniApi(uniApi);
  const fallback = canvasRuntimeAvailable(pageCanvasRuntime) ? pageCanvasRuntime : null;
  if (typeof resolvedUniApi?.createOffscreenCanvas !== "function") return fallback;

  return {
    async createCanvas(options) {
      try {
        const canvas = await resolvedUniApi.createOffscreenCanvas({
          type: "2d",
          width: options.width,
          height: options.height
        });
        const context = canvas?.getContext?.("2d");
        if (
          !canvas ||
          !context ||
          typeof canvas.createImage !== "function" ||
          typeof canvas.toTempFilePath !== "function"
        ) {
          throw new Error("offscreen canvas unavailable");
        }
        return { canvas, context };
      } catch (error) {
        if (!fallback) throw error;
        return { fallback: true, canvas: await fallback.createCanvas(options) };
      }
    },
    loadImage(source, canvasHandle) {
      if (canvasHandle?.fallback) {
        return fallback.loadImage(source, canvasHandle.canvas);
      }
      const canvas = canvasHandle?.canvas;
      return new Promise((resolve, reject) => {
        let image;
        try {
          image = canvas?.createImage();
          if (!image) throw new Error("canvas image unavailable");
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = source;
        } catch (error) {
          reject(error);
        }
      });
    },
    drawImage(canvasHandle, image, draw) {
      if (canvasHandle?.fallback) {
        return fallback.drawImage(canvasHandle.canvas, image, draw);
      }
      const context = canvasHandle?.context;
      if (!context || typeof context.drawImage !== "function") {
        throw new Error("canvas drawing unavailable");
      }
      return context.drawImage(
        image,
        draw.source.x,
        draw.source.y,
        draw.source.width,
        draw.source.height,
        draw.destination.x,
        draw.destination.y,
        draw.destination.width,
        draw.destination.height
      );
    },
    drawText(canvasHandle, text, options) {
      if (canvasHandle?.fallback) {
        if (typeof fallback.drawText !== "function") return;
        return fallback.drawText(canvasHandle.canvas, text, options);
      }
      const context = canvasHandle?.context;
      if (!context || typeof context.fillText !== "function") return;
      const canRestore = typeof context.save === "function" && typeof context.restore === "function";
      if (canRestore) context.save();
      try {
        context.font = options.font;
        context.fillStyle = options.fillStyle;
        context.textBaseline = options.textBaseline;
        context.fillText(text, options.x, options.y, options.maxWidth);
      } finally {
        if (canRestore) context.restore();
      }
    },
    exportCanvas(canvasHandle, options) {
      if (canvasHandle?.fallback) {
        return fallback.exportCanvas(canvasHandle.canvas, options);
      }
      return exportOffscreenCanvas(canvasHandle?.canvas, options);
    }
  };
}

export function normalizeAlbumShareCoverRecipe(recipe = {}) {
  if (recipe?.version !== ALBUM_SHARE_CANVAS_RECIPE_VERSION) return null;
  const images = normalizedImages(recipe?.images);
  if (images.length === 0) return null;
  return { version: ALBUM_SHARE_CANVAS_RECIPE_VERSION, images };
}

export function albumShareCanvasLayout(kind, count) {
  if (!isSupportedKind(kind)) {
    throw new TypeError("album share canvas kind must be friend or timeline");
  }
  const layout = CANVAS_LAYOUTS[kind];
  const normalizedCount = Math.min(
    MAX_COVER_IMAGES,
    Math.max(0, Number.isSafeInteger(count) ? count : 0)
  );
  let slots = [];

  if (normalizedCount === 1) {
    slots = [{ x: 0, y: 0, width: layout.width, height: layout.height }];
  } else if (normalizedCount === 2 && kind === "friend") {
    slots = [
      { x: 0, y: 0, width: 620, height: 800 },
      { x: 620, y: 0, width: 380, height: 800 }
    ];
  } else if (normalizedCount === 3 && kind === "friend") {
    slots = [
      { x: 0, y: 0, width: 620, height: 800 },
      { x: 620, y: 0, width: 380, height: 400 },
      { x: 620, y: 400, width: 380, height: 400 }
    ];
  } else if (normalizedCount === 2) {
    slots = [
      { x: 0, y: 0, width: 1000, height: 580 },
      { x: 0, y: 580, width: 1000, height: 420 }
    ];
  } else if (normalizedCount === 3) {
    slots = [
      { x: 0, y: 0, width: 1000, height: 580 },
      { x: 0, y: 580, width: 500, height: 420 },
      { x: 500, y: 580, width: 500, height: 420 }
    ];
  }

  return { width: layout.width, height: layout.height, slots };
}

export function albumShareCanvasPlan(kind, images = []) {
  const normalized = normalizedImages(images);
  const layout = albumShareCanvasLayout(kind, normalized.length);
  return {
    kind,
    width: layout.width,
    height: layout.height,
    draws: normalized.map((image, index) => ({
      image,
      source: cropToFill(image, layout.slots[index]),
      destination: layout.slots[index]
    }))
  };
}

export function resolveAlbumShareCanvasSource(
  image = {},
  localPreviewByMediaId,
  thumbnailUrlResolver
) {
  // The resolver receives only a remote fallback URL and its normalized descriptor.
  const localPreview = localPreviewFor(image, localPreviewByMediaId);
  if (localPreview) return localPreview;
  const thumbnailUrl = trimmedString(image?.thumbnail_url);
  if (!thumbnailUrl || typeof thumbnailUrlResolver !== "function") return thumbnailUrl;
  try {
    return trimmedString(thumbnailUrlResolver(thumbnailUrl, image));
  } catch {
    return "";
  }
}

export async function renderAlbumShareCanvasCover({
  kind,
  recipe,
  title,
  localPreviewByMediaId,
  thumbnailUrlResolver,
  runtime,
  uniApi,
  pageCanvasRuntime
} = {}) {
  if (!isSupportedKind(kind)) return failure(kind, "invalid_kind");
  const normalizedRecipe = normalizeAlbumShareCoverRecipe(recipe);
  if (!normalizedRecipe) return failure(kind, "invalid_recipe");
  const canvasRuntime = runtime || createAlbumShareCanvasRuntime({ uniApi, pageCanvasRuntime });
  if (!canvasRuntimeAvailable(canvasRuntime)) {
    return failure(kind, "runtime_unavailable");
  }

  const plan = albumShareCanvasPlan(kind, normalizedRecipe.images);
  let canvas;
  try {
    canvas = await canvasRuntime.createCanvas({ width: plan.width, height: plan.height });
  } catch {
    return failure(kind, "runtime_unavailable");
  }
  if (!canvas) return failure(kind, "runtime_unavailable");

  const completedDraws = [];
  for (const pendingDraw of plan.draws) {
    const source = resolveAlbumShareCanvasSource(
      pendingDraw.image,
      localPreviewByMediaId,
      thumbnailUrlResolver
    );
    if (!source) return failure(kind, "source_unavailable");
    let image;
    try {
      image = await canvasRuntime.loadImage(source, canvas);
    } catch {
      return failure(kind, "source_load_failed");
    }
    if (!image) return failure(kind, "source_load_failed");
    const dimensions = imageDimensions(pendingDraw.image) || imageDimensions(image);
    if (!dimensions) return failure(kind, "invalid_image_dimensions");
    const draw = {
      ...pendingDraw,
      source: cropToFill({ ...pendingDraw.image, ...dimensions }, pendingDraw.destination)
    };
    if (!draw.source) return failure(kind, "invalid_image_dimensions");
    try {
      await canvasRuntime.drawImage(canvas, image, draw);
    } catch {
      return failure(kind, "render_failed");
    }
    completedDraws.push(draw);
  }

  const completedPlan = { ...plan, draws: completedDraws };

  const normalizedTitle = shortTitle(title);
  if (normalizedTitle && typeof canvasRuntime.drawText === "function") {
    try {
      await canvasRuntime.drawText(canvas, normalizedTitle, titleDrawOptions(completedPlan));
    } catch {
      // Cover export remains useful when a platform does not support text drawing.
    }
  }

  let exported;
  try {
    exported = await canvasRuntime.exportCanvas(canvas, {
      width: plan.width,
      height: plan.height,
      fileType: "jpg",
      quality: 0.82
    });
  } catch {
    return failure(kind, "export_failed");
  }
  const path = localTemporaryPath(exported);
  if (!path) return failure(kind, "export_failed");
  return { ok: true, kind, path, plan: completedPlan };
}

export function albumShareCanvasRecipeDigest(recipe = {}) {
  const normalizedRecipe = normalizeAlbumShareCoverRecipe(recipe);
  if (!normalizedRecipe) return "";
  return normalizedRecipe.images.map((image) => [
    image.id,
    encodeURIComponent(image.thumbnail_url),
    image.width,
    image.height,
    image.focus_x,
    image.focus_y
  ].join(":")).join("|");
}

export function createAlbumShareCanvasPreparation({
  renderer = renderAlbumShareCanvasCover,
  runtime,
  cache = new Map(),
  releaseTempPath
} = {}) {
  const cachedPaths = cache &&
    typeof cache.get === "function" &&
    typeof cache.set === "function" &&
    typeof cache.clear === "function" &&
    typeof cache.values === "function"
    ? cache
    : new Map();
  const inFlight = new Map();
  let currentRequest = null;
  let requestSerial = 0;

  const isCurrent = (request) => request === currentRequest;
  const workIsCurrent = (request) => !request || isCurrent(request);
  const resultForRequest = (request, result) => (
    request && !isCurrent(request) ? failure(result.kind, "stale_request") : result
  );
  const invalidate = () => {
    currentRequest = Object.freeze({ serial: ++requestSerial, invalidated: true });
  };
  const releasePath = (path) => {
    if (!path || typeof releaseTempPath !== "function") return;
    try {
      const pending = releaseTempPath(path);
      if (pending && typeof pending.then === "function") Promise.resolve(pending).catch(() => {});
    } catch {
      // Releasing a temporary file must not disturb the share-cover lifecycle.
    }
  };
  const clear = () => {
    invalidate();
    const paths = new Set(
      Array.from(cachedPaths.values(), (path) => localTemporaryPath(path)).filter(Boolean)
    );
    cachedPaths.clear();
    inFlight.clear();
    paths.forEach(releasePath);
  };

  return {
    beginRequest() {
      currentRequest = Object.freeze({ serial: ++requestSerial });
      return currentRequest;
    },
    isCurrent,
    clear,
    dispose: clear,
    prepare({
      shareId,
      kind,
      recipe,
      title,
      localPreviewByMediaId,
      thumbnailUrlResolver,
      request
    } = {}) {
      if (!isSupportedKind(kind)) return Promise.resolve(failure(kind, "invalid_kind"));
      if (request && !isCurrent(request)) return Promise.resolve(failure(kind, "stale_request"));
      const normalizedRecipe = normalizeAlbumShareCoverRecipe(recipe);
      if (!normalizedRecipe) return Promise.resolve(failure(kind, "invalid_recipe"));
      const normalizedId = normalizedShareId(shareId);
      if (!normalizedId) return Promise.resolve(failure(kind, "invalid_recipe"));
      const digest = albumShareCanvasRecipeDigest(normalizedRecipe);
      const normalizedTitle = shortTitle(title);
      const cacheKey = `${normalizedId}:${digest}:${kind}:${encodeURIComponent(normalizedTitle)}`;
      const cachedPath = localTemporaryPath(cachedPaths.get(cacheKey));
      if (cachedPath) {
        return Promise.resolve(resultForRequest(request, {
          ok: true,
          kind,
          path: cachedPath,
          cached: true
        }));
      }

      let entry = inFlight.get(cacheKey);
      if (!entry || entry.request !== request) {
        let rendered;
        try {
          rendered = renderer({
            kind,
            recipe: normalizedRecipe,
            title: normalizedTitle,
            localPreviewByMediaId,
            thumbnailUrlResolver,
            runtime
          });
        } catch {
          rendered = failure(kind, "render_failed");
        }
        const work = Promise.resolve(rendered)
          .then((result) => normalizedRendererResult(result, kind))
          .then((result) => {
            if (!workIsCurrent(request)) {
              if (result.ok) releasePath(result.path);
              return failure(kind, "stale_request");
            }
            if (result.ok) cachedPaths.set(cacheKey, result.path);
            return result.ok
              ? { ...result, cached: false }
              : result;
          })
          .catch(() => failure(kind, "render_failed"))
          .finally(() => {
            if (inFlight.get(cacheKey) === entry) inFlight.delete(cacheKey);
          });
        entry = { request, work };
        inFlight.set(cacheKey, entry);
      }
      return entry.work.then((result) => resultForRequest(request, result));
    }
  };
}
