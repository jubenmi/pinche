import assert from "node:assert/strict";
import test from "node:test";

import {
  createOrReuseSessionAlbumPublicShare,
  normalizePublicShareSnapshotIds,
  normalizeSessionAlbumPublicShareScope,
  publicShareSnapshotDigest
} from "../src/modules/core/service.js";
import { publicShareTokenOptions } from "../src/server.js";

const claims = { sessionId: 10, sharerUserId: 100, seatId: 1000 };

function media(id, overrides = {}) {
  return {
    id,
    session_id: 10,
    uploader_user_id: 100,
    status: "active",
    moderation_status: "approved",
    media_type: id <= 4 ? "video" : "image",
    processing_status: "ready",
    created_at: new Date(Date.UTC(2026, 6, 20, 0, 0, id)).toISOString(),
    ...overrides
  };
}

function tagRow(photoId) {
  return {
    photo_id: photoId,
    tag_type: "seat",
    seat_id: 1000,
    user_id: 100,
    seat_user_id: 100
  };
}

function shareConnection(photoRows) {
  const shares = [];
  const session = { id: 10, organizer_user_id: 100, status: "completed" };
  const seat = {
    id: 1000,
    name: "Sharer",
    role_name: "Sharer",
    confirmed_user_id: 100,
    status: "confirmed",
    sharer_nickname: "Sharer",
    sharer_avatar_url: ""
  };
  return {
    shares,
    async query(sql, values = []) {
      if (sql.includes("FROM sessions session")) return [[session]];
      if (sql.includes("FROM session_seats seat") && sql.includes("JOIN users account")) {
        return [[seat]];
      }
      if (sql.includes("FROM session_album_photos photo")) {
        return [[...photoRows].sort((left, right) => Number(right.id) - Number(left.id))];
      }
      if (sql.includes("FROM session_album_photo_tags tag")) {
        return [photoRows.map((photo) => tagRow(photo.id))];
      }
      if (sql.includes("FROM session_album_privacy")) return [[]];
      if (sql.includes("FROM session_album_public_shares") && sql.includes("snapshot_digest")) {
        return [[shares.find((share) => share.snapshot_digest === values[3])].filter(Boolean)];
      }
      if (sql.includes("INSERT INTO session_album_public_shares")) {
        const share = {
          id: shares.length + 1,
          session_id: values[0],
          sharer_user_id: values[1],
          seat_id: values[2],
          media_ids: values[3],
          snapshot_digest: values[4],
          cover_media_ids: values[5],
          expires_at: values[6],
          revoked_at: null
        };
        shares.push(share);
        return [{ insertId: share.id }];
      }
      if (sql.includes("SELECT * FROM session_album_public_shares WHERE id = ?")) {
        return [[shares.find((share) => Number(share.id) === Number(values[0]))].filter(Boolean)];
      }
      throw new Error(`Unexpected D53 query: ${sql}`);
    }
  };
}

function selectionInvalid(error) {
  return error?.statusCode === 409 && error.code === "ALBUM_PUBLIC_SHARE_SELECTION_INVALID";
}

test("explicit public-share scope normalization keeps legacy and focus compatibility", () => {
  assert.equal(typeof normalizeSessionAlbumPublicShareScope, "function");
  assert.deepEqual(normalizeSessionAlbumPublicShareScope({}), {
    mode: "legacy",
    focusMediaId: null,
    mediaIds: []
  });
  assert.deepEqual(normalizeSessionAlbumPublicShareScope({ scope: "all" }), {
    mode: "all",
    focusMediaId: null,
    mediaIds: []
  });
  assert.deepEqual(normalizeSessionAlbumPublicShareScope({ mediaIds: [31, 32] }), {
    mode: "selected",
    focusMediaId: null,
    mediaIds: [31, 32]
  });
  assert.deepEqual(normalizeSessionAlbumPublicShareScope({ focusMediaId: 7 }), {
    mode: "focus",
    focusMediaId: 7,
    mediaIds: []
  });
});

test("explicit selected scope rejects conflicting, empty, duplicate, and unsafe IDs", () => {
  for (const options of [
    { scope: "all", mediaIds: [1] },
    { scope: "all", focusMediaId: 1 },
    { mediaIds: [1], focusMediaId: 1 },
    { mediaIds: [] },
    { mediaIds: [1, 1] },
    { mediaIds: [0] },
    { mediaIds: [1.5] },
    { mediaIds: ["1"] },
    { mediaIds: "1" }
  ]) {
    assert.throws(() => normalizeSessionAlbumPublicShareScope(options), selectionInvalid);
  }
});

test("share-token route options forward only explicitly supplied scope fields", () => {
  assert.deepEqual(publicShareTokenOptions({}), {});
  assert.deepEqual(publicShareTokenOptions({ scope: "all" }), { scope: "all" });
  assert.deepEqual(publicShareTokenOptions({ mediaIds: [7, 8] }), { mediaIds: [7, 8] });
  assert.deepEqual(publicShareTokenOptions({ focusMediaId: 7 }), { focusMediaId: 7 });
});

test("large snapshots retain every media ID while covers remain bounded and digest-stable", () => {
  const mediaIds = Array.from({ length: 32 }, (_, index) => index + 1);
  assert.deepEqual(normalizePublicShareSnapshotIds(mediaIds), mediaIds);
  assert.throws(
    () => normalizePublicShareSnapshotIds(mediaIds.slice(0, 10), { max: 9 }),
    /invalid/
  );
  assert.throws(
    () => publicShareSnapshotDigest({
      ...claims,
      mediaIds,
      coverMediaIds: [33]
    }),
    /invalid/
  );
  assert.equal(
    publicShareSnapshotDigest({ ...claims, mediaIds, coverMediaIds: [9, 8] }),
    publicShareSnapshotDigest({
      ...claims,
      mediaIds: mediaIds.slice().reverse(),
      coverMediaIds: [8, 9]
    })
  );
});

test("all scope stores every currently eligible medium without the legacy item or video caps", async () => {
  const photos = Array.from({ length: 32 }, (_, index) => media(index + 1));
  const connection = shareConnection(photos);
  const result = await createOrReuseSessionAlbumPublicShare({ user: { id: 100 } }, 10, {
    scope: "all",
    withTransaction: async (work) => work(connection)
  });

  assert.equal(result.visible_count, 32);
  assert.equal(result.video_count, 4);
  assert.deepEqual(result.media_ids, Array.from({ length: 32 }, (_, index) => 32 - index));
  assert.ok(result.cover_media_ids.length <= 9);
  assert.ok(result.cover_media_ids.every((id) => result.media_ids.includes(id)));
});

test("no-field legacy sharing retains its bounded selection while focus retains the requested medium", async () => {
  const photos = Array.from({ length: 40 }, (_, index) => media(index + 1, {
    media_type: index >= 35 ? "video" : "image"
  }));
  const connection = shareConnection(photos);
  const transaction = async (work) => work(connection);

  const legacy = await createOrReuseSessionAlbumPublicShare({ user: { id: 100 } }, 10, {
    withTransaction: transaction
  });
  assert.equal(legacy.focus_media_id, null);
  assert.equal(legacy.visible_count, 30);
  assert.equal(legacy.video_count, 3);

  const focused = await createOrReuseSessionAlbumPublicShare({ user: { id: 100 } }, 10, {
    focusMediaId: 36,
    withTransaction: transaction
  });
  assert.equal(focused.focus_media_id, 36);
  assert.equal(focused.media_ids.includes(36), true);
  assert.equal(focused.visible_count, 30);
});

test("selected scope persists only the exact eligible set in stable album order", async () => {
  const photos = Array.from({ length: 32 }, (_, index) => media(index + 1));
  const connection = shareConnection(photos);
  const requested = Array.from({ length: 31 }, (_, index) => index + 1).reverse();
  const result = await createOrReuseSessionAlbumPublicShare({ user: { id: 100 } }, 10, {
    mediaIds: requested,
    withTransaction: async (work) => work(connection)
  });

  assert.equal(result.visible_count, 31);
  assert.deepEqual(result.media_ids, Array.from({ length: 31 }, (_, index) => 31 - index));
  assert.equal(result.media_ids.includes(32), false);
});

test("selected scope fails as one request when any requested medium is unavailable", async () => {
  const photos = Array.from({ length: 32 }, (_, index) => media(index + 1));
  const connection = shareConnection(photos);

  await assert.rejects(
    () => createOrReuseSessionAlbumPublicShare({ user: { id: 100 } }, 10, {
      mediaIds: [1, 999],
      withTransaction: async (work) => work(connection)
    }),
    selectionInvalid
  );
  assert.equal(connection.shares.length, 0);
});
