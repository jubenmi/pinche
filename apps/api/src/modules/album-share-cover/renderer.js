import sharp from "sharp";

import { albumShareCoverCopy, escapeAlbumShareCoverXml } from "./copy.js";
import { albumShareCoverLayout } from "./layouts.js";
import { assignAlbumShareImagesToSlots } from "./selection.js";

const BACKGROUND = "#F4EBDD";
const FONT_FAMILY = '"Noto Sans CJK SC", "PingFang SC", sans-serif';
const SOURCE_JOB_CONCURRENCY = 2;

function validateImages(images) {
  if (!Array.isArray(images)) throw new TypeError("album share cover images must be an array");
  for (const image of images) {
    if (!Buffer.isBuffer(image?.buffer) || image.buffer.length === 0) {
      throw new TypeError("every album share cover image requires a valid buffer");
    }
  }
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function insetSlot(slot, output, normalizedGutter) {
  const rawLeft = Math.round(slot.x * output.width);
  const rawTop = Math.round(slot.y * output.height);
  const rawRight = Math.round((slot.x + slot.width) * output.width);
  const rawBottom = Math.round((slot.y + slot.height) * output.height);
  const horizontalGutter = Math.round(normalizedGutter * output.width);
  const verticalGutter = Math.round(normalizedGutter * output.height);

  const left = rawLeft === 0 ? rawLeft : rawLeft + Math.ceil(horizontalGutter / 2);
  const top = rawTop === 0 ? rawTop : rawTop + Math.ceil(verticalGutter / 2);
  const right = rawRight === output.width ? rawRight : rawRight - Math.floor(horizontalGutter / 2);
  const bottom = rawBottom === output.height ? rawBottom : rawBottom - Math.floor(verticalGutter / 2);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0 || left < 0 || top < 0 || right > output.width || bottom > output.height) {
    throw new RangeError("album share cover slot falls outside the output canvas");
  }
  return { left, top, width, height };
}

async function mapSourceJobs(values, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  let failure = null;
  const worker = async () => {
    while (nextIndex < values.length && !failure) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(values[index], index);
      } catch (error) {
        failure ??= error;
      }
    }
  };
  const workers = Array.from(
    { length: Math.min(SOURCE_JOB_CONCURRENCY, values.length) },
    () => worker()
  );
  await Promise.all(workers);
  if (failure) throw failure;
  return results;
}

function orientedDimensions(metadata) {
  if (Number.isInteger(metadata.autoOrient?.width) && Number.isInteger(metadata.autoOrient?.height)) {
    return metadata.autoOrient;
  }
  const swapDimensions = [5, 6, 7, 8].includes(metadata.orientation);
  return {
    width: swapDimensions ? metadata.height : metadata.width,
    height: swapDimensions ? metadata.width : metadata.height
  };
}

async function inspectImageMetadata(image) {
  const metadata = await sharp(image.buffer, { failOn: "error" }).metadata();
  const dimensions = orientedDimensions(metadata);
  if (!Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height)
    || dimensions.width <= 0 || dimensions.height <= 0) {
    throw new TypeError("album share cover image has invalid decoded dimensions");
  }
  return { ...image, width: dimensions.width, height: dimensions.height };
}

function hasFocus(image) {
  return Number.isFinite(image.focusX)
    && Number.isFinite(image.focusY)
    && image.focusX >= 0
    && image.focusX <= 1
    && image.focusY >= 0
    && image.focusY <= 1;
}

function focusedCrop(image, target) {
  const sourceAspect = image.width / image.height;
  const targetAspect = target.width / target.height;
  let width;
  let height;
  if (sourceAspect > targetAspect) {
    height = image.height;
    width = Math.max(1, Math.min(image.width, Math.round(height * targetAspect)));
  } else {
    width = image.width;
    height = Math.max(1, Math.min(image.height, Math.round(width / targetAspect)));
  }
  const left = clamp(Math.round(image.focusX * image.width - width / 2), 0, image.width - width);
  const top = clamp(Math.round(image.focusY * image.height - height / 2), 0, image.height - height);
  return { left, top, width, height };
}

async function renderTile(image, target) {
  if (hasFocus(image)) {
    return sharp(image.buffer, { failOn: "error" })
      .rotate()
      .extract(focusedCrop(image, target))
      .resize(target.width, target.height, { fit: "cover", position: "centre" })
      .toBuffer();
  }

  try {
    return await sharp(image.buffer, { failOn: "error" })
      .rotate()
      .resize(target.width, target.height, { fit: "cover", position: "attention" })
      .toBuffer();
  } catch (attentionError) {
    try {
      return await sharp(image.buffer, { failOn: "error" })
        .rotate()
        .resize(target.width, target.height, { fit: "cover", position: "centre" })
        .toBuffer();
    } catch (centreError) {
      throw new AggregateError(
        [attentionError, centreError],
        "album share cover attention and centre crops both failed",
        { cause: attentionError }
      );
    }
  }
}

function wrapMainText(value) {
  const codePoints = [...value];
  if (codePoints.length <= 16) return [value];
  return [codePoints.slice(0, 16).join(""), codePoints.slice(16).join("")];
}

function svgTextLine({ text, x, y, size, fill, weight = 400, letterSpacing = 0 }) {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" letter-spacing="${letterSpacing}">${escapeAlbumShareCoverXml(text)}</text>`;
}

function overlaySvg(layout, copy) {
  const { width, height } = layout.output;
  const x = 64;
  const lines = wrapMainText(copy.main);
  const gradient = layout.textMode === "gradient";
  const subtitleY = height - 62;
  const mainSize = gradient ? 52 : 30;
  const lineHeight = gradient ? 58 : 32;
  const lastMainY = subtitleY - (gradient ? 42 : 26);
  const firstMainY = lastMainY - (lines.length - 1) * lineHeight;
  const labelY = firstMainY - (gradient ? 48 : 22);
  const backdrop = gradient
    ? `<defs><linearGradient id="album-cover-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#21160F" stop-opacity="0"/><stop offset="100%" stop-color="#21160F" stop-opacity="0.9"/></linearGradient></defs><rect x="0" y="${Math.round(height * 0.55)}" width="${width}" height="${Math.round(height * 0.45)}" fill="url(#album-cover-gradient)"/>`
    : `<rect x="0" y="${Math.round(height * 0.8)}" width="${width}" height="${Math.round(height * 0.2)}" fill="#211A15" fill-opacity="0.96"/><rect x="0" y="${Math.round(height * 0.8)}" width="${width}" height="2" fill="#D8BE82" fill-opacity="0.82"/>`;
  const mainLines = lines.map((line, index) => svgTextLine({
    text: line,
    x,
    y: firstMainY + index * lineHeight,
    size: mainSize,
    fill: "#FFF9EF",
    weight: 600,
    letterSpacing: 1
  })).join("");

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>text { font-family: ${FONT_FAMILY}; }</style>${backdrop}${svgTextLine({ text: copy.label, x, y: labelY, size: gradient ? 22 : 18, fill: "#E3CA91", weight: 500, letterSpacing: 4 })}${mainLines}${svgTextLine({ text: copy.subtitle, x, y: subtitleY, size: gradient ? 28 : 22, fill: "#E9DFCF", weight: 400, letterSpacing: 1 })}</svg>`);
}

export async function renderAlbumShareCover({
  variant,
  images,
  scriptName = "",
  roleName = ""
}) {
  if (!Array.isArray(images)) validateImages(images);
  const layout = albumShareCoverLayout(variant, images.length);
  validateImages(images);

  const orientedImages = await mapSourceJobs(images, inspectImageMetadata);
  const assignments = assignAlbumShareImagesToSlots(orientedImages, layout.slots);
  const placements = assignments.map(({ slot, image }) => ({
    image,
    target: insetSlot(slot, layout.output, layout.gutter)
  }));
  const tileBuffers = await mapSourceJobs(placements, ({ image, target }) => renderTile(image, target));
  const composites = placements.map(({ target }, index) => ({
    input: tileBuffers[index],
    left: target.left,
    top: target.top
  }));
  const copy = albumShareCoverCopy({ scriptName, roleName });
  composites.push({ input: overlaySvg(layout, copy), left: 0, top: 0 });

  return sharp({
    create: {
      width: layout.output.width,
      height: layout.output.height,
      channels: 3,
      background: BACKGROUND
    }
  })
    .composite(composites)
    .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
    .toBuffer();
}
