import assert from "node:assert/strict";
import test from "node:test";

import {
  ALBUM_SHARE_DUPLICATE_DISTANCE,
  ALBUM_SHARE_MAX_IMAGES,
  ALBUM_SHARE_QUALITY_FLOOR_RATIO,
  albumShareImageQuality,
  assignAlbumShareImagesToSlots,
  cropLoss,
  exposureScore,
  hammingDistance64,
  selectAlbumShareImages
} from "../src/modules/album-share-cover/selection.js";

function candidate(mediaId, overrides = {}) {
  return {
    mediaId,
    eligible: true,
    width: 1000,
    height: 1000,
    sharpness: 1,
    exposure: 1,
    relevance: 1,
    createdAt: "2026-07-20T00:00:00.000Z",
    ...overrides
  };
}

test("albumShareImageQuality uses the 40/20/20/20 normalized formula", () => {
  assert.equal(ALBUM_SHARE_QUALITY_FLOOR_RATIO, 0.65);
  assert.equal(ALBUM_SHARE_MAX_IMAGES, 9);
  assert.ok(Math.abs(
    albumShareImageQuality({ width: 1000, height: 800, sharpness: 1, exposure: 0.5, relevance: 0.25 }) - 0.63
  ) < Number.EPSILON);
});

test("exposureScore is highest at middle luminance and clamps its range", () => {
  assert.equal(exposureScore(0), 0);
  assert.equal(exposureScore(127.5), 1);
  assert.equal(exposureScore(255), 0);
  assert.equal(exposureScore(-10), 0);
  assert.equal(exposureScore(300), 0);
});

test("hammingDistance64 counts 64-bit differences including signed and large values", () => {
  assert.equal(ALBUM_SHARE_DUPLICATE_DISTANCE, 6);
  assert.equal(hammingDistance64(0n, 0b111111n), 6);
  assert.equal(hammingDistance64(0n, 0b1111111n), 7);
  assert.equal(hammingDistance64(-1n, (1n << 64n) - 1n), 0);
  assert.equal(hammingDistance64(1n << 70n, 0n), 0);
});

test("selection filters ineligible media and retains only the stronger near duplicate", () => {
  const selected = selectAlbumShareImages([
    candidate("blocked", { eligible: false, quality: 1 }),
    candidate("better", { quality: 0.9, dHash: 0n }),
    candidate("near", { quality: 0.8, dHash: 0b111111n }),
    candidate("distinct", { quality: 0.75, dHash: 0b1111111n })
  ]);

  assert.deepEqual(selected.map((image) => image.mediaId), ["better", "distinct"]);
});

test("selection treats missing dHash as insufficient evidence for deduplication", () => {
  const selected = selectAlbumShareImages([
    candidate("hashed", { quality: 1, dHash: 0n }),
    candidate("missing", { quality: 0.9 }),
    candidate("also-missing", { quality: 0.8 })
  ]);

  assert.deepEqual(selected.map((image) => image.mediaId), ["hashed", "missing", "also-missing"]);
});

for (const [label, dHash] of [
  ["empty string", ""],
  ["boolean", false],
  ["fractional number", 1.5],
  ["malformed string", "not-a-hash"]
]) {
  test(`selection treats a ${label} dHash as unavailable duplicate evidence`, () => {
    const selected = selectAlbumShareImages([
      candidate("hashed", { quality: 1, dHash: 0n }),
      candidate(label, { quality: 0.9, dHash })
    ]);

    assert.deepEqual(selected.map((image) => image.mediaId), ["hashed", label]);
  });
}

test("selection applies the quality floor, keeps one, caps at nine, and never replenishes", () => {
  const highAndLow = selectAlbumShareImages([
    candidate("best", { quality: 1, dHash: 0n }),
    candidate("duplicate", { quality: 0.99, dHash: 1n }),
    candidate("low", { quality: 0.64, dHash: 0b1111111n })
  ]);
  assert.deepEqual(highAndLow.map((image) => image.mediaId), ["best"]);

  const onlyBelowFloor = selectAlbumShareImages([
    candidate("single", { quality: 0, dHash: 0n })
  ]);
  assert.deepEqual(onlyBelowFloor.map((image) => image.mediaId), ["single"]);

  const capped = selectAlbumShareImages(Array.from({ length: 10 }, (_, index) => candidate(index + 1, {
    quality: 1 - index / 100
  })));
  assert.equal(capped.length, 9);
  assert.deepEqual(capped.map((image) => image.mediaId), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("selection never backfills past its sorted top-nine candidate window", () => {
  const selected = selectAlbumShareImages([
    candidate("best", { quality: 1, dHash: 0n }),
    ...Array.from({ length: 8 }, (_, index) => candidate(`duplicate-${index}`, {
      quality: 0.99 - index / 1000,
      dHash: 1n
    })),
    candidate("later-distinct", { quality: 0.9, dHash: 0b1111111n })
  ]);

  assert.deepEqual(selected.map((image) => image.mediaId), ["best"]);
});

test("selection has a total deterministic tie order and leaves caller candidates unchanged", () => {
  const candidates = [
    candidate("10", { quality: 0.8, createdAt: "invalid" }),
    candidate(2, { quality: 0.8, createdAt: "invalid" }),
    candidate("later", { quality: 0.8, createdAt: "2026-07-21T00:00:00.000Z" }),
    candidate("earlier", { quality: 0.8, createdAt: "2026-07-19T00:00:00.000Z" }),
    candidate("missing", { quality: 0.8, createdAt: null }),
    candidate("computed", {
      quality: Number.NaN,
      createdAt: null,
      sharpness: 0.75,
      exposure: 1,
      relevance: 1
    })
  ];
  const original = structuredClone(candidates);

  const first = selectAlbumShareImages(candidates);
  const second = selectAlbumShareImages(candidates);

  assert.deepEqual(first.map((image) => image.mediaId), ["earlier", "later", 2, "10", "computed", "missing"]);
  assert.deepEqual(second, first);
  assert.deepEqual(candidates, original);
  assert.equal(first.at(-2).quality, 0.8);
  assert.notEqual(first[0], candidates[3]);
});

test("selection treats finite numeric createdAt values as epoch milliseconds", () => {
  const selected = selectAlbumShareImages([
    candidate("later", { quality: 0.8, createdAt: 1000 }),
    candidate("zero", { quality: 0.8, createdAt: 0 })
  ]);

  assert.deepEqual(selected.map((image) => image.mediaId), ["zero", "later"]);
});

test("cropLoss calculates weighted logarithmic aspect-ratio loss", () => {
  assert.ok(Math.abs(cropLoss({ width: 200, height: 100 }, { width: 100, height: 100, role: "detail" }) - Math.log(2)) < Number.EPSILON * 8);
  assert.ok(Math.abs(cropLoss({ width: 200, height: 100 }, { width: 100, height: 100, role: "hero" }) - Math.log(2) * 2) < Number.EPSILON * 8);
});

test("assignment always places the strongest image in the hero and globally minimizes remaining crop loss", () => {
  const images = [
    candidate("portrait", { quality: 0.8, width: 100, height: 200 }),
    candidate("hero", { quality: 1, width: 100, height: 200 }),
    candidate("landscape", { quality: 0.7, width: 200, height: 100 })
  ];
  const slots = [
    { width: 100, height: 100, role: "detail" },
    { width: 100, height: 100, role: "hero" },
    { width: 200, height: 100, role: "detail" }
  ];

  const assignments = assignAlbumShareImagesToSlots(images, slots);

  assert.deepEqual(assignments.map(({ image }) => image.mediaId), ["portrait", "hero", "landscape"]);
  assert.ok(Math.abs(assignments[1].cropLoss - Math.log(2) * 2) < Number.EPSILON * 8);
});

test("assignment uses lexicographic media IDs to break equal crop-loss totals", () => {
  const assignments = assignAlbumShareImagesToSlots(
    [candidate("z", { quality: 1 }), candidate("b", { quality: 0.8 }), candidate("a", { quality: 0.7 })],
    [
      { width: 100, height: 100, role: "hero" },
      { width: 100, height: 100, role: "detail" },
      { width: 100, height: 100, role: "detail" }
    ]
  );

  assert.deepEqual(assignments.map(({ image }) => image.mediaId), ["z", "a", "b"]);
});

test("assignment tie breaking compares numeric media IDs as lexicographic strings", () => {
  const assignments = assignAlbumShareImagesToSlots(
    [candidate("hero", { quality: 1 }), candidate(2, { quality: 0.8 }), candidate(10, { quality: 0.7 })],
    [
      { width: 100, height: 100, role: "hero" },
      { width: 100, height: 100, role: "detail" },
      { width: 100, height: 100, role: "detail" }
    ]
  );

  assert.deepEqual(assignments.map(({ image }) => image.mediaId), ["hero", 10, 2]);
});

test("assignment treats non-zero equal crop-loss totals as a lexicographic tie", () => {
  const assignments = assignAlbumShareImagesToSlots(
    [
      candidate("hero", { quality: 1, width: 1, height: 1 }),
      candidate("z", { quality: 0.9, width: 1, height: 1 }),
      candidate("a", { quality: 0.8, width: 1, height: 2 })
    ],
    [
      { width: 1, height: 1, role: "hero" },
      { width: 1, height: 3, role: "detail" },
      { width: 1, height: 10, role: "detail" }
    ]
  );

  assert.deepEqual(assignments.map(({ image }) => image.mediaId), ["hero", "a", "z"]);
});

test("crop and assignment stay finite for extreme positive dimensions", () => {
  const image = candidate("extreme", { width: Number.MAX_VALUE, height: Number.MIN_VALUE });
  const detailSlot = { width: Number.MIN_VALUE, height: Number.MAX_VALUE, role: "detail" };

  assert.ok(Number.isFinite(cropLoss(image, detailSlot)));
  const assignments = assignAlbumShareImagesToSlots(
    [candidate("hero", { quality: 1 }), image],
    [{ width: 1, height: 1, role: "hero" }, detailSlot]
  );
  assert.ok(Number.isFinite(assignments[1].cropLoss));
});

test("selection and assignment return isolated top-level images and slots", () => {
  const selectionInput = candidate("selected", { quality: 1 });
  const selected = selectAlbumShareImages([selectionInput]);
  selected[0].quality = 0;
  selected[0].width = 1;

  assert.equal(selectionInput.quality, 1);
  assert.equal(selectionInput.width, 1000);

  const assignmentImage = candidate("assigned", { quality: 1 });
  const assignmentSlot = { width: 100, height: 100, role: "hero" };
  const assigned = assignAlbumShareImagesToSlots([assignmentImage], [assignmentSlot]);
  assigned[0].image.width = 1;
  assigned[0].slot.width = 1;

  assert.equal(assignmentImage.width, 1000);
  assert.equal(assignmentSlot.width, 100);
});

test("crop and assignment reject invalid dimensions and slot configurations clearly", () => {
  assert.throws(
    () => cropLoss({ width: 0, height: 100 }, { width: 100, height: 100, role: "hero" }),
    (error) => error instanceof RangeError && /positive finite image dimensions/.test(error.message)
  );
  assert.throws(
    () => cropLoss({ width: 100, height: 100 }, { width: Number.NaN, height: 100, role: "hero" }),
    (error) => error instanceof RangeError && /positive finite slot dimensions/.test(error.message)
  );
  assert.throws(
    () => assignAlbumShareImagesToSlots([], []),
    (error) => error instanceof RangeError && /equal non-empty/.test(error.message)
  );
  assert.throws(
    () => assignAlbumShareImagesToSlots([candidate(1)], [{ width: 1, height: 1, role: "detail" }]),
    (error) => error instanceof RangeError && /exactly one hero/.test(error.message)
  );
  assert.throws(
    () => assignAlbumShareImagesToSlots(Array.from({ length: 10 }, (_, index) => candidate(index)), Array.from({ length: 10 }, () => ({ width: 1, height: 1, role: "detail" }))),
    (error) => error instanceof RangeError && /at most 9/.test(error.message)
  );
});
