import assert from "node:assert/strict";
import test from "node:test";

import {
  ALBUM_SHARE_COVER_LAYOUT_VERSION,
  ALBUM_SHARE_COVER_VARIANTS,
  albumShareCoverLayout
} from "../src/modules/album-share-cover/layouts.js";

const expectedOutputs = {
  friend: { width: 1000, height: 800 },
  timeline: { width: 1000, height: 1000 }
};
const slot = (x, y, width, height) => ({ x, y, width, height });
const row3 = (y, height) => [
  slot(0, y, 1 / 3, height),
  slot(1 / 3, y, 1 / 3, height),
  slot(2 / 3, y, 1 / 3, height)
];
const expectedSlots = {
  friend: {
    1: [slot(0, 0, 1, 1)],
    2: [slot(0, 0, 0.62, 1), slot(0.62, 0, 0.38, 1)],
    3: [slot(0, 0, 0.62, 1), slot(0.62, 0, 0.38, 0.5), slot(0.62, 0.5, 0.38, 0.5)],
    4: [slot(0, 0, 1, 0.58), ...row3(0.58, 0.42)],
    5: [slot(0, 0, 0.54, 1), slot(0.54, 0, 0.23, 0.5), slot(0.77, 0, 0.23, 0.5), slot(0.54, 0.5, 0.23, 0.5), slot(0.77, 0.5, 0.23, 0.5)],
    6: [slot(0, 0, 0.54, 1), slot(0.54, 0, 0.46, 0.34), slot(0.54, 0.34, 0.23, 0.33), slot(0.77, 0.34, 0.23, 0.33), slot(0.54, 0.67, 0.23, 0.33), slot(0.77, 0.67, 0.23, 0.33)],
    7: [slot(0, 0, 1, 0.46), ...row3(0.46, 0.27), ...row3(0.73, 0.27)],
    8: [slot(0, 0, 2 / 3, 1 / 3), slot(2 / 3, 0, 1 / 3, 1 / 3), ...row3(1 / 3, 1 / 3), ...row3(2 / 3, 1 / 3)],
    9: [...row3(0, 1 / 3), ...row3(1 / 3, 1 / 3), ...row3(2 / 3, 1 / 3)]
  },
  timeline: {
    1: [slot(0, 0, 1, 1)],
    2: [slot(0, 0, 0.58, 1), slot(0.58, 0, 0.42, 1)],
    3: [slot(0, 0, 1, 0.58), slot(0, 0.58, 0.5, 0.42), slot(0.5, 0.58, 0.5, 0.42)],
    4: [slot(0, 0, 0.5, 0.5), slot(0.5, 0, 0.5, 0.5), slot(0, 0.5, 0.5, 0.5), slot(0.5, 0.5, 0.5, 0.5)],
    5: [slot(0, 0, 1, 0.48), slot(0, 0.48, 0.5, 0.26), slot(0.5, 0.48, 0.5, 0.26), slot(0, 0.74, 0.5, 0.26), slot(0.5, 0.74, 0.5, 0.26)],
    6: [...row3(0, 0.5), ...row3(0.5, 0.5)],
    7: [slot(0, 0, 1, 0.46), ...row3(0.46, 0.27), ...row3(0.73, 0.27)],
    8: [slot(0, 0, 2 / 3, 1 / 3), slot(2 / 3, 0, 1 / 3, 1 / 3), ...row3(1 / 3, 1 / 3), ...row3(2 / 3, 1 / 3)],
    9: [...row3(0, 1 / 3), ...row3(1 / 3, 1 / 3), ...row3(2 / 3, 1 / 3)]
  }
};

function assertSlotsAreInBoundsAndDoNotOverlap(slots) {
  for (const slot of slots) {
    assert.ok(slot.x >= 0 && slot.y >= 0, "slot origin remains normalized");
    assert.ok(slot.width > 0 && slot.height > 0, "slot has positive dimensions");
    assert.ok(slot.x + slot.width <= 1, "slot width remains in bounds");
    assert.ok(slot.y + slot.height <= 1, "slot height remains in bounds");
  }

  for (let left = 0; left < slots.length; left += 1) {
    for (let right = left + 1; right < slots.length; right += 1) {
      const first = slots[left];
      const second = slots[right];
      const overlaps = first.x < second.x + second.width
        && second.x < first.x + first.width
        && first.y < second.y + second.height
        && second.y < first.y + first.height;
      assert.equal(overlaps, false, `slots ${left} and ${right} do not overlap`);
    }
  }
}

test("album share cover layouts provide bounded hero-first slots for both channels", () => {
  assert.match(ALBUM_SHARE_COVER_LAYOUT_VERSION, /^album-share-cover-v\d+$/);

  for (const [variant, expectedOutput] of Object.entries(expectedOutputs)) {
    assert.deepEqual(ALBUM_SHARE_COVER_VARIANTS[variant], expectedOutput);

    for (let count = 1; count <= 9; count += 1) {
      const layout = albumShareCoverLayout(variant, count);
      assert.equal(layout.variant, variant);
      assert.deepEqual(layout.output, expectedOutput);
      assert.equal(layout.gutter, variant === "friend" ? 0.008 : 0.01);
      assert.equal(layout.textMode, count <= 6 ? "gradient" : "caption-band");
      assert.equal(layout.slots.length, count);
      assert.deepEqual(
        layout.slots,
        expectedSlots[variant][count].map((expectedSlot, index) => ({
          ...expectedSlot,
          role: index === 0 ? "hero" : "detail"
        }))
      );
      assert.equal(layout.slots.filter((entry) => entry.role === "hero").length, 1);
      assert.equal(layout.slots.slice(1).every((entry) => entry.role === "detail"), true);
      assertSlotsAreInBoundsAndDoNotOverlap(layout.slots);
    }
  }
});

test("album share cover layout calls return isolated slot objects", () => {
  const first = albumShareCoverLayout("friend", 2);
  first.slots[0].width = 0;

  assert.equal(albumShareCoverLayout("friend", 2).slots[0].width, 0.62);
});

test("album share cover layouts reject unsupported variants and image counts", () => {
  assert.throws(
    () => albumShareCoverLayout(Symbol("friend"), 1),
    (error) => error instanceof TypeError && /variant/.test(error.message)
  );
  assert.throws(
    () => albumShareCoverLayout("public", 1),
    (error) => error instanceof TypeError && /variant/.test(error.message)
  );
  for (const count of [0, 1.5, 10]) {
    assert.throws(
      () => albumShareCoverLayout("friend", count),
      (error) => error instanceof RangeError && /count/.test(error.message)
    );
  }
});
