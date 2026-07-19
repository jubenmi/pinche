import assert from "node:assert/strict";
import {
  isAlbumPhotoVisibleInPublicShare,
  isPublicShareSnapshotMediaId,
  normalizePublicShareSnapshotIds,
  publicShareCoverGridLayout,
  publicShareSnapshotDigest,
  selectPublicShareCoverMedia,
  selectPublicShareMedia
} from "../apps/api/src/modules/core/service.js";

const claims = { sessionId: 10, sharerUserId: 100, seatId: 1000 };
const openPrivacy = (ids) => new Map(
  ids.map((id) => [id, { allow_uploaded_visible: true, allow_tagged_visible: true }])
);
const media = (overrides = {}) => ({
  id: 1,
  session_id: 10,
  uploader_user_id: 200,
  status: "active",
  moderation_status: "approved",
  media_type: "image",
  processing_status: "ready",
  ...overrides
});
const seatTag = (seatId, userId, overrides = {}) => ({
  tag_type: "seat",
  seat_id: seatId,
  user_id: userId,
  seat_user_id: userId,
  ...overrides
});

assert.equal(
  isAlbumPhotoVisibleInPublicShare(
    media(),
    [seatTag(1000, 100)],
    openPrivacy([100, 200]),
    claims
  ),
  true,
  "a photo tagged with the sharer's role is public"
);
assert.equal(
  isAlbumPhotoVisibleInPublicShare(
    media({ uploader_user_id: 100 }),
    [{ tag_type: "other", user_id: null }],
    openPrivacy([100]),
    claims
  ),
  true,
  "a sharer-uploaded tagged scene is public"
);
assert.equal(
  isAlbumPhotoVisibleInPublicShare(
    media(),
    [seatTag(2000, 200)],
    openPrivacy([100, 200]),
    claims
  ),
  false,
  "unrelated media uploaded by another person is excluded"
);
assert.equal(
  isAlbumPhotoVisibleInPublicShare(media({ uploader_user_id: 100 }), [], openPrivacy([100]), claims),
  false,
  "untagged media is excluded"
);

const uploaderOptOut = openPrivacy([100]);
uploaderOptOut.set(100, { allow_uploaded_visible: false, allow_tagged_visible: true });
assert.equal(
  isAlbumPhotoVisibleInPublicShare(
    media({ uploader_user_id: 100 }),
    [{ tag_type: "other", user_id: null }],
    uploaderOptOut,
    claims
  ),
  false,
  "the uploader veto applies when the uploader is the sharer"
);

const sharerTagOptOut = openPrivacy([100, 200]);
sharerTagOptOut.set(100, { allow_uploaded_visible: true, allow_tagged_visible: false });
assert.equal(
  isAlbumPhotoVisibleInPublicShare(
    media(),
    [seatTag(1000, 100)],
    sharerTagOptOut,
    claims
  ),
  false,
  "the tagged-person veto applies when the tagged person is the sharer"
);

const groupOptOut = openPrivacy([100, 200, 300]);
groupOptOut.set(300, { allow_uploaded_visible: true, allow_tagged_visible: false });
assert.equal(
  isAlbumPhotoVisibleInPublicShare(
    media(),
    [seatTag(1000, 100), seatTag(3000, 300)],
    groupOptOut,
    claims
  ),
  false,
  "one tagged person vetoes a group photo"
);

assert.equal(
  isAlbumPhotoVisibleInPublicShare(
    media({ uploader_user_id: 100 }),
    [seatTag(3000, null, { seat_user_id: 300 })],
    openPrivacy([100, 300]),
    claims
  ),
  false,
  "an occupied seat tag missing its bound user closes the item"
);
assert.equal(
  isAlbumPhotoVisibleInPublicShare(
    media({ uploader_user_id: 100 }),
    [
      { tag_type: "npc", user_id: null },
      { tag_type: "session_npc_role", user_id: null },
      { tag_type: "other", user_id: null }
    ],
    openPrivacy([100]),
    claims
  ),
  true,
  "unbound NPC, scene and other tags do not create a personal veto"
);

console.log("D48 public album privacy smoke cases passed (9)");

const candidates = [];
const candidateTags = new Map();
for (let index = 1; index <= 45; index += 1) {
  const sharerRoleUpload = index <= 20;
  const otherRoleUpload = index > 20 && index <= 35;
  const item = media({
    id: index,
    uploader_user_id: sharerRoleUpload || !otherRoleUpload ? 100 : 200,
    media_type: index <= 5 ? "video" : "image",
    processing_status: "ready",
    created_at: new Date(Date.UTC(2026, 6, 19, 0, 0, index)).toISOString()
  });
  candidates.push(item);
  candidateTags.set(
    index,
    sharerRoleUpload || otherRoleUpload
      ? [seatTag(1000, 100)]
      : [{ tag_type: "other", user_id: null }]
  );
}
const selected = selectPublicShareMedia(
  candidates.reverse(),
  candidateTags,
  openPrivacy([100, 200]),
  claims
);
assert.equal(selected.length, 30, "a public share snapshot contains at most 30 media items");
assert.equal(
  selected.filter((item) => item.media_type === "video").length,
  3,
  "a public share snapshot contains at most three videos"
);
assert.deepEqual(
  selected.slice(0, 18).map((item) => Number(item.uploader_user_id)),
  Array(18).fill(100),
  "sharer-uploaded role media is selected before other-uploaded role media"
);
assert.equal(
  selected.slice(18).every((item) => Number(item.uploader_user_id) === 200),
  true,
  "other-uploaded role media is selected before sharer-uploaded scene media"
);

const sameTime = "2026-07-19T12:00:00.000Z";
const stableCandidates = [
  media({ id: 50, uploader_user_id: 100, created_at: sameTime }),
  media({ id: 51, uploader_user_id: 100, created_at: sameTime })
];
const stableTags = new Map([
  [50, [seatTag(1000, 100)]],
  [51, [seatTag(1000, 100)]]
]);
assert.deepEqual(
  selectPublicShareMedia(stableCandidates, stableTags, openPrivacy([100]), claims)
    .map((item) => Number(item.id)),
  [51, 50],
  "equal-priority media uses created_at DESC then id DESC"
);

console.log("D48 bounded public album snapshot selection cases passed (5)");

const fixedSnapshotIds = normalizePublicShareSnapshotIds([3, 1, 2], {
  label: "media_ids",
  max: 30
});
assert.deepEqual(fixedSnapshotIds, [3, 1, 2], "valid snapshot order is preserved");
assert.throws(
  () => normalizePublicShareSnapshotIds(Array.from({ length: 31 }, (_, index) => index + 1), {
    label: "media_ids",
    max: 30
  }),
  /invalid/,
  "snapshots over 30 items close"
);
assert.throws(
  () => normalizePublicShareSnapshotIds([1, 1], { label: "media_ids", max: 30 }),
  /invalid/,
  "duplicate snapshot media IDs close"
);
assert.throws(
  () => normalizePublicShareSnapshotIds([0], { label: "media_ids", max: 30 }),
  /invalid/,
  "non-positive snapshot media IDs close"
);
assert.equal(
  isPublicShareSnapshotMediaId(fixedSnapshotIds, 4),
  false,
  "media approved or tagged after sharing stays outside an old snapshot"
);
assert.equal(
  publicShareSnapshotDigest({
    sessionId: 10,
    sharerUserId: 100,
    seatId: 1000,
    mediaIds: [3, 1, 2],
    coverMediaIds: [2, 1]
  }),
  publicShareSnapshotDigest({
    sessionId: 10,
    sharerUserId: 100,
    seatId: 1000,
    mediaIds: [1, 2, 3],
    coverMediaIds: [1, 2]
  }),
  "snapshot digest normalization allows identical snapshots to be reused"
);

console.log("D48 bounded snapshot validation cases passed (6)");

const coverCandidates = [
  media({ id: 101, uploader_user_id: 100, image_width: 1200, image_height: 800 }),
  media({ id: 102, uploader_user_id: 100, image_width: 900, image_height: 900 }),
  media({ id: 103, uploader_user_id: 100, image_width: 2000, image_height: 1200 }),
  media({ id: 104, uploader_user_id: 200, image_width: 3000, image_height: 2000 }),
  media({ id: 105, uploader_user_id: 100, image_width: 4000, image_height: 3000 })
];
const coverTags = new Map([
  [101, [seatTag(1000, 100)]],
  [102, [{ tag_type: "other", user_id: null }]],
  [103, [seatTag(1000, 100), seatTag(3000, 300)]],
  [104, [seatTag(1000, 100)]],
  [105, [{ tag_type: "npc", user_id: null }]]
]);
assert.deepEqual(
  selectPublicShareCoverMedia(
    coverCandidates,
    coverTags,
    openPrivacy([100, 200, 300]),
    claims
  ).map((item) => Number(item.id)),
  [101, 105, 102],
  "cover uses owner-uploaded solo-role photos first, then owner-uploaded scene photos by area"
);
assert.equal(
  selectPublicShareCoverMedia(
    [coverCandidates[2], coverCandidates[3]],
    coverTags,
    openPrivacy([100, 200, 300]),
    claims
  ).length,
  0,
  "group photos and other-uploaded photos cannot become the external cover"
);
assert.equal(
  selectPublicShareCoverMedia(
    Array.from({ length: 12 }, (_, index) => media({
      id: 200 + index,
      uploader_user_id: 100,
      image_width: 1000 + index,
      image_height: 1000,
      created_at: sameTime
    })),
    new Map(Array.from({ length: 12 }, (_, index) => [
      200 + index,
      [seatTag(1000, 100)]
    ])),
    openPrivacy([100]),
    claims
  ).length,
  9,
  "cover selection is bounded to nine images"
);

const expectedLayouts = [
  [1],
  [2],
  [3],
  [2, 2],
  [3, 2],
  [3, 3],
  [3, 3, 1],
  [3, 3, 2],
  [3, 3, 3]
];
for (let count = 1; count <= 9; count += 1) {
  assert.deepEqual(
    publicShareCoverGridLayout(count).rowCounts,
    expectedLayouts[count - 1],
    `cover layout for ${count} images matches Moments-style rows`
  );
}

console.log("D48 safe cover candidate and 1-9 grid cases passed (12)");

if (!process.argv.includes("--unit")) {
  await import("./d23-album-share-join-policy-smoke.js");
}
