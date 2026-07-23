import assert from "node:assert/strict";
import test from "node:test";

import {
  createOrReuseSessionAlbumPublicShare,
  listPublicSessionAlbumShare,
  publicShareSnapshotDigest
} from "../src/modules/core/service.js";
import * as apiServer from "../src/server.js";

const { attachPublicSessionAlbumMediaUrls } = apiServer;

const claims = {
  version: 2,
  shareId: 50,
  sessionId: 10,
  sharerUserId: 100,
  seatId: 1000,
  exp: 2_000_000_000
};

function photo(id, overrides = {}) {
  return {
    id,
    session_id: 10,
    uploader_user_id: 100,
    status: "active",
    moderation_status: "approved",
    media_type: "image",
    processing_status: "ready",
    image_width: 1200,
    image_height: 800,
    photo_url: `/private/source/${id}.jpg`,
    storage_object_key: `private/${id}.jpg`,
    created_at: new Date(Date.UTC(2026, 6, 19, 0, 0, id)).toISOString(),
    ...overrides
  };
}

function sharerSeatTag(photoId) {
  return {
    id: photoId,
    photo_id: photoId,
    tag_type: "seat",
    seat_id: 1000,
    user_id: 100,
    seat_user_id: 100,
    sort_order: 0
  };
}

function shareCreationConnection(photos) {
  const shares = [];
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
      if (sql.includes("FROM sessions session")) {
        return [[{ id: 10, status: "completed", organizer_user_id: 100 }]];
      }
      if (sql.includes("FROM session_seats seat") && sql.includes("JOIN users account")) {
        return [[seat]];
      }
      if (sql.includes("FROM session_album_photos photo")) return [photos];
      if (sql.includes("FROM session_album_photo_tags")) {
        return [values.map((photoId) => sharerSeatTag(Number(photoId)))];
      }
      if (sql.includes("FROM session_album_privacy")) return [[]];
      if (sql.includes("FROM session_album_public_shares") && sql.includes("snapshot_digest")) {
        return [[]];
      }
      if (sql.includes("INSERT INTO session_album_public_shares")) {
        shares.push({
          id: shares.length + 1,
          session_id: values[0],
          sharer_user_id: values[1],
          seat_id: values[2],
          media_ids: values[3],
          implicit_untagged_media: values[4],
          snapshot_digest: values[5],
          cover_media_ids: values[6],
          expires_at: values[7],
          revoked_at: null
        });
        return [{ insertId: shares.length }];
      }
      if (sql.includes("SELECT * FROM session_album_public_shares WHERE id = ?")) {
        return [[shares.find((share) => Number(share.id) === Number(values[0]))]];
      }
      throw new Error(`Unexpected share-creation query: ${sql}`);
    }
  };
}

test("new public-share snapshots persist only three ordered cover media IDs", async () => {
  const photos = [photo(1), photo(2), photo(3), photo(4)];
  const fixture = shareCreationConnection(photos);

  const share = await createOrReuseSessionAlbumPublicShare(
    { user: { id: 100 } },
    10,
    { withTransaction: async (work) => work(fixture) }
  );

  assert.deepEqual(JSON.parse(fixture.shares[0].cover_media_ids), [4, 3, 2]);
  assert.deepEqual(share.cover_media_ids, [4, 3, 2]);
  assert.deepEqual(share.cover_media, [
    { id: 4, image_width: 1200, image_height: 800, focus_x: 0.5, focus_y: 0.5 },
    { id: 3, image_width: 1200, image_height: 800, focus_x: 0.5, focus_y: 0.5 },
    { id: 2, image_width: 1200, image_height: 800, focus_x: 0.5, focus_y: 0.5 }
  ]);
});

function legacyShareRecipeConnection() {
  const legacyCoverMediaIds = [4, 3, 2, 1, ...Array.from({ length: 26 }, (_, index) => index + 5)];
  const photos = [
    photo(4, { image_width: 1600, image_height: 1200, focus_x: 0.25, focus_y: 0.75 }),
    photo(3),
    photo(2, { image_width: 900, image_height: 1200 }),
    photo(1, { image_width: 1200, image_height: 1600, focus_x: 0.8, focus_y: 0.2 })
  ];
  const share = {
    id: 50,
    session_id: 10,
    sharer_user_id: 100,
    seat_id: 1000,
    media_ids: legacyCoverMediaIds,
    // This is a legacy snapshot. The unsafe second candidate must be skipped
    // and must never be exposed as an internal candidate list.
    cover_media_ids: legacyCoverMediaIds,
    implicit_untagged_media: [],
    expires_at: "2099-01-01T00:00:00.000Z",
    revoked_at: null
  };
  share.snapshot_digest = publicShareSnapshotDigest({
    sessionId: share.session_id,
    sharerUserId: share.sharer_user_id,
    seatId: share.seat_id,
    mediaIds: share.media_ids,
    coverMediaIds: share.cover_media_ids
  });
  const tags = [
    sharerSeatTag(4),
    sharerSeatTag(3),
    {
      id: 30,
      photo_id: 3,
      tag_type: "seat",
      seat_id: 2000,
      user_id: 200,
      seat_user_id: 200,
      sort_order: 1
    },
    { id: 20, photo_id: 2, tag_type: "other", seat_id: null, user_id: null, sort_order: 0 },
    sharerSeatTag(1)
  ];
  const connection = {
    async query(sql, values = []) {
      if (sql.includes("FROM session_album_public_shares")) return [[share]];
      if (sql.includes("FROM sessions session")) {
        return [[{
          id: 10,
          status: "completed",
          organizer_user_id: 100,
          script_name_snapshot: "雾都夜行",
          store_name_snapshot: "测试店",
          start_at: "2026-07-19T12:00:00.000Z"
        }]];
      }
      if (sql.includes("FROM users account")) return [[{ nickname: "Sharer", avatar_url: "" }]];
      if (sql.includes("FROM session_seats")) {
        return [[{
          id: 1000,
          name: "Sharer",
          role_name: "Sharer",
          confirmed_user_id: 100,
          status: "confirmed"
        }]];
      }
      if (sql.includes("FROM session_album_photo_tags")) {
        return [tags.filter((tag) => values.map(Number).includes(Number(tag.photo_id)))];
      }
      if (sql.includes("FROM session_album_privacy")) return [[]];
      if (sql.includes("FROM session_album_photos photo")) {
        const requestedIds = values.slice(1).map(Number);
        return [photos.filter((entry) => requestedIds.includes(Number(entry.id)))];
      }
      throw new Error(`Unexpected public-share recipe query: ${sql}`);
    }
  };
  return connection;
}

test("public share projects a privacy-safe client Canvas cover recipe from legacy candidates", async () => {
  const album = await listPublicSessionAlbumShare(claims, {
    withDatabaseConnection: async (work) => work(legacyShareRecipeConnection())
  });
  const result = attachPublicSessionAlbumMediaUrls(album, claims, "album-share-token", {
    emit: () => {}
  });

  assert.deepEqual(
    result.cover_recipe.images.map(({ thumbnail_url, ...image }) => image),
    [
      { id: 4, width: 1600, height: 1200, focus_x: 0.25, focus_y: 0.75 },
      { id: 2, width: 900, height: 1200, focus_x: 0.5, focus_y: 0.5 },
      { id: 1, width: 1200, height: 1600, focus_x: 0.8, focus_y: 0.2 }
    ]
  );
  assert.equal(result.cover_recipe.version, "client-canvas-v1");
  for (const image of result.cover_recipe.images) {
    const url = new URL(image.thumbnail_url, "http://localhost");
    assert.equal(url.pathname, `/api/session-album/public-share/photos/${image.id}/image`);
    assert.equal(url.searchParams.get("variant"), "thumbnail");
    assert.ok(url.searchParams.get("token"));
  }
  for (const field of ["cover_media_ids", "cover_media", "cover_url", "timeline_cover_url"]) {
    assert.equal(field in result, false, field);
  }
  assert.equal(JSON.stringify(result).includes("private/"), false);
  assert.equal(JSON.stringify(result).includes("/private/source/"), false);
  assert.equal(JSON.stringify(result).includes("uploader_user_id"), false);
  assert.equal(JSON.stringify(result).includes("tag_type"), false);
});

test("share-token response returns the same minimal signed Canvas recipe contract", () => {
  assert.equal(typeof apiServer.sessionAlbumShareTokenResponse, "function");
  const share = {
    session_id: 10,
    share_id: 50,
    share_subject: { type: "seat", seat_id: 1000, label: "Sharer" },
    share_owner: { nickname: "Sharer", avatar_url: "" },
    focus_media_id: null,
    implicit_untagged_count: 0,
    visible_count: 3,
    photo_count: 3,
    video_count: 0,
    expires_at: "2099-01-01T00:00:00.000Z",
    cover_media_ids: [4, 2, 1],
    cover_media: [
      {
        id: 4,
        image_width: 1600,
        image_height: 1200,
        focus_x: 0.25,
        focus_y: 0.75,
        storage_object_key: "must-not-leak/4.jpg",
        photo_url: "/private/source/4.jpg",
        uploader_user_id: 100,
        tags: [{ tag_type: "seat" }]
      },
      {
        id: 2,
        image_width: 900,
        image_height: 1200,
        focus_x: 0.5,
        focus_y: 0.5
      },
      {
        id: 1,
        image_width: 1200,
        image_height: 1600,
        focus_x: 0.8,
        focus_y: 0.2
      }
    ]
  };

  const result = apiServer.sessionAlbumShareTokenResponse(
    share,
    claims,
    "issued-album-share-token"
  );
  const renewed = apiServer.sessionAlbumShareTokenResponse(
    share,
    claims,
    "renewed-album-share-token"
  );

  assert.deepEqual(
    result.cover_recipe.images.map(({ thumbnail_url, ...image }) => image),
    [
      { id: 4, width: 1600, height: 1200, focus_x: 0.25, focus_y: 0.75 },
      { id: 2, width: 900, height: 1200, focus_x: 0.5, focus_y: 0.5 },
      { id: 1, width: 1200, height: 1600, focus_x: 0.8, focus_y: 0.2 }
    ]
  );
  assert.equal(result.cover_recipe.version, "client-canvas-v1");
  for (const image of result.cover_recipe.images) {
    const url = new URL(image.thumbnail_url, "http://localhost");
    assert.equal(url.pathname, `/api/session-album/public-share/photos/${image.id}/image`);
    assert.equal(url.searchParams.get("variant"), "thumbnail");
    assert.ok(url.searchParams.get("token"));
  }
  assert.notEqual(
    result.cover_recipe.images[0].thumbnail_url,
    renewed.cover_recipe.images[0].thumbnail_url
  );
  for (const field of [
    "cover_media",
    "cover_media_ids",
    "cover_url",
    "timeline_cover_url",
    "photo_url",
    "storage_object_key",
    "uploader_user_id",
    "tags"
  ]) {
    assert.equal(field in result, false, field);
    assert.equal(JSON.stringify(result).includes(`"${field}"`), false, field);
  }
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(result).includes("/private/source/"), false);
});
