import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSessionReviewAlbumPhotoIds } from "../src/modules/core/session-review.js";

test("omitted albumPhotoIds preserves the current review photos", () => {
  assert.equal(normalizeSessionReviewAlbumPhotoIds(undefined), undefined);
});

test("an explicit empty albumPhotoIds list clears review photos", () => {
  assert.deepEqual(normalizeSessionReviewAlbumPhotoIds([]), []);
});

test("albumPhotoIds preserves order and rejects duplicates", () => {
  assert.deepEqual(normalizeSessionReviewAlbumPhotoIds([8, "5", 3]), [8, 5, 3]);
  assert.throws(
    () => normalizeSessionReviewAlbumPhotoIds([8, 5, 8]),
    /unique/i
  );
});

test("albumPhotoIds accepts only positive integer ids", () => {
  for (const invalid of [null, "1", {}, [0], [-1], [1.5], ["abc"]]) {
    assert.throws(() => normalizeSessionReviewAlbumPhotoIds(invalid), /albumPhotoIds|positive integer/i);
  }
});

test("albumPhotoIds is limited to nine photos", () => {
  assert.equal(normalizeSessionReviewAlbumPhotoIds([1, 2, 3, 4, 5, 6, 7, 8, 9]).length, 9);
  assert.throws(
    () => normalizeSessionReviewAlbumPhotoIds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    /9|nine/i
  );
});
