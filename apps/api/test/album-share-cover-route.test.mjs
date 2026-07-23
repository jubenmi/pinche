import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import sharp from "sharp";

import { AppError } from "../src/http/errors.js";
import {
  AlbumShareCoverCache,
  albumShareCoverCacheKey
} from "../src/modules/album-share-cover/cache.js";
import { ALBUM_SHARE_COVER_LAYOUT_VERSION } from "../src/modules/album-share-cover/layouts.js";
import {
  attachPublicSessionAlbumMediaUrls,
  createApp
} from "../src/server.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const GOOD_IMAGE = await sharp({
  create: { width: 18, height: 16, channels: 3, background: "#806040" }
}).png().toBuffer();
const serverSource = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

function media(id, overrides = {}) {
  return {
    id,
    photo_url: `/uploads/session-album/display/${id}.jpg`,
    public_cover_priority: 0,
    created_at: `2026-07-23T00:00:${String(id).padStart(2, "0")}.000Z`,
    ...overrides
  };
}

function coverDependencies(overrides = {}) {
  const counts = {
    verify: 0,
    load: 0,
    read: 0,
    render: 0,
    cacheGet: 0,
    cacheSet: 0
  };
  const rendered = [];
  const backingCache = new AlbumShareCoverCache({
    maxEntries: 8,
    maxValueBytes: 1024,
    maxTotalBytes: 4096
  });
  const cache = {
    get(key) {
      counts.cacheGet += 1;
      return backingCache.get(key);
    },
    set(key, value) {
      counts.cacheSet += 1;
      return backingCache.set(key, value);
    },
    clear() {
      backingCache.clear();
    }
  };
  const dependencies = {
    verifyQuery(shareId, query) {
      counts.verify += 1;
      if (overrides.verifyQuery) return overrides.verifyQuery(shareId, query, counts);
      const coverMediaIdsDigest = query.get("token") === "digest-b"
        ? "b".repeat(64)
        : "a".repeat(64);
      return { shareId: Number(shareId), coverMediaIdsDigest };
    },
    async load(shareId, coverDigest) {
      counts.load += 1;
      if (overrides.load) return overrides.load(shareId, coverDigest, counts);
      return {
        share: { share_id: shareId, cover_media_ids: [1] },
        media: [media(1)],
        scriptName: "雾都夜行",
        roleName: "侦探"
      };
    },
    async readObject(item) {
      counts.read += 1;
      if (overrides.readObject) return overrides.readObject(item, counts);
      return { filename: `${item.id}.png`, body: GOOD_IMAGE, contentType: "image/png" };
    },
    async render(input) {
      counts.render += 1;
      rendered.push(input);
      if (overrides.render) return overrides.render(input, counts);
      return JPEG;
    },
    cache: overrides.cache || cache
  };
  return { dependencies, counts, rendered };
}

async function withCoverServer(dependencies, work) {
  const app = createApp({ publicShareCover: dependencies });
  try {
    await new Promise((resolve, reject) => app.listen(0, "127.0.0.1", (error) => {
      if (error) reject(error);
      else resolve();
    }));
    const address = app.address();
    await work(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }
}

async function coverRequest(baseUrl, query = "token=digest-a") {
  return fetch(`${baseUrl}/api/session-album/public-shares/17/cover?${query}`);
}

test("cache keys encode share, digest, variant, and layout version in that order", () => {
  assert.equal(albumShareCoverCacheKey({
    shareId: "share:17",
    coverDigest: "digest/one",
    variant: "friend",
    layoutVersion: "layout version"
  }), "share%3A17:digest%2Fone:friend:layout%20version");

  const base = { shareId: 17, coverDigest: "digest", variant: "friend", layoutVersion: "v1" };
  const keys = new Set([
    albumShareCoverCacheKey(base),
    albumShareCoverCacheKey({ ...base, shareId: 18 }),
    albumShareCoverCacheKey({ ...base, coverDigest: "other" }),
    albumShareCoverCacheKey({ ...base, variant: "timeline" }),
    albumShareCoverCacheKey({ ...base, layoutVersion: "v2" })
  ]);
  assert.equal(keys.size, 5);
  for (const field of ["shareId", "coverDigest", "variant", "layoutVersion"]) {
    assert.throws(
      () => albumShareCoverCacheKey({ ...base, [field]: "" }),
      (error) => error instanceof TypeError && error.message === `${field} must be nonempty`
    );
  }
});

test("cache validates stable limits and Buffer values", () => {
  for (const options of [null, [], "cache"]) {
    assert.throws(
      () => new AlbumShareCoverCache(options),
      (error) => error instanceof TypeError &&
        error.message === "album share cover cache options must be an object"
    );
  }
  for (const field of ["maxEntries", "maxValueBytes", "maxTotalBytes"]) {
    for (const value of [0, -1, 1.5, Infinity, "2"]) {
      assert.throws(
        () => new AlbumShareCoverCache({ [field]: value }),
        (error) => error instanceof RangeError &&
          error.message === `${field} must be a positive integer`
      );
    }
  }
  const cache = new AlbumShareCoverCache();
  assert.throws(
    () => cache.set("key", new Uint8Array([1])),
    (error) => error instanceof TypeError && error.message === "album share cover cache value must be a Buffer"
  );
});

test("cache stores and returns defensive Buffer copies and updates byte accounting", () => {
  const cache = new AlbumShareCoverCache({
    maxEntries: 3,
    maxValueBytes: 4,
    maxTotalBytes: 4
  });
  const source = Buffer.from([1, 2]);
  assert.equal(cache.set("a", source), true);
  source[0] = 9;
  const first = cache.get("a");
  assert.deepEqual(first, Buffer.from([1, 2]));
  first[1] = 9;
  assert.deepEqual(cache.get("a"), Buffer.from([1, 2]));

  assert.equal(cache.set("a", Buffer.from([3, 4, 5])), true);
  assert.equal(cache.set("b", Buffer.from([6])), true);
  assert.deepEqual(cache.get("a"), Buffer.from([3, 4, 5]));
  assert.deepEqual(cache.get("b"), Buffer.from([6]));
});

test("cache promotes reads and evicts the oldest entry by entry and total-byte bounds", () => {
  const byEntry = new AlbumShareCoverCache({
    maxEntries: 2,
    maxValueBytes: 4,
    maxTotalBytes: 8
  });
  byEntry.set("a", Buffer.from([1]));
  byEntry.set("b", Buffer.from([2]));
  assert.deepEqual(byEntry.get("a"), Buffer.from([1]));
  byEntry.set("c", Buffer.from([3]));
  assert.equal(byEntry.get("b"), undefined);
  assert.deepEqual(byEntry.get("a"), Buffer.from([1]));
  assert.deepEqual(byEntry.get("c"), Buffer.from([3]));

  const byBytes = new AlbumShareCoverCache({
    maxEntries: 4,
    maxValueBytes: 4,
    maxTotalBytes: 5
  });
  byBytes.set("a", Buffer.alloc(3, 1));
  byBytes.set("b", Buffer.alloc(2, 2));
  byBytes.set("c", Buffer.alloc(2, 3));
  assert.equal(byBytes.get("a"), undefined);
  assert.deepEqual(byBytes.get("b"), Buffer.alloc(2, 2));
  assert.deepEqual(byBytes.get("c"), Buffer.alloc(2, 3));
});

test("cache rejects oversize values without replacing a prior value and clear resets it", () => {
  const cache = new AlbumShareCoverCache({
    maxEntries: 2,
    maxValueBytes: 2,
    maxTotalBytes: 4
  });
  cache.set("a", Buffer.from([1]));
  assert.equal(cache.set("a", Buffer.alloc(3)), false);
  assert.deepEqual(cache.get("a"), Buffer.from([1]));
  cache.clear();
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.set("b", Buffer.from([2, 3])), true);
  assert.deepEqual(cache.get("b"), Buffer.from([2, 3]));
});

test("missing variant defaults to friend and timeline is passed separately", async () => {
  const fixture = coverDependencies();
  await withCoverServer(fixture.dependencies, async (baseUrl) => {
    assert.equal((await coverRequest(baseUrl)).status, 200);
    assert.equal((await coverRequest(baseUrl, "token=digest-a&variant=timeline")).status, 200);
  });
  assert.deepEqual(fixture.rendered.map((entry) => entry.variant), ["friend", "timeline"]);
  assert.deepEqual(
    fixture.rendered[0].images.map((image) => image.mediaId),
    fixture.rendered[1].images.map((image) => image.mediaId)
  );
});

test("invalid variant returns 400 before verification, loading, reads, rendering, or cache access", async () => {
  const fixture = coverDependencies();
  await withCoverServer(fixture.dependencies, async (baseUrl) => {
    const response = await coverRequest(baseUrl, "token=digest-a&variant=poster");
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "BAD_REQUEST");
  });
  assert.deepEqual(fixture.counts, {
    verify: 0,
    load: 0,
    read: 0,
    render: 0,
    cacheGet: 0,
    cacheSet: 0
  });
});

test("a cache hit repeats verification and authorization but skips reads, analysis, and render", async () => {
  const fixture = coverDependencies();
  await withCoverServer(fixture.dependencies, async (baseUrl) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await coverRequest(baseUrl);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/jpeg");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), JPEG);
    }
  });
  assert.deepEqual(fixture.counts, {
    verify: 2,
    load: 2,
    read: 1,
    render: 1,
    cacheGet: 2,
    cacheSet: 1
  });
});

test("a revoked second authorization returns 403 without leaking cached bytes", async () => {
  const fixture = coverDependencies({
    load(shareId, coverDigest, counts) {
      if (counts.load === 2) throw new AppError(403, "FORBIDDEN", "Album share revoked");
      return {
        share: { share_id: shareId, cover_media_ids: [1] },
        media: [media(1)],
        scriptName: "剧本",
        roleName: "角色"
      };
    }
  });
  await withCoverServer(fixture.dependencies, async (baseUrl) => {
    assert.equal((await coverRequest(baseUrl)).status, 200);
    const revoked = await coverRequest(baseUrl);
    assert.equal(revoked.status, 403);
    assert.equal((await revoked.json()).error.message, "Album share revoked");
  });
  assert.equal(fixture.counts.verify, 2);
  assert.equal(fixture.counts.load, 2);
  assert.equal(fixture.counts.cacheGet, 1);
  assert.equal(fixture.counts.render, 1);
});

test("friend and timeline use separate cache entries", async () => {
  const fixture = coverDependencies();
  await withCoverServer(fixture.dependencies, async (baseUrl) => {
    assert.equal((await coverRequest(baseUrl, "token=digest-a&variant=friend")).status, 200);
    assert.equal((await coverRequest(baseUrl, "token=digest-a&variant=timeline")).status, 200);
    assert.equal((await coverRequest(baseUrl, "token=digest-a&variant=friend")).status, 200);
    assert.equal((await coverRequest(baseUrl, "token=digest-a&variant=timeline")).status, 200);
  });
  assert.equal(fixture.counts.verify, 4);
  assert.equal(fixture.counts.load, 4);
  assert.equal(fixture.counts.read, 2);
  assert.equal(fixture.counts.render, 2);
  assert.equal(fixture.counts.cacheSet, 2);
});

test("different signed cover digests create different cache entries", async () => {
  const fixture = coverDependencies();
  await withCoverServer(fixture.dependencies, async (baseUrl) => {
    assert.equal((await coverRequest(baseUrl, "token=digest-a&variant=friend")).status, 200);
    assert.equal((await coverRequest(baseUrl, "token=digest-b&variant=friend")).status, 200);
  });
  assert.equal(fixture.counts.read, 2);
  assert.equal(fixture.counts.render, 2);
  assert.equal(fixture.counts.cacheSet, 2);
  assert.notEqual(
    albumShareCoverCacheKey({
      shareId: 17,
      coverDigest: "a".repeat(64),
      variant: "friend",
      layoutVersion: ALBUM_SHARE_COVER_LAYOUT_VERSION
    }),
    albumShareCoverCacheKey({
      shareId: 17,
      coverDigest: "a".repeat(64),
      variant: "friend",
      layoutVersion: `${ALBUM_SHARE_COVER_LAYOUT_VERSION}-next`
    })
  );
});

test("failed renders are never cached", async () => {
  const fixture = coverDependencies({
    render() {
      throw new Error("render failed");
    }
  });
  await withCoverServer(fixture.dependencies, async (baseUrl) => {
    assert.equal((await coverRequest(baseUrl)).status, 500);
    assert.equal((await coverRequest(baseUrl)).status, 500);
  });
  assert.equal(fixture.counts.render, 2);
  assert.equal(fixture.counts.cacheSet, 0);
});

test("one corrupt authorized candidate is skipped and the remaining image renders", async () => {
  const fixture = coverDependencies({
    load(shareId) {
      return {
        share: { share_id: shareId, cover_media_ids: [1, 2] },
        media: [media(1), media(2)],
        scriptName: "剧本",
        roleName: "角色"
      };
    },
    readObject(item) {
      return {
        filename: `${item.id}.png`,
        body: item.id === 1 ? Buffer.from("corrupt") : GOOD_IMAGE,
        contentType: "image/png"
      };
    }
  });
  await withCoverServer(fixture.dependencies, async (baseUrl) => {
    assert.equal((await coverRequest(baseUrl)).status, 200);
  });
  assert.equal(fixture.counts.read, 2);
  assert.equal(fixture.counts.render, 1);
  assert.deepEqual(fixture.rendered[0].images.map((image) => image.mediaId), [2]);
  assert.equal(fixture.counts.cacheSet, 1);
});

test("all corrupt authorized candidates return the explicit 422 without render or cache", async () => {
  const fixture = coverDependencies({
    load(shareId) {
      return {
        share: { share_id: shareId, cover_media_ids: [1, 2] },
        media: [media(1), media(2)],
        scriptName: "剧本",
        roleName: "角色"
      };
    },
    readObject(item) {
      return { filename: `${item.id}.jpg`, body: Buffer.from("bad"), contentType: "image/jpeg" };
    }
  });
  await withCoverServer(fixture.dependencies, async (baseUrl) => {
    const response = await coverRequest(baseUrl);
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: {
        code: "ALBUM_SHARE_COVER_UNAVAILABLE",
        message: "Album share cover cannot be generated"
      }
    });
  });
  assert.equal(fixture.counts.read, 2);
  assert.equal(fixture.counts.render, 0);
  assert.equal(fixture.counts.cacheSet, 0);
});

test("analysis passes deterministic left-greater-than-right dHash and finite quality fields", async () => {
  const pixels = [];
  for (let row = 0; row < 8; row += 1) {
    const values = row % 2 === 0
      ? [240, 220, 200, 180, 160, 140, 120, 100, 80]
      : [80, 100, 120, 140, 160, 180, 200, 220, 240];
    pixels.push(...values);
  }
  const body = await sharp(Buffer.from(pixels), {
    raw: { width: 9, height: 8, channels: 1 }
  }).png().toBuffer();
  const fixture = coverDependencies({
    load(shareId) {
      return {
        share: { share_id: shareId, cover_media_ids: [31] },
        media: [media(31, {
          public_cover_priority: 0,
          focus_x: 0.25,
          focus_y: 0.75
        })],
        scriptName: " 雾都夜行 ",
        roleName: " 侦探 "
      };
    },
    readObject(item) {
      return { filename: `${item.id}.png`, body, contentType: "image/png" };
    }
  });
  await withCoverServer(fixture.dependencies, async (baseUrl) => {
    assert.equal((await coverRequest(baseUrl)).status, 200);
  });
  assert.equal(fixture.rendered.length, 1);
  const [image] = fixture.rendered[0].images;
  assert.equal(image.mediaId, 31);
  assert.equal(image.width, 9);
  assert.equal(image.height, 8);
  assert.equal(image.dHash, 0xff00ff00ff00ff00n);
  assert.equal(image.focusX, 0.25);
  assert.equal(image.focusY, 0.75);
  assert.equal(image.relevance, 1);
  assert.equal(image.eligible, true);
  assert.deepEqual(image.buffer, body);
  for (const field of ["sharpness", "exposure", "quality"]) {
    assert.equal(Number.isFinite(image[field]), true, field);
    assert.ok(image[field] >= 0 && image[field] <= 1, field);
  }
  assert.equal(fixture.rendered[0].scriptName, " 雾都夜行 ");
  assert.equal(fixture.rendered[0].roleName, " 侦探 ");
});

test("createApp rejects malformed public cover overrides clearly", () => {
  for (const publicShareCover of [null, [], "cover"]) {
    assert.throws(
      () => createApp({ publicShareCover }),
      (error) => error instanceof TypeError && error.message === "publicShareCover must be an object"
    );
  }
  const valid = coverDependencies().dependencies;
  for (const field of ["verifyQuery", "load", "readObject", "render"]) {
    for (const invalid of [null, true]) {
      assert.throws(
        () => createApp({ publicShareCover: { ...valid, [field]: invalid } }),
        (error) => error instanceof TypeError &&
          error.message === `publicShareCover.${field} must be a function`
      );
    }
  }
  assert.throws(
    () => createApp({ publicShareCover: { ...valid, cache: {} } }),
    (error) => error instanceof TypeError &&
      error.message === "publicShareCover.cache must provide get and set functions"
  );
});

test("both public album DTO paths expose explicit friend and timeline cover URLs", () => {
  const dto = attachPublicSessionAlbumMediaUrls({
    session_id: 8,
    share_id: 17,
    cover_media_ids: [31],
    photos: []
  }, {
    sessionId: 8,
    sharerUserId: 9,
    seatId: 3,
    exp: 2_000_000_000
  }, "album-token", {
    directMediaUrls: false,
    emit: () => {}
  });
  const friend = new URL(dto.cover_url, "http://localhost");
  const timeline = new URL(dto.timeline_cover_url, "http://localhost");
  assert.equal(friend.searchParams.get("variant"), "friend");
  assert.equal(timeline.searchParams.get("variant"), "timeline");
  assert.ok(friend.searchParams.get("token"));
  assert.ok(timeline.searchParams.get("token"));
  assert.equal("cover_media_ids" in dto, false);

  const empty = attachPublicSessionAlbumMediaUrls({
    session_id: 8,
    share_id: 17,
    cover_media_ids: [],
    photos: []
  }, {
    sessionId: 8,
    sharerUserId: 9,
    seatId: 3,
    exp: 2_000_000_000
  }, "album-token", {
    directMediaUrls: false,
    emit: () => {}
  });
  assert.equal(empty.cover_url, "");
  assert.equal(empty.timeline_cover_url, "");

  const shareTokenRoute = serverSource.slice(
    serverSource.indexOf("const sessionAlbumShareTokenId"),
    serverSource.indexOf("const sessionAlbumPublicSharesId")
  );
  assert.match(
    shareTokenRoute,
    /cover_url:\s*sessionAlbumPublicShareCoverPath\(share,\s*"friend"\)/
  );
  assert.match(
    shareTokenRoute,
    /timeline_cover_url:\s*sessionAlbumPublicShareCoverPath\(share,\s*"timeline"\)/
  );
});
