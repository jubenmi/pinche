export const ALBUM_SHARE_DUPLICATE_DISTANCE = 6;
export const ALBUM_SHARE_QUALITY_FLOOR_RATIO = 0.65;
export const ALBUM_SHARE_MAX_IMAGES = 9;

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(1, Math.max(0, numeric));
}

function candidateMediaId(candidate) {
  return candidate?.mediaId ?? candidate?.media_id ?? candidate?.id;
}

function createdAtTime(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function compareMediaIds(left, right) {
  // Numeric IDs sort numerically, then bigint IDs, then string IDs lexicographically;
  // unsupported/missing values sort last by their string representation.
  const typeRank = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return 0;
    if (typeof value === "bigint") return 1;
    if (typeof value === "string") return 2;
    return 3;
  };
  const leftRank = typeRank(left);
  const rightRank = typeRank(right);
  if (leftRank !== rightRank) return leftRank - rightRank;

  if (leftRank === 0) return left - right;
  if (leftRank === 1) return left < right ? -1 : left > right ? 1 : 0;
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

function compareCandidates(left, right) {
  if (left.quality !== right.quality) return right.quality - left.quality;

  const leftTime = createdAtTime(left.createdAt);
  const rightTime = createdAtTime(right.createdAt);
  // Valid timestamps come first; missing and invalid values are equivalent and sort last.
  if (leftTime !== null || rightTime !== null) {
    if (leftTime === null) return 1;
    if (rightTime === null) return -1;
    if (leftTime !== rightTime) return leftTime - rightTime;
  }

  return compareMediaIds(candidateMediaId(left), candidateMediaId(right));
}

function normalizeImage(image) {
  const suppliedQuality = image?.quality;
  const quality = Number.isFinite(suppliedQuality)
    ? clamp01(suppliedQuality)
    : albumShareImageQuality(image ?? {});
  return { ...image, quality };
}

function hasDHash(image) {
  return typeof image?.dHash === "bigint";
}

function validatePositiveFiniteDimensions(value, noun) {
  if (!value || !Number.isFinite(value.width) || !Number.isFinite(value.height)
    || value.width <= 0 || value.height <= 0) {
    throw new RangeError(`Expected positive finite ${noun} dimensions`);
  }
}

function resolutionScore(image) {
  const width = Number(image?.width);
  const height = Number(image?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 0;
  }
  return width >= 2_000_000 / height ? 1 : clamp01(width * height / 2_000_000);
}

function logAspectRatio(width, height) {
  const ratio = width / height;
  return Number.isFinite(ratio) && ratio > 0
    ? Math.log(ratio)
    : Math.log(width) - Math.log(height);
}

export function albumShareImageQuality(image) {
  const sharpness = clamp01(image?.sharpness);
  const exposure = clamp01(image?.exposure);
  const resolution = resolutionScore(image);
  const relevance = clamp01(image?.relevance);
  return sharpness * 0.4 + exposure * 0.2 + resolution * 0.2 + relevance * 0.2;
}

export function exposureScore(meanLuminance) {
  const normalized = clamp01(Number(meanLuminance) / 255);
  return clamp01(1 - Math.abs(normalized - 0.5) * 2);
}

export function hammingDistance64(left, right) {
  let bits = BigInt.asUintN(64, BigInt(left)) ^ BigInt.asUintN(64, BigInt(right));
  let distance = 0;
  while (bits !== 0n) {
    bits &= bits - 1n;
    distance += 1;
  }
  return distance;
}

export function selectAlbumShareImages(candidates) {
  if (!Array.isArray(candidates)) throw new TypeError("Expected candidates to be an array");

  const sorted = candidates
    .filter((candidate) => candidate?.eligible === true)
    .map((candidate, index) => ({ image: normalizeImage(candidate), index }))
    .sort((left, right) => compareCandidates(left.image, right.image) || left.index - right.index)
    .map(({ image }) => image);

  const deduped = [];
  for (const candidate of sorted) {
    const duplicate = deduped.some((kept) => hasDHash(candidate)
      && hasDHash(kept)
      && hammingDistance64(candidate.dHash, kept.dHash) <= ALBUM_SHARE_DUPLICATE_DISTANCE);
    if (!duplicate) deduped.push(candidate);
  }

  if (deduped.length === 0) return [];
  const minimumQuality = deduped[0].quality * ALBUM_SHARE_QUALITY_FLOOR_RATIO;
  return deduped
    .filter((candidate) => candidate.quality >= minimumQuality)
    .slice(0, ALBUM_SHARE_MAX_IMAGES);
}

export function cropLoss(image, slot) {
  validatePositiveFiniteDimensions(image, "image");
  validatePositiveFiniteDimensions(slot, "slot");
  const weight = slot.role === "hero" ? 2 : 1;
  const imageLogAspectRatio = logAspectRatio(image.width, image.height);
  const slotLogAspectRatio = logAspectRatio(slot.width, slot.height);
  const loss = Math.abs(imageLogAspectRatio - slotLogAspectRatio) * weight;
  if (!Number.isFinite(loss)) throw new RangeError("Expected finite crop loss");
  return loss;
}

function forEachPermutation(values, visit) {
  const used = Array(values.length).fill(false);
  const current = [];
  const walk = () => {
    if (current.length === values.length) {
      visit([...current]);
      return;
    }
    for (let index = 0; index < values.length; index += 1) {
      if (used[index]) continue;
      used[index] = true;
      current.push(values[index]);
      walk();
      current.pop();
      used[index] = false;
    }
  };
  walk();
}

function compareAssignmentIds(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    const leftId = String(candidateMediaId(left[index]));
    const rightId = String(candidateMediaId(right[index]));
    const comparison = leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function cropLossTolerance(left, right) {
  // At most eight loss terms are summed, so allow a bounded 32-ULP-scale margin.
  return Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 32;
}

function cropLossesAreEqual(left, right) {
  return Math.abs(left - right) <= cropLossTolerance(left, right);
}

export function assignAlbumShareImagesToSlots(images, slots) {
  if (!Array.isArray(images) || !Array.isArray(slots)) {
    throw new TypeError("Expected images and slots to be arrays");
  }
  if (images.length === 0 || images.length !== slots.length) {
    throw new RangeError("Expected equal non-empty image and slot counts");
  }
  if (images.length > ALBUM_SHARE_MAX_IMAGES) {
    throw new RangeError("Expected at most 9 images and slots");
  }

  const heroIndex = slots.findIndex((slot) => slot?.role === "hero");
  if (heroIndex < 0 || slots.filter((slot) => slot?.role === "hero").length !== 1) {
    throw new RangeError("Expected exactly one hero slot");
  }
  for (const image of images) validatePositiveFiniteDimensions(image, "image");
  for (const slot of slots) validatePositiveFiniteDimensions(slot, "slot");

  const ranked = images
    .map((image, index) => ({ image: normalizeImage(image), index }))
    .sort((left, right) => compareCandidates(left.image, right.image) || left.index - right.index)
    .map(({ image }) => image);
  const hero = ranked[0];
  const remainingImages = ranked.slice(1);
  const remainingSlots = slots.filter((_, index) => index !== heroIndex);

  let minimumLoss = Infinity;
  forEachPermutation(remainingImages, (permutation) => {
    const loss = permutation.reduce(
      (total, image, index) => total + cropLoss(image, remainingSlots[index]),
      0
    );
    if (loss < minimumLoss) minimumLoss = loss;
  });

  let bestImages = null;
  forEachPermutation(remainingImages, (permutation) => {
    const loss = permutation.reduce(
      (total, image, index) => total + cropLoss(image, remainingSlots[index]),
      0
    );
    if (cropLossesAreEqual(loss, minimumLoss)
      && (!bestImages || compareAssignmentIds(permutation, bestImages) < 0)) {
      bestImages = permutation;
    }
  });

  let remainingIndex = 0;
  return slots.map((slot, index) => {
    const image = index === heroIndex ? hero : bestImages[remainingIndex++];
    return { slot: { ...slot }, image: { ...image }, cropLoss: cropLoss(image, slot) };
  });
}
