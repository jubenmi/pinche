import assert from "node:assert/strict";
import test from "node:test";

import {
  isPublishableSessionReviewAlbumPhoto,
  serializePublicSessionReview
} from "../src/modules/core/session-review.js";

test("public review serializer returns only the share-page projection", () => {
  const result = serializePublicSessionReview({
    id: 88,
    session_id: 12,
    user_id: 7,
    rating: 5,
    content: "这一场很难忘",
    user_nickname: "小林",
    user_avatar_url: "/uploads/avatars/user-7.jpg",
    seat_role_name: "沈青",
    seat_name: "角色 A",
    script_name_snapshot: "雾夜",
    store_name_snapshot: "谜雾剧场",
    start_at: "2026-07-19T12:00:00.000Z",
    open_id: "must-not-leak",
    phone: "13800138000"
  }, ["/api/session-reviews/88/photos/31/image"]);

  assert.deepEqual(result, {
    id: 88,
    rating: 5,
    content: "这一场很难忘",
    photos: ["/api/session-reviews/88/photos/31/image"],
    author: {
      nickname: "小林",
      avatar_url: "/uploads/avatars/user-7.jpg"
    },
    role_name: "沈青",
    script_name: "雾夜",
    store_name: "谜雾剧场",
    played_on: "2026-07-19"
  });
  const serialized = JSON.stringify(result);
  for (const secret of ["session_id", "user_id", "start_at", "open_id", "13800138000"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test("public review album-photo authorization fails closed", () => {
  const valid = {
    review_id: 88,
    review_status: "active",
    album_photo_id: 31,
    album_photo_status: "active",
    moderation_status: "approved",
    media_type: "image",
    processing_status: "ready"
  };
  assert.equal(isPublishableSessionReviewAlbumPhoto(valid, 88, 31), true);
  for (const patch of [
    { review_id: 89 },
    { review_status: "deleted" },
    { album_photo_id: 32 },
    { album_photo_status: "deleted" },
    { moderation_status: "pending" },
    { media_type: "video" },
    { processing_status: "failed" }
  ]) {
    assert.equal(isPublishableSessionReviewAlbumPhoto({ ...valid, ...patch }, 88, 31), false);
  }
});

