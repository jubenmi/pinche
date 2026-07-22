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
      assert.equal(layout.slots.length, count);
      assert.equal(layout.slots[0].role, "hero");
      assert.equal(layout.slots.slice(1).every((slot) => slot.role === "detail"), true);
      assertSlotsAreInBoundsAndDoNotOverlap(layout.slots);
    }
  }
});

test("album share cover layouts reject unsupported variants and image counts", () => {
  assert.throws(() => albumShareCoverLayout("public", 1), /variant/);
  assert.throws(() => albumShareCoverLayout("friend", 0), /count/);
  assert.throws(() => albumShareCoverLayout("timeline", 10), /count/);
});
