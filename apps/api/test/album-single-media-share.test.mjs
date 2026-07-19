import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createOrReuseSessionAlbumPublicShare,
  selectPublicShareMedia
} from "../src/modules/core/service.js";

const [serviceSource, serverSource] = await Promise.all([
  readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8"),
  readFile(new URL("../src/server.js", import.meta.url), "utf8")
]);

const claims = { sessionId: 10, sharerUserId: 100, seatId: 1000 };

function openPrivacy(userIds) {
  return new Map(userIds.map((userId) => [userId, {
    allow_uploaded_visible: true,
    allow_tagged_visible: true
  }]));
}

function eligibleMedia(id, overrides = {}) {
  return {
    id,
    session_id: 10,
    uploader_user_id: 100,
    status: "active",
    moderation_status: "approved",
    media_type: "image",
    processing_status: "ready",
    created_at: new Date(Date.UTC(2026, 6, 19, 0, 0, id)).toISOString(),
    ...overrides
  };
}

function sharerSeatTag() {
  return {
    tag_type: "seat",
    seat_id: 1000,
    user_id: 100,
    seat_user_id: 100
  };
}

function tagsFor(candidates) {
  return new Map(candidates.map((media) => [Number(media.id), [sharerSeatTag()]]));
}

function focusedShareConnection(photoRows, tagRows) {
  const shares = [];
  const session = { id: 10, organizer_user_id: 100 };
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
      if (sql.includes("FROM session_album_photos photo")) return [photoRows];
      if (sql.includes("FROM session_album_photo_tags tag")) return [tagRows];
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
      throw new Error(`Unexpected focused share test query: ${sql}`);
    }
  };
}

test("selectPublicShareMedia seeds an eligible required image and keeps the 30-media cap", () => {
  const candidates = Array.from({ length: 35 }, (_, index) => eligibleMedia(index + 1));
  const selected = selectPublicShareMedia(
    candidates,
    tagsFor(candidates),
    openPrivacy([100]),
    claims,
    { requiredMediaId: 1 }
  );

  assert.equal(selected[0].id, 1);
  assert.equal(selected.length, 30);
  assert.equal(new Set(selected.map((media) => media.id)).size, 30);
});

test("selectPublicShareMedia includes a required ready video and counts it toward the three-video cap", () => {
  const candidates = [
    eligibleMedia(100, { media_type: "video", created_at: "2026-07-19T00:00:00.000Z" }),
    ...Array.from({ length: 5 }, (_, index) => eligibleMedia(index + 1, {
      media_type: "video",
      created_at: new Date(Date.UTC(2026, 6, 19, 0, 1, index + 1)).toISOString()
    })),
    ...Array.from({ length: 30 }, (_, index) => eligibleMedia(index + 200, {
      created_at: new Date(Date.UTC(2026, 6, 18, 0, 0, index + 1)).toISOString()
    }))
  ];
  const selected = selectPublicShareMedia(
    candidates,
    tagsFor(candidates),
    openPrivacy([100]),
    claims,
    { requiredMediaId: 100 }
  );

  assert.equal(selected.some((media) => media.id === 100), true);
  assert.equal(selected.filter((media) => media.media_type === "video").length, 3);
});

test("selectPublicShareMedia does not include absent or noneligible required media", () => {
  const candidates = [
    ...Array.from({ length: 4 }, (_, index) => eligibleMedia(index + 1)),
    eligibleMedia(99, { moderation_status: "pending" })
  ];
  const tags = tagsFor(candidates);
  const privacy = openPrivacy([100]);

  for (const requiredMediaId of [999, 99]) {
    const selected = selectPublicShareMedia(candidates, tags, privacy, claims, { requiredMediaId });
    assert.equal(selected.some((media) => media.id === requiredMediaId), false);
  }
});

test("selectPublicShareMedia without options preserves D48 ranking order", () => {
  const candidates = [
    eligibleMedia(1, { created_at: "2026-07-19T00:00:01.000Z" }),
    eligibleMedia(2, { created_at: "2026-07-19T00:00:03.000Z" }),
    eligibleMedia(3, {
      uploader_user_id: 200,
      created_at: "2026-07-19T00:00:04.000Z"
    }),
    eligibleMedia(4, { created_at: "2026-07-19T00:00:02.000Z" })
  ];
  const tags = new Map([
    [1, [sharerSeatTag()]],
    [2, [sharerSeatTag()]],
    [3, [sharerSeatTag()]],
    [4, [{ tag_type: "other", user_id: null }]]
  ]);

  assert.deepEqual(
    selectPublicShareMedia(candidates, tags, openPrivacy([100, 200]), claims)
      .map((media) => media.id),
    [2, 1, 3, 4]
  );
});

test("createOrReuseSessionAlbumPublicShare persists and reuses an eligible focused snapshot", async () => {
  const photos = [
    eligibleMedia(1, { created_at: "2026-07-19T00:00:01.000Z" }),
    eligibleMedia(2, { created_at: "2026-07-19T00:00:02.000Z" })
  ];
  const connection = focusedShareConnection(
    photos,
    photos.map((photo) => ({ photo_id: photo.id, ...sharerSeatTag() }))
  );
  const options = {
    focusMediaId: 1,
    withTransaction: async (work) => work(connection)
  };

  const first = await createOrReuseSessionAlbumPublicShare({ user: { id: 100 } }, 10, options);
  const second = await createOrReuseSessionAlbumPublicShare({ user: { id: 100 } }, 10, options);

  assert.equal(first.focus_media_id, 1);
  assert.deepEqual(first.media_ids, [1, 2]);
  assert.equal(connection.shares.length, 1);
  assert.equal(second.share_id, first.share_id);
  assert.equal(second.focus_media_id, 1);
});

test("createOrReuseSessionAlbumPublicShare rejects a focus ID excluded by eligibility filtering", async () => {
  const eligible = eligibleMedia(1);
  const unavailable = eligibleMedia(2, { moderation_status: "pending" });
  const connection = focusedShareConnection(
    [eligible, unavailable],
    [
      { photo_id: eligible.id, ...sharerSeatTag() },
      { photo_id: unavailable.id, ...sharerSeatTag() }
    ]
  );

  await assert.rejects(
    () => createOrReuseSessionAlbumPublicShare({ user: { id: 100 } }, 10, {
      focusMediaId: unavailable.id,
      withTransaction: async (work) => work(connection)
    }),
    (error) => error.statusCode === 409 && error.code === "ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE"
  );
  assert.equal(connection.shares.length, 0);
});

test("focused album shares validate the focus ID and expose it through the share-token route", () => {
  assert.match(serviceSource, /function normalizePublicShareFocusMediaId\(value\)/);
  assert.match(serviceSource, /ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE/);
  assert.match(
    serviceSource,
    /selectPublicShareMedia\(photoRows, tagsMap, privacyByUser, claims, \{\s*requiredMediaId: focusMediaId\s*\}\)/
  );
  assert.match(serviceSource, /focus_media_id: focusMediaId \|\| null/);

  const shareTokenRoute = serverSource.slice(
    serverSource.indexOf("const sessionAlbumShareTokenId"),
    serverSource.indexOf("const sessionAlbumPublicSharesId")
  );
  assert.match(serverSource, /const body = await bodyFor\(request\)/);
  assert.match(shareTokenRoute, /\{ focusMediaId: body\?\.focusMediaId \}/);
  assert.match(shareTokenRoute, /focus_media_id: share\.focus_media_id/);
});

test("createOrReuseSessionAlbumPublicShare rejects invalid supplied focus IDs as unavailable", async () => {
  const user = { user: { id: 100 } };
  for (const focusMediaId of [0, null, "1", 1.5]) {
    await assert.rejects(
      () => createOrReuseSessionAlbumPublicShare(user, 10, {
        focusMediaId,
        withTransaction: async () => assert.fail("invalid focus ID must not open a transaction")
      }),
      (error) => error.statusCode === 409 && error.code === "ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE"
    );
  }
});
