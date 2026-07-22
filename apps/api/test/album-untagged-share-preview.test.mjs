import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createOrReuseSessionAlbumPublicShare,
  getPublicSessionAlbumPhotoForMedia,
  isAlbumPhotoVisibleInPublicShare,
  normalizeImplicitUntaggedMedia,
  publicShareSnapshotDigest,
  selectPublicShareCoverMedia,
  selectPublicShareMedia
} from "../src/modules/core/service.js";

const serviceSource = await readFile(
  new URL("../src/modules/core/service.js", import.meta.url),
  "utf8"
);
const serverSource = await readFile(
  new URL("../src/server.js", import.meta.url),
  "utf8"
);

const claims = {
  sessionId: 10,
  sharerUserId: 100,
  seatId: 1000,
  mediaIds: [1],
  coverMediaIds: []
};

function media(id, overrides = {}) {
  return {
    id,
    session_id: 10,
    uploader_user_id: 100,
    media_type: "image",
    status: "active",
    moderation_status: "approved",
    processing_status: "ready",
    tag_version: 2,
    created_at: new Date(Date.UTC(2026, 6, 22, 0, 0, id)).toISOString(),
    ...overrides
  };
}

function publicUntaggedPhotoConnection(photo, snapshotTagVersion) {
  const share = {
    id: 50,
    session_id: 10,
    sharer_user_id: 100,
    seat_id: 1000,
    media_ids: [Number(photo.id)],
    implicit_untagged_media: [{
      media_id: Number(photo.id),
      tag_version: snapshotTagVersion
    }],
    cover_media_ids: [],
    revoked_at: null,
    expires_at: "2099-01-01T00:00:00.000Z"
  };
  share.snapshot_digest = publicShareSnapshotDigest({
    sessionId: share.session_id,
    sharerUserId: share.sharer_user_id,
    seatId: share.seat_id,
    mediaIds: share.media_ids,
    coverMediaIds: share.cover_media_ids,
    implicitUntaggedMedia: share.implicit_untagged_media
  });
  return {
    async query(sql) {
      if (sql.includes("SELECT * FROM session_album_photos WHERE id = ?")) {
        return [[photo]];
      }
      if (sql.includes("FROM session_album_public_shares")) return [[share]];
      if (sql.includes("FROM sessions session")) {
        return [[{ id: 10, status: "completed" }]];
      }
      if (sql.includes("FROM session_seats") && sql.includes("confirmed_user_id")) {
        return [[{ id: 1000, confirmed_user_id: 100, status: "confirmed" }]];
      }
      if (sql.includes("FROM session_album_photo_tags")) return [[]];
      if (sql.includes("FROM session_album_privacy")) return [[]];
      throw new Error(`Unexpected public untagged photo query: ${sql}`);
    }
  };
}

function untaggedShareConnection(photoRows) {
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
        return [[{ id: 10, organizer_user_id: 100 }]];
      }
      if (sql.includes("FROM session_seats seat") && sql.includes("JOIN users account")) {
        return [[seat]];
      }
      if (sql.includes("FROM session_album_photos photo")) return [photoRows];
      if (sql.includes("FROM session_album_photo_tags tag")) return [[]];
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
          implicit_untagged_media: values[4],
          snapshot_digest: values[5],
          cover_media_ids: values[6],
          expires_at: values[7],
          revoked_at: null
        };
        shares.push(share);
        return [{ insertId: share.id }];
      }
      if (sql.includes("SELECT * FROM session_album_public_shares WHERE id = ?")) {
        return [[shares.find((share) => Number(share.id) === Number(values[0]))].filter(Boolean)];
      }
      throw new Error(`Unexpected untagged share test query: ${sql}`);
    }
  };
}

function privacy(entries) {
  return new Map(entries.map(([userId, overrides = {}]) => [userId, {
    allow_uploaded_visible: true,
    allow_tagged_visible: true,
    ...overrides
  }]));
}

function sharerSeatTag() {
  return {
    tag_type: "seat",
    seat_id: 1000,
    user_id: 100,
    seat_user_id: 100
  };
}

test("D52 migration adds tag versions and snapshot-local untagged entries", async () => {
  const migrationSql = await readFile(
    new URL("../migrations/0033_album_untagged_share_preview.sql", import.meta.url),
    "utf8"
  );

  assert.match(
    migrationSql,
    /ADD COLUMN tag_version BIGINT UNSIGNED NOT NULL DEFAULT 0/
  );
  assert.match(
    migrationSql,
    /ADD COLUMN implicit_untagged_media JSON NULL/
  );
});

test("snapshot digest is backward compatible and binds implicit tag versions", () => {
  const legacy = publicShareSnapshotDigest(claims);
  assert.equal(
    publicShareSnapshotDigest({ ...claims, implicitUntaggedMedia: [] }),
    legacy
  );
  const versionOne = publicShareSnapshotDigest({
    ...claims,
    implicitUntaggedMedia: [{ media_id: 1, tag_version: 1 }]
  });
  const versionTwo = publicShareSnapshotDigest({
    ...claims,
    implicitUntaggedMedia: [{ media_id: 1, tag_version: 2 }]
  });
  assert.notEqual(versionOne, legacy);
  assert.notEqual(versionTwo, versionOne);
});

test("implicit untagged entries are normalized as a bounded media subset", () => {
  assert.deepEqual(
    normalizeImplicitUntaggedMedia(
      '[{"media_id":1,"tag_version":0}]',
      { subsetOf: [1, 2] }
    ),
    [{ media_id: 1, tag_version: 0 }]
  );
  assert.deepEqual(normalizeImplicitUntaggedMedia(null), []);
  for (const invalid of [
    [{ media_id: 0, tag_version: 0 }],
    [{ media_id: 1, tag_version: -1 }],
    [{ media_id: 1, tag_version: 0 }, { media_id: 1, tag_version: 1 }]
  ]) {
    assert.throws(() => normalizeImplicitUntaggedMedia(invalid, { subsetOf: [1] }));
  }
  assert.throws(() => normalizeImplicitUntaggedMedia(
    [{ media_id: 2, tag_version: 0 }],
    { subsetOf: [1] }
  ));
});

test("owned untagged images require the explicit share option", () => {
  const owned = media(9);
  const tags = new Map([[9, []]]);
  const privacyByUser = privacy([[100]]);

  assert.deepEqual(
    selectPublicShareMedia([owned], tags, privacyByUser, claims),
    []
  );
  assert.deepEqual(
    selectPublicShareMedia([owned], tags, privacyByUser, claims, {
      allowOwnedUntaggedImages: true
    }).map((item) => item.id),
    [9]
  );
});

test("other users, videos and uploader privacy veto stay excluded when untagged", () => {
  const cases = [
    [media(10, { uploader_user_id: 200 }), privacy([[100], [200]])],
    [media(11, { media_type: "video" }), privacy([[100]])],
    [media(12), privacy([[100, { allow_uploaded_visible: false }]])]
  ];

  for (const [candidate, privacyByUser] of cases) {
    assert.deepEqual(
      selectPublicShareMedia(
        [candidate],
        new Map([[candidate.id, []]]),
        privacyByUser,
        claims,
        { allowOwnedUntaggedImages: true }
      ),
      []
    );
  }
});

test("owned untagged images rank after tagged groups but a focused target is seeded", () => {
  const tagged = media(20, { created_at: "2026-07-20T00:00:00.000Z" });
  const untagged = media(21, { created_at: "2026-07-22T00:00:00.000Z" });
  const candidates = [untagged, tagged];
  const tags = new Map([[20, [sharerSeatTag()]], [21, []]]);
  const privacyByUser = privacy([[100]]);

  assert.deepEqual(
    selectPublicShareMedia(candidates, tags, privacyByUser, claims, {
      allowOwnedUntaggedImages: true
    }).map((item) => item.id),
    [20, 21]
  );
  assert.deepEqual(
    selectPublicShareMedia(candidates, tags, privacyByUser, claims, {
      allowOwnedUntaggedImages: true,
      requiredMediaId: 21
    }).map((item) => item.id),
    [21, 20]
  );
});

test("share creation persists and reuses snapshot-local untagged versions", async () => {
  const connection = untaggedShareConnection([media(30, { tag_version: 7 })]);
  const options = {
    includeOwnedUntaggedImages: true,
    withTransaction: async (work) => work(connection)
  };

  const first = await createOrReuseSessionAlbumPublicShare(
    { user: { id: 100 } },
    10,
    options
  );
  const second = await createOrReuseSessionAlbumPublicShare(
    { user: { id: 100 } },
    10,
    options
  );

  assert.equal(connection.shares.length, 1);
  assert.deepEqual(first.media_ids, [30]);
  assert.deepEqual(first.implicit_untagged_media, [
    { media_id: 30, tag_version: 7 }
  ]);
  assert.equal(first.implicit_untagged_count, 1);
  assert.equal(second.share_id, first.share_id);
});

test("snapshot-local untagged visibility requires an exact current tag version", () => {
  const photo = media(40, { tag_version: 8 });
  const privacyByUser = privacy([[100]]);

  assert.equal(isAlbumPhotoVisibleInPublicShare(
    photo,
    [],
    privacyByUser,
    claims,
    { implicitUntaggedByMediaId: new Map([[40, 8]]) }
  ), true);
  assert.equal(isAlbumPhotoVisibleInPublicShare(
    photo,
    [],
    privacyByUser,
    claims,
    { implicitUntaggedByMediaId: new Map([[40, 7]]) }
  ), false);
  assert.equal(isAlbumPhotoVisibleInPublicShare(
    photo,
    [],
    privacyByUser,
    claims,
    { implicitUntaggedByMediaId: new Map() }
  ), false);
  assert.equal(isAlbumPhotoVisibleInPublicShare(
    photo,
    [sharerSeatTag()],
    privacyByUser,
    claims,
    { implicitUntaggedByMediaId: new Map([[40, 7]]) }
  ), false);
});

test("implicit untagged media is never eligible as a public share cover", () => {
  const photo = media(41, { image_width: 1600, image_height: 1200 });
  assert.deepEqual(
    selectPublicShareCoverMedia(
      [photo],
      new Map([[41, []]]),
      privacy([[100]]),
      claims
    ),
    []
  );
});

test("tag writes increment the version and public readers pass snapshot context", () => {
  assert.match(
    serviceSource,
    /UPDATE session_album_photos\s+SET tag_version = tag_version \+ 1\s+WHERE id = \?/
  );
  assert.match(serviceSource, /function implicitUntaggedByMediaIdForShare\(share\)/);
  const publicReadCalls = [...serviceSource.matchAll(
    /isAlbumPhotoVisibleInPublicShare\([\s\S]{0,180}?implicitUntaggedByMediaId:/g
  )];
  assert.ok(publicReadCalls.length >= 3);
  assert.match(
    serviceSource,
    /isAlbumPhotoVisibleInPublicShare\([\s\S]{0,180}?\{ implicitUntaggedByMediaId \}/
  );
});

test("public image bytes are reauthorized against the snapshot tag version", async () => {
  const photo = media(42, { tag_version: 5 });
  const publicClaims = {
    version: 2,
    shareId: 50,
    sessionId: 10,
    sharerUserId: 100,
    seatId: 1000
  };
  const visible = await getPublicSessionAlbumPhotoForMedia(publicClaims, 42, {
    withConnection: async (work) => work(publicUntaggedPhotoConnection(photo, 5))
  });
  assert.equal(visible.id, 42);

  await assert.rejects(
    () => getPublicSessionAlbumPhotoForMedia(publicClaims, 42, {
      withConnection: async (work) => work(publicUntaggedPhotoConnection(photo, 4))
    }),
    (error) => error.statusCode === 403
  );
});

test("custom selection returns only exact eligible IDs and never refills", () => {
  const candidates = [media(50), media(51), media(52)];
  const tags = new Map(candidates.map((item) => [item.id, [sharerSeatTag()]]));
  const selected = selectPublicShareMedia(
    candidates,
    tags,
    privacy([[100]]),
    claims,
    { selectedMediaIds: [50, 52] }
  );

  assert.deepEqual(new Set(selected.map((item) => item.id)), new Set([50, 52]));
  assert.equal(selected.length, 2);
  assert.throws(
    () => selectPublicShareMedia(candidates, tags, privacy([[100]]), claims, {
      selectedMediaIds: [50, 999]
    }),
    (error) => error.statusCode === 409 &&
      error.code === "ALBUM_PUBLIC_SHARE_SELECTION_CHANGED"
  );
});

test("custom selection rejects invalid shape, focus conflicts and video overflow", async () => {
  const videos = Array.from({ length: 4 }, (_, index) => media(60 + index, {
    media_type: "video"
  }));
  const videoTags = new Map(videos.map((item) => [item.id, [sharerSeatTag()]]));
  assert.throws(
    () => selectPublicShareMedia(videos, videoTags, privacy([[100]]), claims, {
      selectedMediaIds: videos.map((item) => item.id)
    }),
    (error) => error.statusCode === 400
  );

  for (const selectedMediaIds of [
    [],
    [1, 1],
    ["1"],
    Array.from({ length: 31 }, (_, index) => index + 1)
  ]) {
    await assert.rejects(
      () => createOrReuseSessionAlbumPublicShare({ user: { id: 100 } }, 10, {
        selectedMediaIds,
        withTransaction: async () => assert.fail("invalid selection must fail before transaction")
      }),
      (error) => error.statusCode === 400
    );
  }
  await assert.rejects(
    () => createOrReuseSessionAlbumPublicShare({ user: { id: 100 } }, 10, {
      focusMediaId: 1,
      selectedMediaIds: [1],
      withTransaction: async () => assert.fail("conflicting selection must fail before transaction")
    }),
    (error) => error.statusCode === 400
  );
});

test("custom snapshot persistence keeps the exact requested scope", async () => {
  const connection = untaggedShareConnection([media(70), media(71)]);
  const share = await createOrReuseSessionAlbumPublicShare(
    { user: { id: 100 } },
    10,
    {
      includeOwnedUntaggedImages: true,
      selectedMediaIds: [71],
      withTransaction: async (work) => work(connection)
    }
  );
  assert.deepEqual(share.media_ids, [71]);
  assert.equal(share.visible_count, 1);
});

test("share-token route forwards preview inputs and returns untagged count", () => {
  const route = serverSource.slice(
    serverSource.indexOf("const sessionAlbumShareTokenId"),
    serverSource.indexOf("const sessionAlbumPublicSharesId")
  );
  assert.match(route, /focusMediaId: body\?\.focusMediaId/);
  assert.match(route, /includeOwnedUntaggedImages: body\?\.includeOwnedUntaggedImages/);
  assert.match(route, /selectedMediaIds: body\?\.selectedMediaIds/);
  assert.match(route, /implicit_untagged_count: share\.implicit_untagged_count/);
});
