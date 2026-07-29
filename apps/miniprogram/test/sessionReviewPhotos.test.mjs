import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SESSION_REVIEW_PHOTOS,
  buildSessionReviewPhotoRequest,
  createSessionReviewPhotoState,
  isSelectableSessionReviewAlbumPhoto,
  switchSessionReviewPhotoSource,
  toggleSessionReviewAlbumPhoto
} from "../src/utils/sessionReviewPhotos.js";

test("review picker accepts public images and the current uploader's author-private image", () => {
  const base = {
    id: 31,
    media_type: "image",
    status: "active",
    processing_status: "ready"
  };
  assert.equal(
    isSelectableSessionReviewAlbumPhoto({ ...base, moderation_status: "approved" }, 7),
    true
  );
  assert.equal(isSelectableSessionReviewAlbumPhoto({
    ...base,
    moderation_status: "pending",
    publication_state: "author_only",
    is_mine: true,
    can_preview: true,
    uploader_user_id: 7
  }, 7), true);
});

test("review picker rejects ordinary pending, unavailable, and ineligible author-private media", () => {
  const pending = {
    id: 31,
    media_type: "image",
    status: "active",
    processing_status: "ready",
    moderation_status: "pending"
  };
  assert.equal(isSelectableSessionReviewAlbumPhoto(pending, 7), false);
  assert.equal(isSelectableSessionReviewAlbumPhoto({
    ...pending,
    publication_state: "author_only",
    is_mine: true,
    can_preview: true,
    uploader_user_id: 8
  }, 7), false);
  assert.equal(isSelectableSessionReviewAlbumPhoto({
    ...pending,
    media_type: "video",
    publication_state: "author_only",
    is_mine: true,
    can_preview: true,
    uploader_user_id: 7
  }, 7), false);
  assert.equal(isSelectableSessionReviewAlbumPhoto({
    ...pending,
    status: "inactive",
    publication_state: "author_only",
    is_mine: true,
    can_preview: true,
    uploader_user_id: 7
  }, 7), false);
  assert.equal(isSelectableSessionReviewAlbumPhoto({
    ...pending,
    processing_status: "processing",
    publication_state: "author_only",
    is_mine: true,
    can_preview: true,
    uploader_user_id: 7
  }, 7), false);
});

test("review photos start from either album references or legacy urls", () => {
  assert.deepEqual(createSessionReviewPhotoState({
    albumPhotoIds: [7, 8],
    legacyPhotoUrls: ["/legacy.jpg"]
  }), {
    source: "album",
    selectedAlbumPhotoIds: [7, 8],
    legacyPhotoUrls: [],
    photosTouched: false
  });
  assert.deepEqual(createSessionReviewPhotoState({
    legacyPhotoUrls: ["/legacy.jpg"]
  }), {
    source: "",
    selectedAlbumPhotoIds: [],
    legacyPhotoUrls: ["/legacy.jpg"],
    photosTouched: false
  });
});

test("switching source clears the previous path and marks photos touched", () => {
  const state = createSessionReviewPhotoState({ albumPhotoIds: [7, 8] });
  assert.deepEqual(switchSessionReviewPhotoSource(state, "upload"), {
    source: "upload",
    selectedAlbumPhotoIds: [],
    legacyPhotoUrls: [],
    photosTouched: true
  });
  assert.equal(switchSessionReviewPhotoSource(state, "album"), state);
  assert.throws(() => switchSessionReviewPhotoSource(state, "video"), /source/i);
});

test("album photo selection is unique and capped at nine", () => {
  let state = createSessionReviewPhotoState();
  state = switchSessionReviewPhotoSource(state, "album");
  for (let id = 1; id <= MAX_SESSION_REVIEW_PHOTOS; id += 1) {
    state = toggleSessionReviewAlbumPhoto(state, id);
  }
  assert.deepEqual(state.selectedAlbumPhotoIds, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.throws(() => toggleSessionReviewAlbumPhoto(state, 10), /9|nine/i);
  assert.deepEqual(toggleSessionReviewAlbumPhoto(state, 3).selectedAlbumPhotoIds, [1, 2, 4, 5, 6, 7, 8, 9]);
});

test("untouched legacy photos are omitted while an explicit change sends albumPhotoIds", () => {
  const legacy = createSessionReviewPhotoState({ legacyPhotoUrls: ["/legacy.jpg"] });
  assert.deepEqual(buildSessionReviewPhotoRequest(legacy), {});
  const cleared = switchSessionReviewPhotoSource(legacy, "upload");
  assert.deepEqual(buildSessionReviewPhotoRequest(cleared), { albumPhotoIds: [] });
  const selected = toggleSessionReviewAlbumPhoto(cleared, 42);
  assert.deepEqual(buildSessionReviewPhotoRequest(selected), { albumPhotoIds: [42] });
});
