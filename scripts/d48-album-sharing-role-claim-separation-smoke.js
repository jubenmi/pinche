import assert from "node:assert/strict";
import {
  isAlbumPhotoVisibleInPublicShare,
  normalizePublicShareSnapshotIds,
  publicShareSnapshotDigest,
  selectPublicShareCoverMedia,
  selectPublicShareMedia
} from "../apps/api/src/modules/core/service.js";
import {
  assertManifestMatchesLegacySnapshot
} from "../apps/api/src/modules/core/public-album-share-manifest.js";

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
const roleTag = (seatId, label = `角色${seatId}`) => ({
  kind: "role",
  ref_id: seatId,
  label
});
const npcRoleTag = (npcRoleId, label = `NPC角色${npcRoleId}`) => ({
  kind: "npc_role",
  ref_id: npcRoleId,
  label
});
const otherTag = () => ({ kind: "other", ref_id: null, label: "其他" });
const tagReadContext = (tagsByMediaId, privacySubjectsByMediaId = new Map()) => ({
  tagsByMediaId: new Map(tagsByMediaId),
  privacySubjectsByMediaId: new Map(
    [...new Map(tagsByMediaId).keys()].map((mediaId) => [
      mediaId,
      privacySubjectsByMediaId.get(mediaId) || []
    ])
  )
});
const visible = (item, tags, privacyByUser, privacyUserIds = []) =>
  isAlbumPhotoVisibleInPublicShare(
    item,
    tagReadContext(
      new Map([[Number(item.id), tags]]),
      new Map([[Number(item.id), privacyUserIds]])
    ),
    privacyByUser,
    claims
  );

assert.equal(
  visible(media(), [roleTag(1000, "沈青")], openPrivacy([100, 200]), [100]),
  true,
  "a photo tagged with the sharer's role is public"
);
assert.equal(
  visible(media({ uploader_user_id: 100 }), [otherTag()], openPrivacy([100])),
  true,
  "a sharer-uploaded tagged scene is public"
);
assert.equal(
  visible(media(), [roleTag(2000, "顾川")], openPrivacy([100, 200]), [200]),
  false,
  "unrelated media uploaded by another person is excluded"
);
assert.equal(
  visible(media({ uploader_user_id: 100 }), [], openPrivacy([100])),
  false,
  "untagged media is excluded"
);

const uploaderOptOut = openPrivacy([100]);
uploaderOptOut.set(100, { allow_uploaded_visible: false, allow_tagged_visible: true });
assert.equal(
  visible(media({ uploader_user_id: 100 }), [otherTag()], uploaderOptOut),
  false,
  "the uploader veto applies when the uploader is the sharer"
);

const sharerTagOptOut = openPrivacy([100, 200]);
sharerTagOptOut.set(100, { allow_uploaded_visible: true, allow_tagged_visible: false });
assert.equal(
  visible(media(), [roleTag(1000, "沈青")], sharerTagOptOut, [100]),
  false,
  "the tagged-person veto applies when the tagged person is the sharer"
);

const groupOptOut = openPrivacy([100, 200, 300]);
groupOptOut.set(300, { allow_uploaded_visible: true, allow_tagged_visible: false });
assert.equal(
  visible(
    media(),
    [roleTag(1000, "沈青"), roleTag(3000, "林默")],
    groupOptOut,
    [100, 300]
  ),
  false,
  "one tagged person vetoes a group photo"
);

assert.equal(
  isAlbumPhotoVisibleInPublicShare(
    media({ uploader_user_id: 100 }),
    {
      tagsByMediaId: new Map([[1, [roleTag(3000, "林默")]]]),
      privacySubjectsByMediaId: new Map()
    },
    openPrivacy([100, 300]),
    claims
  ),
  false,
  "an incomplete canonical tag read context closes the item"
);
assert.equal(
  visible(
    media({ uploader_user_id: 100 }),
    [npcRoleTag(7000, "秦掌柜"), otherTag()],
    openPrivacy([100])
  ),
  true,
  "NPC role and other tags do not create a player-account privacy veto"
);

console.log("D48 public album privacy smoke cases passed (9)");

const candidates = [];
const candidateTags = new Map();
const candidatePrivacySubjects = new Map();
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
      ? [roleTag(1000, "沈青")]
      : [otherTag()]
  );
  candidatePrivacySubjects.set(index, sharerRoleUpload || otherRoleUpload ? [100] : []);
}
const selected = selectPublicShareMedia(
  candidates.reverse(),
  tagReadContext(candidateTags, candidatePrivacySubjects),
  openPrivacy([100, 200]),
  claims
);
assert.equal(selected.length, 43, "a public share snapshot retains all static media");
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
  selected.slice(18, 33).every((item) => Number(item.uploader_user_id) === 200),
  true,
  "other-uploaded role media is selected before sharer-uploaded scene media"
);
assert.equal(
  selected.slice(33).every((item) => Number(item.uploader_user_id) === 100),
  true,
  "sharer-uploaded scene media remains in the full snapshot"
);

const sameTime = "2026-07-19T12:00:00.000Z";
const stableCandidates = [
  media({ id: 50, uploader_user_id: 100, created_at: sameTime }),
  media({ id: 51, uploader_user_id: 100, created_at: sameTime })
];
const stableTags = new Map([
  [50, [roleTag(1000, "沈青")]],
  [51, [roleTag(1000, "沈青")]]
]);
assert.deepEqual(
  selectPublicShareMedia(
    stableCandidates,
    tagReadContext(stableTags, new Map([[50, [100]], [51, [100]]])),
    openPrivacy([100]),
    claims
  )
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
assert.doesNotThrow(
  () => assertManifestMatchesLegacySnapshot(
    fixedSnapshotIds.map((mediaId, ordinal) => ({ ordinal, media_id: mediaId })),
    fixedSnapshotIds
  ),
  "a normalized manifest preserves the fixed snapshot membership and order"
);
assert.throws(
  () => assertManifestMatchesLegacySnapshot(
    fixedSnapshotIds.map((mediaId, ordinal) => ({ ordinal, media_id: mediaId })),
    [...fixedSnapshotIds, 4]
  ),
  /manifest is invalid/,
  "media approved or tagged after sharing stays outside an old manifest"
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

console.log("D48 bounded snapshot validation and manifest cases passed (7)");

const coverCandidates = [
  media({ id: 101, uploader_user_id: 100, image_width: 1200, image_height: 800 }),
  media({ id: 102, uploader_user_id: 100, image_width: 900, image_height: 900 }),
  media({ id: 103, uploader_user_id: 100, image_width: 2000, image_height: 1200 }),
  media({ id: 104, uploader_user_id: 200, image_width: 3000, image_height: 2000 }),
  media({ id: 105, uploader_user_id: 100, image_width: 4000, image_height: 3000 })
];
const coverTags = new Map([
  [101, [roleTag(1000, "沈青")]],
  [102, [otherTag()]],
  [103, [roleTag(1000, "沈青"), roleTag(3000, "林默")]],
  [104, [roleTag(1000, "沈青")]],
  [105, [npcRoleTag(7000, "秦掌柜")]]
]);
const coverPrivacySubjects = new Map([
  [101, [100]],
  [102, []],
  [103, [100, 300]],
  [104, [100]],
  [105, []]
]);
assert.deepEqual(
  selectPublicShareCoverMedia(
    coverCandidates,
    tagReadContext(coverTags, coverPrivacySubjects),
    openPrivacy([100, 200, 300]),
    claims
  ).map((item) => Number(item.id)),
  [101, 105, 102],
  "cover uses owner-uploaded solo-role photos first, then owner-uploaded scene photos by area"
);
assert.equal(
  selectPublicShareCoverMedia(
    [coverCandidates[2], coverCandidates[3]],
    tagReadContext(coverTags, coverPrivacySubjects),
    openPrivacy([100, 200, 300]),
    claims
  ).length,
  0,
  "group photos and other-uploaded photos cannot become the external cover"
);
assert.equal(
  selectPublicShareCoverMedia(
    Array.from({ length: 35 }, (_, index) => media({
      id: 200 + index,
      uploader_user_id: 100,
      image_width: 1000 + index,
      image_height: 1000,
      created_at: sameTime
    })),
    tagReadContext(
      new Map(Array.from({ length: 35 }, (_, index) => [
        200 + index,
        [roleTag(1000, "沈青")]
      ])),
      new Map(Array.from({ length: 35 }, (_, index) => [200 + index, [100]]))
    ),
    openPrivacy([100]),
    claims
  ).length,
  3,
  "cover selection remains bounded to the client Canvas input limit"
);

console.log("D48 safe cover candidate cases passed (3)");

if (!process.argv.includes("--unit")) {
  await import("./d23-album-share-join-policy-smoke.js");
}
