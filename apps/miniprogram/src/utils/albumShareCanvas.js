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
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
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
  const sourceWidth = positiveDimension(image?.width);
  const sourceHeight = positiveDimension(image?.height);
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

export function resolveAlbumShareCanvasSource(image = {}, localPreviewByMediaId) {
  return localPreviewFor(image, localPreviewByMediaId) || trimmedString(image?.thumbnail_url);
}

export async function renderAlbumShareCanvasCover({
  kind,
  recipe,
  localPreviewByMediaId,
  runtime
} = {}) {
  if (!isSupportedKind(kind)) return failure(kind, "invalid_kind");
  const normalizedRecipe = normalizeAlbumShareCoverRecipe(recipe);
  if (!normalizedRecipe) return failure(kind, "invalid_recipe");
  if (
    !runtime ||
    typeof runtime.createCanvas !== "function" ||
    typeof runtime.loadImage !== "function" ||
    typeof runtime.drawImage !== "function" ||
    typeof runtime.exportCanvas !== "function"
  ) {
    return failure(kind, "runtime_unavailable");
  }

  const plan = albumShareCanvasPlan(kind, normalizedRecipe.images);
  let canvas;
  try {
    canvas = await runtime.createCanvas({ width: plan.width, height: plan.height });
  } catch {
    return failure(kind, "runtime_unavailable");
  }
  if (!canvas) return failure(kind, "runtime_unavailable");

  for (const draw of plan.draws) {
    const source = resolveAlbumShareCanvasSource(draw.image, localPreviewByMediaId);
    if (!source) return failure(kind, "source_unavailable");
    let image;
    try {
      image = await runtime.loadImage(source);
    } catch {
      return failure(kind, "source_load_failed");
    }
    if (!image) return failure(kind, "source_load_failed");
    try {
      await runtime.drawImage(canvas, image, draw);
    } catch {
      return failure(kind, "render_failed");
    }
  }

  let exported;
  try {
    exported = await runtime.exportCanvas(canvas, {
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
  return { ok: true, kind, path, plan };
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
  cache = new Map()
} = {}) {
  const cachedPaths = cache && typeof cache.get === "function" && typeof cache.set === "function"
    ? cache
    : new Map();
  const inFlight = new Map();
  let currentRequest = null;
  let requestSerial = 0;

  const isCurrent = (request) => request === currentRequest;
  const resultForRequest = (request, result) => (
    request && !isCurrent(request) ? failure(result.kind, "stale_request") : result
  );

  return {
    beginRequest() {
      currentRequest = Object.freeze({ serial: ++requestSerial });
      return currentRequest;
    },
    isCurrent,
    prepare({ shareId, kind, recipe, localPreviewByMediaId, request } = {}) {
      if (!isSupportedKind(kind)) return Promise.resolve(failure(kind, "invalid_kind"));
      if (request && !isCurrent(request)) return Promise.resolve(failure(kind, "stale_request"));
      const normalizedRecipe = normalizeAlbumShareCoverRecipe(recipe);
      if (!normalizedRecipe) return Promise.resolve(failure(kind, "invalid_recipe"));
      const normalizedId = normalizedShareId(shareId);
      if (!normalizedId) return Promise.resolve(failure(kind, "invalid_recipe"));
      const digest = albumShareCanvasRecipeDigest(normalizedRecipe);
      const cacheKey = `${normalizedId}:${digest}:${kind}`;
      const cachedPath = localTemporaryPath(cachedPaths.get(cacheKey));
      if (cachedPath) {
        return Promise.resolve(resultForRequest(request, {
          ok: true,
          kind,
          path: cachedPath,
          cached: true
        }));
      }

      let work = inFlight.get(cacheKey);
      if (!work) {
        let rendered;
        try {
          rendered = renderer({
            kind,
            recipe: normalizedRecipe,
            localPreviewByMediaId,
            runtime
          });
        } catch {
          rendered = failure(kind, "render_failed");
        }
        work = Promise.resolve(rendered)
          .then((result) => normalizedRendererResult(result, kind))
          .then((result) => {
            if (result.ok) cachedPaths.set(cacheKey, result.path);
            return result.ok
              ? { ...result, cached: false }
              : result;
          })
          .catch(() => failure(kind, "render_failed"))
          .finally(() => inFlight.delete(cacheKey));
        inFlight.set(cacheKey, work);
      }
      return work.then((result) => resultForRequest(request, result));
    }
  };
}
