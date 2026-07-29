import assert from "node:assert/strict";
import test from "node:test";

import {
  isAssociableSessionReviewAlbumPhoto,
  isAuthorPrivateSessionReviewAlbumPhoto,
  isPublishableSessionReviewAlbumPhoto,
  normalizeSessionReviewAlbumPhotoIds,
  projectSessionReviewPhotoRows
} from "../src/modules/core/session-review.js";

const privatePhoto = {
  id: 31,
  session_id: 9,
  uploader_user_id: 7,
  author_visibility_version: 1,
  moderation_status: "pending",
  status: "active",
  media_type: "image",
  processing_status: "ready"
};

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

test("only the owner may associate a version-one author-private album photo", () => {
  assert.equal(isAuthorPrivateSessionReviewAlbumPhoto(privatePhoto, 7), true);
  assert.equal(isAssociableSessionReviewAlbumPhoto(privatePhoto, 7, false), true);
  assert.equal(isAssociableSessionReviewAlbumPhoto(privatePhoto, 8, true), false);
  assert.equal(
    isAssociableSessionReviewAlbumPhoto({ ...privatePhoto, author_visibility_version: 0 }, 7, true),
    false
  );
});

test("owner projection keeps private ids while public projection keeps no private url or id", () => {
  const rows = [{
    review_id: 61,
    album_photo_id: 31,
    album_photo_status: "active",
    album_photo_moderation_status: "pending",
    album_photo_media_type: "image",
    album_photo_processing_status: "ready",
    album_photo_uploader_user_id: 7,
    album_photo_author_visibility_version: 1
  }];
  assert.deepEqual(projectSessionReviewPhotoRows(rows), new Map([
    [61, { photos: [], albumPhotoIds: [] }]
  ]));
  assert.deepEqual(projectSessionReviewPhotoRows(rows, { ownerUserId: 7 }), new Map([
    [61, { photos: [], albumPhotoIds: [31] }]
  ]));
});

test("approved and legacy approved rows retain their public projections", () => {
  const rows = [{
    review_id: 61,
    album_photo_id: 32,
    album_photo_status: "active",
    album_photo_moderation_status: "approved",
    album_photo_media_type: "image",
    album_photo_processing_status: "ready"
  }, {
    review_id: 62,
    album_photo_id: null,
    photo_url: "/legacy/review-photo.jpg",
    image_asset_status: "active",
    image_asset_moderation_status: "approved"
  }];
  assert.deepEqual(projectSessionReviewPhotoRows(rows), new Map([
    [61, {
      photos: ["/api/session-reviews/61/photos/32/image"],
      albumPhotoIds: [32]
    }],
    [62, { photos: ["/legacy/review-photo.jpg"], albumPhotoIds: [] }]
  ]));
});

test("public review image byte gate still rejects author-private associations", () => {
  assert.equal(isPublishableSessionReviewAlbumPhoto({
    review_id: 61,
    review_status: "active",
    album_photo_id: 31,
    album_photo_status: "active",
    moderation_status: "pending",
    media_type: "image",
    processing_status: "ready"
  }, 61, 31), false);
});
