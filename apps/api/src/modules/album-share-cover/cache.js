const DEFAULT_MAX_ENTRIES = 32;
const DEFAULT_MAX_VALUE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function cacheKeyComponent(value, name) {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new TypeError(`${name} must be nonempty`);
  }
  return encodeURIComponent(String(value));
}

function cacheEntryKey(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("album share cover cache key must be a nonempty string");
  }
  return value;
}

export function albumShareCoverCacheKey({
  shareId,
  coverDigest,
  variant,
  layoutVersion
} = {}) {
  return [
    cacheKeyComponent(shareId, "shareId"),
    cacheKeyComponent(coverDigest, "coverDigest"),
    cacheKeyComponent(variant, "variant"),
    cacheKeyComponent(layoutVersion, "layoutVersion")
  ].join(":");
}

export class AlbumShareCoverCache {
  constructor(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("album share cover cache options must be an object");
    }
    this.maxEntries = positiveInteger(
      options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      "maxEntries"
    );
    this.maxValueBytes = positiveInteger(
      options.maxValueBytes ?? DEFAULT_MAX_VALUE_BYTES,
      "maxValueBytes"
    );
    this.maxTotalBytes = positiveInteger(
      options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
      "maxTotalBytes"
    );
    this.entries = new Map();
    this.totalBytes = 0;
  }

  get(key) {
    const normalizedKey = cacheEntryKey(key);
    const value = this.entries.get(normalizedKey);
    if (!value) return undefined;
    this.entries.delete(normalizedKey);
    this.entries.set(normalizedKey, value);
    return Buffer.from(value);
  }

  set(key, value) {
    const normalizedKey = cacheEntryKey(key);
    if (!Buffer.isBuffer(value)) {
      throw new TypeError("album share cover cache value must be a Buffer");
    }
    if (value.length > this.maxValueBytes || value.length > this.maxTotalBytes) {
      return false;
    }

    const stored = Buffer.from(value);
    const previous = this.entries.get(normalizedKey);
    if (previous) {
      this.entries.delete(normalizedKey);
      this.totalBytes -= previous.length;
    }
    this.entries.set(normalizedKey, stored);
    this.totalBytes += stored.length;
    this.#evict();
    return this.entries.has(normalizedKey);
  }

  clear() {
    this.entries.clear();
    this.totalBytes = 0;
  }

  #evict() {
    while (
      this.entries.size > this.maxEntries ||
      this.totalBytes > this.maxTotalBytes
    ) {
      const oldestKey = this.entries.keys().next().value;
      const oldestValue = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this.totalBytes -= oldestValue.length;
    }
  }
}
