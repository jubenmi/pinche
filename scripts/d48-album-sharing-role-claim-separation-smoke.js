import assert from "node:assert/strict";
import { isAlbumPhotoVisibleInPublicShare } from "../apps/api/src/modules/core/service.js";

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
